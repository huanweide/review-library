'use strict';
// 统一核心 · 门面（Facade）。对外单一入口，桌面端 / DSH 插件都只接这一层。
//
// 用法：
//   const { Core } = require('./core');
//   const core = new Core();                 // 默认根：library/
//   const book = core.createBook('高数上册');
//   await core.addFile(book.id, buf, { name: '第1章.pdf' });
//   const result = await core.analyze(book.id, { cfg });  // cfg = { baseURL, apiKey, model }
//   core.getAnalysis(book.id);
const { BookStore } = require('./bookStore');
const extract = require('./extract');
const analyzeLib = require('./analyze');

// 版本号唯一真源 = 根 package.json 的 version；本常量由 scripts/sync-versions.mjs 机械同步，禁止手改。
const CORE_VERSION = '1.3.0';

class Core {
  constructor(root) {
    this.store = new BookStore(root);
  }

  createBook(title, opts) { return this.store.createBook(title, opts); }
  listBooks() { return this.store.listBooks(); }
  getBook(id) { return this.store.getBook(id); }
  deleteBook(id) { return this.store.deleteBook(id); }

  // 加文件并自动抽取文本缓存（图片不抽，文本留待多模态 LLM）。
  async addFile(id, buf, meta) {
    const rec = this.store.addFile(id, buf, meta);
    const text = rec.isImage ? '' : await extract.extractText(rec.ext, buf);
    this.store.setFileText(id, rec.id, text == null ? '' : text);
    return rec;
  }

  getFileBuffer(id, fileId) { return this.store.getFileBuffer(id, fileId); }
  getFileText(id, fileId) { return this.store.getFileText(id, fileId); }
  removeFile(id, fileId) { return this.store.removeFile(id, fileId); }

  // 拼整本书文本（各文件文本用文件名分隔后拼接），供整体分析。
  getBookText(id) {
    const book = this.store.getBook(id);
    if (!book) return null;
    const parts = [];
    book.files.forEach(f => {
      if (f.isImage) return; // 图片不进文本，后续交给多模态
      const t = this.store.getFileText(id, f.id);
      if (t && t.trim()) parts.push('【文件：' + f.name + '】\n' + t);
    });
    return parts.join('\n\n');
  }

  // 整本书整体分析（只用 LLM）。分析完自动落盘。
  async analyze(id, opts) {
    const book = this.store.getBook(id);
    if (!book) throw new Error('书不存在：' + id);
    const text = this.getBookText(id);
    // F5：把「图片数 / 资料总数」传给分析层，纯图片书才能给出「需视觉模型」而不是空壳分析。
    const files = book.files || [];
    const withStats = Object.assign({}, opts, {
      imageCount: files.filter(f => f.isImage).length,
      materialCount: files.length
    });
    const result = await analyzeLib.analyze(book.title, text, withStats);
    this.store.saveAnalysis(id, result);
    return result;
  }

  getAnalysis(id) { return this.store.getAnalysis(id); }
}

module.exports = { CORE_VERSION, Core, BookStore, extract, analyze: analyzeLib };
