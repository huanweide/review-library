'use strict';
/**
 * 整库导出 / 导入（字节级，纯本地单文件 JSON）。
 * 对齐基准：Mochi「offline ... allows unlimited cards, decks, imports and exports」、Anki .apkg。
 *
 * 为什么是字节级：资料里有 PPTX/PDF/图片等二进制，只导元数据会丢原件。
 * 所有文件按相对路径 + base64 打包，导入时逐字符校验路径，拒绝 '..' 与绝对路径（防目录穿越）。
 */
const fs = require('fs');
const path = require('path');

const FORMAT = 'review-library-backup';
const VERSION = 1;

function safeRel(rel) {
  if (typeof rel !== 'string' || !rel) return false;
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)) return false;
  const parts = rel.split(/[\\/]/);
  return !parts.some(p => p === '..' || p === '' );
}

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, rel, out);
    else if (st.isFile() && st.size <= 64 * 1024 * 1024) {
      out.push({ rel, data: fs.readFileSync(full).toString('base64') });
    }
  }
}

function exportAll(store) {
  const root = store.root;
  const books = [];
  const booksDir = path.join(root, 'books');
  if (fs.existsSync(booksDir)) {
    for (const id of fs.readdirSync(booksDir)) {
      const d = path.join(booksDir, id);
      if (!fs.statSync(d).isDirectory()) continue;
      const files = [];
      walk(d, '', files);
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
    try { walk(trashDir, '', trash); } catch (e) { /* 回收站损坏不阻断备份 */ }
  }
  return JSON.stringify({
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
    books, extra, trashFiles: trash
  });
}

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
  return j;
}

function importAll(store, data, opts) {
  const j = parse(data);
  const mode = (opts && opts.mode) || 'replace';
  const root = store.root;
  const booksDir = path.join(root, 'books');
  if (mode === 'replace') {
    fs.rmSync(booksDir, { recursive: true, force: true });
    fs.mkdirSync(booksDir, { recursive: true });
  }
  let fileCount = 0;
  for (const b of j.books) {
    const d = path.join(booksDir, b.id);
    fs.mkdirSync(d, { recursive: true });
    for (const f of b.files) {
      const dest = path.join(d, f.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(String(f.data || ''), 'base64'));
      fileCount++;
    }
  }
  for (const k of Object.keys(j.extra || {})) {
    if (!/^(index|trash)\.json$/.test(k)) continue;
    fs.writeFileSync(path.join(root, k), Buffer.from(String(j.extra[k] || ''), 'base64'));
  }
  if (Array.isArray(j.trashFiles) && j.trashFiles.length) {
    const td = path.join(root, '.trash');
    fs.mkdirSync(td, { recursive: true });
    for (const f of j.trashFiles) {
      if (!safeRel(f.rel)) continue;
      const dest = path.join(td, f.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(String(f.data || ''), 'base64'));
    }
  }
  return { ok: true, books: j.books.length, files: fileCount, mode };
}

module.exports = { FORMAT, VERSION, exportAll, importAll, parse, safeRel };
