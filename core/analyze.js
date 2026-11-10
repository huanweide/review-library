'use strict';
// 统一核心 · 整本书整体分析（只用 LLM，不分层、不保留离线兜底）。
//
// 输入：整本书全部文件的纯文本拼接 + 导入文件名清单。
// 输出：层级思维导图（章→节→知识点→细分）+ 题型索引（题型→子题型→完整题目）+ 概览 + 统计。
//
// 一次 API：单次 chat 调用产出完整版本（含每道题的题干/答案/分步解答/解题思路/来源）。
// 提示词用「显式数量区间 + 字段硬约束 + 禁止占位 + 文件名清单」把模型从开放作文拉回结构化填空。
//
// LLM 被要求只输出一个严格 JSON；本模块负责解析、校验、规范化，保证前端拿到结构可靠的数据。
//
// 2026-11-09 融合（A→B）：确定性 id + 按 path 精确反查 pointId、MIN_TEXT、MAX_CORPUS、
//   questionTypeCounts、truncated 标记。
// 2026-11-09 v2：题目实体契约 + measureQuality 可测效果指标 + response_format + 输出预算自适应。
const llm = require('../lib/llm');

// 7 类题型（全书的题型只会从这里选）。分类名是 B 的既有契约，DSH/专家与已落盘分析依赖它，勿改。
const QUESTION_TYPES = ['选择题', '填空题', '名词解释', '简答题', '判断题', '计算题', '综合应用题'];
// 整本语料上限：超出截断并在结果里显式标记（诚实标注，不假装无损）。
const MAX_CORPUS = 50000;
// 全书可读文本低于此值视为「几乎无文本」：纯图片/扫描件需视觉模型，短文本需补资料。
const MIN_TEXT = 80;

// 一次 API 的「期望产出区间」：只驱动提示词，引导模型产出数量适中、每题完整的题目。
// 与下面 DEFAULT_THRESHOLDS.maxQuestions 语义不同，两者刻意不相等：
//   提示词上限 = 期望（模型超产几道是常事，不算错）；
//   判据上限   = 防灌水 / 防截断的兜底（质量仪表，不在生产链路阻断）。
// 若把判据上限拟合成单次实测的 24，25 道全部合格的题目会被判「整体失败」，是过拟合。
const Q_RANGE = { min: 8, max: 24 };

// 一次 API 的效果判据（可被 measureQuality 的第三参覆盖，便于小样本判别测试）。
const DEFAULT_THRESHOLDS = {
  minQuestions: Q_RANGE.min, maxQuestions: 60,
  minTypes: 3, minFieldRate: 0.9, minPathRate: 0.7,
  maxPlaceholderRate: 0, minSourceRate: 0.6,
  // v3 新增：真模型 v2 实测「答案只写一个字母」「解题思路一句套话」，结构指标抓不到内容质量。
  minAnswerRichRate: 0.8, minRationaleLen: 30
};

