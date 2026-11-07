'use strict';
// 分析与出题统一引擎（纯 Node）。
// 融合 ko-lesson 的四条：① 分析前先列材料边界 ② 来源依据 / AI补充 强制双标
// ③ 试卷与答案分离 ④ 批改后只针对薄弱点出巩固卷。
// 两种引擎（local 规则抽取 / llm 用户自填 API）吐同一种结果格式，前端不分辨。
const crypto = require('crypto');
const insight = require('./insight');
const llm = require('./llm');
const syllabus = require('./syllabus');
const srs = require('./srs');

const TYPES = ['single', 'multiple', 'explain', 'case', 'fill', 'judge', 'essay', 'calc'];
const TYPE_LABEL = { single: '单选题', multiple: '多选题', explain: '概念解释题', case: '综合应用题', fill: '填空题', judge: '判断题', essay: '简答题', calc: '计算题', gap: '待补充题型' };
const MASTERY = ['未接触', '能听懂', '能复述', '能做题', '能应用', '能迁移'];
const CAUSES = ['前置知识缺失', '术语不理解', '公式不会用', '只会背不会解释', '会看不会做', '英文题干看不懂', '概念混淆', '应用场景不清楚'];
const AI_NOTE = '材料未直接覆盖，以下为 AI 补充';

const uid = p => p + crypto.randomBytes(5).toString('hex');
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- 材料边界清单 ----------
// 分析之前先说清「读了哪些、各自干什么、明确排除哪些」，对齐 ko-lesson 课程材料记录。
function boundary(store, bookId, selectedIds) {
  const book = store.getBook(bookId);
  const all = (book && book.materials) || [];
  const picked = Array.isArray(selectedIds) && selectedIds.length
    ? all.filter(m => selectedIds.includes(m.id)) : all;
  const included = picked.map(m => ({
    id: m.id, name: m.name, layer: m.layer, ext: m.ext || '', size: m.size || 0,
    role: m.layer === 1 ? '核心提纲 / 划定考试范围' : m.layer === 2 ? '作业与练习 / 认题型' : '补充材料 / 案例与拓展',
    source: m.source || 'user', prompt: m.prompt || ''
  }));
  const excluded = all.filter(m => !picked.includes(m)).map(m => ({ id: m.id, name: m.name, reason: '用户未纳入本次分析' }));
  return { included, excluded, total: all.length };
}

// ---------- 抽文本 ----------
function readTexts(store, bookId, included) {
  const out = [];
  included.forEach(m => {
    try {
      const r = store.readMaterial(bookId, m.id);
      const buf = Buffer.from(r.data || '', 'base64');
      // 优先用入库时已抽好的文字（PDF 渲染进程抽取的结果），其次走通用抽取；都无则跳过。
      const txt = (r.extractedText && r.extractedText.trim()) || insight.extractText(m.ext, buf) || '';
      if (txt.trim()) out.push({ id: m.id, name: m.name, layer: m.layer, text: txt.replace(/\s+/g, ' ').trim() });
    } catch (e) { /* 不可抽文本的资料跳过，边界清单里仍列着，不假装读过 */ }
  });
  return out;
}

function splitFragments(text) {
  return String(text || '').split(/[。；;！!？?\n]+/)
    .map(s => clip(s, 160)).filter(s => s.length >= 12 && s.length <= 160);
}

function pickTerms(text) {
  const cn = text.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
  const en = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || [];
  const seen = new Set();
  return cn.concat(en).filter(t => {
    if (seen.has(t) || /^[\d\s]+$/.test(t)) return false;
    seen.add(t); return true;
  });
}

// ---------- v0.5 分层去重 ----------
// 依据：DejaText「SHA256 精确指纹 + 近似 Jaccard」、LobeHub Content Deduplication
// 「归一化 → 指纹 O(1) → 字符 bigram Jaccard → 可配阈值 → 返回重复对、不静默删」。
// 题量上限 60，无需 MinHash/LSH，直接两两算 Jaccard 即可。
function normStem(s) {
  return String(s || '')
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角转半角
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, ''); // 去空白 / 标点 / 符号
}
function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  if (!set.size && s.length) set.add(s);
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach(x => { if (b.has(x)) inter++; });
  return inter / (a.size + b.size - inter);
}
function dedupeQuestions(questions, opts) {
  const o = opts || {};
  const threshold = typeof o.threshold === 'number' ? Math.max(0, Math.min(1, o.threshold)) : 0.82;
  const list = Array.isArray(questions) ? questions : [];
  const kept = [], removed = [], exact = new Map(), sigs = [];
  list.forEach(item => {
    const q = item || {};
    const stem = normStem(q.stem);
    if (!stem) { removed.push({ keptId: null, removedId: q.id, score: 1, kind: 'empty', stem: q.stem || '' }); return; }
    const fp = crypto.createHash('sha256').update(stem).digest('hex');
    if (exact.has(fp)) {
      removed.push({ keptId: exact.get(fp), removedId: q.id, score: 1, kind: 'exact', stem: q.stem });
      return;
    }
    const bg = bigrams(stem);
    let near = null;
    for (let i = 0; i < sigs.length; i++) {
      const s = jaccard(bg, sigs[i].bg);
      if (s >= threshold) { near = { keptId: sigs[i].id, score: s }; break; }
    }
    if (near) {
      removed.push({ keptId: near.keptId, removedId: q.id, score: Number(near.score.toFixed(3)), kind: 'near', stem: q.stem });
      return;
    }
    exact.set(fp, q.id);
    sigs.push({ id: q.id, bg });
    kept.push(q);
  });
  return { questions: kept, removed, threshold, before: list.length, after: kept.length };
}

