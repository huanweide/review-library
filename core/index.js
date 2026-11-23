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
const fs = require('fs');
const path = require('path');
const { BookStore } = require('./bookStore');
const extract = require('./extract');
const imagesLib = require('./images');
const visionLib = require('./image-vision');
const analyzeLib = require('./analyze');
const practiceLib = require('./practice');
const documentsLib = require('./documents');

// 版本号唯一真源 = 根 package.json 的 version；本常量由 scripts/sync-versions.mjs 机械同步，禁止手改。
const CORE_VERSION = '1.7.0';

class Core {
  constructor(root) {
    this.store = new BookStore(root);
  }

  createBook(title, opts) { return this.store.createBook(title, opts); }
  listBooks() { return this.store.listBooks(); }
  getBook(id) { return this.store.getBook(id); }
  deleteBook(id) { return this.store.deleteBook(id); }

  // 加文件并自动抽取文本缓存；同时把文档里的内嵌图**原字节**抽出来（2026-11-20）。
  // 图片抽取失败绝不能挡住资料导入：文本链路是主，图片是增强。
  async addFile(id, buf, meta) {
    const rec = this.store.addFile(id, buf, meta);
    const text = rec.isImage ? '' : await extract.extractText(rec.ext, buf);
    this.store.setFileText(id, rec.id, text == null ? '' : text);
    let imageStats = { added: 0, deduped: 0 };
    try {
      const bookDir = this.store._bookDir(id);
      imageStats = imagesLib.ingest(bookDir, rec.id, rec.name, rec.ext, buf, {
        relPath: path.join('files', fs.readdirSync(path.join(bookDir, 'files')).find((n) => n.startsWith(rec.id + '__')) || ''),
        size: rec.size,
      });
    } catch (e) {
      // 只记到 rec 上，不抛：抽图是增量能力，不能让一份坏 OOXML 毁掉整个导入。
      imageStats.error = String(e.message || e);
    }
    return Object.assign({}, rec, { imageStats });
  }

  // 图片清单与取图（前端看图区 / 分析提示词都走这两个方法，不各读 images.json）
  getImages(id) {
    const book = this.store.getBook(id);
    return book ? imagesLib.loadIndex(this.store._bookDir(id)) : null;
  }
  getImage(id, imageId) {
    const book = this.store.getBook(id);
    return book ? imagesLib.readImage(this.store._bookDir(id), imageId) : null;
  }

  // 让视觉模型真的看一遍本书原图，把「图里是什么」写回 images.json（key 只在 opts.cfg 内存）。
  // 分析时会自动优选用这些描述做「题→图」配对，避免只看图注配错图。
  async describeImages(id, cfg, opts) {
    const book = this.store.getBook(id);
    if (!book) throw new Error('书不存在：' + id);
    return visionLib.describeBook(this.store._bookDir(id), cfg || {}, opts);
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
    // 视觉转录语料（2026-11-22）：图片型资料（理论力学 24 份 PDF 全中）文字层为空，
    // 整书语料必须来自视觉模型逐页转录。有 transcript 的主图按「来源组 → 源文件 → 页号」
    // 聚合拼接：段头【文件：视觉转录·<源名>】，块锚点【页N】（analyze 的 ANCHOR_LINE 原生支持，
    // 不与 PDF 的【P.N】混用），块尾（图id=<imgId>）供 imageIds 白名单与题图关联。
    // 没转录的图不进语料（行为不变，老书零迁移）。
    const bookDir = this.store._bookDir(id);
    const rows = imagesLib.orderedTranscribed(bookDir);
    if (rows.length) {
      const srcKey = (r) => String(r.source.fileName || '').replace(/\s*第\d+页$/, '') || ('图' + r.img.id);
      const ctxKey = (r) => {
        const c = String(r.source.context || '');
        return (c && c.length <= 24) ? c : '';
      };
      const groups = new Map();
      rows.forEach((r) => {
        const gk = ctxKey(r) + '/' + srcKey(r);
        if (!groups.has(gk)) groups.set(gk, { name: srcKey(r), pages: [] });
        groups.get(gk).pages.push({ page: Number(r.source.page) || 0, text: r.text, imgId: r.img.id });
      });
      groups.forEach((g) => {
        parts.push('【文件：视觉转录·' + g.name + '】\n' +
          g.pages.map(p => '【页' + (p.page || 1) + '】（图id=' + p.imgId + '）' + p.text).join('\n'));
      });
    }
    return parts.join('\n\n');
  }

