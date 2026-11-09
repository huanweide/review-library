'use strict';
// 独立复核缺陷收尾 · 运行时判别测试（2026-11-09）。
//
// 背景：独立 reviewer 以全新上下文实证 8 条真缺陷（P0 路径穿越 / P1 默认窗口砸坏 /
// P1 门禁与判别测试假绿 / P2 吞错误与密钥回显 / P2 DSH 测试未进主套件）。
// 上两轮已因「纯文本正则假绿」返工，故本测试**全部用运行时证据**：
//   真 Core 实例 + 临时隔离目录、new URL 真解析、vm 真执行被测函数、
//   真起 server 发畸形请求、真起子进程跑门禁。
//
// 用法：node test/core-hardening.test.js   （改动前必须红，改动后必须绿）
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
// 失败输出走 stderr 原始写入：测试内部会临时接管 console.error 抓日志，
// 用 stderr.write 才不会被夹具自己吞掉（否则失败会静默，变成假绿）。
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; process.stderr.write('  ✗ ' + msg + '\n'); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'core-hard-'));
function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
// Windows 下 child.kill('SIGKILL') 不保证杀掉子进程树，实测会留下占用测试端口的孤儿 server，
// 导致后续测试连到旧进程、拿到脏数据而假失败。用 taskkill /T /F 兜底。
function killServer(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else { child.kill('SIGKILL'); }
  } catch (e) { try { child.kill('SIGKILL'); } catch (_) {} }
}

// ============ 缺陷 B（P0）：路径穿越删库 ============
async function testPathTraversal() {
  console.log('\n--- [B/P0] IPC 路径穿越：每条 PoC 独立临时目录（防级联污染）---');
  const { Core } = require(path.join(ROOT, 'core'));
  const requestLib = require(path.join(ROOT, 'core', 'request'));
  const { BookStore } = require(path.join(ROOT, 'core', 'bookStore'));

  // 每个 PoC 单独建库，避免「上一条删穿了库」导致后面全部因同一原因失败。
  async function withFresh(run) {
    const root = tmpdir();
    try {
      const core = new Core(root);
      const book = core.createBook('穿越验证书');
      return await run({ root, core, book, booksDir: path.join(root, 'books') });
    } finally { cleanup(root); }
  }

  // 逐字符复现 reviewer 的 PoC：/books/..  DELETE
  await withFresh(async ({ root, core, book, booksDir }) => {
    const r1 = await requestLib.dispatch(core, '/books/..', 'DELETE', {});
    ok(fs.existsSync(root) && fs.existsSync(booksDir), '删穿防护：/books/.. DELETE 后 library 根与 books/ 仍在');
    ok(r1.status >= 400, '/books/.. DELETE 应被拒绝（4xx），实为 ' + r1.status);
    ok(fs.existsSync(path.join(booksDir, book.id)), '原有书目录未被误删');
  });

  // 变体：反斜杠 / URL 编码 / 更多层 ..，每条独立书库
  const variants = [
    '/books/../..', '/books/..\\..\\', '/books/%2e%2e',
    '/books/' + encodeURIComponent('..' + path.sep + '..'),
  ];
  for (const v of variants) {
    await withFresh(async ({ core, booksDir }) => {
      const r = await requestLib.dispatch(core, v, 'DELETE', {});
      ok(fs.existsSync(booksDir) && r.status >= 400,
        '穿越变体被拒且书库完好：' + JSON.stringify(v) + ' -> ' + r.status);
    });
  }

  // fileId 穿越（DELETE /books/<id>/files/<fileId>）
  await withFresh(async ({ core, book, booksDir }) => {
    const r2 = await requestLib.dispatch(core, '/books/' + book.id + '/files/..', 'DELETE', {});
    ok(fs.existsSync(path.join(booksDir, book.id)) && r2.status >= 400,
      'fileId 穿越被拒且书目录完好（-> ' + r2.status + '）');
  });

  // 根因层：DSH / 专家直接调 Core 类，不经 request.js，必须双层拦截
  await withFresh(async ({ root, book, booksDir }) => {
    const store = new BookStore(root);
    let threw = false;
    try { store.deleteBook('..'); } catch (e) { threw = true; }
    ok(fs.existsSync(booksDir), 'BookStore.deleteBook("..") 不删穿 books/');
    ok(threw, 'BookStore.deleteBook("..") 明确抛错，不静默成功');
    let threw2 = false;
    try { store.removeFile(book.id, '..'); } catch (e) { threw2 = true; }
    ok(fs.existsSync(path.join(booksDir, book.id)), 'BookStore.removeFile(id,"..") 不删穿书目录');
    ok(threw2, 'BookStore.removeFile(id,"..") 明确抛错');
  });

  // 合法 id 仍可用（不能为修穿越把正常功能误杀）
  await withFresh(async ({ core }) => {
    const b2 = core.createBook('合法书');
    const r3 = await requestLib.dispatch(core, '/books/' + b2.id, 'GET', {});
    ok(r3.status === 200 && r3.data.id === b2.id, '合法 16 位 hex id 正常读取（无误杀）');
    const r4 = await requestLib.dispatch(core, '/books/' + b2.id, 'DELETE', {});
    ok(r4.status === 200 && r4.data.ok === true, '合法 id 正常删除（无误杀）');
  });

  // 第二轮独立复核：setFileText / getFileText 的 fileId 是方法参数（不在 URL 里），
  // dispatch 覆盖不到；Core 门面把它们公开给 DSH/专家形态，必须在存储层同样收口。
  await withFresh(async ({ root, book }) => {
    const store = new BookStore(root);
    const outside = path.join(root, 'PWNED.txt');
    // files/ → <id>/ → books/ → library 根：三级 .. 才能真正写出书库之外。
    const evil = '../../../PWNED';
    let threw = false;
    try { store.setFileText(book.id, evil, 'OWNED-BY-FILEID'); } catch (e) { threw = true; }
    ok(!fs.existsSync(outside), 'setFileText 的恶意 fileId 不写出 books/ 之外的文件');
    ok(threw, 'setFileText 的恶意 fileId 明确抛错');
    let threw2 = false;
    try { store.getFileText(book.id, evil); } catch (e) { threw2 = true; }
    ok(threw2, 'getFileText 的恶意 fileId 明确抛错（不越界读）');
  });
}

