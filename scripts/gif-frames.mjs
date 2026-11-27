// 三条新功能 GIF 关键帧截图（2026-11-23 收尾任务 5）。
// 复用书馆真机验收同款链路：playwright-core + 本机 Edge（headless），逐帧落 PNG，
// 再用 ffmpeg palettegen/paletteuse 拼 GIF（帧为离散关键态，GIF 帧间停 1s 左右）。
// 用法：node scripts/gif-frames.mjs
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = require(ROOT + '/node_modules/playwright-core');

const OUT = path.join(ROOT, 'PROCESS', '体验升级-2026-11-23', 'gif-frames');
fs.mkdirSync(OUT, { recursive: true });
const BOOK = '87763d2d14a660d0';
const BASE = 'http://127.0.0.1:5178/workbench/#/book?id=' + BOOK;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // 等书与导图渲染完
  await page.waitForFunction(() => document.querySelector('.mm-viewport svg') || document.body.innerText.includes('渲染导图'), { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.body.innerText.includes('理论力学'), { timeout: 20000 });
  await sleep(2500); // 节点淡入动画走完

  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });

  // ---- GIF1：导图缩放（＋×2 → ＋×2 → 适应）----
  await shot('map-1-initial');
  const zoomIn = () => page.evaluate(() => { const b = [...document.querySelectorAll('button.mm-zoom')].find(x => x.textContent.trim() === '＋'); b && b.click(); });
  await zoomIn(); await sleep(350); await zoomIn(); await sleep(700);
  await shot('map-2-zoomed-2x');
  await zoomIn(); await sleep(350); await zoomIn(); await sleep(700);
  await shot('map-3-zoomed-4x');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '适应'); b && b.click(); });
  await sleep(900);
  await shot('map-4-fit');

  // ---- GIF2：思路点拨（题型页 → 展开选择题 → 看思路）----
  const tabs = await page.$$('button.bs-tab');
  let typeTab = null;
  for (const t of tabs) { if ((await t.textContent()).trim() === '题型') { typeTab = t; break; } }
  await typeTab.click();
  await sleep(900);
  await shot('hint-1-typepage');
  const grp = await page.evaluateHandle(() => [...document.querySelectorAll('[class*=bs-type]')].find(e => e.offsetParent && e.textContent.includes('选择题')));
  await grp.click().catch(() => {});
  await sleep(700);
  await shot('hint-2-group-open');
  const hintBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.includes('看思路')));
  await hintBtn.click().catch(() => {});
  await sleep(700);
  await shot('hint-3-hintbox');

  // ---- GIF3：阅读器（资料名 → 原字节浮层）----
  const fname = await page.evaluateHandle(() => [...document.querySelectorAll('*')].filter(e => e.offsetParent && e.children.length === 0 && e.textContent.trim() === '01_2026-08-31_0绪论.pdf')[0]);
  await fname.click().catch(() => {});
  await sleep(1200);
  await shot('reader-1-overlay');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '×'); b && b.click(); });

  await browser.close();
  console.log('[gif-frames] 完成：' + fs.readdirSync(OUT).filter(f => f.endsWith('.png')).join(', '));
})().catch((e) => { console.error('[gif-frames] 失败：' + (e && e.message)); process.exit(1); });