// ---------- v0.5 本地可执行校验器 ----------
// 依据：CRITIC / Huang et al. ICLR 2024 —— 没有外部反馈的模型自评不可靠。
// 所以校验器只判「关于草稿本身的结构事实」（Agent Reflection 信号源表里的 High 档），
// 不让模型回答「你有没有编造」。这不是语义 Faithfulness，限制已写入 KNOWN-LIMITATION。
function nameInBoundary(file, bd) {
  const f = String(file || '').trim();
  if (!f) return false;
  const names = ((bd && bd.included) || []).map(m => String(m.name || '')).filter(Boolean);
  const bare = s => s.replace(/\.[^.]+$/, '');
  return names.some(n => n === f || bare(n) === bare(f) || f.includes(n) || (f.length >= 4 && n.includes(f)));
}
function validateGeneration(analysis, bd) {
  const issues = [];
  let checked = 0;
  const pts = (analysis && analysis.points) || [];
  const qs = (analysis && analysis.questions) || [];
  const pointIds = new Set(pts.map(p => p.id));
  const add = (code, qid, evidence) => issues.push({ code, qid, evidence: String(evidence).slice(0, 300) });

  pts.forEach(p => {
    checked++;
    if (p.origin === 'source') {
      if (!(p.source && p.source.file)) add('MISSING_SOURCE', p.id, '知识点标为来自原文却没填来源文件');
      else if (!nameInBoundary(p.source.file, bd)) add('SOURCE_OUT_OF_BOUNDARY', p.id, '来源文件「' + p.source.file + '」不在本次纳入的材料里');
    } else if (p.source) add('AI_UNMARKED', p.id, 'AI补充知识点不该挂来源文件');
  });

  qs.forEach(q => {
    checked++;
    if (!String(q.stem || '').trim() || !String(q.answer || '').trim()) add('EMPTY_FIELD', q.id, '题干或答案为空');
    if (q.origin === 'source') {
      if (!(q.source && q.source.file)) add('MISSING_SOURCE', q.id, '标为来自原文却没填来源文件');
      else if (!nameInBoundary(q.source.file, bd)) add('SOURCE_OUT_OF_BOUNDARY', q.id, '来源文件「' + q.source.file + '」不在本次纳入的材料里');
    } else {
      const txt = String(q.explanation || '') + String(q.answer || '');
      if (q.source || !/材料未直接覆盖/.test(txt)) add('AI_UNMARKED', q.id, 'AI补充未写明「材料未直接覆盖」或错误挂了来源');
    }
    (q.pointIds || []).forEach(pid => { if (!pointIds.has(pid)) add('DANGLING_POINT', q.id, '关联知识点 ' + pid + ' 不在本次知识点里'); });
    if ((q.type === 'single' || q.type === 'multiple') && Array.isArray(q.options) && q.options.length >= 2) {
      const a = String(q.answer || '').trim().toUpperCase();
      if (/^[A-Z]+$/.test(a) && a.split('').some(ch => ch.charCodeAt(0) - 65 >= q.options.length)) {
        add('ANSWER_NOT_IN_OPTIONS', q.id, '答案字母超出选项范围');
      }
    }
    if (q.type === 'calc') {
      const m = String(q.method || '');
      const hasVerify = /\d/.test(m) && /(公式|代入|运算|验证|验算|推导|计算|=|×|·)/.test(m);
      if (!hasVerify) add('CALC_NO_VERIFY', q.id, '计算题 method 未给出可独立核算的步骤（需含公式/代入/运算线索）');
    }
  });
  return {
    ok: issues.length === 0, checked, issueCount: issues.length,
    score: checked ? Number((1 - issues.length / checked).toFixed(3)) : 0,
    issues
  };
}

function qualityOf(dedupe, validation, history, attempts, accepted, degraded, budget, stopOverride) {
  return {
    dedupe: {
      threshold: dedupe.threshold, before: dedupe.before, after: dedupe.after,
      removedCount: dedupe.removed.length, removed: dedupe.removed.slice(0, 20)
    },
    validation: {
      ok: validation.ok, checked: validation.checked, issueCount: validation.issueCount,
      score: validation.score, issues: validation.issues.slice(0, 20), history
    },
    retry: {
      attempts, retried: attempts > 1, budget: budget || 0,
      stopReason: stopOverride || (accepted ? (attempts > 1 ? 'accepted_on_retry' : 'accepted_first_pass') : 'budget_exhausted_degraded')
    },
    degraded: !!degraded
  };
}

// ---------- M2：题型对齐 / 类别聚合 / 缺口诚实标注 ----------
// 离线侧不能凭空编计算题（会造假，违 L0 不造假），所以重要知识点缺应用型题时，
// 追加「待补充」卡明确告诉用户该补哪类题、为什么不是背诵题；真正补 exam 类题走云端引擎。
const APPLIED_TYPES = ['calc', 'case', 'multiple'];

// 按标题共享的显著词聚类：让知识点按类别归组，而不是东一个西一个。
function clusterCategories(points) {
  const sig = p => {
    const t = String(p.title || '');
    const cn = t.match(/[一-龥]{2,4}/);
    return (cn ? cn[0] : t.slice(0, 2)) || '未分类';
  };
  points.forEach(p => { p.category = sig(p); });
  return points;
}

// 题型对齐：统计每个知识点的题型覆盖；重要点（difficulty≥3）缺应用型题 → 追加待补充卡。
function alignTypes(points, questions) {
  const out = questions.slice();
  points.forEach(p => {
    const qs = out.filter(q => (q.pointIds || []).includes(p.id));
    const hasApplied = qs.some(q => APPLIED_TYPES.includes(q.type));
    const isImportant = (p.difficulty || 0) >= 3;
    if (isImportant && !hasApplied && !out.some(q => q.type === 'gap' && (q.pointIds || []).includes(p.id))) {
      out.push({
        id: uid('q_'), type: 'gap',
        stem: '【待补充题型】「' + p.title + '」资料里出现了，但缺少对应的应用 / 计算 / 综合题。',
        options: [], answer: '（需补充：给题目条件 → 套公式 / 规则 → 逐步求解，并写出解题策略，而非只背数值）',
        explanation: '资料只给了定义 / 数值，没有让你"用"它的题。按考试要求，这类考点必须会算、会用，不能只背。',
        method: '补题思路：① 找出该考点的输入量与公式；② 设计一道"已知 X 求 Y"的应用题；③ 写出完整求解步骤与易错点。可交给云端引擎自动生成，或手动添加。',
        commonMistake: '把"会背定义"当成"会做题"',
        pointIds: [p.id], origin: 'ai', source: null, gapFor: p.id
      });
    }
  });
  return out;
}

