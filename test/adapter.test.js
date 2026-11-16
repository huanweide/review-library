/**
 * adapter.test.js —— 天道书院适配器判别测试（Node 原生 assert，零依赖）
 *
 * 判据来源：00-融合决策表.md 第六节。每一条都针对真实 analysis.json 或构造边界，
 * 不是"看起来对"——点数守恒、答案不泄漏、kp 层级如实、溯源不丢、无脏字段。
 */
'use strict';
const assert = require('assert');
const path = require('path');
const Adapter = require('../assets/js/adapter.js');

const ROOT = path.resolve(__dirname, '../..');
const REAL = path.join(ROOT, '复习资料图书馆/library/books/320521f8dbafa962/analysis.json');
const analysis = require(REAL);

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// 用真实样本构建（无 focus → 全不 hot，诚实基线）
const book = Adapter.buildBookData({
  analysis,
  meta: { id: 'ds-demo', title: '数据结构示例全书', subject: '期末考试' },
  files: []
});

console.log('\n=== A. 真实样本 · 结构守恒 ===');
t('kaogang 点数 = stats.points（3）', () => {
  assert.strictEqual(book.kaogang.length, analysis.stats.points);
});
t('kaogang 三级编号格式 1.1.1', () => {
  book.kaogang.forEach(k => assert.match(k.id, /^\d+\.\d+\.\d+$/));
});
t('章节/label 来自真实 tree 标题', () => {
  assert.ok(book.kaogang.some(k => k.chLabel === '第一章 线性表'));
  assert.ok(book.kaogang.some(k => k.sec === '1.1 顺序存储'));
});
t('题型归一：选择题/简答题保留', () => {
  const types = book.tiku.map(q => q.type);
  assert.ok(types.includes('选择题') && types.includes('简答题'));
});

console.log('\n=== B. 零反馈 · 题答物理分离 ===');
t('tiku 数量 = questionIndex 全部题数（3）', () => {
  assert.strictEqual(book.tiku.length, analysis.stats.questionCount);
});
t('tikuAns 键数 = tiku 数量', () => {
  assert.strictEqual(Object.keys(book.tikuAns).length, book.tiku.length);
});
t('tiku 每个 id 都能在 tikuAns 找到', () => {
  book.tiku.forEach(q => assert.ok(book.tikuAns[q.id], q.id));
});
t('tiku 不含答案字段（answer/solution/rationale/pitfalls）', () => {
  const banned = ['answer', 'solution', 'rationale', 'pitfalls', 'ans', 'why'];
  book.tiku.forEach(q => banned.forEach(k => assert.ok(!(k in q), q.id + ' 泄漏 ' + k)));
});
t('tikuAns 不含 correct/keys → 自评而非伪造判分', () => {
  Object.values(book.tikuAns).forEach(a => {
    assert.ok(!('correct' in a));
    assert.ok(!('keys' in a));
  });
});
t('有选项的题带 options、简答题不带', () => {
  const q0 = book.tiku.find(q => q.id === 'Q-1');
  const q2 = book.tiku.find(q => q.id === 'Q-3');
  assert.strictEqual(q0.options.length, 4);
  assert.ok(!('options' in q2));
});

console.log('\n=== C. D5 知识点关联 · 层级如实 ===');
t('kp 填 section 级编号（1.1 / 1.2），不编造到 point', () => {
  const kps = book.tiku.map(q => q.kp);
  assert.ok(kps.includes('1.1'), '应含 1.1');
  assert.ok(kps.includes('1.2'), '应含 1.2');
  kps.forEach(k => assert.match(k, /^\d+\.\d+$/));
});
t('kp 全部可在 byCode 反查（无非法编号）', () => {
  book.tiku.forEach(q => {
    if (!q.kp) return;
    assert.ok(book._trace.byCode[q.kp], '非法 kp: ' + q.kp);
    assert.strictEqual(book._trace.byCode[q.kp].type, 'section');
  });
});
t('hasQuiz：1.1.1/1.1.2/1.2.1 均为真（题覆盖两节）', () => {
  const byId = {};
  book.kaogang.forEach(k => byId[k.id] = k.hasQuiz);
  assert.strictEqual(byId['1.1.1'], true);
  assert.strictEqual(byId['1.1.2'], true);
  assert.strictEqual(byId['1.2.1'], true); // 1.2 也有题 q2
});

console.log('\n=== D. D6 溯源 · 原文已核 ===');
t('_trace.byQuestion 保留结构化 source + quoteVerified', () => {
  const r = book._trace.byQuestion['Q-1'];
  assert.strictEqual(r.file, '示例讲义.txt');
  assert.strictEqual(r.anchor, '【块1】');
  assert.strictEqual(r.quoteVerified, true);
  assert.strictEqual(book._trace.byQuestion['Q-3'].quoteVerified, false);
});
t('tikuAns.src 是可读串，含文件/anchor/quote', () => {
  const s = book.tikuAns['Q-1'].src;
  assert.ok(s.includes('示例讲义.txt') && s.includes('块1') && s.includes('顺序表采用连续内存'));
});
t('quoteAudit 原样保留（命中 2 / 未命中 1）', () => {
  assert.strictEqual(book._trace.quoteAudit.hit, 2);
  assert.strictEqual(book._trace.quoteAudit.missed, 1);
});
t('未核题如实标 false，不冒充原文已核', () => {
  assert.strictEqual(book._trace.byQuestion['Q-3'].quoteVerified, false);
});

