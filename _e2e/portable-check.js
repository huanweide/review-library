'use strict';
// 单文件 portable exe 真入口验证。
// 与 electron-check.js 的关键差异：故意不设 REVIEW_LIBRARY_ROOT，
// 用来取证「portable 自解压后数据到底落在哪」——这是"数据在你手里"的命门。
// 判据：真点「收录一本书」后，exe 同级 library/index.json 必须含这本书。
const { chromium } = require('playwright-core');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const APP = 'C:\\Temp\\rl-portable';
const EXE = path.join(APP, 'ReviewLibrary.exe');
const SRC = process.argv[2] || 'C:\\Temp\\review-library\\dist\\ReviewLibrary-0.2.0-portable.exe';
const UDD = 'C:\\Temp\\rl-pudd-' + Date.now();
const PORT = 9341;
const SHOTS = path.join(__dirname, 'shots');

let pass = 0, fail = 0;
const check = (n, c, extra) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' [' + extra + ']' : ''))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  // 准备干净的纯英文运行目录（不删用户数据，只清本验证专用的 library）
  fs.mkdirSync(APP, { recursive: true });
  if (!fs.existsSync(EXE)) fs.copyFileSync(SRC, EXE);
  const dataDir = path.join(APP, 'library');
  if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });

  check('单文件 exe 存在', fs.existsSync(EXE));
  const size = fs.statSync(EXE).size;
  check('exe 体积 > 50MB', size > 50 * 1024 * 1024, (size / 1024 / 1024).toFixed(1) + 'MB');

  // 清掉 WorkBuddy 沙箱注入的 ELECTRON_RUN_AS_NODE（会把 Electron 当纯 Node 跑）
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.REVIEW_LIBRARY_ROOT;   // 关键：不覆盖，测自然落点

  const child = spawn(EXE, [
    '--remote-debugging-port=' + PORT,
    '--remote-allow-origins=*',
    '--user-data-dir=' + UDD,
    '--no-sandbox', '--disable-gpu'
  ], { stdio: 'ignore', windowsHide: true, env, cwd: APP });

  let ready = false;
  for (let i = 0; i < 140; i++) {
    try { await getJSON('http://127.0.0.1:' + PORT + '/json/version'); ready = true; break; }
    catch (e) { await wait(250); }
  }
  if (!ready) { console.error('CDP 未就绪（portable 自解压可能超时）'); try { execSync('taskkill /PID ' + child.pid + ' /T /F'); } catch (e) {} process.exit(1); }

  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const page = pages.find(p => /index\.html/.test(p.url())) || pages[0];
  await page.waitForLoadState('load');
  await wait(800);

  check('页面标题正确', await page.title() === '复习资料图书馆');
  check('书架视图可见', await page.evaluate(() => {
    const el = document.getElementById('shelf');
    return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
  }));
  check('Electron ipc 桥 window.api 存在', await page.evaluate(() => !!window.api));
  check('本地 vendor 三库已加载', await page.evaluate(() => !!window.DOMPurify && !!window.mammoth && !!window.XLSX));
  check('CSP 限同源', await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return !!m && /connect-src 'self'/.test(m.content);
  }));

  let reportedDir = null;
  try { reportedDir = await page.evaluate(() => window.API.app.dataDir()); } catch (e) {}
  check('主进程报告的数据目录 = exe 同级 library',
    reportedDir === dataDir, '报告=' + reportedDir + ' 期望=' + dataDir);

  // 真点按钮：Electron 模式走 ipc 落盘
  await page.click('.add-card'); await wait(250);
  await page.fill('#c-title', '便携版验证书');
  await page.click('#c-ok'); await wait(600);
  check('真点「收录一本书」→ 封面出现', await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cover-title')).some(e => e.textContent.includes('便携版验证书'))));
  await page.screenshot({ path: path.join(SHOTS, '10-portable-exe.png') });

  // 落点取证：exe 同级 library 必须真的有这本书
  const idxPath = path.join(dataDir, 'index.json');
  const atExeSide = fs.existsSync(idxPath) && fs.readFileSync(idxPath, 'utf8').includes('便携版验证书');
  check('数据落在 exe 同级 library（可备份、关掉不丢）', atExeSide, idxPath);

  if (!atExeSide) {
    // 排查：是不是落进了 portable 自解压的临时目录
    const tmpRoot = os.tmpdir();
    const hits = [];
    try {
      for (const d of fs.readdirSync(tmpRoot)) {
        if (!/^\{|^[0-9a-f-]{8}|electron|nsis|\.tmp$/i.test(d)) continue;
        const p = path.join(tmpRoot, d, 'library', 'index.json');
        if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('便携版验证书')) hits.push(p);
      }
    } catch (e) {}
    console.log('  · 临时目录命中：' + (hits.length ? hits.join(', ') : '（未找到，或已随退出清理）'));
    console.log('  · 结论：portable 自解压路径 ≠ 用户放置 exe 的目录，数据落点错误');
  }

  console.log('\n单文件 portable 验证： ' + pass + ' 通过 / ' + fail + ' 失败');
  try { await browser.close(); } catch (e) {}
  try { execSync('taskkill /PID ' + child.pid + ' /T /F >nul 2>&1'); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('单文件验证崩溃：', e); process.exit(1); });