// ============ 缺陷 D（P1）：core.html 资源在 file:// 下可达 ============
function testFileProtocolAssets() {
  console.log('\n--- [D/P1] core.html 所有资源在 file:// 下真解析可达 ---');
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'core.html'), 'utf8');
  const base = 'file:///' + path.join(ROOT, 'renderer', 'core.html').replace(/\\/g, '/');
  const refs = [];
  const re = /(?:src|href)\s*=\s*"([^"#]+)"/gi;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  ok(refs.length >= 2, '至少解析出 2 个资源引用（实为 ' + refs.length + '）');
  const rendererDir = path.resolve(ROOT, 'renderer');
  for (const ref of refs) {
    let resolved;
    try { resolved = require('url').fileURLToPath(new URL(ref, base).href); } catch (e) { resolved = ''; }
    const inRenderer = !!resolved && (resolved === rendererDir || resolved.startsWith(rendererDir + path.sep));
    const exists = !!resolved && fs.existsSync(resolved);
    ok(inRenderer && exists, '资源落在 renderer/ 内且文件存在：' + ref + (resolved ? ' -> ' + path.relative(ROOT, resolved) : ' -> 解析失败'));
  }
}

// ============ 缺陷 C（P1）：vm 真执行 testConn，Electron 形态不裸 fetch ============
async function testTestConnElectron() {
  console.log('\n--- [C/P1] vm 真执行 testConn：Electron 形态必须走 window.api.llm.test ---');
  const src = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'core-ui.js'), 'utf8');
  // 用括号计数精确抠出整个 testConn 函数（不是正则匹配文本，抠出来要真执行）
  const start = src.indexOf('async function testConn()');
  ok(start >= 0, 'core-ui.js 中找得到 testConn 函数');
  if (start < 0) return;
  let depth = 0, end = -1, seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; }
    else if (src[i] === '}') { depth--; if (seen && depth === 0) { end = i + 1; break; } }
  }
  ok(end > start, 'testConn 函数体括号配平（可独立执行）');
  if (end < 0) return;
  const fnSrc = src.slice(start, end);

  let fetchCalls = 0, bridgeCalls = 0;
  const els = {};
  const $ = (sel) => (els[sel] = els[sel] || { textContent: '', className: '', value: '' });
  const fetchSpy = async () => { fetchCalls++; return { ok: true, json: async () => ({ ok: true, models: [] }) }; };
  const windowStub = { api: { llm: { test: async () => { bridgeCalls++; return { ok: true, models: [] }; } } } };
  const readSettings = () => ({ baseURL: 'https://example.invalid/v1', model: 'mock', apiKey: 'sk-FAKEKEY' });
  let testConn;
  try {
    testConn = new Function('$', 'fetch', 'window', 'readSettings',
      '"use strict";' + fnSrc + '\nreturn testConn;')($, fetchSpy, windowStub, readSettings);
    await testConn();
  } catch (e) { ok(false, 'testConn 执行不应抛错：' + e.message); return; }
  ok(fetchCalls === 0, 'Electron 形态下 testConn 不调用裸 fetch（实为 ' + fetchCalls + ' 次）');
  ok(bridgeCalls === 1, 'Electron 形态下 testConn 走 window.api.llm.test（实为 ' + bridgeCalls + ' 次）');
  ok(/fetch\(['"]\/api\/llm\/test/.test(src), 'HTTP 形态的 fetch 兜底分支仍保留（不能被删掉）');
}

// ============ 缺陷 A（P2）：dispatch 区分业务 4xx / 内部 5xx 且内部异常有日志 ============
async function testDispatchErrors() {
  console.log('\n--- [A/P2] dispatch 错误分类与可观测性 ---');
  const requestLib = require(path.join(ROOT, 'core', 'request'));
  const origErr = console.error;
  let logged = '';
  console.error = (...a) => { logged += a.join(' ') + '\n'; };
  try {
    // 内部异常（Node 系统错误带 code）→ 500 + 日志
    const internalCore = { getBook: () => { const e = new Error('EIO: disk read failed'); e.code = 'EIO'; throw e; } };
    const r1 = await requestLib.dispatch(internalCore, '/books/abcdef0123456789', 'GET', {});
    ok(r1.status >= 500, '内部系统异常应 5xx（实为 ' + r1.status + '），不再伪装成客户端错误');
    ok(/\[core request\]/.test(logged), '内部异常有服务端日志（实得：' + JSON.stringify(logged.slice(0, 80)) + '）');
    ok(!/apiKey|sk-/.test(JSON.stringify(r1.data)), '内部异常响应不带 cfg/密钥');

    // 业务错误（普通 Error）→ 保持 400，且不写噪声日志
    logged = '';
    const bizCore = { getBook: () => { throw new Error('书不存在'); } };
    const r2 = await requestLib.dispatch(bizCore, '/books/abcdef0123456789', 'GET', {});
    ok(r2.status === 400, '业务错误仍是 400（不破坏前端与既有契约），实为 ' + r2.status);
    ok(!/\[core request\]/.test(logged), '业务错误不写内部异常日志（避免日志噪声）');
  } finally { console.error = origErr; }
}

// ============ 缺陷 E（P2）：真起 server，畸形 JSON 不回显密钥 ============
async function testMalformedJsonNoLeak() {
  console.log('\n--- [E/P2] 真 HTTP：畸形 JSON 的错误响应不回显密钥片段 ---');
  const PORT = 5193;
  const root = tmpdir();
  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), LIBRARY_ROOT: root, NO_OPEN: '1' }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (d) => { stderr += String(d); });
  const BASE = 'http://127.0.0.1:' + PORT;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(BASE + '/core.html'); if (r.ok) { ready = true; break; } } catch (e) {}
      await sleep(200);
    }
    ok(ready, 'server 在 ' + PORT + ' 就绪' + (ready ? '' : '：' + stderr.slice(0, 200)));
    if (!ready) return;
    // 值不加引号：V8 的 SyntaxError 会回显原文片段（实测 'Unexpected token ..."{"apiKey":sk-SECRETK"...'），
    // 正是 reviewer 复现的泄密形态；缺右括号那种 V8 只报位置、不回显，测不出这个洞。
    const body = '{"cfg":{"apiKey":sk-SECRETKEYABCDEFG1234567890}}';
    const r = await fetch(BASE + '/api/core/books/abcdef0123456789/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    const text = await r.text();
    ok(r.status >= 400, '畸形 JSON 返回 4xx（实为 ' + r.status + '）');
    ok(!/sk-SECRET|SECRETKEY/.test(text), '错误响应不含密钥片段（实得：' + text.slice(0, 120) + '）');
    ok(!/sk-SECRET|SECRETKEY/.test(stderr), '服务端日志不含密钥片段');
  } finally {
    killServer(server);
    cleanup(root);
  }
}

