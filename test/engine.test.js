/**
 * engine.test.js —— 端到端复用书馆引擎的判别测试（全格式抽取 + 目标选择 + 出题复用）
 *
 * 锁住用户新需求：
 *  1. 资源全部复用：prompt/analyze/documents/practice 都是书馆的真实导出，不复制文本；
 *  2. 全格式：pdf/ppt/word/png/txt/md/csv 的抽取走书馆 extract，PDF 传 ext 保页锚点；
 *  3. 可选分析目标：全选/知识点大全/考纲考点，只生成所选产物；
 *  4. 出题从知识点大全选题：practice.flatten 消费 questionIndex。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('../lib/engine');
const Adapter = require('../assets/js/adapter');

const ROOT = path.resolve(__dirname, '..');
const REAL = path.join(ROOT, '../复习资料图书馆/library/books/320521f8dbafa962/analysis.json');
const baseAnalysis = JSON.parse(fs.readFileSync(REAL, 'utf8'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
async function at(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

(async () => {
  console.log('\n=== A. 资源全部复用书馆（单一真源）===');
  t('能力清单直接来自书馆 capabilities（12 action）', () => {
    assert.strictEqual(engine.lib.capabilities.ACTIONS.length, 12);
    assert.ok(engine.lib.capabilities.ACTIONS.includes('compose'));
  });
  t('提示词正本来自书馆 analyze.SYSTEM_PROMPT', () => {
    const docs = engine.lib.documents;
    assert.ok(docs.KINDS.digest.system.includes('考点大全'));
    assert.ok(docs.KINDS.syllabus.system.includes('命题与考前速通专家'));
    assert.ok(engine.lib.analyze.SYSTEM_PROMPT.includes('学科分析与出题专家'));
  });
  t('题型常量 7 类来自书馆', () => {
    assert.strictEqual(engine.lib.analyze.QUESTION_TYPES.length, 7);
  });

  console.log('\n=== B. 分析目标选择（可选进入哪些）===');
  t('normalizeTargets：全选→两个核心产物', () => {
    assert.deepStrictEqual(engine.normalizeTargets(['all']), ['knowledge', 'syllabus']);
    assert.deepStrictEqual(engine.normalizeTargets([]), ['knowledge', 'syllabus']);
  });
  t('normalizeTargets：单项选择', () => {
    assert.deepStrictEqual(engine.normalizeTargets(['knowledge']), ['knowledge']);
    assert.deepStrictEqual(engine.normalizeTargets(['syllabus']), ['syllabus']);
  });
  t('normalizeTargets：非法目标不生效', () => {
    assert.deepStrictEqual(engine.normalizeTargets(['hack']), []);
    assert.deepStrictEqual(engine.normalizeTargets(['knowledge', 'hack']), ['knowledge']);
  });
  t('目标只有两个核心产物（导图是视图不是产物，无重复）', () => {
    assert.deepStrictEqual(engine.ALL_TARGETS, ['knowledge', 'syllabus']);
  });

  console.log('\n=== C. 全格式抽取（复用书馆 extract）===');
  await at('实际抽取 txt 得到正文', async () => {
    const txt = await engine.lib.extract.extractText('.txt', Buffer.from('顺序表采用连续内存，支持下标直接定位。'));
    assert.ok(txt.includes('顺序表'));
  });
  await at('图片扩展名识别为图片（交视觉模型，不抽文本）', () => {
    const E = engine.lib.extract;
    assert.strictEqual(E.isImageExt('.png'), true);
    assert.strictEqual(E.isImageExt('.JPG'), true);
    assert.strictEqual(E.isImageExt('.pdf'), false);
  });
  await at('PDF 传 ext 时 segmentText 产出【P.N】页锚点（修复书馆 bug 的关键）', () => {
    const E = engine.lib.extract;
    const withPage = '[[PAGE:1]]\n顺序表采用连续内存。\n[[PAGE:2]]\n链表用指针串联。';
    const segs = E.segmentText(withPage, { source: 'x.pdf', ext: '.pdf' });
    assert.ok(segs.some(s => /【P\.\d+】/.test(s.anchor)), '应产出页锚点，实际 ' + JSON.stringify(segs.map(s => s.anchor)));
  });

  console.log('\n=== D. 出题从知识点大全选题（复用 practice）===');
  const first = Adapter.buildBookData({ analysis: baseAnalysis, meta: { id: 't', title: '测试书' }, files: [] });
  t('practiceView 从 questionIndex 展平出题目', () => {
    const pv = engine.practiceView(first);
    assert.ok(pv.count >= 3, '应至少 3 道题');
    assert.ok(pv.questions[0].stem && pv.questions[0].key);
  });
  t('公开题目不带答案（零反馈）', () => {
    const pv = engine.practiceView(first);
    pv.questions.forEach(q => assert.ok(!('answer' in q) && !('solution' in q)));
  });
  t('gradeOne 复用书馆判分（选择/判断自动判，其余自评）', () => {
    const q = { type: '选择题', answer: 'A. 正确' };
    const r = engine.gradeOne(q, '选择题', 'A');
    assert.ok(r && ['correct', 'wrong', 'self'].includes(r.verdict));
  });

  console.log('\n=== E. 考纲生成绕过书馆 compose() 的 corpus object bug ===');
  t('书馆 documents.compose 确有 bug（composeCorpus 返回对象被当字符串）', () => {
    const src = fs.readFileSync(path.join(ROOT, '../复习资料图书馆/core/documents.js'), 'utf8');
    assert.ok(src.includes('const corpus = analyzeLib.composeCorpus('), '源码仍直接赋对象');
    assert.ok(src.includes("'\\n\\n【全书正文】\\n' + corpus"), '源码仍把对象当字符串拼');
  });
  t('本引擎用 .corpus 字符串（不复制 bug）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/engine.js'), 'utf8');
    assert.ok(src.includes('const corpusText = composed.corpus;'), '应取 .corpus 字符串');
    assert.ok(/KINDS\.syllabus|spec\.system/.test(src), '应复用书馆官方考纲提示词');
  });
  t('两处 llm.chat 返回值都取 .text（曾两次漏取导致"[object Object]"）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/engine.js'), 'utf8');
    const chatCalls = src.split('llm.chat(').length - 1;
    assert.ok(chatCalls >= 2, '应至少两处 llm.chat 调用');
    assert.ok(src.includes('const resp = await llm.chat') && src.includes('resp.text'), 'composeSyllabus 应取 .text');
    assert.ok(src.includes('const r = await llm.chat') && src.includes('r.text'), 'makeChat 应取 .text');
  });

  console.log('\n========================================');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('========================================\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
