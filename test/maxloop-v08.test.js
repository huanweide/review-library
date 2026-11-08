'use strict';
// v0.8 判别测试：考纲思维导图模块。
// baseline：lib/mindmap.js 与四层 API 镜像都不存在 → 全红。
// candidate：实现后 → 全绿。

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const src = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return ''; } };

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? (' :: ' + extra) : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

let mindmap = null, loadErr = null;
try { mindmap = require('../lib/mindmap'); } catch (e) { loadErr = e; }
const MISSING = !mindmap;

function makeStore() {
  const { Store } = require('../lib/store');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-mm-'));
  const store = new Store(tmp);
  const b = store.createBook({ title: '材料科学基础' });
  const md = [
    '---', 'title: 材料科学基础', 'tags: [考纲]', '---', '',
    '# 第一章 晶体结构', '## 1.1 晶体', '| 编号 | 知识点 | 对应题型 |', '| --- | --- | --- |',
    '| 1.1.1 | 晶体的定义 | 选择、名词解释 |', '| 1.1.2 | 晶体的致密度 | 计算 |', '| 1.1.3 | 晶体的类型 | 简答 |',
    '## 1.2 石墨', '| 编号 | 知识点 | 对应题型 |', '| --- | --- | --- |',
    '| 1.2.1 | 石墨的结构 | 名词解释 |', '| 1.2.2 | 石墨的特性 | 简答 |'
  ].join('\n');
  const bank = { items: [
    { id: 1, type: '名词解释', stem: '什么是晶体？', kp: '1.1.1', ans: '原子规则排列', why: '长程有序' },
    { id: 2, type: '计算', stem: '求面心立方致密度', kp: '1.1.2', ans: '0.74', why: '球堆积' },
    { id: 3, type: '简答', stem: '晶体有哪些类型？', kp: '1.1.3', ans: '七大晶系', why: '对称要素' },
    { id: 4, type: '名词解释', stem: '石墨结构是什么？', kp: '1.2.1', ans: '层状sp2', why: '六边形' }
  ] };
  store.addMaterials(b.id, 1, [{ name: '考纲.md', ext: '.md', data: Buffer.from(md).toString('base64') }]);
  store.addMaterials(b.id, 2, [{ name: '题库.json', ext: '.json', data: Buffer.from(JSON.stringify(bank)).toString('base64') }]);
  return { store, bookId: b.id };
}

async function withMockChat(fn) {
  const llm = require('../lib/llm');
  const orig = llm.chat;
  llm.chat = async () => JSON.stringify({
    maps: [
      { centerTitle: '晶体', centerSummary: '原子规则排列的固体', nodes: [
        { title: '晶体的定义', summary: '长程有序', children: [{ title: '空间点阵', summary: '阵点在空间周期排列' }],
          questionTypes: [], related: ['石墨的结构'] },
        { title: '晶体的致密度', summary: '堆积紧密程度', children: [], questionTypes: [], related: [] }
      ] },
      { centerTitle: '石墨', centerSummary: '层状碳材料', nodes: [
        { title: '石墨的结构', summary: 'sp2 层状', children: [], questionTypes: [], related: ['晶体的定义'] }
      ] }
    ]
  });
  try { return await fn(); } finally { llm.chat = orig; }
}

