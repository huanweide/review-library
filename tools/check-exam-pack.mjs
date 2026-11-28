#!/usr/bin/env node
/**
 * 考点包 / 备份字段 / 搜索截断 / 本机快照 的判别测试（2026-11-27）。
 * 2026-11-28：baseline 从 HEAD 改为固定 commit 7876189（v1.7.3），
 * 避免 v1.8.0 提交后「旧版没有 snapshot action」等断言假红；HEAD 不是历史事实。
 */
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as EXAM from '../workbench/src/exam-pack.mjs';
import * as S from '../workbench/src/structure-layer.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

console.log('\n[BASE] 旧版必须没有这三项');
const oldCaps = execFileSync('git', ['show', '7876189:core/capabilities.js'], { cwd: ROOT, encoding: 'utf8' });
const oldBackup = execFileSync('git', ['show', '7876189:lib/backup.js'], { cwd: ROOT, encoding: 'utf8' });
const oldSearch = execFileSync('git', ['show', '7876189:lib/search.js'], { cwd: ROOT, encoding: 'utf8' });
ok('B1 旧版没有 snapshot action', !/action: 'snapshot'/.test(oldCaps));
ok('B2 旧版备份漏三个字段', !/visionModel/.test(oldBackup) && !/deepDive/.test(oldBackup));
ok('B3 旧版搜索没有 total/truncated', !/searchAllWithMeta/.test(oldSearch));

console.log('\n[P] 考点包：一物三用（打印 / 导出 / 可读备份）');
const { Core } = require(path.join(ROOT, 'core/index.js'));
const core = new Core();
const BOOK = '87763d2d14a660d0';
const analysis = core.getAnalysis(BOOK);
const cards = core.listCards(BOOK);
const html = EXAM.buildExamPackHtml({ book: { title: '理论力学' }, analysis, cards,
  imageUrl: (id) => '/api/app/image?id=' + id });
ok('P1 含知识结构 + 原题卡两段', html.includes('知识结构') && html.includes('原题卡'));
ok('P2 含打印样式（浏览器直接打印 / 另存 PDF）', html.includes('@media print') && html.includes('window.print()'));
ok('P3 题图原样引用，不重绘', html.includes('/api/app/image?id=') && html.includes('未经重绘'));
ok('P4 每张卡的答案/解析/易错都在', html.includes('答案') && html.includes('分步解答') && html.includes('最容易错'));
const layer = S.withRename(S.emptyLayer(), analysis.tree.children[0].id, '我改过的章名');
const html2 = EXAM.buildExamPackHtml({ book: {}, analysis, cards, structure: layer, imageUrl: () => '' });
ok('P5 导出与画布同源：用户改过的名字出现在导出里', html2.includes('我改过的章名'));
ok('P6 输入被转义（资料文字不当 HTML 执行）',
  EXAM.buildExamPackHtml({ book: { title: '<script>alert(1)</script>' }, analysis, cards }).includes('&lt;script&gt;'));

console.log('\n[B] 备份白名单：不丢配置、不泄密钥');
const backupSrc = fs.readFileSync(path.join(ROOT, 'lib/backup.js'), 'utf8');
ok('B4 三字段进白名单', /visionModel/.test(backupSrc) && /deepDive/.test(backupSrc) && /tickEveryRounds/.test(backupSrc));
ok('B5 apiKey 仍明确排除', /apiKey/.test(backupSrc) && !/SETTINGS_KEYS[^\n]*apiKey/.test(backupSrc));

console.log('\n[S] 搜索截断：到上限必须说还有多少条');
const SR = require(path.join(ROOT, 'lib/search.js'));
const store = {
  listBooks: () => [{ id: 'b', title: '测试书' }],
  getBook: () => ({ materials: [
    { id: 'm1', name: '命中 x 的资料 1', extractedText: 'x x' },
    { id: 'm2', name: '命中 x 的资料 2', extractedText: 'x x' },
    { id: 'm3', name: '命中 x 的资料 3', extractedText: 'x x' },
  ] }),
  getAnalysis: () => null, getPractice: () => null, getMistakes: () => [], listExams: () => [],
};
const m = SR.searchAllWithMeta(store, 'x', { limit: 1 });
ok('S1 total 是全量命中数，不是截断后的 1', m.total > 1, JSON.stringify(m));
ok('S2 truncated 明确为 true', m.truncated === true);
ok('S3 items 仍只有 limit 条（老调用方契约不变）', m.items.length === 1);
ok('S4 老接口 searchAll 仍返回数组', Array.isArray(SR.searchAll(store, 'x', { limit: 1 })));

console.log('\n[N] 本机快照：自动留档 + 恢复 + 保留上限');
const beforeIds = core.listSnapshots(BOOK).map((x) => x.id);
const beforeTitle = core.getStructure(BOOK).renames.n1_1 || '';
core.saveStructure(BOOK, S.withRename(S.emptyLayer(), 'n1_1', '快照判别用名'));
const after = core.listSnapshots(BOOK);
// 到保留上限后总数不变（留一份同时清一份），所以按「出现了新 id」判，不按数量判。
const created = after.find((x) => !beforeIds.includes(x.id));
ok('N1 改结构前自动留了一份', !!created, beforeIds.length + ' -> ' + after.length);
const newest = created ? created.id : after[0].id;
ok('N2 快照含书/分析/题卡（不是空壳）', require('fs').readdirSync(
  path.join(ROOT, 'library/_snapshots', BOOK, newest)).filter((x) => /^(book|analysis|practice|structure)\.json$/.test(x)).length >= 3);
core.saveStructure(BOOK, S.withRename(S.emptyLayer(), 'n1_1', '另一版'));
const restored = core.restoreSnapshot(BOOK, newest);
// 快照是在「变更前」留的，恢复自然回到 beforeTitle，不是刚写进去的那版。
ok('N3 恢复成功且回到变更前', restored.files > 0
  && (core.getStructure(BOOK).renames.n1_1 || '') === beforeTitle,
  'got=' + (core.getStructure(BOOK).renames.n1_1 || '') + ' want=' + beforeTitle);
core.saveStructure(BOOK, beforeTitle ? S.withRename(S.emptyLayer(), 'n1_1', beforeTitle) : S.emptyLayer());
ok('N4 判别后现场还原', !core.getStructure(BOOK).renames.n1_1);
const { KEEP } = require(path.join(ROOT, 'lib/snapshot.js'));
ok('N5 保留上限 5 份（不递归删 library 根）', KEEP === 5);

console.log('\n[W] 三端注册 + 前端入口');
const caps = fs.readFileSync(path.join(ROOT, 'core/capabilities.js'), 'utf8');
const req = fs.readFileSync(path.join(ROOT, 'core/request.js'), 'utf8');
const host = fs.readFileSync(path.join(ROOT, 'core/app-host.js'), 'utf8');
const bs = fs.readFileSync(path.join(ROOT, 'workbench/src/bookspace.js'), 'utf8');
const extra = fs.readFileSync(path.join(ROOT, 'renderer/js/extra-ui.js'), 'utf8');
ok('W1 snapshot 三端齐', /action: 'snapshot'/.test(caps) && /parts\[2\] === 'snapshot'/.test(req) && /case 'snapshot'/.test(host));
ok('W2 书内有考点包 / 快照两个入口', /btn\('考点包'/.test(bs) && /btn\('快照'/.test(bs));
ok('W3 快照浮层恢复前 confirm', /window\.confirm\('恢复到/.test(bs));
ok('W4 搜索界面显示未显示条数', /还有 ' \+ omitted \+ ' 条未显示/.test(extra));

console.log('\n结果 ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
