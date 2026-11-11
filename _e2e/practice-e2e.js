'use strict';
// 学习闭环 · 真实入口验收（2026-11-11）。
// Oracle Gate (c)：单测绿 ≠ 用户点得到。本脚本用真 Chromium 打开默认入口 core.html，
// 起本地 mock LLM 真发一次整体分析（不烧真 key），再真点击「练习」tab 走完整闭环：
//   载入练习 → 断言答案未下发（网络层硬证据）→ 选 B 提交判对 → 下一题选 C 判错
//   → 今日复习捞回错题 → 四档自评 → 零 JS 报错 → 浅/深真截图。
//
// 用法：node _e2e/practice-e2e.js
const { chromium } = require('playwright-core');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5212;
const MOCK_PORT = 5213;
const MOCK_BASE = 'http://127.0.0.1:' + MOCK_PORT + '/v1';
const BASE = 'http://127.0.0.1:' + PORT;
const SHOTS = path.join(__dirname, 'shots', 'practice-e2e');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 4 道题覆盖：选择题×2 / 判断题×1 / 简答题×1。answer 严格按 analyze.js:86 的
// 「字母 + 内容 + 理由」整句契约，才能证明判分不是字符串相等。
const PAYLOAD = {
  outline: {
    title: '练习闭环验证全书',
    children: [{ title: '第一章 线性表', children: [
      { title: '1.1 顺序表', desc: '连续存储', questionTypes: ['选择题', '判断题'], children: [] },
      { title: '1.2 链表', desc: '链式存储', questionTypes: ['简答题'], children: [] }
    ] }]
  },
  questionIndex: [
    { type: '选择题', items: [{ title: '复杂度计算类', path: ['第一章 线性表', '1.1 顺序表'], questions: [
      { stem: '长为 10 的顺序表，在第 3 个位置插入元素，需要移动多少个元素？',
        options: ['A. 7 个', 'B. 8 个', 'C. 9 个', 'D. 10 个'],
        answer: 'B. 8 个 —— 插入位置 i=3，需移动 n-i+1 = 10-3+1 = 8 个元素。',
        solution: ['第 1 步：确定 n=10、i=3。', '第 2 步：套用移动次数公式 n-i+1。', '第 3 步：10-3+1=8。'],
        rationale: '题干问的是固定位置的精确移动次数，不是等概率平均值，所以要用 n-i+1 而非 n/2；先辨认问的是精确值还是期望值，再选公式。',
        pitfalls: '把 n-i+1 与 n/2 混淆。', difficulty: '基础',
        pointPath: ['第一章 线性表', '1.1 顺序表'],
        source: { file: '验证讲义.txt', page: 2, anchor: '【块1】', quote: '顺序表插入需移动元素' } },
      { stem: '顺序表按下标查找第 i 个元素的时间复杂度是？',
        options: ['A. O(1)', 'B. O(n)', 'C. O(log n)'],
        answer: 'A. O(1) —— 连续存储可由首地址加下标直接算出地址。',
        solution: ['第 1 步：顺序表地址连续。', '第 2 步：一次计算即可。'],
        rationale: '看到「按下标」就要想到随机访问能力，这是顺序存储区别于链式存储的根本特征；若误判成需要遍历，是把两者记反了。',
        pitfalls: '', difficulty: '基础', pointPath: ['第一章 线性表', '1.1 顺序表'],
        source: { file: '验证讲义.txt', page: 2, anchor: '【块1】', quote: '顺序表支持随机访问' } }
    ] }] },
    { type: '判断题', items: [{ title: '概念辨析类', path: ['第一章 线性表', '1.1 顺序表'], questions: [
      { stem: '单链表删除已知结点指针 p 本身的时间复杂度是 O(1)。',
        options: ['A. 正确', 'B. 错误'],
        answer: 'B. 错误 —— 单链表没有前驱指针，删除 p 需要从头找到前驱结点，故 O(n)。',
        solution: ['第 1 步：删除 p 要改前驱的 next。', '第 2 步：单链表没有前驱指针，只能遍历。'],
        rationale: '切入点在于单链表只有后继指针这一结构约束；先判断操作需要哪些结点的指针，再看这些指针能否直接获得。',
        pitfalls: '误以为删除 p 也能 O(1)。', difficulty: '进阶',
        pointPath: ['第一章 线性表', '1.1 顺序表'],
        source: { file: '验证讲义.txt', page: 3, anchor: '【块2】', quote: '删除结点需找前驱' } }
    ] }] },
    { type: '简答题', items: [{ title: '原理解释类', path: ['第一章 线性表', '1.2 链表'], questions: [
      { stem: '简述顺序表与链表在插入删除上的代价差异及其根因。',
        options: [],
        answer: '顺序表插入删除需移动元素 O(n)，链表改指针 O(1) 但查找前驱仍需 O(n)。',
        solution: ['第 1 步：顺序表物理连续，插入要腾位置。', '第 2 步：链表靠指针串联，只改局部指针。'],
        rationale: '根因在存储是否连续；不要把「改指针 O(1)」偷换成「删除操作整体 O(1)」，因为还要找前驱。',
        pitfalls: '忽略找前驱的代价。', difficulty: '进阶',
        pointPath: ['第一章 线性表', '1.2 链表'],
        source: { file: '验证讲义.txt', page: 4, anchor: '【块3】', quote: '两种存储代价不同' } }
    ] }] }
  ],
  summary: '顺序表与链表的存储结构及插入删除代价对比。'
};

