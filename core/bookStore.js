'use strict';
// 统一核心 · 书库存储（纯 Node、零依赖、真落盘）。
//
// 模型（对齐用户设想）：
//   先「建书」(createBook)，再「加文件」(addFile)。一本书 = 若干文件 + 一份整体分析结果。
//   没有「分层 / 层号 / 考试 / 科目」概念 —— 整本书被大模型当作一个整体分析。
//   书是最小单位，可建成百上千本，每本独立目录。
//
// 落盘结构（每本书一个目录）：
//   library/books/<id>/book.json        —— 书元数据 + 文件清单（轻量）
//   library/books/<id>/analysis.json    —— 整体分析结果（树状思维导图 + 题型索引）
//   library/books/<id>/files/<fid>__名  —— 文件原始字节
//   library/books/<id>/files/<fid>.txt  —— 抽取出的纯文本缓存（图片为空）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function defaultRoot() {
  return process.env.LIBRARY_ROOT || path.join(__dirname, '..', 'library');
}
function sanitizeName(s) {
  return (String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'unnamed').slice(0, 120);
}
function genId() {
  return crypto.randomBytes(8).toString('hex');
}
// id 白名单：genId() 产出 16 位 hex；自定义 id 只允许字母/数字/下划线/连字符。
// 这条规则同时拒绝 '..'、路径分隔符、URL 编码（%2e）等所有穿越形态。
// 导出的目的是让上层（core/request.js 的 IPC/HTTP 入口）与存储层共用同一判据，不各写一份。
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
function assertSafeId(id, label) {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) {
    throw new Error('非法' + (label || 'id') + '：只允许字母、数字、下划线、连字符（1-64 位）');
  }
  return id;
}
// 纵深防御：即使上层漏判，也保证解析后的绝对路径一定在 base 目录内。
function resolveInside(base, id, label) {
  assertSafeId(id, label);
  const p = path.resolve(base, id);
  const b = path.resolve(base) + path.sep;
  if (!p.startsWith(b)) throw new Error('路径越界：' + (label || 'id'));
  return p;
}
// 文件落盘：suffix 含 '.'（.txt）或 '__'，不能整体过 assertSafeId，
// 故先校验 fileId 本体，再校验「拼接后」的绝对路径仍在 filesDir 内。
function resolveFileInside(dir, fileId, suffix) {
  assertSafeId(fileId, '文件 id');
  const p = path.resolve(dir, fileId + suffix);
  const b = path.resolve(dir) + path.sep;
  if (!p.startsWith(b)) throw new Error('路径越界：文件 id');
  return p;
}
function nowIso() {
  return new Date().toISOString();
}
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff'];
function isImageExt(ext) {
  return IMAGE_EXT.includes((ext || '').toLowerCase());
}

class BookStore {
  constructor(root) {
    this.root = root || defaultRoot();
    this.booksDir = path.join(this.root, 'books');
    fs.mkdirSync(this.booksDir, { recursive: true });
  }

  _bookDir(id) { return resolveInside(this.booksDir, id, '书 id'); }
  _bookFile(id) { return path.join(this._bookDir(id), 'book.json'); }
  _analysisFile(id) { return path.join(this._bookDir(id), 'analysis.json'); }
  _filesDir(id) { return path.join(this._bookDir(id), 'files'); }

  // 建书：必须先建书，才有 id 可加文件。
  createBook(title, opts) {
    const o = opts || {};
    const id = o.id || genId();
    const book = {
      id,
      title: title || '未命名书',
      description: o.description || '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      files: [],
      analysisMeta: null // 分析后写入 { analyzedAt, model, stats }
    };
    fs.mkdirSync(this._bookDir(id), { recursive: true });
    fs.mkdirSync(this._filesDir(id), { recursive: true });
    fs.writeFileSync(this._bookFile(id), JSON.stringify(book, null, 2), 'utf8');
    return book;
  }

  getBook(id) {
    const f = this._bookFile(id);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }

