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
const practiceLib = require('./practice');

// 版本号唯一真源 = 根 package.json 的 version；本常量由 scripts/sync-versions.mjs 机械同步，禁止手改。
const CORE_VERSION = '1.5.0';

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
  // v3：每个文件先经 segmentText 打「页/段锚点」，语料才能被引用、被覆盖统计、被引文校验。
  // 只改拼装输出，不重抽、不改写已落盘的文本缓存 —— 老书零迁移。
  getBookText(id) {
    const book = this.store.getBook(id);
    if (!book) return null;
    const parts = [];
    book.files.forEach(f => {
      if (f.isImage) return; // 图片不进文本，后续交给多模态
      const t = this.store.getFileText(id, f.id);
      if (!t || !t.trim()) return;
      const segs = extract.segmentText(t, { name: f.name, ext: f.ext });
      parts.push('【文件：' + f.name + '】\n' + segs.map(s => s.anchor + s.text).join('\n'));
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
      materialCount: files.length,
      // v2：真实文件名清单注入提示词，题目的 source.file 才能回溯到导入的资料。
      files: files.map(f => ({ name: f.name, isImage: !!f.isImage }))
    });
    const result = await analyzeLib.analyze(book.title, text, withStats);
    this.store.saveAnalysis(id, result);
    return result;
  }

  getAnalysis(id) { return this.store.getAnalysis(id); }

  // ---------- 学习闭环（2026-11-11）：门面方法，DSH / 专家形态直接调这里 ----------
  // 关键边界：getQuiz 返回的是**脱敏题目**（不含 answer / solution / rationale），
  // 答案只在 submitAttempt 判分后才第一次下发。这不是 CSS 遮挡，是数据层真隐藏。

  // 练习列表 + 进度概览。未分析时明确报错，不返回空壳骗前端。
  getQuiz(id, opts) {
    const a = this.store.getAnalysis(id);
    if (!a || !Array.isArray(a.questionIndex)) throw new Error('请先完成整体分析，再开始练习');
    const questions = practiceLib.flatten(a, true);
    const state = practiceLib.normalizeState(this.store.getPractice(id));
    const now = (opts && opts.now) || Date.now();
    return { questions, total: questions.length, summary: practiceLib.summarize(state, now) };
  }

  // 原始过程状态（供统计 / 调试 / 判别测试跨实例回读）。
  getPractice(id) {
    return practiceLib.normalizeState(this.store.getPractice(id));
  }

  // 今日到期题目（脱敏）。now 可注入，判别测试不依赖真实时间。
  getDue(id, opts) {
    const a = this.store.getAnalysis(id);
    if (!a || !Array.isArray(a.questionIndex)) return { questions: [], dueCount: 0 };
    const now = (opts && opts.now) || Date.now();
    const state = practiceLib.normalizeState(this.store.getPractice(id));
    const keys = practiceLib.dueKeys(state, now);
    const set = new Set(keys);
    const questions = practiceLib.flatten(a, true).filter(q => set.has(q.key));
    // 保持 leech 上浮 / 到期先后，不按题目原序打乱。
    questions.sort((x, y) => keys.indexOf(x.key) - keys.indexOf(y.key));
    return { questions, dueCount: keys.length, summary: practiceLib.summarize(state, now) };
  }

  // 提交作答。body = { key, given }；只有这里才把答案与解析返回给调用方。
  submitAttempt(id, body, opts) {
    const a = this.store.getAnalysis(id);
    if (!a || !Array.isArray(a.questionIndex)) throw new Error('尚无分析结果');
    const b = body && typeof body === 'object' ? body : {};
    const q = practiceLib.findQuestion(a, b.key);
    if (!q) throw new Error('题目不存在或已随重新分析改变，请刷新练习列表');
    const now = (opts && opts.now) || Date.now();
    const state = this.store.getPractice(id);
    const r = practiceLib.attempt(state, q, b.given, now);
    this.store.savePractice(id, r.state);
    return r.result;
  }

  // 开放题揭晓后四档自评，或答完调整掌握度。body = { key, rating(1-4) }。
  rateCard(id, body, opts) {
    const b = body && typeof body === 'object' ? body : {};
    const now = (opts && opts.now) || Date.now();
    const state = this.store.getPractice(id);
    const r = practiceLib.rate(state, b.key, b.rating, now);
    if (r.error) throw new Error(r.error);
    this.store.savePractice(id, r.state);
    return r.result;
  }
}

module.exports = { CORE_VERSION, Core, BookStore, extract, analyze: analyzeLib, practice: practiceLib };
