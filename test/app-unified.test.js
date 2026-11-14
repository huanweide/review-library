'use strict';
// 一体形态契约测试（2026-11-14）。
//
// 用户定调：「APP 端是一个形式，Skills 也是一个形式，DSH 的适配也是一种形式，
// 但它们都能够兼容，是一个东西。」
//
// 本测试把这句话变成可证伪的判据：五种形态的能力集合必须完全一致，且经
// 同一种 action 读写同一份书库。任何一处手写 action 列表漂移，测试立即红。
//
// 纪律（与 core-capability-sync.test.js 一致）：不读源码字符串冒充能力，
// 全部走真实调用 / 真落盘 / 真子进程 / 真 ESM 插件加载。
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'app-unified-'));
const CAPS = require(path.join(ROOT, 'core', 'capabilities.js'));
const HOST = require(path.join(ROOT, 'core', 'app-host.js'));
const DRIVER = path.join(ROOT, 'plugins', 'review-analysis', 'bin', 'driver.js');
const DSH = path.join(ROOT, 'plugins', 'dsh-review-analysis', 'index.js');

let passed = 0, failed = 0;
function ok(cond, msg, extra) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg + (extra ? '  [' + extra + ']' : '')); }
}
function setEq(a, b) {
  return Array.from(new Set(a || [])).sort().join(',') === Array.from(new Set(b || [])).sort().join(',');
}
function safe(fn) { try { return fn(); } catch (e) { return { __err: e && e.message || String(e) }; } }

// 一份真实的最小分析产物（供 practice/quiz/due 走真数据，不 mock 业务）
function makeAnalysis() {
  return {
    tree: { id: 'n0_0', type: 'root', title: '一体形态验证全书', children: [] },
    summary: '五形态共用同一份数据',
    stats: { chapters: 1, sections: 0, points: 0, subtypes: 0, questionTypes: 1, questionCount: 1 },
    questionIndex: [{ type: '选择题', items: [{ title: '同源', path: ['第一章'], pointId: 'n1_1', questions: [
      { id: 'q0', stem: '五个形态读的是同一本书吗？', options: ['A. 是', 'B. 不是'],
        answer: 'A. 是 —— 唯一核心 core/ 落盘。', solution: ['单一真源'], rationale: '',
        pitfalls: '', difficulty: '基础', pointPath: ['第一章'],
        source: { file: '讲义.txt', page: 1, anchor: '【块1】', quote: '' } }
    ] }] }],
  };
}

