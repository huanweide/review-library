'use strict';
// 统一核心 · 整本书整体分析（只用 LLM，不分层、不保留离线兜底）。
//
// 输入：整本书全部文件的纯文本拼接。
// 输出：层级思维导图（章→节→知识点→细分）+ 全局题型索引 + 概览 + 统计。
//
// LLM 被要求只输出一个严格 JSON；本模块负责解析、校验、规范化，保证前端拿到的是结构可靠的数据。
//
// 2026-11-09 融合（工作区副本 A 的能力，逐项适配进 B 的 Core 契约，不复制 A 的 core/）：
//   F1 确定性节点 id + 按 path 精确反查 pointId（同名知识点可消歧）
//   F5 可读文本过少 / 纯图片书 → 带 code 的友好报错，不静默空分析
//   F6 语料上限 MAX_CORPUS + truncated / sourceLen 标记
//   F8 stats.questionTypeCounts 分题型统计
const llm = require('../lib/llm');

// 7 类题型（全书的题型只会从这里选）。分类名是 B 的既有契约，DSH/专家与已落盘分析依赖它，勿改。
const QUESTION_TYPES = ['选择题', '填空题', '名词解释', '简答题', '判断题', '计算题', '综合应用题'];
// 整本语料上限：超出截断并在结果里显式标记（诚实标注，不假装无损）。
const MAX_CORPUS = 50000;
// 全书可读文本低于此值视为「几乎无文本」：纯图片/扫描件需视觉模型，短文本需补资料。
const MIN_TEXT = 80;

const SYSTEM_PROMPT = `你是一位严谨的学科分析与出题专家。用户会给你一整本书（若干资料文件拼接而成的纯文本）的全部内容。
请对整本书做「整体分析」：不要分层处理单个文件，而是把全书当作一个整体来梳理知识结构。

你必须只输出一个 JSON 对象，不要任何解释文字、不要用 markdown 代码块包裹，直接输出 JSON。结构严格如下：

{
  "outline": {
    "title": "全书标题",
    "children": [ /* 章(chapter) 数组 */ ]
  },
  "questionIndex": [ /* 全局题型索引 */ ],
  "summary": "全书概览（2-4 句）"
}

规则：
- outline.children 是「章 chapter」数组；每章有 title 与 children（「节 section」数组）；
- 每节有 title 与 children（「知识点 point」数组）；
- 每个知识点 point 必须有：title（知识点名称）、desc（一句话说明）、questionTypes（该知识点常考的题型，从下面 7 类里选，可多选）、children（「细分 subtype」数组，可空 []）；
- subtype 有 title 与 desc（细分概念 / 易混点 / 公式 / 特例等），children 为 []；
- 题型只可能是这 7 类：选择题、填空题、名词解释、简答题、判断题、计算题、综合应用题；
- questionIndex 是全局题型索引：对每一种在书中确实出现过的题型，给出 items 数组；每个 item 形如 { "title": "考点/题目方向简述", "path": ["章标题","节标题","知识点标题"] }，path 必须指向 outline 里真实存在的节点；书里没出现的题型不要列。

要求：结构完整、层级清晰、知识点细分到位；path 必须能在 outline 中对应到真实节点；不要编造书中没有的内容。`;

// 归一化标题用于匹配：去空白 + 小写。
function titleKey(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

// F6：截断在 buildMessages 内完成，保证任何调用方都拿到有上限的语料。
function buildMessages(bookTitle, fullText) {
  const raw = String(fullText || '');
  const corpus = raw.length > MAX_CORPUS ? raw.slice(0, MAX_CORPUS) : raw;
  const content = '书名：' + (bookTitle || '未命名书') +
    '\n\n===== 全书内容（已拼接各文件文本）=====\n' + corpus;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: content }
  ];
}

// 容错抽取 JSON：去代码块、截首尾 {}。
function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch (e) { /* continue */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* continue */ }
  }
  return null;
}

// F1：节点 id 改为确定性（深度优先序号），同书两次分析产生完全相同的 id 序列。
function assignIds(root) {
  let counter = 0;
  (function walk(node, depth) {
    if (!node || typeof node !== 'object') return;
    node.id = 'n' + depth + '_' + (counter++);
    (node.children || []).forEach((c) => walk(c, depth + 1));
  })(root, 0);
  return root;
}

// F1：建两张索引——完整路径 → id；标题 → 候选列表（带所属章标题，供重名消歧）。
function buildNodeIndex(root) {
  const byPath = {};
  const byTitle = {};
  (function walk(node, depth, trail, chapterTitle) {
    if (!node || typeof node !== 'object') return;
    const title = node.title || '';
    const cur = trail.concat(title);
    if (depth > 0) {
      byPath[cur.map(titleKey).join('/')] = node.id;
      const tk = titleKey(title);
      if (tk) (byTitle[tk] = byTitle[tk] || []).push({ id: node.id, chapter: titleKey(chapterTitle || '') });
    }
    const nextChapter = node.type === 'chapter' ? title : chapterTitle;
    (node.children || []).forEach((c) => walk(c, depth + 1, cur, nextChapter));
  })(root, 0, [], '');
  return { byPath, byTitle };
}

// F1：题型项 → 树节点 id。优先按完整 path 精确匹配；退化时按末段标题 + 章标题消歧；
// 仍不唯一则返回 null（前端按标题回退），绝不把重名知识点指到错误节点。
function resolvePointId(it, idx) {
  const p = Array.isArray(it.path) ? it.path.filter(Boolean) : [];
  if (p.length) {
    const hit = idx.byPath[p.map(titleKey).join('/')];
    if (hit) return hit;
    const candidates = idx.byTitle[titleKey(p[p.length - 1])] || [];
    if (candidates.length === 1) return candidates[0].id;
    if (candidates.length > 1 && p.length > 1) {
      const narrowed = candidates.filter((c) => c.chapter === titleKey(p[0]));
      if (narrowed.length === 1) return narrowed[0].id;
    }
    return null;
  }
  const candidates = idx.byTitle[titleKey(it.title)] || [];
  return candidates.length === 1 ? candidates[0].id : null;
}

