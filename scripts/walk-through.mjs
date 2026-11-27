// maxloop 体验满分 · 全路径走查（2026-11-23）
// 真浏览器（Edge headless）从书架走到到期页，逐页截图落盘 + console/pageerror 自动收集。
// 产出：PROCESS/maxloop-体验满分/walk/*.png + walk-result.json（页面清单 + console 记录）。
// 用法：node scripts/walk-through.mjs [--out <dir>]
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = require(ROOT + '/node_modules/playwright-core');

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = path.join(ROOT, 'PROCESS', 'maxloop-体验满分', 'walk');
fs.mkdirSync(OUT, { recursive: true });
const BOOK = '87763d2d14a660d0';
const BASE = 'http://127.0.0.1:5178/workbench/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push({ type: m.type(), text: String(m.text()).slice(0, 300) }); });
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e && e.message).slice(0, 300) }));

  const shot = async (n, waitMs = 600) => { await sleep(waitMs); await page.screenshot({ path: path.join(OUT, n + '.png') }); logs.push({ type: 'shot', text: n }); };
  const click = (sel, timeout = 8000) => page.waitForSelector(sel, { timeout }).then(el => el.click());
  const byText = (txt, sel = 'button') => page.evaluate(([t, s]) => {
    const el = [...document.querySelectorAll(s)].find(b => b.offsetParent && b.textContent.trim().includes(t));
    if (el) { el.click(); return true; } return false;
  }, [txt, sel]);

  // 1 书架
  await page.goto(BASE + '#/home', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('理论力学'), { timeout: 20000 });
  await shot('01-home-shelf', 900);
  // 2 进书（导图）
  await page.goto(BASE + '#/book?id=' + BOOK, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('24 份资料'), { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.mm-viewport svg'), { timeout: 20000 }).catch(() => {});
  await shot('02-book-map', 2600);
  // 3 点节点 → 讲解面板
  await page.evaluate(() => { const n = [...document.querySelectorAll('.mm-viewport g, .mm-viewport [class*=node]')].find(e => (e.textContent || '').includes('公理1：二力平衡公理')); n && n.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await byText('一次看完').catch(() => {});
  await shot('03-lesson-panel', 900);
  // 4 题型
  await byText('题型', 'button.bs-tab');
  await page.evaluate(() => { const g = [...document.querySelectorAll('[class*=bs-type]')].find(e => e.offsetParent && e.textContent.includes('选择题')); g && g.click(); });
  await shot('04-types', 900);
  // 5-6 练习页 + 作答
  await byText('去练习');
  await page.waitForFunction(() => document.body.innerText.includes('第 1 题'), { timeout: 15000 }).catch(() => {});
  await shot('05-quiz', 900);
  await page.evaluate(() => { const o = [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.includes('BD杆不是二力杆')); o && o.click(); });
  await page.evaluate(() => { const a = [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === '作答'); a && a.click(); });
  await shot('06-quiz-answered', 900);
  // 7 考点大全
  await page.goto(BASE + '#/book?id=' + BOOK, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('24 份资料'), { timeout: 20000 });
  await byText('考点大全', 'button.bs-tab');
  await shot('07-digest', 1200);
  // 8 考纲
  await byText('考纲', 'button.bs-tab');
  await shot('08-syllabus', 1200);
  // 9 幻灯片
  await byText('幻灯片', 'button.bs-tab');
  await shot('09-slides', 1200);
  // 10 概览
  await byText('概览', 'button.bs-tab');
  await shot('10-overview', 1200);
  // 11 阅读器
  await page.evaluate(() => { const e = [...document.querySelectorAll('*')].filter(x => x.offsetParent && x.children.length === 0 && x.textContent.trim() === '02_2026-08-31_1静力学公理.pdf')[0]; e && e.click(); });
  await shot('11-reader', 1200);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '×'); b && b.click(); });
  // 12 到期页
  await page.goto(BASE + '#/due?id=' + BOOK, { waitUntil: 'domcontentloaded' });
  await shot('12-due', 1200);
  // 13 幻灯片（书馆旧版 portal 兼容页不查，只查 workbench）
  // 14 提纲讲解
  await page.goto(BASE + '#/book?id=' + BOOK, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('24 份资料'), { timeout: 20000 });
  await byText('提纲讲解', 'button.bs-tab');
  await shot('13-outline', 1200);

  await browser.close();
  const shots = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  const result = { at: new Date().toISOString(), viewport: '1440x900', shots, consoleCount: logs.filter(l => l.type !== 'shot').length, logs };
  fs.writeFileSync(path.join(OUT, 'walk-result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('[walk] 页面 ' + shots.length + ' 张；console error/warning ' + logs.filter(l => l.type !== 'shot').length + ' 条');
  logs.filter(l => l.type !== 'shot').slice(0, 12).forEach(l => console.log('  [' + l.type + '] ' + l.text));
})().catch((e) => { console.error('[walk] 失败：' + (e && e.message)); process.exit(1); });
