'use strict';
/**
 * 知识点关系图（思维导图的数据层）。
 * 节点 = 知识点；边 = 两类真实关系，全部来自已落盘的分析结果，不凭空造关系：
 *   ① co-question：同一道题同时考到的两个知识点（强关系）
 *   ② co-category：同一类别下的知识点（弱关系，用于布局分组）
 * 纯本地、零外部库，前端用 SVG 自绘。
 */
function buildGraph(analysis, opts) {
  const a = analysis || {};
  const maxNodes = Math.max(1, Math.min(200, (opts && opts.maxNodes) || 80));
  const points = (a.points || []).filter(p => p && p.id).slice(0, maxNodes);
  const ids = new Set(points.map(p => String(p.id)));
  const nodes = points.map(p => ({
    id: String(p.id),
    title: String(p.title || p.id),
    category: String(p.category || '未分类'),
    summary: String(p.summary || ''),
    questionCount: 0
  }));
  const byId = {};
  nodes.forEach(n => { byId[n.id] = n; });

  const pairKey = (x, y) => (x < y ? x + '|' + y : y + '|' + x);
  const edges = [];
  const edgeMap = {};

  for (const q of (a.questions || [])) {
    const ps = Array.from(new Set((q.pointIds || []).map(String).filter(x => ids.has(x))));
    ps.forEach(pid => { if (byId[pid]) byId[pid].questionCount += 1; });
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const k = pairKey(ps[i], ps[j]);
        if (!edgeMap[k]) {
          edgeMap[k] = { source: ps[i], target: ps[j], weight: 0, kind: 'co-question' };
          edges.push(edgeMap[k]);
        }
        edgeMap[k].weight += 1;
      }
    }
  }

  // 同类别补弱边，让只有孤立知识点时也能成图（不伪造"前置关系"）
  const byCat = {};
  nodes.forEach(n => { (byCat[n.category] = byCat[n.category] || []).push(n.id); });
  Object.keys(byCat).forEach(cat => {
    const list = byCat[cat];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = pairKey(list[i], list[j]);
        if (edgeMap[k]) continue;
        if (edges.length >= maxNodes * 3) return;
        edgeMap[k] = { source: list[i], target: list[j], weight: 0.5, kind: 'co-category', category: cat };
        edges.push(edgeMap[k]);
      }
    }
  });

  return { nodes, edges, categories: Object.keys(byCat) };
}

module.exports = { buildGraph };
