'use strict';
// 端到端盘点后的两条 P0 判别测试（2026-11-11 续轮）。
//
// 改码前必须先红：本文件针对的是「混放书库误删用户数据」与「重分析后统计条留假数据」。
// 旧版逐条 FAIL 且 exit 1；改好后逐条 PASS 且 exit 0。两份输出成对才算数。
//
// 纪律：全部走真实调用 / 真落盘，不读源码字符串冒充能力。
// 「回归守卫」用 guard()：恒绿、不计入 passed，但一旦失败照样 exit 1（防修坏 core 书本身）。
// 用法：node test/core-gap-fixes.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0, guards = 0;
function ok(cond, msg, extra) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg + (extra ? '  [' + extra + ']' : '')); }
}
function guard(cond, msg, extra) {
  if (cond) { guards++; console.log('  · guard ✓ ' + msg); }
  else { failed++; console.error('  ✗ guard ' + msg + (extra ? '  [' + extra + ']' : '')); }
}
function safe(fn) { try { return fn(); } catch (e) { return { __err: (e && e.message) || String(e) }; } }

// 符合 core/analyze.js normalizeQuestion 的最小真实题目结构。
// answer 必须是「字母 + 内容 + 理由」整句（analyze.js:86 硬契约），否则身份哈希测不出重分析换 key。
function makeAnalysis(stem, answer) {
  return {
    tree: { id: 'n0', type: 'root', title: '判别样本', children: [] },
    questionIndex: [{ type: '选择题', items: [{ title: '计算类', path: ['第一章'], pointId: 'n1', questions: [
      { id: 'q1', stem, options: ['A. 1', 'B. 2'], answer,
        solution: ['一步'], rationale: '思路', pitfalls: '', difficulty: '基础',
        pointPath: ['第一章'], source: { file: '讲义.txt', page: 1 } }
    ] }] }],
    summary: '', stats: {}
  };
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'core-gap-fixes-'));
  const { Core } = require(path.join(ROOT, 'core', 'index.js'));
  const { Store } = require(path.join(ROOT, 'lib', 'store.js'));
  const practiceLib = require(path.join(ROOT, 'core', 'practice.js'));
  console.log('=== 两条 P0 判别测试（旧版应全红）===');

  // ---------- J1：混放书库不得误列 / 误删旧版书 ----------
  // 用真实的 lib/store.js 造旧版书（不是手写伪造目录），保证格式与用户数据一致。
  console.log('-- J1 混放书库（同一 books/ 目录两套 schema）--');
  const legacyStore = new Store(TMP);
  const lb = legacyStore.createBook({ title: '旧版·高等数学' });
  const legacyId = lb.id;
  const legacyDir = path.join(TMP, 'books', legacyId);
  fs.mkdirSync(path.join(legacyDir, 'layer_1'), { recursive: true });
  const realFile = path.join(legacyDir, 'layer_1', 'a.pdf');
  fs.writeFileSync(realFile, 'REAL_USER_DATA');

  const c = new Core(TMP);
  const nb = c.createBook('新版·线性代数');
  const list = safe(() => c.listBooks());
  const ids = Array.isArray(list) ? list.map(b => b.id) : [];

  ok(Array.isArray(list) && !ids.includes(legacyId),
    'J1a core.listBooks() 不把旧版书列成空壳', JSON.stringify(ids));
  const gb = safe(() => c.getBook(legacyId));
  ok(gb === null, 'J1b core.getBook(旧版id) 返回 null（不再把 legacy book.json 当自己的书）',
    JSON.stringify(gb));
  const del = safe(() => c.deleteBook(legacyId));
  ok(del === false || !!(del && del.__err),
    'J1c 删除旧版书被明确拒绝（不静默 rmSync）', JSON.stringify(del));
  ok(fs.existsSync(realFile), 'J1d 旧书里的真实资料未被删除');

  guard(ids.includes(nb.id), 'J1g1 core 书仍正常出现在书架');
  guard(legacyStore.listBooks().some(b => b.id === legacyId), 'J1g2 旧版书架仍能看到自己的书');
  guard(!!safe(() => c.getBook(nb.id)), 'J1g3 core 书 getBook 正常');
  guard(safe(() => c.deleteBook(nb.id)) === true, 'J1g4 core 书删除仍正常（未被守卫误伤）');

  // ---------- J2：重分析后统计与列表同源 ----------
  console.log('-- J2 重分析后统计条不得残留旧卡 --');
  const b2 = c.createBook('重分析统计验证');
  const af = path.join(TMP, 'books', b2.id, 'analysis.json');
  const NOW = Date.now() + 30 * 86400000; // 注入 30 天后，让所有卡都到期，判据不依赖真实时间
  fs.writeFileSync(af, JSON.stringify(makeAnalysis('第一版：1+1=?', 'B. 2 —— 因为 1+1=2（V1）')));
  const quiz1 = c.getQuiz(b2.id);
  const key1 = quiz1.questions[0].key;
  safe(() => c.submitAttempt(b2.id, { key: key1, given: 'A' }));

  guard(c.getDue(b2.id, { now: NOW }).questions.length >= 1, 'J2g1 未重分析时到期题能列出来');
  guard(c.getQuiz(b2.id).summary.total >= 1, 'J2g2 未重分析时统计条有卡');

  // 模拟用户点「重新分析」：题目内容变了 → 内容哈希 key 变，旧卡不再匹配任何当前题。
  fs.writeFileSync(af, JSON.stringify(makeAnalysis('第二版：2+2=?', 'B. 4 —— 因为 2+2=4（V2）')));
  const due = c.getDue(b2.id, { now: NOW });
  const quiz = c.getQuiz(b2.id);

  ok(due.dueCount === due.questions.length,
    'J2a 到期数与到期列表长度同源（不再显示「今日到期 N」却列不出题）',
    'dueCount=' + due.dueCount + ' questions=' + due.questions.length);
  ok(due.dueCount === 0, 'J2b 重分析后不残留上一轮的到期卡', 'dueCount=' + due.dueCount);
  ok(quiz.summary.total === 0, 'J2c 统计条不把失配旧卡算进当前进度', 'total=' + quiz.summary.total);
  ok(quiz.summary.dueCount === due.questions.length,
    'J2d getQuiz 的 summary 与 getDue 列表同源',
    'summary.dueCount=' + quiz.summary.dueCount + ' questions=' + due.questions.length);

  guard(Object.keys(c.getPractice(b2.id).cards).length >= 1,
    'J2g3 旧卡保留为历史未删用户数据（零迁移）');
  const bare = safe(() => practiceLib.dueKeys(c.getPractice(b2.id), NOW));
  guard(Array.isArray(bare) && bare.length >= 1,
    'J2g4 dueKeys(state, now) 不传第三参行为不变（向后兼容）', JSON.stringify(bare));

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log('\n=== 能力判据：' + passed + ' 通过 / ' + failed + ' 失败 | 回归守卫 ' + guards + ' 恒绿 ===');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
