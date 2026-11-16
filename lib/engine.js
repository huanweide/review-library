/**
 * engine.js —— 天道书院 · 端到端复用书馆的能力引擎（单一门面）
 *
 * 用户要求：资源全部复用、端到端抄书馆架构、不重复造轮子。
 * 本文件把书馆的 5 个权威能力串成一层门面，天道书院只写"编排"，不重写算法：
 *   - extract      → 书馆 core/extract.js（pdf/ppt/word/txt/md/图片，逐页锚点）
 *   - analyze      → 书馆 core/analyze.js 的 analyze()（内部 buildMessages+chat+validate+verifyQuotes）
 *   - documents    → 书馆 core/documents.js 的 KINDS 官方提示词（绕过其 compose() 的 corpus object bug）
 *   - practice     → 书馆 core/practice.js 的 flatten/findQuestion/gradeOne（从知识点大全的题选题）
 *   - capabilities → 书馆 core/capabilities.js（能力清单单一真源）
 *
 * 对书馆只有两处"必要修正"，且不改书馆文件（自有资产有 24/24 门禁）：
 *   ① extract.segmentText 必须传 ext，否则 PDF 的 [[PAGE:N]] 页锚点会退化成【块N】；
 *   ② documents.compose() 把 composeCorpus() 的对象当字符串拼 → 模型看不到正文，
 *      这里直接用官方 KINDS[kind].system + 正确 .corpus 字符串，校验仍走官方 verifyQuotes。
 */
'use strict';
const path = require('path');
const ROOT_LIB = path.resolve(__dirname, '../../复习资料图书馆');
const bookExtract = require(path.join(ROOT_LIB, 'core/extract.js'));
const bookAnalyze = require(path.join(ROOT_LIB, 'core/analyze.js'));
const bookDocs = require(path.join(ROOT_LIB, 'core/documents.js'));
const bookPractice = require(path.join(ROOT_LIB, 'core/practice.js'));
const bookCaps = require(path.join(ROOT_LIB, 'core/capabilities.js'));
const llm = require('./llm');         // 济南自研零依赖转发（scrub 脱敏），不跨项目 require 书馆 llm
const merge = require('./merge');
const adapter = require('../assets/js/adapter');

function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

// 分析目标：两个核心产物（用户定义）。导图是知识点大全的视图，不单列产物。
const TARGETS = {
  knowledge: { id: 'knowledge', label: '知识点大全（知识点 + 题型整理）' },
  syllabus:  { id: 'syllabus',  label: '考纲/考点（重点至上 + 解释 + 重点记忆）' },
};
const ALL_TARGETS = Object.keys(TARGETS);
function normalizeTargets(input) {
  const a = arr(input).map(String);
  if (!a.length || a.includes('all') || a.includes('全选')) return ALL_TARGETS.slice();
  return ALL_TARGETS.filter(t => a.includes(t)); // 只认白名单，非法目标忽略
}

/**
 * 抽取一批文件为「带锚点的全书语料」——完全复用书馆 extract，
 * 关键：segmentText 传 ext，保住 PDF【P.N】页锚点（书馆 v3 契约）。
 */