const SYSTEM_PROMPT = `你是一位严谨的学科分析与出题专家。用户会给你一整本书（若干资料文件拼接而成的纯文本）的全部内容。
请对整本书做「整体分析」：不要分层处理单个文件，而是把全书当作一个整体来梳理知识结构，并基于书中真实内容编写可练习的题目。

【本次只调用一次】你必须在这一次回复里输出完整结果，不要分批、不要说「后续补充」、不要只给示例或提纲。

你必须只输出一个 JSON 对象，不要任何解释文字、不要用 markdown 代码块包裹，直接输出 JSON。结构严格如下：

{
  "outline": {
    "title": "全书标题",
    "children": [ /* 章 chapter 数组，2-6 章 */ ]
  },
  "questionIndex": [ /* 全局题型索引，3-7 类 */ ],
  "summary": "全书概览（2-4 句）"
}

【outline 规则：知识结构导图】
- children 是「章 chapter」数组，2-6 章；每章有 title 与 children（「节 section」数组，每章 1-4 节）；
- 每节有 title 与 children（「知识点 point」数组，每节 2-5 个）；
- 每个知识点必须有：title（知识点名称）、desc（一句话说明）、questionTypes（该知识点常考的题型，从下面 7 类里选 1-3 个）、children（「细分 subtype」数组，0-3 个）；
- subtype 有 title 与 desc（细分概念 / 易混点 / 公式 / 特例等），children 为 []；
- 题型只可能是这 7 类：选择题、填空题、名词解释、简答题、判断题、计算题、综合应用题。

【questionIndex 规则：题型分类索引 + 完整题目（本次重点）】
- 对书中确实出现过的题型各给一组 { "type": 题型名, "items": [子题型] }，共 3-7 类；书里没出现的题型不要列，不要硬凑。
- 每个 type 下有 1-3 个子题型；每个子题型形如：
  {
    "title": "子题型名（例如「概念辨析类」「复杂度计算类」「公式应用类」）",
    "path": ["章标题", "节标题", "知识点标题"],
    "questions": [ /* 1-3 道完整题目 */ ]
  }
  path 必须指向 outline 里真实存在的节点（逐字一致），用于题型树回跳知识导图。
- 每个子题型下 1-3 道完整题目；全书题目总数 ${Q_RANGE.min}-${Q_RANGE.max} 道（宁可少而精，不要为凑数写空话）。
- 每道题目必须是完整可做的题，形如：
  {
    "stem": "完整题干（写清条件与所求，不要只写一个考点名）",
    "options": ["A. ...", "B. ..."],
    "answer": "答案（选择题给字母+内容；其它题型给明确结论）",
    "solution": ["第 1 步：...", "第 2 步：...", "第 3 步：..."],
    "rationale": "解题思路：为什么想到这个方法、依据是什么、从哪里入手",
    "pitfalls": "易错点：最容易错在哪、怎么避开",
    "difficulty": "基础 | 进阶 | 挑战",
    "pointPath": ["章标题", "节标题", "知识点标题"],
    "source": { "file": "原文件名", "page": 12, "quote": "书中支撑这道题的原文片段（10-60 字）" }
  }
  · options：选择题 / 判断题必填 2-4 项，其它题型填 []；选项文本要完整（例如 "A. O(1)"），不能只写字母。
  · answer：**必须写「答案内容 + 简要理由」，不能只写一个字母**。选择题写成 "A. O(1) —— 顺序表由首地址加下标可直接算出元素地址"；其它题型写结论加一句依据。
  · solution：2-4 步的分步详细解答，必须能照着一步步做出来，不能只写结论。
  · rationale：**至少 2 句**，必须写清「从题干哪个条件切入」「为什么用这个方法」「常见的错误做法为什么不行」；禁止「直接依据定义判断」「根据题意可得」这类一句套话。
  · pointPath：该题考查的知识点路径，必须指向 outline 里的真实节点；
  · source.file：只能从下面【资料文件清单】里选一个真实文件名；没有页码信息时 page 填 0；
  · stem / answer / solution / rationale 四项都不能为空。

【一道合格题目的示例（照这个颗粒度写，不要照抄内容；示例刻意压成单行，你也必须这样输出）】
{"stem":"长为 10 的顺序表，在第 3 个位置插入一个新元素，需要移动多少个元素？","options":["A. 7 个","B. 8 个","C. 9 个","D. 10 个"],"answer":"B. 8 个 —— 插入位置 i=3，需移动 n-i+1 = 10-3+1 = 8 个元素。","solution":["第 1 步：确定表长 n=10、插入位置 i=3。","第 2 步：套用移动次数公式 n-i+1。","第 3 步：10-3+1=8，因此需要移动 8 个元素。"],"rationale":"题干给的是某个固定位置的插入，所以要用精确公式 n-i+1 而不是平均值 n/2。先辨认问的是精确值还是期望值再选公式；若误用 n/2 会算出 5，这是最常见的错误做法。","pitfalls":"把固定位置的移动次数 n-i+1 与等概率平均移动次数 n/2 混淆。","difficulty":"基础","pointPath":["第一章 线性表","顺序存储","插入与删除"],"source":{"file":"数据结构讲义.pdf","page":3,"quote":"在长度为 n 的顺序表中，在第 i 个位置插入一个元素，共移动 n-i+1 个元素"}}

【输出格式契约（机器判定，不可协商）】
- 首个非空字符必须是 {，最后一个非空字符必须是 }；中间只能是一个 JSON 对象。
- **必须是单行紧凑 JSON：禁止换行、禁止缩进、禁止为美化添加空格**。字符串内部的空格照常保留；JSON 结构之外的空白一律不要。
- 上面示例就是单行紧凑格式，照它的排版输出，不要美化。

【硬性禁止】
- 严禁「略」「待补充」「xxx」「示例题目」「同上」「略去」这类占位内容；不要输出占位符，不要编造书中没有的定理、数据、题目或原文片段。
- 严禁把「考点方向」当成题目：每道题必须有可作答的完整题干。
- 严禁输出解释文字、前言、markdown 代码块或 JSON 以外的任何字符。
- **整个回复只允许出现一个 JSON 对象：最后一个 } 之后立即停止，禁止重复输出第二份 JSON、禁止追加任何总结或说明。**（重复输出会被判为无效结果）
- 严禁 path / pointPath / source.file 指向不存在的内容。

【资料文件清单】（source.file 只能从这里选）
{{FILE_LIST}}

要求：只输出一个合法 JSON 对象；结构完整、层级清晰；题目、答案、分步解答、解题思路必须基于给定资料文本，能回溯到清单里的文件。`;

