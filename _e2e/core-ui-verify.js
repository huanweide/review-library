'use strict';
// 统一核心前端 · 双形态真浏览器验收（2026-11-09 独立复核缺陷收尾 + A→B 融合能力验收）。
//
// 背景：独立 reviewer 实证「默认窗口翻 core.html 后，href="/css/core.css" 在 file:// 下
// 解析到盘符根 → CSS 全丢 → .hidden 失效」，而 HTTP 形态正常，所以此前所有测试全绿。
// 本脚本用真 Chromium 分别跑 HTTP 与 file:// 两种形态，以 computed display 作硬判据。
//
// 融合轮新增：起本地 OpenAI 兼容 mock LLM，让两种形态都真发 HTTP 请求、真解析、
// 真渲染，再**实际点击**「放大 / 复位 / 导出 SVG / 导出 JSON / 题型卡片」并断言 DOM 与 blob 内容。
// 不是「DOM 里有这个按钮」就算通过。
//
// 用法：node _e2e/core-ui-verify.js   （不依赖真实 API key，不需要 Electron 二进制）
const { chromium } = require('playwright-core');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5197;
const MOCK_PORT = 5198;
const MOCK_BASE = 'http://127.0.0.1:' + MOCK_PORT + '/v1';
const BASE = 'http://127.0.0.1:' + PORT;

// 融合验收用的确定性模型输出（符合 B 的 outline/questionIndex/summary 契约）。
const ANALYSIS_PAYLOAD = {
  outline: {
    title: '融合验证全书',
    children: [{
      title: '第一章 数据结构', children: [{
        title: '1.1 线性表', children: [
          { title: '顺序表', desc: '连续存储', questionTypes: ['选择题'], children: [
            { title: '插入复杂度', desc: 'O(n)', children: [] }
          ] },
          { title: '链表', desc: '链式存储', questionTypes: ['简答题'], children: [] }
        ]
      }]
    }]
  },
  questionIndex: [
    { type: '选择题', items: [{ title: '顺序表', path: ['第一章 数据结构', '1.1 线性表', '顺序表'], questions: [
      { stem: '长为 10 的顺序表，在第 3 个位置插入元素，需要移动多少个元素？', options: ['A. 7 个', 'B. 8 个', 'C. 9 个', 'D. 10 个'],
        answer: 'B. 8 个 —— 套用 n-i+1 = 10-3+1 = 8。',
        solution: ['第 1 步：确定 n=10、i=3。', '第 2 步：移动次数公式为 n-i+1。', '第 3 步：10-3+1=8。'],
        rationale: '题干问的是固定位置的精确移动次数，不是等概率平均值，所以要用 n-i+1 而非 n/2；先辨认问的是精确值还是期望值，再选公式，误用 n/2 会算出 5。',
        pitfalls: '把 n-i+1 与 n/2 混淆。', difficulty: '基础',
        pointPath: ['第一章 数据结构', '1.1 线性表', '顺序表'],
        source: { file: '验证讲义.txt', page: 2, anchor: '【块1】', quote: '顺序表采用连续内存，支持随机访问' } },
      { stem: '顺序表按下标查找第 i 个元素的时间复杂度是？', options: ['A. O(1)', 'B. O(n)', 'C. O(log n)'],
        answer: 'A. O(1) —— 连续存储可由首地址加下标直接算出地址。',
        solution: ['第 1 步：顺序表地址连续。', '第 2 步：地址 = 首地址 + i × 元素大小。', '第 3 步：一次计算即可，故 O(1)。'],
        rationale: '看到「按下标」就想到随机访问能力，这是顺序存储区别于链式存储的根本特征；若误判成需要遍历，是把顺序表和单链表的查找代价记反了。',
        pitfalls: '把顺序表的 O(1) 随机访问与链表的 O(n) 查找记反。', difficulty: '基础',
        pointPath: ['第一章 数据结构', '1.1 线性表', '顺序表'],
        source: { file: '原图.png', page: 0, anchor: '【块1】', quote: '顺序表支持随机访问，查找第 i 个元素 O(1)' } }
    ] }] },
    { type: '简答题', items: [{ title: '链表', path: ['第一章 数据结构', '1.1 线性表', '链表'], questions: [
      { stem: '简述单链表在已知结点指针 p 后插入新结点为何是 O(1)，删除 p 本身为何是 O(n)。', options: [],
        answer: '插入只需改指针；删除 p 需先从头找到前驱结点，故 O(n)。',
        solution: ['第 1 步：p 之后插入，只需令新结点 next 指向 p.next 再改 p.next。', '第 2 步：这两步都是常数次指针赋值。', '第 3 步：删除 p 需要修改其前驱的 next，单链表没有前驱指针，必须遍历。'],
        rationale: '切入点在于「单链表只有后继指针」这一结构约束；先判断操作需要哪些结点的指针，再看这些指针是否可直接获得，就能推出两种操作的代价差异。',
        pitfalls: '误以为删除 p 也能 O(1)，忽略前驱不可达。', difficulty: '进阶',
        pointPath: ['第一章 数据结构', '1.1 线性表', '链表'],
        source: { file: '验证讲义.txt', page: 3, quote: '单链表插入 O(1)，删除结点需找前驱 O(n)' } }
    ] }] }
  ],
  summary: '全书概览：线性表的两种存储结构及其复杂度差异。'
};
// 真实长度语料（≥ MIN_TEXT=80），否则 F5 会先拦下，测不到分析链路。
const FIXTURE_TEXT = [
  '第一章 绪论。核心概念与基本性质，讨论线性表的定义、抽象数据类型与常见误解。',
  '第二章 存储结构。顺序表采用连续内存，支持随机访问；链表采用指针串联，插入删除更灵活。',
  '第三章 复杂度分析。比较两种结构在查找、插入、删除操作上的时间代价与空间开销。',
  '第四章 典型例题。包含复合函数定义域判定、反函数性质证明与极限存在的判别条件。'
].join('\n');

