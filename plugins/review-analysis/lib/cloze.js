'use strict';
/**
 * 主动回忆挖空卡（cloze）：从已落盘的知识点原文生成，不调模型、不编内容。
 * 对齐基准：Anki / RemNote 的 cloze 卡、examo.ai「Prompts retrieval」、中文「智能挖空训练」。
 *
 * 诚实边界：抽取的是原文里真实出现的词，答案就是被遮住的那一段；
 * 原文里找不到可遮的词就返回 null，不生成假答案。
 */
const STOP = new Set(['的', '了', '是', '在', '和', '与', '或', '及', '为', '由', '对', '中', '上', '下',
  '一个', '一种', '可以', '这个', '那个', '定义', '概念', '计算', '方法', '特点', '性质', '类型', '分类']);

function pickKey(title, summary) {
  const t = String(title || '').trim();
  // 优先用标题里「xx的定义 / xx的计算」的主体词
  const m = t.match(/^(.{2,12}?)(?:的定义|的计算|的分类|的特点|的性质|的推导|是什么|公式)$/);
  if (m && m[1]) return m[1];
  if (t && t.length >= 2 && t.length <= 14 && !STOP.has(t)) return t;
  // 退而求其次：正文里第一个够长、非停词的中文片段或数字/公式
  const s = String(summary || '');
  const nums = s.match(/\d+(?:\.\d+)?/);
  if (nums) return nums[0];
  const seg = s.split(/[，。；、：\s,.;:（）()]+/).find(x => x.length >= 2 && x.length <= 14 && !STOP.has(x));
  return seg || null;
}

function makeCloze(point, opts) {
  const p = point || {};
  const summary = String(p.summary || '').trim();
  const title = String(p.title || '').trim();
  if (!summary && !title) return null;
  const key = pickKey(title, summary);
  if (!key) return null;
  const text = summary || title;
  const idx = text.indexOf(key);
  const masked = idx >= 0
    ? text.slice(0, idx) + '____' + text.slice(idx + key.length)
    : '____（' + text.slice(0, 40) + (text.length > 40 ? '…' : '') + '）';
  return {
    id: String(p.id || ''),
    title,
    masked,
    answer: idx >= 0 ? key : text,
    hint: (opts && opts.hint) || (p.category ? '类别：' + p.category : ''),
    original: text,
    category: String(p.category || '未分类')
  };
}

function makeDeck(points, opts) {
  const list = (points || []).map(p => makeCloze(p, opts)).filter(Boolean);
  const cap = Math.max(1, Math.min(200, (opts && opts.limit) || 30));
  return list.slice(0, cap);
}

module.exports = { makeCloze, makeDeck, pickKey };
