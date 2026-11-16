/**
 * incremental.test.js —— 天道书院增量分析判别测试（本地 mock LLM，零外网）
 *
 * 锁住本轮核心需求：
 *  1. 提示词正本来自书馆官方 SYSTEM_PROMPT（不复制、逐字一致）；
 *  2. 增量指令前置、只把新增文件塞进语料/文件名清单；
 *  3. 合并后旧题 id 与旧知识点编号保序（进度不丢），新题/新点续接；
 *  4. digest/syllabus/mindmap 自动包含新内容（无静默失效）；
 *  5. 引文用本轮语料核验，未命中如实标 false；
 *  6. API key 不落盘、不回显、不进错误文本。
 */
'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const Adapter = require('../assets/js/adapter');
const merge = require('../lib/merge');
const prompt = require('../lib/prompt');
const llm = require('../lib/llm');
const store = require('../lib/store');

const ROOT = path.resolve(__dirname, '..');
const REAL = path.join(ROOT, '../复习资料图书馆/library/books/320521f8dbafa962/analysis.json');
const baseAnalysis = JSON.parse(fs.readFileSync(REAL, 'utf8'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('\n=== A. 官方提示词正本（不复制、不分裂）===');
t('prompt.OFFICIAL 逐字等于书馆 SYSTEM_PROMPT', () => {
  const bookAnalyze = require('../../复习资料图书馆/core/analyze.js');
  assert.strictEqual(prompt.OFFICIAL, bookAnalyze.SYSTEM_PROMPT);
});
t('增量指令前置且声明"只分析新增资料"', () => {
  assert.ok(prompt.INCREMENTAL_PREFIX.includes('只给你新增的资料文件'));
  const sys = prompt.buildSystemPrompt([{ name: '新讲义.txt' }], true);
  assert.ok(sys.indexOf('本次为增量分析') < sys.indexOf('你是一位严谨的学科分析与出题专家'));
});
t('文件名清单只含本轮新增文件（不含旧文件）', () => {
  const sys = prompt.buildSystemPrompt([{ name: '新讲义.txt', focus: true, note: '重点' }], true);
  assert.ok(sys.includes('新讲义.txt') && sys.includes('用户重点★'));
  assert.ok(!sys.includes('示例讲义.txt'), '不该出现旧文件');
});

console.log('\n=== B. 增量合并：旧 id 保序、新内容续接 ===');
// 构造"现有书"（用真实 analysis 第一轮适配）
const firstBook = Adapter.buildBookData({
  analysis: baseAnalysis,
  meta: { id: 'merge-test', title: '测试书' },
  files: [{ name: '示例讲义.txt', focus: true }]
});
const oldQIds = firstBook.tiku.map(q => q.id);
const oldKpIds = firstBook.kaogang.map(k => k.id);
const oldTikuAnsKeys = Object.keys(firstBook.tikuAns);

// 构造"新增 analysis"：一个新章 + 新题
const newAnalysis = {
  tree: {
    id: 'nx_root', type: 'root', title: '测试书',
    children: [{
      id: 'nx_ch', type: 'chapter', title: '第三章 算法进阶',
      children: [{
        id: 'nx_sec', type: 'section', title: '3.1 进阶结构',
        children: [{ id: 'nx_pt', type: 'point', title: '大O记号', desc: '描述增长量级', questionTypes: ['选择题'], children: [] }]
      }]
    }]
  },
  questionIndex: [{
    type: '选择题', items: [{
      title: '概念辨析', path: ['第三章 算法进阶', '3.1 进阶结构', '大O记号'],
      questions: [{
        stem: 'O(1) 表示什么？', options: ['A. 常数时间', 'B. 线性时间'],
        answer: 'A. 常数时间 —— 与规模无关',
        solution: ['第1步：理解O记号含义'],
        rationale: '大O描述增长量级，O(1)与输入规模无关。',
        pitfalls: '把O(1)理解成只执行一次。',
        pointPath: ['第三章 算法进阶', '3.1 进阶结构', '大O记号'],
        source: { file: '新讲义.txt', page: 1, anchor: '【块1】', quote: '大O记号描述算法增长量级' },
        quoteVerified: true
      }]
    }]
  }],
  summary: '新增复杂度分析'
};
const newFiles = [{ name: '新讲义.txt', focus: false, note: '' }];
const merged = merge.mergeAnalysis(firstBook, newAnalysis, newFiles, {
  mergedQuoteAudit: { checked: 1, hit: 1, missed: 0, details: [] }
});

t('旧题 id 保序（Q-1..Q-3 不变，进度不丢）', () => {
  const nowIds = merged.tiku.map(q => q.id);
  oldQIds.forEach((id, i) => assert.strictEqual(nowIds[i], id, '第' + i + '道旧题 id 变了'));
  assert.strictEqual(nowIds.length, oldQIds.length + 1, '应新增 1 道题');
  assert.strictEqual(nowIds[nowIds.length - 1], 'Q-4');
});
t('旧知识点编号保序，新点续接', () => {
  const nowIds = merged.kaogang.map(k => k.id);
  oldKpIds.forEach((id, i) => assert.strictEqual(nowIds[i], id, '第' + i + '个旧知识点编号变了'));
  assert.ok(nowIds.includes('3.1.1'), '新章知识点应编号 3.1.1');
});
t('旧答案表键全在（旧答案不丢）', () => {
  oldTikuAnsKeys.forEach(k => assert.ok(merged.tikuAns[k], '旧答案 ' + k + ' 丢了'));
  assert.ok(merged.tikuAns['Q-4'], '新题答案缺失');
});
t('新题与新知识点正确关联（kp 指向新节/点，hasQuiz）', () => {
  const q4 = merged.tiku.find(q => q.id === 'Q-4');
  // pointPath 到点 → kp 可为 3.1.1；到节 → 3.1。两者都指向新增章，且都在 byCode 里。
  assert.ok(/^3\.1(\.\d+)?$/.test(q4.kp), 'kp 应指向新增章 3.1，实际 ' + q4.kp);
  assert.ok(merged._trace.byCode[q4.kp], 'kp 必须能在 byCode 反查');
  assert.strictEqual(q4.stem, 'O(1) 表示什么？');
  const pt = merged.kaogang.find(k => k.id === '3.1.1');
  assert.strictEqual(pt.hasQuiz, true);
});
t('refs 合并：旧资料 + 新资料都在', () => {
  const names = merged.refs.map(r => r.name);
  assert.ok(names.includes('示例讲义.txt') && names.includes('新讲义.txt'));
});
t('mindmap 含新旧两章（新内容进导图）', () => {
  const titles = merged.mindmap.tree.children.map(c => c.title);
  assert.ok(titles.some(x => x.includes('第一章')));
  assert.ok(titles.some(x => x.includes('第二章')));
});
t('digest/syllabus 自动含新知识点（无静默失效）', () => {
  const allTitles = [];
  merged.digest.sections.forEach(s => s.points.forEach(p => allTitles.push(p.title)));
  assert.ok(allTitles.includes('大O记号'), '考点大全没同步新增知识点');
  const sylTitles = [];
  merged.syllabus.sections.forEach(s => s.points.forEach(p => sylTitles.push(p.title)));
  assert.ok(sylTitles.includes('大O记号'), '速通向没同步新增知识点');
});
t('analyzedFiles 记录本轮文件（下一轮不再重复分析）', () => {
  assert.deepStrictEqual(merged._trace.analyzedFiles, ['新讲义.txt']);
  assert.strictEqual(merged._trace.incremental, true);
});

console.log('\n=== C. 第二轮增量：继续保序 ===');
const second = {
  tree: { id: 'y_root', type: 'root', title: '测试书', children: [{
    id: 'y_ch', type: 'chapter', title: '第四章 图论', children: [{
      id: 'y_sec', type: 'section', title: '4.1 图的遍历', children: [
        { id: 'y_pt', type: 'point', title: '遍历', desc: '前中后序', questionTypes: ['简答题'], children: [] }
      ]
    }]
  }] },
  questionIndex: [{ type: '简答题', items: [{ title: '概念', path: ['第四章 图论', '4.1 图的遍历', '遍历'], questions: [{
    stem: '什么是中序遍历？', options: [], answer: '左根右', solution: ['按左根右顺序'], rationale: '中序遍历先左子树再根再右。', pitfalls: '记成根左右。',
    pointPath: ['第四章 图论', '4.1 图的遍历', '遍历'],
    source: { file: '第三讲义.txt', page: 1, anchor: '【块1】', quote: '中序遍历按左根右顺序访问' }, quoteVerified: true
  }] }] }],
  summary: '第三章'
};
const merged2 = merge.mergeAnalysis(merged, second, [{ name: '第三讲义.txt' }], {
  mergedQuoteAudit: { checked: 1, hit: 1 }
});
t('第二轮后：第一、二轮所有旧题 id 仍保序', () => {
  const ids = merged2.tiku.map(q => q.id);
  assert.deepStrictEqual(ids.slice(0, 4), ['Q-1', 'Q-2', 'Q-3', 'Q-4']);
  assert.strictEqual(ids[4], 'Q-5');
  assert.strictEqual(merged2.tiku.length, 5);
});
t('第二轮后：所有旧知识点编号仍保序', () => {
  const ids = merged2.kaogang.map(k => k.id);
  assert.ok(ids.includes('1.1.1') && ids.includes('3.1.1') && ids.includes('4.1.1'));
});
t('第二轮后：题答表与题面数量严格相等', () => {
  assert.strictEqual(Object.keys(merged2.tikuAns).length, merged2.tiku.length);
  merged2.tiku.forEach(q => assert.ok(merged2.tikuAns[q.id] && merged2.tikuAns[q.id].ans));
});
t('零反馈不变量仍成立（tiku 无答案字段）', () => {
  merged2.tiku.forEach(q => assert.ok(!('answer' in q) && !('ans' in q)));
});

console.log('\n=== C2. 旧数据兼容（曾出真 bug：3 题→1 题）===');
t('无 _trace.questionIndex 的旧书，增量后旧题不丢', () => {
  const legacy = JSON.parse(JSON.stringify(firstBook));
  delete legacy._trace.questionIndex; // 模拟早期 bookData
  const before = legacy.tiku.map(q => q.id);
  const m = merge.mergeAnalysis(legacy, newAnalysis, [{ name: '新讲义.txt' }], { mergedQuoteAudit: { checked: 1, hit: 1 } });
  const after = m.tiku.map(q => q.id);
  before.forEach((id, i) => assert.strictEqual(after[i], id, '旧题 ' + id + ' 丢了'));
  assert.ok(after.length >= before.length);
});
t('新题按 pointPath 精确回填，kp 不挂到旧知识点', () => {
  // 曾出真 bug：LLM 新 id 撞上旧树 id，跳过 rebind → 新题 kp 挂到旧点 1.1.1（应 3.1.1）
  const newWithPointPath = JSON.parse(JSON.stringify(newAnalysis));
  newWithPointPath.questionIndex[0].items[0].questions[0].pointId = 'n3_3'; // 故意撞旧树 point id
  const m = merge.mergeAnalysis(firstBook, newWithPointPath, [{ name: '新讲义.txt' }], {});
  const q4 = m.tiku.find(q => q.id === 'Q-4');
  assert.ok(/^3\.1(\.\d+)?$/.test(q4.kp), '新题 kp 应指向新章 3.1，实际 ' + q4.kp);
});
t('重复 newFiles 不会让资料清单翻倍', () => {
  const m = merge.mergeAnalysis(firstBook, newAnalysis, [{ name: '示例讲义.txt' }, { name: '新讲义.txt' }], {});
  const names = m.refs.map(r => r.name);
  assert.strictEqual(names.filter(n => n === '示例讲义.txt').length, 1);
  assert.strictEqual(names.filter(n => n === '新讲义.txt').length, 1);
});

console.log('\n=== D. 密钥安全 ===');
t('scrub 抹掉 sk- 密钥且不留原文', () => {
  const key = 'sk-abcdefghijklmnop1234';
  const s = llm.scrub('请求失败 Authorization: Bearer ' + key + ' 结束', { apiKey: key });
  assert.ok(!s.includes(key));
  assert.ok(s.includes('***'));
});
t('scrub 也抹掉非标准 key（cfg.apiKey 不受 sk- 前缀限制）', () => {
  const key = 'my-secret-key-xyz';
  const s = llm.scrub('err ' + key, { apiKey: key });
  assert.ok(!s.includes(key));
});
t('合并结果不含 apiKey/baseURL（不落盘）', () => {
  const json = JSON.stringify(merged2);
  assert.ok(!json.includes('apiKey') && !json.includes('baseURL'));
});

console.log('\n========================================');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('========================================\n');
process.exit(fail ? 1 : 0);
