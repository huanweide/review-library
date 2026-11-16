/**
 * analyze.js —— 天道书院 · 增量分析编排器
 *
 * 一次增量分析 = 抽取新文档文本 → 官方语料/提示词 → LLM 一次调用 → 官方解析 →
 *               用【本轮语料】逐字核验引文 → 写入题的 quoteVerified → 合并进现有书。
 *
 * 复用书馆权威实现：buildMessages（官方提示词+语料）、extractJson（解析）、verifyQuotes（引文核验）。
 * 不复制、不改书馆文件——只读 require。
 */
'use strict';
const path = require('path');
const bookAnalyze = require(path.resolve(__dirname, '../../复习资料图书馆/core/analyze.js'));
const bookExtract = require(path.resolve(__dirname, '../../复习资料图书馆/core/extract.js'));
const llm = require('./llm');
const prompt = require('./prompt');
const merge = require('./merge');

function arr(v) { return Array.isArray(v) ? v : []; }

// 把文件数组抽成带锚点的语料文本（【文件：x】+【块N】），供官方 buildMessages/composeCorpus 解析
async function filesToCorpus(filesWithBuffer) {
  const parts = [];
  const registered = [];
  for (const f of filesWithBuffer) {
    const name = String(f.name || '未命名');
    const isImage = !!f.isImage;
    const meta = { name, isImage, focus: !!f.focus, note: String(f.note || '') };
    if (isImage) { registered.push(meta); continue; } // 图片不抽文本，诚实标注
    let text = '';
    try { text = await bookExtract.extractText(f.ext, f.buffer) || ''; }
    catch (e) { text = ''; }
    if (!text || String(text).trim().length < 10) {
      // 抽取不到文本：仍登记文件，但不塞空语料（避免模型引用不存在的 quote）
      registered.push(meta);
      continue;
    }
    // 用官方 segmentText 切成带【块N】锚点的段，保证 quote 可逐字回溯
    const segs = bookExtract.segmentText(String(text), { source: name });
    const body = segs.map(s => (s.anchor || '【块1】') + String(s.text || '')).join('\n');
    parts.push('【文件：' + name + '】\n' + body);
    registered.push(meta);
  }
  return { corpus: parts.join('\n\n'), files: registered, imageCount: registered.filter(f => f.isImage).length };
}

/**
 * 执行增量分析。
 * @param cfg        LLM 配置 { baseURL, apiKey, model }（只内存）
 * @param bookTitle  书名
 * @param existingBook 现有 bookData
 * @param filesWithBuffer 新增文件 [{name, ext, buffer, isImage, focus, note}]
 * @returns { ok, book, stats, error }
 */
async function analyzeIncremental(cfg, bookTitle, existingBook, filesWithBuffer) {
  const { corpus, files, imageCount } = await filesToCorpus(filesWithBuffer);
  const textFiles = files.filter(f => !f.isImage);
  if (!textFiles.length && imageCount) {
    return { ok: false, error: '新增的都是图片，当前文本模型无法抽取内容。请配置视觉模型或改用文本资料。' };
  }
  if (!String(corpus).trim()) return { ok: false, error: '新增文档没有可抽取的文本（可能是扫描件/空文件）。' };

  // 官方 buildMessages（含官方提示词 + 文件名清单 + 带锚点语料），再前置增量指令
  const messages = prompt.buildMessages(bookTitle, corpus, files, true);
  let raw;
  try {
    const r = await llm.chat(cfg, messages, { json: true, temperature: 0.1, maxTokens: 8192 });
    raw = r.text;
  } catch (e) {
    // 有些服务不支持 response_format=json_object，去掉后重试一次
    try {
      const r2 = await llm.chat(cfg, messages, { json: false, temperature: 0.1, maxTokens: 8192 });
      raw = r2.text;
    } catch (e2) { return { ok: false, error: String(e2.message || e2) }; }
  }

  // 官方解析：严格 JSON → 规范化 tree/questionIndex
  let analysis;
  try {
    const parsed = bookExtractSafeJson(raw);
    analysis = bookAnalyze.validate ? bookAnalyze.validate(parsed) : normalizeMinimal(parsed);
  } catch (e) {
    return { ok: false, error: '模型输出无法解析为合法分析 JSON：' + String(e.message || e).slice(0, 200) };
  }

  // 用【本轮语料】逐字核验引文，写回每题 quoteVerified（不冒用上一轮的核验结果）。
  // 书馆 verifyQuotes 只返回 audit.details[i]（i = 全局题序号），写回在 analyze() 内；
  // 这里按同一展平顺序手工写回，口径与官方逐字一致（found 才算已核）。
  const audit = bookAnalyze.verifyQuotes(analysis, corpus);
  let qi = 0;
  arr(analysis.questionIndex).forEach(g => arr(g.items).forEach(it => arr(it.questions).forEach(q => {
    const d = audit.details && audit.details[qi];
    q.quoteVerified = !!(d && d.found);
    qi++;
  })));

  // 合并进现有书
  const merged = merge.mergeAnalysis(existingBook, analysis, files, {
    mergedQuoteAudit: audit,
    truncated: !!(messages.corpusMeta && messages.corpusMeta.truncated),
    coverage: messages.corpusMeta
  });

  let newQ = 0, newPts = 0;
  try {
    const oldQ = arr(existingBook.tiku).length;
    newQ = Math.max(0, arr(merged.tiku).length - oldQ);
    const oldPts = arr(existingBook.kaogang).length;
    newPts = Math.max(0, arr(merged.kaogang).length - oldPts);
  } catch (e) { /* 统计失败不影响结果 */ }

  return {
    ok: true, book: merged,
    stats: {
      newFiles: files.length, imageCount,
      newQuestions: newQ, newPoints: newPts,
      quoteHit: audit.hit || 0, quoteChecked: audit.checked || 0
    }
  };
}

function bookExtractSafeJson(raw) {
  return bookAnalyze.extractJson(raw);
}
function normalizeMinimal(p) {
  return { tree: p && p.tree || p && p.outline, questionIndex: arr(p && p.questionIndex), summary: String(p && p.summary || '') };
}

module.exports = { analyzeIncremental, filesToCorpus };