  // 整本书整体分析（只用 LLM）。分析完自动落盘。
  async analyze(id, opts) {
    const book = this.store.getBook(id);
    if (!book) throw new Error('书不存在：' + id);
    const text = this.getBookText(id);
    // F5：把「图片数 / 资料总数」传给分析层，纯图片书才能给出「需视觉模型」而不是空壳分析。
    const files = book.files || [];
    // v4（2026-11-20）：把「原图清单」注入分析。图片本体不进文本语料（不画、不生成），
    // 模型看到的是图 id + 图注 + 上下文 + 出处，用来在题目上标 imageIds 完成「题→图」关联。
    // v5（2026-11-20）：优先喂「视觉模型看图后写下的真内容」，没有视觉理解时才退回图注。
    // 用户要的就是别张冠李戴：模型得看懂图再决定它配哪道题。
    const bookDir = this.store._bookDir(id);
    const imageDescriptions = visionLib.describeForPrompt(bookDir);
    const withStats = Object.assign({}, opts, {
      imageCount: files.filter(f => f.isImage).length,
      embeddedImageCount: imageDescriptions.length,
      imageDescriptions,
      materialCount: files.length,
      // v2：真实文件名清单注入提示词，题目的 source.file 才能回溯到导入的资料。
      files: files.map(f => ({ name: f.name, isImage: !!f.isImage }))
    });
    const result = await analyzeLib.analyze(book.title, text, withStats);
    this.store.saveAnalysis(id, result);
    return result;
  }

  getAnalysis(id) { return this.store.getAnalysis(id); }

  // 资料重点标注：用户不手动分层，语义说明哪个文件是重点（分析时注入提示词）。
  markFile(id, fileId, patchArg) { return this.store.setFileMeta(id, fileId, patchArg); }

  // 整理文档：kind = digest（考点大全）/ syllabus（考纲）。已生成即返回缓存（refresh=true 强制重生成）。
  // 只走大模型：文档的「不落下」是模型职责，本地规则引擎不产出文档，避免假完整。
  async composeDocument(id, kind, opts) {
    const o = opts || {};
    const k = String(kind || '');
    if (!['digest', 'syllabus', 'slides'].includes(k)) {
      throw new Error('未知文档类型：' + kind + '（可用 digest=考点大全 / syllabus=考纲 / slides=考试幻灯片）');
    }
    if (!o.refresh) {
      const cached = this.store.getDocument(id, k);
      if (cached) return cached;
    }
    // 只读缓存（2026-11-21）：打开页签时的「有没有现成的」探测必须走这条。
    // 否则「点开考点大全」= 悄悄发起一次 1-3 分钟的模型调用，用户以为自己只是看了一眼。
    if (o.cachedOnly) return null;
    const book = this.store.getBook(id);
    if (!book) throw new Error('书不存在：' + id);
    const cfg = o.cfg || {};
    if (!cfg.baseURL || !cfg.model) throw new Error('生成整理文档需要模型配置（API 地址 + 模型名）');
    const text = this.getBookText(id);
    const files = (book.files || []).map(f => ({ name: f.name, isImage: !!f.isImage, focus: !!f.focus, note: String(f.note || '') }));
    const doc = await documentsLib.compose({
      title: book.title, fullText: text, files, kind: k, cfg,
      maxTokens: o.maxTokens, timeoutMs: o.timeoutMs,
    });
    this.store.saveDocument(id, k, doc);
    return doc;
  }

  // 已生成的整理文档（只读，不触发生成）。
  getDocument(id, kind) { return this.store.getDocument(id, kind); }

  // ---------- 学习闭环（2026-11-11）：门面方法，DSH / 专家形态直接调这里 ----------
  // 边界（2026-11-11 订正，勿再写「数据层真隐藏」）：getQuiz 返回**脱敏题目**
  // （不含 answer / solution / rationale），提交判分后才在本视图看到答案与解析。
  // 但这只是「练习视图内不渲染」，**不是**「答案未到达客户端」：打开书时
  // /books/:id/analysis 会原样下发完整 analysis.json（含全部答案），题目详情与
  // 「导出 JSON」也可见。本地离线工具的用户本来就能直接读 library/books/*/analysis.json，
  // 不存在对持有者的保密；脱敏 /analysis 会砸掉导图、详情与 5 种导出，属过度设计。

