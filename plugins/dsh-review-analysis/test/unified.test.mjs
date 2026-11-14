// DSH 插件统一核心化 · 判别测试（baseline 红 → candidate 绿 + 真跑全链路）。
// 外部判据：同一套「统一核心契约」检查，旧版（备份）必须违约、新版必须全过；
// 再用本地 mock LLM HTTP server 真跑 create→add→analyze→get→state，验证不是文案工程。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..');
const ROOT = path.resolve(PLUGIN, '..', '..');
const NEW = path.join(PLUGIN, 'index.js');
// baseline 旧版插件：从 git 历史 60b039c（「离线复习资料分析插件」）逐字导出。
// 原先放在 _backup/2026-11-08-forms/，但该目录被 .gitignore 忽略，clone 后测试必红；
// 2026-11-14 迁到 test/fixtures/ 作为正式判别夹具入库。断言一字未改。
const OLD = path.join(ROOT, 'test', 'fixtures', 'legacy-dsh-plugin', 'index.js');

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.error('  ✗ ' + msg); } }

function ctxStub() {
  const tools = [], routes = [];
  const ctx = {
    get: () => undefined,
    effect: (fn) => { fn(); return () => {}; },
    tools: { register: (t) => { tools.push(t); return () => {}; } },
    webServer: { register: (r) => { routes.push(r); return () => {}; } },
  };
  return { ctx, tools, routes };
}
async function load(entry) {
  const m = await import(pathToFileURL(entry).href + '?v=' + Math.random());
  return m;
}

// 统一核心契约：工具必须能承载「建书→导入→整体 LLM 分析→导图+题型索引」全链路。
function contractIssues(tool) {
  const issues = [];
  if (!tool) return ['未注册任何工具'];
  if (tool.name !== 'review_analysis') issues.push('工具名不是 review_analysis');
  const d = String(tool.description || '');
  if (/不联网|不调用模型|离线分析|规则版导图|考纲大纲/.test(d)) issues.push('仍是离线/不调模型/分层话术');
  if (!/统一/.test(d) || !/整体分析/.test(d)) issues.push('缺「统一核心 / 整本整体分析」语义');
  const props = (tool.parameters && tool.parameters.properties) || {};
  if (!props.action) issues.push('缺 action 分派参数');
  const en = (props.action && props.action.enum) || [];
  ['list', 'create', 'add', 'analyze', 'get'].forEach((a) => { if (!en.includes(a)) issues.push('缺 action=' + a); });
  if (!tool.output || !tool.output.schema || typeof tool.output.render !== 'function') issues.push('output.schema / render 不全（DSH 官方要求）');
  return issues;
}

const MOCK_ANALYSIS = JSON.stringify({
  outline: {
    title: '全书主题',
    children: [
      { title: '第一章 基础', children: [
        { title: '1.1 概念', children: [
          { title: '核心定义', children: [{ title: '定义延伸' }] },
          { title: '基本性质', children: [] },
        ] },
      ] },
      { title: '第二章 应用', children: [
        { title: '2.1 场景', children: [{ title: '典型例题', children: [] }] },
      ] },
    ],
  },
  questionIndex: [
    { type: '选择题', items: [{ title: '核心定义', path: ['第一章 基础', '1.1 概念', '核心定义'] }] },
    { type: '简答题', items: [{ title: '基本性质', path: ['第一章 基础', '1.1 概念', '基本性质'] }] },
  ],
  summary: '全书分基础与应用两部分，覆盖核心定义与典型应用。',
});

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: '' };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = String(b || ''); };
  return r;
}