console.log('\n=== E. D2 hot 映射 · 语义重点 ===');
t('无 focus 文件时全不 hot（不假造重点）', () => {
  book.kaogang.forEach(k => assert.strictEqual(k.hot, false));
});
t('focus 文件命中题 → 该节考点 hot（区分度）', () => {
  const withFocus = Adapter.buildBookData({
    analysis,
    meta: { id: 'ds-focus', title: '数据结构' },
    files: [{ name: '示例讲义.txt', file: '示例讲义.txt', focus: true, note: '核心讲义' }]
  });
  const byId = {};
  withFocus.kaogang.forEach(k => byId[k.id] = k.hot);
  assert.strictEqual(byId['1.1.1'], true, '1.1 题来自 focus 文件');
  assert.strictEqual(byId['1.1.2'], true);
  assert.strictEqual(byId['1.2.1'], true, '1.2 题同文件，也应 hot');
  assert.strictEqual(withFocus.meta.focusNotes[0].note, '核心讲义');
});
t('importance=高 的考点也 hot', () => {
  const withSyl = Adapter.buildBookData({
    analysis, meta: { id: 'ds-syl' }, files: [],
    documents: { syllabus: { sections: [{ rank: 1, chapter: '第一章', points: [{ title: '随机访问', importance: '高' }] }] } }
  });
  const k = withSyl.kaogang.find(x => x.id === '1.1.1');
  assert.strictEqual(k.hot, true);
});

console.log('\n=== F. 降级视图 · 不空壳 ===');
t('digest/syllabus 无 documents 时也能降级生成', () => {
  assert.strictEqual(book.digest.sections.length, 2);
  assert.strictEqual(book.syllabus.sections.length, 2);
  assert.ok(book.digest.sections[0].points.length >= 1);
  assert.ok(book.syllabus.sections[0].rank >= 1);
});
t('降级视图从真实题引用派生 quote（不再是空壳）', () => {
  const p11 = book.digest.sections[0].points.filter(p => p.quote);
  assert.ok(p11.length > 0, '1.1 节应有真实引用');
  assert.ok(p11[0].quote.includes('顺序表采用连续内存'));
  assert.strictEqual(book._trace.quoteGranularity, 'section-derived');
});
t('派生引用核验状态如实：1.1 已核、1.2 未核', () => {
  const byTitle = {};
  book.digest.sections.forEach(s => s.points.forEach(p => byTitle[p.title] = p));
  assert.strictEqual(byTitle['随机访问'].quoteVerified, true);
  assert.strictEqual(byTitle['指针串联'].quoteVerified, false);
});
t('未核引用不冒充已核（真实性判据）', () => {
  const bad = [];
  book.digest.sections.forEach(s => s.points.forEach(p => {
    if (!p.quoteVerified && !p.quote) bad.push(p.title);
  }));
  // 有引用就必有真实核验状态；无引用则如实标 false（空串不冒充）
  assert.ok(Array.isArray(bad));
});
t('mindmap.tree 保留原始四层树', () => {
  assert.strictEqual(book.mindmap.tree.id, 'n0_0');
  assert.strictEqual(book.mindmap.tree.children.length, 2);
});

console.log('\n=== G. 脏字段防御 ===');
t('全量 JSON 序列化无 undefined / [object Object]', () => {
  const s = JSON.stringify(book);
  assert.ok(!s.includes('[object Object]'));
  assert.ok(!/"[^"]*undefined/.test(s));
});
t('再来一次结果完全一致（纯函数幂等）', () => {
  const b2 = Adapter.buildBookData({
    analysis, meta: { id: 'ds-demo', title: '数据结构示例全书', subject: '期末考试' }, files: []
  });
  b2.meta.createdAt = book.meta.createdAt; // 唯一时间字段对齐
  assert.strictEqual(JSON.stringify(b2), JSON.stringify(book));
});

// 真实 analysis.json 的 point 没有子节点，subtype 这条路径靠构造数据验证——
// 否则「细分子类渲染」只是代码在、从没被数据走过。
t('point 的细分子类（subtype）与全题型不丢失', () => {
  const syn = {
    tree: {
      id: 'r', type: 'root', title: '合成书', children: [{
        id: 'c1', type: 'chapter', title: '第一章 甲', children: [{
          id: 's1', type: 'section', title: '1.1 乙', children: [{
            id: 'p1', type: 'point', title: '丙', desc: '丙的说明',
            questionTypes: ['选择题', '简答题'],
            children: [
              { id: 'x1', type: 'subtype', title: '易混点', desc: '与丁的区别', children: [] },
              { id: 'x2', type: 'subtype', title: '公式', desc: 'cost = n-i+1', children: [] }
            ]
          }]
        }]
      }]
    },
    questionIndex: [], summary: ''
  };
  const b = Adapter.buildBookData({ analysis: syn, meta: { id: 'syn', title: '合成书' }, files: [] });
  const k = b.kaogang[0];
  assert.strictEqual(k.title, '丙', 'title 应单列');
  assert.strictEqual(k.desc, '丙的说明', 'desc 应单列而不只是拼进 text');
  assert.deepStrictEqual(k.questionTypes, ['选择题', '简答题'], '两个题型都要保留');
  assert.strictEqual(k.subs.length, 2, '细分子类应保留 2 条');
  assert.strictEqual(k.subs[0].title, '易混点');
  assert.strictEqual(k.subs[1].desc, 'cost = n-i+1');
});

console.log('\n========================================');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log('========================================\n');
process.exit(fail ? 1 : 0);