// ---------- 本地引擎：只从原文抽取，不造新知识点 ----------
function localAnalyze(store, bookId, opts) {
  const bd = boundary(store, bookId, opts.selectedIds);
  const texts = readTexts(store, bookId, bd.included);
  if (!texts.length) return { ok: false, reason: '所选资料里没有可抽取的文本（扫描版 PDF / 图片 / 旧版 doc 读不出文字）' };
  const kws = insight.keywords(opts.prompt || '');
  const frags = [];
  texts.forEach(t => splitFragments(t.text).forEach(f => {
    const weight = t.layer === 1 ? 3 : t.layer === 2 ? 2 : 1;
    let hit = 0;
    kws.forEach(k => { if (f.toLowerCase().includes(k.toLowerCase())) hit++; });
    frags.push({ text: f, file: t.name, layer: t.layer, score: weight * 2 + hit * 3 + Math.min(f.length / 40, 3), mid: t.id });
  }));
  frags.sort((a, b) => b.score - a.score);
  const top = frags.slice(0, Math.max(3, Math.min(8, opts.pointCount || 5)));
  if (!top.length) return { ok: false, reason: '资料文本太短，抽不出可学习的片段' };

  const points = top.map((f, i) => ({
    id: uid('p_'), title: clip(pickTerms(f.text)[0] || ('知识点 ' + (i + 1)), 20),
    summary: f.text, difficulty: f.layer === 1 ? 3 : f.layer === 2 ? 2 : 1, mastery: '未接触', category: '',
    origin: 'source', source: { file: f.file, loc: '第 ' + f.layer + ' 层原文片段', usage: '原文摘录', materialId: f.mid }
  }));
  clusterCategories(points);

  const questions = [];
  top.forEach((f, i) => {
    const terms = pickTerms(f.text);
    const key = terms[0] || '该知识点';
    const distract = [];
    for (let j = 1; j < top.length && distract.length < 3; j++) {
      const t = pickTerms(top[j].text)[0]; if (t && t !== key && !distract.includes(t)) distract.push(t);
    }
    while (distract.length < 3) distract.push('以上都不属于该知识点');
    questions.push({
      id: uid('q_'), type: 'single', stem: '根据《' + f.file + '》原文，「' + clip(f.text.replace(key, '____'), 70) + '」中空缺处应是：',
      options: [key].concat(distract.slice(0, 3)), answer: key,
      explanation: '原文：' + f.text, commonMistake: '把相邻概念混填',
      method: '通用解题路径（模板）：【动机】锁定题干考点与易混项；【操作】① 定位关键词「' + key + '」② 逐项比对选项 ③ 排除「' + (distract[0] || '以上都不') + '」等相邻概念干扰；【结果】选最贴合原文的一项。',
      pointIds: [points[i].id], origin: 'source',
      source: { file: f.file, loc: '第 ' + f.layer + ' 层原文片段', usage: '挖空出处', materialId: f.mid }
    });
    questions.push({
      id: uid('q_'), type: 'explain', stem: '用自己的话解释「' + points[i].title + '」，并说明它在原文中的适用条件。',
      options: [], answer: f.text,       explanation: '原文依据：' + f.text, commonMistake: '只背定义，说不出适用条件',
      method: '通用解题路径（模板）：【动机】把定义讲成自己的话并说清边界；【操作】① 复述定义 ② 说明适用条件 ③ 给反例验证；【结果】能脱离原文表述该概念。验算：用反例核对是否真理解。',
      pointIds: [points[i].id], origin: 'source',
      source: { file: f.file, loc: '第 ' + f.layer + ' 层原文片段', usage: '判分依据出处', materialId: f.mid }
    });
  });

  // 多选与综合应用：本地引擎没有材料依据自动生成，明确标 AI补充，不伪装成原文。
  if (points.length >= 2) {
    questions.push({
      id: uid('q_'), type: 'multiple', stem: '下列哪些知识点在本次纳入的材料原文中直接出现？（多选）',
      options: [points[0].title, points[1].title, AI_NOTE + '：未在材料出现的推断 A', AI_NOTE + '：未在材料出现的推断 B'],
      answer: 'AB', explanation: AI_NOTE + ' + 模板题：前两项摘自材料原文，后两项是明确标注未覆盖的干扰项，用于检验能否分辨来源。',
      commonMistake: '把 AI 补充当成材料原文', method: '通用解题路径（模板）：【动机】分辨真来自原文 vs AI 补充；【操作】逐项核对是否真在材料出现；【结果】AI 补充项一律不选。',
      pointIds: [points[0].id, points[1].id],
      origin: 'ai', source: null
    });
  }
  questions.push({
    id: uid('q_'), type: 'case', stem: '结合本次纳入的材料，设计一个能用到「' + points[0].title + '」的实际场景，写出分析步骤与结论。',
    options: [], answer: AI_NOTE + '：本地引擎不生成标准答案，请由教师或云端引擎批改。',
    explanation: AI_NOTE + ' + 模板题；本地引擎只做规则抽取，不编造应用案例。',
    commonMistake: '脱离材料凭空发挥',
    method: '通用解题路径（模板）：【动机】把知识点用到真实场景；【操作】① 明确要用的知识点 ② 列出已知条件 ③ 设计情境与步骤；【结果】给出可落地分析框架（具体数值待教师/云端补全）。验算：检查情境是否真用到该知识点。',
    pointIds: [points[0].id], origin: 'ai', source: null
  });

  // 本地引擎同样过去重与校验：默认不填 key 的用户也能看见质量报告（离线、零重试、零成本）。
  const dd = dedupeQuestions(questions, { threshold: opts.dedupeThreshold });
  const aligned = alignTypes(points, dd.questions);
  const body = {
    ok: true, engine: 'local', boundary: bd, points, questions: aligned,
    prompt: opts.prompt || '', createdAt: Date.now(),
    note: '本地引擎：知识点与单选/概念题均摘自原文；多选与综合题为模板题，已标 AI补充。'
  };
  const val = validateGeneration(body, bd);
  body.quality = qualityOf(dd, val, [{ attempt: 1, stage: 'validate', ok: val.ok, issueCount: val.issueCount, issues: val.issues.slice(0, 10) }], 1, val.ok, false, 0, 'local_no_retry');
  return body;
}