// ============ 缺陷 F（P1）：门禁未安装时不得报「✓ 一致」 ============
function testFormsGateHonest() {
  console.log('\n--- [F/P1] 真子进程：形态全未安装时门禁不得报绿 ---');
  const empty = tmpdir();
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-forms.mjs')], {
      cwd: ROOT, encoding: 'utf8',
      env: Object.assign({}, process.env, { USERPROFILE: empty, HOME: empty }),
    });
    const out = (r.stdout || '') + (r.stderr || '');
    ok(!/✓\s*形态一致且均指向唯一核心/.test(out), '未安装时不再打印全称「✓ 形态一致且均指向唯一核心」');
    ok(/未安装|未验证|跳过/.test(out), '输出明确标注「未安装/未验证」降级（实得：' + out.trim().slice(0, 140) + '）');
    // 严格模式：显式要求已安装时必须红
    const r2 = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-forms.mjs'), '--require-installed'], {
      cwd: ROOT, encoding: 'utf8',
      env: Object.assign({}, process.env, { USERPROFILE: empty, HOME: empty }),
    });
    ok(r2.status !== 0, '--require-installed 严格模式下全未安装应 exit != 0（实为 ' + r2.status + '）');
  } finally { cleanup(empty); }
  // 挂进主链路（pretest），否则门禁形同虚设
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok(/check-forms\.mjs/.test(pkg.scripts.pretest || ''), 'forms:check 已挂进 pretest（每次 npm test 自动跑）');
}

