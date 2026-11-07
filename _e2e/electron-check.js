'use strict';
// 桌面版真入口验证：启动 dist/win-unpacked 里的 Electron，走 CDP 远程调试连上，
// 真点「收录一本书」验证 ipc 桥（Electron 模式 ≠ server 模式，必须单独证）。
// 纯英文路径运行，避开中文路径在原生工具下的编码问题；只关自己启动的进程。
const { chromium } = require('playwright-core');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const SRC = path.join(__dirname, '..', 'dist', 'win-unpacked');
const APP = 'C:\\Temp\\rl-app';
const EXE = path.join(APP, 'ReviewLibrary.exe');
const UDD = 'C:\\Temp\\rl-udd-' + Date.now();
const PORT = 9333;
const SHOTS = path.join(__dirname, 'shots');
// 每次验证用独立数据目录，避免重复跑累积出同名书（测试隔离，可重复）。
const DATA = 'C:\\Temp\\rl-verify-' + Date.now();

let pass = 0, fail = 0;
const check = (n, c, extra) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' [' + extra + ']' : ''))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error('请先把 dist/win-unpacked 复制到 C:\\Temp\\rl-app（纯英文路径）：');
    console.error('  cp -r "dist/win-unpacked/." /c/Temp/rl-app/');
    process.exit(1);
  }
  check('桌面版 exe 存在', fs.existsSync(EXE));
  check('exe 体积 > 100MB', fs.statSync(EXE).size > 100 * 1024 * 1024, String(fs.statSync(EXE).size));

  // WorkBuddy 沙箱注入 ELECTRON_RUN_AS_NODE=1，会把 Electron 当纯 Node 跑（参数全被拒、秒退）。
  // 验证时必须清掉；用户本机双击不受影响。
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  env.REVIEW_LIBRARY_ROOT = DATA;
  const child = spawn(EXE, [
    '--remote-debugging-port=' + PORT,
    '--remote-allow-origins=*',
    '--user-data-dir=' + UDD,
    '--no-sandbox', '--disable-gpu'
  ], { stdio: 'ignore', windowsHide: true, env });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { await getJSON('http://127.0.0.1:' + PORT + '/json/version'); ready = true; break; }
    catch (e) { await wait(250); }
  }
  if (!ready) { console.error('CDP 未就绪'); try { execSync('taskkill /PID ' + child.pid + ' /T /F'); } catch (e) {} process.exit(1); }

  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const page = pages.find(p => /index\.html/.test(p.url())) || pages[0];
  await page.waitForLoadState('load');
  await wait(600);

  check('页面标题正确', await page.title() === '复习资料图书馆');
  check('书架视图可见', await page.evaluate(() => {
    const el = document.getElementById('shelf');
    return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
  }));
  check('Electron ipc 桥 window.api 存在', await page.evaluate(() => !!window.api));
  check('API.trash.list 可用', await page.evaluate(() => !!(window.API && window.API.trash && typeof window.API.trash.list === 'function')));
  check('API.insight.generate 可用', await page.evaluate(() => !!(window.API && window.API.insight && typeof window.API.insight.generate === 'function')));
  check('本地 vendor 三库已加载', await page.evaluate(() => !!window.DOMPurify && !!window.mammoth && !!window.XLSX));
  check('CSP 限同源', await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return !!m && /connect-src 'self'/.test(m.content);
  }));

  // 真点按钮：Electron 模式走 ipc，不是 server 的 fetch
  await page.click('.add-card'); await wait(250);
  await page.fill('#c-title', '桌面版验证书');
  await page.click('#c-ok'); await wait(500);
  check('真点「收录一本书」→ ipc 落盘 → 封面出现', await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cover-title')).some(e => e.textContent.includes('桌面版验证书'))));
  await page.screenshot({ path: path.join(SHOTS, '09-electron-desktop.png') });

  console.log('\n桌面版验证： ' + pass + ' 通过 / ' + fail + ' 失败');
  try { await browser.close(); } catch (e) {}
  try { execSync('taskkill /PID ' + child.pid + ' /T /F >nul 2>&1'); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('桌面版验证崩溃：', e); process.exit(1); });