// ---------- 云端引擎：用户填的 API，走本地代理转发 ----------
const SYSTEM_PROMPT = [
  '你是严格的课程学习资料生成器。只依据用户提供的材料片段工作。',
  '铁律 1：来自材料的内容必须标 origin="source"，并填 sourceFile（文件名）、sourceLoc（位置）、usage（用法）。',
  '铁律 2：你补充说明、类比、练习、应用题的部分必须标 origin="ai"，sourceFile 置 null。绝不把补充内容伪装成材料原文。',
  '铁律 3：材料没覆盖的内容，必须在 explanation 开头写明「材料未直接覆盖，以下为 AI 补充解释」。不许编造材料里没有的事实、数据、结论。',
  '铁律 4：题目必须有四种 type：single（单选）、multiple（多选）、explain（概念解释）、case（综合应用）；不要只出记忆题，要有应用与迁移题。',
  '铁律 5：每道题必须有 answer、explanation、commonMistake、pointTitles（关联知识点标题数组）。',
  '铁律 6（解题教练·探路/抉择结构）：每道题的 method 字段必须按「解题教练」结构写，不能只给答案。用下列标记分隔便于前端渲染：',
  '  · 探路：列出本题 ≥2 条可行路径，证伪走不通的那条（说明哪一步因何卡死），锁定主路并说明选路理由——必须从已知条件往前推，禁止拿答案反推。',
  '  · 手算（Col 三栏）：用【动机】【操作】【结果】三个标记写关键推导，绝不跳步；【动机】为何走这一步，【操作】具体代入/变形/积分，【结果】这一步意味着什么、如何指引下一步。',
  '  · 极端验/回代：把结果代入原方程或放极端情形验，对不上立即查错。',
  '  · 题型抽象：触发信号 / 核心套路 / 避坑 / 何时不能用。',
  '铁律 7（类别聚合）：每个知识点必须给 category 字段（类别名，如「晶体结构」「相图」），用于把零散知识点按类别归组成图谱，不要东一个西一个。',
  '铁律 8（题型对齐·缺口补题）：当某个知识点 difficulty≥3 且资料里只有定义/数值、没有让你"用"它的题时，必须额外生成 calc（计算）或 case（综合应用）类题，而不是再出一道"XX 是多少"的背诵题；应用型题同样要带 method。',
  '  calc 题的 method 必须给出「公式 → 代入数值 → 逐步运算 → 得数(带单位)」，并在「极端验/回代」段标注验算过程（如"验算：将 x=… 代入 … 得 …"）。',
  '铁律 9（计算题可核验）：calc 题的 answer 必须是具体数值或表达式（不得写"略"），method 必须含有可独立核算的线索（公式名 / 代入数值 / 运算符号），让用户能对照原式独立核算。',
  '铁律 10（多模态·看图）：当材料里有图片（图表/公式/流程图/示意图）时，你必须读懂它们。points 与 questions 用 assetRefs 字段引用图片编号（只填真实存在的「图 <assetId>」），并在顶层 imageCaptions 给每张图一行说明：{ "<assetId>": "这张图讲了什么" }。图表只讲趋势/关系/类型，不编造精确读数；公式请说明含义与适用条件。若材料无任何图片，则不出现 assetRefs 与 imageCaptions 字段。',
  '只输出一个 JSON 对象，不要 markdown 代码块、不要解释文字。结构：',
  '{"points":[{"title","summary","difficulty":1-5,"category":"类别名","assetRefs":["<assetId>"],"origin","sourceFile","sourceLoc","usage"}],"questions":[{"type","stem","options":[],"answer","explanation","commonMistake","method":"解题策略","assetRefs":["<assetId>"],"pointTitles":[],"origin","sourceFile","sourceLoc","usage"}],"imageCaptions":{"<assetId>":"这张图讲了什么"}}'
].join('\n');

// 降级专用系统提示词：去掉「铁律 10 读图」与结构里的图字段。
// 依据 Graceful Degradation「换一套结果契约」——只少发图块却留着读图指令，模型必然编造图说明。
const SYSTEM_PROMPT_TEXT_ONLY = SYSTEM_PROMPT
  .split('\n')
  .filter(line => !/^铁律 10（多模态·看图）/.test(line))
  .join('\n')
  .replace(/,"assetRefs":\["<assetId>"\]/g, '')
  .replace(/,"imageCaptions":\{"<assetId>":"这张图讲了什么"\}/g, '')
  .replace(/"assetRefs":\["<assetId>"\],/g, '')
  // 措辞刻意不出现字段名：提字段名本身可能诱导模型输出该字段（基准：never hand the model a sentence it can turn into a lie）。
  .concat('\n铁律 10（纯文本模式）：本次没有提供任何图片，不引用图片、不给出任何图片说明，也不描述图片内容。');

function parseJSONLoose(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('模型没有返回 JSON 对象');
  return JSON.parse(s.slice(a, b + 1));
}

function normalizeLLM(parsed, bd, engine) {
  if (!parsed || !Array.isArray(parsed.points) || !Array.isArray(parsed.questions)) {
    throw new Error('模型返回的 JSON 缺 points 或 questions 字段');
  }
  const points = parsed.points.slice(0, 20).map(p => {
    const origin = p.origin === 'source' ? 'source' : 'ai';
    return {
      id: uid('p_'), title: clip(p.title, 60) || '未命名知识点', summary: clip(p.summary, 800),
      difficulty: Math.max(1, Math.min(5, Number(p.difficulty) || 3)), mastery: '未接触', origin,
      category: clip(p.category, 30) || '未分类',
      assetRefs: Array.isArray(p.assetRefs) ? p.assetRefs.map(String).slice(0, 8) : [],
      source: origin === 'source'
        ? { file: clip(p.sourceFile, 200), loc: clip(p.sourceLoc, 200), usage: clip(p.usage, 200) }
        : null
    };
  });
  const byTitle = {};
  points.forEach(p => { byTitle[p.title] = p.id; });
  const questions = parsed.questions.slice(0, 60).map(q => {
    const type = TYPES.includes(q.type) ? q.type : 'explain';
    const origin = q.origin === 'source' ? 'source' : 'ai';
    const pids = (Array.isArray(q.pointTitles) ? q.pointTitles : []).map(t => byTitle[t]).filter(Boolean);
    return {
      id: uid('q_'), type, stem: clip(q.stem, 1000),
      options: Array.isArray(q.options) ? q.options.map(o => clip(o, 300)) : [],
      answer: String(q.answer == null ? '' : q.answer).slice(0, 2000),
      explanation: clip(q.explanation, 2000), commonMistake: clip(q.commonMistake, 500),
      method: clip(q.method, 2000),
      assetRefs: Array.isArray(q.assetRefs) ? q.assetRefs.map(String).slice(0, 8) : [],
      pointIds: pids.length ? pids : (points[0] ? [points[0].id] : []),
      origin,
      source: origin === 'source' ? { file: clip(q.sourceFile, 200), loc: clip(q.sourceLoc, 200), usage: clip(q.usage, 200) } : null
    };
  }).filter(q => q.stem && q.answer);
  if (!points.length || !questions.length) throw new Error('模型返回的知识点或题目为空');
  const imageCaptions = (parsed.imageCaptions && typeof parsed.imageCaptions === 'object') ? parsed.imageCaptions : {};
  return { ok: true, engine, boundary: bd, points, questions, imageCaptions, createdAt: Date.now(), note: '云端引擎生成；来源标注由模型给出，请审阅后再保存。' };
}

