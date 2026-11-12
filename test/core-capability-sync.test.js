'use strict';
// 后端革命 · 端到端入口同步 · 跨入口契约测试（2026-11-12）。
//
// 纪律：不读源码字符串冒充能力，全部走真实调用 / 真落盘 / 真子进程 / 真 ESM 插件加载。
// 同一份临时书库，分别经 ①core/request.js dispatch（HTTP/Electron 路径）
// ②plugins/review-analysis/bin/driver.js（CLI/专家形态）③plugins/dsh-review-analysis（DSH 插件）
// 跑同一组 practice 用例，断言三入口能力集合一致、数据同源。
//
// baseline：现有代码（插件 action 白名单未同步）必须逐条 FAIL 且 exit 1。
// 用法：node test/core-capability-sync.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-sync-'));
const DRIVER = path.join(ROOT, 'plugins', 'review-analysis', 'bin', 'driver.js');
const DSH = path.join(ROOT, 'plugins', 'dsh-review-analysis', 'index.js');
const CAPS = path.join(ROOT, 'core', 'capabilities.js');

let passed = 0, failed = 0;
function ok(cond, msg, extra) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg + (extra ? '  [' + extra + ']' : '')); }
}
function safe(fn) { try { return fn(); } catch (e) { return { __err: e && e.message || String(e) }; } }
function parseJson(s) { try { return JSON.parse(String(s || '')); } catch (e) { return { __parseError: true, raw: String(s || '').slice(0, 200) }; } }
function setEq(a, b) {
  const x = Array.from(new Set(a || [])).sort().join(',');
  const y = Array.from(new Set(b || [])).sort().join(',');
  return x === y;
}

// 一份真实、符合 core/analyze.js 题目契约的最小分析产物（选择/判断/简答各一）。
function makeAnalysis() {
  return {
    tree: { id: 'n0_0', type: 'root', title: '入口同步验证全书', children: [] },
    summary: '跨入口契约测试样本',
    stats: { chapters: 1, sections: 0, points: 0, subtypes: 0, questionTypes: 3, questionCount: 3 },
    questionIndex: [
      { type: '选择题', items: [{ title: '复杂度', path: ['第一章'], pointId: 'n1_1', questions: [
        { id: 'q0', stem: '长为 10 的顺序表在第 3 个位置插入，需要移动几个元素？',
          options: ['A. 7 个', 'B. 8 个', 'C. 9 个', 'D. 10 个'],
          answer: 'B. 8 个 —— n-i+1 = 10-3+1 = 8。', solution: ['套 n-i+1'],
          rationale: '固定位置用 n-i+1。', pitfalls: '', difficulty: '基础',
          pointPath: ['第一章'], source: { file: '讲义.txt', page: 1, anchor: '【块1】', quote: '' } }
      ] }] },
      { type: '判断题', items: [{ title: '概念辨析', path: ['第一章'], pointId: 'n1_2', questions: [
        { id: 'q1', stem: '单链表删除已知结点指针 p 本身是 O(1)。',
          options: ['A. 正确', 'B. 错误'], answer: 'B. 错误 —— 需要从头找前驱，O(n)。',
          solution: ['先找前驱'], rationale: '无前驱指针。', pitfalls: '', difficulty: '进阶',
          pointPath: ['第一章'], source: { file: '讲义.txt', page: 2, anchor: '【块2】', quote: '' } }
      ] }] },
      { type: '简答题', items: [{ title: '原理解释', path: ['第二章'], pointId: 'n2_1', questions: [
        { id: 'q2', stem: '简述顺序表与链表插入删除代价差异的根因。', options: [],
          answer: '顺序表需移动元素 O(n)，链表改指针 O(1) 但查找前驱 O(n)。',
          solution: ['存储连续性'], rationale: '连续存储决定移动代价。', pitfalls: '', difficulty: '进阶',
          pointPath: ['第二章'], source: { file: '讲义.txt', page: 3, anchor: '【块3】', quote: '' } }
      ] }] }
    ]
  };
}

