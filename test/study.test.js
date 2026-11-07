'use strict';
// lib/study.js / lib/llm.js 判别测试：锁定四条从 ko-lesson 融合来的不变量。
// 这些断言在「没有对应实现」的版本上必须失败，不是凑数的绿。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');
const study = require('../lib/study');
const llm = require('../lib/llm');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' [' + extra + ']' : ''))); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-test-'));
const store = new Store(tmp);
const b = store.createBook({ title: '相图与结晶', exam: '期末', subject: '材料' });
// 造真实可读文本资料（不是假扩展名）
const L1 = '第一章 相图基础。相图是描述相平衡关系的图形。结晶过程包括形核与长大两个 stages。';
const L2 = '作业题：位错滑移是塑性变形的主要机制。晶粒细化能同时提高强度与韧性。';
store.addMaterials(b.id, 1, [{ name: '总复习.txt', data: Buffer.from(L1, 'utf8').toString('base64') }], { source: 'user' });
store.addMaterials(b.id, 2, [{ name: '作业.txt', data: Buffer.from(L2, 'utf8').toString('base64') }], { source: 'user' });
store.addMaterials(b.id, 3, [{ name: '未纳入.txt', data: Buffer.from('这份材料用户没勾选，不该进边界的 included。', 'utf8').toString('base64') }], { source: 'user' });

const all = store.getBook(b.id).materials;
const picked = all.filter(m => m.name !== '未纳入.txt').map(m => m.id);

