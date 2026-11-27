#!/usr/bin/env node
/**
 * 逐讲 / 作业题卡进练习题库的判别测试（2026-11-27）。
 * baseline 必红 / candidate 必绿：旧版 practice.js 没有 flattenCards，
 * Core.getQuiz 只返回 analysis 的 12 道自编题，147 道原题卡「看得到做不了」。
 */
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

console.log('\n[BASE] 旧版必须没有这条能力');
const oldPractice = execFileSync('git', ['show', 'HEAD:core/practice.js'], { cwd: ROOT, encoding: 'utf8' });
const oldIndex = execFileSync('git', ['show', 'HEAD:core/index.js'], { cwd: ROOT, encoding: 'utf8' });
ok('B1 旧版没有 flattenCards（baseline 必红）', !/flattenCards/.test(oldPractice));
ok('B2 旧版 getQuiz 不读 cards', !/flattenCards/.test(oldIndex));

console.log('\n[C] 题卡结构化：只从原文派生，不编选项');
const P = require(path.join(ROOT, 'core/practice.js'));
const { Core } = require(path.join(ROOT, 'core/index.js'));
const BOOK = '87763d2d14a660d0';
const core = new Core();
const cards = core.listCards(BOOK);
ok('C1 listCards 仍是只读聚合', cards && cards.lessons.length >= 22 && cards.total >= 146,
  cards ? 'lessons=' + cards.lessons.length + ' total=' + cards.total : 'null');
const all = cards.lessons.filter((L) => !L.error).flatMap((L) => (L.content || []).flatMap((kp) => kp.cards || []));
ok('C2 结构化字段落盘（rationale）', all.filter((c) => c.rationale).length >= 140,
  'rationale=' + all.filter((c) => c.rationale).length);
ok('C3 无定论题明确排除，不拿它考学生', all.filter((c) => c.excludedFromQuiz).length === 2);
ok('C4 选项不是编的：只有 1 题有 options + answerKey',
  all.filter((c) => Array.isArray(c.options) && c.options.length).length === 1);
ok('C5 答案与解析仍在原文里，没被结构化覆盖',
  all.filter((c) => c.answer && Array.isArray(c.solution) && c.solution.length).length >= 144);

console.log('\n[Q] 题库合并：同一套 key / 脱敏 / 来源');
const quiz = core.getQuiz(BOOK);
ok('Q1 12 道自编题 + 144 道原题卡都进题库', quiz.total >= 150, 'total=' + quiz.total);
const origins = {};
quiz.questions.forEach((q) => { const k = q.origin || '全局题'; origins[k] = (origins[k] || 0) + 1; });
ok('Q2 三种来源都在（全局/讲次/作业）',
  origins['全局题'] >= 12 && origins['讲次'] > 100 && origins['作业'] >= 20, JSON.stringify(origins));
ok('Q3 脱敏列表零答案泄露',
  quiz.questions.every((q) => !q.answer && !q.solution && !q.rationale && !q.pitfalls));
ok('Q4 被排除的题不出现在练习里',
  !quiz.questions.some((q) => /暂无定论|需复核/.test(q.stem)));
ok('Q5 卡片题带图（题面的一部分）',
  quiz.questions.filter((q) => q.origin && q.imageIds && q.imageIds.length).length >= 140);

console.log('\n[G] 两条判分路径：能自动判的自动判，不能的自评进 SRS');
const cardAuto = quiz.questions.find((q) => q.origin && q.auto);
ok('G1 卡片自动判分题存在（不是硬凑 100 道）', !!cardAuto);
if (cardAuto) {
  const full = P.findCardQuestion(cards, cardAuto.key);
  ok('G2 中文答案格式「A（…）」能解析', P.parseAnswer(full).letter === 'A', JSON.stringify(P.parseAnswer(full)));
  const right = core.submitAttempt(BOOK, { key: cardAuto.key, given: 'A' });
  const wrong = core.submitAttempt(BOOK, { key: cardAuto.key, given: 'B' });
  ok('G3 选 A 判对 / 选 B 判错', right.verdict === 'correct' && wrong.verdict === 'wrong',
    right.verdict + '/' + wrong.verdict);
}
const selfQ = quiz.questions.find((q) => q.origin === '作业' && !q.auto);
const selfR = core.submitAttempt(BOOK, { key: selfQ.key, given: '自己写的受力分析' });
ok('G4 开放题走自评，答案和 4 步解析提交后才下发',
  selfR.mode === 'self' && !!selfR.answer && Array.isArray(selfR.solution) && selfR.solution.length >= 3);
ok('G5 订正带 rationale/pitfalls（不空话）', !!selfR.rationale && !!selfR.pitfalls,
  'r=' + String(selfR.rationale || '').slice(0, 30) + ' p=' + String(selfR.pitfalls || '').slice(0, 30));
ok('G6 提交后创建 SRS 卡并给出下次复习时间', !!selfR.dueAt && Object.keys(core.getPractice(BOOK).cards).length > 0);
const due = core.getDue(BOOK);
ok('G7 到期页能取到原题卡', due.questions.some((q) => q.origin === '作业'));

console.log('\n[UI] 前端接线：筛选 + 订正五层');
const VW = fs.readFileSync(path.join(ROOT, 'workbench/src/views.js'), 'utf8');
ok('U1 练习页按来源筛（全部/作业/讲次/全局题）',
  /ORIGINS = \['全部', '作业', '讲次', '全局题'\]/.test(VW));
ok('U2 作答页显示题面和图（不是空壳表单）', /quizFigures\(id, q\)/.test(VW.slice(VW.indexOf('function viewAttempt'))));
ok('U3 订正五层：答案/分步/为什么/易错/自评',
  /参考答案/.test(VW) && /分步解答/.test(VW) && /为什么这么想/.test(VW) && /最容易错/.test(VW) && /四档自评/.test(VW));
ok('U4 自评后回到原筛选，不丢来源', /go\('quiz', \{ id, origin: params\.origin/.test(VW));

console.log('\n结果 ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