const Core = require(path.join(ROOT, 'core', 'index.js')).Core;
const dispatch = require(path.join(ROOT, 'core', 'request.js')).dispatch;
const practiceLib = require(path.join(ROOT, 'core', 'practice.js'));
const core = new Core(TMP);
const book = core.createBook('入口同步验证书');
core.store.saveAnalysis(book.id, makeAnalysis());
const BOOK = book.id;
const QUESTIONS = core.getQuiz(BOOK).questions;
const CHOICE = QUESTIONS.find(q => q.type === '选择题') || QUESTIONS[0];
const PRACTICE_FILE = path.join(TMP, 'books', BOOK, 'practice.json');

// ---------- 入口 1：canonical dispatch（server.js / app/main.js 都走它） ----------
const ROUTE = {
  practice: ['', 'GET'], quiz: ['/quiz', 'GET'], due: ['/due', 'GET'],
  attempt: ['/attempt', 'POST'], rate: ['/rate', 'POST']
};
async function viaDispatch(action, args) {
  const r = ROUTE[action];
  if (!r) return { __err: 'no dispatch route for ' + action };
  const body = action === 'attempt' ? { key: args.key, given: args.given }
    : action === 'rate' ? { key: args.key, rating: args.rating } : {};
  const out = await dispatch(core, '/books/' + BOOK + '/practice' + r[0], r[1], body);
  return out.status === 200 ? out.data : Object.assign({ __err: 'status ' + out.status }, out.data);
}

// ---------- 入口 2：CLI / 专家形态（真起子进程） ----------
function viaCli(action, args) {
  args = args || {};
  const a = [DRIVER, '--project', ROOT, '--library', TMP, '--action', action, '--bookId', BOOK];
  if (args.key) a.push('--key', args.key);
  if (args.given != null) a.push('--given', String(args.given));
  if (args.rating != null) a.push('--rating', String(args.rating));
  const r = cp.spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: parseJson(r.stdout), err: String(r.stderr || '') };
}

// ---------- 入口 3：DSH 插件（真加载 ESM，捕获注册的 tool） ----------
let dshTool = null;
async function loadDsh() {
  const mod = await import(pathToFileURL(DSH).href);
  const ctx = {
    effect: (fn) => { try { return fn(); } catch (e) { return undefined; } },
    tools: { register: (t) => { dshTool = t; } },
    webServer: { register: () => {} },
    get: () => undefined
  };
  mod.apply(ctx, { projectRoot: ROOT, library: TMP });
  return dshTool;
}
async function viaDsh(action, args) {
  if (!dshTool) return { __err: 'DSH tool 未注册' };
  try { return await dshTool.execute(Object.assign({ action, bookId: BOOK }, args || {})); }
  catch (e) { return { __err: e && e.message || String(e) }; }
}

function stateOf(x) {
  const raw = x && x.data !== undefined ? x.data : x;
  if (!raw || raw.__err) return null;
  return practiceLib.normalizeState(raw);
}
function shape(state) {
  if (!state) return '';
  const keys = Object.keys(state.cards || {}).sort();
  return keys.map(k => k + ':' + ((state.cards[k].history || []).length)).join('|');
}

