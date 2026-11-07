/**
 * maxloop v0.7 判别测试：复习闭环 + 数据完整性 + 真实入口
 *
 * 纪律：本文件必须先在「旧代码 v0.6.0」上跑红，改完再跑绿，两份输出都留痕。
 * 全程只用临时目录 / 纯内存 / 本机文件，不改项目数据、不发外部请求、不弹浏览器。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS | ' + name); }
  else { fail++; console.log('  FAIL | ' + name + (extra !== undefined ? ' | ' + String(extra).slice(0, 240) : '')); }
};
const tryMod = (rel) => { try { return require(path.join(ROOT, rel)); } catch (e) { return null; } };
const src = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rlv7-'));
const { Store } = require(path.join(ROOT, 'lib/store.js'));
const study = require(path.join(ROOT, 'lib/study.js'));
const analytics = require(path.join(ROOT, 'lib/analytics.js'));
const backup = require(path.join(ROOT, 'lib/backup.js'));

function seedMistake(s, title, pointId, dueAt) {
  const b = s.createBook({ title });
  const dir = path.join(s.root, 'books', b.id, 'study');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mistakes.json'), JSON.stringify([
    { pointId, title: pointId + ' 的定义', lapseCount: 1, correctCount: 0, box: 1,
      history: [{ examId: 'e1', round: 1, verdict: '错误', at: dueAt - 86400000 }],
      lastSeen: dueAt - 86400000, srs: { dueAt, stability: 1, difficulty: 0.3, reps: 1, lapses: 1 } }
  ], null, 2));
  return b.id;
}

console.log('=== maxloop v0.7 判别测试（v0.6.0 旧代码应红）===');

// ---------- V1 反馈五问落盘、读回、进备份 ----------
{
  const d = tmp(); const s = new Store(d);
  const b = s.createBook({ title: '反馈书' });
  ok('V1-1 store 暴露 saveFeedback / listFeedback',
    typeof s.saveFeedback === 'function' && typeof s.listFeedback === 'function');
  if (typeof s.saveFeedback === 'function') {
    s.saveFeedback(b.id, { examId: 'e1', answers: ['卡在相图', '计算慢', '', '', ''] , at: 1700000000000 });
    const rows = s.listFeedback(b.id);
    ok('V1-2 反馈可读回且内容完整', Array.isArray(rows) && rows.length === 1 && rows[0].answers[0] === '卡在相图',
      JSON.stringify(rows));
    const disk = path.join(d, 'books', b.id, 'study', 'feedback.json');
    ok('V1-3 反馈真的落盘（不是只存浏览器 localStorage）', fs.existsSync(disk) && /卡在相图/.test(fs.readFileSync(disk, 'utf8')));
    // 反馈文件在 books/<id>/study/ 下，整库备份的递归 walk 自然覆盖
    const dump = backup.exportAll(s);
    // 备份里的文件是 base64，中文不会以明文出现；必须解码后比对，不能拿 includes 骗自己。
    const fb = (JSON.parse(dump).books[0].files || []).find(f => /feedback\.json$/.test(f.rel));
    ok('V1-4 反馈文件进入整库备份（base64 解码后内容一致）',
      !!fb && Buffer.from(fb.data, 'base64').toString('utf8').includes('卡在相图'),
      'files=' + (JSON.parse(dump).books[0].files || []).map(f => f.rel).join(','));
    const d2 = tmp(); const s2 = new Store(d2);
    backup.importAll(s2, dump, { mode: 'replace' });
    ok('V1-5 导出→恢复到空库后反馈仍可读',
      typeof s2.listFeedback === 'function' && s2.listFeedback(b.id).some(x => x.answers[0] === '卡在相图'));
    fs.rmSync(d2, { recursive: true, force: true });
  }
  // 四层 API 镜像：HTTP / Electron / preload / api-client 都要有 feedback
  const layers = ['server.js', 'app/main.js', 'app/preload.js', 'renderer/js/api-client.js'];
  ok('V1-6 四层 API 镜像都接上 feedback', layers.every(f => /feedback/i.test(src(f))),
    layers.filter(f => !/feedback/i.test(src(f))).join(',') || 'all');
  ok('V1-7 UI 不再把反馈只写 localStorage', !/localStorage\.setItem\(k,/.test(src('renderer/js/exam-ui.js')));
  fs.rmSync(d, { recursive: true, force: true });
}

// ---------- V2 设置（脱敏）进备份 ----------
{
  const d = tmp(); const s = new Store(d);
  const uiSettings = { engine: 'llm', baseURL: 'https://api.siliconflow.cn/v1', model: 'deepseek-flash',
    pointCount: 7, questionCount: 12, prompt: '重点看相图', dedupeThreshold: 0.9 };
  const j = JSON.parse(backup.exportAll(s, { settings: uiSettings }));
  ok('V2-1 备份携带 settings 字段', !!j.settings && j.settings.engine === 'llm' && j.settings.pointCount === 7,
    JSON.stringify(j.settings));
  ok('V2-2 API 密钥绝不进备份（脱敏；无 settings 字段时判失败，防假绿）',
    !!j.settings && !/apiKey/i.test(JSON.stringify(j.settings)) && !/sk-/i.test(JSON.stringify(j.settings)),
    'settings=' + JSON.stringify(j.settings));
  if (j.settings) {
    const d2 = tmp(); const s2 = new Store(d2);
    const res = backup.importAll(s2, JSON.stringify(j), { mode: 'replace' });
    ok('V2-3 导入结果回传 settings 供前端写回', !!res && !!res.settings && res.settings.engine === 'llm',
      JSON.stringify(res && res.settings));
    fs.rmSync(d2, { recursive: true, force: true });
  }
  fs.rmSync(d, { recursive: true, force: true });
}

// ---------- V3 大文件不再静默丢失 + 备份完整性可见 + 回收站不误消耗 ----------
{
  const d = tmp(); const s = new Store(d);
  const b = s.createBook({ title: '大资料书' });
  const layer = path.join(d, 'books', b.id, 'layer_1');
  fs.mkdirSync(layer, { recursive: true });
  fs.writeFileSync(path.join(layer, 'big.pdf'), Buffer.alloc(65 * 1024 * 1024, 1)); // 65MB > 旧版 64MB 上限
  const j = JSON.parse(backup.exportAll(s));
  const hasBig = j.books[0].files.some(f => /big\.pdf/.test(f.rel));
  ok('V3-1 65MB 资料不再被静默跳过（真的进备份）', hasBig,
    'files=' + j.books[0].files.map(f => f.rel).join(','));
  ok('V3-2 导出结果带 skipped[] 完整性统计', Array.isArray(j.skipped), 'skipped=' + JSON.stringify(j.skipped));
  ok('V3-3 备份携带完整性摘要（文件数 / 字节数）',
    !!j.integrity && typeof j.integrity.files === 'number' && typeof j.integrity.bytes === 'number',
    JSON.stringify(j.integrity));
  // 回收站项指向一个已经不存在的文件时，不许「恢复成功」并把条目消耗掉
  const trashDir = path.join(d, '.trash');
  fs.writeFileSync(path.join(trashDir, 'trash.json'), JSON.stringify({ items: [
    { key: 'gone_key', type: 'material', bookId: b.id, materialId: 'm_gone', layer: 1, ext: '.pdf',
      name: '消失的资料.pdf', deletedAt: Date.now(), rec: { id: 'm_gone', name: '消失的资料.pdf' } }
  ] }, null, 2));
  let threw = false;
  try { s.restoreMaterial('gone_key'); } catch (e) { threw = true; }
  const stillThere = (s.listTrash() || []).some(x => x.key === 'gone_key');
  ok('V3-4 源文件缺失时恢复大声失败且不消耗回收站项', threw && stillThere,
    'threw=' + threw + ' stillThere=' + stillThere);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---------- V4 导入安全：锁 / 原子写 / mode 白名单 / 清 trash / 绑回环 ----------
{
  const backupSrc = src('lib/backup.js');
  ok('V4-1 导入走 store 的跨进程锁（源码锚点 withLock）', /withLock/.test(backupSrc));
  ok('V4-2 导入写文件走原子替换（源码锚点 writeAtomic，无裸 writeFileSync）',
    /writeAtomic/.test(backupSrc) && !/fs\.writeFileSync\(/.test(backupSrc));
  const d1 = tmp(), d2 = tmp();
  const s1 = new Store(d1); s1.createBook({ title: '备份里的书' });
  const dump = backup.exportAll(s1);
  const s2 = new Store(d2); s2.createBook({ title: '现有书' });
  let rejected = false;
  try { backup.importAll(s2, dump, { mode: 'merge' }); } catch (e) { rejected = true; }
  ok('V4-3 非法 mode 被拒绝（不再静默把 index 覆盖成不一致）', rejected, 'rejected=' + rejected);
  // replace 模式必须同时清掉旧 .trash，否则恢复后出现孤儿文件与错位 trash.json
  const s3dir = tmp(); const s3 = new Store(s3dir); s3.createBook({ title: '旧库' });
  fs.writeFileSync(path.join(s3dir, '.trash', 'orphan.bin'), 'orphan');
  backup.importAll(s3, dump, { mode: 'replace' });
  ok('V4-4 replace 恢复后旧 .trash 被清空（不留孤儿）', !fs.existsSync(path.join(s3dir, '.trash', 'orphan.bin')));
  const idx = s3.listBooks().map(b => b.title);
  const dirs = fs.readdirSync(path.join(s3dir, 'books'));
  ok('V4-5 恢复后 index 与 books 目录一致', idx.length === 1 && idx[0] === '备份里的书' && dirs.length === 1,
    JSON.stringify({ idx, dirs }));
  ok('V4-6 本地服务只绑回环地址', /server\.listen\([^)]*127\.0\.0\.1/.test(src('server.js')));
  // 精确锚定 import 路由那一段，避免「文件别处出现 400」造成的假绿
  const sjs = src('server.js');
  const at = sjs.indexOf("parts[2] === 'import'");
  const seg = at > 0 ? sjs.slice(at, at + 900) : '';
  ok('V4-7 /api/backup/import 路由内对 mode 做白名单校验并返回 400',
    at > 0 && /mode/.test(seg) && /replace/.test(seg) && /400/.test(seg), 'at=' + at);
  [d1, d2, s3dir].forEach(x => fs.rmSync(x, { recursive: true, force: true }));
}

// ---------- V5 报告「今日到期」与真实 due 队列同口径 ----------
{
  const now = Date.now();
  const recs = [];
  for (let i = 0; i < 13; i++) recs.push({ pointId: 'p' + i, title: 't' + i, lapseCount: 9, correctCount: 0,
    history: [], srs: { dueAt: now + 10 * 86400000 } });
  recs.push({ pointId: 'p_due', title: '到期的点', lapseCount: 0, correctCount: 5,
    history: [], srs: { dueAt: now - 1 } });
  const stub = { listExams: () => [], getExam: () => null, getMistakes: () => recs };
  const a = analytics.buildReport(stub, 'b', now, { days: 30 });
  const s = study.summarizeMistakes(stub, 'b', now);
  ok('V5-1 报告 dueCount === 真实 due 队列（旧版 0 ≠ 1）', a.dueCount === s.dueCount,
    'report=' + a.dueCount + ' queue=' + s.dueCount);
  // 旧 Leitner 数据（无 srs.dueAt，只有 box）也要按同一函数判定
  const legacy = [{ pointId: 'l1', title: '旧数据', box: 1, lapseCount: 0, history: [] }];
  const stub2 = { listExams: () => [], getExam: () => null, getMistakes: () => legacy };
  ok('V5-2 无 srs 字段的老数据也计入同一口径',
    analytics.buildReport(stub2, 'b', now, { days: 30 }).dueCount === study.summarizeMistakes(stub2, 'b', now).dueCount);
}

// ---------- V6 搜索命中可定位回原文（静态契约 + e2e 复核） ----------
{
  const ui = src('renderer/js/extra-ui.js'), app = src('renderer/js/app.js');
  ok('V6-1 搜索结果渲染出 data-id（不再丢弃后端返回的 id）', /data-id=/.test(ui));
  ok('V6-2 点击处理读取 dataset.id 并传给 openBook', /dataset\.id/.test(ui) && /openBook\([^)]*,/.test(ui));
  ok('V6-3 App.openBook 接收定位参数（第二形参）', /openBook\(\s*id\s*,/.test(app));
  ok('V6-4 material 命中会打开预览（真实入口，不是只切 tab）',
    /materialId/.test(ui) && /openMaterialById/.test(app) && /openBook\(\s*id\s*,/.test(app));
}

// ---------- V7 跨书今日复习 + 独立闪卡自评 ----------
{
  const review = tryMod('lib/review.js');
  ok('V7-1 lib/review.js 存在且导出 queueAcrossBooks / rateCard',
    !!review && typeof review.queueAcrossBooks === 'function' && typeof review.rateCard === 'function');
  if (review) {
    const d = tmp(); const s = new Store(d);
    const now = Date.now();
    const b1 = seedMistake(s, '高数', 'p_a', now - 1000);
    const b2 = seedMistake(s, '材料', 'p_b', now - 2000);
    const q = review.queueAcrossBooks(s, now, { limit: 50 });
    ok('V7-2 跨两本书聚合到期卡（不需要先选书）', Array.isArray(q) && q.length === 2,
      JSON.stringify(q && q.map(x => x.bookId)));
    ok('V7-3 队列带书名 / 知识点 / 遮蔽后的题干 / 答案',
      q && q.length === 2 && q.every(c => c.bookId && c.bookTitle && c.pointId && c.prompt && c.answer),
      JSON.stringify(q && q[0]));
    const before = s.getMistakes(b1)[0].srs.dueAt;
    const r = review.rateCard(s, b1, 'p_a', 4, now);
    const after = s.getMistakes(b1)[0].srs.dueAt;
    ok('V7-4 独立卡四档自评真的回写 SRS（dueAt 变大）', !!r && r.ok && after > now && after > before,
      JSON.stringify({ before, after, r }));
    ok('V7-5 自评不重复记一次「真实交卷」历史',
      s.getMistakes(b1)[0].history.length === 1, 'history=' + s.getMistakes(b1)[0].history.length);
    ok('V7-6 已评过的卡不再出现在今天的队列里',
      !review.queueAcrossBooks(s, now, { limit: 50 }).some(c => c.bookId === b1 && c.pointId === 'p_a'));
    fs.rmSync(d, { recursive: true, force: true });
  }
  const html = src('renderer/index.html'), app = src('renderer/js/app.js');
  ok('V7-7 顶部导航有「今日复习」入口', /nav-review/.test(html));
  ok('V7-8 全局视图注册 review-view', /review-view/.test(app));
  const ui = src('renderer/js/review-ui.js');
  ok('V7-9 闪卡流先揭示再自评（Show Answer → 四档）', /show-answer/.test(ui) && /rate-btn/.test(ui));
  ok('V7-10 四层 API 镜像都接上 review', ['server.js', 'app/main.js', 'app/preload.js', 'renderer/js/api-client.js']
    .every(f => /review:|reviewQueue|reviewRate|review\/queue|review\/rate/.test(src(f))),
    ['server.js', 'app/main.js', 'app/preload.js', 'renderer/js/api-client.js']
      .filter(f => !/review:|reviewQueue|reviewRate|review\/queue|review\/rate/.test(src(f))).join(',') || 'all');
}

// ---------- V8/V9 测试基建与真实入口 ----------
{
  const pkg = JSON.parse(src('package.json') || '{}');
  ok('V9-1 npm test 跑全量判别套件而不是只跑 store.test.js', /run-tests|test:all|for .*test/.test(String(pkg.scripts && pkg.scripts.test || '')));
  ok('V9-2 存在统一测试入口 scripts/run-tests.js', fs.existsSync(path.join(ROOT, 'scripts', 'run-tests.js')));
  const e2e = src('_e2e/e2e.js');
  ok('V9-3 e2e 覆盖备份导出→恢复闭环（不只查按钮存在）', /backup\/export|backupImport|备份含/.test(e2e));
  ok('V9-4 e2e 覆盖今日复习闪卡流', /review-view|nav-review|show-answer/.test(e2e));
  ok('V9-5 e2e 覆盖搜索命中跳转定位（必须断言 data-id 与预览打开）',
    /search-hit/.test(e2e) && /data-id/.test(e2e) && /preview-modal/.test(e2e));
}

console.log('\n判别测试结果： ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
