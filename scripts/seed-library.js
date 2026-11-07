'use strict';
// 铺真实科目资料：把工作区已有的真实复习资料按层导入图书馆。
// 原则：只搬运真实存在的文件，不编造任何考纲/题目/答案内容；文件来源逐条写在 rec 的 prompt 里。
// 可重复执行：同一本书若已存在（按 title 判断）则跳过，不会重复塞。
// 用法：node scripts/seed-library.js           → 写入项目内 library/
//       LIBRARY_ROOT=xxx node scripts/seed-library.js → 写入指定目录（桌面版可用）
const fs = require('fs');
const path = require('path');
const { Store } = require('../lib/store');

const WORKSPACE = path.join(__dirname, '..', '..');           // agent program/
const ROOT = process.env.LIBRARY_ROOT || path.join(__dirname, '..', 'library');
const store = new Store(ROOT);

function file(rel) {
  const p = path.join(WORKSPACE, rel);
  if (!fs.existsSync(p)) throw new Error('真实资料不存在：' + p);
  return { name: path.basename(p), data: fs.readFileSync(p).toString('base64'), _src: rel };
}
function md(text, name) { return { name, data: Buffer.from(text, 'utf8').toString('base64') }; }

// JS 数据文件转成 markdown 索引（提取真实条目，不新增内容）
function jsIndex(rel, title) {
  const src = fs.readFileSync(path.join(WORKSPACE, rel), 'utf8');
  const m = src.match(/=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!m) throw new Error('无法解析 ' + rel);
  const arr = JSON.parse(m[1]);
  const lines = ['# ' + title, '', '> 本文件由 ' + rel + ' 自动转成可读索引；原数据以该 JS 文件为准。共 ' + arr.length + ' 条。', ''];
  arr.forEach((it, i) => {
    const parts = [it.id, it.sec || it.ch, it.text || it.q || it.stem].filter(Boolean);
    lines.push((i + 1) + '. ' + parts.join(' ｜ '));
  });
  return md(lines.join('\n'), title + '.md');
}

const BOOKS = [
  {
    meta: {
      title: '工程材料', exam: '2026 秋季期末', subject: '材料科学与工程',
      coverColor: '#3a7afe', note: '来源：期末复习 PPT 30 页文字层 + 作业 PDF 14 页，本机抽取'
    },
    layers: [
      { layer: 1, prompt: '期末总复习提纲：只收 PPT 里有的知识点，越上层参考价值越强', tags: ['核心', '考纲'], files: [
        file('备考插件-考纲.md'), file('备考插件/成果文件/考纲题库答案.md')
      ] },
      { layer: 2, prompt: '作业与自拟题：86 道题，答案依据写回考纲编号', tags: ['作业', '题库'], files: [
        file('备考插件-第一章讲义样本.md'), file('备考插件/成果文件/题库.json')
      ] },
      { layer: 3, prompt: '可检索索引：由本项目的 JS 数据文件转成 markdown，便于全文搜与生成提纲', tags: ['索引'], files: [
        jsIndex('考点罗盘/data/kaogang.js', '考纲-229考点索引'),
        jsIndex('考点罗盘/data/tiku.js', '题库-86题索引')
      ] }
    ]
  },
  {
    meta: {
      title: '概率统计', exam: 'AI 实践作业', subject: '概率论与数理统计',
      coverColor: '#1f9d72', note: '来源：正态分布侦探作业答案与示意图（本机真实产出）'
    },
    layers: [
      { layer: 1, prompt: '核心答案：正态分布参数与 3σ 规则', tags: ['核心', '答案'], files: [
        file('正态分布侦探-AI实践/答案-正态分布侦探.md'),
        file('正态分布侦探-AI实践/答案-正态分布侦探.docx')
      ] },
      { layer: 2, prompt: '作业截图与示意图', tags: ['图片', '示意图'], files: [
        file('正态分布侦探-AI实践/正态分布示意图-3σ规则.png'),
        file('正态分布侦探-AI实践/正态分布示意图-男生身高分布直方图.png'),
        file('正态分布侦探-AI实践/答案-正态分布侦探-第1页.png'),
        file('正态分布侦探-AI实践/答案-正态分布侦探-第2页.png')
      ] }
    ]
  }
];

console.log('种子数据目录：' + ROOT);
let created = 0, added = 0;
BOOKS.forEach(spec => {
  const exists = store.listBooks().find(b => b.title === spec.meta.title);
  if (exists) { console.log('跳过（已存在）：' + spec.meta.title); return; }
  const book = store.createBook(spec.meta);
  created++;
  spec.layers.forEach(L => {
    const items = L.files.map(f => ({ name: f.name, data: f.data }));
    const srcs = L.files.map(f => f._src || '(由 JS 数据生成)').filter(Boolean);
    const recs = store.addMaterials(book.id, L.layer, items, {
      prompt: L.prompt + '｜来源：' + srcs.join('；'),
      tags: L.tags, source: 'user'
    });
    added += recs.length;
    console.log('  ' + spec.meta.title + ' L' + L.layer + ' +' + recs.length + ' 份');
  });
});
console.log('\n新建书 ' + created + ' 本，导入资料 ' + added + ' 份。');
console.log('当前书架：');
store.listBooks().forEach(b => console.log('  · ' + b.title + '（资料 ' + b.materialCount + '，层 ' + Object.keys(b.layerCounts || {}).length + '）'));
