'use strict';
/**
 * 考纲思维导图数据层（v0.8）。
 *
 * 设计依据（阶段零锚点）：
 *  - markmap 用 D3 radial-tree 做「markdown 层级 → 可折叠思维导图」，但只渲染、不提供
 *    「点开节点看详细解释+子类型+例题+题型分类面板+跨节点双链」的数据模型。我们借鉴其
 *    中心辐射视觉范式，自建数据层 + 交互。
 *  - 用户知识库机制（Obsidian 式双链）：related 双向索引；merge 按 title 去重、只追加新
 *    子类型/例题/关联，绝不覆盖既有 summary（「已存在不写、新类型追加」）。
 *  - 骨架来自 lib/syllabus.buildBookOutline（考纲.md 权威层级 + 题库.json 挂题）；
 *    真实关联来自同题考到的两知识点（co-question），不凭空造关系。
 *
 * 节点结构：
 *   { id, title, summary, layer, children:[{title,summary}], questionTypes:[{type,typeLabel,questions,single}], related:[title], sourceRef, key }
 * 图结构：
 *   { id, centerTitle, centerSummary, nodes:[...], source:'rule'|'llm', updatedAt }
 */
const syllabus = require('./syllabus');
const llm = require('./llm');

const TYPE_LABEL = {
  single: '单选题', multiple: '多选题', explain: '概念解释题', fill: '填空题',
  judge: '判断题', essay: '简答题', calc: '计算题', case: '综合应用题'
};
function typeLabel(t) { return TYPE_LABEL[t] || t; }

// ---------- 工具 ----------
function groupQuestions(qs) {
  const byType = {};
  (qs || []).forEach(q => {
    const t = q.type;
    (byType[t] = byType[t] || []).push({
      id: q.id, stem: q.stem, answer: q.answer, explanation: q.explanation
    });
  });
  return Object.keys(byType).map(t => ({
    type: t, typeLabel: typeLabel(t),
    questions: byType[t],
    single: byType[t].length === 1 // 该题型只有 1 题 → 进右侧「题目分类」面板
  }));
}

// 同题考到的两知识点 → 互相 related（真实关系，非编造）
function attachCoQuestionRelated(maps, bankQs) {
  const nodeByPid = {};
  maps.forEach(m => m.nodes.forEach(n => { if (n.sourceRef && n.sourceRef.id) nodeByPid[n.sourceRef.id] = n; }));
  const seen = {};
  (bankQs || []).forEach(q => {
    const ps = Array.from(new Set((q.pointIds || []).filter(p => nodeByPid[p])));
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = nodeByPid[ps[i]], b = nodeByPid[ps[j]];
        if (!a || !b || a === b) continue;
        const key = a.title < b.title ? a.title + '|' + b.title : b.title + '|' + a.title;
        if (seen[key]) continue; seen[key] = 1;
        if (!a.related.includes(b.title)) a.related.push(b.title);
        if (!b.related.includes(a.title)) b.related.push(a.title);
      }
    }
  });
}

// 规则版：考纲每 section 一张中心图（满足「每章多个中心」，如晶体一张、石墨一张）
function buildRuleMaps(outline, bankQs) {
  const maps = [];
  (outline.chapters || []).forEach(ch => {
    (ch.sections || []).forEach(sec => {
      const centerTitle = sec.title || ch.title;
      const nodes = (sec.points || []).map(p => ({
        id: p.text,
        title: p.text,
        summary: p.summary || (p.key ? '（重点）' + p.text : ''),
        layer: 1,
        children: [],
        questionTypes: groupQuestions(p.questions),
        related: [],
        sourceRef: { kind: 'syllabus', id: p.id, pageRef: p.pageRef },
        key: !!p.key
      }));
      if (!nodes.length) return;
      maps.push({
        id: centerTitle,
        centerTitle,
        centerSummary: ch.title ? ('来自「' + ch.title + '」') : '',
        nodes,
        source: 'rule',
        updatedAt: Date.now()
      });
    });
  });
  attachCoQuestionRelated(maps, bankQs);
  return maps;
}

