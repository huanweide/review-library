/**
 * store.js —— 天道书院 · 服务端数据层（唯一真源）
 *
 * 契约：books/<id>/data.json 是书数据的权威副本；book-data.js 只是它的静态回退。
 * 所有读写都必须经过本文件，禁止 API / CLI 各自拼路径（防路径穿越、防书单与数据漂移）。
 *
 * 零依赖（Node 原生 fs/path）、零外链、零凭据。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOOKS = path.join(ROOT, 'books');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function validId(id) { return ID_RE.test(String(id || '')); }
function dataPath(id) { return path.join(BOOKS, id, 'data.json'); }
function fallbackPath(id) { return path.join(BOOKS, id, 'book-data.js'); }

// 静态文件 safepath：解析后必须在 ROOT 内，挡住 ../ 穿越
function safeStatic(rel) {
  const abs = path.resolve(ROOT, '.' + path.sep + String(rel || '').replace(/^[/\\]+/, ''));
  if (abs !== ROOT && abs.indexOf(ROOT + path.sep) !== 0) return null;
  return abs;
}

function listBooks() {
  if (!fs.existsSync(BOOKS)) return [];
  return fs.readdirSync(BOOKS, { withFileTypes: true })
    .filter(d => d.isDirectory() && validId(d.name))
    .map(d => {
      const p = dataPath(d.name);
      if (!fs.existsSync(p)) return null;
      try {
        const book = JSON.parse(fs.readFileSync(p, 'utf8'));
        const m = book.meta || {};
        return {
          id: d.name,
          title: m.title || d.name,
          subject: m.subject || '备考',
          coverColor: m.coverColor || '#2f6f4f',
          accent: m.accent || '#e8b04b',
          desc: m.desc || m.summary || '统一格式 · 原文核验 · 零反馈自测',
          builtin: true
        };
      } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN'));
}

function readBook(id) {
  if (!validId(id)) return null;
  const p = dataPath(id);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

// 生成静态回退脚本：window.BOOKS[id] = <book>（file:// 双击可用，与 data.json 同源）
function renderFallback(id, book) {
  return '/* 由服务端数据层自动生成，勿手改；真源为 books/' + id + '/data.json。 */\n' +
    'window.BOOKS = window.BOOKS || {};\n' +
    'window.BOOKS[' + JSON.stringify(id) + '] = ' + JSON.stringify(book, null, 2) + ';\n';
}

// 资料原文件落盘：books/<id>/refs/<name>，返回相对路径（供前端阅读/下载）
function writeRefFile(id, name, buffer) {
  if (!validId(id)) throw new Error('非法书 id');
  const safe = path.basename(String(name || '')).replace(/[\\/:*?"<>|]/g, '_');
  if (!safe) throw new Error('文件名为空');
  const dir = path.join(BOOKS, id, 'refs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, safe);
  fs.writeFileSync(abs, buffer);
  return 'refs/' + safe;
}

// 已分析文件台账：books/<id>/analyzed.json（只记文件名，绝不记密钥/语料）
function analyzedPath(id) { return path.join(BOOKS, id, 'analyzed.json'); }
function getAnalyzed(id) {
  if (!validId(id)) return [];
  const p = analyzedPath(id);
  if (!fs.existsSync(p)) return [];
  try { const a = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(a.files) ? a.files : []; }
  catch (e) { return []; }
}
function setAnalyzed(id, files) {
  if (!validId(id)) throw new Error('非法书 id');
  const dir = path.join(BOOKS, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = analyzedPath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ files: arr(files), updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(tmp, analyzedPath(id));
}
function arr(v) { return Array.isArray(v) ? v : []; }

function writeBook(id, book) {
  if (!validId(id)) throw new Error('非法书 id：只允许字母/数字/下划线/连字符');
  if (!book || typeof book !== 'object') throw new Error('书数据必须是对象');
  const dir = path.join(BOOKS, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 先写临时文件再改名，避免读到半截 JSON
  const tmp = dataPath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(book, null, 2), 'utf8');
  fs.renameSync(tmp, dataPath(id));
  fs.writeFileSync(fallbackPath(id), renderFallback(id, book), 'utf8');
  return { id, bytes: fs.statSync(dataPath(id)).size };
}

module.exports = {
  ROOT, BOOKS, validId, dataPath, fallbackPath, safeStatic,
  listBooks, readBook, writeBook, renderFallback,
  writeRefFile, analyzedPath, getAnalyzed, setAnalyzed
};