// 真实长度语料（≥ MIN_TEXT=80），否则 F5 会先拦下，测不到分析链路。
const FIXTURE_TEXT = [
  '第一章 线性表。顺序表采用连续内存，支持随机访问，按下标查找为 O(1)；插入删除需要移动元素。',
  '第二章 链表。单链表靠指针串联，插入改指针为 O(1)，但删除已知结点仍需从头找前驱，代价 O(n)。',
  '第三章 复杂度对比。固定位置插入的移动次数为 n-i+1，不是等概率平均的 n/2，二者不可混淆。',
  '第四章 典型例题。包含顺序表插入元素个数计算、判断题辨析与简答题原理解释。'
].join('\n');

let passed = 0, failed = 0;
function ok(cond, msg, extra) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg + (extra ? '  [' + extra + ']' : '')); }
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-e2e-'));
  const mockLlm = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json'); res.writeHead(200);
      if (/\/models$/.test(req.url || '')) res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      else res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(PAYLOAD) } }] }));
    });
  });
  await new Promise(r => mockLlm.listen(MOCK_PORT, '127.0.0.1', r));

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), LIBRARY_ROOT: TMP, NO_OPEN: '1' }),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let srvErr = ''; server.stderr.on('data', d => { srvErr += String(d); });
  let browser = null;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(BASE + '/core.html'); if (r.ok) { ready = true; break; } } catch (e) {}
      await sleep(200);
    }
    if (!ready) throw new Error('server 未就绪：' + srvErr.slice(0, 300));

    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('dialog', d => d.accept('练习闭环验证书'));

    // 硬证据：截获 /practice/quiz 的真实网络响应，检查有没有把答案下发到浏览器。
    const quizBodies = [];
    page.on('response', async r => {
      if (/\/practice\/quiz/.test(r.url())) {
        try { quizBodies.push(await r.text()); } catch (e) {}
      }
    });

    await page.goto(BASE + '/core.html', { waitUntil: 'load' });
    await page.waitForSelector('#newBookBtn'); await sleep(250);

    // 1) 配置 mock LLM → 建书 → 导入资料 → 真跑一次整体分析
    await page.click('#openSettings'); await sleep(120);
    await page.fill('#cfgBase', MOCK_BASE);
    await page.fill('#cfgModel', 'mock-model');
    await page.fill('#cfgKey', 'test-key');
    await page.click('#saveSettings'); await sleep(120);
    ok((await page.evaluate(() => localStorage.getItem('core_llm_cfg') || '')).includes('mock-model'),
      '模型配置已保存到 localStorage');

    await page.click('#newBookBtn'); await sleep(300);
    ok((await page.$$eval('#bookList li', els => els.length)) >= 1, '真建出一本书');
    await page.setInputFiles('#fileInput', {
      name: '验证讲义.txt', mimeType: 'text/plain', buffer: Buffer.from(FIXTURE_TEXT)
    });
    await sleep(500);
    ok((await page.$$eval('#fileList li', els => els.length)) >= 1, '真导入一份资料');

    await page.click('#analyzeBtn');
    let analyzed = false;
    for (let i = 0; i < 60; i++) {
      if (await page.$eval('#resultArea', e => !e.classList.contains('hidden')).catch(() => false)) { analyzed = true; break; }
      await sleep(250);
    }
    ok(analyzed, '整体分析真跑通（mock LLM 真发 HTTP → 真解析 → 真渲染）');

    // 2) 切到「练习」tab：答案必须没有下发
    await page.click('.tab[data-tab="practice"]'); await sleep(600);
    ok(await page.$eval('#tab-practice', e => e.classList.contains('active')), '练习 tab 可点开');
    const stemVisible = await page.$eval('#practiceBox', e => e.textContent || '');
    ok(stemVisible.includes('长为 10 的顺序表'), '练习首题真渲染出题干');
    // 真截图目视抓到的口径假数据回归锁：「0 可练」却渲染着第 1/4 题。
    const statCells = await page.$$eval('#practiceStats .pstat', els => els.map(e => ({
      num: (e.querySelector('.num') || {}).textContent || '',
      lbl: (e.querySelector('.lbl') || {}).textContent || ''
    })));
    const totalCell = statCells.find(c => c.lbl === '本轮题数');
    ok(!!(totalCell && totalCell.num.trim() === '4'),
      '统计条「本轮题数」= 4，与列表第 N/4 题同口径（不是后端卡片数 0）',
      JSON.stringify(statCells));
    ok(!stemVisible.includes('n-i+1') && !stemVisible.includes('插入位置 i=3'),
      '提交前页面 DOM 里没有答案/解析（真隐藏，不是 CSS 遮挡）');
    ok(quizBodies.length >= 1 && !quizBodies[0].includes('"answer"') && !quizBodies[0].includes('"solution"'),
      '网络层硬证据：/practice/quiz 响应体不含 answer / solution 字段',
      quizBodies.length ? quizBodies[0].slice(0, 120) : 'no quiz response captured');

    // 3) 选 B 提交 → 判对 + 第一次揭晓答案
    await page.click('#practiceBox .practice-opt:nth-child(2)'); await sleep(100);
    ok(await page.$eval('#practiceBox .practice-opt:nth-child(2)', e => e.classList.contains('selected')),
      '选项可点选（B 被选中）');
    await page.click('#btnPracticeSubmit'); await sleep(500);
    const afterRight = await page.$eval('#practiceBox', e => e.textContent || '');
    ok(afterRight.includes('答对了'), '选 B 提交后判「答对了」（整句答案不是字符串相等）');
    ok(afterRight.includes('B. 8 个'), '判分后第一次揭晓答案');
    ok(afterRight.includes('分步解答') && afterRight.includes('解题思路'), '判分后才展示分步解答与解题思路');
    ok((await page.$$eval('#practiceBox .practice-rate', els => els.length)) === 4, '提供四档自评');
    await page.screenshot({ path: path.join(SHOTS, '01-practice-correct.png'), fullPage: true });

    // 4) 下一题选 C（正确答案是 A）→ 判错 + 错题计数 + 到期
    await page.click('#btnPracticeNext'); await sleep(300);
    await page.click('#practiceBox .practice-opt:nth-child(3)'); await sleep(100);
    await page.click('#btnPracticeSubmit'); await sleep(500);
    const afterWrong = await page.$eval('#practiceBox', e => e.textContent || '');
    ok(afterWrong.includes('答错了'), '选 C 提交后判「答错了」');
    ok(afterWrong.includes('A. O(1)'), '错题也揭晓正确答案');
    const statsWrong = await page.$eval('#practiceStats', e => e.textContent || '');
    ok(/错过/.test(statsWrong), '统计条显示「错过」指标');

    // 5) 四档自评真的回写排程
    await page.click('#practiceBox .practice-rate[data-rating="3"]'); await sleep(400);
    ok((await page.$eval('#practiceBox', e => e.textContent || '')).includes('已排下次复习'),
      '自评「会了」后界面显示已排下次复习');

    // 6) 今日复习：把到期题目捞回来（答错的那题 dueAt=当天，必然到期）
    await page.click('#btnPracticeDue'); await sleep(500);
    const dueText = await page.$eval('#practiceBox', e => e.textContent || '');
    const dueStats = await page.$eval('#practiceStats', e => e.textContent || '');
    ok(dueText.includes('第 1 /') || dueText.includes('今天没有到期'),
      '今日复习入口可点，返回到期题目或明确的空状态');
    ok(/今日到期/.test(dueStats), '今日复习统计可见');
    await page.screenshot({ path: path.join(SHOTS, '02-practice-due.png'), fullPage: true });

    // 7) 开放题不假判：走完前 3 题到第 4 题（简答题），提交后应是自评提示
    await page.click('#btnPracticeAll'); await sleep(400);
    let openReached = false;
    // 产品状态机：题目要先作答 → 提交 → 才出现「下一题」。
    // 首版脚本误以为未作答就有下一题按钮，第一步就 break 了（脚本假设错，非产品缺陷）。
    for (let i = 0; i < 4; i++) {
      const t = await page.$eval('#practiceBox', e => e.textContent || '');
      if (t.includes('简述顺序表与链表')) { openReached = true; break; }
      const submit = await page.$('#btnPracticeSubmit');
      if (submit) {
        const ta = await page.$('#practiceText');
        if (ta) await ta.fill('顺序表要移动元素，链表只改指针');
        else await page.click('#practiceBox .practice-opt:nth-child(1)');
        await page.click('#btnPracticeSubmit'); await sleep(350);
      }
      const next = await page.$('#btnPracticeNext');
      if (!next) break;
      await next.click(); await sleep(300);
    }
    if (openReached) {
      const ta = await page.$('#practiceText');
      ok(!!ta, '开放题渲染文本输入框而非选项');
      if (ta) {
        await ta.fill('顺序表连续存储插入要移动元素，链表改指针但要找前驱');
        await page.click('#btnPracticeSubmit'); await sleep(400);
        const openText = await page.$eval('#practiceBox', e => e.textContent || '');
        ok(openText.includes('不冒充机器判分'), '开放题不假判，明确提示按答案自评');
        ok(openText.includes('顺序表插入删除需移动元素'), '开放题揭晓标准答案与解析');
      }
    } else ok(false, '走到第 4 题（开放题）');

    // 8) 深色主题 + 零 JS 报错
    await page.emulateMedia({ colorScheme: 'dark' }); await sleep(350);
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok(darkBg === 'rgb(16, 19, 26)', '深色模式 body 首帧深色（无白闪）', darkBg);
    await page.screenshot({ path: path.join(SHOTS, '03-practice-dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' }); await sleep(150);

    const realErrors = errors.filter(e => !/favicon|net::ERR_FAILED/.test(e));
    ok(realErrors.length === 0, '全程零未捕获 JS 报错' + (realErrors.length ? '：' + realErrors.join(' | ') : ''));
  } catch (e) {
    failed++;
    console.error('  ✗ FATAL: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      else server.kill('SIGKILL');
    } catch (e) { try { server.kill('SIGKILL'); } catch (_) {} }
    try { mockLlm.close(); } catch (e) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n=== 练习闭环真浏览器验收：' + passed + ' 通过 / ' + failed + ' 失败 ===');
  console.log('截图目录：' + SHOTS);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