// 重试提示：把上一轮本地校验查出的具体问题回给模型 + 温度降到 0。
// 依据 RAGAS 低分修复建议「Tighten your system prompt / Lower the temperature」，锚点 8。
const REPAIR_PROMPT = [
  '上一次输出未通过本地结构化校验。请只依据上面给出的材料原文重出，并修正下列问题：',
  '1. origin="source" 的内容，sourceFile 必须是材料清单里真实出现过的文件名，不许编造文件名。',
  '2. origin="ai" 的内容不许挂 sourceFile，且 explanation 开头必须写「材料未直接覆盖，以下为 AI 补充解释」。',
  '3. 每道题的 answer、explanation、commonMistake 不能为空；pointTitles 必须是 points 里出现过的 title。',
  '仍然只输出一个 JSON 对象，不要 markdown 代码块。'
].join('\n');

function scrubLLMError(e) {
  return llm.scrub(e && e.message ? e.message : String(e), {});
}

async function llmAnalyze(store, bookId, opts, cfg, chatFn) {
  const bd = boundary(store, bookId, opts.selectedIds);
  const texts = readTexts(store, bookId, bd.included);

  // M3 多模态：收集资料中的图（非文本），准备作为多模态输入交给视觉模型（API 为主，本地为次）。
  const visionOn = opts.useVision !== false;
  const imageBlocks = [];
  const MAX_PER_MAT = 8, MAX_TOTAL = 24, MAX_BYTES = 4 * 1024 * 1024;
  // 落盘侧用 path.extname()（带点：'.png'），历史/导入数据可能不带点（'png'）。
  // 消费侧统一归一，避免两边各写各的格式导致真实 PPTX 一张图都进不了模型。
  const normExt = e => String(e == null ? '' : e).trim().toLowerCase().replace(/^\.+/, '');
  const VISION_EXTS = ['png', 'jpg', 'jpeg'];
  if (visionOn) {
    for (const m of bd.included) {
      let rec;
      try { rec = store.readMaterial(bookId, m.id); } catch (e) { continue; }
      const imgs = (rec.assets || []).filter(a => {
        return VISION_EXTS.includes(normExt(a.ext)) && (a.kind === 'media' || !a.kind);
      });
      for (const a of imgs) {
        if (imageBlocks.length >= MAX_TOTAL) break;
        if (imageBlocks.filter(b => b.matId === m.id).length >= MAX_PER_MAT) continue;
        let ab;
        try { ab = store.readAsset(bookId, m.id, a.id); } catch (e) { continue; }
        const b64 = ab.data || '';
        if (b64.length > MAX_BYTES) continue; // 过大跳过，避免爆 context
        imageBlocks.push({
          assetId: a.id, matId: m.id, name: m.name,
          slide: a.slide, page: a.page,
          dataUrl: 'data:' + (ab.mime || 'image/png') + ';base64,' + b64
        });
      }
    }
  }

  // 「没有可抽取文本」不再一票否决：M3 之后图片本身也是合法材料（纯图表/公式 PPT 就靠它）。
  // 但降级到纯文本时若也没文字，就没有任何材料可依据 —— 必须大声失败，绝不让模型凭空编。
  const noText = !texts.length;
  if (noText && !imageBlocks.length) {
    return { ok: false, reason: '所选资料里既没有可抽取的文本，也没有可用的图片（扫描版 PDF / 旧版 doc 读不出文字）' };
  }
  if (noText && !visionOn) {
    return { ok: false, reason: '所选资料没有可抽取的文本；本次未开启看图（useVision=false），无法分析纯图片资料' };
  }

  const materialBlock = texts.map(t =>
    '【文件】' + t.name + '（第 ' + t.layer + ' 层）\n' + t.text.slice(0, 6000)
  ).join('\n\n').slice(0, 40000);
  const imageIntro = imageBlocks.length
    ? '\n\n===== 资料中的图片（共 ' + imageBlocks.length + ' 张，按页码排列）=====\n' +
      imageBlocks.map((b, i) => '[' + (i + 1) + '] 图 ' + b.assetId + '：来自《' + b.name + '》' +
        (b.slide ? '第 ' + b.slide + ' 页(幻灯片)' : (b.page ? '第 ' + b.page + ' 页' : ''))).join('\n') +
      '\n请读懂每张图（图表/公式/流程图/示意图）的内容，并在 points 与 questions 中通过 assetRefs 引用对应的「图 <assetId>」编号（只填真实存在的图编号）；' +
      '同时为每张图给一行 caption，用顶层 imageCaptions 字段：{ "<assetId>": "这张图讲了什么" }。' +
      '图表只讲趋势/关系/类型，不要编造精确读数；公式请写出其含义与适用条件。'
    : '';
  const userTextBase = [
    '本次分析的材料边界（共 ' + bd.included.length + ' 份纳入，' + bd.excluded.length + ' 份排除）：',
    bd.included.map(m => '- ' + m.name + '（第 ' + m.layer + ' 层，' + m.role + '）').join('\n'),
    '',
    '复习要求提示词：' + (opts.prompt || '（未填，按材料本身权重组织）'),
    '希望产出知识点数：' + (opts.pointCount || 5) + '，题目数：' + (opts.questionCount || 8),
    '',
    '===== 材料原文片段（只准依据以下内容）=====',
    noText ? '（本次资料没有可抽取的文字，全部内容在随附的图片里，请依据图片作答）' : materialBlock
  ].join('\n');
  // 两套提示词：带图 pass 才允许读图与引用图；降级 pass 明确告知「没有图片」，
  // 从源头掐断模型凭空编造 imageCaptions / assetRefs 的可能（comfyui-mcp「never hand the model a sentence it can turn into a lie」）。
  const userTextWithImages = userTextBase + imageIntro;
  const userTextDegraded = userTextBase +
    '\n\n===== 重要：本次分析没有提供任何图片 =====' +
    '\n当前模型无法接收图片输入，资料中的图片未被读取。请只依据上面的文字材料生成结果；' +
    '不引用图片、不给出任何图片说明、不描述图片内容、不假装看过图。';

  // 多模态消息构造：带图时把每张图作为 image_url 块附在文本后；
  // degraded=true 才用「没有图片、禁止编图」提示词；本来就没图时保持原始纯文本（不改变既有行为）。
  function buildMessages(withImages, i, prevRaw, best, degraded) {
    const withImg = !!withImages && imageBlocks.length > 0;
    const text = withImg ? userTextWithImages : (degraded ? userTextDegraded : userTextBase);
    const content = withImg
      ? [{ type: 'text', text: text }].concat(imageBlocks.map(b => ({ type: 'image_url', image_url: { url: b.dataUrl } })))
      : text;
    const sys = degraded ? SYSTEM_PROMPT_TEXT_ONLY : SYSTEM_PROMPT;
    const msgs = [{ role: 'system', content: sys }, { role: 'user', content }];
    if (i > 0) {
      msgs.push(
        { role: 'assistant', content: prevRaw.slice(0, 1200) },
        { role: 'user', content: REPAIR_PROMPT + '\n\n本次材料文件名：' + bd.included.map(m => m.name).join('、') +
          '\n上一轮校验问题：' + JSON.stringify(best ? best.validation.issues.slice(0, 10) : []) }
      );
    }
    return msgs;
  }

  // 循环由代码控制，不由模型决定何时结束（Agent Reflection controller）。
  const history = [];
  let best = null, bestScore = -1, attempts = 0, prevRaw = '';
  const MAX_ATTEMPTS = 2; // 首次 + 固定 1 次重试；云端重试花用户的钱，必须封顶
  // 带图优先；若模型不支持视觉（400 类错误），降级为纯文本重试一次，不阻塞分析。
  const passes = imageBlocks.length ? [{ withImages: true }, { withImages: false }] : [{ withImages: false }];
  let visionDegraded = false;
  function isVisionUnsupported(e) {
    const s = String((e && e.message) ? e.message : (e || '')).toLowerCase();
    // 只看「明确说图片/视觉能力不行」的语义，不再把任意 400 / bad request 当视觉不支持
    // —— 否则参数错、超长等合法 400 会被静默吞掉，掩盖真实错误。
    return /vision|image|multimodal|not support(ed)? (image|vision|multimodal)|does not support image|unsupported (image|media)|invalid.*(image|content)/.test(s);
  }
  for (let p = 0; p < passes.length && !best; p++) {
    const withImages = passes[p].withImages;
    if (p > 0) {
      // 纯图片资料降级后没有任何文字依据，继续请求只会让模型凭空编 —— 直接失败并给可执行的下一步。
      if (noText) return { ok: false, reason: '当前模型不支持视觉输入，而所选资料没有可抽取的文本，无法降级为纯文本分析。请在设置页换用带视觉能力的模型（如 deepseek-flash / Qwen3-VL）' };
      visionDegraded = true;
    }
    prevRaw = ''; bestScore = -1; best = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      attempts++;
      const msgs = buildMessages(withImages, i, prevRaw, best, visionDegraded);
      let raw;
      try { raw = await chatFn(cfg, msgs, { maxTokens: 8192, temperature: i === 0 ? 0.2 : 0, timeoutMs: 180000 }); }
      catch (e) {
        if (withImages && p === 0 && isVisionUnsupported(e)) { best = null; break; } // 触发降级 pass
        return { ok: false, reason: '云端调用失败：' + scrubLLMError(e) };
      }
      prevRaw = String(raw || '');
      let normalized;
      try { normalized = normalizeLLM(parseJSONLoose(raw), bd, 'llm'); }
      catch (e) {
        history.push({ attempt: attempts, stage: 'parse', ok: false, issueCount: null, reason: e.message });
        if (withImages && p === 0) { best = null; break; } // 带图首次解析失败也降级纯文本
        continue;
      }
      const validation = validateGeneration(normalized, bd);
      history.push({ attempt: attempts, stage: 'validate', ok: validation.ok, issueCount: validation.issueCount, issues: validation.issues.slice(0, 10) });
      // 保留见过的最佳草稿，绝不返回比之前更差的一版
      if (validation.score > bestScore) { bestScore = validation.score; best = { analysis: normalized, validation }; }
      if (validation.ok) break;
    }
  }
  // M3：把云端视觉模型读懂的图说明写回 asset。
  // 降级时模型根本没看过图，任何 captions/assetRefs 都是凭空编的 —— 一律不落盘、不回传。
  if (!visionDegraded && best && best.analysis && best.analysis.imageCaptions) {
    const caps = best.analysis.imageCaptions || {};
    Object.keys(caps).forEach(aid => {
      try { const b = imageBlocks.find(x => x.assetId === aid); if (b) store.setAssetCaption(bookId, b.matId, aid, caps[aid]); } catch (e) {}
    });
  }
  if (visionDegraded) console.warn('[M3] 当前模型不支持视觉输入，已降级为纯文本分析（图片未被读取）');

  if (!best || !best.analysis) {
    return { ok: false, reason: '云端返回内容 ' + attempts + ' 次都无法解析成合法结果，已阻止入库' };
  }
  const accepted = best.validation.ok;
  let body = best.analysis;
  // M3：把图的归属（matId 等）随分析结果带回前端，供前端异步读取缩略图。
  // 降级时清空图索引与所有图引用：模型没看过图，前端就不该显示「本次分析读过这些图」。
  body.visionDegraded = !!visionDegraded;
  if (visionDegraded) {
    body.assetIndex = {};
    body.imageCaptions = {};
    body.points = (body.points || []).map(p => Object.assign({}, p, { assetRefs: [] }));
    body.questions = (body.questions || []).map(q => Object.assign({}, q, { assetRefs: [] }));
  } else if (imageBlocks.length) {
    body.assetIndex = {};
    imageBlocks.forEach(b => { body.assetIndex[b.assetId] = { matId: b.matId, name: b.name, slide: b.slide, page: b.page }; });
  }
  let dropped = [];
  if (!accepted) {
    // 预算耗尽：诚实降级，不猜、不静默放行。剥掉未经核验的来源并显式标注；空题干的题剔除。
    const badIds = new Set(best.validation.issues.map(i => i.qid));
    const questions = (body.questions || []).map(q => {
      if (!badIds.has(q.id)) return q;
      if (!String(q.stem || '').trim()) { dropped.push({ id: q.id, reason: '题干为空' }); return null; }
      return Object.assign({}, q, {
        origin: 'ai', source: null,
        explanation: '【本地校验未通过，已降级为 AI补充，请审阅】来源声明未通过核验，不计入原文依据。' + String(q.explanation || ''),
        qualityFlags: (q.qualityFlags || []).concat(['degraded_after_failed_validation'])
      });
    }).filter(Boolean);
    const points = (body.points || []).map(p => badIds.has(p.id) ? Object.assign({}, p, { origin: 'ai', source: null }) : p);
    body = Object.assign({}, body, { points, questions });
    if (!questions.length) return { ok: false, reason: '云端结果未通过本地校验，剔除不合格题目后为空，已阻止入库（不造空卷）' };
    body.note = '云端引擎生成；【已降级】重试 ' + (attempts - 1) + ' 次后仍未通过本地校验，' +
      questions.length + ' 道题被强制标为 AI补充、剥除未核验的来源，请逐题审阅。';
  } else {
    body.note = '云端引擎生成；来源标注由模型给出，请审阅后再保存。' +
      (attempts > 1 ? '（第 1 次未通过本地校验，已按校验意见重试 1 次并通过）' : '');
  }
  // 降级披露（Graceful Degradation）：结果的含义变了（图片没被读取），必须让用户看见，而不是只写 console。
  if (visionDegraded) {
    body.note += '【本次未读图】当前模型不支持视觉输入，已降级为纯文本分析：资料中的图片未被读取，' +
      '结果不含任何图片引用或图说明。想让 AI 看图，请在设置页换用带视觉能力的模型（如 deepseek-flash / Qwen3-VL）。';
    body.qualityFlags = (body.qualityFlags || []).concat(['vision_degraded_text_only']);
  }

  const dd = dedupeQuestions(body.questions, { threshold: opts.dedupeThreshold });
  body.questions = dd.questions;
  if (!body.questions.length) return { ok: false, reason: '去重后没有可用题目，已阻止入库' };
  body.quality = qualityOf(dd, best.validation, history, attempts, accepted, !accepted, 1);
  body.quality.dropped = dropped;
  return body;
}

