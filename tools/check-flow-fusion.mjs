#!/usr/bin/env node
/**
 * 便捷 / 复习效果 全链路融合的判别测试（maxloop 纪律：baseline 必红 / candidate 必绿）。
 *
 *   node tools/check-flow-fusion.mjs
 *
 * 阶段零基准：复习资料图书馆/PROCESS/research-便捷与复习效果/best-practices.md
 *   - Anki 论坛用户实证「点开再点 Study」是多余一跳
 *   - 中文分析：Anki 复习界面只留四样东西（题/四档/显示答案/标记困难）
 *   - Anki 与 Quizlet 都用四档手动评分，Anki「评分前显示下一个间隔」
 *   - qiaomu：一份资料一次触发全出产物
 *
 * 六组验收（对应用户要的「便捷满分 + 复习效果满分」）：
 *   A 练习页带图：flatten 必须把 imageIds 带进题目契约（否则「根据图中」的题做不了）
 *   B 题号全局：seqNo 全局唯一且两处显示同一号（不再出现两个「第1题」）
 *   C 练习不换壳：练习页继承书内沉浸态 + 一键回书
 *   D 四档预览：attempt 返回四个档位各自的下次间隔（让代价可见）
 *   E 产物自动：分析成功后自动并行生成考点大全与考纲
 *   F 首页有学习状态：书架每本书带今日待复习数
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + String(extra).slice(0, 200) : '')); }
};

const P = require(path.join(ROOT, 'core/practice.js'));
const A = require(path.join(ROOT, 'core/analyze.js'));
const IMG = require(path.join(ROOT, 'core/images.js'));

const IMG_ID_1 = 'aaaaaaaaaaaaaaaa';
const IMG_ID_2 = 'bbbbbbbbbbbbbbbb';

// 造一份「两道题，第二道必须看图」的最小分析结果
function fakeAnalysis() {
  return {
    outline: {
      title: '概率论', children: [
        { title: '第一章 正态分布', type: 'chapter', children: [
          { title: '1.1 参数', type: 'section', children: [
            { title: '1.1.1 均值与标准差', type: 'point', desc: '是什么；怎么考；易错' }
          ] }
        ] }
      ]
    },
    questionIndex: [{
      type: '选择题',
      items: [{
        title: '参数与曲线形状辨析类',
        questions: [
          {
            stem: '关于正态分布 N(μ,σ²) 的两个参数，下列说法正确的是？',
            options: ['A. μ 决定曲线胖瘦', 'B. μ 决定中心位置', 'C. σ 决定中心位置', 'D. 都不影响'],
            answer: 'B',
            solution: ['μ 是位置参数'],
            rationale: '位置参数与尺度参数不能混',
            difficulty: '基础',
            pointPath: ['第一章 正态分布', '1.1 参数', '1.1.1 均值与标准差'],
            source: { file: '讲义.md', page: 1, anchor: '【P.1】', quote: 'μ 决定曲线的中心位置' }
          },
          {
            stem: '根据图中正态分布 3σ 规则示意图，数据落在 μ±2σ 范围内的概率约为多少？',
            options: ['A. 68.27%', 'B. 95.45%', 'C. 99.73%', 'D. 50%'],
            answer: 'B',
            solution: ['查 3σ 规则'],
            rationale: 'μ±2σ 对应 95.45%',
            difficulty: '基础',
            pointPath: ['第一章 正态分布', '1.1 参数', '1.1.1 均值与标准差'],
            source: { file: '讲义.md', page: 1, anchor: '【P.1】', quote: 'μ±2σ 内含 95.45%' },
            imageIds: [IMG_ID_1]
          }
        ]
      }]
    }],
    overview: { summary: '正态分布' },
    stats: {}
  };
}

// ---------- A 练习页带图 ----------
console.log('\n[A] 练习页必须能带图（「根据图中」的题才做得了）');
try {
  const qs = P.flatten(fakeAnalysis(), true);
  ok('A1 flatten 返回两题', qs.length === 2, 'got ' + qs.length);
  const withImg = qs.find((x) => /根据图中/.test(x.stem)) || {};
  ok('A2 题目契约带 imageIds 字段', Object.prototype.hasOwnProperty.call(withImg, 'imageIds'),
    '字段=' + Object.keys(withImg).join(','));
  ok('A3 必须看图的题带上原图 id', Array.isArray(withImg.imageIds) && withImg.imageIds[0] === IMG_ID_1,
    JSON.stringify(withImg.imageIds));
  const noImg = qs.find((x) => !/根据图中/.test(x.stem)) || {};
  ok('A4 纯文字题 imageIds 是空数组（不乱挂图）', Array.isArray(noImg.imageIds) && noImg.imageIds.length === 0,
    JSON.stringify(noImg.imageIds));
  ok('A5 脱敏模式也带图（练习页拿的就是脱敏题）',
    Array.isArray(withImg.imageIds) && !Object.prototype.hasOwnProperty.call(withImg, 'answer'));
} catch (e) {
  console.log('  ✗ A 组执行异常：' + e.message); fail += 4;
}

// ---------- B 题号全局唯一 ----------
console.log('\n[B] 题号全局唯一（不再两个「第1题」）');
try {
  const v = A.validate(fakeAnalysis());
  const all = (v.questionIndex || []).flatMap((g) => (g.items || []).flatMap((i) => i.questions || []));
  ok('B1 validate 通过', all.length === 2, 'got ' + all.length);
  ok('B2 每题都有 seqNo', all.every((q) => Number.isFinite(Number(q.seqNo))), JSON.stringify(all.map((q) => q.seqNo)));
  const seqs = all.map((q) => Number(q.seqNo));
  ok('B3 seqNo 全局唯一', new Set(seqs).size === seqs.length, JSON.stringify(seqs));
  ok('B4 seqNo 从 1 连续递增', seqs.slice().sort((a, b) => a - b).every((n, i) => n === i + 1), JSON.stringify(seqs));
} catch (e) {
  console.log('  ✗ B 组执行异常：' + e.message); fail += 4;
}

// ---------- D 四档间隔预览 ----------
console.log('\n[D] 答完当场看到「下次什么时候见」（四档）');
try {
  const qs = P.flatten(fakeAnalysis(), false);
  const q = qs[0];
  let st = P.emptyState();
  const t0 = Date.UTC(2026, 10, 21, 2, 0, 0);
  const r = P.attempt(st, q, 'B', t0);
  ok('D1 attempt 有结果', !!r && !!r.result, JSON.stringify(r && r.error));
  const ni = r.result && r.result.nextIntervals;
  ok('D2 返回四档间隔预览 nextIntervals', Array.isArray(ni) && ni.length === 4, JSON.stringify(ni));
  if (Array.isArray(ni) && ni.length === 4) {
    ok('D3 四档各带 rating 1..4', ni.map((x) => x.rating).join(',') === '1,2,3,4', JSON.stringify(ni.map((x) => x.rating)));
    ok('D4 每档都带可读间隔文案', ni.every((x) => typeof x.label === 'string' && x.label.length > 0), JSON.stringify(ni.map((x) => x.label)));
    ok('D5 「重来」比「简单」更早到期', ni[0].dueAt < ni[3].dueAt, ni[0].dueAt + ' vs ' + ni[3].dueAt);
  } else { fail += 4; }
  ok('D6 自动判卷仍照旧排程（对=3分口径不变）', r.result.card && r.result.card.reps === 1, JSON.stringify(r.result.card && r.result.card.reps));
} catch (e) {
  console.log('  ✗ D 组执行异常：' + e.message); fail += 6;
}

// ---------- 前端三组（静态锁结构，行为另由真机验） ----------
const BS = fs.readFileSync(path.join(ROOT, 'workbench/src/bookspace.js'), 'utf8');
const VW = fs.readFileSync(path.join(ROOT, 'workbench/src/views.js'), 'utf8');
const SH = fs.readFileSync(path.join(ROOT, 'workbench/src/shell.js'), 'utf8');

console.log('\n[C] 练习不换壳（继承书内沉浸态 + 一键回书）');
ok('C1 练习视图在沉浸态里（不再恢复全局侧栏）', /bs-focus/.test(VW), 'views.js 未出现 bs-focus');
// 必须是真的链接到该书的出口，不是注释里出现「回到」二字
ok('C2 练习页有「回到这本书」的真链接',
  /href\s*[:=][^\n]*#\/book\?id=|go\('book'/.test(VW), 'views.js 无指向 #/book 的出口');
// 同屏可切「题型/考点/导图」，不用先退回书架再进书
ok('C3 练习页可横向切到书内其它页（看导图/回书）', /go\('book',\s*\{\s*id/.test(VW.slice(VW.indexOf('viewQuiz'), VW.indexOf('function viewDue'))) || /看导图|看题型/.test(VW));

console.log('\n[E] 分析后不自动补整理文档；复习总纲按需生成（2026-11-24 契约）');
// 2026-11-21 的旧契约是「analyze 成功后自动 compose digest+syllabus」。
// 11-24 产品收敛：原 digest/syllabus 页签合并为「复习总纲」，必须按章分批生成才能防截断，
// 改走 scripts/build-review-guide.mjs；分析链里只保留 cachedOnly 探测，绝不静默花钱。
// bookspace.js:1638 有决策注释。旧断言测的是已废弃行为，按新契约重写为反向断言。
const analyzeIdx = BS.indexOf("action('analyze'");
const afterAnalyze = analyzeIdx >= 0 ? BS.slice(analyzeIdx, analyzeIdx + 2600) : '';
ok('E0 找得到 analyze 调用', analyzeIdx > 0, '锚点缺失');
ok('E1 分析成功回调里不再自动 compose（避免静默花钱/截断）', !/autoCompose\(/.test(afterAnalyze),
  'analyze 之后仍存在 autoCompose，11-24 的收敛决策被回退');
ok('E2 决策有落地注释 + 总纲走独立构建脚本',
  /分析后不再自动补整理文档/.test(BS) && /build-review-guide\.mjs/.test(BS),
  '缺决策注释或缺 build-review-guide.mjs 指引');
ok('E3 页签探测只读缓存（cachedOnly），不因切页签触发生成',
  /action\('compose',\s*\{[^}]*kind:\s*'review-guide'[^}]*cachedOnly:\s*true/.test(BS),
  'review-guide 探测未带 cachedOnly: true');

console.log('\n[F] 书架显示今日待复习');
const HOST = fs.readFileSync(path.join(ROOT, 'core/app-host.js'), 'utf8');
const cardSeg = VW.slice(VW.indexOf('book-grid'), (function () { const i = VW.indexOf('function viewBook'); return i > 0 ? i : VW.length; })());
ok('F1 list 返回带 dueCount', /dueCount/.test(HOST), 'app-host list 无 dueCount');
ok('F2 书架卡片渲染 dueCount', /dueCount/.test(cardSeg), '书架卡片段内没有 dueCount');
ok('F3 页头有全局今日复习入口', /待复习|今日/.test(SH), 'shell 页头无入口');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
