'use strict';
// 思维导图 v2 · 判别测试（baseline 必红 / candidate 必绿）
//
// 反假绿设计（上两轮被独立 reviewer 实证「只锁源码文本 = 假绿」）：
//   ① 布局/题型树/序列化算法拆到可 require 的 renderer/js/mindmap-layout.js，本测试真调用；
//   ② analyze 契约真跑 validate()，断言题目实体字段被保留（不是查 prompt 里有没有那几个字）；
//   ③ 一次 API 真跑 analyze() 并捕获 chatFn 的 opts，断言 responseFormat / maxTokens；
//   ④ raw 路由真起 Core + 临时书库，断言返回字节与恶意 fileId 被拒；
//   ⑤ lib/llm.chat 真发 HTTP 到本地 mock，断言 payload 里真有 response_format。
//   DOM 交互（点击下钻/详情弹窗）由 _e2e/core-ui-verify.js 真浏览器覆盖，不在本文件伪造。
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n--- ' + t + ' ---'); }
function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }

// 真实形状的样例（与 B 的契约一致，但带 v2 新增的题目实体）
const TREE = {
  id: 'n0_0', type: 'root', title: '计算机基础', children: [
    { id: 'n1_0', type: 'chapter', title: '第一章 数据结构', children: [
      { id: 'n2_0', type: 'section', title: '1.1 线性表', children: [
        { id: 'n3_0', type: 'point', title: '顺序表', desc: '连续存储', questionTypes: ['选择题'], children: [] },
        { id: 'n3_1', type: 'point', title: '链表', desc: '链式存储', questionTypes: ['简答题'], children: [] }
      ] }
    ] },
    { id: 'n1_1', type: 'chapter', title: '第二章 算法', children: [
      { id: 'n2_1', type: 'section', title: '2.1 排序', children: [
        { id: 'n3_2', type: 'point', title: '快速排序', desc: '分治', questionTypes: ['计算题'], children: [] }
      ] }
    ] }
  ]
};

const FULL_Q = {
  stem: '在长度为 n 的顺序表第 i 个位置插入元素，平均需要移动多少个元素？',
  options: ['A. n/2', 'B. n', 'C. n-i+1', 'D. i'],
  answer: 'A（平均 n/2，精确值 n-i+1 的期望）',
  solution: ['第 i 个位置及其后的元素共 n-i+1 个都要后移一位', 'i 在 1..n+1 上均匀分布，取期望得 n/2'],
  rationale: '先数「要移动几个」，再对插入位置求期望，别把精确值和平均值混为一谈。',
  pitfalls: '容易误选 C，那是某个固定位置 i 的值，不是平均值。',
  difficulty: '基础',
  pointPath: ['第一章 数据结构', '1.1 线性表', '顺序表'],
  source: { file: '讲义.pdf', page: 12, quote: '顺序表插入运算的平均移动次数为 n/2' }
};

const PARSED = {
  outline: {
    title: '计算机基础',
    children: TREE.children.map(c => ({
      title: c.title,
      children: (c.children || []).map(s => ({
        title: s.title,
        children: (s.children || []).map(p => ({
          title: p.title, desc: p.desc, questionTypes: p.questionTypes, children: []
        }))
      }))
    }))
  },
  questionIndex: [
    {
      type: '选择题',
      items: [
        { title: '复杂度计算类', path: ['第一章 数据结构', '1.1 线性表', '顺序表'], questions: [FULL_Q] },
        { title: '概念辨析类', path: ['第一章 数据结构', '1.1 线性表', '链表'], questions: [
          Object.assign({}, FULL_Q, { stem: '链表与顺序表在随机访问上的差异是什么？', options: [], pointPath: ['第一章 数据结构', '1.1 线性表', '链表'] })
        ] }
      ]
    },
    { type: '计算题', items: [{ title: '排序复杂度类', path: ['第二章 算法', '2.1 排序', '快速排序'], questions: [
      Object.assign({}, FULL_Q, { stem: '快速排序最坏情况下的比较次数？', pointPath: ['第二章 算法', '2.1 排序', '快速排序'] })
    ] }] }
  ],
  summary: '全书涵盖线性表两种存储结构与排序算法复杂度。'
};