const SHOTS = path.join(__dirname, 'shots', 'core-ui-verify');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; process.stderr.write('  ✗ ' + msg + '\n'); }
}

// 用真实 Core 实例驱动 file:// 形态的 coreRequest（不复制路由语义，直接调 canonical dispatch）。
function makeBridge(tmpRoot) {
  const { Core } = require(path.join(ROOT, 'core'));
  const requestLib = require(path.join(ROOT, 'core', 'request'));
  const core = new Core(tmpRoot);
  return async (p, m, b) => requestLib.dispatch(core, p, m, b);
}

async function runForm({ label, url, tmpRoot, initScript }) {
  console.log('\n--- 形态：' + label + ' ---');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  let expectedSabotageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // newBook() 用 prompt() 取书名；Playwright 默认 dismiss 会让 prompt 返回 null 而静默不建书。
  page.on('dialog', (d) => d.accept('双形态验证书'));
  // 捕获导出产生的 blob：playwright 对 blob URL 的 download 事件不保证触发，
  // 直接 hook URL.createObjectURL 读内容，证据更硬。
  await page.addInitScript(() => {
    window.__lastBlob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob && typeof blob.text === 'function') {
        blob.text().then((t) => { window.__lastBlob = { type: blob.type, text: t }; }).catch(() => {});
      }
      return orig(blob);
    };
  });
  if (initScript) await initScript(page, tmpRoot);

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#newBookBtn');
    await sleep(300);

    // 1) CSS 真加载的硬判据：初始 .hidden 元素必须 display:none。
    const hiddenStates = await page.$$eval('.hidden', (els) => els.map((e) => ({
      id: e.id || e.className, display: getComputedStyle(e).display,
    })));
    const notHidden = hiddenStates.filter((s) => s.display !== 'none');
    ok(hiddenStates.length >= 4, '页面有 ≥4 个初始 .hidden 元素（实为 ' + hiddenStates.length + '）');
    ok(notHidden.length === 0, '所有初始 .hidden 元素 display:none（CSS 已加载），异常：' + JSON.stringify(notHidden));
    const sheet = await page.evaluate(() => ({
      count: document.styleSheets.length,
      href: document.querySelector('link[rel=stylesheet]') && document.querySelector('link[rel=stylesheet]').href,
    }));
    ok(sheet.count >= 1, 'stylesheet 已挂载（实为 ' + sheet.count + ' 张，' + sheet.href + '）');

    // 2) 点击设置弹窗：.hidden 切换必须真的生效
    await page.click('#openSettings'); await sleep(150);
    const modalDisplay = await page.$eval('#settingsModal', (e) => getComputedStyle(e).display);
    ok(modalDisplay !== 'none', '点「模型设置」后弹窗由 hidden 变可见（display=' + modalDisplay + '）');

    // 3) testConn：Electron 形态必须走 window.api.llm.test，且 HTTP 兜底仍在
    await page.click('#testConn'); await sleep(400);
    const conn = await page.evaluate(() => ({
      status: (document.querySelector('#connStatus') || {}).textContent || '',
      bridgeCalls: window.__llmTestCalls || 0,
      fetchCalls: window.__llmFetchCalls || 0,
      fetchHooked: window.__fetchHooked === true,
    }));
    ok(conn.status && conn.status !== '测试中…', '「测试连接」有结果且不卡在测试中：' + conn.status.slice(0, 60));
    if (label.indexOf('Electron') >= 0) {
      ok(conn.fetchHooked, 'Electron 形态已 hook window.fetch（计数器有判别力，不是恒 0）');
      ok(conn.bridgeCalls === 1, 'Electron 形态 testConn 走 window.api.llm.test（' + conn.bridgeCalls + ' 次）');
      ok(conn.fetchCalls === 0, 'Electron 形态未发裸 fetch（' + conn.fetchCalls + ' 次）');
      const errsBefore = errors.length;
      await page.evaluate(() => { delete window.api.llm.test; });
      await page.click('#testConn'); await sleep(400);
      const sabotage = await page.evaluate(() => window.__llmFetchCalls || 0);
      ok(sabotage === 1, '反证：移除 bridge 后裸 fetch 被计数（' + sabotage + ' 次），计数器非恒 0');
      const sabotageErrs = errors.slice(errsBefore).filter((e) => /api\/llm\/test/.test(e));
      ok(sabotageErrs.length === 1,
        '反证产生 1 条 file:// fetch 失败（印证旧版 testConn 在 Electron 必挂）：' + sabotageErrs[0]);
      expectedSabotageErrors = sabotageErrs;
    }

    // 4) 走 UI 填模型配置（指向本地 mock LLM），让整本分析能真跑
    await page.fill('#cfgBase', MOCK_BASE);
    await page.fill('#cfgModel', 'mock-model');
    await page.fill('#cfgKey', 'test-key');
    await page.click('#saveSettings'); await sleep(150);
    const saved = await page.evaluate(() => localStorage.getItem('core_llm_cfg') || '');
    ok(saved.indexOf('mock-model') >= 0, '模型配置已保存（localStorage 可读回）');

    // 5) 建书 → 导入真实长度资料
    await page.click('#newBookBtn'); await sleep(350);
    const books = await page.$$eval('#bookList li', (els) => els.length);
    ok(books >= 1, '新建书后书架出现条目（' + books + ' 本）');
    await page.setInputFiles('#fileInput', {
      name: '验证讲义.txt', mimeType: 'text/plain', buffer: Buffer.from(FIXTURE_TEXT),
    });
    await sleep(600);
    const files = await page.$$eval('#fileList li', (els) => els.length);
    ok(files >= 1, '导入资料后文件列表出现条目（' + files + ' 份）');
    const importMsg = await page.$eval('#importStatus', (e) => e.textContent || '');
    ok(/已导入\s*1\/1/.test(importMsg), 'F7 导入状态持久上屏：' + importMsg.slice(0, 60));

    // 6) 真点「大模型整体分析」：两种形态都走真 HTTP → mock LLM → 真解析 → 真渲染
    await page.click('#analyzeBtn');
    let analyzed = false;
    for (let i = 0; i < 60; i++) {
      const n = await page.$$eval('#tree .node', (els) => els.length).catch(() => 0);
      if (n >= 6) { analyzed = true; break; }
      await sleep(250);
    }
    ok(analyzed, '整体分析真跑通：大纲数据含 ≥6 个节点（画布可见性由后面 SVG 断言另验）');
    const analyzeMsg = await page.$eval('#analyzeStatus', (e) => e.textContent || '');
    ok(/分析完成/.test(analyzeMsg) && !/正在把整本书/.test(analyzeMsg),
      '分析完成后状态条更新为「分析完成…」，不再与 toast 自相矛盾：' + analyzeMsg.slice(0, 80));
    const qcards = await page.$$eval('#questionIndex .qcard', (els) => els.length).catch(() => 0);
    ok(qcards >= 2, '题型索引渲染出 ≥2 张卡片（实为 ' + qcards + '）');
    const typeCards = await page.$$eval('#statsBox .stat.typecount', (els) => els.length).catch(() => 0);
    ok(typeCards >= 2, 'F8 概览显示分题型统计卡（实为 ' + typeCards + '）');

    // 7) F3 真点「放大」→ 百分比与 transform 都要变；点「复位」→ 回 100%
    const zoomBefore = await page.$eval('#zoomLabel', (e) => e.textContent);
    await page.click('#btnZoomIn'); await sleep(150);
    const zoomAfter = await page.$eval('#zoomLabel', (e) => e.textContent);
    const transform = await page.$eval('#tree', (e) => e.style.transform || '');
    ok(zoomBefore === '100%' && zoomAfter === '115%', 'F3 点放大：100% → 115%（实为 ' + zoomBefore + ' → ' + zoomAfter + '）');
    ok(/scale\(1\.15/.test(transform), 'F3 放大真的写了 CSS transform（' + transform + '）');
    await page.click('#btnFit'); await sleep(150);
    ok((await page.$eval('#zoomLabel', (e) => e.textContent)) === '100%', 'F3 点复位回到 100%');

    // 8) F4 真点导出，捕获 blob 内容验证（不是只验证按钮存在）
    await page.click('#btnExportSvg'); await sleep(400);
    const svgBlob = await page.evaluate(() => window.__lastBlob);
    ok(!!svgBlob && svgBlob.text.indexOf('<svg') === 0 && svgBlob.text.includes('</svg>'),
      'F4 导出 SVG 生成合法矢量内容（' + (svgBlob ? svgBlob.text.length : 0) + ' 字符）');
    ok(!!svgBlob && /顺序表|链表/.test(svgBlob.text), 'F4 SVG 含真实节点文字');
    await page.click('#btnExportJson'); await sleep(400);
    const jsonBlob = await page.evaluate(() => window.__lastBlob);
    let parsedJson = null;
    try { parsedJson = JSON.parse(jsonBlob && jsonBlob.text || 'null'); } catch (e) { /* 记录 */ }
    ok(!!parsedJson && !!parsedJson.tree && Array.isArray(parsedJson.questionIndex),
      'F4 导出 JSON 可解析且含 tree + questionIndex');

    // 9) F2 真点题型卡片 → 切回导图 tab 且对应节点被高亮
    await page.click('.tab[data-tab="questions"]'); await sleep(120);
    await page.click('#questionIndex .qcard'); await sleep(200);
    const linkage = await page.evaluate(() => ({
      mindmapActive: (document.querySelector('#tab-mindmap') || {}).classList.contains('active'),
      highlights: document.querySelectorAll('#tree .node.highlight').length,
      highlightedId: (document.querySelector('#tree .node.highlight') || {}).dataset
        ? document.querySelector('#tree .node.highlight').dataset.id : '',
      // v2 默认「导图/画布」模式，#tree 大纲是 hidden。只断言大纲高亮是假绿，必须验可见画布。
      canvasVisible: (() => { const c = document.querySelector('#mmCanvas'); return !!c && getComputedStyle(c).display !== 'none'; })(),
      canvasLocate: document.querySelectorAll('#mmCanvas .mm-node.locate').length,
      outlineVisible: (() => { const t = document.querySelector('#tree'); return !!t && getComputedStyle(t).display !== 'none'; })(),
    }));
    ok(linkage.mindmapActive, 'F2 点题型卡片后自动切回思维导图 tab');
    ok(linkage.highlights === 1, 'F2 大纲数据层恰好 1 个节点被高亮（实为 ' + linkage.highlights + '）');
    ok(/^n\d+_\d+$/.test(linkage.highlightedId || ''), 'F2 高亮节点带确定性 id（' + linkage.highlightedId + '）');
    ok(linkage.outlineVisible === false, 'F2 时大纲确为隐藏态（证明上面那条只是数据层证据）');
    ok(linkage.canvasVisible && linkage.canvasLocate === 1,
      'F2 可见画布上该知识点真被定位高亮（实为 locate=' + linkage.canvasLocate + '，visible=' + linkage.canvasVisible + '）');

    // 10) 概览页截断/来源信息（F6）可见
    await page.click('.tab[data-tab="summary"]'); await sleep(120);
    const metaText = await page.$eval('#statsBox', (e) => e.textContent || '');
    ok(/全书 \d+ 字/.test(metaText), 'F6 概览显示全书字数来源信息');

    await page.click('.tab[data-tab="mindmap"]'); await sleep(120);

    // ===== v2：题型树并入导图 + 三级下钻 + 原图/解答/思路（真点击，非 DOM 存在）=====
    await page.click('#closeQitem'); await sleep(100);

    // 导入一张真实图片，让「图书原图」路径可真验（不是只显示文件名占位）。
    await page.setInputFiles('#fileInput', {
      name: '原图.png', mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex'),
    });
    await sleep(700);

    // 11) SVG 画布真渲染（不是 ul/li 列表冒充导图）
    const svgNodes = await page.$$eval('#mmCanvas svg .mm-node', (els) => els.length).catch(() => 0);
    ok(svgNodes >= 6, 'SVG 导图画布渲染出 ≥6 个节点（实为 ' + svgNodes + '）');
    const svgEdges = await page.$$eval('#mmCanvas svg path', (els) => els.length).catch(() => 0);
    ok(svgEdges >= 5, 'SVG 画布有连线（' + svgEdges + ' 条），不是缩进列表');

    // 12) 3 布局切换真生效（坐标变化，不是只换按钮高亮）
    // 比「全部节点坐标串」而非只比 root 的 x：root 在 right/both 下可能同为 28，会假绿。
    const coords = () => page.$$eval('#mmCanvas svg .mm-node rect', els => els.map(e => e.getAttribute('x') + ',' + e.getAttribute('y')).join('|'));
    const xRight = await coords();
    await page.click('[data-layout="both"]'); await sleep(200);
    const xBoth = await coords();
    ok(xRight !== xBoth, '切「双侧」布局后节点坐标真变化（' + xRight.length + ' → ' + xBoth.length + ' 字符坐标串）');
    await page.click('[data-layout="org"]'); await sleep(200);
    const xOrg = await coords();
    ok(xBoth !== xOrg, '切「组织图」布局后坐标再次变化');
    await page.click('[data-layout="right"]'); await sleep(150);

    // 13) 题型分类长进同一张导图
    await page.click('[data-perspective="question"]'); await sleep(250);
    const qkinds = await page.$$eval('#mmCanvas svg .mm-node', els => els.map(e => e.getAttribute('data-kind')));
    ok(qkinds.includes('qtype'), '题型树含题型节点（kind=qtype）');
    ok(qkinds.includes('qitem'), '题型树含子题型节点（kind=qitem）');
    ok(qkinds.includes('question'), '题型树含题目节点（kind=question），三级形状成立');

    // 14) 点子题型 → 看到所有题目
    await page.click('#mmCanvas svg .mm-node[data-kind="qitem"]'); await sleep(250);
    const panelVisible = await page.$eval('#qitemPanel', e => getComputedStyle(e).display !== 'none');
    const listCount = await page.$$eval('#qitemList .sp-qlist-item', els => els.length).catch(() => 0);
    ok(panelVisible, '点子题型节点后题目列表面板打开');
    ok(listCount === 2, '该子题型的「所有题目」列出 2 道（实为 ' + listCount + '）');

    // 15) 再点题目 → 图书原图 + 详细解答 + 思路
    await page.click('#qitemList .sp-qlist-item:nth-child(2)'); await sleep(350);
    const detail = await page.evaluate(() => ({
      visible: getComputedStyle(document.querySelector('#questionModal')).display !== 'none',
      stem: (document.querySelector('#qdStem') || {}).textContent || '',
      answer: (document.querySelector('#qdAnswer') || {}).textContent || '',
      steps: document.querySelectorAll('#qdSolution li').length,
      rationale: (document.querySelector('#qdRationale') || {}).textContent || '',
      source: (document.querySelector('#qdSource') || {}).textContent || '',
      img: (document.querySelector('#qdImage img') || {}).src || '',
      imgVisible: getComputedStyle(document.querySelector('#qdImage')).display !== 'none',
    }));
    ok(detail.visible, '点题目后详情弹窗打开');
    ok(detail.stem.length > 10, '详情含完整题干：' + detail.stem.slice(0, 34));
    ok(detail.answer.length > 5, '详情含答案（含理由，非单字母）');
    ok(detail.steps >= 2, '详情含分步详细解答（' + detail.steps + ' 步）');
    ok(detail.rationale.length >= 30, '详情含解题思路且非一句套话（' + detail.rationale.length + ' 字）');
    ok(/原图\.png|验证讲义/.test(detail.source), '详情显示图书来源：' + detail.source.slice(0, 40));
    ok(detail.imgVisible && /^data:image\/png;base64,/.test(detail.img), '图片型资料显示真·图书原图（raw 路由回读 base64）');
    // 真截图发现的视觉缺陷：详情弹窗被子题型面板盖住，右下「定位」按钮不可点。
    const zOrder = await page.evaluate(() => {
      const btn = document.querySelector('#qdLocate');
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { topIsButton: !!(top && (top === btn || btn.contains(top))), topTag: top ? (top.id || top.className) : '' };
    });
    ok(zOrder.topIsButton, '详情弹窗层级高于题目列表：「定位知识点」按钮真实可点（命中 ' + zOrder.topTag + '）');
    await page.screenshot({ path: path.join(SHOTS, label.replace(/[^a-zA-Z0-9]/g, '-') + '-question-detail.png'), fullPage: true });

    // ===== v3 优化块：锚点与引文校验徽章在真浏览器里可见，正负例都验 =====
    const anchorUi = await page.evaluate(() => {
      const box = document.querySelector('#qdSource');
      const a = box.querySelector('.qd-anchor');
      const v = box.querySelector('.qd-verify');
      return { anchor: a ? a.textContent.trim() : '', verify: v ? v.textContent.trim() : '', cls: v ? v.className : '' };
    });
    ok(/【块1】/.test(anchorUi.anchor), '详情显示语料锚点（' + anchorUi.anchor + '）');
    ok(/未能在原文中定位/.test(anchorUi.verify) && /warn/.test(anchorUi.cls),
      '编造的引文被程序识破并显示警告徽章：' + anchorUi.verify.slice(0, 30));
    await page.click('#closeQuestion'); await sleep(120);
    await page.click('#qitemList .sp-qlist-item:nth-child(1)'); await sleep(300);
    const hitUi = await page.$eval('#qdSource', (box) => {
      const v = box.querySelector('.qd-verify'); return v ? v.textContent.trim() : '';
    });
    ok(/已与原文逐字核对/.test(hitUi), '真引文显示「已与原文逐字核对」徽章：' + hitUi.slice(0, 30));
    await page.screenshot({ path: path.join(SHOTS, label.replace(/[^a-zA-Z0-9]/g, '-') + '-anchor-verified.png'), fullPage: true });

    await page.click('#closeQuestion'); await sleep(120);
    await page.click('#closeQitem'); await sleep(120);

    // 16) 搜索命中高亮 / 大纲双模式 / 键盘
    await page.fill('#mmSearch', '选择题'); await sleep(200);
    const hits = await page.$$eval('#mmCanvas svg .mm-node.hit', els => els.length).catch(() => 0);
    ok(hits >= 1, '全文搜索命中并高亮节点（' + hits + ' 个）');
    await page.fill('#mmSearch', ''); await sleep(120);
    await page.click('#btnOutline'); await sleep(180);
    const outlineOn = await page.evaluate(() => ({
      tree: getComputedStyle(document.querySelector('#tree')).display !== 'none',
      canvas: getComputedStyle(document.querySelector('#mmCanvas')).display === 'none',
    }));
    ok(outlineOn.tree && outlineOn.canvas, '切「大纲」模式：DOM 树显示、SVG 画布隐藏（Xmind 双模式）');
    await page.click('[data-view="canvas"]'); await sleep(150);

    // 17) 双击节点聚焦下钻 + 返回全图
    await page.dblclick('#mmCanvas svg .mm-node[data-kind="qtype"]'); await sleep(350);
    const focusBack = await page.$eval('#btnFocusBack', e => getComputedStyle(e).display !== 'none');
    ok(focusBack, '双击节点进入聚焦下钻，「返回全图」按钮出现');
    if (focusBack) await page.click('#btnFocusBack');
    await sleep(150);

    // 18) MD / OPML / PNG 导出真产出内容
    await page.click('#btnExportMd'); await sleep(300);
    const mdBlob = await page.evaluate(() => window.__lastBlob);
    ok(mdBlob && /# |^- /m.test(mdBlob.text) && /题型分类|数据结构/.test(mdBlob.text),
      '导出 Markdown 含层级大纲（' + (mdBlob ? mdBlob.text.length : 0) + ' 字符）');
    await page.click('#btnExportOpml'); await sleep(300);
    const opmlBlob = await page.evaluate(() => window.__lastBlob);
    ok(opmlBlob && opmlBlob.text.includes('<opml') && opmlBlob.text.includes('<outline'), '导出 OPML 合法');
    await page.click('#btnExportPng'); await sleep(900);
    const pngBlob = await page.evaluate(() => window.__lastBlob);
    ok(pngBlob && /image\/png/.test(pngBlob.type), '导出 PNG 生成位图 blob');

    // 恢复知识树视角，截主图
    await page.click('[data-perspective="knowledge"]'); await sleep(200);
    await page.screenshot({ path: path.join(SHOTS, label.replace(/[^a-zA-Z0-9]/g, '-') + '.png'), fullPage: true });

    // ===== 美化块：token / 去渐变重阴影 / 浅深双主题（真断言 + 真截图）=====
    const themeLight = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const top = getComputedStyle(document.querySelector('.topbar'));
      const rect = document.querySelector('#mmCanvas svg rect');
      return {
        bg: (cs.getPropertyValue('--bg') || '').trim(),
        shadow: (cs.getPropertyValue('--shadow') || '').trim(),
        hasSurface3: !!(cs.getPropertyValue('--surface-3') || '').trim(),
        topImage: top.backgroundImage,
        svgBg: rect ? (rect.getAttribute('fill') || '') : ''
      };
    });
    ok(themeLight.hasSurface3, 'V1 语义 token 体系存在（--surface-3 浮层层级）');
    ok(!/8px 24px/.test(themeLight.shadow), 'V4 移除双层重阴影（' + themeLight.shadow + '）');
    ok(themeLight.topImage === 'none', 'V3 顶栏不再用渐变（' + themeLight.topImage + '）');

    await page.emulateMedia({ colorScheme: 'dark' }); await sleep(350);
    const themeDark = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const rect = document.querySelector('#mmCanvas svg rect');
      return {
        bg: (cs.getPropertyValue('--bg') || '').trim(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        svgBg: rect ? (rect.getAttribute('fill') || '') : ''
      };
    });
    ok(themeDark.bg !== themeLight.bg, 'V2 深色模式 --bg 真切换（' + themeLight.bg + ' → ' + themeDark.bg + '）');
    ok(themeDark.svgBg !== themeLight.svgBg && themeDark.svgBg.toLowerCase() !== '#ffffff',
      'V2 深色模式 SVG 画布跟着换底色，不再是一块白（' + themeLight.svgBg + ' → ' + themeDark.svgBg + '）');
    const firstRgb = (themeDark.bodyBg.match(/\d+/) || [])[0];
    ok(Number(firstRgb) < 80, 'V2 深色模式 body 首帧即深色（' + themeDark.bodyBg + '），无白闪');
    await page.screenshot({ path: path.join(SHOTS, label.replace(/[^a-zA-Z0-9]/g, '-') + '-dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' }); await sleep(200);

    // 只排除已明确归因的预期错误（favicon、反证故意触发的 file:// fetch 失败）。
    const realErrors = errors.filter((e) =>
      !/favicon|net::ERR_FAILED/.test(e) && !expectedSabotageErrors.includes(e));
    ok(realErrors.length === 0, '控制台/页面错误为 0（已归因 ' + expectedSabotageErrors.length + ' 条反证预期错误）' +
      (realErrors.length ? '：' + realErrors.join(' | ') : ''));
  } catch (e) {
    failed++;
    process.stderr.write('  ✗ FATAL: ' + (e && e.stack || e) + '\n');
  } finally {
    await browser.close();
  }
}

