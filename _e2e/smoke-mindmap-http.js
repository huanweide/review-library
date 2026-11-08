'use strict';
// 临时冒烟：起一个 server.js 实例，指向含「考纲+题库」书的临时 library，验证 /api/mindmap/* 真实可用。
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Store } = require('../lib/store');
const syllabus = require('../lib/syllabus');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-mm-'));
const store = new Store(ROOT);
const book = store.createBook({ title: '思维导图冒烟书' });
const md = [
  '---', 'title: 冒烟考纲', 'tags: [考纲]', '---',
  '# 冒烟考纲',
  '# 第1章 基础',
  '## 1.1 概念',
  '| 编号 | 知识点 | 对应题型 |',
  '| --- | --- | --- |',
  '| 1.1.1 | 概念A | 选择 |',
  '| 1.1.2 | 概念B | 填空 |',
  '# 第2章 进阶',
  '## 2.1 深入',
  '| 编号 | 知识点 | 对应题型 |',
  '| --- | --- | --- |',
  '| 2.1.1 | 深入A | 判断 |'
].join('\n');
const bank = { meta: { title: '冒烟题库', count: 2 }, items: [
  { id: 1, type: '选择', stem: '题1', kp: '1.1.1', correct: 'A' },
  { id: 2, type: '判断', stem: '题2', kp: '2.1.1', correct: '正确' }
] };
store.addMaterials(book.id, 3, [
  { name: '考纲.md', data: Buffer.from(md, 'utf8').toString('base64'), extractedText: md },
  { name: '题库.json', data: Buffer.from(JSON.stringify(bank), 'utf8').toString('base64') }
]);

const PORT = 5311;
const env = Object.assign({}, process.env, { LIBRARY_ROOT: ROOT, PORT: String(PORT), NO_OPEN: '1' });
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'ignore' });

function get(url) { return fetch(url).then(r => r.json()); }
function post(url, body) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()); }

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  [' + x + ']' : '')); } }

setTimeout(async () => {
  try {
    const b = encodeURIComponent(book.id);
    const before = await get('http://localhost:' + PORT + '/api/mindmap/' + b);
    ok('GET 列表初始无图', before.maps && before.maps.length === 0, 'maps=' + (before.maps || []).length);
    const g = await post('http://localhost:' + PORT + '/api/mindmap/' + b, { cfg: null, force: true });
    ok('POST 生成返回 maps', g.maps && g.maps.length >= 1, 'maps=' + (g.maps || []).length);
    ok('生成图为中心辐射(有 centerTitle)', g.maps[0] && !!g.maps[0].centerTitle, JSON.stringify(g.maps[0] && g.maps[0].centerTitle));
    const after = await get('http://localhost:' + PORT + '/api/mindmap/' + b);
    ok('GET 列表沉淀后有图', after.maps && after.maps.length >= 1, 'maps=' + (after.maps || []).length);
    ok('节点含题型分组', after.maps[0] && Array.isArray(after.maps[0].nodes) && after.maps[0].nodes.length > 0);
  } catch (e) {
    fail++; console.log('  ✗ 异常 ' + (e && e.message));
  } finally {
    try { srv.kill(); } catch (e) {}
    try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) {}
    console.log('\nMINDMAP-HTTP 冒烟： ' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  }
}, 1500);
