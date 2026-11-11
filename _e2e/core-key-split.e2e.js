'use strict';
// core 形态密钥分层判别（①）：默认窗口 core.html 保存配置后，apiKey 不得进 localStorage，只进 sessionStorage。
// 复用项目 server.js 后端（正确处理 renderer/ 静态路由与 /api），避免自制静态 server 的路径坑。
// baseline（旧 core-ui.js：saveCfg 整体写 localStorage 含 apiKey）→ 失败（红）；candidate（分层后）→ 全绿。
const { chromium } = require('playwright-core');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5311;
const BASE = 'http://127.0.0.1:' + PORT;
const TEST_KEY = 'sk-COREKEYSPLIT123456';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
}

(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-core-key-'));
  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), LIBRARY_ROOT: tmpRoot, NO_OPEN: '1' }),
  });
  let stderr = '';
  server.stderr.on('data', (d) => { stderr += String(d); });

  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/core.html'); if (r.ok) { ready = true; break; } } catch (e) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) { console.error('server 未就绪：' + stderr.slice(0, 300)); process.exit(1); }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(BASE + '/core.html', { waitUntil: 'load' });
    await page.waitForSelector('#openSettings', { timeout: 12000 });
    await page.click('#openSettings');
    await page.fill('#cfgBase', 'https://api.example.invalid/v1');
    await page.fill('#cfgModel', 'mock-model');
    await page.fill('#cfgKey', TEST_KEY);
    await page.click('#saveSettings');
    await page.waitForTimeout(250);

    const store = await page.evaluate(() => ({
      ls: localStorage.getItem('core_llm_cfg') || '',
      ss: sessionStorage.getItem('core_llm_key') || '',
    }));

    ok(!new RegExp(TEST_KEY).test(store.ls),
      'core 形态：localStorage(core_llm_cfg) 不含 apiKey 明文（实为 ' + store.ls.slice(0, 70) + '）');
    ok(store.ss === TEST_KEY,
      'core 形态：apiKey 只进 sessionStorage(core_llm_key)（实为 ' + JSON.stringify(store.ss) + '）');
    ok(/mock-model/.test(store.ls) && /api\.example\.invalid/.test(store.ls),
      'core 形态：baseURL/model 仍存 localStorage（保留便利，未丢）');

    await page.click('#openSettings');
    const back = await page.evaluate(() => document.querySelector('#cfgKey').value);
    ok(back === TEST_KEY, 'core 形态：重开设置弹窗密钥从 sessionStorage 回填（实为 ' + JSON.stringify(back) + '）');
  } catch (e) {
    failed++;
    console.error('FATAL ' + (e && e.stack || e));
  } finally {
    try { await browser.close(); } catch (_) {}
    try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else server.kill('SIGKILL'); } catch (_) {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  }
  console.log('\n=== core-key-split 判别：通过 ' + passed + ' / 失败 ' + failed + ' ===');
  process.exit(failed ? 1 : 0);
})();
