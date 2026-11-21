#!/usr/bin/env node
/**
 * 融合 1（导图展开态持久化）+ 3（递进分析细节）的判别测试。
 *   node tools/check-progressive-fusion.mjs
 * baseline 必红 / candidate 必绿。
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
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

const MM = fs.readFileSync(path.join(ROOT, 'workbench/src/mindmap.js'), 'utf8');
const BS = fs.readFileSync(path.join(ROOT, 'workbench/src/bookspace.js'), 'utf8');
const A = require(path.join(ROOT, 'core/analyze.js'));

// ---------- 任务1：导图展开态持久化 ----------
console.log('\n[任务1] 导图展开态刷新/切页签后保留');
ok('mountMindmap 接受持久化 key', /opts\.storageKey|o\.storageKey/.test(MM) || /storageKey/.test(MM));
ok('有读取已存状态的入口', /restoreMapState|loadMapState|readMapState|savedState/.test(MM));
ok('有写入状态的动作（展开/切章/换布局都要触发）', /saveMapState|persistMapState|writeMapState|storeMapState/.test(MM));
ok('持久化字段覆盖 chapterId + expanded + depthCap + mode',
  ['chapterId', 'expanded', 'depthCap', 'state.mode'].every((k) => MM.includes(k)) &&
  /JSON\.stringify/.test(MM), '字段或 JSON 序列化缺失');
ok('bookspace 传书级 key（按书区分，不串台）',
  /storageKey\s*:\s*['"]book:/.test(BS) && /storageKey:.*S\.id/.test(BS));
ok('分析结果可指定默认折叠层（数据层可配，无则自动）',
  /defaultDepth/.test(BS) || /defaultDepth/.test(MM) || /mapView/.test(BS));

// ---------- 任务3A：提示词吸收递进三层 ----------
console.log('\n[任务3A] 每个知识点按「是什么 / 怎么考 / 易错」递进写');
const sys = A.SYSTEM_PROMPT;
ok('提示词要求 desc 讲清「是什么」', /是什么|定义/.test(sys));
ok('提示词要求「怎么考 / 常考」层次', /怎么考|常考|如何考/.test(sys));
ok('提示词要求「易错 / 辨析」层次', /易错|辨析|混淆/.test(sys));
ok('三层被明确绑到知识点（不是散落在题目规则里）',
  /递进|三层|是什么.{0,40}怎么考|是什么.{0,60}易错/.test(sys));

// ---------- 任务3B：可选第二轮深挖，失败不挡主分析 ----------
console.log('\n[任务3B] 第二轮递进深挖');
ok('analyze 接受 deepDive 选项', /deepDive/.test(fs.readFileSync(path.join(ROOT, 'core/analyze.js'), 'utf8')));
ok('有独立的深挖提示词/构造函数', /DEEP_DIVE|deepDiveMessages|buildDeepDive|deepDivePrompt/.test(fs.readFileSync(path.join(ROOT, 'core/analyze.js'), 'utf8')));
ok('深挖结果落到 deepDive 字段', /result\.deepDive/.test(fs.readFileSync(path.join(ROOT, 'core/analyze.js'), 'utf8')));
ok('app-host 透传 deepDive（不新增 action）',
  /deepDive/.test(fs.readFileSync(path.join(ROOT, 'core/app-host.js'), 'utf8')));
ok('前端有深挖展示入口', /deepDive/.test(BS));

// 真跑：deepDive 失败时主分析必须照样成功（这是最关键的契约）
const CORPUS = '【P.1】\n在长度为 n 的顺序表中，第 i 个位置插入元素需移动 n-i+1 个元素。'.repeat(10);
const fake = {
  outline: { title: '数据结构', children: [{ title: '第一章', type: 'chapter', children: [{ title: '顺序表', type: 'section', children: [{ title: '插入', type: 'point', desc: '插入要移动元素' }] }] }] },
  questionIndex: [{ type: '选择题', items: [{ title: '插入', questions: [
    { stem: 'n=10,i=3 移动几个？', answer: '8 个 —— n-i+1', solution: ['套公式'], rationale: '固定位置用精确公式而不是平均值，误用 n/2 会算成 5。',
      pointPath: ['第一章', '顺序表', '插入'], source: { file: '讲义.md', page: 1, anchor: '【P.1】', quote: '在长度为 n 的顺序表中，第 i 个位置插入元素需移动 n-i+1 个元素' } },
  ] }] }],
  overview: { summary: '概要' }, stats: {}
};
let mainOk = false, deepErrMarked = false;
try {
  const r = await A.analyze('测试书', CORPUS, {
    chat: async () => JSON.stringify(fake),
    deepDive: true,
    deepDiveChat: async () => { throw new Error('模拟深挖模型不可用'); },
    cfg: { model: 'mock' },
  });
  mainOk = !!(r && r.tree && r.questionIndex && r.questionIndex.length);
  deepErrMarked = !!(r && r.deepDive && r.deepDive.status === 'error');
} catch (e) { console.log('  分析异常:', e.message); }
ok('深挖失败时主分析仍成功（不因可选增强丢结果）', mainOk);
ok('深挖失败诚实标 error（不伪造深挖内容）', deepErrMarked);

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