  // 练习列表 + 进度概览。未分析时明确报错，不返回空壳骗前端。
  getQuiz(id, opts) {
    const a = this.store.getAnalysis(id);
    if (!a || !Array.isArray(a.questionIndex)) throw new Error('请先完成整体分析，再开始练习');
    const questions = practiceLib.flatten(a, true);
    // 统计与列表同源：只认当前分析结果里还存在的题目 key（重分析换题后旧卡留作历史，不进统计）。
    const validKeys = new Set(questions.map(q => q.key));
    const state = practiceLib.normalizeState(this.store.getPractice(id));
    const now = (opts && opts.now) || Date.now();
    return { questions, total: questions.length, summary: practiceLib.summarize(state, now, validKeys) };
  }

  // 原始过程状态（供统计 / 调试 / 判别测试跨实例回读）。
  getPractice(id) {
    return practiceLib.normalizeState(this.store.getPractice(id));
  }

  // 题卡只读聚合（2026-11-22）：逐讲批建产物 cards/lesson-NN.json → { lessons, total }。
  // 为什么在这里：core/capabilities.js 已声明 cards→listCards、driver 也在调，
  // 但生产端一度不存在（typeof Core.prototype.listCards === undefined），
  // app-host 分发直接判 unsupported——典型的「消费端写了、生产端没提供」。
  // 契约：只读、不调模型；坏文件单独标注 error 不拖垮整批；文件名白名单防目录穿越；
  // failed.json 是失败台账不是题卡，不进列表。
  listCards(id) {
    const book = this.store.getBook(id);
    if (!book) throw new Error('书不存在：' + id);
    const dir = path.join(this.store._bookDir(id), 'cards');
    let names = [];
    try { names = fs.readdirSync(dir); }
    catch (e) { return { lessons: [], total: 0 }; }
    const lessons = [];
    for (const name of names) {
      const m = /^lesson-(\d+)\.json$/.exec(name);
      if (!m) continue;
      let d;
      try { d = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
      catch (e) {
        lessons.push({ file: name, error: '题卡文件解析失败：' + (e && e.message || e) });
        continue;
      }
      const kps = Array.isArray(d.knowledgePoints) ? d.knowledgePoints : [];
      const cards = kps.reduce((n, kp) => n + (Array.isArray(kp && kp.cards) ? kp.cards.length : 0), 0);
      lessons.push({
        lesson: Number(d.lesson || m[1]),
        seq: d.seq == null ? null : Number(d.seq),
        title: String(d.title || ''),
        date: String(d.date || ''),
        block: String(d.block || ''),
        knowledgePoints: kps.length,
        cards,
        generatedAt: String(d.generatedAt || ''),
        file: name,
      });
    }
    lessons.sort((a, b) => (a.lesson || 0) - (b.lesson || 0));
    return { lessons, total: lessons.reduce((n, l) => n + (l.cards || 0), 0) };
  }

  // 今日到期题目（脱敏）。now 可注入，判别测试不依赖真实时间。
  getDue(id, opts) {
    const a = this.store.getAnalysis(id);
    if (!a || !Array.isArray(a.questionIndex)) return { questions: [], dueCount: 0 };
    const now = (opts && opts.now) || Date.now();
    const state = practiceLib.normalizeState(this.store.getPractice(id));
    const all = practiceLib.flatten(a, true);
    const validKeys = new Set(all.map(q => q.key));
    const keys = practiceLib.dueKeys(state, now, validKeys);
    const set = new Set(keys);
    const questions = all.filter(q => set.has(q.key));
    // 保持 leech 上浮 / 到期先后，不按题目原序打乱。
    questions.sort((x, y) => keys.indexOf(x.key) - keys.indexOf(y.key));
    // dueCount 取自同源的 keys，故恒等于 questions.length（判别测试 J2a 锁住）。
    return { questions, dueCount: keys.length, summary: practiceLib.summarize(state, now, validKeys) };
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