// 内部入口：chatFn 可注入，供判别测试构造「第一次坏、第二次好」；不经过 HTTP，前端碰不到。
async function analyzeWithChat(store, bookId, opts, chatFn) {
  const o = opts || {};
  if (o.engine === 'llm') {
    if (!o.cfg || !o.cfg.baseURL || !o.cfg.apiKey || !o.cfg.model) {
      return { ok: false, reason: '云端引擎需要填完 API 地址、密钥、模型名' };
    }
    return await llmAnalyze(store, bookId, o, o.cfg, chatFn);
  }
  return localAnalyze(store, bookId, o);
}

async function analyze(store, bookId, opts) {
  return await analyzeWithChat(store, bookId, opts, llm.chat);
}

// ---------- 试卷脱敏：交卷前绝不把答案给前端 ----------
function paperOf(exam) {
  return {
    id: exam.id, round: exam.round, createdAt: exam.createdAt, engine: exam.engine,
    questions: (exam.questions || []).map(q => ({
      id: q.id, type: q.type, typeLabel: TYPE_LABEL[q.type] || q.type,
      stem: q.stem, options: q.options || [], pointIds: q.pointIds || [],
      origin: q.origin, source: q.source || null
    }))
  };
}

function makeExam(analysis, opts) {
  const o = opts || {};
  const qs = (analysis.questions || []).filter(q => q.type !== 'gap').slice(0, o.questionCount || 8);
  if (!qs.length) throw new Error('没有可出题的内容');
  return {
    id: uid('e_'), round: 1, createdAt: Date.now(), engine: analysis.engine,
    questions: qs, answers: {}, grading: [], weakPointIds: [], analysisId: analysis.id || null
  };
}

