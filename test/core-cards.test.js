'use strict';
// cards action 生产端判别（2026-11-22）。
//
// 修的是一个真断链：core/capabilities.js 声明了 {action:'cards', method:'listCards'}，
// driver 也在调 core.listCards()，但 Core.prototype.listCards 不存在，
// app-host 分发直接判 unsupported。判别不读源码冒充能力，全部真调用 + 真落盘。
//
// 用法：node test/core-cards.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { Core } = require(path.join(ROOT, 'core', 'index.js'));
const appHost = require(path.join(ROOT, 'core', 'app-host.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ ' + msg + (extra ? '  [' + extra + ']' : '')); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cards-'));

(async () => {
const core = new Core(TMP);

ok(typeof Core.prototype.listCards === 'function', 'L1 Core 生产端存在 listCards（能力清单不是空头声明）');

const book = core.createBook('题卡判别书');
ok(typeof book.id === 'string' && !!book.id, 'L2 建书成功', book && book.id);

// 没有 cards 目录时必须返回空壳，不报错（老书零迁移）。
const empty = core.listCards(book.id);
ok(empty && Array.isArray(empty.lessons) && empty.lessons.length === 0 && empty.total === 0,
  'L3 无 cards 目录 → 空列表而不是崩溃', JSON.stringify(empty));

const dir = path.join(TMP, 'books', book.id, 'cards');
fs.mkdirSync(dir, { recursive: true });
const lesson = (n, kpCount, cardCount) => ({
  book: book.id, lesson: n, seq: n + 2, title: '第' + n + '讲', date: '2026-10-01', block: '静力学',
  generatedAt: '2026-11-22T10:00:00.000Z',
  knowledgePoints: Array.from({ length: kpCount }, (_, i) => ({
    id: 'kp-' + n + '-' + i, name: '知识点' + i,
    cards: Array.from({ length: cardCount }, (_, j) => ({ id: 'c-' + n + '-' + i + '-' + j, stem: '题' + j })),
  })),
});
fs.writeFileSync(path.join(dir, 'lesson-02.json'), JSON.stringify(lesson(2, 3, 4)), 'utf8');
fs.writeFileSync(path.join(dir, 'lesson-01.json'), JSON.stringify(lesson(1, 2, 5)), 'utf8');
// failed.json 是失败台账，不是题卡；不该混进 lessons。
fs.writeFileSync(path.join(dir, 'failed.json'), JSON.stringify([{ lesson: 9, error: '批次语料为空' }]), 'utf8');
// 文件名白名单：lesson-x.json 不是合法讲次，必须忽略。
fs.writeFileSync(path.join(dir, 'lesson-x.json'), JSON.stringify(lesson(99, 1, 1)), 'utf8');

const r = core.listCards(book.id);
ok(Array.isArray(r.lessons) && r.lessons.length === 2, 'L4 只收合法 lesson-NN.json（跳过 failed 与非数字讲次）', JSON.stringify(r.lessons.map(x => x.file)));
ok(r.total === 22, 'L5 total = 各节题数之和（lesson-01: 2×5=10，lesson-02: 3×4=12）', 'total=' + r.total);
ok(r.lessons[0].lesson === 1 && r.lessons[1].lesson === 2, 'L6 按讲次排序', JSON.stringify(r.lessons.map(x => x.lesson)));
ok(r.lessons[0].seq === 3 && r.lessons[0].title === '第1讲' && r.lessons[0].block === '静力学',
  'L7 元信息从文件里带出（seq/title/block）');

// 坏文件不能拖垮整批，但必须显式标注（不静默吞）。
fs.writeFileSync(path.join(dir, 'lesson-03.json'), '{坏 JSON', 'utf8');
const withBad = core.listCards(book.id);
ok(withBad.lessons.some(x => x.file === 'lesson-03.json' && /解析失败/.test(x.error || '')),
  'L8 坏卡文件单列 error，不拖垮其它讲次');
ok(withBad.total === r.total, 'L9 坏文件不污染 total', withBad.total + ' / ' + r.total);

// 真链路：app-host 按能力清单分发，不能只靠直接调 Core。
const viaHost = await appHost.invoke(core, 'cards', { bookId: book.id }, {});
ok(viaHost && viaHost.ok === true && viaHost.data && viaHost.data.total === r.total,
  'L10 app-host 真分发 cards action 成功（不是 unsupported）', JSON.stringify(viaHost).slice(0, 160));
let threw = false;
try { core.listCards('不存在的书'); } catch (e) { threw = true; }
ok(threw, 'L11 书不存在时报错，不返回空壳骗调用方');

// 2026-11-23 扩：作业卡同口聚合（kind=assignment，lessonNo=100+seq 排在讲卡之后）。
fs.writeFileSync(path.join(dir, 'assignment-101.json'), JSON.stringify(lesson(101, 2, 3)), 'utf8');
const withHw = core.listCards(book.id);
const hwEntry = withHw.lessons.find(x => x.file === 'assignment-101.json');
ok(hwEntry && hwEntry.kind === 'assignment', 'L12 作业卡进聚合且 kind=assignment');
ok(withHw.total === 28, 'L13 total = 讲卡22 + 作业卡6（坏文件不计）', 'total=' + withHw.total);
ok(withHw.lessons[withHw.lessons.length - 1].lesson === 101, 'L14 作业卡（101+）排序在讲卡之后', JSON.stringify(withHw.lessons.map(x => x.lesson)));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('  ✗ 判别进程异常：' + (e && e.message || e)); process.exit(1); });
