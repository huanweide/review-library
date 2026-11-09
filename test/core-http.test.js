'use strict';
// 统一核心 · HTTP 形态契约测试：/api/core/* 是本轮首次引入（git HEAD 无 core/ 也无该路由，
// 没有「改前实现」可对照），故本测试锁定新增路由与 Core 类签名的契约，不与任何旧实现作等价比较。
// 起独立端口 + 临时数据目录，真发 HTTP 请求，跑完自清，不污染真实 library。
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5191;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'core-http-'));
const BASE = 'http://127.0.0.1:' + PORT;

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.error('  ✗ ' + msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/core.html'); if (r.ok) return true; } catch (e) {}
    await sleep(200);
  }
  return false;
}
async function req(p, method, body) {
  const r = await fetch(BASE + '/api/core' + p, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), LIBRARY_ROOT: TMP, NO_OPEN: '1' }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (d) => { stderr += String(d); });
  try {
    ok(await waitServer(), 'server 在 ' + PORT + ' 就绪且 /core.html 可达');
    if (!await waitServer()) throw new Error('server 未就绪：' + stderr.slice(0, 300));

    const r0 = await req('/books');
    ok(r0.status === 200 && Array.isArray(r0.data.books) && r0.data.books.length === 0, 'GET /books：空书架');

    const r1 = await req('/books', 'POST', { title: 'HTTP 验证书' });
    ok(r1.status === 200 && !!r1.data.id, 'POST /books：真建书');
    const id = r1.data && r1.data.id;

    const r2 = await req('/books/' + id + '/files', 'POST', {
      // 真实长度语料（≥ MIN_TEXT=80）：这条用例要验证的是「无模型配置时 400」，
      // 语料太短会先被「可读文本过少」拦下，测不到目标分支。
      name: '讲义.txt', data: Buffer.from(
        '第一章 绪论。核心概念与基本性质，讨论概念的来源、适用范围与常见误解。' +
        '第二章 应用。典型例题包括复合函数定义域判定、反函数性质证明与极限存在判别。' +
        '第三章 综合。把前两章结论用于解题，注意边界条件与特殊情形。'
      ).toString('base64'),
    });
    ok(r2.status === 200 && r2.data.name === '讲义.txt', 'POST files：真导入资料');

    const r3 = await req('/books/' + id);
    ok(r3.status === 200 && r3.data.files && r3.data.files.length === 1, 'GET /books/:id：读回书与文件');

    const r4 = await req('/books/' + id + '/analysis');
    ok(r4.status === 404, 'GET analysis：未分析时明确 404');

    const r5 = await req('/books/' + id + '/analyze', 'POST', { cfg: {} });
    ok(r5.status === 400 && !!r5.data.error, 'analyze 无模型配置时友好 400，不静默空分析');

    const r6 = await req('/nope');
    ok(r6.status === 404, '未知路由 404');
  } catch (e) {
    failed++;
    console.error('  ✗ FATAL: ' + (e && e.stack || e));
  } finally {
    // Windows 下 SIGKILL 会留孤儿 server 占着 5191，后续测试连到旧进程读到脏数据；
    // 用 taskkill /T /F 杀进程树（详见 test/core-hardening.test.js 的同名辅助）。
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      else server.kill('SIGKILL');
    } catch (e) { try { server.kill('SIGKILL'); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n--- 统一核心 HTTP 回归：通过 ' + passed + ' / 失败 ' + failed + ' ---');
  process.exit(failed ? 1 : 0);
})();
