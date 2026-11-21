#!/usr/bin/env node
/**
 * 旧格式书 → 新格式（workbench 统一核心）迁移工具（2026-11-19）
 *
 * 背景：旧版全功能工作台把资料存在 layer_1/2/3/ + materials.json，book.json 里没有 files 数组；
 *       workbench（core/bookStore.js）只认 book.json.files，于是旧书被 listBooks 整本过滤掉，
 *       用户看不到自己已有的资料（书架只剩新建的空书）。
 *
 * 做法（只增不改，可恢复）：
 *   1) 备份原 book.json 到 _archive/legacy-migrate-<时间戳>/
 *   2) 给 book.json 补 files:[]（其余字段原样保留）
 *   3) 按 materials.json 的顺序，用 Core.addFile 真实入库（存原文件 + 抽文本 + 登记清单）
 *   4) layer_N/ 与 materials.json 原样保留，不删不改
 *
 * 用法：node tools/migrate-legacy-books.cjs            # 迁移所有旧格式书
 *       node tools/migrate-legacy-books.cjs <bookId>   # 只迁移一本
 *       node tools/migrate-legacy-books.cjs --dry-run  # 只报告，不写
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOOKS = path.join(ROOT, 'library', 'books');
const ARCHIVE = path.join(ROOT, '_archive', 'legacy-migrate-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const DRY = process.argv.includes('--dry-run');
const only = process.argv.find((a) => /^[A-Za-z0-9_-]+$/.test(a) && !a.startsWith('--') && a !== path.basename(process.argv[1]));

function isLegacy(dir) {
  const bf = path.join(dir, 'book.json');
  if (!fs.existsSync(bf)) return false;
  let b = null;
  try { b = JSON.parse(fs.readFileSync(bf, 'utf8')); } catch (e) { return false; }
  if (!b) return false;
  // 已是新格式且已有资料：不动。files 为空数组但带 materials.json = 上次中断的旧书，继续迁。
  if (Array.isArray(b.files) && b.files.length > 0) return false;
  return fs.existsSync(path.join(dir, 'materials.json')); // 旧格式指纹
}

function legacyMaterials(dir) {
  const mf = path.join(dir, 'materials.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { return []; }
  if (!Array.isArray(list)) return [];
  // 按 layer 升序（L1 核心 → L3 索引），同层按原顺序：重要的先进语料。
  return list
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (Number(a.m.layer) || 9) - (Number(b.m.layer) || 9) || a.i - b.i)
    .map((x) => x.m);
}

function findEntity(dir, rec) {
  const layers = [rec.layer, 1, 2, 3, 0].filter((x) => x != null);
  const cands = [];
  for (const L of new Set(layers)) {
    cands.push(path.join(dir, 'layer_' + L, rec.id + (rec.ext || '')));
    cands.push(path.join(dir, 'layer_' + L, rec.id));
  }
  // 兜底：在任意 layer_N 下按 id 前缀找
  for (const sub of fs.readdirSync(dir)) {
    if (!/^layer_\d+$/.test(sub)) continue;
    const hits = fs.readdirSync(path.join(dir, sub)).filter((n) => n.startsWith(rec.id));
    hits.forEach((h) => cands.push(path.join(dir, sub, h)));
  }
  return cands.find((p) => fs.existsSync(p)) || null;
}

async function migrate(bookId) {
  const dir = path.join(BOOKS, bookId);
  const bf = path.join(dir, 'book.json');
  const book = JSON.parse(fs.readFileSync(bf, 'utf8'));
  const mats = legacyMaterials(dir);
  const readable = mats.filter((m) => findEntity(dir, m));
  console.log('\n=== ' + bookId + ' · ' + (book.title || '(无标题)') + ' ===');
  console.log('旧清单 ' + mats.length + ' 条，找到实体 ' + readable.length + ' 条');
  readable.forEach((m) => console.log('  L' + (m.layer || '?') + ' ' + m.name + ' (' + (m.size || 0) + 'B)'));
  const missing = mats.filter((m) => !findEntity(dir, m));
  if (missing.length) console.log('  ⚠ 实体缺失（跳过）: ' + missing.map((m) => m.name).join('、'));

  if (DRY) { console.log('  (dry-run，不写)'); return { ok: true, dry: true, count: readable.length }; }
  if (!readable.length) { console.log('  无可迁移资料，跳过'); return { ok: false, count: 0 }; }

  // 1) 备份原 book.json
  fs.mkdirSync(ARCHIVE, { recursive: true });
  fs.copyFileSync(bf, path.join(ARCHIVE, bookId + '.book.json'));

  // 2) 补 files:[]（其余字段原样）+ 建 files/ 目录（addFile 假设建书时已有）
  const patched = Object.assign({}, book, { files: [] });
  fs.writeFileSync(bf, JSON.stringify(patched, null, 2), 'utf8');
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });

  // 3) 用真实代码路径入库（存原文件 + 抽文本 + 登记）
  // BookStore 的 root 是 library 目录（其内部再拼 books/），不是项目根。
  const { Core } = require(path.join(ROOT, 'core'));
  const core = new Core(path.join(ROOT, 'library'));
  let ok = 0;
  for (const m of readable) {
    const src = findEntity(dir, m);
    const buf = fs.readFileSync(src);
    const note = String(m.prompt || '').trim();
    try {
      await core.addFile(bookId, buf, { name: m.name, note });
      ok++;
      console.log('  ✓ 入库 ' + m.name);
    } catch (e) {
      console.log('  ✗ 失败 ' + m.name + '：' + e.message);
    }
  }
  console.log('  结果：入库 ' + ok + '/' + readable.length + ' 份；原 book.json 备份在 ' + path.relative(ROOT, ARCHIVE));
  return { ok: ok === readable.length, count: ok };
}

(async () => {
  const ids = fs.readdirSync(BOOKS).filter((d) => fs.statSync(path.join(BOOKS, d)).isDirectory());
  const targets = ids.filter((d) => (only ? d === only : true) && isLegacy(path.join(BOOKS, d)));
  if (!targets.length) { console.log('没有需要迁移的旧格式书（' + (only ? '指定 ' + only + ' ' : '') + '已全部是新格式）'); return; }
  console.log('待迁移 ' + targets.length + ' 本：' + targets.join(', '));
  let total = 0, files = 0;
  for (const id of targets) {
    const r = await migrate(id);
    if (r.ok) total++;
    files += r.count;
  }
  console.log('\n=== 汇总：' + total + '/' + targets.length + ' 本迁移成功，共 ' + files + ' 份资料 ===');
  if (!DRY) console.log('原 layer_N 与 materials.json 未改动；book.json 原件在 _archive/legacy-migrate-* 可恢复。');
})().catch((e) => { console.error('迁移失败：', e.message); process.exit(1); });