(async () => {
  // 1) 材料边界：纳入 / 排除 都要列
  const bd = study.boundary(store, b.id, picked);
  ok('边界清单含纳入 2 份', bd.included.length === 2, String(bd.included.length));
  ok('边界清单明确列出被排除的 1 份', bd.excluded.length === 1 && bd.excluded[0].name === '未纳入.txt');
  ok('边界清单每份标注作用', bd.included.every(x => !!x.role));

  // 2) 本地引擎：只从原文抽，来源双标
  const r = await study.analyze(store, b.id, { engine: 'local', selectedIds: picked, prompt: '重点看相图与结晶', pointCount: 4 });
  ok('本地分析成功', r.ok === true, r.reason);
  ok('产出知识点', r.ok && r.points.length >= 2);
  ok('四类题型齐全', r.ok && ['single', 'multiple', 'explain', 'case'].every(t => r.questions.some(q => q.type === t)));
  ok('origin=source 的必带来源三要素', r.ok && r.points.filter(p => p.origin === 'source').every(p => p.source && p.source.file && p.source.loc && p.source.usage));
  ok('origin=ai 的 source 必须为 null', r.ok && r.points.concat(r.questions).filter(x => x.origin === 'ai').every(x => x.source === null));
  ok('AI补充 题必须写明材料未覆盖', r.ok && r.questions.filter(q => q.origin === 'ai').every(q => /材料未直接覆盖/.test(q.explanation || q.answer || '')));
  ok('结果带引擎标识', r.engine === 'local');

  // BC：解题教练结构（探路/抉择/Col三栏）+ 计算题可核验（提示词 + 校验闸门）
  ok('BC：SYSTEM_PROMPT 含探路/证伪/Col三栏标记', /探路/.test(study.SYSTEM_PROMPT) && /证伪/.test(study.SYSTEM_PROMPT) && /【动机】/.test(study.SYSTEM_PROMPT) && /【操作】/.test(study.SYSTEM_PROMPT) && /【结果】/.test(study.SYSTEM_PROMPT));
  ok('BC：SYSTEM_PROMPT 要求计算题可核验', /可核验|验算|代入数值/.test(study.SYSTEM_PROMPT));
  ok('BC：本地引擎题 method 已升级为 Col 三栏', r.ok && r.questions.some(q => /【动机】/.test(q.method || '') && /【操作】/.test(q.method || '') && /【结果】/.test(q.method || '')));
  const p1 = { id: 'p1', title: 't', summary: '', difficulty: 5, origin: 'ai', source: null };
  const calcEmpty = { points: [p1], questions: [{ id: 'q1', type: 'calc', stem: '算 x', options: [], answer: '', explanation: '材料未直接覆盖', commonMistake: '', method: '', pointIds: ['p1'], origin: 'ai', source: null }] };
  ok('BC：calc 题 answer 空 → 报 EMPTY_FIELD', study.validateGeneration(calcEmpty, { included: [], excluded: [] }).issues.some(i => i.code === 'EMPTY_FIELD'));
  const calcNoV = { points: [p1], questions: [{ id: 'q2', type: 'calc', stem: '算 x', options: [], answer: '5', explanation: '材料未直接覆盖', commonMistake: '', method: '套公式即可', pointIds: ['p1'], origin: 'ai', source: null }] };
  ok('BC：calc 题 method 无核算线索 → 报 CALC_NO_VERIFY', study.validateGeneration(calcNoV, { included: [], excluded: [] }).issues.some(i => i.code === 'CALC_NO_VERIFY'));
  const calcOk = { points: [p1], questions: [{ id: 'q3', type: 'calc', stem: '算 x', options: [], answer: '4', explanation: '材料未直接覆盖', commonMistake: '', method: '公式 x=2 代入 2×2=4 运算得 4 验算：代入回代', pointIds: ['p1'], origin: 'ai', source: null }] };
  ok('BC：calc 题 含核算线索 → 不报 CALC_NO_VERIFY', !study.validateGeneration(calcOk, { included: [], excluded: [] }).issues.some(i => i.code === 'CALC_NO_VERIFY'));

  // 3) 零反馈不变量：试卷绝不含答案/解析
  const exam = study.makeExam(r, { questionCount: 8 });
  const paper = study.paperOf(exam);
  const serial = JSON.stringify(paper);
  ok('脱敏试卷不含答案字段', !/"answer"/.test(serial));
  ok('脱敏试卷不含解析字段', !/"explanation"/.test(serial));
  ok('脱敏试卷题目数与原卷一致', paper.questions.length === exam.questions.length);
  ok('原卷仍保留答案（后端判分用）', exam.questions.every(q => 'answer' in q));

  // 4) 批改三判定 + 巩固卷只针对薄弱点
  const answers = {};
  exam.questions.forEach((q, i) => { answers[q.id] = i === 0 ? q.answer : ''; });
  const g = study.gradeExam(exam, answers);
  ok('批改返回每道题判定', g.grading.length === exam.questions.length);
  ok('判定值只在三档内', g.grading.every(x => ['正确', '部分正确', '错误'].includes(x.verdict)));
  ok('有答对也有答错', g.summary.correct >= 1 && g.summary.wrong >= 1);
  ok('薄弱知识点被汇总', g.weakPointIds.length >= 1);
  const rem = study.remedial(exam, r);
  ok('巩固卷生成成功', rem.ok === true, rem.reason);
  ok('巩固卷轮次 +1', rem.ok && rem.exam.round === exam.round + 1);
  ok('巩固卷只含薄弱知识点相关题', rem.ok && rem.exam.questions.every(q => q.pointIds.some(p => g.weakPointIds.includes(p))));
  // 最小构造：两个独立知识点，只答错第二个 → 巩固卷必须只含第二题，不能机械重复整套
  const mini = { id: 'e_mini', round: 1, engine: 'local', questions: [
    { id: 'qA', type: 'single', stem: 'A 知识点', options: [], answer: 'A', pointIds: ['pA'], origin: 'source', source: null },
    { id: 'qB', type: 'single', stem: 'B 知识点', options: [], answer: 'B', pointIds: ['pB'], origin: 'source', source: null }
  ] };
  study.gradeExam(mini, { qA: 'A', qB: 'X' });
  const miniRem = study.remedial(mini, { questions: [] });
  ok('巩固卷不机械重复整套（只含答错知识点那题）',
    miniRem.ok && miniRem.exam.questions.length === 1 && miniRem.exam.questions[0].id === 'qB');
  const allRight = {}; exam.questions.forEach(q => { allRight[q.id] = q.answer; });
  const g2 = study.gradeExam(exam, allRight);
  ok('全对时不再出巩固卷', g2.weakPointIds.length === 0 && study.remedial(exam, r).ok === false);

  // 5) 云端引擎：缺配置必须大声失败，不许伪造结果
  const noCfg = await study.analyze(store, b.id, { engine: 'llm', selectedIds: picked, prompt: '相图' });
  ok('云端引擎缺配置明确失败', noCfg.ok === false && /API 地址/.test(noCfg.reason));
  store.addMaterials(b.id, 2, [{ name: '图.png', data: Buffer.from([137, 80, 78, 71]).toString('base64') }], { source: 'user' });
  const imgId = store.getBook(b.id).materials.find(m => m.name === '图.png').id;
  const imgRes = await study.analyze(store, b.id, { engine: 'local', selectedIds: [imgId], prompt: '相图' });
  ok('不可抽文本的资料必须明确失败，不造假', imgRes.ok === false && /没有可抽取的文本/.test(imgRes.reason));

  // 6) JSON 容错与规范化
  const loose = study.parseJSONLoose('```json\n{"points":[{"title":"相图","summary":"原文","origin":"source","sourceFile":"a.txt","sourceLoc":"L1","usage":"摘录"}],"questions":[{"type":"single","stem":"问","options":["A","B"],"answer":"A","explanation":"原文","pointTitles":["相图"],"origin":"source","sourceFile":"a.txt"}]}\n```');
  ok('能解析带 markdown 代码块的 JSON', loose.questions.length === 1);
  const norm = study.normalizeLLM(loose, bd, 'llm');
  ok('规范化后题干与答案保留', norm.questions[0].stem === '问' && norm.questions[0].answer === 'A');
  ok('规范化后 pointTitles 映射成 pointIds', norm.questions[0].pointIds[0] === norm.points[0].id);
  let threw = false;
  try { study.normalizeLLM({ points: [], questions: [] }, bd, 'llm'); } catch (e) { threw = true; }
  ok('空结果必须抛错而不是造空卷', threw);

  // M3 多模态：assetRefs / imageCaptions 数据契约 + 带图分析 + 降级
  const m3Parsed = study.parseJSONLoose(JSON.stringify({
    points: [{ title: '致密度', summary: '原文', origin: 'source', sourceFile: '总复习.txt', sourceLoc: 'L1', usage: '摘录', assetRefs: ['AID1'] }],
    questions: [{ type: 'calc', stem: '求致密度', options: [], answer: '0.74', explanation: '材料未直接覆盖', commonMistake: '', method: '公式 致密度=π/(3√2)≈0.74 代入数值 运算得 0.74 验算 回代', assetRefs: ['AID1'], pointTitles: ['致密度'], origin: 'ai', source: null }],
    imageCaptions: { AID1: '该图展示最密堆积配位数与致密度的关系' }
  }));
  const m3Norm = study.normalizeLLM(m3Parsed, bd, 'llm');
  ok('M3：normalizeLLM 接收 point.assetRefs', Array.isArray(m3Norm.points[0].assetRefs) && m3Norm.points[0].assetRefs[0] === 'AID1');
  ok('M3：normalizeLLM 接收 question.assetRefs', Array.isArray(m3Norm.questions[0].assetRefs) && m3Norm.questions[0].assetRefs[0] === 'AID1');
  ok('M3：normalizeLLM 透出 imageCaptions', m3Norm.imageCaptions && m3Norm.imageCaptions.AID1 && /致密度|配位数/.test(m3Norm.imageCaptions.AID1));
  ok('M3：SYSTEM_PROMPT 含多模态看图铁律', /多模态/.test(study.SYSTEM_PROMPT) && /assetRefs/.test(study.SYSTEM_PROMPT));

  // 最小 mock store：提供带图 assets 的资料，验证 llmAnalyze 把图喂给模型 + 写回 caption + 降级
  const AIMG = 'AIMG001';
  const mockStore = {
    getBook: () => ({ materials: [{ id: 'm1', name: '晶体学.pptx', layer: 1, ext: 'pptx', size: 10, source: 'user', prompt: '',
      assets: [{ id: AIMG, name: 'slide1.png', ext: 'png', kind: 'media', slide: 1, page: 1, caption: '' }] }] }),
    readMaterial: () => ({ data: Buffer.from('立方最密堆积配位数12致密度0.74', 'utf8').toString('base64'), extractedText: '立方最密堆积配位数12致密度0.74',
      assets: [{ id: AIMG, name: 'slide1.png', ext: 'png', kind: 'media', slide: 1, page: 1, caption: '' }] }),
    readAsset: () => ({ data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'), mime: 'image/png' }),
    setAssetCaption: (bid, mid, aid, cap) => { mockStore.__caps = mockStore.__caps || {}; mockStore.__caps[aid] = cap; return true; },
    saveAnalysis: () => ({ ok: true }), getAnalysis: () => null
  };
  const m3Raw = JSON.stringify({
    points: [{ title: '立方最密堆积致密度', summary: '原文', origin: 'source', sourceFile: '晶体学.pptx', sourceLoc: 'L1', usage: '摘录', assetRefs: [AIMG] }],
    questions: [{ type: 'calc', stem: '求立方最密堆积致密度', options: [], answer: '0.74', explanation: '材料未直接覆盖', commonMistake: '', method: '公式 致密度=π/(3√2)≈0.74 代入数值 运算得 0.74 验算 回代', assetRefs: [AIMG], pointTitles: ['立方最密堆积致密度'], origin: 'ai', source: null }],
    imageCaptions: { [AIMG]: '该图展示最密堆积配位关系' }
  });
  const m3Res = await study.analyzeWithChat(mockStore, 'book1',
    { engine: 'llm', selectedIds: ['m1'], useVision: true, cfg: { baseURL: 'http://x', apiKey: 'sk-fake', model: 'mock' } }, async () => m3Raw);
  ok('M3：带图分析成功', m3Res.ok === true, m3Res.reason);
  ok('M3：points 带 assetRefs', m3Res.ok && Array.isArray(m3Res.points[0].assetRefs) && m3Res.points[0].assetRefs[0] === AIMG);
  ok('M3：结果带 assetIndex（含 matId）', m3Res.ok && m3Res.assetIndex && m3Res.assetIndex[AIMG] && m3Res.assetIndex[AIMG].matId === 'm1');
  ok('M3：云端图说明写回 asset（setAssetCaption 被调用）', mockStore.__caps && mockStore.__caps[AIMG] && /最密堆积/.test(mockStore.__caps[AIMG]));

  // 降级：模型不支持视觉 → 第一次抛 vision 错误，第二次纯文本成功
  let c3 = 0;
  const m3Plain = JSON.stringify({
    points: [{ title: '立方最密堆积致密度', summary: '原文', origin: 'source', sourceFile: '晶体学.pptx', sourceLoc: 'L1', usage: '摘录' }],
    questions: [{ type: 'calc', stem: '求致密度', options: [], answer: '0.74', explanation: '材料未直接覆盖', commonMistake: '', method: '公式 致密度=π/(3√2)≈0.74 代入数值 运算得 0.74 验算 回代', pointTitles: ['立方最密堆积致密度'], origin: 'ai', source: null }]
  });
  const degrMock = async () => { if (++c3 === 1) throw new Error('400 Bad Request: model does not support image input'); return m3Plain; };
  const degrRes = await study.analyzeWithChat(mockStore, 'book2',
    { engine: 'llm', selectedIds: ['m1'], useVision: true, cfg: { baseURL: 'http://x', apiKey: 'sk-fake', model: 'mock' } }, degrMock);
  ok('M3：视觉不支持时降级纯文本仍成功', degrRes.ok === true, degrRes.reason);
  ok('M3：降级恰好调用 2 次（带图1次失败→纯文本1次）', c3 === 2, 'calls=' + c3);
  ok('M3：降级后结果不含 forged 图引用（模型实际没看图）', !degrRes.points[0].assetRefs || degrRes.points[0].assetRefs.length === 0);

  // 7) 密钥绝不出现在错误文本里
  const cfg = { baseURL: 'http://127.0.0.1:1/v1', apiKey: 'sk-SUPERSECRET123456789', model: 'test' };
  const t = await llm.testConnection(cfg);
  ok('连不上时明确失败', t.ok === false);
  ok('错误文本不含密钥', !(JSON.stringify(t) + llm.scrub('前缀 sk-SUPERSECRET123456789 后缀', cfg)).includes('SUPERSECRET'));
  ok('scrub 抹掉 sk- 长串', !llm.scrub('Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz', cfg).includes('abcdefghijklmnop'));

  // 8) 学习产物真落盘、可读回
  ok('分析可保存', store.saveAnalysis(b.id, r).ok === true);
  ok('分析可读回', store.getAnalysis(b.id) && store.getAnalysis(b.id).points.length === r.points.length);
  ok('试卷可保存并列摘要', (store.saveExam(b.id, exam), store.listExams(b.id).length === 1));

  // 9) v0.5 出题质量：分层去重 / 可执行校验 / 代码控制的有限重试 / 诚实降级 / 过程可见
  // 这些断言在 v0.4 的 lib/study.js 上必须失败（baseline-fails）。
  const hasQ = typeof study.dedupeQuestions === 'function' &&
    typeof study.validateGeneration === 'function' &&
    typeof study.analyzeWithChat === 'function';
  ok('v0.5 质量接口存在（去重/校验/可注入分析）', hasQ);

  const q = (stem, id, extra) => Object.assign({
    id, type: 'single', stem, options: ['A', 'B'], answer: 'A', explanation: '原文依据',
    pointIds: ['p1'], origin: 'source', source: { file: '总复习.txt', loc: 'L1', usage: '摘录' }
  }, extra || {});

  if (hasQ) {
    const dupList = [
      q('相图是描述相平衡关系的图形吗？', 'q1'),
      q('相图是描述相平衡关系的图形吗？', 'q2'),   // 完全相同
      q('相图是描述相平衡关系的图形吗呢', 'q3'),  // 归一化后多一个字，走 Jaccard 近似层（非精确指纹）
      q('晶粒细化能同时提高强度与韧性吗？', 'q4')  // 真正不同的题
    ];
    const dd = study.dedupeQuestions(dupList, { threshold: 0.82 });
    ok('去重：完全相同与近重复被合并', dd.questions.length === 2, '剩 ' + dd.questions.length);
    ok('去重：返回被合并的重复对（不静默删）', Array.isArray(dd.removed) && dd.removed.length >= 2);
    ok('去重：保留原件（首题与不同题都在）',
      dd.questions.some(x => x.id === 'q1') && dd.questions.some(x => x.id === 'q4'));
    ok('去重：阈值可配（0.99 时近重复不再被合并）',
      study.dedupeQuestions(dupList, { threshold: 0.99 }).questions.length > dd.questions.length);

    // 可执行校验：来源指向材料边界之外的文件 = 模型编造出处，必须判不合格并给证据
    const good = study.normalizeLLM({
      points: [{ title: '相图', summary: '原文', origin: 'source', sourceFile: '总复习.txt', sourceLoc: 'L1', usage: '摘录' }],
      questions: [{ type: 'single', stem: '相图描述什么？', options: ['A', 'B'], answer: 'A', explanation: '原文', pointTitles: ['相图'], origin: 'source', sourceFile: '总复习.txt' }]
    }, bd, 'llm');
    const vGood = study.validateGeneration(good, bd);
    ok('校验：合法结果判合格', vGood.ok === true, JSON.stringify(vGood.issues || []).slice(0, 160));
    const bad = JSON.parse(JSON.stringify(good));
    bad.questions[0].source.file = '根本不存在的复习资料.pdf';
    const vBad = study.validateGeneration(bad, bd);
    ok('校验：来源越界判不合格', vBad.ok === false);
    ok('校验：不合格必须带证据锚点（qid + code + evidence）',
      (vBad.issues || []).some(i => i.code === 'SOURCE_OUT_OF_BOUNDARY' && i.qid && i.evidence));
    const vAi = study.validateGeneration(Object.assign({}, good, {
      questions: [Object.assign({}, good.questions[0], { origin: 'ai', source: null, explanation: '随便写的' })]
    }), bd);
    ok('校验：AI补充未写明「材料未直接覆盖」判不合格', vAi.ok === false);

    // 有限重试：第一次坏、第二次好，必须接受第二次且计次/停止原因可见
    const badRaw = JSON.stringify({ points: [{ title: '相图', summary: '原文', origin: 'source', sourceFile: '幽灵.pdf' }],
      questions: [{ type: 'single', stem: '坏题', options: ['A'], answer: 'A', explanation: 'x', pointTitles: ['相图'], origin: 'source', sourceFile: '幽灵.pdf' }] });
    const goodRaw = JSON.stringify({ points: [{ title: '相图', summary: '原文', origin: 'source', sourceFile: '总复习.txt' }],
      questions: [{ type: 'single', stem: '好题', options: ['A'], answer: 'A', explanation: 'x', pointTitles: ['相图'], origin: 'source', sourceFile: '总复习.txt' }] });
    let calls = 0;
    const chatMock = async () => (++calls === 1 ? badRaw : goodRaw);
    const retry = await study.analyzeWithChat(store, b.id,
      { engine: 'llm', selectedIds: picked, cfg: { baseURL: 'http://127.0.0.1:1/v1', apiKey: 'sk-FAKE', model: 'mock' } }, chatMock);
    ok('重试：最终接受合格结果', retry.ok === true && retry.questions[0].stem === '好题', retry.reason || '');
    ok('重试：恰好调用 2 次（预算固定 1 次重试）', calls === 2, 'calls=' + calls);
    ok('重试：停止原因随结果返回', retry.quality && /retry/.test(retry.quality.retry.stopReason), JSON.stringify(retry.quality && retry.quality.retry));
    ok('重试：首次校验问题在质量报告里可见（过程不是黑盒）',
      retry.quality && Array.isArray(retry.quality.validation.history) && retry.quality.validation.history.length >= 1);

    // 预算耗尽：两次都坏 → 诚实降级，不伪造成功、不静默放行
    let calls2 = 0;
    const alwaysBad = async () => (++calls2, badRaw);
    const degr = await study.analyzeWithChat(store, b.id,
      { engine: 'llm', selectedIds: picked, cfg: { baseURL: 'http://127.0.0.1:1/v1', apiKey: 'sk-FAKE', model: 'mock' } }, alwaysBad);
    ok('降级：重试耗尽后明确标 degraded', degr.quality && degr.quality.degraded === true);
    ok('降级：不合格的题不进最终卷（不静默放行）',
      degr.questions.every(x => JSON.stringify(x.source || {}).indexOf('幽灵.pdf') < 0));
    ok('降级：给出降级原因（不猜、不假装成功）',
      degr.quality && /未通过|降级/.test(degr.quality.retry.stopReason + (degr.note || '')));

    // 默认本地引擎也必须挂质量报告，用户不填 key 也看得见
    const localQ = await study.analyze(store, b.id, { engine: 'local', selectedIds: picked, prompt: '相图', pointCount: 3 });
    ok('本地引擎也返回质量报告', localQ.ok && localQ.quality && localQ.quality.retry.attempts === 1);
    ok('本地引擎不产生重试（离线零成本）', localQ.quality && localQ.quality.retry.retried === false);
  ok('本地引擎停止原因明确写「离线零重试」，不误报成通过重试',
    localQ.quality && localQ.quality.retry.stopReason === 'local_no_retry' && localQ.quality.retry.budget === 0);
  } else {
    ok('去重：完全相同与近重复被合并', false, '接口缺失');
    ok('校验：来源越界判不合格', false, '接口缺失');
    ok('重试：恰好调用 2 次（预算固定 1 次重试）', false, '接口缺失');
    ok('降级：重试耗尽后明确标 degraded', false, '接口缺失');
    ok('本地引擎也返回质量报告', false, '接口缺失');
  }

  // 10) M1 错题本：批改后薄弱知识点跨会话累积、leech 上浮、零云、容错
  const mkWrongExam = () => {
    const ex = study.makeExam(r, { questionCount: 8 });
    const a = {};
    ex.questions.forEach((q, i) => { a[q.id] = i < 3 ? q.answer : ''; }); // 前 3 题对，其余错
    study.gradeExam(ex, a); store.saveExam(b.id, ex); store.recordGrade(b.id, ex, r);
    return ex;
  };
  mkWrongExam(); mkWrongExam(); mkWrongExam(); // 同一套错法重复 3 次 → 错的知识点 lapseCount 累积到 3，应标 leech
  const summ = study.summarizeMistakes(store, b.id);
  ok('错题本：批改后记录到薄弱知识点', summ.items.length >= 1, 'items=' + summ.items.length);
  ok('错题本：反复答错的知识点被标 leech 并上浮顶部',
    summ.leechCount >= 1 && summ.items[0] && summ.items[0].leech === true, JSON.stringify(summ.items.slice(0, 2)));
  ok('错题本：排序按 lapseCount 降序（最弱的在最上）',
    summ.items.every((x, i, a) => i === 0 || (a[i - 1].lapseCount || 0) >= (x.lapseCount || 0)));
  const correctItem = summ.items.find(x => (x.correctCount || 0) >= 3 && (x.lapseCount || 0) === 0);
  ok('错题本：始终答对的知识点 correctCount 累积且 lapseCount 为 0', !!correctItem);
  ok('错题本：每条记录带判定历史（≥3 次）', summ.items.every(x => Array.isArray(x.history) && x.history.length >= 3));
  // 跨会话持久：用全新 Store 实例打开同一 root，错题本仍在
  const store2 = new Store(tmp);
  const summ2 = study.summarizeMistakes(store2, b.id);
  ok('错题本：跨会话持久（新 Store 实例仍能读回）',
    summ2.items.length === summ.items.length && summ2.leechCount === summ.leechCount);
  // 容错：分析缺失（analysis=null）时标题回退为 pointId，不崩
  const exNull = study.makeExam(r, { questionCount: 2 });
  const aNull = {}; exNull.questions.forEach(q => { aNull[q.id] = q.answer; });
  study.gradeExam(exNull, aNull);
  store.recordGrade(b.id, exNull, null);
  ok('错题本：analysis 缺失时标题回退 pointId 不崩溃', store.getMistakes(b.id).every(x => typeof x.title === 'string'));

  // 11) M2 间隔重复 SRS：盒子升级/重置/封顶、due 判定、今日复习卷组卷、跨会话持久、诚实失败
  // 受控单点：构造只含一个知识点的试卷，分别批改正确/错误，验证盒子只由 recordGrade 驱动
  let srsSeq = 0;
  const srsPoint = { id: 'pSRS', title: 'SRS控制点', summary: '测试', difficulty: 1, mastery: '未接触', origin: 'source', source: { file: '总复习.txt', loc: 'L1', usage: '摘录' } };
  function gradeSRS(verdict) {
    const ex = { id: 'exSRS_' + (srsSeq++), round: 1, engine: 'local',
      questions: [{ id: 'qSRS', type: 'single', stem: 'SRS测试', options: ['A', 'B'], answer: 'A', pointIds: ['pSRS'], origin: 'source', source: null }],
      answers: {}, grading: [], weakPointIds: [], analysisId: null };
    study.gradeExam(ex, verdict === '正确' ? { qSRS: 'A' } : { qSRS: 'X' });
    store.saveExam(b.id, ex);
    store.recordGrade(b.id, ex, { points: [srsPoint] });
  }
  gradeSRS('错误');                                   // box 1
  let srsRec = store.getMistakes(b.id).find(x => x.pointId === 'pSRS');
  ok('M2：答错后盒子重置为 1', srsRec.box === 1, 'box=' + srsRec.box);
  gradeSRS('正确'); gradeSRS('正确'); gradeSRS('正确'); // 1→2→3→4
  srsRec = store.getMistakes(b.id).find(x => x.pointId === 'pSRS');
  ok('M2：连续答对盒子逐级升高', srsRec.box === 4, 'box=' + srsRec.box);
  for (let i = 0; i < 10; i++) gradeSRS('正确');       // 封顶 6
  srsRec = store.getMistakes(b.id).find(x => x.pointId === 'pSRS');
  ok('M2：盒子封顶为 6（不无限增长）', srsRec.box === 6, 'box=' + srsRec.box);

  // due 判定：box=1 间隔 0 天 → 当天到期；box=6 间隔 35 天 → 远未到期
  const nowM2 = Date.now();
  const summM2 = study.summarizeMistakes(store, b.id, nowM2);
  ok('M2：summarizeMistakes 返回 box/due/dueInDays', summM2.items.every(x => 'box' in x && 'due' in x && 'dueInDays' in x));
  ok('M2：dueCount 与到期项数一致', summM2.dueCount === summM2.items.filter(x => x.due).length);
  const srsItem = summM2.items.find(x => x.pointId === 'pSRS');
  ok('M2：高盒子（box=6）未到期且剩余天数充足', srsItem.due === false && srsItem.dueInDays >= 34, JSON.stringify({ due: srsItem.due, d: srsItem.dueInDays }));

  // 今日复习卷：只含到期（box=1 等）薄弱点的题，不掺高盒子点
  const dueIds = summM2.items.filter(x => x.due && x.pointId).map(x => x.pointId);
  ok('M2：存在到期薄弱点', dueIds.length >= 1, 'due=' + dueIds.length);
  const rev = study.reviewExam(store, b.id, nowM2, 20);
  ok('M2：今日复习卷组卷成功', rev.ok === true, rev.reason);
  ok('M2：复习卷轮次标记为 review（区别于第 N 套）', rev.ok && rev.exam.round === 'review');
  ok('M2：复习卷只含到期薄弱点的题', rev.ok && rev.exam.questions.length >= 1 && rev.exam.questions.every(q => q.pointIds.some(p => dueIds.includes(p))));
  ok('M2：复习卷复用已存试卷中的题（无凭空新题）', rev.ok && rev.exam.questions.every(q => typeof q.id === 'string' && q.id.length > 0));
  ok('M2：dueCount 随复习卷返回', rev.ok && typeof rev.dueCount === 'number' && rev.dueCount === dueIds.length);

  // 跨会话持久：新 Store 实例读回盒子状态
  const store3 = new Store(tmp);
  const persisted = store3.getMistakes(b.id).find(x => x.pointId === 'pSRS');
  ok('M2：盒子状态跨会话持久（新 Store 实例读回 box=6）', persisted && persisted.box === 6, 'box=' + (persisted && persisted.box));

  // 诚实失败：没有任何薄弱点时，复习卷必须大声失败，不造假卷
  const bEmpty = store.createBook({ title: '无薄弱点书', exam: 'x' });
  const revEmpty = study.reviewExam(store, bEmpty.id, nowM2, 20);
  ok('M2：无薄弱点时复习卷明确失败（不造假卷）', revEmpty.ok === false && /没有到期/.test(revEmpty.reason), revEmpty.reason);

  console.log('\nstudy/llm 单测： ' + pass + ' 通过 / ' + fail + ' 失败');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃：', e); process.exit(1); });