const FILES = [{ name: '讲义.pdf', isImage: false }, { name: '图1.png', isImage: true }];

async function main() {
  // ============ A. 布局模块（真 require，真调用） ============
  section('A 组：SVG 导图布局算法（3 布局 / 配色 / 搜索 / 序列化）');
  let L = null;
  try { L = require(path.join(ROOT, 'renderer', 'js', 'mindmap-layout.js')); }
  catch (e) { console.error('    模块加载失败：' + e.message.split('\n')[0]); }
  ok(!!L, 'mindmap-layout.js 可被 Node 真 require（非仅浏览器内联）');
  if (L) {
    ok(typeof L.layoutTree === 'function', '导出 layoutTree');
    const modes = ['right', 'both', 'org'];
    const results = {};
    for (const m of modes) {
      let r = null;
      try { r = L.layoutTree(TREE, m); } catch (e) { console.error('    ' + m + ' 抛错：' + e.message); }
      results[m] = r;
      ok(r && Array.isArray(r.nodes) && r.nodes.length === 8, m + ' 布局产出 8 个节点（实为 ' + (r && r.nodes ? r.nodes.length : 'null') + '）');
      ok(r && Array.isArray(r.edges) && r.edges.length === 7, m + ' 布局产出 7 条连线');
      ok(r && r.width > 0 && r.height > 0, m + ' 布局给出画布尺寸');
    }
    if (results.right && results.both) {
      const a = results.right.nodes.map(n => n.x + ',' + n.y).join('|');
      const b = results.both.nodes.map(n => n.x + ',' + n.y).join('|');
      ok(a !== b, '右向树与双侧布局坐标真实不同（不是同一个实现换个名字）');
    }
    if (results.right && results.org) {
      const a = results.right.nodes.map(n => n.x + ',' + n.y).join('|');
      const c = results.org.nodes.map(n => n.x + ',' + n.y).join('|');
      ok(a !== c, '右向树与组织图坐标真实不同');
    }
    if (results.right) {
      const chapters = results.right.nodes.filter(n => n.type === 'chapter');
      ok(chapters.length === 2 && chapters[0].color && chapters[0].color !== chapters[1].color,
        '按章分支配色：两章颜色不同（markmap branch colors）');
      ok(results.right.nodes.every(n => typeof n.x === 'number' && typeof n.y === 'number' && isFinite(n.x) && isFinite(n.y)),
        '所有节点坐标是有限数（无 NaN 导致 SVG 空白）');
    }
    ok(typeof L.searchNodes === 'function', '导出 searchNodes（全文搜索定位）');
    if (L.searchNodes && results.right) {
      const hit = L.searchNodes(results.right.nodes, '顺序表');
      ok(Array.isArray(hit) && hit.includes('n3_0'), '搜索「顺序表」命中对应节点 id');
      ok((L.searchNodes(results.right.nodes, '不存在的词') || []).length === 0, '搜索无结果时返回空数组');
    }
    ok(typeof L.buildQuestionTree === 'function', '导出 buildQuestionTree（题型并入同一张导图）');
    if (L.buildQuestionTree) {
      const qt = L.buildQuestionTree([
        { type: '选择题', items: [{ title: '复杂度计算类', questions: [FULL_Q] }] },
        { type: '计算题', items: [{ title: '排序类', questions: [FULL_Q, FULL_Q] }] }
      ]);
      ok(qt && qt.type === 'root' && qt.children.length === 2, '题型树根下有 2 个题型分支');
      const qtypes = (qt && qt.children) || [];
      ok(qtypes.every(t => t.kind === 'qtype'), '题型节点带 kind=qtype');
      const items = qtypes.flatMap(t => t.children || []);
      ok(items.every(i => i.kind === 'qitem'), '子题型节点带 kind=qitem');
      const qs = items.flatMap(i => i.children || []);
      ok(qs.length === 3 && qs.every(q => q.kind === 'question'), '题目节点共 3 个且 kind=question（三级下钻的形状）');
      ok(qs.every(q => q.question && q.question.stem), '每个题目节点带完整 question 实体');
    }
    ok(typeof L.toMarkdown === 'function' && typeof L.toOpml === 'function', '导出 toMarkdown / toOpml（可带走）');
    if (L.toMarkdown && L.toOpml) {
      const md = L.toMarkdown(TREE), opml = L.toOpml(TREE);
      ok(typeof md === 'string' && md.includes('第一章 数据结构') && md.includes('  -'), 'Markdown 导出含层级缩进');
      ok(typeof opml === 'string' && opml.includes('<opml') && opml.includes('<outline'), 'OPML 导出含合法 outline 节点');
    }
  }

  // ============ B0. 真模型实测缺陷：一次 API 吐两个连在一起的 JSON ============
  section('B0 组：extractJson 括号配平（真模型 2026-11-09 实测缺陷）');
  const A0 = require(path.join(ROOT, 'core', 'analyze'));
  const one = JSON.stringify({ outline: { title: '含 {花括号} 与 "引号" 的书', children: [] }, summary: '第一份' });
  const two = JSON.stringify({ outline: { title: '第二份', children: [] }, summary: '重复尾巴' });
  const doubled = one + two;
  const parsedDoubled = A0.extractJson(doubled);
  ok(parsedDoubled && parsedDoubled.summary === '第一份', '两个连写 JSON 时只取第一个完整对象（旧实现会整体 parse 失败）');
  ok(A0.extractJson('```json\n' + one + '\n```') !== null, '仍兼容 markdown 代码块');
  ok(A0.extractJson('前缀说明 ' + one + ' 后缀解释') !== null, '仍兼容 JSON 前后有解释文字');
  ok(A0.extractJson('{"unclosed": ') === null, '被截断的半截 JSON 明确返回 null（不吞半截）');

  // ============ B. 一次 API 的数据契约（真跑 validate） ============
  section('B 组：题目实体契约（validate 真调用）');
  const A = require(path.join(ROOT, 'core', 'analyze'));
  let v = null;
  try { v = A.validate(PARSED); } catch (e) { console.error('    validate 抛错：' + e.message); }
  ok(!!v, 'validate 正常返回');
  if (v) {
    const groups = v.questionIndex || [];
    ok(groups.length === 2, '保留 2 个题型分组');
    const items0 = (groups[0] && groups[0].items) || [];
    ok(items0.length === 2, '保留 2 个子题型');
    const q0 = items0[0] && items0[0].questions && items0[0].questions[0];
    ok(!!q0, '子题型下保留 questions 数组（现在会被丢弃 → baseline 红）');
    if (q0) {
      ok(q0.stem === FULL_Q.stem, '题干字段保留');
      ok(Array.isArray(q0.options) && q0.options.length === 4, '选项数组保留');
      ok(q0.answer === FULL_Q.answer, '答案字段保留');
      ok(Array.isArray(q0.solution) && q0.solution.length === 2, '分步解答 solution[] 保留（详细解答）');
      ok(q0.rationale === FULL_Q.rationale, '解题思路 rationale 保留');
      ok(q0.pitfalls === FULL_Q.pitfalls, '易错点保留');
      ok(Array.isArray(q0.pointPath) && q0.pointPath.length === 3, '关联知识点路径保留');
      ok(q0.source && q0.source.file === '讲义.pdf' && q0.source.page === 12, '图书来源（文件+页码）保留');
      ok(!!q0.id, '每道题有确定性 id（前端点题目定位用）');
      ok(!!q0.pointId, '题目反查到导图知识点 id');
    }
    const allQ = groups.flatMap(g => (g.items || []).flatMap(i => i.questions || []));
    ok(allQ.length === 3, '全书共 3 道题被保留');
  }

  // ============ C. 可测效果指标 ============
  section('C 组：measureQuality 九项判据（「效果好」的外部判据）');
  ok(typeof A.measureQuality === 'function', '导出 measureQuality');
  if (typeof A.measureQuality === 'function' && v) {
    // 判别测试用小样本（3 题 / 2 类），传宽松阈值只验指标算法本身；
    // 真模型验证用默认严格阈值（fusion-decisions.md 第四节）。
    const q = A.measureQuality(v, FILES, { minQuestions: 3, minTypes: 2 });
    ok(!!q && typeof q === 'object', '返回指标对象');
    for (const k of ['jsonParsed', 'fieldCompleteRate', 'questionCount', 'typeCoverage', 'pathHitRate', 'placeholderRate', 'sourceHitRate', 'passed']) {
      ok(q && Object.prototype.hasOwnProperty.call(q, k), '含指标 ' + k);
    }
    ok(q.fieldCompleteRate === 1, '样例每题四字段齐全 → 完整率 1');
    ok(q.questionCount === 3, '题目数指标为 3');
    ok(q.typeCoverage === 2, '题型覆盖 2 类');
    ok(q.placeholderRate === 0, '无占位符率 0');
    ok(q.sourceHitRate === 1, '来源文件名全部可解析');
    ok(q.passed === true, '达标样例整体 passed=true');
    const bad = A.measureQuality({ questionIndex: [{ type: '选择题', items: [{ title: 'x', questions: [
      { stem: '略', answer: '', solution: [], rationale: '' }
    ] }] }], tree: null, stats: {} }, FILES);
    ok(bad && bad.passed === false, '残缺样例 passed=false（指标有判别力，不是恒真）');
  }

  // ============ D. 一次 API 提示词逻辑（运行时证据） ============
  section('D 组：一次 API 完整版提示词');
  const msgs = A.buildMessages('计算机基础', 'x'.repeat(300), FILES);
  const sys = msgs[0].content;
  ok(/questions/.test(sys), '提示词要求 questions 数组');
  ok(/solution/.test(sys) && /rationale/.test(sys), '提示词硬约束分步解答与解题思路字段');
  ok(/每(个)?子题型|每类题型/.test(sys) && /[0-9]+\s*[-~到]\s*[0-9]+/.test(sys), '提示词给出显式数量区间（结构化填空，非开放作文）');
  ok(/禁止|不要|不得/.test(sys) && /占位|略|待补充|示例/.test(sys), '提示词明确禁止占位内容');
  ok(sys.includes('讲义.pdf') && sys.includes('图1.png'), '提示词注入真实导入文件名清单（来源可回溯的前提）');
  ok(/JSON/.test(sys) && /不要任何解释|只输出|single/.test(sys), '提示词要求单个严格 JSON、无解释文字');
  ok(/questionIndex/.test(sys) && /outline/.test(sys), '提示词同时要求导图与题型索引（一次产出完整版）');
  ok(sys.length > 1200, '提示词足够完整（实为 ' + sys.length + ' 字符）');

  section('D2 组：analyze 真跑一次 chat，捕获调用参数');
  let capturedOpts = null, callCount = 0;
  try {
    await A.analyze('计算机基础', 'x'.repeat(300), {
      cfg: { baseURL: 'http://127.0.0.1:1/v1', model: 'mock', apiKey: '' },
      files: FILES,
      chat: async (cfg, m, o) => { callCount++; capturedOpts = o; return JSON.stringify(PARSED); }
    });
  } catch (e) { console.error('    analyze 抛错：' + e.message); }
  ok(callCount === 1, '一次分析只调用 1 次模型（真「一次 API」，实为 ' + callCount + ' 次）');
  ok(capturedOpts && capturedOpts.responseFormat === 'json_object', '要求 response_format=json_object（降低格式错误率）');
  ok(capturedOpts && capturedOpts.maxTokens >= 24000, '输出预算 ≥24000（按实测 p95 加 headroom，实为 ' + (capturedOpts && capturedOpts.maxTokens) + '）');

  section('D3 组：lib/llm.chat 真发 HTTP 携带 response_format');
  const llm = require(path.join(ROOT, 'lib', 'llm'));
  let received = null;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { received = JSON.parse(body); } catch (e) {}
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    await llm.chat({ baseURL: 'http://127.0.0.1:' + srv.address().port + '/v1', model: 'm', apiKey: '' },
      [{ role: 'user', content: 'hi' }], { responseFormat: 'json_object', maxTokens: 12000 });
  } catch (e) { console.error('    chat 抛错：' + e.message); }
  ok(received && received.response_format && received.response_format.type === 'json_object',
    '真 HTTP payload 里带 response_format（不是只在 analyze 层口头要求）');
  await new Promise(r => srv.close(r));

  section('D4 组：截断必须显式失败（外查基准 finish_reason=length）');
  const truncSrv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"half":' } }] }));
    });
  });
  await new Promise(r => truncSrv.listen(0, '127.0.0.1', r));
  let truncErr = '';
  try {
    await llm.chat({ baseURL: 'http://127.0.0.1:' + truncSrv.address().port + '/v1', model: 'm', apiKey: '' },
      [{ role: 'user', content: 'hi' }], {});
  } catch (e) { truncErr = e.message; }
  ok(/截断|length/.test(truncErr), 'finish_reason=length 时明确抛错，不把半截 JSON 当正常返回（实为：' + truncErr.slice(0, 60) + '）');
  const promptSrc = fs.readFileSync(path.join(ROOT, 'core', 'analyze.js'), 'utf8');
  ok(/单行紧凑|minified|禁止换行/.test(promptSrc), '提示词要求单行紧凑 JSON（防 27-34% 空白 token 浪费）');
  await new Promise(r => truncSrv.close(r));

  // ============ D5. 发布前独立评审缺陷的回归防线 ============
  section('D5 组：兼容降级 / 判据语义 / 老数据 / 版本闭环');

  // ① response_format 被上游拒绝 → 异常路径去掉字段重试一次；正常路径仍严格一次。
  let attempts = [];
  const compatSrv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let p = {}; try { p = JSON.parse(body); } catch (e) {}
      attempts.push(!!p.response_format);
      res.setHeader('Content-Type', 'application/json');
      if (p.response_format) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'response_format is not supported' } }));
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      }
    });
  });
  await new Promise(r => compatSrv.listen(0, '127.0.0.1', r));
  let compatText = '', compatErr = '';
  try {
    compatText = await llm.chat({ baseURL: 'http://127.0.0.1:' + compatSrv.address().port + '/v1', model: 'm', apiKey: '' },
      [{ role: 'user', content: 'hi' }], { responseFormat: 'json_object' });
  } catch (e) { compatErr = e.message; }
  ok(compatText === '{"ok":true}', '不支持 response_format 的中转仍能拿到结果（实为 ' + (compatErr || compatText) + '）');
  ok(attempts.length === 2 && attempts[0] === true && attempts[1] === false,
    '降级恰好 2 次调用：首次带字段、重试去掉字段（实为 ' + JSON.stringify(attempts) + '）');
  await new Promise(r => compatSrv.close(r));

  // ② 401 不重试（密钥/权限问题重试无意义，且会无谓破坏「一次 API」语义）
  let authAttempts = 0;
  const authSrv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      authAttempts++;
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    });
  });
  await new Promise(r => authSrv.listen(0, '127.0.0.1', r));
  try {
    await llm.chat({ baseURL: 'http://127.0.0.1:' + authSrv.address().port + '/v1', model: 'm', apiKey: '' },
      [{ role: 'user', content: 'hi' }], { responseFormat: 'json_object' });
  } catch (e) { /* 预期失败 */ }
  ok(authAttempts === 1, '401 不触发降级重试（实为 ' + authAttempts + ' 次）');
  await new Promise(r => authSrv.close(r));

  // ③ 判据语义：提示词期望区间 8-24，判据兜底上限 60；25 道全合格不该被判失败。
  const sys2 = A.buildMessages('t', 'x'.repeat(300), FILES)[0].content;
  ok(/8-24/.test(sys2), '提示词期望产出区间为 8-24（与 Q_RANGE 一致）');
  const manyQ = Array.from({ length: 25 }, (_, i) => ({
    stem: '题干' + i, answer: 'A. 内容 —— 有理由', solution: ['第 1 步：推导'],
    rationale: '从题干条件切入，先辨认考的是什么，再选方法；若误用别的公式会算错，这是常见错误做法。',
    pointId: 'n3_0', pointPath: ['第一章 数据结构', '1.1 线性表', '顺序表'],
    source: { file: '讲义.pdf', page: 1, quote: '顺序表支持随机访问' }
  }));
  const mq = A.measureQuality({ tree: TREE, questionIndex: [{ type: '选择题', items: [{ title: '概念辨析', questions: manyQ }] }], stats: {} }, FILES);
  ok(mq.questionCount === 25 && mq.checks.questionCount === true,
    '25 道全合格题目不被判整体失败（判据上限是兜底，不是拟合单次实测）');
  ok(mq.thresholds.maxQuestions === 60 && Object.keys(mq.checks).length === 9,
    '判据共 9 项、maxQuestions=60，与真模型 v4 台账阈值一致');

  // ④ 老数据兜底（真实点击由双形态 e2e 覆盖）
  const uiSrc = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'core-ui.js'), 'utf8');
  ok(/\(q\.items \|\| \[\]\)\.length/.test(uiSrc), '老数据题型组缺 items 不会抛 TypeError');
  ok(/openQitem\(wrapped\);/.test(uiSrc) && !/if \(cnt\) openQitem/.test(uiSrc),
    '老数据子题型无 questions 时面板也能打开（不再点了没反应）');

  // ⑤ 版本闭环：lock 与根 package.json 一致（v1.3.1 曾栽在 lock 上）
  const lockV = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const rootV = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  ok(lockV.version === rootV && lockV.packages[''].version === rootV,
    'package-lock.json 顶层与根包版本随根 package.json 同步（实为 ' + lockV.version + ' / ' + rootV + '）');
  const llmSrc = fs.readFileSync(path.join(ROOT, 'lib', 'llm.js'), 'utf8');
  ok(/timeoutMs \|\| 60000/.test(llmSrc) && !/请求超时（60 秒）/.test(llmSrc),
    '超时提示用真实 timeoutMs，不再硬编码 60 秒');

  // ============ E. Core 侧原图回读路由 ============
  section('E 组：图书原图 raw 路由（真 Core + 隔离书库）');
  const { Core } = require(path.join(ROOT, 'core'));
  const { dispatch } = require(path.join(ROOT, 'core', 'request'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mmv2-'));
  try {
    const core = new Core(tmp);
    const book = core.createBook('原图验证书');
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const rec = await core.addFile(book.id, png, { name: '图1.png' });
    const r = await dispatch(core, '/books/' + book.id + '/files/' + rec.id + '/raw', 'GET', {});
    ok(r.status === 200, 'raw 路由返回 200（实为 ' + r.status + '）');
    ok(r.data && typeof r.data.data === 'string' && r.data.data.length > 0, '返回 base64 原始字节');
    ok(r.data && /image\/png/.test(r.data.mime || ''), '返回正确 mime');
    ok(r.data && r.data.name === '图1.png', '返回原文件名（详情弹窗可显示来源）');
    const evil = await dispatch(core, '/books/' + book.id + '/files/..' + '/raw', 'GET', {});
    ok(evil.status >= 400, '恶意 fileId 被拒（安全不回归）');
  } finally { cleanup(tmp); }

  // ============ F. 前端接线（结构性，DOM 交互由 e2e 真浏览器覆盖） ============
  section('F 组：前端接线（DOM 交互见 _e2e/core-ui-verify.js）');
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'core.html'), 'utf8');
  ok(/id="btnLayoutRight"|data-layout="right"/.test(html), '有布局切换控件');
  ok(/id="btnOutline"|data-view="outline"/.test(html), '有大纲/导图双模式切换');
  ok(/id="mmSearch"/.test(html), '有全文搜索入口');
  ok(/id="questionModal"/.test(html), '有题目详情弹窗容器');
  ok(/id="qdImage"|id="qdSource"/.test(html), '详情弹窗含原图/来源区');
  const ui = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'core-ui.js'), 'utf8');
  ok(/mindmap-layout\.js|MindmapLayout/.test(ui), '前端引入/复用同一布局模块（单一真源）');
  ok(/buildQuestionTree|questionTree/.test(ui), '前端构建题型树并长进导图');
  ok(/\/raw['"]|\/raw`|\/raw\b/.test(ui) && /files\//.test(ui), '前端调用 files/.../raw 路由取原图（精确匹配，避免 draw 误命中）');

  console.log('\n=== 思维导图 v2 判别测试：通过 ' + passed + ' / 失败 ' + failed + ' ===');
  if (failed) process.exit(1);
}

main().catch(e => { console.error('测试自身异常：', e); process.exit(1); });
