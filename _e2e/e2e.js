'use strict';
// 真浏览器端到端：用本机 Edge 驱动，真实点击收录/加资料/分层/预览/删除/搜索，捕获未捕获 JS 报错。
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 5199;
const BASE = 'http://localhost:' + PORT;
function findEdge() {
  const cands = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const c of cands) { if (fs.existsSync(c)) return c; }
  return null;
}
const EDGE = findEdge();
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-e2e-'));
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const F_DOCX = path.join(__dirname, 'fixture-讲义.docx');
const F_XLSX = path.join(__dirname, 'fixture-清单.xlsx');

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function get(url) { return new Promise((res, rej) => { http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }); }

// 构造 method=0(stored) 最小 ZIP（媒体抽取测试用，不校验 CRC）。
function makeZip(entries) {
  const parts = [];
  entries.forEach(e => {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const hdr = Buffer.alloc(30);
    hdr.writeUInt32LE(0x04034b50, 0); hdr.writeUInt16LE(20, 4);
    hdr.writeUInt16LE(0, 6); hdr.writeUInt16LE(0, 8);
    hdr.writeUInt16LE(0, 10); hdr.writeUInt16LE(0, 12);
    hdr.writeUInt32LE(0, 14); hdr.writeUInt32LE(data.length, 18); hdr.writeUInt32LE(data.length, 22);
    hdr.writeUInt16LE(name.length, 26); hdr.writeUInt16LE(0, 28);
    parts.push(hdr, name, data);
  });
  return Buffer.concat(parts);
}
// 构造一份合法可渲染的单页 PDF（带文字），供 PDF 抽取 e2e 使用。
function makeValidPdf(text) {
  const objs = {};
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const stream = 'BT /F1 14 Tf 20 250 Td (' + text + ') Tj ET';
  objs[5] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
  let pdf = '%PDF-1.4\n'; const off = {};
  for (let i = 1; i <= 5; i++) { off[i] = Buffer.byteLength(pdf, 'latin1'); pdf += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) pdf += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(pdf, 'latin1');
}
async function getBookId(title) { const j = JSON.parse(await get(BASE + '/api/books')); const b = (j || []).find(x => x.title === title); return b && b.id; }
async function getMaterial(bookId, nameInc) { const b = JSON.parse(await get(BASE + '/api/books/' + bookId)); return (b.materials || []).find(x => x.name.includes(nameInc)); }

