'use strict';
// 真实资料验收：真浏览器打开本地服务，确认两本真书可见、分层正确、资料能读回且非空。
// 只读，不产生新数据；与 e2e.js 的临时目录隔离（这里读项目内 library/）。
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5211;
const BASE = 'http://localhost:' + PORT;
const SHOTS = path.join(__dirname, 'shots');
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const check = (n, c, extra) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' [' + extra + ']' : ''))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) })
  });
  let ready = false;
  for (let i = 0; i < 40; i++) { try { await get(BASE + '/api/books'); ready = true; break; } catch (e) { await wait(150); } }
  if (!ready) { console.error('server 未启动'); process.exit(1); }
  if (!EDGE) { console.error('未找到 Edge'); process.exit(1); }

  const browser = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  console.log('真实资料验收：');
  await page.goto(BASE + '/index.html', { waitUntil: 'load' }); await wait(500);
  const titles = await page.evaluate(() => Array.from(document.querySelectorAll('.cover-title')).map(e => e.textContent));
  check('书架出现《工程材料》', titles.includes('工程材料'), JSON.stringify(titles));
  check('书架出现《概率统计》', titles.includes('概率统计'), JSON.stringify(titles));
  await page.screenshot({ path: path.join(SHOTS, '11-real-shelf.png') });

  // 打开工程材料：三层结构 + 资料卡
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.book-card')).find(e => e.querySelector('.cover-title') && e.querySelector('.cover-title').textContent === '工程材料'); c.click(); });
  await wait(400);
  check('工程材料 6 张资料卡', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 6));
  check('层面板含 L1/L2/L3', await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('.layer-name')).map(e => e.textContent).join('|');
    return t.includes('第 1 层') && t.includes('第 2 层') && t.includes('第 3 层');
  }));
  check('命中计数显示「共 6」', await page.evaluate(() => document.getElementById('mat-count').textContent.includes('共 6')));
  await page.screenshot({ path: path.join(SHOTS, '12-real-book.png') });

  // 组合检索在真实资料上生效：类型=文本/Markdown 应只留 md 类
  await page.selectOption('#f-ext', 'text'); await wait(250);
  const textCount = await page.evaluate(() => document.querySelectorAll('.mat-card').length);
  check('真实资料上类型筛选生效（>0 且 <6）', textCount > 0 && textCount < 6, String(textCount));
  await page.click('#f-clear'); await wait(200);

  // 真点一份 docx/md 预览，验证内容可读回
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mat-card')).find(e => e.querySelector('.mat-name').textContent.includes('考纲.md')); c.querySelector('[data-act="view"]').click(); });
  await wait(500);
  const srcdoc = await page.evaluate(() => { const f = document.querySelector('#preview-body iframe'); return f ? f.srcdoc || '' : ''; });
  check('考纲.md 预览含真实标题「工程材料 · 期末考纲」', srcdoc.includes('期末考纲'), srcdoc.slice(0, 100));
  await page.screenshot({ path: path.join(SHOTS, '13-real-preview.png') });
  await page.click('#preview-close'); await wait(150);

  check('全程零未捕获 JS 报错', errs.length === 0, errs.join(' | '));
  await browser.close(); srv.kill();
  console.log('\n真实资料验收： ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收崩溃：', e); process.exit(1); });