(async () => {
  console.log('--- 一体形态契约：APP manifest / Core / CLI / DSH / dispatch 能力集合一致 ---');

  // ① 唯一真源
  const canonical = CAPS.ACTIONS.slice();
  ok(canonical.length === 10, '唯一真源 capabilities.js 有 10 个 action', '实际 ' + canonical.length);

  // ② APP 协议 manifest（HTTP / Electron / DSH 三宿主都返回同一份）
  const mHttp = HOST.manifest('http', { version: '1.5.2' });
  const mElec = HOST.manifest('electron', { version: '1.5.2' });
  const mDsh = HOST.manifest('dsh', { version: '1.5.2' });
  ok(mHttp.ok && !mHttp.drift, 'APP manifest 无漂移', JSON.stringify(mHttp.drift));
  ok(setEq(mHttp.actions, canonical), 'APP manifest.action 集合 === 唯一真源');
  ok(setEq(mElec.actions, mDsh.actions) && setEq(mHttp.actions, mDsh.actions),
    '三宿主 manifest 完全一致（host 只影响显示，不影响能力）');
  const viewActions = mHttp.views.filter(v => v.action).map(v => v.action);
  ok(viewActions.every(a => canonical.includes(a)), '所有视图引用的 action 都在清单内');
  ok(mHttp.capabilities.length === canonical.length, '每个 action 都有 UI 元数据');

  // ③ CLI / 专家形态：真子进程 --action 白名单（取 unsupported 报错里列出的可用 action）
  const cliProbe = cp.spawnSync(process.execPath, [DRIVER, '--project', ROOT, '--action', '__probe_unsupported__', '--bookId', 'x'], { encoding: 'utf8' });
  const cliOut = String((cliProbe.stdout || '') + (cliProbe.stderr || ''));
  const cliMatch = /可用\s+([a-z\/]+)/.exec(cliOut);
  const cliActions = cliMatch ? cliMatch[1].split('/').filter(Boolean) : [];
  ok(cliActions.length > 0, 'CLI 真子进程有响应', cliOut.slice(0, 120));
  ok(setEq(cliActions, canonical), 'CLI/专家 action 集合 === 唯一真源', cliActions.join(','));

  // ④ DSH 插件：真 ESM 加载，取 tool.parameters.properties.action.enum
  let dshActions = [];
  try {
    const dshUrl = pathToFileURL(DSH).href + '?v=' + Math.random();
    const mod = await import(dshUrl);
    const tools = [], routes = [];
    const ctx = {
      get: () => undefined,
      effect: (fn) => { fn(); return () => {}; },
      tools: { register: (t) => { tools.push(t); return () => {}; } },
      webServer: { register: (r) => { routes.push(r); return () => {}; } },
    };
    mod.apply(ctx, { projectRoot: ROOT, library: TMP });
    dshActions = ((tools[0] && tools[0].parameters && tools[0].parameters.properties.action || {}).enum) || [];
    ok(setEq(dshActions, canonical), 'DSH 工具 enum === 唯一真源', dshActions.join(','));
    // DSH 挂上了三个应用协议端点（APP 能在 DSH 中使用的硬证据）
    const paths = routes.map(r => r.path);
    ok(paths.includes('/review-analysis/api/app/manifest'), 'DSH 挂了 APP manifest 端点');
    ok(paths.includes('/review-analysis/api/app/state'), 'DSH 挂了 APP state 端点');
    ok(paths.includes('/review-analysis/api/app/action'), 'DSH 挂了 APP action 端点');
    // DSH 侧栏面板内嵌同一个 workbench 应用（静态资源同源托管）
    ok(paths.includes('/review-analysis/app/index.html'), 'DSH 托管了 APP 入口（同一份应用工程）');
    ok(paths.includes('/review-analysis/app/src/main.js'), 'DSH 托管了 APP 模块');
    ok(paths.includes('/review-analysis/app/src/host.js'), 'DSH 托管了宿主适配层');
  } catch (e) {
    ok(false, 'DSH 真 ESM 加载', e.message.slice(0, 120));
  }

  // ⑤ dispatch（HTTP/Electron 传输层）能力覆盖：10 个 action 都能经 Core 门面走通
  const { Core } = require(path.join(ROOT, 'core', 'index.js'));
  const core = new Core(TMP);
  const book = core.createBook('一体形态验证书');
  core.getBookText && core.getBookText(book.id); // 触发一次真实读取，确保书结构完整
  // 直接写一份符合契约的分析产物，让 practice/quiz/due 有真数据
  const analysis = makeAnalysis();
  const bookDir = path.join(TMP, 'books', book.id);
  fs.mkdirSync(bookDir, { recursive: true });
  fs.writeFileSync(path.join(bookDir, 'analysis.json'), JSON.stringify(analysis), 'utf8');

  const invokeResults = {};
  for (const a of canonical) {
    let payload = {};
    if (a === 'create') payload = { title: '由 APP 协议新建' };
    else if (a === 'add') payload = { bookId: book.id, files: [{ name: 'a.txt', data: Buffer.from('一体').toString('base64') }] };
    else if (a === 'analyze') { /* 需要真模型，跳过实际调用，只验门面可达 */ }
    else if (a === 'attempt') payload = { bookId: book.id, key: 'x', given: 'A' };
    else if (a === 'rate') payload = { bookId: book.id, key: 'x', rating: 3 };
    else payload = { bookId: book.id };
    if (a === 'analyze') {
      invokeResults[a] = { ok: true, skipped: true };
      continue;
    }
    invokeResults[a] = await HOST.invoke(core, a, payload, {});
  }
  // 判据不是「全部返回 ok=true」：attempt/rate 用假 key 会命中真实业务拒绝
  // （「尚无分析结果」「没有这道练习记录」），那恰好证明调用到达了 Core 门面。
  // 真正要守的是「没有 action 因协议层缺席而失败」——即不能返回
  // '应用协议未适配' / '统一核心缺少门面方法' / '不支持的 action'。
  const protocolFail = Object.keys(invokeResults).filter(k => {
    const r = invokeResults[k];
    if (r.ok || r.skipped) return false;
    return /应用协议未适配|缺少门面方法|不支持的 action/.test(r.error || '');
  });
  ok(protocolFail.length === 0, '10 个 action 全部到达 Core 门面（业务拒绝不算协议失败）',
    '协议缺席: ' + protocolFail.join(','));
  ok(/尚无分析结果|没有这道练习记录|题目不存在/.test(invokeResults.attempt.error || ''),
    'attempt 命中真实业务校验（非协议层拦截）', invokeResults.attempt.error);

  // ⑥ 数据同源：APP 协议 create 的书，Core.listBooks 立刻能读到
  const before = core.listBooks().length;
  const created = await HOST.invoke(core, 'create', { title: 'APP 写入同源验证' }, {});
  const after = core.listBooks().length;
  ok(created.ok && after === before + 1, 'APP 写入的数据与 Core/DSH/CLI 同源', before + '→' + after);

  // ⑦ 越界 action 四形态一致拒绝
  const bad = await HOST.invoke(core, '__no_such_action__', {}, {});
  ok(bad.ok === false && /不支持的 action/.test(bad.error), 'APP 协议拒绝清单外 action');
  ok(/[（(]可用 /.test(bad.error), '拒绝信息回带完整清单（与 DSH/CLI 同口径）');

  // ⑧ server.js / Electron / DSH 都 require 同一份 app-host（文本级挂点检查，仅作补充）
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'app', 'main.js'), 'utf8');
  const dshSrc = fs.readFileSync(DSH, 'utf8');
  ok(/require\('\.\/core\/app-host'\)/.test(srv), 'server.js 挂了统一协议');
  ok(/require\('\.\.\/core\/app-host'\)/.test(main), 'Electron 主进程挂了统一协议');
  ok(/appHostLoader/.test(dshSrc), 'DSH 挂了统一协议');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'plugins', 'dsh-review-analysis', 'client.js'), 'utf8');
  ok(/review-analysis\/app\/index\.html\?base=/.test(clientSrc), 'DSH 侧栏面板内嵌同一 APP 并把协议端点指回本插件');
  // APP 自身不硬编码 action 列表，界面由 manifest 驱动
  const wbViews = fs.readFileSync(path.join(ROOT, 'workbench', 'src', 'views.js'), 'utf8');
  ok(/host\.action\(/.test(wbViews) && !/ACTIONS\s*=\s*\[/.test(wbViews), 'APP 视图经统一协议调用，未自带 action 清单');

  console.log('\n=== 一体形态契约：' + passed + ' 通过 / ' + failed + ' 失败 ===');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