function normalizeNode(node, type) {
  if (!node || typeof node !== 'object') return null;
  const out = {
    id: 'pending', // validate() 统一替换为确定性 id
    type,
    title: String(node.title || '未命名').slice(0, 200),
    children: []
  };
  if (type === 'point') {
    out.desc = String(node.desc || '').slice(0, 600);
    const qt = Array.isArray(node.questionTypes) ? node.questionTypes : [];
    out.questionTypes = qt.filter(q => QUESTION_TYPES.includes(q));
  }
  if (type === 'subtype') {
    out.desc = String(node.desc || '').slice(0, 600);
  }
  if (Array.isArray(node.children)) {
    const childType = type === 'chapter' ? 'section' : type === 'section' ? 'point' : 'subtype';
    out.children = node.children.map(c => normalizeNode(c, childType)).filter(Boolean);
  }
  return out;
}

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('分析结果不是合法 JSON 对象');
  const outline = parsed.outline || {};
  if (!Array.isArray(outline.children)) throw new Error('outline.children 缺失或非数组');
  const root = {
    id: 'pending',
    type: 'root',
    title: String(outline.title || '全书知识结构').slice(0, 200),
    children: outline.children.map(c => normalizeNode(c, 'chapter')).filter(Boolean)
  };
  if (!root.children.length) throw new Error('思维导图为空（没有章）');

  // F1：确定性 id + 建索引
  assignIds(root);
  const idx = buildNodeIndex(root);

  const qIndex = Array.isArray(parsed.questionIndex) ? parsed.questionIndex : [];
  const questionIndex = qIndex
    .filter(q => q && QUESTION_TYPES.includes(q.type))
    .map(q => ({
      type: q.type,
      items: Array.isArray(q.items)
        ? q.items.filter(it => it && it.title).map(it => ({
            title: String(it.title).slice(0, 300),
            path: Array.isArray(it.path) ? it.path.map(p => String(p)).slice(0, 6) : [],
            pointId: resolvePointId(it, idx)
          }))
        : []
    }));

  let chapters = 0, sections = 0, points = 0, subtypes = 0;
  (function walk(ns) {
    ns.forEach(n => {
      if (n.type === 'chapter') chapters++;
      else if (n.type === 'section') sections++;
      else if (n.type === 'point') points++;
      else if (n.type === 'subtype') subtypes++;
      if (n.children && n.children.length) walk(n.children);
    });
  })(root.children);

  // F8：分题型统计
  const questionTypeCounts = {};
  questionIndex.forEach(g => { questionTypeCounts[g.type] = (g.items || []).length; });

  const stats = {
    chapters, sections, points, subtypes,
    questionTypes: questionIndex.length,
    questionTypeCounts,
    analyzedAt: new Date().toISOString()
  };
  return { tree: root, questionIndex, summary: String(parsed.summary || '').slice(0, 800), stats };
}

// chatFn 可注入（self-test mock）；默认 lib/llm.chat。cfg 只在内存，不落盘。
// F5：可读文本过少 / 纯图片书明确失败（带 code），不静默交给 LLM 产出空壳分析。
async function analyze(bookTitle, fullText, opts) {
  const o = opts || {};
  const chatFn = o.chat || llm.chat;
  const raw = String(fullText || '');
  const len = raw.trim().length;
  // 注意：用 userCode 而非 code。core/request.js 的 isInternal() 以 e.code 判定
  // 「Node 系统/IO 异常 → 500」，业务错误若占用 e.code 会被误判成 500。
  if (len === 0) {
    const e = new Error('全书文本为空，无法分析（可能资料都是图片/扫描件，暂不支持离线 OCR）');
    e.userCode = 'EMPTY_TEXT';
    throw e;
  }
  if (len < MIN_TEXT) {
    const imageCount = Number(o.imageCount) || 0;
    const materialCount = Number(o.materialCount) || 0;
    const e = imageCount > 0
      ? new Error('本书几乎无可读文本（' + imageCount + ' 份图片资料、共 ' + materialCount + ' 份资料，仅 ' + len + ' 字文本）。请先在设置中开启并验证「视觉模型」，或上传带文字的 PDF/文档。')
      : new Error('本书可读文本过少（仅 ' + len + ' 字），无法整体分析。请补充带正文的资料。');
    e.userCode = imageCount > 0 ? 'NEEDS_VISION' : 'TOO_LITTLE_TEXT';
    throw e;
  }
  const messages = buildMessages(bookTitle, raw);
  const response = await chatFn(o.cfg, messages, {
    temperature: typeof o.temperature === 'number' ? o.temperature : 0.2,
    maxTokens: o.maxTokens || 8000,
    timeoutMs: o.timeoutMs || 180000
  });
  const parsed = extractJson(response);
  if (!parsed) throw new Error('模型未返回可解析的 JSON（请检查模型输出格式或换模型）');
  const result = validate(parsed);
  result.model = (o.cfg && o.cfg.model) || '';
  // F6：截断标记与原始字数，供概览页诚实显示
  result.truncated = len > MAX_CORPUS;
  result.sourceLen = len;
  result.corpusLen = messages[1].content.length;
  result.imageCount = Number(o.imageCount) || 0;
  result.materialCount = Number(o.materialCount) || 0;
  return result;
}

module.exports = {
  analyze, validate, extractJson, buildMessages,
  QUESTION_TYPES, MAX_CORPUS, MIN_TEXT
};
