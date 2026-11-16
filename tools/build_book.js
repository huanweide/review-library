/**
 * build_book.js —— 天道书院 · 统一格式构建器
 *
 * 把任意「天道书阁」书的分析产物整理成天道书院 bookData，落盘为书架可直接加载的脚本。
 * 这是"所有 LLM 解析出的内容统一格式"的唯一入口：新增一本书只跑本脚本，不手写 book-data.js。
 *
 * 用法（Node，推荐用 /c/Program Files/nodejs/node.exe 以匹配本地依赖 ABI）：
 *   node tools/build_book.js <analysis.json> <bookId> <书名> [subject] [files.json] [documents.json]
 *
 * 输出：books/<bookId>/book-data.js（window.BOOKS[id] = bookData）
 * 零外链、零凭据、零调试输出。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Adapter = require('../assets/js/adapter.js');
const store = require('../lib/store');

const out = s => process.stdout.write(String(s) + '\n');
const ROOT = path.resolve(__dirname, '..');

const [, , analysisPath, bookId, title, subject, filesPath, documentsPath] = process.argv;
if (!analysisPath || !bookId || !title) {
  out('用法: node tools/build_book.js <analysis.json> <bookId> <书名> [subject] [files.json] [documents.json]');
  process.exit(2);
}

function readJSON(p) {
  if (!p) return null;
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

const analysis = readJSON(analysisPath);
if (!analysis) { out('分析文件不存在: ' + analysisPath); process.exit(2); }

const filesRaw = readJSON(filesPath);
const files = Array.isArray(filesRaw) ? filesRaw : (filesRaw && Array.isArray(filesRaw.files) ? filesRaw.files : []);
const documents = readJSON(documentsPath) || {};
const book = Adapter.buildBookData({
  analysis,
  meta: {
    id: bookId, title,
    subject: subject || '备考',
    coverColor: '#2f6f4f', accent: '#e8b04b',
    createdAt: new Date().toISOString().slice(0, 10)
  },
  files,
  documents
});

// 重建时扫描 refs/ 目录里真实存在的资料（含用户后来上传的），一并登记进 refs——
// 否则重建会抹掉后上传文件的登记，它们就再也触发不了分析（实测踩中）。
const refsDir = path.join(store.BOOKS, bookId, 'refs');
const diskRefs = fs.existsSync(refsDir)
  ? fs.readdirSync(refsDir).filter(n => fs.statSync(path.join(refsDir, n)).isFile())
  : [];
const sourceNames = new Set(files.map(f => String(f.name || '')));
diskRefs.forEach(n => {
  if (sourceNames.has(n)) return; // 源文件已由 files.json 提供元信息
  const ext = path.extname(n).toLowerCase();
  book.refs.push({
    name: n, type: ext.replace('.', ''), file: 'refs/' + n,
    focus: false, note: '', isImage: /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(n)
  });
});
// 与服务端共用 store.writeBook：data.json（真源）+ book-data.js（静态回退）一次落盘
const saved = store.writeBook(bookId, book);
// 重建书＝按 files.json 重置分析台账：这些源文件的内容已在 analysis 里，视为已分析；
// 之后新上传的才算"新增"。不清空的话旧台账会把后传的文件也标成已分析（实测踩中）。
store.setAnalyzed(bookId, files.map(f => String(f.name || f.file || '')).filter(Boolean));

out('已生成: ' + store.dataPath(bookId) + ' (' + saved.bytes + ' bytes)');
out('  知识点 ' + book.kaogang.length + ' · 题 ' + book.tiku.length + ' · 资料 ' + book.refs.length);
out('  考点大全 ' + book.digest.sections.length + ' 章 · 速通向 ' + book.syllabus.sections.length + ' 章');
out('  引文核验 ' + (book._trace.quoteAudit.hit || 0) + '/' + (book._trace.quoteAudit.checked || 0) +
    ' · 重点★ ' + book.kaogang.filter(k => k.hot).length + ' 点');