// 归一化标题用于匹配：去空白 + 小写。
function titleKey(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

// 文件名清单注入提示词：模型只能引用真实存在的文件，来源才可回溯。
function fileListBlock(files) {
  const names = (Array.isArray(files) ? files : [])
    .map(f => String((f && f.name) || '').trim()).filter(Boolean).slice(0, 40);
  return names.length
    ? names.map(n => '- ' + n).join('\n')
    : '- （未登记文件名；source.file 请填「未知」，page 填 0）';
}

// F6：截断在 buildMessages 内完成，保证任何调用方都拿到有上限的语料。
// v2：第三参 files 注入真实文件名清单，让模型把题目来源钉在可回溯的文件上。
function buildMessages(bookTitle, fullText, files) {
  const raw = String(fullText || '');
  const corpus = raw.length > MAX_CORPUS ? raw.slice(0, MAX_CORPUS) : raw;
  const sys = SYSTEM_PROMPT.replace('{{FILE_LIST}}', fileListBlock(files));
  const content = '书名：' + (bookTitle || '未命名书') +
    '\n\n===== 全书内容（已拼接各文件文本）=====\n' + corpus;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: content }
  ];
}

// 容错抽取 JSON：去代码块 → 括号配平取「第一个完整对象」。
// 真模型实测（2026-11-09，DeepSeek-V4.1-Flash）：一次 API 偶尔吐出两个连在一起的 JSON
// 对象（22569 字符，第一个在 22368 处闭合，后面又跟一份）。旧实现用 lastIndexOf('}')
// 会把两份一起送去 parse，报「Unexpected non-whitespace character after JSON」。
// 正确做法是字符串感知的括号配平，只取第一个完整对象；这不是打补丁，是解析契约本身。
function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch (e) { /* continue */ }
  const a = s.indexOf('{');
  if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(a, i + 1)); } catch (e) { return null; }
      }
    }
  }
  return null; // 未闭合（例如被 max_tokens 截断），明确失败而不是吞半截
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

// F1：题型项 / 题目 → 树节点 id。优先按完整 path 精确匹配；退化时按末段标题 + 章标题消歧；
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