(async () => {
  console.log('--- 判别测试：统一核心契约（旧版必红 / 新版必绿）---');
  if (!fs.existsSync(OLD)) {
    console.error('  ✗ 找不到旧版备份：' + OLD);
    process.exit(1);
  }
  const oldStub = ctxStub();
  const oldMod = await load(OLD);
  oldMod.apply(oldStub.ctx, { projectRoot: ROOT });
  const oldIssues = contractIssues(oldStub.tools[0]);
  console.log('  旧版违约项：' + oldIssues.join(' | '));
  ok(oldIssues.length > 0, 'BASELINE 红：旧版插件不满足统一核心契约');

  const newStub = ctxStub();
  const newMod = await load(NEW);
  newMod.apply(newStub.ctx, { projectRoot: ROOT });
  const newIssues = contractIssues(newStub.tools[0]);
  ok(newIssues.length === 0, 'CANDIDATE 绿：新版插件满足统一核心契约' + (newIssues.length ? '（' + newIssues.join(' | ') + '）' : ''));
  ok(Array.isArray(newMod.inject) && newMod.inject.includes('tools') && newMod.inject.includes('webServer'),
    'inject 声明 tools / webServer（DSH 官方要求）');
  const rendered = newStub.tools[0].output.render({}, { ok: true, action: 'list', books: [] });
  ok(Array.isArray(rendered) && rendered[0] && rendered[0].type === 'text', 'render 返回合法 ContentBlock');

  console.log('--- 安全与单一真源 ---');
  const patch = fs.readFileSync(path.join(PLUGIN, 'cordis.patch.yml'), 'utf8');
  // 只看非注释行：注释里出现 DSH_LLM_API_KEY 等字段名是必要说明，不算泄密。
  const patchCode = patch.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  ok(!/apiKey\s*:|api_key\s*:|token\s*:|sk-[A-Za-z0-9_-]{8,}/i.test(patchCode),
    'cordis.patch.yml 的实际配置不含任何密钥（注释里的字段名不算）');
  ok(/projectRoot/.test(patch), 'patch 声明 projectRoot 指向主项目 core/');
  const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));
  ok(!(pkg.files || []).some((f) => f.startsWith('engine/')), '发布清单不再打包旧 engine 副本');
  const idx = fs.readFileSync(NEW, 'utf8');
  ok(!/require\(['"]\.\/engine\//.test(idx), 'Host 不再 require 旧 engine');
  ok(/core['"]\/,\s*['"]index\.js|core\/index\.js|path\.resolve\(root, 'core', 'index\.js'\)/.test(idx), 'Host 指向主项目 core/index.js');

  console.log('--- 真跑全链路（本地 mock LLM HTTP server + 临时数据目录）---');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-unified-'));
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: MOCK_ANALYSIS } }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseURL = 'http://127.0.0.1:' + server.address().port + '/v1';

  try {
    const stub = ctxStub();
    newMod.apply(stub.ctx, { projectRoot: ROOT, library: tmp });
    const tool = stub.tools[0];

    const rList0 = await tool.execute({ action: 'list' });
    ok(rList0.ok === true && Array.isArray(rList0.books) && rList0.books.length === 0, 'list：空书架返回空数组');

    const rCreate = await tool.execute({ action: 'create', title: '判别测试书' });
    ok(rCreate.ok === true && !!rCreate.bookId && rCreate.title === '判别测试书', 'create：真建出一本书');

    // 真实长度语料（≥ MIN_TEXT=80）：融合后分析层会拒绝「几乎无文本」的书，
    // 夹具必须像真书一样够长，才能测到「真经 HTTP 调 LLM」这条主链路。
    const text = '第一章 绪论。核心定义与基本性质，讨论概念的来源、适用范围与常见误解。' +
      '第二章 应用。典型例题包括复合函数定义域的判定、反函数性质的证明，以及极限存在的判别条件。' +
      '第三章 综合。把前两章的结论用于解题，注意边界条件与特殊情形，避免把必要条件当成充分条件。';
    const rAdd = await tool.execute({
      action: 'add', bookId: rCreate.bookId,
      files: [{ name: '讲义.txt', data: Buffer.from(text).toString('base64') }],
    });
    ok(rAdd.ok === true && rAdd.materialCount === 1, 'add：真导入 1 份资料并抽到文本');

    const rAnalyze = await tool.execute({
      action: 'analyze', bookId: rCreate.bookId,
      cfg: { baseURL, model: 'mock-model', apiKey: 'test-key' },
    });
    ok(rAnalyze.ok === true, 'analyze：真经 HTTP 调用 LLM 并成功' + (rAnalyze.ok ? '' : '（' + rAnalyze.error + '）'));
    ok(!!(rAnalyze.tree && rAnalyze.tree.children && rAnalyze.tree.children.length), 'analyze 返回可层层展开的思维导图树');
    ok(Array.isArray(rAnalyze.questionIndex) && rAnalyze.questionIndex.length >= 1, 'analyze 返回题型分类索引');
    ok(rAnalyze.stats && rAnalyze.stats.chapters >= 1, 'analyze 返回统计');

    const rGet = await tool.execute({ action: 'get', bookId: rCreate.bookId });
    ok(rGet.ok === true && !!rGet.tree, 'get：分析结果真落盘，可再次读出');

    const res = fakeRes();
    await stub.routes[0].handler({ method: 'GET', headers: {} }, res);
    const view = JSON.parse(res.body);
    ok(view.ok === true && view.bookCount === 1 && view.analyzedCount === 1, 'state：面板视图读到 1 本已分析书');
    ok(!!(view.books[0].tree && Array.isArray(view.books[0].questionIndex)), 'state：面板拿到树 + 题型索引（承载全部内容）');

    const noCfg = await tool.execute({ action: 'analyze', bookId: rCreate.bookId });
    ok(noCfg.ok === false && /大模型配置|DSH_LLM/.test(noCfg.error || ''), 'analyze 缺模型配置时明确报错，不静默降级');
    const noKeyLeak = !/test-key/.test(JSON.stringify(noCfg) + res.body);
    ok(noKeyLeak, '密钥不出现在工具返回 / 面板状态里');
  } finally {
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log('\n--- DSH 统一核心判别测试：通过 ' + passed + ' / 失败 ' + failed + ' ---');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
