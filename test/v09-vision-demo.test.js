'use strict';
// v0.9 判别测试：看图默认关闭 + 不支持时降级 + probeVision 自检 + 预览站 demo 数据形状。
// 任一断言在「未实现 v0.9 行为」的版本上必失败（discrimination-red）。
const fs = require('fs');
const path = require('path');
const study = require('../lib/study');
const llm = require('../lib/llm');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' [' + extra + ']' : ''))); };

// 带图资料的 mock store（asset 名为 slide1.png → ext 由名字派生为 .png，命中 VISION_EXTS）
const AIMG = 'AIMG001';
const mockStore = {
  getBook: () => ({ materials: [{ id: 'm1', name: '晶体学.pptx', layer: 1, ext: 'pptx', size: 10, source: 'user', prompt: '',
    assets: [{ id: AIMG, name: 'slide1.png', ext: 'png', kind: 'media', slide: 1, page: 1, caption: '' }] }] }),
  readMaterial: () => ({ data: Buffer.from('立方最密堆积配位数12致密度0.74', 'utf8').toString('base64'), extractedText: '立方最密堆积配位数12致密度0.74',
    assets: [{ id: AIMG, name: 'slide1.png', ext: 'png', kind: 'media', slide: 1, page: 1, caption: '' }] }),
  readAsset: () => ({ data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'), mime: 'image/png' }),
  setAssetCaption: () => true,
  saveAnalysis: () => ({ ok: true }), getAnalysis: () => null
};
const RAW = JSON.stringify({
  points: [{ title: '立方最密堆积致密度', summary: '原文', origin: 'source', sourceFile: '晶体学.pptx', sourceLoc: 'L1', usage: '摘录' }],
  questions: [{ type: 'single', stem: '求立方最密堆积致密度', options: ['A', 'B'], answer: 'A', explanation: '原文', pointTitles: ['立方最密堆积致密度'], origin: 'source', sourceFile: '晶体学.pptx' }]
});
const cfg = { baseURL: 'http://x', apiKey: 'sk-fake', model: 'mock' };

(async () => {
  // ===== A：看图默认关闭（useVision 不传 → 不读图、不把图喂模型）=====
  let sentImage = false;
  const chatDefault = async () => { // 用闭包记录是否真的发了 image_url
    // 注意：本函数不会被执行到（因为默认关闭根本不调用 chatFn），但保留以防回归
    return RAW;
  };
  // 用一个会记录 image_url 的包装，确认默认关闭时 chatFn 根本不接收图块
  let sawImageUrl = false;
  const recordingChat = async (c, msgs) => {
    const userMsg = msgs.find(m => m.role === 'user');
    const s = typeof userMsg.content === 'string' ? userMsg.content : JSON.stringify(userMsg.content);
    if (/image_url/.test(s)) sawImageUrl = true;
    return RAW;
  };
  const r1 = await study.analyzeWithChat(mockStore, 'bk1', { engine: 'llm', selectedIds: ['m1'], cfg }, recordingChat);
  ok('V1 默认关闭时不把图喂给模型（无 image_url）', sawImageUrl === false);
  ok('V2 返回 visionOff=true（明确标注按纯文本分析）', r1.ok && r1.visionOff === true, JSON.stringify({ off: r1.visionOff, ok: r1.ok, reason: r1.reason }));
  ok('V3 默认关闭仍正常产出知识点/题', r1.ok && r1.points.length >= 1 && r1.questions.length >= 1);

  // ===== B：开启后模型不支持看图 → 自动降级纯文本，并标 visionUnsupported =====
  let c3 = 0;
  const degrChat = async () => { if (++c3 === 1) throw new Error('400 Bad Request: model does not support image input'); return RAW; };
  const r2 = await study.analyzeWithChat(mockStore, 'bk2', { engine: 'llm', selectedIds: ['m1'], useVision: true, cfg }, degrChat);
  ok('V4 开启但模型不支持 → visionUnsupported=true', r2.visionUnsupported === true, JSON.stringify(r2.visionUnsupported));
  ok('V5 降级为纯文本 → visionDegraded=true', r2.visionDegraded === true);
  ok('V6 降级后纯文本结果仍成功', r2.ok === true, r2.reason);
  ok('V7 降级后清空图引用（模型没真看图）', !r2.points[0].assetRefs || r2.points[0].assetRefs.length === 0);

  // ===== C：probeVision 自检 =====
  const okV = await llm.probeVision({ baseURL: 'http://x', apiKey: 'k', model: 'm' }, async () => 'red');
  ok('V8 probeVision ok + supportsVision=true', okV.ok === true && okV.supportsVision === true, JSON.stringify(okV));
  const noV = await llm.probeVision({ baseURL: 'http://x', apiKey: 'k', model: 'm' }, async () => { throw new Error('400 this model does not support image input'); });
  ok('V9 probeVision ok + supportsVision=false（明确报不支持）', noV.ok === true && noV.supportsVision === false, JSON.stringify(noV));
  const nc = await llm.probeVision({}, async () => 'x');
  ok('V10 probeVision 缺配置 → ok=false', nc.ok === false && nc.supportsVision === false, JSON.stringify(nc));

  // ===== D：预览站 demo 数据形状 =====
  const demoPath = path.join(__dirname, '..', 'demo', 'book.json');
  ok('V11 demo/book.json 存在', fs.existsSync(demoPath));
  let dj = null; try { dj = JSON.parse(fs.readFileSync(demoPath, 'utf8')); } catch (e) { ok('V11b 解析失败', false, e.message); }
  ok('V12 含 book 摘要（id/title）', dj && dj.book && dj.book.id && dj.book.title);
  ok('V13 含 materials 数组', dj && Array.isArray(dj.materials) && dj.materials.length >= 1);
  ok('V14 含 syllabus.chapters', dj && dj.syllabus && Array.isArray(dj.syllabus.chapters) && dj.syllabus.chapters.length >= 1);
  ok('V15 含 analysis.points/questions', dj && dj.analysis && Array.isArray(dj.analysis.points) && Array.isArray(dj.analysis.questions) && dj.analysis.points.length >= 1);

  console.log('\nv0.9 视觉默认关闭/预览站单测： ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃：', e); process.exit(1); });