// v2：题目实体规范化。四项核心字段允许为空串但保留，由 measureQuality 统计完整率——
// 不能在这里悄悄填默认值，否则效果指标失真（用户要「效果好」而不是「看起来有」）。
function normalizeQuestion(q, idx, seq) {
  if (!q || typeof q !== 'object') return null;
  const stem = String(q.stem || '').trim().slice(0, 1500);
  if (!stem) return null;
  const src = q.source && typeof q.source === 'object' ? q.source : {};
  const page = Number(src.page);
  return {
    id: 'q' + seq.n++,
    stem,
    options: Array.isArray(q.options) ? q.options.map(o => String(o || '').trim().slice(0, 300)).filter(Boolean).slice(0, 8) : [],
    answer: String(q.answer || '').trim().slice(0, 1000),
    solution: Array.isArray(q.solution) ? q.solution.map(s => String(s || '').trim().slice(0, 800)).filter(Boolean).slice(0, 8) : [],
    rationale: String(q.rationale || '').trim().slice(0, 1200),
    pitfalls: String(q.pitfalls || '').trim().slice(0, 800),
    difficulty: ['基础', '进阶', '挑战'].includes(q.difficulty) ? q.difficulty : '基础',
    pointPath: Array.isArray(q.pointPath) ? q.pointPath.map(p => String(p)).slice(0, 6) : [],
    pointId: resolvePointId({ path: q.pointPath }, idx),
    source: {
      file: String(src.file || '').trim().slice(0, 200),
      page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 0,
      quote: String(src.quote || '').trim().slice(0, 300)
    }
  };
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
  const seq = { n: 0 };

  const qIndex = Array.isArray(parsed.questionIndex) ? parsed.questionIndex : [];
  const questionIndex = qIndex
    .filter(q => q && QUESTION_TYPES.includes(q.type))
    .map(q => ({
      type: q.type,
      items: Array.isArray(q.items)
        ? q.items.filter(it => it && it.title).map(it => ({
            title: String(it.title).slice(0, 300),
            path: Array.isArray(it.path) ? it.path.map(p => String(p)).slice(0, 6) : [],
            pointId: resolvePointId(it, idx),
            questions: Array.isArray(it.questions)
              ? it.questions.map(x => normalizeQuestion(x, idx, seq)).filter(Boolean)
              : []
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

  // F8：分题型统计（v2 追加题目总数）
  const questionTypeCounts = {};
  questionIndex.forEach(g => { questionTypeCounts[g.type] = (g.items || []).length; });
  const questionCount = questionIndex.reduce((s, g) =>
    s + (g.items || []).reduce((t, i) => t + (i.questions || []).length, 0), 0);

  const stats = {
    chapters, sections, points, subtypes,
    questionTypes: questionIndex.length,
    questionTypeCounts,
    questionCount,
    analyzedAt: new Date().toISOString()
  };
  return { tree: root, questionIndex, summary: String(parsed.summary || '').slice(0, 800), stats };
}

// v2：「一次 API 效果好不好」的外部判据。全部是可计算的数字，不依赖主观自评。
// 第三参可覆盖阈值（小样本判别测试传宽松值；真模型验证用默认严格值）。
function measureQuality(result, files, thresholds) {
  const T = Object.assign({}, DEFAULT_THRESHOLDS, thresholds || {});
  const names = (Array.isArray(files) ? files : [])
    .map(f => String((f && f.name) || '').trim()).filter(Boolean);
  const groups = (result && Array.isArray(result.questionIndex)) ? result.questionIndex : [];
  const qs = groups.reduce((a, g) => a.concat((g.items || []).reduce((b, i) => b.concat(i.questions || []), [])), []);
  const fieldOk = q => !!(q.stem && q.answer && Array.isArray(q.solution) && q.solution.length && q.rationale);
  const placeholder = /^(略|无|待补充|同上)$|xxx|示例题目|TODO|N\/A|略去|此处填/i;
  const placeholderCount = qs.filter(q => placeholder.test([q.stem, q.answer, (q.solution || []).join(' '), q.rationale].join(' '))).length;
  const pathTotal = qs.filter(q => Array.isArray(q.pointPath) && q.pointPath.length).length;
  const pathHit = qs.filter(q => q.pointId).length;
  const sourceOk = qs.filter(q => q.source && q.source.file && (!names.length || names.includes(q.source.file))).length;
  // 内容质量：答案不能只写一个字母；解题思路不能是一句套话。
  const answerRich = qs.filter(q => q.answer && !/^[A-Da-d]$/.test(String(q.answer).trim())).length;
  const rationaleAvg = qs.length
    ? qs.reduce((s, q) => s + String(q.rationale || '').replace(/^解题思路[：:]\s*/, '').length, 0) / qs.length : 0;

  const m = {
    jsonParsed: !!(result && result.tree && result.tree.children),
    fieldCompleteRate: qs.length ? qs.filter(fieldOk).length / qs.length : 0,
    questionCount: qs.length,
    typeCoverage: groups.length,
    pathHitRate: pathTotal ? pathHit / pathTotal : 0,
    placeholderRate: qs.length ? placeholderCount / qs.length : 0,
    sourceHitRate: qs.length ? sourceOk / qs.length : 0,
    answerRichRate: qs.length ? answerRich / qs.length : 0,
    rationaleAvgLen: Math.round(rationaleAvg)
  };
  m.checks = {
    jsonParsed: m.jsonParsed,
    fieldCompleteRate: m.fieldCompleteRate >= T.minFieldRate,
    questionCount: m.questionCount >= T.minQuestions && m.questionCount <= T.maxQuestions,
    typeCoverage: m.typeCoverage >= T.minTypes,
    pathHitRate: m.pathHitRate >= T.minPathRate,
    placeholderRate: m.placeholderRate <= T.maxPlaceholderRate,
    sourceHitRate: m.sourceHitRate >= T.minSourceRate,
    answerRichRate: m.answerRichRate >= T.minAnswerRichRate,
    rationaleDepth: m.rationaleAvgLen >= T.minRationaleLen
  };
  m.passed = Object.keys(m.checks).every(k => m.checks[k]);
  m.thresholds = T;
  return m;
}

// chatFn 可注入（self-test mock）；默认 lib/llm.chat。cfg 只在内存，不落盘。
// F5：可读文本过少 / 纯图片书明确失败（带 userCode），不静默交给 LLM 产出空壳分析。
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
  const messages = buildMessages(bookTitle, raw, o.files);
  // v2：一次 API 要装下 Q_RANGE.min-Q_RANGE.max 道带分步解答的题。按真模型实测 p95 完成长度加 ~25% headroom
  // （外查基准：finish_reason=length 不得解析半截 JSON，预算按实测而非猜测）。
  const budget = Math.min(32000, 24000 + Math.round(raw.length / 8));
  const response = await chatFn(o.cfg, messages, {
    temperature: typeof o.temperature === 'number' ? o.temperature : 0.2,
    maxTokens: o.maxTokens || budget,
    timeoutMs: o.timeoutMs || 180000,
    responseFormat: 'json_object'
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
  analyze, validate, extractJson, buildMessages, measureQuality,
  SYSTEM_PROMPT, DEFAULT_THRESHOLDS,
  QUESTION_TYPES, MAX_CORPUS, MIN_TEXT
};
