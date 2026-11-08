'use strict';
// M1 解析器单测（自包含夹具版）：在临时目录里造一本「考纲.md + 题库.json」书，验证 syllabus 的
// 解析 / 挂题 / 兜底逻辑。原始测试依赖 library/ 下真实种子书（已随 gitignore 的 library/ 丢失），
// 这里改为测试内随造合成夹具，只验证解析逻辑本身，不伪装成真实考试数据。
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Store } = require('../lib/store');
const syllabus = require('../lib/syllabus');
const insight = require('../lib/insight');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-syl-'));
const store = new Store(ROOT);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// ---------- 合成考纲.md（明确标注为测试夹具） ----------
function buildSyllabusMd() {
  const lines = [];
  lines.push('---');
  lines.push('title: 工程材料考纲（测试夹具·合成数据）');
  lines.push('tags: [考纲]');
  lines.push('---');
  lines.push('# 工程材料考纲（测试夹具）');
  for (let c = 1; c <= 5; c++) {
    lines.push('');
    lines.push('# 第' + c + '章 章节' + c);
    lines.push('## ' + c + '.1 第' + c + '章第一节');
    lines.push('| 编号 | 知识点 | 对应题型 |');
    lines.push('| --- | --- | --- |');
    for (let p = 1; p <= 6; p++) {
      const id = c + '.1.' + p;
      const types = (id === '1.2.3') ? '选择' : (p % 2 ? '填空、简答' : '判断');
      lines.push('| ' + id + ' | 知识点' + id + ' | ' + types + ' |');
    }
    lines.push('');
    lines.push('## ' + c + '.2 第' + c + '章第二节');
    lines.push('| 编号 | 知识点 | 对应题型 |');
    lines.push('| --- | --- | --- |');
    for (let p = 1; p <= 6; p++) {
      const id = c + '.2.' + p;
      const types = (id === '1.2.3') ? '选择' : (p % 2 ? '计算' : '名词解释、选择');
      lines.push('| ' + id + ' | 知识点' + id + ' | ' + types + ' |');
    }
  }
  // 重点标记 + 自拟题（合成，仅验证解析逻辑）
  lines.push('');
  lines.push('▲ 重点：1.2.3');
  lines.push('**自拟题**');
  lines.push('- `Z-1-1` 填空：夹具测试自拟题题干一');
  lines.push('- `Z-1-2` 简答：夹具测试自拟题题干二');
  return lines.join('\n');
}

// ---------- 合成题库.json（86 题，明确标注为测试夹具） ----------
function buildBank() {
  const pointIds = [];
  for (let c = 1; c <= 5; c++) for (let s = 1; s <= 2; s++) for (let p = 1; p <= 6; p++) pointIds.push(c + '.' + s + '.' + p);
  const types = ['选择', '判断', '填空', '简答', '计算', '名词解释'];
  const items = [];
  for (let i = 1; i <= 86; i++) {
    let kp;
    if (i === 1) kp = '1.1.1';
    else if (i === 2) kp = '1.2.3';
    else kp = pointIds[(i * 7) % pointIds.length];
    items.push({ id: i, type: types[i % types.length], stem: '题' + i + '（夹具）', kp: kp, correct: 'A' });
  }
  return { meta: { title: '工程材料题库（夹具）', count: 86 }, items };
}

// ---------- 造书 ----------
const book = store.createBook({ title: '工程材料（测试夹具）', exam: '夹具考', subject: '材料' });
const BOOK = book.id;
const sylContent = buildSyllabusMd();
const bankJson = buildBank();
store.addMaterials(BOOK, 3, [
  { name: '工程材料考纲.md', data: Buffer.from(sylContent, 'utf8').toString('base64'), extractedText: sylContent },
  { name: '工程材料题库.json', data: Buffer.from(JSON.stringify(bankJson), 'utf8').toString('base64') }
]);

// 兜底书：无考纲，只放一篇纯笔记（.md 但无考纲表/标签 → 归 doc）
const book2 = store.createBook({ title: '概率统计（无考纲·夹具）' });
const BOOK2 = book2.id;
const docText = ('概率统计复习笔记（测试夹具）。').repeat(40);
store.addMaterials(BOOK2, 3, [
  { name: '复习笔记.md', data: Buffer.from(docText, 'utf8').toString('base64'), extractedText: docText }
]);

// ---------- 断言 ----------
const g = store.getBook(BOOK);
const syl = g.materials.find(m => syllabus.classifyMaterial(store, BOOK, m) === 'syllabus');
const bank = g.materials.find(m => syllabus.classifyMaterial(store, BOOK, m) === 'questionbank');

ok('识别到考纲资料', !!syl, JSON.stringify(g.materials.map(m => m.name)));
ok('识别到题库资料', !!bank);

const rs = store.readMaterial(BOOK, syl.id);
const sylText = insight.extractText(syl.ext, Buffer.from(rs.data, 'base64')) || rs.extractedText || '';
const outline = syllabus.parseSyllabusMd(sylText);

ok('考纲解析：章节数 ≥ 5', outline.chapters.length >= 5, 'chapters=' + outline.chapters.length);
ok('考纲解析：知识点数 ≥ 50', outline.pointCount >= 50, 'pointCount=' + outline.pointCount);
ok('考纲解析：含自拟题', outline.selfMadeCount > 0, 'selfMade=' + outline.selfMadeCount);

let p123 = null;
outline.chapters.forEach(c => c.sections.forEach(s => s.points.forEach(p => { if (p.id === '1.2.3') p123 = p; })));
ok('考纲解析：知识点 1.2.3 存在', !!p123, 'id not found');
ok('考纲解析：1.2.3 题型含「选择」', p123 && p123.types.includes('选择'), p123 && JSON.stringify(p123.types));
ok('考纲解析：1.2.3 被标为重点(▲)', p123 && p123.key === true);

const rb = store.readMaterial(BOOK, bank.id);
const bankJsonParsed = JSON.parse(Buffer.from(rb.data, 'base64').toString('utf8'));
const parsedBank = syllabus.parseQuestionBank(bankJsonParsed, bank.name);

ok('题库解析：题目数 = 86', parsedBank.count === 86, 'count=' + parsedBank.count);
ok('题库解析：按知识点挂题（1.1.1 有题）', (parsedBank.byPoint['1.1.1'] || []).length > 0, JSON.stringify(Object.keys(parsedBank.byPoint).slice(0, 5)));
ok('题库解析：题目 type 规整为引擎类型', parsedBank.questions.every(q => ['single', 'multiple', 'explain', 'case', 'fill', 'judge', 'essay', 'calc'].includes(q.type)), 'bad type');

const full = syllabus.buildBookOutline(store, BOOK);
ok('buildBookOutline：kind=syllabus', full.kind === 'syllabus');
ok('buildBookOutline：questionCount=86', full.questionCount === 86, 'q=' + full.questionCount);
ok('buildBookOutline：hasBank=true', full.hasBank === true);
let p123b = null;
full.chapters.forEach(c => c.sections.forEach(s => s.points.forEach(p => { if (p.id === '1.2.3') p123b = p; })));
ok('buildBookOutline：知识点 1.2.3 挂到了题库题', p123b && p123b.questionCount > 0, p123b && 'q=' + p123b.questionCount);

const fb = syllabus.buildBookOutline(store, BOOK2);
ok('兜底：概率统计返回 kind=outline', fb.kind === 'outline', 'kind=' + fb.kind);
ok('兜底：isFallback=true', fb.isFallback === true);

// 清理临时目录
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) {}

console.log('\nSYLLABUS 单测： ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
