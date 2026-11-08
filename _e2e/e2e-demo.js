'use strict';
// 预览站（GitHub Pages / 静态托管）端到端自检：
// 用本机 Edge 静态托管 renderer/ + demo/book.json，模拟「无后端」场景，
// 验证：自动进入只读演示模式、书架/书内/考纲/分析均能从内置示例渲染、所有写入按钮被禁用、零外链、零 JS 报错。
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5299;
const BASE = 'http://localhost:' + PORT;
const RENDERER = path.join(__dirname, '..', 'renderer');
const DEMO = path.join(__dirname, '..', 'demo');
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });

function findEdge() {
  const cands = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}
const EDGE = findEdge();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json'
};
function mime(p) { const e = path.extname(p).toLowerCase(); return MIME[e] || 'application/octet-stream'; }
function send(res, code, body, type) { res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' }); res.end(body); }

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u.startsWith('/api/')) return send(res, 404, JSON.stringify({ error: 'no backend' }), 'application/json');
  if (u === '/' || u === '') u = '/index.html';
  if (u === '/demo/book.json') {
    try { return send(res, 200, fs.readFileSync(path.join(DEMO, 'book.json')), 'application/json'); }
    catch (e) { return send(res, 404, 'not found'); }
  }
  const fp = path.join(RENDERER, u);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return send(res, 200, fs.readFileSync(fp), mime(u));
  if (!path.extname(u)) return send(res, 200, fs.readFileSync(path.join(RENDERER, 'index.html')), 'text/html');
  return send(res, 404, 'not found');
});

let pass = 0, fail = 0; const fails = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!EDGE) { console.error('未找到 Edge 浏览器，跳过演示站 e2e'); process.exit(0); }
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
  const pageErrors = [], externalRequests = [];
  page.on('request', r => {
    const uu = r.url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(uu)) return;
    if (/^(data|blob|about|chrome-extension|file):/i.test(uu)) return;
    externalRequests.push(uu);
  });
  page.on('pageerror', e => { pageErrors.push(String(e)); console.log('PAGEERROR:', e && e.stack ? e.stack : String(e)); });
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (/Failed to load resource|favicon/i.test(t)) return; pageErrors.push('console:' + t); console.log('CONSOLE-ERR:', t); } });

  const vis = (sel) => page.evaluate(s => {
    const el = document.querySelector(s); if (!el) return false;
    if (el.closest('.hidden')) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }, sel);
  const pe = (sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? getComputedStyle(el).pointerEvents : null; }, sel);

  console.log('E2E-DEMO（预览站只读模式）：');
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await wait(800); // 等 ensureBackend 探测 + 示例数据加载

  // 1) 自动进入演示模式
  check('演示横幅可见（自动进入只读预览站）', await vis('#demo-banner'));
  check('body 带 demo-mode 类', await page.evaluate(() => document.body.classList.contains('demo-mode')));
  check('页面标题/说明含「只读」', await page.evaluate(() => document.getElementById('demo-banner').textContent.includes('只读')));

  // 2) 书架用内置示例渲染出书
  check('书架首屏可见', await vis('#shelf'));
  const covers = await page.evaluate(() => Array.from(document.querySelectorAll('.cover-title')).map(e => e.textContent));
  check('书架渲染出示例书封面(≥1)', covers.length >= 1, JSON.stringify(covers));
  await page.screenshot({ path: path.join(SHOTS, 'demo-01-shelf.png') });

  // 3) 打开书 → 资料网格（示例 2 份）
  if (covers.length >= 1) {
    await page.click('.book-card:not(.add-card)'); await wait(500);
    check('书内视图可见', await vis('#book'));
    const mats = await page.evaluate(() => document.querySelectorAll('.mat-card').length);
    check('书内渲染出示例资料(=2)', mats === 2, 'mats=' + mats);
    // 写入类按钮在 demo 模式下被禁用（pointer-events:none）
    check('「添加资料」按钮被禁用(pointer-events:none)', (await pe('#add-mat')) === 'none', 'pe=' + (await pe('#add-mat')));
    await page.screenshot({ path: path.join(SHOTS, 'demo-02-book.png') });
  } else {
    check('书内视图可见', false, '无书可开');
  }

  // 4) 考纲子页（示例考纲）
  await page.click('#nav-shelf'); await wait(300);
  await page.click('.book-card:not(.add-card)'); await wait(400);
  await page.click('.book-tab[data-pane="syllabus"]'); await wait(500);
  check('考纲子页可见', await vis('#pane-syllabus'));
  const chaps = await page.evaluate(() => document.querySelectorAll('.syl-chapter-head').length);
  check('考纲视图渲染出章节(≥1)', chaps >= 1, 'chapters=' + chaps);
  await page.screenshot({ path: path.join(SHOTS, 'demo-03-syllabus.png') });

  // 5) 分析子页（示例分析只读展示；运行按钮禁用）
  await page.click('.book-tab[data-pane="study"]'); await wait(500);
  check('分析子页可见', await vis('#pane-study'));
  check('「运行分析」按钮被禁用(pointer-events:none)', (await pe('#study-run')) === 'none', 'pe=' + (await pe('#study-run')));
  // 直接验证 demo 模式 API 回内置分析
  const demoState = await page.evaluate(async () => {
    const books = await window.API.books.list();
    if (!books.length) return null;
    const st = await window.API.study.state(books[0].id);
    return st && st.analysis ? { pts: (st.analysis.points || []).length, qs: (st.analysis.questions || []).length } : null;
  });
  check('demo API 回内置分析(知识点+题目)', demoState && demoState.pts >= 1 && demoState.qs >= 1, JSON.stringify(demoState));

  // 6) 设置页：写入类按钮禁用 + 视觉开关默认关闭
  await page.click('#nav-settings'); await wait(400);
  check('设置页可见', await page.evaluate(() => !document.getElementById('settings').classList.contains('hidden')));
  check('「保存设置」按钮被禁用(pointer-events:none)', (await pe('#set-save')) === 'none', 'pe=' + (await pe('#set-save')));
  const visionChk = await page.evaluate(() => { const c = document.getElementById('set-vision-enable'); return c ? c.checked : null; });
  check('「图片裁剪增强」默认关闭(off)', visionChk === false, 'checked=' + visionChk);
  await page.screenshot({ path: path.join(SHOTS, 'demo-04-settings.png') });

  // 7) 零外链 / 零报错硬约束
  check('全程零外部域名请求', externalRequests.length === 0, externalRequests.slice(0, 3).join(' | '));
  check('顶层 CSP 存在且 connect-src 限同源', await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return !!m && /connect-src 'self'/.test(m.content);
  }));
  check('全程零未捕获 JS 报错', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  server.close();
  console.log('\nE2E-DEMO 结果： ' + pass + ' 通过 / ' + fail + ' 失败' + (fails.length ? '  (' + fails.join(', ') + ')' : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E-DEMO 崩溃：', e); server.close(); process.exit(1); });