// 全端美化验收：旧版分层视图 index.html 在 HTTP 与 file:// 两种形态下，
// 设计系统（tokens.css @import 链）与深色模式首帧都必须生效——
// 这正是 core.html 之前踩过的「file:// 下绝对路径 CSS 全丢」坑的同源验证。
async function runLegacyForm({ label, url, initScript }) {
  console.log('\n--- 旧版视图（index.html）：' + label + ' ---');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  if (initScript) await initScript(page);
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('.topbar', { timeout: 5000 });
    await sleep(300);

    // 1) CSS 真加载（含 @import tokens.css 链）：.hidden 必须 display:none
    const sheet = await page.evaluate(() => ({
      count: document.styleSheets.length,
      href: document.querySelector('link[rel=stylesheet]') && document.querySelector('link[rel=stylesheet]').href,
    }));
    ok(sheet.count >= 1, 'index.html stylesheet 已挂载（实为 ' + sheet.count + ' 张，' + sheet.href + '）');
    const hiddenStates = await page.$$eval('.hidden', (els) => els.map((e) => getComputedStyle(e).display));
    const notHidden = hiddenStates.filter((d) => d !== 'none');
    ok(hiddenStates.length >= 4, 'index.html 有 ≥4 个初始 .hidden 元素（实为 ' + hiddenStates.length + '）');
    ok(notHidden.length === 0, 'index.html 所有 .hidden 元素 display:none（CSS 含 import 链已加载），异常：' + JSON.stringify(notHidden));

    // 2) 浅色：body 背景 = --bg(#f6f7f9)；顶栏 = --panel(#fff)
    const light = await page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      panel: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    }));
    ok(light.bg === 'rgb(246, 247, 249)', 'index.html 浅色 body 背景 = --bg(#f6f7f9)，实为 ' + light.bg);
    ok(light.panel === 'rgb(255, 255, 255)', 'index.html 浅色顶栏 = --panel(#fff)，实为 ' + light.panel);
    await page.screenshot({ path: path.join(SHOTS, 'legacy-' + label.replace(/[^a-zA-Z0-9]/g, '-') + '-light.png'), fullPage: true });

    // 3) 深色：emulateMedia 后 body 切到 #10131a，--bg token 翻转，顶栏切 #171b24
    await page.emulateMedia({ colorScheme: 'dark' }); await sleep(350);
    const dark = await page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      panel: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
      tokenBg: (getComputedStyle(document.documentElement).getPropertyValue('--bg') || '').trim(),
    }));
    ok(dark.bg === 'rgb(16, 19, 26)', 'index.html 深色 body 背景 = --bg(#10131a)，实为 ' + dark.bg);
    ok(dark.panel === 'rgb(23, 27, 36)', 'index.html 深色顶栏 = --panel(#171b24)，实为 ' + dark.panel);
    ok(dark.tokenBg === '#10131a', 'index.html 深色 --bg token 真翻转（实为 ' + dark.tokenBg + '）');
    await page.screenshot({ path: path.join(SHOTS, 'legacy-' + label.replace(/[^a-zA-Z0-9]/g, '-') + '-dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' }); await sleep(150);

    // 4) 错误容忍：file:// 下 API 不可达、以及 ES module 脚本被 CORS 拦截（origin 'null'）都属传输层预期，
    //    与 CSS/主题无关（core.html 的入口脚本非 module，故不触发；index.html 含 pdf-extract.js module）。
    const realErrors = errors.filter((e) => !/favicon|net::ERR_FAILED|api|fetch|Failed to fetch|NetworkError|ERR_|CORS|pdf-extract|origin 'null'|Cross origin|scheme/.test(e));
    ok(realErrors.length === 0, 'index.html 无 CSS/主题相关真实报错' + (realErrors.length ? '：' + realErrors.join(' | ') : ''));
  } catch (e) {
    failed++;
    process.stderr.write('  ✗ FATAL: ' + (e && e.stack || e) + '\n');
  } finally {
    await browser.close();
  }
}

