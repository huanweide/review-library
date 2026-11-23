/**
 * 教学化答题逻辑（纯函数，零依赖，可独立测试）。
 * 2026-11-23 · 需求 3/4/5：选项判分 + 思路点拨（不给答案）。
 *
 * 设计红线（用户原话）：
 * - 思路按钮「不给答案，给方法论，尽量给思路、总体方法、定义」；
 * - 定义题 → 给相近概念 / 上下游反刍，不给答案；
 * - 计算题 → 给方法论 + 定义。
 * 所以 hintFor() 只从「知识点定义 + 相邻概念 + 题型通用法」派生，绝不读 q.answer / q.solution 的结论。
 * 教学提示词已存在于 core/analyze.js（desc 三层递进），这里只消费，不重写。
 */

/** 从 "B. 主矢相同，主矩不同 —— ..." 里取正确选项字母。取不到返回 ''。 */
export function answerLetter(answer) {
  const s = String(answer == null ? '' : answer).trim();
  const m = s.match(/^([A-Da-d])[\.、：:）\)]/);
  if (m) return m[1].toUpperCase();
  // 判断题答案常是「B. 错误 —— ...」；也兼容「正确 / 错误」直接开头
  if (/^正确/.test(s)) return 'A';
  if (/^错误/.test(s)) return 'B';
  return '';
}

/** 从选项文本 "A. xxx" 里取字母；取不到返回 ''。 */
export function optionLetter(option) {
  const m = String(option == null ? '' : option).trim().match(/^([A-Da-d])[\.、：:）\)]/);
  return m ? m[1].toUpperCase() : '';
}

/** 判分：返回 'correct' | 'wrong' | 'unknown'（答案没有可判字母时不装懂）。 */
export function judge(question, pickedLetter) {
  const key = answerLetter(question && question.answer);
  if (!key || !pickedLetter) return 'unknown';
  return key === String(pickedLetter).toUpperCase() ? 'correct' : 'wrong';
}

/** desc 三层递进拆段：「是什么；怎么考；易错」。拆不出时原样返回一段。 */
export function splitDesc(desc) {
  const raw = String(desc == null ? '' : desc).trim();
  if (!raw) return { what: '', exam: '', trap: '' };
  const parts = raw.split(/[；;]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1) return { what: parts[0], exam: '', trap: '' };
  return {
    what: parts[0] || '',
    exam: parts[1] || '',
    trap: parts.slice(2).join('；') || '',
  };
}

const METHOD_BY_TYPE = {
  '选择题': '先看题干问的是「定义」还是「应用」：定义题逐项对照概念成立条件；应用题先找已知量与目标量的关系，再排除明显违背前提的选项。',
  '判断题': '把句子拆成主谓宾，逐词对照定义成立条件；只要有一个条件不满足就是错。警惕把「一定 / 必然 / 只能」这类绝对化说法当结论。',
  '名词解释': '按「属 + 种差」答：先说它属于哪一类，再说它和同类相比的特殊点，最后补一个反例或适用边界。',
  '填空题': '先确认空格要的是定义、公式还是结论；回忆时想它的上下游——谁推出它、它能推出谁。',
  '简答题': '先摆定义，再给成立条件，再说怎么用它，最后举一个最小例子；四步齐全比堆字数得分高。',
  '计算题': '先写已知 / 求 / 依据定理；把文字翻译成符号与图，列方程后再代数，最后回代检验量纲与边界。',
  '综合应用题': '先拆成若干个单一知识点，逐个写清用的定理，再按题目顺序串起来；每步都回头对一次已知条件。',
};

/**
 * 思路点拨：只给「方法 + 定义 + 相邻概念反刍」，绝不给答案。
 * @param q 题目（只读 answer/solution 字段用于判断题型，不取其结论文本）
 * @param ctx { type, point, siblings } point=当前知识点节点，siblings=同层相邻节点标题数组
 */
export function hintFor(q, ctx) {
  const o = ctx || {};
  const type = String(o.type || (q && q.type) || '').trim();
  const point = o.point || null;
  const siblings = Array.isArray(o.siblings) ? o.siblings : [];
  const d = splitDesc(point && point.desc);
  const out = [];

  // 1) 这道题在考什么位置（来自 pointPath，是事实不是编造）
  const path = (q && Array.isArray(q.pointPath)) ? q.pointPath : [];
  if (path.length) out.push({ t: '先定位', body: '这道题落在：' + path.join(' › ') + '。先想这一节讲的是哪个概念。' });

  // 2) 方法论（按题型给通用法，不针对这道题给结论）
  const method = METHOD_BY_TYPE[type];
  if (method) out.push({ t: type + '通用做法', body: method });

  // 3) 定义反刍（来自节点 desc 的「是什么」层——已有教学提示词的产物）
  if (d.what) out.push({ t: '先回忆定义', body: d.what });

  // 4) 上下游 / 相近概念（相邻节点标题，让用户去对比，而不是直接告诉他答案）
  if (siblings.length) out.push({ t: '和谁容易混', body: '把这几个放在一起比一比：' + siblings.slice(0, 4).join('、') + '。想清楚它们的成立条件差在哪。' });

  if (!out.length) out.push({ t: '先想一步', body: '先看题干问的是定义还是应用，写出你知道的相关定义，再回到选项逐个对照。' });
  return out;
}
