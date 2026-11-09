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
    { type: '选择题', items: [{ title: '顺序表', path: ['第一章 数据结构', '1.1 线性表', '顺序表'] }] },
    { type: '简答题', items: [{ title: '链表', path: ['第一章 数据结构', '1.1 线性表', '链表'] }] }
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
    ok(analyzed, '整体分析真跑通：导图渲染出 ≥6 个节点');
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
    }));
    ok(linkage.mindmapActive, 'F2 点题型卡片后自动切回思维导图 tab');
    ok(linkage.highlights === 1, 'F2 恰好 1 个节点被高亮（实为 ' + linkage.highlights + '）');
    ok(/^n\d+_\d+$/.test(linkage.highlightedId || ''), 'F2 高亮节点带确定性 id（' + linkage.highlightedId + '）');

    // 10) 概览页截断/来源信息（F6）可见
    await page.click('.tab[data-tab="summary"]'); await sleep(120);
    const metaText = await page.$eval('#statsBox', (e) => e.textContent || '');
    ok(/全书 \d+ 字/.test(metaText), 'F6 概览显示全书字数来源信息');

    await page.click('.tab[data-tab="mindmap"]'); await sleep(120);
    await page.screenshot({ path: path.join(SHOTS, label.replace(/[^a-zA-Z0-9]/g, '-') + '.png'), fullPage: true });

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