// ============ 缺陷 G（P1）：判别测试自身覆盖 + 订正无基准措辞 ============
function testMetaHonesty() {
  console.log('\n--- [G/P1] 判别测试覆盖订正（元测试）---');
  const syncTest = fs.readFileSync(path.join(ROOT, 'test', 'core-unified-sync.test.js'), 'utf8');
  // 改动前的断言只查 src="/js/（见 core.html:131），不含 href；改动后必须覆盖 <link href>。
  ok(/href/.test(syncTest),
    'core-unified-sync.test.js 的绝对路径断言覆盖 <link href>，不只查 <script src>');
  const httpTest = fs.readFileSync(path.join(ROOT, 'test', 'core-http.test.js'), 'utf8');
  ok(!/行为不变/.test(httpTest), 'core-http.test.js 不再宣称「行为不变」（git HEAD 无 /api/core，本轮首次引入，无对照物）');
}

// ============ 缺陷 H（P2）：DSH 判别测试进主套件 ============
function testDshInMainSuite() {
  console.log('\n--- [H/P2] DSH 判别测试纳入根 npm test ---');
  const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'run-tests.js'), 'utf8');
  // 这里只是「源码声明 + 文件存在」检查（早期注释虚称「真跑收集逻辑」，已订正）。
  // 「DSH 套件真的被执行」由 npm test 的完整输出佐证，本函数不冒充那件事。
  const declared = /plugins[\\/]dsh-review-analysis[\\/]test|dsh-review-analysis/.test(runner);
  const mjsAware = /\.test\.mjs/.test(runner);
  ok(declared, 'run-tests.js 声明了 DSH 插件测试目录');
  ok(mjsAware, 'run-tests.js 收集 .test.mjs（不只 .test.js）');
  const dsh = path.join(ROOT, 'plugins', 'dsh-review-analysis', 'test', 'unified.test.mjs');
  ok(fs.existsSync(dsh), 'DSH 判别测试文件存在');
  // 真跑 run-tests.js 的收集逻辑（--list 只列名单、不执行套件）。
  // 不能在这里 spawn 全量套件：本文件本身就被收集，嵌套调用会递归并抢占 E 段的 5193 端口。
  const listed = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'run-tests.js'), '--list'], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000,
    env: Object.assign({}, process.env, { NO_OPEN: '1' }),
  });
  const out = (listed.stdout || '') + (listed.stderr || '');
  ok(listed.status === 0, 'run-tests.js --list exit 0（实为 ' + listed.status + '）');
  ok(/unified\.test\.mjs/.test(out), '真跑收集逻辑：DSH 判别套件出现在主链路名单里');
  ok(/收集\s*\d+\s*个套件/.test(out), '--list 输出真实收集计数');

  // 反假绿：e2e 的 fetch 计数器必须真的 hook 了 window.fetch（不是只初始化为 0）。
  const e2e = fs.readFileSync(path.join(ROOT, '_e2e', 'core-ui-verify.js'), 'utf8');
  ok(/window\.fetch\s*=/.test(e2e) && /__llmFetchCalls\+\+/.test(e2e),
    'e2e 真 hook window.fetch 并递增计数（不是恒 0 变量）');
  ok(/反证|delete window\.api\.llm\.test/.test(e2e), 'e2e 有反证：移除 bridge 验证计数器有判别力');
}

(async () => {
  try { await testPathTraversal(); } catch (e) { failed++; console.error('  ✗ [B] FATAL ' + (e.stack || e)); }
  try { testFileProtocolAssets(); } catch (e) { failed++; console.error('  ✗ [D] FATAL ' + (e.stack || e)); }
  try { await testTestConnElectron(); } catch (e) { failed++; console.error('  ✗ [C] FATAL ' + (e.stack || e)); }
  try { await testDispatchErrors(); } catch (e) { failed++; console.error('  ✗ [A] FATAL ' + (e.stack || e)); }
  try { await testMalformedJsonNoLeak(); } catch (e) { failed++; console.error('  ✗ [E] FATAL ' + (e.stack || e)); }
  try { testFormsGateHonest(); } catch (e) { failed++; console.error('  ✗ [F] FATAL ' + (e.stack || e)); }
  try { testMetaHonesty(); } catch (e) { failed++; console.error('  ✗ [G] FATAL ' + (e.stack || e)); }
  try { testDshInMainSuite(); } catch (e) { failed++; console.error('  ✗ [H] FATAL ' + (e.stack || e)); }
  console.log('\n=== 缺陷收尾判别测试：通过 ' + passed + ' / 失败 ' + failed + ' ===');
  process.exit(failed ? 1 : 0);
})();