(async () => {
  console.log('v0.8 判别测试（改动前必红，改动后必绿）');

  section('一、模块与四层 API 镜像存在性');
  ok('V1 lib/mindmap.js 存在', !MISSING, loadErr ? String(loadErr.message) : '文件未创建');
  ok('V2 server.js 挂 /api/mindmap 路由', /mindmap/.test(src('server.js')));
  ok('V3 app/main.js 有 mindmap: ipc', /mindmap:/.test(src('app/main.js')));
  ok('V4 app/preload.js 有 mindmap 桥', /mindmap:/.test(src('app/preload.js')));
  ok('V5 renderer/js/api-client.js 有 mindmap 客户端', /mindmap:/.test(src('renderer/js/api-client.js')));

  section('二、规则版：中心辐射 + 题型分类');
  let ruleMaps = null;
  if (MISSING) {
    ok('V6 规则版生成多中心图（每节一张）', false, 'module missing');
    ok('V7 每张图是中心辐射结构', false, 'module missing');
    ok('V8 节点挂题型分组并含题库题', false, 'module missing');
    ok('V9 单题题型标记为 single（进右侧题目分类）', false, 'module missing');
  } else {
    const { store, bookId } = makeStore();
    try { ruleMaps = await mindmap.generate(store, bookId, null, { force: true }); }
    catch (e) { ok('V6 规则版生成异常', false, e.message); }
    ok('V6 规则版生成多中心图（每节一张：晶体/石墨 → ≥2）', ruleMaps && ruleMaps.maps && ruleMaps.maps.length >= 2, ruleMaps && ('maps=' + (ruleMaps.maps || []).length));
    ok('V7 每张图是中心辐射结构（有 centerTitle 且 nodes 为数组）',
      ruleMaps && ruleMaps.maps.every(m => m.centerTitle && Array.isArray(m.nodes) && m.nodes.length > 0));
    const hasQ = ruleMaps && ruleMaps.maps.some(m => m.nodes.some(n => n.questionTypes && n.questionTypes.some(qt => qt.questions && qt.questions.length)));
    ok('V8 节点挂题型分组并含题库题', !!hasQ);
    const hasSingle = ruleMaps && ruleMaps.maps.some(m => m.nodes.some(n => (n.questionTypes || []).some(qt => qt.single === true)));
    ok('V9 单题题型标记为 single（进右侧题目分类）', !!hasSingle);
  }

  section('三、LLM 版：summary / children / related + 双链');
  let llmMaps = null;
  if (MISSING) {
    ok('V10 LLM 版产出 summary/children/related', false, 'module missing');
    ok('V11 related 双向（A.related 含 B ⇒ B 可反向定位）', false, 'module missing');
  } else {
    const { store, bookId } = makeStore();
    llmMaps = await withMockChat(() => mindmap.generate(store, bookId, { baseURL: 'x', apiKey: 'y', model: 'm' }, { force: true }));
    ok('V10 LLM 版产出 summary/children/related',
      llmMaps && llmMaps.maps.some(m => m.nodes.some(n => n.summary && Array.isArray(n.children) && Array.isArray(n.related))));
    const crystal = llmMaps.maps.find(m => m.centerTitle === '晶体');
    const graphite = llmMaps.maps.find(m => m.centerTitle === '石墨');
    const relatedTarget = crystal && crystal.nodes.find(n => (n.related || []).includes('石墨的结构'));
    const backFound = graphite && graphite.nodes.some(n => n.title === '石墨的结构');
    ok('V11 related 双向（A.related 含 B ⇒ B 可反向定位）', !!(relatedTarget && backFound));
  }

  section('四、沉淀 / 去重 / 增量合并');
  if (MISSING) {
    ok('V12 merge 按 title 去重且不覆盖既有 summary', false, 'module missing');
  } else {
    const { store, bookId } = makeStore();
    const base = await mindmap.generate(store, bookId, null, { force: true });
    const incoming = JSON.parse(JSON.stringify(base));
    const someMap = incoming.maps[0];
    const someNode = someMap.nodes[0];
    someNode.related = (someNode.related || []).concat(['全新关联X']);
    const merged = mindmap.mergeMaps(base, incoming);
    const mNode = merged.maps[0].nodes.find(n => n.title === someNode.title);
    const keptSummary = mNode && (mNode.summary === someNode.summary);
    const appended = mNode && (mNode.related || []).includes('全新关联X');
    ok('V12 merge 按 title 去重且不覆盖既有 summary、只追加新关联', !!(merged && keptSummary && appended));
  }

  console.log('\n----------------------------------------');
  console.log('v0.8 判别测试：通过 ' + pass + ' / 失败 ' + fail);
  if (fails.length) console.log('失败项：\n - ' + fails.join('\n - '));
  console.log('----------------------------------------');
  process.exit(fail ? 1 : 0);
})();
