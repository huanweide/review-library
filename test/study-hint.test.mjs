/**
 * 教学化答题逻辑判别（2026-11-23 · 需求 3/4/5）。
 * 最关键一条：hintFor() 绝不能吐出答案结论——「思路不给答案」是用户硬约束。
 */
import { answerLetter, optionLetter, judge, splitDesc, hintFor } from '../workbench/src/study-hint.mjs';

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};

console.log('== answerLetter ==');
ok(answerLetter('B. 主矢相同，主矩不同 —— 主矢是矢量和') === 'B', '带破折号解释的字母答案',
  'got=' + answerLetter('B. 主矢相同，主矩不同 —— 主矢是矢量和'));
ok(answerLetter('A. 正确') === 'A', 'A 选项');
ok(answerLetter('正确 —— 因为...') === 'A', '判断题「正确」开头');
ok(answerLetter('错误 —— 平移不一定是直线') === 'B', '判断题「错误」开头');
ok(answerLetter('') === '', '空答案不装懂');

console.log('\n== optionLetter / judge ==');
ok(optionLetter('C. 主矢不同，主矩相同') === 'C', '选项取字母');
ok(judge({ answer: 'B. xxx —— yyy' }, 'B') === 'correct', '选对判 correct');
ok(judge({ answer: 'B. xxx —— yyy' }, 'D') === 'wrong', '选错判 wrong');
ok(judge({ answer: 'B. xxx' }, '') === 'unknown', '未选判 unknown');
ok(judge({ answer: '' }, 'A') === 'unknown', '无答案判 unknown 不装懂');

console.log('\n== splitDesc ==');
const parts = splitDesc('固定铰反力沿销钉径向，用两个正交分力表示；考试中几乎必考受力图；最容易错在多画一个分力');
ok(!!parts.what && !!parts.exam && !!parts.trap, '三层递进正确拆段', JSON.stringify(parts));
ok(splitDesc('只有一句').what === '只有一句' && !splitDesc('只有一句').exam, '单句时只给 what');

console.log('\n== hintFor：绝不泄露答案 ==');
const q = {
  type: '选择题',
  answer: 'B. BD杆不是二力杆 —— BD杆在B、C、D三处受力',
  solution: ['第1步：辨认二力杆条件', '第2步：观察BD杆三处受力', '第3步：三力汇交'],
  pointPath: ['第一篇 静力学', '第一讲 静力学公理', '公理1：二力平衡公理'],
};
const ctx = {
  type: '选择题',
  point: { desc: '二力杆只在两端受力、不计自重；常以受力图形式考；易错在只看杆是直的就当二力杆' },
  siblings: ['公理2：加减平衡力系', '约束与约束力', '平面汇交力系'],
};
const hints = hintFor(q, ctx);
const flat = hints.map((h) => h.t + h.body).join('\n');
ok(hints.length >= 3, '思路点拨至少 3 段', 'got=' + hints.length);
ok(!flat.includes('不是二力杆'), '思路不含答案结论「不是二力杆」');
ok(!flat.includes('B.') && !flat.includes('选 B'), '思路不含选项字母');
ok(!flat.includes('三力汇交'), '思路不含 solution 里的具体解题结论');
ok(flat.includes('二力杆只在两端受力'), '思路含定义反刍');
ok(flat.includes('公理2') || flat.includes('约束与约束力'), '思路含相邻概念');
ok(hints.some((h) => h.t === '选择题通用做法'), '含题型通用方法');

console.log('\n== hintFor：定义题给相近概念 ==');
const defQ = { type: '判断题', answer: 'B. 错误 —— 平移不限直线', pointPath: ['运动学', '刚体基本运动'] };
const defHints = hintFor(defQ, { type: '判断题', point: null, siblings: ['刚体定轴转动', '刚体平面运动'] });
const defFlat = defHints.map((h) => h.body).join('\n');
ok(!defFlat.includes('错误') || !defFlat.includes('平移不限'), '定义题思路不给答案');
ok(defFlat.includes('刚体定轴转动'), '定义题思路给相近概念');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