// LLM 版：用 chat 生成 summary/children/related（题型分组仍以规则版真实题库为准）
async function generateViaLLM(cfg, outline, bankQs) {
  const skeleton = (outline.chapters || []).map(ch => ({
    chapter: ch.title,
    sections: (ch.sections || []).map(sec => ({
      section: sec.title,
      points: (sec.points || []).map(p => ({
        text: p.text, key: !!p.key,
        qTypes: (p.questions || []).map(q => q.type)
      }))
    }))
  }));
  const prompt = [
    { role: 'system', content: '你是复习资料结构化助手。基于考纲骨架，为每张思维导图（每节一张中心图）生成节点的详细解释 summary、子类型 children（无限嵌套，{title,summary}）、以及跨知识点关联 related（其他节点 title 数组，只写真实有逻辑联系的概念）。题型与题目不在此生成（由系统从题库挂接）。只返回 JSON，结构：{maps:[{centerTitle,centerSummary,nodes:[{title,summary,children:[{title,summary}],related:[title]}]}]}。不要编造、不要加题目。' },
    { role: 'user', content: '考纲骨架：' + JSON.stringify(skeleton) }
  ];
  const text = await llm.chat(cfg, prompt, { maxTokens: 6000, temperature: 0.2 });
  // 容错：抽取首个 {...} JSON 块
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// 以规则版为骨架（带真实题型），用 LLM 结果填充 summary/children/related
function mergeRuleAndLLM(rule, llmRes) {
  const out = JSON.parse(JSON.stringify(rule));
  (llmRes.maps || []).forEach(lm => {
    const rm = out.maps.find(m => m.centerTitle === lm.centerTitle);
    if (!rm) { out.maps.push(JSON.parse(JSON.stringify(lm))); return; }
    if (lm.centerSummary && !rm.centerSummary) rm.centerSummary = lm.centerSummary;
    (lm.nodes || []).forEach(ln => {
      const rn = rm.nodes.find(n => n.title === ln.title);
      if (!rn) { rm.nodes.push(JSON.parse(JSON.stringify(ln))); return; }
      if (ln.summary) rn.summary = ln.summary;
      if (Array.isArray(ln.children)) rn.children = ln.children;
      (ln.related || []).forEach(r => { if (!rn.related.includes(r)) rn.related.push(r); });
      // questionTypes 与 sourceRef 保留规则版（真实题库），LLM 不碰题目
    });
  });
  return out;
}

// ---------- 纯函数：增量合并（沉淀 / 去重 / 只追加，不覆盖既有 summary）----------
function mergeMaps(existing, incoming) {
  if (!existing || !existing.maps) return incoming;
  const out = JSON.parse(JSON.stringify(existing));
  (incoming.maps || []).forEach(im => {
    let om = out.maps.find(m => m.centerTitle === im.centerTitle);
    if (!om) { out.maps.push(JSON.parse(JSON.stringify(im))); return; }
    if (!om.centerSummary && im.centerSummary) om.centerSummary = im.centerSummary;
    (im.nodes || []).forEach(inNode => {
      let on = om.nodes.find(n => n.title === inNode.title);
      if (!on) { om.nodes.push(JSON.parse(JSON.stringify(inNode))); return; }
      // 不覆盖既有 summary，只填空时补
      if (inNode.summary && !on.summary) on.summary = inNode.summary;
      // 追加不存在的子类型
      (inNode.children || []).forEach(c => { if (!on.children.find(x => x.title === c.title)) on.children.push(c); });
      // 追加新关联
      (inNode.related || []).forEach(r => { if (!on.related.includes(r)) on.related.push(r); });
      // 追加新题型（题目以既有为准）
      (inNode.questionTypes || []).forEach(iq => { if (!on.questionTypes.find(q => q.type === iq.type)) on.questionTypes.push(iq); });
    });
  });
  out.updatedAt = Date.now();
  out.source = existing.source || incoming.source;
  return out;
}

// ---------- 主入口 ----------
async function generate(store, bookId, cfg, opts) {
  opts = opts || {};
  const outline = syllabus.buildBookOutline(store, bookId);
  const bankQs = syllabus.getBankQuestions(store, bookId);
  let result = {
    bookId,
    maps: buildRuleMaps(outline, bankQs),
    source: 'rule',
    updatedAt: Date.now()
  };

  if (cfg && cfg.baseURL && cfg.model) {
    try {
      const rich = await generateViaLLM(cfg, outline, bankQs);
      if (rich && rich.maps && rich.maps.length) {
        result = mergeRuleAndLLM(result, rich);
        result.source = 'llm';
      }
    } catch (e) {
      result.source = 'rule-llm-failed';
    }
  }

  // 沉淀：与已存地图合并（实现「已存在不写、新类型追加」），除非 force 强制重建
  if (!opts.force) {
    const existing = store.getMindmap(bookId);
    if (existing && existing.maps && existing.maps.length) {
      result = mergeMaps(existing, result);
    }
  }
  store.saveMindmap(bookId, result);
  return result;
}

function getMaps(store, bookId) {
  const d = store.getMindmap(bookId);
  if (!d || !d.maps) return { bookId, maps: [], source: 'none', updatedAt: 0 };
  return d;
}

function getNode(store, bookId, mapId, nodeId) {
  const d = getMaps(store, bookId);
  const map = (d.maps || []).find(m => m.id === mapId);
  if (!map) return null;
  const node = (map.nodes || []).find(n => n.id === nodeId);
  if (!node) return null;
  return { mapId, mapTitle: map.centerTitle, node };
}

module.exports = { generate, getMaps, getNode, mergeMaps, groupQuestions, buildRuleMaps };