(async () => {
  // 准备临时资料文件
  const fTxt = path.join(ROOT, '作业1.txt'); fs.writeFileSync(fTxt, '作业内容');
  const fPdf = path.join(ROOT, '总复习.pdf'); fs.writeFileSync(fPdf, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const fPng = path.join(ROOT, '图1.png');
  fs.writeFileSync(fPng, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC', 'base64'));

  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), LIBRARY_ROOT: ROOT, NO_OPEN: '1' }) });
  srv.stderr.on('data', d => process.env.DEBUG && console.error('SRV', d.toString()));

  // 等 server 起来
  let ready = false;
  for (let i = 0; i < 40; i++) { try { await get(BASE + '/api/books'); ready = true; break; } catch (e) { await wait(150); } }
  if (!ready) { console.error('server 未启动'); process.exit(1); }

  if (!EDGE) { console.error('未找到 Edge 浏览器'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
  const pageErrors = [];
  const externalRequests = [];
  page.on('request', r => {
    const u = r.url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(u)) return;
    if (/^(data|blob|about|chrome-extension|file):/i.test(u)) return;
    externalRequests.push(u);
  });
  page.on('pageerror', e => { pageErrors.push(String(e)); console.log('PAGEERROR:', String(e)); });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|favicon/i.test(t)) return; // 忽略 favicon 等静态 404 噪声
    pageErrors.push('console:' + t); console.log('CONSOLE-ERR:', t);
  });

  // 注意：模态是 position:fixed，offsetParent 恒为 null，必须用 computed style 判可见
  const vis = (sel) => page.evaluate(s => {
    const el = document.querySelector(s); if (!el) return false;
    if (el.closest('.hidden')) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }, sel);
  const txt = (sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent : ''; }, sel);

  console.log('E2E：');
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await wait(400);

  // 1) 书架首屏
  check('书架首屏可见', await vis('#shelf'));
  check('收录入口(＋收录一本书)存在', await page.evaluate(() => !!document.querySelector('.add-card')));

  // 2) 收录一本书
  await page.click('.add-card'); await wait(200);
  check('收录 modal 打开', await vis('#create-modal'));
  await page.fill('#c-title', '材料科学基础');
  await page.fill('#c-exam', '2026 秋季期末');
  await page.fill('#c-subject', '材料科学与工程');
  await page.click('#c-ok'); await wait(400);
  const covers = await page.evaluate(() => Array.from(document.querySelectorAll('.cover-title')).map(e => e.textContent));
  check('书架出现新书封面', covers.includes('材料科学基础'), JSON.stringify(covers));
  await page.screenshot({ path: path.join(SHOTS, '01-shelf.png') });

  // 3) 打开书
  await page.click('.book-card:not(.add-card)'); await wait(400);
  check('书内视图可见', await vis('#book'));
  check('书架已隐藏', !(await vis('#shelf')));
  check('层面板有「全部资料」', await page.evaluate(() => Array.from(document.querySelectorAll('.layer-name')).some(e => e.textContent.includes('全部资料'))));
  check('空状态提示存在', await page.evaluate(() => !!document.querySelector('.empty')));
  await page.screenshot({ path: path.join(SHOTS, '02-book-empty.png') });

  // 4) 加资料：txt → 层2
  await page.click('#add-mat'); await wait(200);
  check('添加资料 modal 打开', await vis('#add-modal'));
  await page.setInputFiles('#add-files', fTxt);
  await page.fill('#add-layer', '2');
  await page.click('#add-ok'); await wait(400);
  check('资料网格出现 1 张卡片', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 1));
  check('卡片名为 作业1.txt', await page.evaluate(() => { const n = document.querySelector('.mat-name'); return n && n.textContent.includes('作业1.txt'); }));

  // 5) 加 png → 层1， pdf → 层1
  await page.click('#add-mat'); await wait(150);
  await page.setInputFiles('#add-files', fPng); await page.fill('#add-layer', '1'); await page.click('#add-ok'); await wait(350);
  await page.click('#add-mat'); await wait(150);
  await page.setInputFiles('#add-files', fPdf); await page.fill('#add-layer', '1'); await page.click('#add-ok'); await wait(350);
  check('共 3 张资料卡片', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 3));
  await page.screenshot({ path: path.join(SHOTS, '03-book-materials.png') });

  // 6) 分层筛选：点「第 1 层」
  await page.evaluate(() => { const it = Array.from(document.querySelectorAll('.layer-item')).find(e => e.querySelector('.layer-name').textContent.includes('第 1 层')); it.click(); });
  await wait(250);
  check('第1层筛选后显示 2 张(png+pdf)', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 2));
  // 回到全部
  await page.evaluate(() => { const it = Array.from(document.querySelectorAll('.layer-item')).find(e => e.querySelector('.layer-name').textContent.includes('全部资料')); it.click(); });
  await wait(200);

  // 7) 预览 png
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mat-card')).find(e => e.querySelector('.mat-name').textContent.includes('图1.png')); c.querySelector('[data-act="view"]').click(); });
  await wait(250);
  check('预览 modal 打开且显示图片', await vis('#preview-modal') && await page.evaluate(() => !!document.querySelector('.prev-img')));
  await page.screenshot({ path: path.join(SHOTS, '04-preview-png.png') });
  await page.click('#preview-close'); await wait(150);

  // 8) 预览 pdf（iframe）
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mat-card')).find(e => e.querySelector('.mat-name').textContent.includes('总复习.pdf')); c.querySelector('[data-act="view"]').click(); });
  await wait(250);
  check('预览 pdf 显示 iframe', await page.evaluate(() => !!document.querySelector('.prev-iframe')));
  await page.click('#preview-close'); await wait(150);

  // 9) 搜索
  await page.fill('#mat-search', '作业'); await wait(250);
  check('搜索「作业」筛出 1 张', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 1));
  await page.fill('#mat-search', ''); await wait(200);

  // 10) 删除 png（进回收站）
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mat-card')).find(e => e.querySelector('.mat-name').textContent.includes('图1.png')); c.querySelector('[data-act="del"]').click(); });
  await wait(200);
  check('删除确认 modal 出现', await vis('#confirm-modal'));
  await page.click('#confirm-ok'); await wait(350);
  check('删除后剩 2 张', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 2));
  check('删除文件进回收站', fs.readdirSync(path.join(ROOT, '.trash')).some(f => f.startsWith('m_')));

  // 11) 返回书架，数量更新
  await page.click('#back-shelf'); await wait(300);
  check('返回书架', await vis('#shelf'));
  const cnt = await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.book-card')).find(e => e.querySelector('.cover-title') && e.querySelector('.cover-title').textContent.includes('材料科学基础')); const m = c && c.querySelector('.card-meta'); return m ? m.textContent : ''; });
  check('书卡片显示资料 2', /资料 2/.test(cnt), cnt);

  // 12) 回收站闭环：进书→删资料→回书架→开回收站→恢复→回书内确认资料回来
  await page.click('.book-card:not(.add-card)'); await wait(300);
  check('重新进入书内', await vis('#book'));
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mat-card')).find(e => e.querySelector('.mat-name').textContent.includes('作业1.txt')); c.querySelector('[data-act="del"]').click(); });
  await wait(200);
  await page.click('#confirm-ok'); await wait(300);
  await page.click('#back-shelf'); await wait(300);   // 回收站在书架层，先回书架
  await page.click('#open-trash'); await wait(300);
  check('回收站 modal 打开', await vis('#trash-modal'));
  check('回收站含 2 项(图1+作业1)', await page.evaluate(() => document.querySelectorAll('.trash-item').length === 2));
  await page.screenshot({ path: path.join(SHOTS, '05-trash.png') });
  await page.evaluate(() => { const items = Array.from(document.querySelectorAll('.trash-item')); const t = items.find(it => it.querySelector('.trash-name').textContent.includes('作业1.txt')); t.querySelector('[data-act="restore"]').click(); });
  await wait(400);
  check('恢复后回收站剩 1 项', await page.evaluate(() => document.querySelectorAll('.trash-item').length === 1));
  await page.click('#trash-close'); await wait(200);
  await page.click('.book-card:not(.add-card)'); await wait(300);  // 恢复后重新进书确认
  check('回收站恢复后书内资料回到 2 张', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 2));

  // 13) 删书→回收站→恢复书 闭环（UI 全链路）
  await page.click('#book-del'); await wait(200);
  check('删除本书确认 modal 出现', await vis('#confirm-modal'));
  await page.click('#confirm-ok'); await wait(400);
  check('删书后回书架', await vis('#shelf'));
  check('书架暂不再有该书封面', !(await page.evaluate(() => Array.from(document.querySelectorAll('.cover-title')).some(e => e.textContent.includes('材料科学基础')))));
  await page.click('#open-trash'); await wait(300);
  check('回收站含被删的书', await page.evaluate(() => Array.from(document.querySelectorAll('.trash-item .trash-type')).some(e => e.textContent.includes('书'))));
  await page.evaluate(() => { document.querySelector('.trash-item [data-act="restore"]').click(); });
  await wait(400);
  check('恢复书后书架重现封面', await page.evaluate(() => Array.from(document.querySelectorAll('.cover-title')).some(e => e.textContent.includes('材料科学基础'))));
  await page.click('#trash-close'); await wait(150);

  // 14) 选项2：Office 内嵌预览（真实 docx/xlsx，真点预览按钮）
  await page.click('.book-card:not(.add-card)'); await wait(300);
  await page.click('#add-mat'); await wait(150);
  await page.setInputFiles('#add-files', F_DOCX); await page.fill('#add-layer', '1'); await page.click('#add-ok'); await wait(400);
  await page.click('#add-mat'); await wait(150);
  await page.setInputFiles('#add-files', F_XLSX); await page.fill('#add-layer', '2'); await page.click('#add-ok'); await wait(400);
  check('加 docx+xlsx 后共 4 张卡片', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 4));

  // === M0：图片与 asset 一等公民（PPTX 内嵌媒体 + PDF 逐页图/文字）===
  const fPptx = path.join(ROOT, '课件.pptx');
  fs.writeFileSync(fPptx, makeZip([
    { name: 'ppt/media/image1.png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') },
    { name: 'ppt/slides/slide1.xml', data: '<p:sld xmlns:a="x"><a:t>均值</a:t></p:sld>' },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: '<Relationships xmlns="x"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>' }
  ]));
  const fPdfValid = path.join(ROOT, '真实课件.pdf');
  fs.writeFileSync(fPdfValid, makeValidPdf('Normal Distribution mean variance 123'));
  await page.click('#add-mat'); await wait(150);
  await page.setInputFiles('#add-files', fPptx); await page.fill('#add-layer', '1'); await page.click('#add-ok'); await wait(500);
  await page.click('#add-mat'); await wait(150);
  await page.setInputFiles('#add-files', fPdfValid); await page.fill('#add-layer', '1'); await page.click('#add-ok'); await wait(1800);
  const bid = await getBookId('材料科学基础');
  const pptxM = await getMaterial(bid, '课件.pptx');
  const pdfM = await getMaterial(bid, '真实课件.pdf');
  check('PPTX 入库后带 assets（内嵌媒体抽出）', !!(pptxM && pptxM.assets && pptxM.assets.length >= 1), pptxM && pptxM.assets && pptxM.assets.length);
  check('PDF 入库后带 extractedText（文字被抽取）', !!(pdfM && (pdfM.extractedText || '').trim().length > 0), pdfM && (pdfM.extractedText || '').slice(0, 40));
  check('PDF 入库后带 assets（逐页图渲染）', !!(pdfM && pdfM.assets && pdfM.assets.length >= 1), pdfM && pdfM.assets && pdfM.assets.length);
  if (pptxM && pptxM.assets && pptxM.assets.length) {
    const r = await get(BASE + '/api/books/' + bid + '/materials/' + pptxM.id + '/asset/' + pptxM.assets[0].id);
    check('PPTX asset 端点返回图像字节', r.length > 0, 'len=' + r.length);
  }
  if (pdfM && pdfM.assets && pdfM.assets.length) {
    const r = await get(BASE + '/api/books/' + bid + '/materials/' + pdfM.id + '/asset/' + pdfM.assets[0].id);
    check('PDF asset 端点返回图像字节', r.length > 0, 'len=' + r.length);
  }


  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mat-card')).find(e => e.querySelector('.mat-name').textContent.includes('讲义.docx')); c.querySelector('[data-act="view"]').click(); });
  await wait(700);
  const docxFrame = await page.evaluate(() => {
    const f = document.querySelector('#preview-body iframe');
    return f ? { sandbox: f.getAttribute('sandbox'), srcdoc: f.srcdoc || '', hasScript: /<script/i.test(f.srcdoc || '') } : null;
  });
  check('docx 预览生成 srcdoc iframe', !!docxFrame && docxFrame.srcdoc.length > 0);
  check('docx 预览含原文「相图基础」', !!docxFrame && docxFrame.srcdoc.includes('相图基础'), docxFrame ? docxFrame.srcdoc.slice(0, 120) : 'null');
  check('docx 预览 iframe 有 sandbox=""', !!docxFrame && docxFrame.sandbox === '');
  check('docx 预览 HTML 已清洗无 script', !!docxFrame && !docxFrame.hasScript);
  await page.screenshot({ path: path.join(SHOTS, '06-preview-docx.png') });
  await page.click('#preview-close'); await wait(150);

  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mat-card')).find(e => e.querySelector('.mat-name').textContent.includes('清单.xlsx')); c.querySelector('[data-act="view"]').click(); });
  await wait(600);
  const xlsxFrame = await page.evaluate(() => { const f = document.querySelector('#preview-body iframe'); return f ? f.srcdoc || '' : ''; });
  check('xlsx 预览显示工作表名「复习清单」', xlsxFrame.includes('复习清单'));
  check('xlsx 预览显示单元格「相图与结晶」', xlsxFrame.includes('相图与结晶'));
  await page.screenshot({ path: path.join(SHOTS, '07-preview-xlsx.png') });
  await page.click('#preview-close'); await wait(150);

  // M0 验收核心：PPTX 预览必须真正显示嵌入图（不是纯文字）—— 直接对应「支持看图 / 没真正拿到图片就是完全失败」。
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mat-card')).find(e => e.querySelector('.mat-name').textContent.includes('课件.pptx')); c.querySelector('[data-act="view"]').click(); });
  await wait(800);
  const pptxFrame = await page.evaluate(() => {
    const f = document.querySelector('#preview-body iframe');
    return f ? f.srcdoc || '' : '';
  });
  check('PPTX 预览出现嵌入图(<img>)', pptxFrame.includes('<img'), pptxFrame.slice(0, 160));
  check('PPTX 预览图的 src 同源(data 或 /api/)', pptxFrame.includes('src="/api/') || pptxFrame.includes('src="data:'), pptxFrame.slice(0, 160));
  check('PPTX 预览含幻灯片页码(第 1 页)', pptxFrame.includes('第 1 页'));
  await page.screenshot({ path: path.join(SHOTS, '07b-preview-pptx-img.png') });
  await page.click('#preview-close'); await wait(150);

  // 15) 选项4：真点「生成复习提纲」→ 提示词驱动 → 系统资料落 L1 + 回链
  await page.click('#gen-insight'); await wait(200);
  check('提示词输入 modal 打开', await vis('#prompt-modal'));
  await page.fill('#prompt-input', '重点看相图与结晶');
  await page.click('#prompt-ok'); await wait(700);
  check('生成成功提示条出现', await page.evaluate(() => { const n = document.querySelector('.mat-notice'); return !!n && n.textContent.includes('已生成'); }));
  check('生成后共 7 张卡片(作业1+总复习pdf+讲义docx+清单xlsx+课件pptx+真实课件pdf+提纲)', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 7));
  check('新卡片带「系统/AI」来源标', await page.evaluate(() => Array.from(document.querySelectorAll('.mat-card')).some(c => c.querySelector('.badge.system'))));
  check('新卡片带「来源回链」', await page.evaluate(() => Array.from(document.querySelectorAll('.mat-derived')).length === 1));
  await page.screenshot({ path: path.join(SHOTS, '08-insight-generated.png') });
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mat-card')).find(e => e.querySelector('.mat-name').textContent.includes('系统复习提纲')); c.querySelector('[data-act="view"]').click(); });
  await wait(400);
  const mdFrame = await page.evaluate(() => { const f = document.querySelector('#preview-body iframe'); return f ? f.srcdoc || '' : ''; });
  check('提纲预览含「系统复习提纲」', mdFrame.includes('系统复习提纲'));
  check('提纲预览含「来源回链」', mdFrame.includes('来源回链'));
  check('提纲声明未联网未用模型', mdFrame.includes('未联网') && mdFrame.includes('未使用模型'));
  await page.click('#preview-close'); await wait(150);

  // 15b) 组合检索：四个下拉与关键词、层组合生效（AND），命中计数与清空
  await page.click('#f-clear'); await wait(200);
  check('清空筛选后回到 7 张', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 7));
  check('命中计数显示「命中 7 / 共 7」', await page.evaluate(() => document.getElementById('mat-count').textContent.includes('命中 7 / 共 7')));

  await page.selectOption('#f-source', 'system'); await wait(250);
  check('来源=系统生成 → 只剩 1 张', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 1));
  check('该张带系统标', await page.evaluate(() => !!document.querySelector('.mat-card .badge.system')));

  await page.selectOption('#f-source', 'all');
  await page.selectOption('#f-ext', 'office'); await wait(250);
  check('类型=Word/Excel/PPT → 3 张(docx+xlsx+pptx)', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 3));

  await page.fill('#mat-search', '讲义'); await wait(250);
  check('类型+关键词组合 → 1 张', await page.evaluate(() => document.querySelectorAll('.mat-card').length === 1));
  check('组合命中的是 讲义.docx', await page.evaluate(() => !!document.querySelector('.mat-name') && document.querySelector('.mat-name').textContent.includes('讲义.docx')));

  await page.fill('#mat-search', '不存在的词'); await wait(250);
  check('无命中显示空状态文案', await page.evaluate(() => !!document.querySelector('.empty') && document.querySelector('.empty').textContent.includes('清空筛选')));
  await page.click('#f-clear'); await wait(250);
  check('一键清空后恢复 7 张且搜索框清空', await page.evaluate(() =>
    document.querySelectorAll('.mat-card').length === 7 && document.getElementById('mat-search').value === ''));
  await page.screenshot({ path: path.join(SHOTS, '10-combo-filter.png') });

  // 17) 设置系统：引擎切换 / 密钥不落盘 / 测试连接失败不泄漏密钥（用必然失败的 127.0.0.1:1，不发真实外部请求）
  await page.click('#nav-settings'); await wait(300);
  check('设置页可见', await page.evaluate(() => !document.getElementById('settings').classList.contains('hidden')));
  check('默认本地引擎', await page.evaluate(() => document.querySelector('input[name="set-engine"]:checked').value === 'local'));
  check('云端字段默认隐藏', await page.evaluate(() => document.getElementById('llm-fields').classList.contains('hidden')));
  await page.click('input[name="set-engine"][value="llm"]'); await wait(200);
  check('切云端后 API 字段出现', await page.evaluate(() => !document.getElementById('llm-fields').classList.contains('hidden')));
  await page.fill('#set-base', 'http://127.0.0.1:1/v1');
  await page.fill('#set-model', 'test-model');
  await page.fill('#set-key', 'sk-E2ESECRET987654321');
  await page.click('#set-test'); await wait(900);
  check('测试连接明确失败', await page.evaluate(() => document.getElementById('set-test-result').textContent.includes('失败')));
  check('失败提示不含密钥', await page.evaluate(() => !document.getElementById('set-test-result').textContent.includes('E2ESECRET')));
  check('页面文本不泄漏密钥', await page.evaluate(() => !document.body.innerText.includes('E2ESECRET')));
  await page.screenshot({ path: path.join(SHOTS, '12-settings.png') });
  await page.click('#set-save'); await wait(250);
  check('localStorage 不含密钥', await page.evaluate(() => !JSON.stringify(localStorage).includes('E2ESECRET')));
  check('密钥只在 sessionStorage', await page.evaluate(() => sessionStorage.getItem('rl-api-key') === 'sk-E2ESECRET987654321'));
  await page.click('#set-clear-key'); await wait(200);
  check('一键清空密钥生效', await page.evaluate(() => !sessionStorage.getItem('rl-api-key')));
  await page.click('input[name="set-engine"][value="local"]'); await page.click('#set-save'); await wait(250);
  check('切回本地引擎生效', await page.evaluate(() => document.querySelector('input[name="set-engine"]:checked').value === 'local'));

  // 17b) v0.5：去重阈值可配，且用大白话说清取舍
  check('设置页有去重阈值输入', await page.evaluate(() => !!document.getElementById('set-dedupe')));
  await page.evaluate(() => document.getElementById('set-dedupe').scrollIntoView({ block: 'center' }));
  await wait(250);
  await page.screenshot({ path: path.join(SHOTS, '17-settings-params.png') });
  check('阈值说明写清调高/调低/误删除三者', await page.evaluate(() => {
    const t = document.querySelector('.set-tip'); return !!t && /调高/.test(t.textContent) && /调低/.test(t.textContent) && /误删/.test(t.textContent);
  }));
  await page.fill('#set-dedupe', '0.9'); await page.click('#set-save'); await wait(250);
  check('阈值保存进本地配置', await page.evaluate(() => JSON.parse(localStorage.getItem('rl-settings-v1')).dedupeThreshold === 0.9));
  check('前端读到的阈值与保存值一致', await page.evaluate(() => window.Settings.load().dedupeThreshold === 0.9));
  await page.fill('#set-dedupe', '0.82'); await page.click('#set-save'); await wait(200);

  // 18a) 服务商预设 + 视觉能力标注（纯前端，零外链）
  // 注意：API 字段在 llm-fields 里，engine=local 时整块隐藏 → 必须先切 llm 才能操作；测完切回 local 还原状态。
  await page.click('input[name="set-engine"][value="llm"]'); await wait(250);
  await page.selectOption('#set-provider', 'siliconflow'); await wait(200);
  check('预设=硅基流动 自动填 API 地址(/v1)', await page.evaluate(() => document.getElementById('set-base').value === 'https://api.siliconflow.cn/v1'));
  check('预设=硅基流动 自动填默认模型', await page.evaluate(() => document.getElementById('set-model').value === 'deepseek-ai/DeepSeek-V4.1-Flash'));
  check('视觉标记=支持看图(硅基流动默认模型)', await page.evaluate(() => document.getElementById('set-vision-flag').classList.contains('ok')));
  check('切换预设显示对应能力说明', await page.evaluate(() => { const n = document.getElementById('set-provider-note'); return !!n && n.textContent.includes('硅基流动'); }));
  await page.fill('#set-model', 'deepseek-v4-pro'); await wait(150);
  check('视觉标记=纯文本模型显示降级警告', await page.evaluate(() => document.getElementById('set-vision-flag').classList.contains('warn')));
  await page.selectOption('#set-provider', 'deepseek'); await wait(200);
  check('预设=DeepSeek 官方 地址不带 /v1', await page.evaluate(() => document.getElementById('set-base').value === 'https://api.deepseek.com'));
  check('预设=DeepSeek 自动填原生视觉模型', await page.evaluate(() => document.getElementById('set-model').value === 'deepseek-flash'));
  check('DeepSeek deepseek-flash 标为支持看图(原生视觉)', await page.evaluate(() => document.getElementById('set-vision-flag').classList.contains('ok')));
  await page.click('input[name="set-engine"][value="local"]'); await wait(250);
  check('切回本地引擎后云端字段隐藏', await page.evaluate(() => document.getElementById('llm-fields').classList.contains('hidden')));

  // 18) 分析工作台：材料边界 → 分析 → 双色来源标注 → 审阅保存
  await page.click('#nav-shelf'); await wait(250);
  await page.click('.book-card:not(.add-card)'); await wait(350);
  await page.click('.book-tab[data-pane="study"]'); await wait(450);
  check('分析子页可见', await page.evaluate(() => !document.getElementById('pane-study').classList.contains('hidden')));
  check('材料边界列出可勾选资料', await page.evaluate(() => document.querySelectorAll('#bd-list .bd-row').length >= 3));
  check('边界状态显示纳入/排除数', await page.evaluate(() => /纳入 \d+ 份 · 排除 \d+ 份/.test(document.getElementById('study-run-status').textContent)));
  await page.evaluate(() => { const cs = document.querySelectorAll('#bd-list input[type=checkbox]'); if (cs.length > 1) cs[cs.length - 1].click(); });
  await wait(200);
  check('取消勾选后排除数变成 1', await page.evaluate(() => /排除 1 份/.test(document.getElementById('study-run-status').textContent)));
  await page.fill('#study-prompt', '重点看相图与结晶');
  await page.click('#study-run'); await wait(1400);
  check('本地分析完成', await page.evaluate(() => document.getElementById('study-status').textContent.includes('分析完成')));
  check('结果出现知识点卡片', await page.evaluate(() => document.querySelectorAll('.point-card').length >= 2));
  check('来源依据与 AI补充 双色标注都在', await page.evaluate(() => document.querySelectorAll('.tag-source').length > 0 && document.querySelectorAll('.tag-ai').length > 0));
  check('结果页列出明确排除的资料', await page.evaluate(() => !!document.querySelector('.res-excluded')));
  check('结果预览显示题目卡与答案', await page.evaluate(() => document.querySelectorAll('#study-result .q-item').length >= 2 && Array.from(document.querySelectorAll('#study-result .q-answer')).some(e => e.innerText.trim().length > 0)));

  // 18b) v0.5 生成质量报告：去重 / 校验 / 重试全过程对用户可见
  check('生成质量报告卡出现', await page.evaluate(() => !!document.querySelector('.quality-card')));
  check('质量报告显示去重阈值与题数变化', await page.evaluate(() => {
    const t = document.querySelector('.quality-card').innerText; return /阈值 0\.82/.test(t) && /→/.test(t);
  }));
  check('质量报告显示本地校验与检查项数', await page.evaluate(() => /本地校验/.test(document.querySelector('.quality-card').innerText) && /检查 \d+ 项/.test(document.querySelector('.quality-card').innerText)));
  check('质量报告显示离线零重试', await page.evaluate(() => /离线零重试/.test(document.querySelector('.quality-card').innerText)));
  check('质量报告显示真实校验得分（不是占位符）', await page.evaluate(() => /得分 [01](?:\.\d+)?/.test(document.querySelector('.quality-card').innerText)));
  check('质量报告带可展开的校验轨迹', await page.evaluate(() => document.querySelectorAll('.quality-details summary').length >= 1));
  check('本地结果标记为校验通过、未降级', await page.evaluate(() => !!document.querySelector('.quality-badge.ok') && !document.querySelector('.quality-card.degraded')));
  check('质量卡没把答案漏出来', await page.evaluate(() => !document.querySelector('.quality-card').innerText.includes('标准答案')));
  await page.screenshot({ path: path.join(SHOTS, '16-quality-report.png') });
  await page.screenshot({ path: path.join(SHOTS, '13-analysis-result.png') });

  // 18c) M2：题目含答案+解题方法策略 / 待补充题型 / 知识点按类别图谱 / 遮蔽模式
  check('M2：题目卡默认显示答案', await page.evaluate(() => Array.from(document.querySelectorAll('.q-item .q-answer')).some(e => e.innerText.trim().length > 0)));
  check('M2：题目卡含解题方法策略', await page.evaluate(() => Array.from(document.querySelectorAll('.q-method')).some(e => e.innerText.includes('解题方法策略'))));
  check('M2：重要知识点缺应用型题时出现待补充卡', await page.evaluate(() => Array.from(document.querySelectorAll('.q-item.q-gap')).some(e => e.innerText.includes('待补充题型'))));
  check('M2：出现知识点图谱（按类别聚合）', await page.evaluate(() => !!document.getElementById('cat-map') && document.querySelectorAll('#cat-map .cat-node').length >= 1));
  check('M2：遮蔽开关存在', await page.evaluate(() => !!document.getElementById('study-mask')));
  await page.click('#study-mask'); await wait(150);
  check('M2：开启遮蔽后结果区带 masked', await page.evaluate(() => document.getElementById('study-result').classList.contains('masked')));
  check('M2：遮蔽模式下答案被隐藏', await page.evaluate(() => {
    const a = document.querySelector('.q-item:not(.q-gap) .q-answer'); if (!a) return false;
    return getComputedStyle(a).display === 'none';
  }));
  await page.evaluate(() => { const b = document.querySelector('.q-item:not(.q-gap) .q-peek'); if (b) b.click(); });
  await wait(120);
  check('M2：点「看答案」后该卡答案可见', await page.evaluate(() => {
    const card = document.querySelector('.q-item.revealed'); if (!card) return false;
    const a = card.querySelector('.q-answer'); return a && getComputedStyle(a).display !== 'none';
  }));
  await page.click('#study-mask'); await wait(120);
  check('M2：再点遮蔽开关恢复显示答案', await page.evaluate(() => !document.getElementById('study-result').classList.contains('masked')));
  check('BC：解题方法策略渲染为 Col 三栏（动机/操作/结果）', await page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('.q-method-col'));
    if (!cols.length) return false;
    const txt = cols.map(c => c.innerText).join(' ');
    return /动机/.test(txt) && /操作/.test(txt) && /结果/.test(txt);
  }));
  check('BC：计算/应用类题含验算提示区(verify)', await page.evaluate(() => !!document.querySelector('.q-method-verify')));

  // 18c) 降级披露（Graceful Degradation）：结果含义变了必须让用户看见，且不能误报。
  const degradeUI = await page.evaluate(() => {
    const orig = window.StudyUI.analysis;
    const a = JSON.parse(JSON.stringify(orig));
    a.visionDegraded = true;
    window.StudyUI.analysis = a; window.StudyUI.renderResult();
    const shown = !!document.querySelector('#study-result .degrade-banner');
    a.visionDegraded = false;
    window.StudyUI.analysis = a; window.StudyUI.renderResult();
    const hidden = !document.querySelector('#study-result .degrade-banner');
    window.StudyUI.analysis = orig; window.StudyUI.renderResult();
    return { shown, hidden };
  });
  check('降级时结果页显示「本次未读图」披露条', degradeUI.shown);
  check('未降级时不误报披露条', degradeUI.hidden);

  // === M3：多模态视觉闭环（零外链）===
  // 注入一份含 assetRefs 的 mock 分析结果（引用真实 PPTX 内嵌图），验证：
  //   1) 知识点/题目卡渲染出缩略图(.asset-thumb)
  //   2) 异步填图把真实图字节加载进 <img>（对应头号判据「没真正拿到图片就是完全失败」）
  //   3) 完成后还原本地分析结果，不影响后续 study-save / 出卷链路。
  const aid3 = pptxM && pptxM.assets && pptxM.assets[0] && pptxM.assets[0].id;
  check('M3：已拿到真实 PPTX 内嵌图 assetId', !!aid3, aid3 || 'null');
  if (aid3) {
    const m3 = await page.evaluate(async ({ aid, matId }) => {
      const a = JSON.parse(JSON.stringify(window.StudyUI.analysis));
      a.assetIndex = {};
      a.assetIndex[aid] = { matId: matId, name: '课件.pptx', slide: 1, page: null };
      if (a.points[0]) a.points[0].assetRefs = [aid];
      if (a.questions[0]) a.questions[0].assetRefs = [aid];
      const orig = window.StudyUI.analysis;
      window.StudyUI.analysis = a;
      window.StudyUI.renderResult();
      await new Promise(r => setTimeout(r, 800));
      const img = document.querySelector('#study-result img[data-aid="' + aid + '"]');
      const res = {
        thumbs: document.querySelectorAll('#study-result .asset-thumb').length,
        hasImg: !!img,
        src: img ? img.src : '',
        loaded: img ? (img.complete && img.naturalWidth > 0) : false
      };
      // 还原，避免影响后续 study-save / 出卷
      window.StudyUI.analysis = orig;
      window.StudyUI.renderResult();
      return res;
    }, { aid: aid3, matId: pptxM.id });
    check('M3：知识点/题目卡渲染出缩略图(.asset-thumb)', m3.thumbs >= 1, 'thumbs=' + m3.thumbs);
    check('M3：关联图 <img data-aid> 已渲染', m3.hasImg);
    check('M3：关联图异步加载真实字节(src 非空)', !!m3.src && m3.src.length > 0, (m3.src || '').slice(0, 64));
    check('M3：关联图真正加载成功(naturalWidth>0)', m3.loaded);
    await page.screenshot({ path: path.join(SHOTS, '16b-m3-vision-thumb.png') });
  }

  await page.click('#study-save'); await wait(300);
  check('审阅后保存结果', await page.evaluate(() => document.getElementById('study-status').textContent.includes('已保存')));

  // 18d) v0.6：知识点思维导图（真节点+连线，本地 SVG）与挖空自测（主动回忆）
  await page.click('#study-graph'); await wait(600);
  check('v0.6：思维导图渲染出真实 SVG 节点', await page.evaluate(() => document.querySelectorAll('#graph-box svg circle').length >= 2));
  check('v0.6：思维导图有知识点连线（不是纯文本分组）', await page.evaluate(() =>
    document.querySelectorAll('#graph-box svg line[stroke="#3a7afe"], #graph-box svg line[stroke="#cbd5e1"]').length >= 1));
  await page.screenshot({ path: path.join(SHOTS, '22-mindmap.png') });
  await page.click('#study-cloze'); await wait(600);
  check('v0.6：挖空自测生成卡片且答案默认隐藏', await page.evaluate(() =>
    document.querySelectorAll('.cloze-card').length >= 1 && !!document.querySelector('.cloze-answer.hidden')));
  await page.evaluate(() => { const b = document.querySelector('.cloze-reveal'); if (b) b.click(); });
  await wait(120);
  check('v0.6：点「看答案」后揭示原文答案', await page.evaluate(() => {
    const a = document.querySelector('.cloze-answer'); return !!a && !a.classList.contains('hidden') && a.innerText.trim().length > 3;
  }));

  // 19) 练习闭环：试卷不含答案 → 交卷批改 → 只针对薄弱点出巩固卷
  await page.click('#study-exam'); await wait(700);
  check('生成试卷后跳到练习页', await page.evaluate(() => !document.getElementById('pane-exam').classList.contains('hidden')));
  const qCount = await page.evaluate(() => document.querySelectorAll('.paper-q').length);
  check('试卷题目渲染', qCount >= 2, '题数=' + qCount);
  check('交卷前试卷不含答案', await page.evaluate(() => !document.getElementById('exam-paper').innerText.includes('标准答案')));
  check('交卷按钮可见', await page.evaluate(() => !document.getElementById('exam-submit').classList.contains('hidden')));
  await page.screenshot({ path: path.join(SHOTS, '14-exam-paper.png') });
  await page.evaluate(() => {
    document.querySelectorAll('.paper-q').forEach(q => {
      const r = q.querySelector('input[type=radio],input[type=checkbox]');
      const t = q.querySelector('.ans-text');
      if (r) r.click();
      if (t) { t.value = '相图是描述相平衡关系的图形，结晶包括形核与长大'; t.dispatchEvent(new Event('input', { bubbles: true })); }
    });
  });
  await page.click('#exam-submit'); await wait(700);
  check('逐题批改结果出现', await page.evaluate(() => document.querySelectorAll('.grade-item').length >= 2));
  check('v0.6：批改后出现四档掌握度自评区', await page.evaluate(() =>
    !!document.getElementById('rate-box') && document.querySelectorAll('#rate-box .rate-btn').length >= 4));
  await page.evaluate(() => { const b = document.querySelector('#rate-box .rate-btn[data-rate="3"]'); if (b) b.click(); });
  await page.click('#rate-save'); await wait(600);
  check('v0.6：自评保存后明确反馈已重排下次复习', await page.evaluate(() =>
    document.getElementById('rate-status').textContent.includes('下次复习时间已重排')));
  check('交卷后才显示标准答案', await page.evaluate(() => document.getElementById('exam-result').innerText.includes('标准答案')));
  check('判定与错因可见', await page.evaluate(() => document.querySelectorAll('.verdict').length >= 2 && !!document.querySelector('.cause')));
  check('反馈五问出现', await page.evaluate(() => !document.getElementById('exam-feedback').classList.contains('hidden') && document.querySelectorAll('#exam-feedback textarea').length >= 4));
  await page.screenshot({ path: path.join(SHOTS, '15-grading.png') });
  const hasRemedial = await page.evaluate(() => !document.getElementById('exam-remedial').classList.contains('hidden'));
  check('有错题时出现巩固卷按钮', hasRemedial);
  if (hasRemedial) {
    await page.click('#exam-remedial'); await wait(700);
    check('巩固卷是第 2 套且标注只含薄弱点', await page.evaluate(() => {
      const h = document.querySelector('.paper-head'); return !!h && /第 2 套/.test(h.textContent) && /巩固卷/.test(h.textContent);
    }));
    const remCount = await page.evaluate(() => document.querySelectorAll('.paper-q').length);
    check('巩固卷不机械重复整套（题数更少）', remCount < qCount, '原卷=' + qCount + ' 巩固卷=' + remCount);
    check('新巩固卷交卷前仍不显示答案', await page.evaluate(() => !document.getElementById('exam-paper').innerText.includes('标准答案')));
  }

  // 20) M1 薄弱地图：批改后错题本跨会话累积，前端可见
  await page.click('.book-tab[data-pane="weak"]'); await wait(500);
  check('薄弱页可见', await vis('#pane-weak'));
  check('批改后薄弱地图出现薄弱知识点卡片', await page.evaluate(() => document.querySelectorAll('#weak-list .weak-card').length >= 1));
  check('薄弱地图含结果徽章（最近正确/部分/错误）', await page.evaluate(() => !!document.querySelector('#weak-list .weak-badge')));
  check('薄弱地图顶部统计已渲染', await page.evaluate(() => !!document.querySelector('#weak-summary .weak-num')));
  await page.screenshot({ path: path.join(SHOTS, '18-weak-map.png') });

  // 20b) M2 间隔重复 SRS：今日复习卷组卷 → 交卷批改 → 盒子按对错升级/重置，前端可见
  await page.click('.book-tab[data-pane="exam"]'); await wait(400);
  check('练习页含「生成今日复习卷」按钮', await page.evaluate(() => !!document.getElementById('exam-review')));
  await page.click('#exam-review'); await wait(800);
  check('今日复习卷生成且标题标注（区别于第 N 套）', await page.evaluate(() => {
    const h = document.querySelector('.paper-head'); return !!h && /今日复习卷/.test(h.textContent) && !/第 \d+ 套/.test(h.textContent);
  }));
  const revQ = await page.evaluate(() => document.querySelectorAll('.paper-q').length);
  check('今日复习卷含到期薄弱点的题', revQ >= 1, '题数=' + revQ);
  check('复习卷交卷前不显示答案', await page.evaluate(() => !document.getElementById('exam-paper').innerText.includes('标准答案')));
  // 全部尽量答对（单选点 A；多选点前两项；开放题写命中原文的话）→ 盒子应升级
  await page.evaluate(() => {
    document.querySelectorAll('.paper-q').forEach(q => {
      const t = q.querySelector('.ans-text');
      if (t) { t.value = '相图是描述相平衡关系的图形，结晶包括形核与长大'; t.dispatchEvent(new Event('input', { bubbles: true })); return; }
      const opts = q.querySelectorAll('input[type=radio],input[type=checkbox]');
      opts.forEach((o, i) => { if (i < (q.querySelector('input[type=checkbox]') ? 2 : 1)) o.click(); });
    });
  });
  await page.click('#exam-submit'); await wait(800);
  check('复习卷批改结果出现', await page.evaluate(() => document.querySelectorAll('.grade-item').length >= 1));
  await page.click('.book-tab[data-pane="weak"]'); await wait(500);
  check('M2：薄弱地图出现「今日到期」统计', await page.evaluate(() => {
    const t = document.getElementById('weak-summary').innerText;
    return /今日到期/.test(t) && /跟踪知识点/.test(t) && /leech/.test(t);
  }));
  check('M2：薄弱卡片显示复习盒与到期状态', await page.evaluate(() => {
    const c = document.querySelector('#weak-list .weak-card'); if (!c) return false;
    const t = c.innerText; return /盒子 \d/.test(t) && (/今日到期|还有 \d+ 天/).test(t);
  }));
  await page.screenshot({ path: path.join(SHOTS, '19-review-srs.png') });

  // 21) M1 考纲结构化主链路：考纲.md + 题库.json → 考纲视图（忠实呈现）+ 从题库出卷
  await page.click('.book-tab[data-pane="syllabus"]'); await wait(500);
  check('考纲子页可见', await vis('#pane-syllabus'));
  check('无考纲时显示兜底大纲提示', await page.evaluate(() => !!document.querySelector('.syllabus-warn')));
  check('无题库时「从题库出卷」按钮禁用', await page.evaluate(() => document.getElementById('syllabus-exam').disabled === true));
  await page.screenshot({ path: path.join(SHOTS, '20-syllabus-fallback.png') });

  // 切回资料 tab，再上传 考纲.md（层1）
  await page.click('.book-tab[data-pane="materials"]'); await wait(300);
  const fSyl = path.join(ROOT, '考纲.md');
  fs.writeFileSync(fSyl, '---\ntitle: e2e 考纲样本\ntags: [考纲, 知识点, 题型]\nsource: e2e\n---\n\n# 复习资料图书馆 e2e 考纲\n\n# 第一章 基础概念\n\n## 1.1 核心定义（复习 p1）\n\n| 编号 | 知识点 | 对应题型 |\n| --- | --- | --- |\n| 1.1.1 | 材料的定义与分类 | 选择, 名词解释 |\n| 1.1.2 | 晶体与非晶体 | 判断 |\n\n▲ 重点：1.1.1\n\n**自拟题**\n\n- `Z-1-1` 填空：请写出材料按使用性能分类的三大类。\n');
  await page.click('#add-mat'); await wait(150);
  await page.setInputFiles('#add-files', fSyl); await page.fill('#add-layer', '1'); await page.click('#add-ok'); await wait(500);

  // 上传 题库.json（层2）
  const fBank = path.join(ROOT, '题库.json');
  fs.writeFileSync(fBank, JSON.stringify({ meta: { title: 'e2e 题库', count: 4 }, items: [
    { id: 'q1', ch: '第一章', sec: '1.1', kp: '1.1.1', type: '选择', stem: '下列属于金属材料的是？', options: ['钢材', '塑料', '陶瓷', '橡胶'], correct: 'A', ans: 'A', why: '钢材是典型的金属材料。' },
    { id: 'q2', ch: '第一章', sec: '1.1', kp: '1.1.2', type: '判断', stem: '所有的固体都是晶体。', correct: 'B', ans: 'B错误', why: '玻璃等非晶体不是晶体。' },
    { id: 'q3', ch: '第一章', sec: '1.1', kp: '1.1.1', type: '填空', stem: '材料按使用性能可分为结构材料和______。', correct: '功能材料', ans: '功能材料', why: '功能材料用于特殊物理化学功能。' },
    { id: 'q4', ch: '第一章', sec: '1.1', kp: '1.1.1', type: '名词解释', stem: '解释「晶体」。', correct: '原子规则排列的固体', ans: '原子规则排列的固体', why: '晶体具有长程有序结构。' }
  ] }));
  await page.click('#add-mat'); await wait(150);
  await page.setInputFiles('#add-files', fBank); await page.fill('#add-layer', '2'); await page.click('#add-ok'); await wait(500);

  check('上传考纲+题库后卡片数增加', await page.evaluate(() => document.querySelectorAll('.mat-card').length >= 9));
  await page.click('.book-tab[data-pane="syllabus"]'); await wait(500);
  check('考纲视图显示章节标题(第一章)', await page.evaluate(() => !!document.querySelector('.syl-chapter-head h3') && document.querySelector('.syl-chapter-head h3').textContent.includes('第一章')));
  check('考纲视图显示知识点编号 1.1.1', await page.evaluate(() => Array.from(document.querySelectorAll('.syl-pid')).some(e => e.textContent.includes('1.1.1'))));
  check('考纲视图标注 ▲重点', await page.evaluate(() => document.querySelectorAll('.syl-key').length >= 1));
  check('考纲视图显示题型徽章', await page.evaluate(() => document.querySelectorAll('.syl-type').length >= 1));
  check('考纲视图显示题库挂题数', await page.evaluate(() => document.querySelectorAll('.syl-q').length >= 1));
  check('考纲视图不再显示兜底提示', await page.evaluate(() => !document.querySelector('.syllabus-warn')));
  check('有题库时「从题库出卷」按钮启用', await page.evaluate(() => document.getElementById('syllabus-exam').disabled === false));
  await page.screenshot({ path: path.join(SHOTS, '20-syllabus-view.png') });

  // M4 图文内联：知识点按页码(p1)关联 PPT slide1 图，考纲视图内联缩略图，点击放大看大图
  await wait(500);
  check('考纲视图知识点内联了 PPT 缩略图', await page.evaluate(() => document.querySelectorAll('.syl-img-thumb').length >= 1));
  check('缩略图已加载出真实图片(src 非空)', await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('.syl-img-thumb img')).filter(i => !i.hidden && i.src && i.src.length > 10);
    return imgs.length >= 1;
  }));
  await page.screenshot({ path: path.join(SHOTS, '20b-syllabus-imgs.png') });
  await page.click('.syl-img-thumb'); await wait(450);
  check('点击缩略图打开大图 overlay', await page.evaluate(() => { const lb = document.getElementById('syl-lightbox'); return !!lb && !lb.classList.contains('hidden') && !!lb.querySelector('img').src; }));
  await page.keyboard.press('Escape'); await wait(200);
  check('Escape 关闭大图 overlay', await page.evaluate(() => { const lb = document.getElementById('syl-lightbox'); return !lb || lb.classList.contains('hidden'); }));

  // 从题库出卷（经 考纲页按钮 → 跳练习页 → 组卷）
  await page.click('#syllabus-exam'); await wait(700);
  check('从题库出卷后跳到练习页', await page.evaluate(() => !document.getElementById('pane-exam').classList.contains('hidden')));
  const bankQ = await page.evaluate(() => document.querySelectorAll('.paper-q').length);
  check('题库出卷题目渲染(1-4 题)', bankQ >= 1, '题数=' + bankQ);
  const bankDebug = await page.evaluate(() => Array.from(document.querySelectorAll('.paper-q')).map(q => ({
    types: q.querySelectorAll('input[type=radio]').length + 'r/' + q.querySelectorAll('input[type=checkbox]').length + 'c/' + q.querySelectorAll('textarea').length + 't',
    txt: q.querySelector('.q-type') ? q.querySelector('.q-type').textContent : ''
  })));
  if (process.env.DEBUG) console.log('BANK PAPER:', JSON.stringify(bankDebug));
  check('题库出卷含判断题(正确/错误 两选)', await page.evaluate(() => Array.from(document.querySelectorAll('.paper-q')).some(q => q.querySelectorAll('input[type=radio]').length === 2)));
  check('题库出卷交卷前不显示答案', await page.evaluate(() => !document.getElementById('exam-paper').innerText.includes('标准答案')));
  await page.screenshot({ path: path.join(SHOTS, '21-syllabus-bank-exam.png') });

  // 22) v0.6 全局能力：跨书全文搜索 / 学习报告 / 整库备份入口（真实浏览器点得到）
  await page.click('#nav-search'); await wait(300);
  check('v0.6：全局搜索视图可见', await page.evaluate(() => !document.getElementById('search-view').classList.contains('hidden')));
  await page.fill('#global-search', '讲义'); await wait(900);
  check('v0.6：全局搜索命中结果（跨书/正文/知识点/题目）', await page.evaluate(() =>
    document.querySelectorAll('#global-search-list .search-hit').length >= 1));
  check('v0.6：搜索结果标出类型与所属书', await page.evaluate(() => {
    const e = document.querySelector('.search-hit');
    return !!e && !!e.querySelector('.hit-type') && !!e.querySelector('.hit-book') && !!e.querySelector('.hit-snippet');
  }));
  await page.screenshot({ path: path.join(SHOTS, '23-global-search.png') });
  await page.click('#nav-report'); await wait(900);
  check('v0.6：学习报告显示统计卡片', await page.evaluate(() => document.querySelectorAll('#report-body .report-card').length >= 4));
  check('v0.6：学习报告含本地 SVG 正确率趋势线', await page.evaluate(() =>
    !!document.querySelector('#report-body svg path[stroke="#3a7afe"]')));
  await page.screenshot({ path: path.join(SHOTS, '24-report.png') });
  await page.click('#nav-settings'); await wait(300);
  check('v0.6：设置页含整库导出与恢复入口', await page.evaluate(() =>
    !!document.getElementById('set-export') && !!document.getElementById('set-import') && !!document.getElementById('backup-status')));

  // 23) v0.7 真实入口闭环：反馈落盘读回 / 备份导出→恢复 / 非法模式拒绝
  const fbRound = await page.evaluate(async () => {
    const books = await API.books.list();
    if (!books.length) return { ok: false };
    const r = await API.feedback.save(books[0].id, 'e2e_exam', ['我能复述相图', '卡在计算']);
    const rows = await API.feedback.list(books[0].id);
    return { ok: !!(r && r.ok), rows: rows.length, first: rows[0] && rows[0].answers[0] };
  });
  check('v0.7：学完反馈走服务端落盘且能读回（不再只写 localStorage）',
    fbRound.ok && fbRound.rows >= 1 && fbRound.first === '我能复述相图', JSON.stringify(fbRound));
  check('v0.7：练习页有反馈历史容器（写完能看见）',
    await page.evaluate(() => !!document.getElementById('exam-feedback-history')));

  const backupRound = await page.evaluate(async () => {
    const H = { 'Content-Type': 'application/json' };
    const settings = (window.Settings && Settings.exportable) ? Settings.exportable() : {};
    const res = await fetch('/api/backup/export', { method: 'POST', headers: H, body: JSON.stringify({ settings }) });
    const j = await res.json();
    const parsed = JSON.parse(j.data);
    const before = (await API.books.list()).length;
    const fbFile = (parsed.books[0].files || []).some(f => /feedback\.json$/.test(f.rel));
    const imp = await fetch('/api/backup/import', { method: 'POST', headers: H, body: JSON.stringify({ data: j.data, mode: 'replace' }) });
    const ir = await imp.json();
    const after = (await API.books.list()).length;
    const bad = await fetch('/api/backup/import', { method: 'POST', headers: H, body: JSON.stringify({ data: j.data, mode: 'merge' }) });
    const applied = ir.settings ? Settings.applyImported(ir.settings) : false;
    return {
      hasSettings: !!parsed.settings, engine: parsed.settings && parsed.settings.engine,
      noKey: !/apiKey|sk-/i.test(JSON.stringify(parsed.settings || {})),
      hasIntegrity: !!parsed.integrity && typeof parsed.integrity.files === 'number',
      skippedIsArray: Array.isArray(parsed.skipped), fbFile,
      importOk: !!(ir && ir.ok), returnedSettings: !!(ir && ir.settings), applied,
      before, after, badStatus: bad.status
    };
  });
  check('v0.7：备份含脱敏设置 / 完整性摘要 / 反馈文件',
    backupRound.hasSettings && backupRound.noKey && backupRound.hasIntegrity && backupRound.skippedIsArray && backupRound.fbFile,
    JSON.stringify(backupRound));
  check('v0.7：导出→恢复后书数不丢、设置回传并写回本机',
    backupRound.importOk && backupRound.returnedSettings && backupRound.applied && backupRound.before > 0 && backupRound.after === backupRound.before,
    JSON.stringify(backupRound));
  check('v0.7：非法恢复模式被 400 拒绝', backupRound.badStatus === 400, 'status=' + backupRound.badStatus);

  // 24) v0.7 今日复习闪卡流：先只给问题 → 显示答案 → 四档自评 → 队列前进
  const probe = await page.evaluate(async () => {
    const books = await API.books.list();
    if (!books.length) return null;
    return await API.review.rate(books[0].id, 'e2e_probe_point', 1); // Again = 当天到期
  });
  check('v0.7：独立自评接口把知识点排到今天', !!(probe && probe.ok && probe.dueAt), JSON.stringify(probe));
  await page.click('#nav-review'); await wait(700);
  check('v0.7：今日复习视图可见（顶部导航点得到）',
    await page.evaluate(() => !document.getElementById('review-view').classList.contains('hidden')));
  check('v0.7：首屏显示今天到期总数（跨书聚合）', /今天共/.test(await txt('#review-status')));
  check('v0.7：闪卡默认只给问题、答案隐藏', await page.evaluate(() => {
    const a = document.getElementById('review-answer');
    return !!document.querySelector('.review-prompt') && !!a && a.classList.contains('hidden');
  }));
  await page.screenshot({ path: path.join(SHOTS, '25-review-flashcard.png') });
  if (await page.evaluate(() => !!document.getElementById('show-answer'))) {
    await page.click('#show-answer'); await wait(250);
    check('v0.7：揭示答案后出现四档自评按钮', await page.evaluate(() =>
      !document.getElementById('review-answer').classList.contains('hidden') &&
      document.querySelectorAll('.review-rate-btn').length === 4));
    await page.click('.review-rate-btn[data-rate="3"]'); await wait(700);
    check('v0.7：自评后完成数 +1（排程真的回写）', /已完成 1 张/.test(await txt('#review-status')),
      await txt('#review-status'));
  } else {
    check('v0.7：今日复习出现至少一张到期卡', false, '队列为空');
  }

  // 25) v0.7 搜索命中定位：点资料结果直接打开那份资料的预览
  await page.click('#nav-search'); await wait(300);
  await page.fill('#global-search', '讲义'); await wait(900);
  const hit = await page.evaluate(() => {
    const el = document.querySelector('.search-hit[data-type="material"][data-id]');
    if (!el) return null;
    el.id = 'e2e-search-hit';
    return { id: el.dataset.id, type: el.dataset.type };
  });
  check('v0.7：搜索命中项带 data-id（定位信息不再被丢弃）', !!(hit && hit.id), JSON.stringify(hit));
  if (hit) {
    await page.click('#e2e-search-hit'); await wait(900);
    check('v0.7：点资料命中直接打开预览（真定位到原文，不是只切 tab）', await page.evaluate(() => {
      const m = document.getElementById('preview-modal');
      const t = document.getElementById('preview-title');
      return !!m && !m.classList.contains('hidden') && !!t && t.textContent.trim().length > 0;
    }));
    await page.screenshot({ path: path.join(SHOTS, '26-search-jump.png') });
    await page.click('#preview-close'); await wait(200);
  }

  // 16) 零外链硬约束：CSP + 本地 vendor，全程不得向外部域名发请求
  check('全程零外部域名请求', externalRequests.length === 0, externalRequests.slice(0, 3).join(' | '));
  check('顶层 CSP 存在且 connect-src 限同源', await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return !!m && /connect-src 'self'/.test(m.content);
  }));

  // 零 JS 报错
  check('全程零未捕获 JS 报错', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  srv.kill();
  console.log('\nE2E 结果： ' + pass + ' 通过 / ' + fail + ' 失败' + (fails.length ? '  (' + fails.join(', ') + ')' : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E 崩溃：', e); process.exit(1); });
