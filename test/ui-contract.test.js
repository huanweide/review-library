/**
 * ui-contract.test.js —— 消费端契约：提示词要求的东西，界面必须真的显示出来
 *
 * 为什么要有这套：LLM 官方提示词要求每题给 solution(2-4 步)/rationale/pitfalls/difficulty，
 * 知识点要求 title/desc/questionTypes/子类；而 UI 曾经只渲染 ans+why，
 * 数据在、界面无 = 静默失效（用户看到的是"解析很抽象"，实际是没渲染）。
 * 这套测试锁住「渲染点存在 + 四处答案区统一收口 + 出题阶段绝不泄漏答案」。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'assets/js/ui.js'), 'utf8');
const AD = fs.readFileSync(path.join(ROOT, 'assets/js/adapter.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n     ' + (e.message || e)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }

console.log('\n=== A. 提示词要求的字段必须被消费 ===');

t('答案区渲染 分步解法 / 易错点 / 难度标签', () => {
  assert(UI.includes('ans-steps'), '缺分步解法容器 ans-steps');
  assert(UI.includes('易错点'), '缺易错点渲染');
  assert(UI.includes('diff-tag'), '缺难度标签 diff-tag');
  assert(/solution/.test(UI), '未消费 solution');
  assert(/pitfalls/.test(UI), '未消费 pitfalls');
  assert(/difficulty/.test(UI), '未消费 difficulty');
});

t('知识点区渲染 名称 / 说明 / 全题型 / 可练题号', () => {
  assert(UI.includes('kp-t'), '缺知识点名称 .kp-t');
  assert(UI.includes('kp-d'), '缺知识点说明 .kp-d');
  assert(UI.includes('questionTypes'), '未消费 questionTypes');
  assert(UI.includes('qIds'), '未消费 qIds（可练题号）');
  assert(UI.includes('kp-subs'), '缺细分子类渲染 .kp-subs');
});

t('考纲考点渲染 必背 / 公式 / 重要性 / 自编例题 / 分步', () => {
  ['必背解释', '公式', 'importance', '自编例题', 'steps'].forEach(k =>
    assert(UI.includes(k), '缺: ' + k));
});

console.log('\n=== B. 四处答案区统一收口（改一处不会漏三处）===');

t('answerDetailHTML 已定义，且调用点 ≥ 4', () => {
  assert(UI.includes('function answerDetailHTML'), '未定义 answerDetailHTML');
  const calls = (UI.match(/answerDetailHTML\(/g) || []).length;
  assert(calls >= 5, '调用点不足（1 定义 + 4 处使用），实际 ' + calls);
});

t('不再有裸拼「参考答案」的旧写法', () => {
  assert(!/<b>参考答案<\/b>　\$\{esc\(/.test(UI), '仍有未收口的旧渲染');
});

t('空字段不出空块（solution/pitfalls 需过滤）', () => {
  assert(UI.includes('function listOf'), '缺 listOf 过滤工具');
  assert(/if \(steps\.length\)/.test(UI), '分步解法未判空');
  // 易错点写法是 String(a.pitfalls || '').trim()，断言不能绑死到某个具体括号形态
  assert(/String\(a\.pitfalls\s*\|\|/.test(UI), '易错点未判空');
});

console.log('\n=== C. 零反馈机制不被答案渲染破坏 ===');

t('出题构造（buildQuestionHTML）绝不引用答案渲染', () => {
  const start = UI.indexOf('function buildQuestionHTML');
  assert(start > 0, '找不到 buildQuestionHTML');
  // 切到「下一个同级函数定义」为止，而不是切到 showResult——
  // answerDetailHTML 就定义在两者之间，切到 showResult 会把它的定义误算进 buildQuestionHTML。
  const tail = UI.slice(start + 10);
  const nextFn = tail.indexOf('\n  function ');
  assert(nextFn > 0, 'buildQuestionHTML 边界切取失败');
  const seg = UI.slice(start, start + 10 + nextFn);
  assert(seg.length > 100, 'buildQuestionHTML 片段过短');
  assert(!seg.includes('answerDetailHTML'), '出题阶段引用了答案渲染 = 交卷前泄漏');
  assert(!/A\[x\.id\]\.ans/.test(seg), '出题阶段直接读答案');
});

console.log('\n=== D. 适配器保留细节（缺了上面全白做）===');

t('flattenTree 输出 title / desc / questionTypes / subs / qIds', () => {
  ['title:', 'desc:', 'questionTypes:', 'subs,', 'qIds:'].forEach(k =>
    assert(AD.includes(k), '缺字段: ' + k));
});

t('linkKp 三向匹配（题挂在更细的点，祖先也要算命中）', () => {
  assert(AD.includes("c.indexOf(kid + '.') === 0"), '缺第三向匹配');
  assert(AD.includes('k.qIds = ids'), '未回填题号列表');
});

console.log('\n========================================');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('========================================\n');
process.exit(fail ? 1 : 0);
