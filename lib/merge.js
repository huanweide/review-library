/**
 * merge.js —— 天道书院 · 增量合并器（本轮需求的核心）
 *
 * 需求原文：如果新加文档，则【只分析新加的部分】，然后【加到目前各种对应位置】。
 *
 * 策略（为什么不逐字段拼接）：
 *   旧 tree 与新 tree 按标题有序合并（旧在前、新追加或并入同名章）；
 *   旧 questionIndex 与新 questionIndex 有序拼接（旧在前）。
 *   再把合并结果整体重跑适配器 → 旧题 id(Q-1..Q-N) 与旧知识点编号(1.1.1...)因顺序不变而保持，
 *   新题从 Q-N+1 续接、新知识点编号顺延；digest/syllabus/mindmap 全部自动包含新内容，
 *   绝不会出现"题加进去了但考点大全没更新"的静默失效。
 *
 * 不造假：新题的 quoteVerified 由调用方用【新语料】跑官方 verifyQuotes 写回后才传入。
 */
'use strict';
const Adapter = require('../assets/js/adapter');

function titleKey(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

// 合并两棵四层树：旧节点保序，新章若同名则并入其节，新节/新点追加。
function mergeTrees(oldTree, newTree) {
  const base = JSON.parse(JSON.stringify(obj(oldTree)));
  const incoming = obj(newTree);
  if (!base.children) base.children = [];
  base.type = base.type || 'root';
  base.title = base.title || '全书';
  const chapterMap = {};
  base.children.forEach(ch => { chapterMap[titleKey(ch.title)] = ch; });

  arr(incoming.children).forEach(nch => {
    const key = titleKey(nch.title);
    const existing = chapterMap[key];
    if (!existing) {
      // 新章：分配不冲突的 id，整章追加
      base.children.push(cloneWithNewIds(nch, 'ch' + base.children.length));
      chapterMap[key] = base.children[base.children.length - 1];
      return;
    }
    // 同名章：节按标题并入/追加
    const secMap = {};
    arr(existing.children).forEach(sec => { secMap[titleKey(sec.title)] = sec; });
    arr(nch.children).forEach(nsec => {
      const skey = titleKey(nsec.title);
      const esec = secMap[skey];
      if (!esec) {
        existing.children.push(cloneWithNewIds(nsec, 'sec' + arr(existing.children).length));
        secMap[skey] = existing.children[existing.children.length - 1];
        return;
      }
      // 同名节：知识点按标题去重追加
      const ptKeys = {};
      arr(esec.children).forEach(pt => { ptKeys[titleKey(pt.title)] = true; });
      arr(nsec.children).forEach(npt => {
        if (ptKeys[titleKey(npt.title)]) return; // 同名知识点不重复加
        esec.children.push(cloneWithNewIds(npt, 'pt' + arr(esec.children).length));
        ptKeys[titleKey(npt.title)] = true;
      });
    });
  });
  return base;
}

// 深拷贝并为节点及子孙分配新 id（避免与旧 tree 的 n0_0/n1_1 冲突）
function cloneWithNewIds(node, prefix) {
  const c = JSON.parse(JSON.stringify(obj(node)));
  c.id = prefix + '_' + Math.random().toString(36).slice(2, 8);
  arr(c.children).forEach((child, i) => { c.children[i] = cloneWithNewIds(child, prefix + '_' + i); });
  return c;
}

// 用合并后的 tree 建立「标题路径 → 节点 id」映射，回填题的 pointId。
// 不这么做：合并时新节点被重新分配 id，题的 pointId 还指向旧 id，adapter 反查不到 →
// kp 关联错到别的节（实测 Q4 的 kp 从 2.2 错成 1.2）。这是静默数据错误，必须修。
function rebindPointIds(tree, questionIndex) {
  const pathToId = {};
  const validIds = {};
  function walk(node, chain) {
    const c = arr(node && node.children);
    if (!c.length) return;
    c.forEach(child => {
      const next = chain.concat(String((child && child.title) || ''));
      pathToId[pathKey(next)] = child.id;
      validIds[child.id] = true;
      walk(child, next);
    });
  }
  walk(tree, []);
  arr(questionIndex).forEach(g => arr(g.items).forEach(it => {
    arr(it.questions).forEach(q => {
      // 一律按 pointPath（语义路径，权威）精确匹配回填，不靠 pointId 是否"看起来有效"判断。
      // 根因：LLM 生成的新 id 可能撞上旧树 id，用 validIds 跳过会让新题的 pointId 保留错值 →
      // kp 挂到旧知识点（实测 Q-4 从 3.1.1 错成 1.1.1）。旧题的 pointPath 也能精确命中旧节点，
      // 所以统一回填对旧题是安全的（前提是旧节点标题未被改动）。
      const pp = arr(q && q.pointPath);
      const id = pathToId[pathKey(pp)];
      if (id) { q.pointId = id; if (it.pointId !== undefined) it.pointId = id; }
    });
    const ip = arr(it.path);
    const iid = pathToId[pathKey(ip)];
    if (iid) it.pointId = iid;
  }));
  return questionIndex;
}
function pathKey(pathArr) { return arr(pathArr).map(titleKey).join('\u0001'); }

// 从现有 bookData 反推 questionIndex（旧数据无 _trace.questionIndex 时用）。
// 重建保住：题型分组、题面、答案、分步解答、思路、易错、来源、核验状态、知识点路径。
// 来源从 _trace.byQuestion 取（结构化 file/anchor/quote），拿不到就填占位但【不谎称已核】。
function rebuildQuestionIndex(book) {
  const byQ = obj((book._trace && book._trace.byQuestion) || {});
  const groups = {};
  arr(book.tiku).forEach((q, i) => {
    const type = String(q.type || '其他');
    if (!groups[type]) groups[type] = { type, items: [] };
    const ans = obj((book.tikuAns || {})[q.id]);
    const tr = obj(byQ[q.id]);
    const path = [String(q.chLabel || ''), String(q.sec || ''), String(q.kp || '')].filter(Boolean);
    const question = {
      stem: String(q.stem || ''),
      options: arr(q.options),
      answer: String(ans.ans || ''),
      solution: arr(ans.solution),
      rationale: String(ans.rationale || ans.why || ''),
      pitfalls: String(ans.pitfalls || ''),
      difficulty: String(ans.difficulty || ''),
      pointPath: path,
      source: {
        file: String(tr.file || ''),
        page: tr.page == null ? 0 : tr.page,
        anchor: String(tr.anchor || ''),
        quote: String(tr.quote || '')
      },
      quoteVerified: tr.quoteVerified === true
    };
    let item = arr(groups[type].items).find(it => String(it.title) === '原书题目');
    if (!item) { item = { title: '原书题目', path: path.slice(0, 2), questions: [] }; groups[type].items.push(item); }
    item.questions.push(question);
  });
  return Object.values(groups);
}

// 合并 questionIndex：保住旧题的【全局展平顺序】——这是题 id(Q-N) 稳定的命门。
// 绝不能把新题塞进同题型组的中间：旧简答题会从 Q-3 漂到 Q-4，用户进度按 id 存，进度就丢了。
// 做法：给每道旧题打全局序号标记，新题单独放到末尾的新组，展平时旧题在前、新题在后。
function mergeQuestionIndex(oldQI, newQI) {
  const out = JSON.parse(JSON.stringify(arr(oldQI)));
  const seen = {};
  arr(out).forEach(g => arr(g.items).forEach(it => arr(it.questions).forEach(q => { seen[stemKey(q.stem)] = true; })));
  // 新题收集到「增量」专用组（同题型归到同名增量组），一律追加在 out 末尾 → 展平顺序稳定
  const byType = {};
  arr(newQI).forEach(ng => {
    const t = String(obj(ng).type) || '其他';
    if (!byType[t]) { byType[t] = { type: t, items: [], _incremental: true }; out.push(byType[t]); }
    const g = byType[t];
    const stems = {};
    arr(g.items).forEach(it => arr(it.questions).forEach(q => { stems[stemKey(q.stem)] = true; }));
    arr(obj(ng).items).forEach(nit => {
      const fresh = arr(obj(nit).questions).filter(q => !seen[stemKey(q.stem)] && !stems[stemKey(q.stem)]);
      if (!fresh.length) return;
      const target = arr(g.items).find(it => String(it.title) === String(obj(nit).title));
      if (target) target.questions = arr(target.questions).concat(fresh);
      else g.items.push({ title: obj(nit).title || '新增题', path: obj(nit).path || [], questions: fresh });
      fresh.forEach(q => { seen[stemKey(q.stem)] = true; stems[stemKey(q.stem)] = true; });
    });
  });
  // 清掉空的新组
  return out.filter(g => arr(g.items).some(it => arr(it.questions).length));
}
function stemKey(s) { return String(s || '').replace(/\s+/g, ''); }

/**
 * 增量合并主函数。
 * @param existingBook 现有 bookData（含 mindmap.tree / _trace.codes）
 * @param newAnalysis  LLM 对本轮新增文档的 analysis（tree/questionIndex/summary），题的 quoteVerified 已核验写回
 * @param newFiles     本轮新增的文件清单（含 name/focus/note/isImage）
 * @param opts         { mergedQuoteAudit, truncated, coverage } 可选
 * @returns 新的完整 bookData（旧 id/编号保序，新内容续接）
 */
function mergeAnalysis(existingBook, newAnalysis, newFiles, opts) {
  const o = opts || {};
  const book = obj(existingBook);
  const oldTree = book.mindmap && book.mindmap.tree ? book.mindmap.tree : { type: 'root', title: (book.meta && book.meta.title) || '全书', children: [] };
  // 从现有 bookData 反推旧 questionIndex 不现实（已拆成 tiku/tikuAns），改从 _trace 保留的原始索引取；
  // 若没有则用一个空索引——此时旧题不会重编号（因为新 analysis 只含新题，旧题靠下方"旧题保留"逻辑补回）。
  let oldQI = arr(book._trace && book._trace.questionIndex);
  // 兼容旧数据：早期 bookData 没有 _trace.questionIndex 字段。若直接从 tiku 重建，
  // 否则旧题会在第一次增量时全部丢失（实测 3 题→1 题）。绝不静默丢用户数据。
  if (!oldQI.length && arr(book.tiku).length) oldQI = rebuildQuestionIndex(book);
  const mergedTree = mergeTrees(oldTree, obj(newAnalysis).tree);
  const mergedQI = mergeQuestionIndex(oldQI, obj(newAnalysis).questionIndex);
  // 关键：合并后按标题路径回填 pointId，否则新题关联错节（静默数据错误）
  rebindPointIds(mergedTree, mergedQI);

  // 用官方适配器重跑，得到统一格式的新 bookData
  const mergedAnalysis = {
    tree: mergedTree,
    questionIndex: mergedQI,
    summary: String(newAnalysis.summary || (book.meta && book.meta.summary) || ''),
    stats: obj(newAnalysis.stats),
    quoteAudit: o.mergedQuoteAudit || (book._trace && book._trace.quoteAudit) || {}
  };
  const oldMeta = obj(book.meta);
  const next = Adapter.buildBookData({
    analysis: mergedAnalysis,
    meta: {
      id: oldMeta.id || 'book', title: oldMeta.title || '全书',
      subject: oldMeta.subject || '备考', coverColor: oldMeta.coverColor, accent: oldMeta.accent,
      syllabus: oldMeta.syllabus, createdAt: oldMeta.createdAt, desc: oldMeta.desc
    },
    // 新文件通常已在 book.refs 里（上传时登记过），按 name 去重，避免资料清单翻倍
    files: (() => {
      const seen = {};
      return arr(book.refs).concat(arr(newFiles)).filter(f => {
        const n = String((f && f.name) || '');
        if (!n || seen[n]) return false;
        seen[n] = true; return true;
      });
    })(),
    documents: {}
  });
  // 保留/更新分析溯源
  const analyzed = arr(o.analyzedFiles || (book._trace && book._trace.analyzedFiles));
  arr(newFiles).forEach(f => {
    const name = String((f && f.name) || '');
    if (name && analyzed.indexOf(name) < 0) analyzed.push(name);
  });
  next._trace.analyzedFiles = analyzed;
  next._trace.incremental = true;
  next._trace.lastAnalysis = {
    at: new Date().toISOString(),
    newFiles: arr(newFiles).map(f => String((f && f.name) || '')),
    truncated: !!o.truncated,
    coverage: o.coverage || null
  };
  next.meta.source = '天道书阁 · 增量分析';
  return next;
}

module.exports = { mergeAnalysis, mergeTrees, mergeQuestionIndex, rebindPointIds, titleKey, stemKey };
