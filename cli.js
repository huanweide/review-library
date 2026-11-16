/**
 * cli.js —— 天道书院 · 命令行入口（app 级的程序入口，不只是浏览器地址栏）
 *
 * 用法：
 *   node cli.js serve [--port 4090]                 启动应用服务
 *   node cli.js list                                列出已落盘的书
 *   node cli.js import <analysis.json> <id> <书名> [科目] [files.json] [documents.json]
 *   node cli.js build <分析文件> <id> <书名> ...     同 import（别名，向后兼容）
 *
 * 零依赖、零外链、零凭据。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const Adapter = require('./assets/js/adapter');
const { startServer, DEFAULT_PORT } = require('./server');

const out = s => process.stdout.write(String(s) + '\n');
const [cmd, ...args] = process.argv.slice(2);

function readJSON(p) {
  if (!p) return null;
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) throw new Error('文件不存在: ' + abs);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function cmdImport(argv) {
  const [analysisPath, id, title, subject, filesPath, documentsPath] = argv;
  if (!analysisPath || !id || !title) {
    out('用法: node cli.js import <analysis.json> <id> <书名> [科目] [files.json] [documents.json]');
    process.exit(2);
  }
  const analysis = readJSON(analysisPath);
  const filesRaw = readJSON(filesPath);
  const files = Array.isArray(filesRaw) ? filesRaw : ((filesRaw && filesRaw.files) || []);
  const documents = readJSON(documentsPath) || {};
  const book = Adapter.buildBookData({
    analysis,
    meta: {
      id, title, subject: subject || '备考',
      coverColor: '#2f6f4f', accent: '#e8b04b',
      createdAt: new Date().toISOString().slice(0, 10)
    },
    files, documents
  });
  const saved = store.writeBook(id, book);
  out('已导入《' + title + '》→ ' + store.dataPath(id) + ' (' + saved.bytes + ' bytes)');
  out('  知识点 ' + book.kaogang.length + ' · 题 ' + book.tiku.length +
      ' · 引文核验 ' + (book._trace.quoteAudit.hit || 0) + '/' + (book._trace.quoteAudit.checked || 0));
}

function cmdList() {
  const books = store.listBooks();
  if (!books.length) { out('书架为空。用 node cli.js import ... 导入一本书。'); return; }
  out('已落盘 ' + books.length + ' 本：');
  books.forEach((b, i) => out('  ' + (i + 1) + '. [' + b.id + '] ' + b.title + ' · ' + b.subject));
}

function cmdServe(argv) {
  const i = argv.indexOf('--port');
  const port = i >= 0 ? argv[i + 1] : (argv[0] && /^\d+$/.test(argv[0]) ? argv[0] : DEFAULT_PORT);
  startServer(port);
}

switch (cmd) {
  case 'serve': cmdServe(args); break;
  case 'list': cmdList(); break;
  case 'import':
  case 'build': cmdImport(args); break;
  case undefined:
    out('天道书院 CLI');
    out('  serve [--port 4090]   启动服务');
    out('  list                  列出书');
    out('  import <分析> <id> <书名> [科目] [files.json] [documents.json]');
    break;
  default:
    out('未知命令: ' + cmd);
    process.exit(2);
}
