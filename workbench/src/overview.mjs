// 「这本书讲什么」的诚实兜底（2026-11-21）。
//
// 根因：core/analyze.js:502 把模型可选字段 summary 直接 String(...) 成空串，
// 而 validate() 只强检 outline.children——所以一次成功的分析也可能没有摘要。
// 旧界面把它显示成「（模型没有给摘要）」，用户以为分析没做。
//
// 判据（阶段零锚点见 PROCESS/research-概览与导图可读性/best-practices.md）：
//   1) 只用 analysis.json 里真实存在的 tree / questionIndex / stats 字段，一个形容词都不编；
//   2) 老书的 stats 键名不同（chapterCount / pointCount），一律先数真实节点，stats 只当加速路径；
//   3) 没有题就别写「共 0 道题」；没有知识结构就明说没有，不摆空壳；
//   4) 派生内容必须标注来源，不能冒充模型原文。

const pick = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v : []);

function countPoints(node, acc = []) {
  if (!node) return acc;
  if (node.type === 'point' || (!node.children && node.title && node.id)) acc.push(node);
  list(node.children).forEach((c) => countPoints(c, acc));
  return acc;
}

function flattenPoints(node, acc = []) {
  if (!node) return acc;
  if (node.type === 'point') acc.push(node);
  list(node.children).forEach((c) => flattenPoints(c, acc));
  return acc;
}

/** 题型统计：新书读 stats，老书直接数 questionIndex 里的真实题目。 */
function countQuestions(a) {
  const st = a && a.stats && typeof a.stats === 'object' ? a.stats : {};
  const byType = {};
  let total = 0;
  const idx = list(a && a.questionIndex);
  if (idx.length) {
    idx.forEach((g) => {
      const type = pick(g && g.type) || '未分类';
      // 真实 questionIndex 的题挂在 g.points[].questions；老格式可能叫 items。两种都认，
      // 不认就会把 14 道题数成 0，然后界面「共 0 道题」——正是要修的那种假空态。
      const groups = list(g && g.points).length ? list(g && g.points) : list(g && g.items);
      const n = groups.reduce((sum, item) => sum + list(item && item.questions).length, 0);
      byType[type] = (byType[type] || 0) + n;
      total += n;
    });
  }
  // stats 只在 questionIndex 没给出任何题时才用；两者同时存在时以真实题目为准。
  if (!total) {
    total = Number(st.questionCount) || 0;
    const counts = st.questionTypeCounts && typeof st.questionTypeCounts === 'object' ? st.questionTypeCounts : {};
    Object.keys(counts).forEach((k) => { byType[k] = Number(counts[k]) || 0; });
  }
  return { total, byType };
}

/**
 * @returns {{kind:'model'|'derived'|'empty', points:Array<{label:string,text:string}>, note:string}}
 */
export function deriveOverview(a) {
  const analysis = a && typeof a === 'object' ? a : {};
  const modelText = pick(analysis.summary);
  if (modelText) {
    return {
      kind: 'model',
      points: [{ label: '全书概览', text: modelText }],
      note: '',
    };
  }

  const tree = analysis.tree && typeof analysis.tree === 'object' ? analysis.tree : null;
  const chapters = list(tree && tree.children).map((c) => pick(c && c.title)).filter(Boolean);
  if (!tree || !chapters.length) {
    return {
      kind: 'empty',
      points: [{ label: '暂无内容', text: '这本书还没有可用的知识结构，重新分析后再看。' }],
      note: '没有读取到任何章节，这里不替模型编写内容。',
    };
  }

  const st = analysis.stats && typeof analysis.stats === 'object' ? analysis.stats : {};
  const points = [];

  const topic = pick(tree.title) || '这本书';
  const chapterCount = chapters.length;
  points.push({
    label: '这本书',
    text: `《${topic}》按目录整理，共 ${chapterCount} 章。`,
  });

  const shown = chapters.slice(0, 6);
  points.push({
    label: '章节',
    text: shown.join('、') + (chapters.length > shown.length ? ` 等 ${chapterCount} 章。` : '。'),
  });

  const allPoints = flattenPoints(tree);
  const pointCount = Number(st.points) > 0 ? Number(st.points) : (countPoints(tree).length || allPoints.length);
  if (pointCount > 0) {
    points.push({ label: '知识点', text: `全书共 ${pointCount} 个知识点。` });
  }
  // 只取 2 个样例：基准要 4–6 条，题目统计才是学生最关心的那条，不能被样例挤掉。
  const samples = allPoints.filter((p) => pick(p && p.desc)).slice(0, 2);
  samples.forEach((p, i) => {
    points.push({
      // 用有字的标签而不是全角空格：空标签会让第二行从标签列开头排，和上一行不对齐。
      label: i === 0 ? '其中' : '另',
      text: `${pick(p.title)}：${pick(p.desc).slice(0, 100)}`,
    });
  });

  const q = countQuestions(analysis);
  if (q.total > 0) {
    const types = Object.keys(q.byType).filter((k) => q.byType[k] > 0);
    const typeText = types.length
      ? `，题型为 ${types.map((k) => k + ' ' + q.byType[k] + ' 题').join('、')}`
      : '';
    points.push({ label: '题目', text: `配套 ${q.total} 道题${typeText}。` });
  }

  // 基准建议 4–6 条；数据少时如实少几条，不为了凑数重复同一句话。
  return {
    kind: 'derived',
    points: points.slice(0, 6),
    note: '模型这次没写概览，上面是按目录与分析结果如实整理的结构（不是模型原文）。',
  };
}

export default { deriveOverview };