async function filesToCorpus(filesWithBuffer) {
  const parts = [];
  const registered = [];
  let imageCount = 0, noText = [];
  for (const f of filesWithBuffer) {
    const name = String(f.name || '未命名');
    const ext = String(f.ext || (name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.')) : ''));
    const isImage = !!f.isImage || bookExtract.isImageExt(ext);
    const meta = { name, ext, isImage, focus: !!f.focus, note: String(f.note || '') };
    if (isImage) { imageCount++; registered.push(meta); continue; }
    let text = '';
    try { text = await bookExtract.extractText(ext, f.buffer) || ''; }
    catch (e) { text = ''; }
    if (!String(text).trim()) { noText.push(name); registered.push(meta); continue; }
    // 修正①：传 ext，PDF 才能拿到【P.N】真页码锚点
    const segs = bookExtract.segmentText(String(text), { source: name, ext });
    const body = segs.map(s => (s.anchor || '【块1】') + String(s.text || '')).join('\n');
    parts.push('【文件：' + name + '】\n' + body);
    registered.push(meta);
  }
  return { corpus: parts.join('\n\n'), files: registered, imageCount, noText };
}

// 用书馆官方 chat 注入 analyze（cfg 只在内存，key 经 llm.scrub 脱敏不落盘）
// 关键：书馆 analyze() 期望 chatFn 返回「字符串 content」（它自己 extractJson），
// 而本项目的 llm.chat 返回 {text,usage} 对象——必须取 .text，否则解析成 "[object Object]" 失败。
function makeChat(cfg) {
  return async (cfg2, messages, opts) => {
    const r = await llm.chat(cfg, messages, opts);
    return r.text;
  };
}

/**
 * 生成考纲/考点——复用书馆 documents.KINDS.syllabus 官方提示词，
 * 绕过其 compose() 把 composeCorpus() 对象当字符串的 bug（修正②）。
 * 引文核用书馆官方 verifyQuotes（same 口径，不重写）。
 */
async function composeSyllabus(cfg, title, fullText, files) {
  const spec = bookDocs.KINDS.syllabus;
  const composed = bookAnalyze.composeCorpus(String(fullText || ''), bookAnalyze.MAX_CORPUS);
  const corpusText = composed.corpus; // 修正②：取 .corpus 字符串，而不是整个对象
  const fileList = arr(files).map(f => {
    let line = '- ' + String(f.name || '');
    if (f.isImage) line += '（图片资料，正文不含其内容）';
    if (f.focus) line += '【用户重点★】';
    if (f.note) line += '（用户说明：' + String(f.note).slice(0, 120) + '）';
    return line;
  }).join('\n') || '- （未登记文件名）';
  const messages = [
    { role: 'system', content: spec.system },
    { role: 'user', content: '书名：' + String(title || '') + '\n\n【资料文件清单】\n' + fileList + '\n\n【全书正文】\n' + corpusText }
  ];
  const resp = await llm.chat(cfg, messages, { temperature: 0.2, maxTokens: 8000, json: true, timeoutMs: 300000 });
  const text = resp.text; // llm.chat 返回 {text,usage}，extractJson 要的是纯字符串
  const parsed = bookAnalyze.extractJson(text);
  if (!parsed || !Array.isArray(parsed.sections)) throw new Error('考纲生成失败：模型未返回合法 JSON');
  // 规范化 + 逐字引文核验（复用官方）
  const sections = parsed.sections.map(sec => {
    const s = obj(sec);
    return {
      rank: s.rank == null ? 0 : s.rank,
      chapter: String(s.chapter || ''),
      why: String(s.why || ''),
      points: arr(s.points).map(p => {
        const q = obj(p);
        return {
          title: String(q.title || ''), must: String(q.must || ''),
          formulas: arr(q.formulas).map(String),
          importance: String(q.importance || ''),
          question: q.question && typeof q.question === 'object'
            ? { stem: String(obj(q.question).stem || ''), answer: String(obj(q.question).answer || ''), steps: arr(obj(q.question).steps).map(String) }
            : String(q.question || ''),
          quote: String(q.quote || ''), source: String(q.source || '')
        };
      })
    };
  }).sort((a, b) => (a.rank || 999) - (b.rank || 999));
  // 用书馆官方 verifyQuotes 跑一遍考纲的 quote（构造兼容结构）
  const flat = [];
  sections.forEach((s, si) => s.points.forEach((p, pi) => flat.push({
    id: 'syl-' + si + '-' + pi, source: { quote: p.quote, file: p.source }, stem: p.title
  })));
  const audit = bookAnalyze.verifyQuotes({ questionIndex: [{ type: '考纲', items: [{ questions: flat }] }] }, corpusText);
  flat.forEach((q, i) => { const d = audit.details && audit.details[i]; q.quoteVerified = !!(d && d.found); });
  let k = 0;
  sections.forEach(s => s.points.forEach(p => { p.quoteVerified = !!(flat[k++] && flat[k - 1].quoteVerified); }));
  return {
    kind: 'syllabus', generatedAt: new Date().toISOString(), model: String(cfg.model || ''),
    sections, stats: { sections: sections.length, points: flat.length, quoteHit: audit.hit || 0, quoteChecked: audit.checked || 0 },
    corpusMeta: { truncated: composed.truncated, keptChars: composed.keptChars, totalChars: composed.totalChars }
  };
}

/**
 * 增量分析主入口（端到端复用书馆 analyze）。
 * @returns { ok, book, stats, error }
 */
async function analyzeIncremental(cfg, bookTitle, existingBook, filesWithBuffer, targets) {
  const wanted = normalizeTargets(targets);
  const extracted = await filesToCorpus(filesWithBuffer);
  if (!String(extracted.corpus).trim()) {
    return { ok: false, error: extracted.imageCount
      ? '新增的都是图片，当前文本模型无法读图。请上传带正文的 PDF/Word/PPT，或配置视觉模型。'
      : '新增文档没有可抽取的文本（可能是扫描件/空文件）。' };
  }

  let analysis = null;
  if (wanted.includes('knowledge')) {
    // 端到端复用书馆 analyze()：它内部 run buildMessages + chat + validate + verifyQuotes
    analysis = await bookAnalyze.analyze(bookTitle, extracted.corpus, {
      cfg, chat: makeChat(cfg), files: extracted.files,
      imageCount: extracted.imageCount, materialCount: extracted.files.length,
      temperature: 0.1
    });
  }

  // 合并：有序合并 tree+questionIndex → 重跑 adapter（保旧 id / 旧编号）
  const merged = merge.mergeAnalysis(existingBook, analysis || { tree: (existingBook.mindmap||{}).tree, questionIndex: (existingBook._trace||{}).questionIndex || [], summary: '' }, extracted.files, {
    mergedQuoteAudit: analysis ? analysis.quoteAudit : (existingBook._trace || {}).quoteAudit,
    truncated: !!(analysis && analysis.truncated),
    coverage: analysis ? analysis.corpusCoverage : null,
    noText: extracted.noText
  });

  // 考纲：按 target 生成，写进 examOutline（真 LLM 产物，不是降级派生）
  let syllabusInfo = null;
  if (wanted.includes('syllabus')) {
    try {
      const syl = await composeSyllabus(cfg, bookTitle, extracted.corpus, extracted.files);
      merged.examOutline = syl;
      syllabusInfo = syl.stats;
    } catch (e) { syllabusInfo = { error: String(e.message || e).slice(0, 120) }; }
  } else if (existingBook.examOutline) {
    merged.examOutline = existingBook.examOutline; // 未选考纲：保留旧的，不误删
  }

  let newQ = 0, newPts = 0;
  try {
    newQ = Math.max(0, arr(merged.tiku).length - arr(existingBook.tiku).length);
    newPts = Math.max(0, arr(merged.kaogang).length - arr(existingBook.kaogang).length);
  } catch (e) {}
  merged._trace.targets = wanted;
  merged._trace.engine = '书馆 core 端到端复用';
  return {
    ok: true, book: merged,
    stats: {
      targets: wanted, newFiles: extracted.files.length, imageCount: extracted.imageCount,
      newQuestions: newQ, newPoints: newPts,
      quoteHit: analysis && analysis.quoteAudit ? analysis.quoteAudit.hit : 0,
      quoteChecked: analysis && analysis.quoteAudit ? analysis.quoteAudit.checked : 0,
      noText: extracted.noText, syllabus: syllabusInfo
    }
  };
}

/**
 * 从知识点大全选题——复用书馆 practice.flatten/findQuestion/gradeOne。
 * book.tiku/tikuAns 已由 adapter 从 questionIndex 拆出；这里组织成书馆 practice 能吃的 analysis 结构。
 */
function practiceView(book) {
  const qIndex = (book._trace && book._trace.questionIndex) || [];
  const analysis = { questionIndex: qIndex };
  const publicQ = bookPractice.flatten(analysis, true);
  return { questions: publicQ, count: publicQ.length };
}
function findQuestion(book, key) { return bookPractice.findQuestion({ questionIndex: (book._trace && book._trace.questionIndex) || [] }, key); }
function gradeOne(q, type, given) { return bookPractice.gradeOne(q, type, given); }

module.exports = {
  TARGETS, ALL_TARGETS, normalizeTargets, filesToCorpus, composeSyllabus,
  analyzeIncremental, practiceView, findQuestion, gradeOne,
  // 暴露书馆能力供测试/其他模块复用，避免各处再 require 书馆路径
  lib: { extract: bookExtract, analyze: bookAnalyze, documents: bookDocs, practice: bookPractice, capabilities: bookCaps }
};
