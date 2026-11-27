'use strict';
/**
 * 本机快照（2026-11-27）：书级数据变更前自动留一份，改坏了能恢复。
 *
 * 边界（写清楚，不事后找补）：
 * - 只写本机 library/_snapshots/，不联网、不上传、不开账号。
 * - 只留轻量数据：book / analysis / practice / structure / cards，不复制原图与原始 PDF
 *   （那些在 library/files|images 里，体积大且不会被结构层改动影响）。
 * - 因此它防「我改错了一个节点名」，不防硬盘物理损坏——后者要另做离线备份。
 */
const fs = require('fs');
const path = require('path');

const KEEP = 5;
const FILES = ['book.json', 'analysis.json', 'practice.json', 'structure.json'];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  // 必须到毫秒：连续两次改结构若落在同一秒，秒级 id 会互相覆盖，
  // 用户以为「留了两份」实际只有一份——判别测试就踩到过。
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-'
    + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
    + '-' + String(d.getMilliseconds()).padStart(3, '0');
}

function snapshotRoot(root, bookId) {
  return path.join(root, 'library', '_snapshots', String(bookId));
}

/**
 * 留一份快照，返回 {id, dir, files}。目录不存在时不影响调用方（比如书还没分析）。
 */
function saveSnapshot(root, bookId, label) {
  const src = path.join(root, 'library', 'books', String(bookId));
  if (!fs.existsSync(src)) return null;
  const base = snapshotRoot(root, bookId);
  const id = stamp();
  const dir = path.join(base, id);
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const name of FILES) {
    const from = path.join(src, name);
    if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(dir, name)); n++; }
  }
  const cardsDir = path.join(src, 'cards');
  if (fs.existsSync(cardsDir)) {
    const target = path.join(dir, 'cards');
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(cardsDir)) {
      if (!/^(lesson|assignment)-\d+\.json$/.test(name)) continue;
      fs.copyFileSync(path.join(cardsDir, name), path.join(target, name));
      n++;
    }
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    id, bookId: String(bookId), label: String(label || '变更前'), at: new Date().toISOString(), files: n,
  }, null, 2) + '\n', 'utf8');
  // 保留最近 KEEP 份：只删本 bookId 子目录，绝不递归删 library 根。
  try {
    const all = fs.readdirSync(base).filter((x) => /^\d{8}-\d{6}(-\d{3})?$/.test(x)).sort().reverse();
    for (const old of all.slice(KEEP)) fs.rmSync(path.join(base, old), { recursive: true, force: true });
  } catch (e) { /* 清理失败不影响这次快照 */ }
  return { id, dir, files: n + 1 };
}

/** 列出可用快照（新的在前），不读大文件内容。 */
function listSnapshots(root, bookId) {
  const base = snapshotRoot(root, bookId);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter((x) => /^\d{8}-\d{6}(-\d{3})?$/.test(x)).sort().reverse().map((id) => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(base, id, 'meta.json'), 'utf8'));
      return { id, at: m.at, label: m.label, files: m.files };
    } catch (e) { return { id, at: '', label: '未知', files: 0 }; }
  });
}

/** 恢复到指定快照：只覆盖白名单文件，不删目标目录、不动原图。 */
function restoreSnapshot(root, bookId, id) {
  if (!/^\d{8}-\d{6}(-\d{3})?$/.test(String(id))) throw new Error('快照 id 不合法');
  const from = path.join(snapshotRoot(root, bookId), id);
  const to = path.join(root, 'library', 'books', String(bookId));
  if (!fs.existsSync(from)) throw new Error('快照不存在');
  if (!fs.existsSync(to)) throw new Error('书不存在');
  let n = 0;
  for (const name of FILES) {
    const f = path.join(from, name);
    if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(to, name)); n++; }
  }
  const cardsFrom = path.join(from, 'cards');
  if (fs.existsSync(cardsFrom)) {
    fs.mkdirSync(path.join(to, 'cards'), { recursive: true });
    for (const name of fs.readdirSync(cardsFrom)) {
      if (!/^(lesson|assignment)-\d+\.json$/.test(name)) continue;
      fs.copyFileSync(path.join(cardsFrom, name), path.join(to, 'cards', name));
      n++;
    }
  }
  return { id, files: n };
}

module.exports = { KEEP, saveSnapshot, listSnapshots, restoreSnapshot };