// ---------- 批改：三判定 + 错因类型 ----------
function normAns(a) {
  if (Array.isArray(a)) return a.map(x => String(x).trim().toUpperCase()).sort().join('');
  return String(a == null ? '' : a).trim().toUpperCase().replace(/[\s,，、]/g, '');
}

function gradeQuestion(q, given) {
  const t = q.type;
  const std = String(q.answer == null ? '' : q.answer);
  if (t === 'single' || t === 'multiple' || t === 'judge') {
    const right = normAns(given) && normAns(given) === normAns(std);
    return { verdict: right ? '正确' : '错误', cause: right ? '' : (t === 'multiple' ? '概念混淆' : (t === 'judge' ? '概念混淆' : '前置知识缺失')) };
  }
  // 开放题：按答案关键词覆盖率判定，明确说明这是本地规则判定，不是模型评分
  const words = (pickTerms(std).filter(w => w.length >= 2)).slice(0, 12);
  const g = String(given == null ? '' : given);
  if (!g.trim()) return { verdict: '错误', cause: '只会背不会解释' };
  const hit = words.filter(w => g.includes(w)).length;
  const rate = words.length ? hit / words.length : 0;
  if (rate >= 0.6) return { verdict: '正确', cause: '' };
  if (rate >= 0.25) return { verdict: '部分正确', cause: '会看不会做' };
  return { verdict: '错误', cause: t === 'case' ? '应用场景不清楚' : '术语不理解' };
}

function gradeExam(exam, answers) {
  const grading = (exam.questions || []).map(q => {
    const g = gradeQuestion(q, (answers || {})[q.id]);
    return {
      qid: q.id, type: q.type, stem: q.stem, given: (answers || {})[q.id] || '',
      standard: q.answer, verdict: g.verdict, cause: g.cause,
      pointIds: q.pointIds || [], explanation: q.explanation || '', commonMistake: q.commonMistake || '',
      source: q.source || null, origin: q.origin
    };
  });
  const weak = Array.from(new Set(grading.filter(x => x.verdict !== '正确').reduce((a, x) => a.concat(x.pointIds), [])));
  exam.answers = answers || {};
  exam.grading = grading;
  exam.weakPointIds = weak;
  return { ok: true, grading, weakPointIds: weak, summary: {
    total: grading.length,
    correct: grading.filter(x => x.verdict === '正确').length,
    partial: grading.filter(x => x.verdict === '部分正确').length,
    wrong: grading.filter(x => x.verdict === '错误').length
  } };
}

// ---------- 巩固卷：只针对薄弱点，不机械重复整套 ----------
function remedial(exam, analysis) {
  const weak = exam.weakPointIds || [];
  const pool = (exam.questions || []).concat((analysis && analysis.questions) || []);
  // 每个薄弱知识点只取 1 道题：避免把同一知识点下的多道错题整套搬过来（ko-lesson「不机械重复整套」）。
  const usedPoints = new Set(), seenQ = new Set(), picked = [];
  for (const q of pool) {
    if (seenQ.has(q.id)) continue;
    const hit = (q.pointIds || []).find(p => weak.includes(p) && !usedPoints.has(p));
    if (!hit) continue;
    usedPoints.add(hit); seenQ.add(q.id); picked.push(q);
  }
  if (!weak.length) return { ok: false, reason: '全部答对，无需生成巩固卷' };
  if (!picked.length) return { ok: false, reason: '薄弱知识点没有可复用的题目，请重新分析后再试' };
  return {
    ok: true,
    exam: {
      id: uid('e_'), round: (exam.round || 1) + 1, createdAt: Date.now(),
      engine: exam.engine, questions: picked, answers: {}, grading: [], weakPointIds: [],
      analysisId: exam.analysisId, fromExamId: exam.id, weakPointIdsSource: weak
    },
    weakPointIds: weak
  };
}