  listBooks() {
    if (!fs.existsSync(this.booksDir)) return [];
    return fs.readdirSync(this.booksDir)
      .filter(d => fs.existsSync(this._bookFile(d)))
      .map(d => {
        try {
          const b = this.getBook(d);
          return {
            id: b.id,
            title: b.title,
            description: b.description || '',
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            fileCount: (b.files || []).length,
            analyzed: !!b.analysisMeta
          };
        } catch (e) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  _saveBook(book) {
    book.updatedAt = nowIso();
    fs.writeFileSync(this._bookFile(book.id), JSON.stringify(book, null, 2), 'utf8');
    return book;
  }

  // 加文件。buf 必须是 Buffer（原始字节）；meta={ name, note }。
  addFile(id, buf, meta) {
    const book = this.getBook(id);
    if (!book) throw new Error('书不存在：' + id);
    if (!Buffer.isBuffer(buf)) throw new Error('文件内容必须是 Buffer');
    const name = (meta && meta.name) || 'unnamed';
    const ext = path.extname(name).toLowerCase();
    const fileId = genId();
    const rec = {
      id: fileId,
      name,
      ext,
      size: buf.length,
      addedAt: nowIso(),
      isImage: isImageExt(ext),
      note: (meta && meta.note) || ''
    };
    fs.writeFileSync(resolveFileInside(this._filesDir(id), fileId, '__' + sanitizeName(name)), buf);
    book.files.push(rec);
    this._saveBook(book);
    return rec;
  }

  getFileBuffer(id, fileId) {
    assertSafeId(fileId, '文件 id');
    const book = this.getBook(id);
    if (!book) return null;
    const dir = this._filesDir(id);
    if (!fs.existsSync(dir)) return null;
    const cand = fs.readdirSync(dir).find(n => n.startsWith(fileId + '__'));
    if (!cand) return null;
    return fs.readFileSync(path.join(dir, cand));
  }

  // 文本缓存（files/<fid>.txt）。图片文件落空串，文本交给多模态 LLM。
  setFileText(id, fileId, text) {
    fs.writeFileSync(resolveFileInside(this._filesDir(id), fileId, '.txt'), String(text || ''), 'utf8');
  }
  getFileText(id, fileId) {
    const p = resolveFileInside(this._filesDir(id), fileId, '.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }

  removeFile(id, fileId) {
    assertSafeId(fileId, '文件 id');
    const book = this.getBook(id);
    if (!book) return false;
    const idx = book.files.findIndex(f => f.id === fileId);
    if (idx < 0) return false;
    book.files.splice(idx, 1);
    const dir = this._filesDir(id);
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(n => {
        if (n.startsWith(fileId + '__') || n === fileId + '.txt') fs.rmSync(path.join(dir, n), { force: true });
      });
    }
    this._saveBook(book);
    return true;
  }

  // 保存分析结果：同时写入 book.json 的 analysisMeta 与独立的 analysis.json（大结果单独读）。
  saveAnalysis(id, analysis) {
    const book = this.getBook(id);
    if (!book) throw new Error('书不存在：' + id);
    book.analysisMeta = {
      analyzedAt: (analysis && analysis.stats && analysis.stats.analyzedAt) || nowIso(),
      model: (analysis && analysis.model) || '',
      stats: (analysis && analysis.stats) || null
    };
    this._saveBook(book);
    fs.writeFileSync(this._analysisFile(id), JSON.stringify(analysis, null, 2), 'utf8');
    return book;
  }
  getAnalysis(id) {
    const f = this._analysisFile(id);
    if (fs.existsSync(f)) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* fallthrough */ }
    }
    const book = this.getBook(id);
    return book ? book.analysisMeta : null;
  }

  deleteBook(id) {
    const d = this._bookDir(id);
    if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); return true; }
    return false;
  }
}

module.exports = { BookStore, sanitizeName, genId, assertSafeId, isImageExt, IMAGE_EXT };
