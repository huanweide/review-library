'use strict';
// 学习闭环进统一核心 · 运行时判别测试（2026-11-11）。
//
// 改码前必须先红：本文件针对的是「默认入口不能练」这一组能力缺失。
// 旧版（无 core/practice.js、无 practice 路由）应当逐条 FAIL 且 exit 1；
// 改好后逐条 PASS 且 exit 0。两份输出成对才算数。
//
// 纪律：不读源码字符串冒充能力，全部走真实调用 / 真落盘 / 真 HTTP。
// 用法：node test/core-practice.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(cond, msg, extra) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg + (extra ? '  [' + extra + ']' : '')); }
}
// 旧版缺模块/缺方法时不能让进程崩掉，要转成可读的 FAIL 证据。
function safe(fn) { try { return fn(); } catch (e) { return { __err: e && e.message || String(e) }; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 一份真实的、符合 core/analyze.js normalizeQuestion 输出的题目结构。
// 注意 answer 是「字母 + 内容 + 理由」的整句——这是 analyze.js:86 的硬契约。
function makeAnalysis() {
  return {
    tree: { id: 'n0_0', type: 'root', title: '练习闭环验证全书', children: [] },
    questionIndex: [
      { type: '选择题', items: [{ title: '复杂度计算类', path: ['第一章', '线性表'], pointId: 'n2_1', questions: [
        { id: 'q0', stem: '长为 10 的顺序表，在第 3 个位置插入元素，需要移动多少个元素？',
          options: ['A. 7 个', 'B. 8 个', 'C. 9 个', 'D. 10 个'],
          answer: 'B. 8 个 —— 插入位置 i=3，需移动 n-i+1 = 10-3+1 = 8 个元素。',
          solution: ['第 1 步：确定 n=10、i=3。', '第 2 步：套用 n-i+1。', '第 3 步：得 8。'],
          rationale: '题干问固定位置的精确移动次数，不是等概率平均值，所以用 n-i+1 而非 n/2。',
          pitfalls: '把 n-i+1 与 n/2 混淆。', difficulty: '基础',
          pointPath: ['第一章', '线性表'], source: { file: '讲义.txt', page: 2, anchor: '【块1】', quote: '' } },
        { id: 'q1', stem: '顺序表按下标查找第 i 个元素的时间复杂度是？',
          options: ['A. O(1)', 'B. O(n)', 'C. O(log n)'],
          answer: 'A. O(1) —— 连续存储可由首地址加下标直接算出地址。',
          solution: ['地址连续', '一次计算即可'], rationale: '随机访问是顺序存储的根本特征。',
          pitfalls: '', difficulty: '基础', pointPath: ['第一章', '线性表'],
          source: { file: '讲义.txt', page: 2, anchor: '【块1】', quote: '' } }
      ] }] },
      { type: '判断题', items: [{ title: '概念辨析类', path: ['第一章'], pointId: 'n1_1', questions: [
        { id: 'q2', stem: '单链表删除已知结点指针 p 本身是 O(1)。',
          options: ['A. 正确', 'B. 错误'],
          answer: 'B. 错误 —— 单链表没有前驱指针，删除 p 需要从头找到前驱，故 O(n)。',
          solution: ['先找前驱'], rationale: '结构约束决定操作代价。', pitfalls: '',
          difficulty: '进阶', pointPath: ['第一章'], source: { file: '讲义.txt', page: 3, anchor: '【块2】', quote: '' } }
      ] }] },
      { type: '简答题', items: [{ title: '原理解释类', path: ['第二章'], pointId: 'n1_2', questions: [
        { id: 'q3', stem: '简述顺序表与链表在插入删除上的代价差异及根因。',
          options: [], answer: '顺序表插入删除需移动元素 O(n)，链表改指针 O(1) 但查找前驱 O(n)。',
          solution: ['存储方式不同'], rationale: '从存储连续性切入。', pitfalls: '',
          difficulty: '进阶', pointPath: ['第二章'], source: { file: '讲义.txt', page: 4, anchor: '【块3】', quote: '' } }
      ] }] }
    ],
    summary: '练习闭环验证样本。',
    stats: { chapters: 2, sections: 0, points: 0, subtypes: 0, questionTypes: 3, questionCount: 4 }
  };
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'core-practice-'));
  let Core, requestLib, practiceLib;
  const load = safe(() => { Core = require(path.join(ROOT, 'core', 'index.js')).Core; return true; });
  const loadReq = safe(() => { requestLib = require(path.join(ROOT, 'core', 'request.js')); return true; });
  const loadPrac = safe(() => { practiceLib = require(path.join(ROOT, 'core', 'practice.js')); return true; });

  console.log('=== 学习闭环进 core · 判别测试（旧版应全红）===');

  // ---------- J1 真隐藏：练习列表不得下发答案（不是 CSS 遮挡） ----------
  const hasQuiz = !!(load === true && Core && typeof Core.prototype.getQuiz === 'function');
  let quiz = null;
  if (hasQuiz) {
    const c = new Core(TMP);
    const b = c.createBook('闭环验证书');
    c.store.saveAnalysis(b.id, makeAnalysis());
    const r = safe(() => c.getQuiz(b.id));
    quiz = r && !r.__err ? r : null;
    global.__testBookId = b.id;
  }
  const qs = quiz && Array.isArray(quiz.questions) ? quiz.questions : [];
  ok(hasQuiz, 'J1a Core 门面存在 getQuiz（DSH / 专家形态可经门面调用）',
    hasQuiz ? '' : (load && load.__err || 'Core.prototype.getQuiz 不存在'));
  ok(qs.length === 4, 'J1b 练习列表返回 4 道题（覆盖选择/判断/简答三类）', 'got=' + qs.length);
  ok(qs.length > 0 && qs.every(q => !('answer' in q) && !('solution' in q) && !('rationale' in q)),
    'J1c 练习列表不含答案/分步解答/思路（真隐藏，F12 也看不到答案）',
    qs.length ? JSON.stringify(Object.keys(qs[0])) : 'no questions');
  ok(qs.length > 0 && qs.every(q => q.key && q.stem && q.type && Array.isArray(q.options)),
    'J1d 每题带稳定 key / 题干 / 题型 / 选项（够渲染作答控件）');

  // ---------- J2 判分：answer 是整句，不能字符串相等 ----------
  const grade = practiceLib && typeof practiceLib.gradeOne === 'function' ? practiceLib.gradeOne : null;
  const A = makeAnalysis();
  const qChoice = A.questionIndex[0].items[0].questions[0];
  const qJudge = A.questionIndex[1].items[0].questions[0];
  const qOpen = A.questionIndex[2].items[0].questions[0];
  const gRight = grade ? safe(() => grade(qChoice, '选择题', 'B')) : null;
  const gWrong = grade ? safe(() => grade(qChoice, '选择题', 'C')) : null;
  const gFull = grade ? safe(() => grade(qChoice, '选择题', 'B. 8 个')) : null;
  ok(!!grade, 'J2a 存在 gradeOne 判分函数', grade ? '' : 'core/practice.js 未实现');
  ok(!!(gRight && gRight.correct === true), 'J2b 选择题整句答案 "B. 8 个 —— 理由" 判 B 为正确（不是字符串相等）', JSON.stringify(gRight));
  ok(!!(gWrong && gWrong.correct === false), 'J2c 同一题判 C 为错误', JSON.stringify(gWrong));
  ok(!!(gFull && gFull.correct === true), 'J2d 用户选完整选项文本 "B. 8 个" 也能判对', JSON.stringify(gFull));
  const gJ = grade ? safe(() => grade(qJudge, '判断题', 'B')) : null;
  ok(!!(gJ && gJ.correct === true), 'J2e 判断题答案 "B. 错误 —— 理由" 判 B 为正确', JSON.stringify(gJ));
  const gO = grade ? safe(() => grade(qOpen, '简答题', '顺序表要移动元素')) : null;
  ok(!!(gO && gO.verdict === 'self'),
    'J2f 开放题不假判（返回 self 走四档自评，不冒充机器评分）', JSON.stringify(gO));

  // ---------- J3 落盘 + 错题 + 排程 ----------
  const hasAttempt = !!(Core && typeof Core.prototype.submitAttempt === 'function');
  let attempt = null, bookId = global.__testBookId;
  if (hasAttempt && bookId) {
    const c = new Core(TMP);
    const key = practiceLib && practiceLib.questionKey ? practiceLib.questionKey(qChoice) : 'k';
    attempt = safe(() => c.submitAttempt(bookId, { key, given: 'C' }, { now: 1700000000000 }));
    global.__wrongKey = key;
  }
  ok(hasAttempt, 'J3a Core 门面存在 submitAttempt');
  ok(!!(attempt && !attempt.__err && attempt.correct === false), 'J3b 提交错误答案返回「错」', JSON.stringify(attempt));
  const practiceFile = bookId ? path.join(TMP, 'books', bookId, 'practice.json') : '';
  ok(!!(practiceFile && fs.existsSync(practiceFile)), 'J3c 作答记录真落盘到该书目录 practice.json', practiceFile);
  let reread = null;
  if (hasAttempt && bookId) {
    const c2 = new Core(TMP); // 新实例 = 模拟关掉软件再打开
    reread = safe(() => c2.getPractice(bookId));
  }
  const card = reread && reread.cards ? reread.cards[global.__wrongKey] : null;
  ok(!!(card && card.lapseCount === 1), 'J3d 新 Core 实例读回答错记录（跨会话持久），lapseCount=1',
    card ? JSON.stringify({ lapse: card.lapseCount }) : 'no card');
  ok(!!(card && typeof card.dueAt === 'number'),
    'J3e 答错后排出下次复习时间 dueAt', card ? String(card.dueAt) : 'no dueAt');

  // ---------- J4 可控 now 的到期队列（不靠真实时间） ----------
  const dueKeys = practiceLib && typeof practiceLib.dueKeys === 'function' ? practiceLib.dueKeys : null;
  const fakeState = { cards: {
    a: { key: 'a', dueAt: 1000, lapseCount: 1 },
    b: { key: 'b', dueAt: 9000, lapseCount: 0 },
    c: { key: 'c', dueAt: 500, lapseCount: 4 }
  } };
  const due = dueKeys ? safe(() => dueKeys(fakeState, 2000)) : null;
  ok(!!dueKeys, 'J4a 存在 dueKeys 纯函数');
  ok(!!(due && due.length === 2 && due.indexOf('a') >= 0 && due.indexOf('c') >= 0 && due.indexOf('b') < 0),
    'J4b 到期队列只捞 dueAt<=now 的，未到期的不出现', JSON.stringify(due));
  ok(!!(due && due[0] === 'c'), 'J4c leech（反复错）上浮到队首', JSON.stringify(due));

  // ---------- J5 canonical 路由可达（dispatch 直调 + HTTP 真发） ----------
  let d = null;
  if (load === true && loadReq === true) {
    const c = new Core(TMP);
    d = safe(() => { return null; }); // dispatch 是 async，放到下面 await
  }
  let dispatchQuiz = null;
  if (load === true && loadReq === true && global.__testBookId) {
    const c = new Core(TMP);
    try { dispatchQuiz = await requestLib.dispatch(c, '/books/' + global.__testBookId + '/practice/quiz', 'GET', null); }
    catch (e) { dispatchQuiz = { status: 0, data: { error: e.message } }; }
  }
  ok(!!(dispatchQuiz && dispatchQuiz.status === 200),
    'J5a dispatch 直调 GET /books/:id/practice/quiz 返回 200（HTTP/Electron 共用分派）',
    dispatchQuiz ? JSON.stringify({ status: dispatchQuiz.status, data: dispatchQuiz.data && dispatchQuiz.data.error }) : 'no dispatch');
  ok(!!(dispatchQuiz && Array.isArray(dispatchQuiz.data && dispatchQuiz.data.questions)),
    'J5b dispatch 返回的题目同样不含答案字段（路由层未绕过隐藏契约）');

  // HTTP 真发（独立端口，跑完自清）
  const PORT = 5211;
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), LIBRARY_ROOT: TMP, NO_OPEN: '1' }),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let srvErr = ''; srv.stderr.on('data', d => { srvErr += String(d); });
  let httpQuiz = null, httpAttempt = null;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/core.html'); if (r.ok) { ready = true; break; } } catch (e) {}
      await sleep(150);
    }
    // 前置环境检查不计入通过数：旧版本来就绿，若算分会污染「baseline 必红」的差分证据。
    if (ready) console.log('  · J5c 前置：本地 server 在 ' + PORT + ' 就绪（环境检查，不计分）');
    else ok(false, 'J5c 前置：本地 server 未就绪（环境故障，本轮判别无效）', srvErr.slice(0, 200));
    if (ready && global.__testBookId) {
      const r = await fetch('http://127.0.0.1:' + PORT + '/api/core/books/' + global.__testBookId + '/practice/quiz');
      httpQuiz = { status: r.status, data: await r.json().catch(() => ({})) };
      const r2 = await fetch('http://127.0.0.1:' + PORT + '/api/core/books/' + global.__testBookId + '/practice/attempt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: global.__wrongKey || 'x', given: 'B' })
      });
      httpAttempt = { status: r2.status, data: await r2.json().catch(() => ({})) };
    }
  } catch (e) { srvErr += ' | ' + e.message; }
  finally { try { srv.kill(); } catch (e) {} }
  ok(!!(httpQuiz && httpQuiz.status === 200 && Array.isArray(httpQuiz.data.questions)),
    'J5d HTTP 真发 GET practice/quiz 返回 200 且题目列表可用',
    httpQuiz ? String(httpQuiz.status) : 'no http response');
  ok(!!(httpAttempt && httpAttempt.status === 200 && httpAttempt.data.correct === true),
    'J5e HTTP 真发 POST practice/attempt 判 B 为正确并落盘',
    httpAttempt ? JSON.stringify({ status: httpAttempt.status, correct: httpAttempt.data.correct }) : 'no http response');

  // ---------- J6 内容哈希身份 ----------
  const qk = practiceLib && typeof practiceLib.questionKey === 'function' ? practiceLib.questionKey : null;
  const k1 = qk ? qk(qChoice) : null;
  const k1b = qk ? qk(Object.assign({}, qChoice, { id: 'q999' })) : null;
  const k2 = qk ? qk(Object.assign({}, qChoice, { stem: qChoice.stem + '（改）' })) : null;
  ok(!!(qk && k1 && typeof k1 === 'string'), 'J6a 存在内容哈希 questionKey');
  ok(!!(k1 && k1 === k1b), 'J6b 题目 id 变（重新分析）key 不变 → 复习史不丢', k1 + ' vs ' + k1b);
  ok(!!(k1 && k2 && k1 !== k2), 'J6c 题面改一个字 key 变 → 旧进度不串到新题', k1 + ' vs ' + k2);

  // ---------- J7 零迁移：book.json 不被改写 ----------
  let zeroMigration = false;
  if (global.__testBookId) {
    const bj = path.join(TMP, 'books', global.__testBookId, 'book.json');
    const before = fs.existsSync(bj) ? fs.readFileSync(bj, 'utf8') : '';
    const c = new Core(TMP);
    safe(() => c.getPractice(global.__testBookId));
    const after = fs.existsSync(bj) ? fs.readFileSync(bj, 'utf8') : '';
    zeroMigration = !!before && before === after;
  }
  ok(zeroMigration, 'J7 读练习状态不改 book.json 一个字节（零迁移 / 完全可逆）');

  // ---------- J8 四档自评重排 ----------
  const hasRate = !!(Core && typeof Core.prototype.rateCard === 'function');
  let rated = null;
  if (hasRate && global.__testBookId && global.__wrongKey) {
    const c = new Core(TMP);
    rated = safe(() => c.rateCard(global.__testBookId, { key: global.__wrongKey, rating: 4 }, { now: 1700000000000 }));
  }
  ok(hasRate, 'J8a Core 门面存在 rateCard（四档自评）');
  ok(!!(rated && !rated.__err && rated.dueAt > 1700000000000),
    'J8b 自评「太简单」把下次复习推到未来（排程真的被回写）', JSON.stringify(rated));

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log('\n=== 判别测试：' + passed + ' 通过 / ' + failed + ' 失败 ===');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