// ---------- M1：从题库.json 出卷（复用练习/批改/薄弱地图管线）----------
// 题库题目已在 syllabus.bankToExamQuestion 规整为引擎可吃的结构（含 pointIds）。
async function bankExam(store, bookId, opts) {
  const questions = syllabus.getBankQuestions(store, bookId);
  if (!questions.length) return { ok: false, reason: '未检测到题库.json，无法从题库出卷' };
  const o = opts || {};
  let pool = questions;
  if (Array.isArray(o.pointIds) && o.pointIds.length) {
    const set = new Set(o.pointIds);
    const filtered = questions.filter(q => (q.pointIds || []).some(pid => set.has(pid)));
    if (filtered.length) pool = filtered; // 指定知识点无题时回退到全部，避免空卷
  }
  // 洗牌后取 count（不重复整套；同知识点多题时随机抽，避免每次都一样）
  pool = pool.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  const count = Math.max(1, Math.min(pool.length, o.count || pool.length));
  const picked = pool.slice(0, count);
  const exam = {
    id: uid('e_'), round: 1, createdAt: Date.now(), engine: 'bank',
    questions: picked, answers: {}, grading: [], weakPointIds: [], analysisId: null
  };
  store.saveExam(bookId, exam);
  return { ok: true, paper: paperOf(exam) };
}

// ---------- 错题本聚合：薄弱地图（M1）----------
// 依据 Anki 的 leech 概念：多次 lapse 的知识点标记为 leech，上浮到薄弱地图顶部。
// 纯本地、零云、零模型：只统计落盘的历史，不调任何引擎。
const LEECH_THRESHOLD = 3;
// 复习排程（F1）：逐知识点 stability / difficulty / dueAt 由四档评分驱动（lib/srs.js）。
// 旧数据没有 srs 字段时回落到 Leitner 查表，升级不丢历史 —— LEITNER 保留只为兼容。
// 采用 FSRS「在忘记前复习」的思想（目标留存 0.9），但不引入 ML 权重拟合优化器（见阶段零对照表 G1）。
const LEITNER = [0, 0, 1, 3, 7, 16, 35];
function boxIntervalDays(box) { return LEITNER[Math.max(1, Math.min(6, box || 1))]; }
function srsDueDate(rec, now) { return srs.dueDate(rec, now, boxIntervalDays); }
function isDue(rec, now) { return srsDueDate(rec, now) <= now; }

// 四档自评（看完答案后）：只重排下次复习时间，不重复记一次真实复习。
// 与 recordGrade 的 rerate 分支配套，是 F1 从「自动二值」升级到「用户反馈」的入口。
function applyRatings(store, bookId, examId, ratings) {
  const ex = store.getExam(bookId, examId);
  if (!ex) return { ok: false, reason: '试卷不存在' };
  if (!ex.grading || !ex.grading.length) return { ok: false, reason: '请先交卷批改，再给掌握度自评' };
  const clean = {};
  Object.keys(ratings || {}).forEach(qid => {
    const v = srs.clamp(Math.round(Number(ratings[qid]) || 3), 1, 4);
    if (ex.grading.some(g => g.qid === qid)) clean[qid] = v;
  });
  if (!Object.keys(clean).length) return { ok: false, reason: '没有匹配到该卷的题目' };
  ex.ratings = Object.assign({}, ex.ratings || {}, clean);
  ex.rerate = true;
  const res = store.recordGrade(bookId, ex, null);
  delete ex.rerate;
  store.saveExam(bookId, ex);
  return { ok: true, ratings: clean, result: res };
}

function summarizeMistakes(store, bookId, now) {
  now = now || Date.now();
  const items = store.getMistakes(bookId) || [];
  const enriched = items.map(r => Object.assign({}, r, {
    leech: (r.lapseCount || 0) >= LEECH_THRESHOLD,
    totalTries: (r.lapseCount || 0) + (r.correctCount || 0),
    box: r.box || 1,
    due: isDue(r, now),
    dueInDays: Math.max(0, Math.round((srsDueDate(r, now) - now) / 86400000))
  }));
  enriched.sort((a, b) => (b.lapseCount || 0) - (a.lapseCount || 0) || (b.lastSeen || 0) - (a.lastSeen || 0));
  return {
    items: enriched,
    leechCount: enriched.filter(x => x.leech).length,
    dueCount: enriched.filter(x => x.due).length
  };
}

// M2 组卷：从到期（due）的薄弱知识点里，复用已保存试卷中关联的题目，拼一份「今日复习卷」。
// 纯本地、零云、零模型；组完即保存，可走现有交卷批改，批改后盒子按对错升级/重置。
function reviewExam(store, bookId, now, maxQ) {
  now = now || Date.now();
  const summ = summarizeMistakes(store, bookId, now);
  const due = summ.items.filter(x => x.due && x.pointId);
  const dueIds = new Set(due.map(d => d.pointId));
  if (!dueIds.size) return { ok: false, reason: '今天没有到期要复习的薄弱点' };
  const exams = store.listExams(bookId);
  const seen = new Set(), picked = [];
  const cap = Math.max(1, Math.min(30, maxQ || 20));
  for (const meta of exams) {
    const ex = store.getExam(bookId, meta.id);
    if (!ex || !ex.questions) continue;
    for (const q of ex.questions) {
      if (seen.has(q.id)) continue;
      if ((q.pointIds || []).some(p => dueIds.has(p))) { seen.add(q.id); picked.push(q); }
      if (picked.length >= cap) break;
    }
    if (picked.length >= cap) break;
  }
  if (!picked.length) return { ok: false, reason: '到期知识点没有可复用的题目，请重新分析后再复习' };
  const exam = {
    id: uid('e_'), round: 'review', createdAt: now, engine: 'review',
    questions: picked, answers: {}, grading: [], weakPointIds: Array.from(dueIds), analysisId: null
  };
  return { ok: true, exam, dueCount: dueIds.size };
}

module.exports = {
  boundary, analyze, analyzeWithChat, paperOf, makeExam, gradeExam, remedial, summarizeMistakes, reviewExam, applyRatings, SYSTEM_PROMPT,
  bankExam, dedupeQuestions, validateGeneration, normStem, jaccard, LEECH_THRESHOLD, LEITNER, boxIntervalDays, srsDueDate, isDue,
  buildBookOutline: syllabus.buildBookOutline, getBankQuestions: syllabus.getBankQuestions,
  TYPES, TYPE_LABEL, MASTERY, CAUSES, AI_NOTE, parseJSONLoose, normalizeLLM
};