(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-ui-verify-'));
  // 本地 OpenAI 兼容 mock LLM：让「整体分析」真的发出 HTTP 请求并解析返回，不依赖真实 key。
  const mockLlm = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      if (/\/models$/.test(req.url || '')) {
        res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANALYSIS_PAYLOAD) } }] }));
      }
    });
  });
  await new Promise((resolve) => mockLlm.listen(MOCK_PORT, '127.0.0.1', resolve));

  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), LIBRARY_ROOT: tmpRoot, NO_OPEN: '1' }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (d) => { stderr += String(d); });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(BASE + '/core.html'); if (r.ok) { ready = true; break; } } catch (e) {}
      await sleep(200);
    }
    if (!ready) throw new Error('server 未就绪：' + stderr.slice(0, 300));
    console.log('=== 统一核心前端双形态真浏览器验收（含融合能力实际点击）===');

    await runForm({ label: 'HTTP', url: BASE + '/core.html', tmpRoot });

    // Electron file:// 替身：注入等价 window.api，直接打开本地文件。
    const fileUrl = 'file:///' + path.join(ROOT, 'renderer', 'core.html').replace(/\\/g, '/');
    await runForm({
      label: 'Electron-file-protocol', url: fileUrl, tmpRoot,
      initScript: async (page, root) => {
        const bridge = makeBridge(root);
        await page.exposeFunction('__coreBridge', bridge);
        await page.addInitScript(() => {
          window.__llmTestCalls = 0;
          window.__llmFetchCalls = 0;
          const realFetch = window.fetch.bind(window);
          window.fetch = (...args) => {
            const u = args[0] && (typeof args[0] === 'string' ? args[0] : args[0].url) || '';
            if (String(u).indexOf('/api/llm/test') >= 0) window.__llmFetchCalls++;
            return realFetch(...args);
          };
          window.__fetchHooked = true;
          window.api = {
            llm: { test: async () => { window.__llmTestCalls++; return { ok: true, models: [{ id: 'mock-model' }] }; } },
            coreRequest: (p, m, b) => window.__coreBridge(p, m, b),
          };
        });
      },
    });
    // 全端美化：旧版视图 index.html 双形态验收（HTTP 真后端 + file:// 注入 fetch/api 桩避免无后端报错）
    await runLegacyForm({ label: 'HTTP', url: BASE + '/index.html' });
    const legacyFileUrl = 'file:///' + path.join(ROOT, 'renderer', 'index.html').replace(/\\/g, '/');
    await runLegacyForm({
      label: 'Electron-file-protocol', url: legacyFileUrl,
      initScript: async (page) => {
        await page.addInitScript(() => {
          const realFetch = window.fetch ? window.fetch.bind(window) : null;
          window.fetch = (...args) => {
            const u = args[0] && (typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url)) || '';
            if (String(u).indexOf('/api/') >= 0) {
              return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [], ok: true, books: [], status: 'ok' }) });
            }
            return realFetch ? realFetch(...args) : Promise.reject(new Error('no fetch'));
          };
          window.api = { llm: { test: async () => ({ ok: true, models: [] }) }, coreRequest: async () => ({ ok: true, data: {} }) };
        });
      },
    });
  } catch (e) {
    failed++;
    console.error('FATAL ' + (e && e.stack || e));
  } finally {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      else server.kill('SIGKILL');
    } catch (e) { try { server.kill('SIGKILL'); } catch (_) {} }
    try { mockLlm.close(); } catch (e) {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n=== 双形态验收：通过 ' + passed + ' / 失败 ' + failed + ' ===');
  console.log('截图目录：' + SHOTS);
  process.exit(failed ? 1 : 0);
})();
