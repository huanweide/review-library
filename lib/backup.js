'use strict';
/**
 * 整库导出 / 导入（字节级，纯本地单文件 JSON）。
 * 对齐基准：Anki「automatic backups of your card data」、Mochi「imports and exports」。
 *
 * v0.7 修的四条真缺陷（均有判别测试锁住）：
 *  1) 超过单文件上限的资料不再「静默跳过」——收录上限提到 180MB，仍超限的进 skipped[] 并在界面显式告警；
 *  2) 导入不再绕开 store 的跨进程锁与原子写，且 mode 只认 replace（旧版 merge 会让 index 与目录错位）；
 *  3) replace 恢复同时清空旧 .trash，避免孤儿文件；
 *  4) 导出携带脱敏设置（settings）与完整性摘要（integrity / skipped），恢复后能还原用户的引擎与出题参数。
 *
 * 所有文件按相对路径 + base64 打包；导入时逐字符校验路径，拒绝 '..' 与绝对路径（防目录穿越）。
 */
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./store');

const FORMAT = 'review-library-backup';
const VERSION = 1;
// 单文件上限 180MB：base64 后约 240MB，与 server.js 的 MAX_BODY 260MB 配套。
// 旧版 64MB 会把一本扫描版 PDF 静默丢掉，且导出仍显示「已导出」。
const MAX_FILE_BYTES = 180 * 1024 * 1024;
const SETTINGS_KEYS = ['engine', 'baseURL', 'model', 'pointCount', 'questionCount', 'prompt', 'dedupeThreshold'];

function safeRel(rel) {
  if (typeof rel !== 'string' || !rel) return false;
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)) return false;
  const parts = rel.split(/[\\/]/);
  return !parts.some(p => p === '..' || p === '');
}

// 脱敏白名单：只搬非敏感设置，apiKey / 任何 sk- 开头的密钥永不进备份文件。
function sanitizeSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of SETTINGS_KEYS) {
    const v = raw[k];
    if (v == null) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (typeof v === 'object') continue;
    out[k] = typeof v === 'string' ? v.slice(0, 500) : v;
  }
  return out;
}

function walk(dir, base, out, skipped) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) { walk(full, rel, out, skipped); continue; }
    if (!st.isFile()) continue;
    if (st.size > MAX_FILE_BYTES) {
      skipped.push({ rel, size: st.size, reason: '超过单文件 180MB 上限，需手动复制原件' });
      continue;
    }
    out.push({ rel, data: fs.readFileSync(full).toString('base64') });
  }
}

/** 生成完整备份（data = 可下载字符串，meta = 给界面用的完整性摘要，不重复解析大字符串）。 */
function buildBackup(store, opts) {
  const root = store.root;
  const books = [];
  const skipped = [];
  const booksDir = path.join(root, 'books');
  if (fs.existsSync(booksDir)) {
    for (const id of fs.readdirSync(booksDir)) {
      const d = path.join(booksDir, id);
      if (!fs.statSync(d).isDirectory()) continue;
      const files = [];
      walk(d, '', files, skipped);
      books.push({ id, files });
    }
  }
  const extra = {};
  for (const f of ['index.json', 'trash.json']) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) extra[f] = fs.readFileSync(p).toString('base64');
  }
  const trashDir = path.join(root, '.trash');
  const trash = [];
  if (fs.existsSync(trashDir)) {
    try { walk(trashDir, '', trash, skipped); } catch (e) { /* 回收站损坏不阻断备份 */ }
  }
  let bytes = 0;
  for (const f of trash) bytes += Math.floor(String(f.data || '').length * 3 / 4);
  for (const b of books) for (const f of b.files) bytes += Math.floor(String(f.data || '').length * 3 / 4);
  const integrity = { files: trash.length + books.reduce((n, b) => n + b.files.length, 0), bytes, skipped: skipped.length };
  const settings = sanitizeSettings(opts && opts.settings);
  const j = {
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
    books, extra, trashFiles: trash, settings, skipped, integrity
  };
  return { data: JSON.stringify(j), meta: { settings, skipped, integrity } };
}

function exportAll(store, opts) { return buildBackup(store, opts).data; }

function parse(data) {
  const j = typeof data === 'string' ? JSON.parse(data) : data;
  if (!j || j.format !== FORMAT || j.version !== VERSION || !Array.isArray(j.books)) {
    throw new Error('不是本系统的备份文件（格式或版本不匹配）');
  }
  for (const b of j.books) {
    if (!b || typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.id) || !Array.isArray(b.files)) {
      throw new Error('备份内含非法书目录');
    }
    for (const f of b.files) if (!safeRel(f.rel)) throw new Error('备份内含越界路径，已拒绝导入');
  }
  if (j.trashFiles != null && !Array.isArray(j.trashFiles)) throw new Error('备份内回收站数据格式不对');
  if (j.skipped != null && !Array.isArray(j.skipped)) throw new Error('备份内跳过清单格式不对');
  // 恶意备份塞进来的密钥字段一律不回传、不落盘。
  j.settings = sanitizeSettings(j.settings);
  return j;
}

function importAll(store, data, opts) {
  const j = parse(data);
  const mode = (opts && opts.mode) || 'replace';
  // 旧版把任何非 replace 值当 merge：旧 books 目录留着，index.json 却被覆盖，书从书架消失但文件还在。
  // 没有真实 merge 实现之前，只放行语义明确的 replace，其它值大声拒绝。
  if (mode !== 'replace') throw new Error('不支持的恢复模式：' + String(mode).slice(0, 40) + '（只支持 replace 覆盖恢复）');
  if (typeof store.withLock !== 'function') throw new Error('数据层不支持跨进程锁，拒绝执行恢复');
  const root = store.root;
  const booksDir = path.join(root, 'books');
  const trashDir = path.join(root, '.trash');
  // 整库恢复是破坏性写，必须和 createBook / recordGrade 等走同一把锁，且文件全部原子替换。
  return store.withLock(() => {
    fs.rmSync(booksDir, { recursive: true, force: true });
    fs.mkdirSync(booksDir, { recursive: true });
    // 不清旧 .trash 会留下孤儿文件，且旧 trash.json 与新 index 错位。
    fs.rmSync(trashDir, { recursive: true, force: true });
    fs.mkdirSync(trashDir, { recursive: true });
    let fileCount = 0;
    for (const b of j.books) {
      const d = path.join(booksDir, b.id);
      fs.mkdirSync(d, { recursive: true });
      for (const f of b.files) {
        const dest = path.join(d, f.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        writeAtomic(dest, Buffer.from(String(f.data || ''), 'base64'));
        fileCount++;
      }
    }
    for (const k of Object.keys(j.extra || {})) {
      if (!/^(index|trash)\.json$/.test(k)) continue;
      writeAtomic(path.join(root, k), Buffer.from(String(j.extra[k] || ''), 'base64'));
    }
    if (Array.isArray(j.trashFiles)) {
      for (const f of j.trashFiles) {
        if (!safeRel(f.rel)) continue;
        const dest = path.join(trashDir, f.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        writeAtomic(dest, Buffer.from(String(f.data || ''), 'base64'));
      }
    }
    return { ok: true, books: j.books.length, files: fileCount, mode,
      settings: j.settings || {}, skipped: j.skipped || [], integrity: j.integrity || null };
  });
}

module.exports = { FORMAT, VERSION, MAX_FILE_BYTES, exportAll, buildBackup, importAll, parse, safeRel, sanitizeSettings };