(async () => {
  console.log('=== 后端革命 · 跨入口能力同步契约测试（旧版必红 / 新版必绿）===');

  // ---------- J1 能力清单单一真源 + 漂移守卫 ----------
  const caps = safe(() => require(CAPS));
  const canonical = caps && Array.isArray(caps.ACTIONS) ? caps.ACTIONS.slice() : [];
  ok(canonical.length > 0, 'J1a canonical 能力清单存在且非空（core/capabilities.js）',
    caps && caps.__err ? caps.__err : 'got=' + JSON.stringify(canonical));
  const PRACTICE_ACTIONS = ['practice', 'quiz', 'due', 'attempt', 'rate'];
  ok(PRACTICE_ACTIONS.every(a => canonical.includes(a)),
    'J1b 能力清单含 5 个 practice 动作', 'canonical=' + JSON.stringify(canonical));

  await loadDsh();
  const dshEnum = (dshTool && dshTool.parameters && dshTool.parameters.properties &&
    dshTool.parameters.properties.action && dshTool.parameters.properties.action.enum) || [];
  ok(dshEnum.length > 0 && setEq(dshEnum, canonical),
    'J1c DSH tool 的 action enum 与 canonical 完全一致',
    'dsh=' + JSON.stringify(dshEnum) + ' canonical=' + JSON.stringify(canonical));

  const probe = viaCli('__probe_unsupported__');
  const m = probe.err.match(/可用 ([^\s）)]+)/);
  const cliAvail = m ? m[1].split('/').filter(Boolean) : [];
  ok(cliAvail.length > 0 && setEq(cliAvail, canonical),
    'J1d CLI 可用动作列表与 canonical 完全一致',
    'cli=' + JSON.stringify(cliAvail) + ' canonical=' + JSON.stringify(canonical));

  // ---------- J2 CLI 能跑闭环 ----------
  const cliQuiz = viaCli('quiz', {});
  ok(cliQuiz.code === 0 && cliQuiz.out && cliQuiz.out.ok === true,
    'J2a CLI --action quiz 成功（旧版报「不支持的 action」并 exit 1）',
    'code=' + cliQuiz.code + ' err=' + cliQuiz.err.trim().slice(0, 120));
  const cq = cliQuiz.out && cliQuiz.out.data;
  ok(cq && Array.isArray(cq.questions) && cq.questions.length === 3 &&
    cq.questions.every(q => !('answer' in q) && !('solution' in q)),
    'J2b CLI 练习列表返回 3 题且不含答案（与 canonical 同契约）',
    cq ? 'n=' + (cq.questions || []).length : 'no data');

  // ---------- J3 DSH 能跑闭环 ----------
  const dshDue = await viaDsh('due', {});
  ok(dshDue && dshDue.ok === true && typeof (dshDue.data && dshDue.data.dueCount) === 'number',
    'J3a DSH action=due 成功（旧版返回「不支持的 action」）',
    JSON.stringify(dshDue).slice(0, 180));

  // ---------- J4 三入口数据同源：同一份 practice.json ----------
  const a1 = await viaDispatch('attempt', { key: CHOICE.key, given: 'B' });
  ok(a1 && a1.verdict === 'correct', 'J4a dispatch 提交作答并判分',
    JSON.stringify(a1).slice(0, 160));
  const a2 = viaCli('attempt', { key: CHOICE.key, given: 'B' });
  ok(a2.code === 0 && a2.out && a2.out.ok === true && a2.out.data && a2.out.data.verdict === 'correct',
    'J4b CLI 提交作答并判分', 'code=' + a2.code + ' err=' + a2.err.trim().slice(0, 120));
  const a3 = await viaDsh('attempt', { key: CHOICE.key, given: 'B' });
  ok(a3 && a3.ok === true && a3.data && a3.data.verdict === 'correct',
    'J4c DSH 提交作答并判分', JSON.stringify(a3).slice(0, 180));
  const r3 = await viaDsh('rate', { key: CHOICE.key, rating: 3 });
  ok(r3 && r3.ok === true && r3.data && r3.data.rating === 3,
    'J4d DSH 四档自评成功', JSON.stringify(r3).slice(0, 180));

  const s1 = stateOf(await viaDispatch('practice', {}));
  const s2 = stateOf(viaCli('practice', {}).out);
  const s3 = stateOf(await viaDsh('practice', {}));
  ok(shape(s1) !== '' && shape(s1) === shape(s2) && shape(s1) === shape(s3),
    'J4e 三入口回读同一份过程状态（卡片 key 与历史条数一致）',
    'dispatch=' + shape(s1) + ' cli=' + shape(s2) + ' dsh=' + shape(s3));
  let onDisk = null;
  try { onDisk = practiceLib.normalizeState(JSON.parse(fs.readFileSync(PRACTICE_FILE, 'utf8'))); } catch (e) {}
  ok(onDisk && shape(onDisk) === shape(s1),
    'J4f 磁盘 practice.json 与三入口回读同源（不是各自内存副本）',
    'disk=' + shape(onDisk));

  // ---------- J5 插件只做入口，不复制业务逻辑 ----------
  const driverSrc = fs.readFileSync(DRIVER, 'utf8');
  const dshSrc = fs.readFileSync(DSH, 'utf8');
  [['driver.js', driverSrc], ['dsh/index.js', dshSrc]].forEach(([name, src]) => {
    const leaked = /practiceLib\.|savePractice\(|writeFileSync|writeFile\(/.test(src);
    ok(!leaked, 'J5 ' + name + ' 不含 practiceLib / savePractice / 文件写入（不复制业务逻辑）');
  });

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log('\n=== 跨入口能力同步契约测试：通过 ' + passed + ' / 失败 ' + failed + ' ===');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
