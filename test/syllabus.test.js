'use strict';
// M1 解析器单测：直接喂真实种子数据（工程材料 考纲.md + 题库.json），断言结构正确。
const path = require('path');
const assert = require('assert');
const { Store } = require('../lib/store');
const syllabus = require('../lib/syllabus');
const insight = require('../lib/insight');

const ROOT = path.join(__dirname, '..', 'library');
const store = new Store(ROOT);
const BOOK = 'b_afb67234524b'; // 工程材料
const BOOK2 = 'b_801c90e933dc'; // 概率统计（无考纲，测兜底）

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// 找到考纲与题库资料
const g = store.getBook(BOOK);
const syl = g.materials.find(m => syllabus.classifyMaterial(store, BOOK, m) === 'syllabus');
const bank = g.materials.find(m => syllabus.classifyMaterial(store, BOOK, m) === 'questionbank');

ok('工程材料：识别到考纲资料', !!syl, JSON.stringify(g.materials.map(m => m.name)));
ok('工程材料：识别到题库资料', !!bank);

// 解析考纲
const rs = store.readMaterial(BOOK, syl.id);
const sylText = insight.extractText(syl.ext, Buffer.from(rs.data, 'base64')) || rs.extractedText || '';
const outline = syllabus.parseSyllabusMd(sylText);

ok('考纲解析：章节数 ≥ 5', outline.chapters.length >= 5, 'chapters=' + outline.chapters.length);
ok('考纲解析：知识点数 ≥ 50', outline.pointCount >= 50, 'pointCount=' + outline.pointCount);
ok('考纲解析：含自拟题', outline.selfMadeCount > 0, 'selfMade=' + outline.selfMadeCount);

// 抽查一个具体知识点：1.2.3 应含 选择 题型
let p123 = null;
outline.chapters.forEach(c => c.sections.forEach(s => s.points.forEach(p => { if (p.id === '1.2.3') p123 = p; })));
ok('考纲解析：知识点 1.2.3 存在', !!p123, 'id not found');
ok('考纲解析：1.2.3 题型含「选择」', p123 && p123.types.includes('选择'), p123 && JSON.stringify(p123.types));
ok('考纲解析：1.2.3 被标为重点(▲)', p123 && p123.key === true);

// 解析题库
const rb = store.readMaterial(BOOK, bank.id);
const bankJson = JSON.parse(Buffer.from(rb.data, 'base64').toString('utf8'));
const parsedBank = syllabus.parseQuestionBank(bankJson, bank.name);

ok('题库解析：题目数 = 86', parsedBank.count === 86, 'count=' + parsedBank.count);
ok('题库解析：按知识点挂题（1.1.1 有题）', (parsedBank.byPoint['1.1.1'] || []).length > 0, JSON.stringify(Object.keys(parsedBank.byPoint).slice(0, 5)));
ok('题库解析：题目 type 规整为引擎类型', parsedBank.questions.every(q => ['single', 'multiple', 'explain', 'case', 'fill', 'judge', 'essay', 'calc'].includes(q.type)), 'bad type');

// buildBookOutline：考纲 + 题库合并
const full = syllabus.buildBookOutline(store, BOOK);
ok('buildBookOutline：kind=syllabus', full.kind === 'syllabus');
ok('buildBookOutline：questionCount=86', full.questionCount === 86, 'q=' + full.questionCount);
ok('buildBookOutline：hasBank=true', full.hasBank === true);
let p123b = null;
full.chapters.forEach(c => c.sections.forEach(s => s.points.forEach(p => { if (p.id === '1.2.3') p123b = p; })));
ok('buildBookOutline：知识点 1.2.3 挂到了题库题', p123b && p123b.questionCount > 0, p123b && 'q=' + p123b.questionCount);

// 兜底：无考纲的书返回 outline
const fb = syllabus.buildBookOutline(store, BOOK2);
ok('兜底：概率统计返回 kind=outline', fb.kind === 'outline', 'kind=' + fb.kind);
ok('兜底：isFallback=true', fb.isFallback === true);

console.log('\nSYLLABUS 单测： ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
