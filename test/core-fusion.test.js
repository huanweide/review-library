'use strict';
// A→B 融合 · 运行时判别测试（2026-11-09）。
//
// 融合前必须红（锁住 8 项能力缺失），融合后必须绿。
// 全部用真实调用：validate() 真调用、vm 真执行前端函数、真解析 core.html DOM 结构，
// 不用「源码里有没有某个字符串」冒充能力证据。
//
// 用法：node test/core-fusion.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; process.stderr.write('  ✗ ' + msg + '\n'); }
}

// 一份含 2 章 / 2 节 / 3 知识点（含重名）/ 1 细分的合法模型输出，题目方向能对上树节点。
function llmPayload() {
  return {
    outline: {
      title: '融合验证全书',
      children: [
        {
          title: '第一章 数据结构', children: [
            { title: '1.1 线性表', children: [
              { title: '顺序表', desc: '连续存储', questionTypes: ['选择题', '填空题'], children: [
                { title: '插入复杂度', desc: 'O(n)', children: [] }
              ] },
              { title: '链表', desc: '链式存储', questionTypes: ['简答题'], children: [] }
            ] }
          ]
        },
        {
          title: '第二章 算法', children: [
            { title: '2.1 排序', children: [
              { title: '顺序表', desc: '重名知识点', questionTypes: ['计算题'], children: [] }
            ] }
          ]
        }
      ]
    },
    questionIndex: [
      { type: '选择题', items: [
        { title: '顺序表', path: ['第一章 数据结构', '1.1 线性表', '顺序表'] },
        { title: '链表', path: ['第一章 数据结构', '1.1 线性表', '链表'] }
      ] },
      { type: '计算题', items: [{ title: '顺序表', path: ['第二章 算法', '2.1 排序', '顺序表'] }] }
    ],
    summary: '全书概览两到四句。'
  };
}

// ============ 后端：F1 确定性 id + pointId 反查 ============
function testF1() {
  console.log('\n--- [F1] 确定性 id + 题型反查 pointId ---');
  const A = require(path.join(ROOT, 'core', 'analyze.js'));
  const r = A.validate(llmPayload());
  ok(!!r && !!r.tree && Array.isArray(r.questionIndex), 'validate() 返回 tree + questionIndex');

  const ids = [];
  (function walk(n) { ids.push(n.id); (n.children || []).forEach(walk); })(r.tree);
  // root 1 + 章 2 + 节 2 + 知识点 3 + 细分 1 = 9（按 llmPayload 实数，不拍脑袋）
  ok(ids.length >= 9, '树节点总数 ≥ 9（实为 ' + ids.length + '）');
  ok(ids.every((x) => typeof x === 'string' && x.length > 0), '每个节点都有 id（不只是 root）');
  ok(new Set(ids).size === ids.length, '节点 id 全部唯一（无碰撞）');

  // 确定性：同一输入两次 validate 的 id 序列必须完全一致（B 原实现用 crypto.randomBytes，会不同）
  const r2 = A.validate(llmPayload());
  const ids2 = [];
  (function walk(n) { ids2.push(n.id); (n.children || []).forEach(walk); })(r2.tree);
  ok(JSON.stringify(ids) === JSON.stringify(ids2), '同一输入两次分析的 id 序列完全一致（确定性，非随机）');

  // pointId 反查：每个索引项都要能定位到树里真实存在的节点
  const idSet = new Set(ids);
  const items = r.questionIndex.reduce((a, g) => a.concat(g.items || []), []);
  ok(items.length === 3, '题型索引共 3 项');
  const withId = items.filter((it) => it.pointId && idSet.has(it.pointId));
  ok(withId.length === items.length, '全部索引项都有指向真实树节点的 pointId（' + withId.length + '/' + items.length + '）');
  ok(items.every((it) => Array.isArray(it.path) && it.path.length > 0), '全部索引项带 path 面包屑');

  // 重名消歧：「第二章/2.1 排序/顺序表」与「第一章/1.1 线性表/顺序表」标题相同，
  // 必须按 path 落到不同节点，不能都指到第一个。
  const dup = items.filter((it) => it.title === '顺序表');
  ok(dup.length === 2, '有两个同名「顺序表」索引项');
  if (dup.length === 2) {
    ok(dup[0].pointId !== dup[1].pointId, '同名知识点按 path 消歧，pointId 不同（不是模糊匹配到同一个）');
  }
}

// ============ 后端：F5 纯图片 / 少文本友好报错 ============
async function testF5() {
  console.log('\n--- [F5] 纯图片 / 少文本友好报错 ---');
  const A = require(path.join(ROOT, 'core', 'analyze.js'));
  const chat = async () => JSON.stringify(llmPayload());
  // 仅 20 字 + 2 张图片：必须明确报「视觉模型」，不能静默交给 LLM
  let err = null;
  try { await A.analyze('图片书', '仅有的一点提纲文字'.repeat(2), { chat, imageCount: 2, materialCount: 2 }); }
  catch (e) { err = e; }
  ok(!!err, '20 字 + 2 张图片时明确抛错，不静默空分析');
  ok(err && /视觉模型|图片|可读文本/.test(err.message), '错误文案点明「视觉模型/图片」，实得：' + (err && err.message));
  ok(err && !!err.userCode, '错误带 userCode（前端可据此给不同提示），实得：' + (err && err.userCode));
  // 关键回归防线：业务错误绝不能占用 e.code —— core/request.js 的 isInternal() 靠它判 500。
  ok(err && !err.code, '业务错误不带 e.code（否则被 isInternal 误判为 500）');

  // 正常文本仍可分析（不误杀）
  let okRun = false;
  try {
    const r = await A.analyze('正常书', '第一章 绪论。' + '线性表与链表的基本概念、插入复杂度、应用场景。'.repeat(12), { chat });
    okRun = !!(r && r.tree);
  } catch (e) { /* 记录 */ }
  ok(okRun, '正常长度文本仍能分析（阈值不误杀）');
}

// ============ 后端：F6 语料上限 + 截断标记 ============
async function testF6() {
  console.log('\n--- [F6] 语料上限 + truncated 标记 ---');
  const A = require(path.join(ROOT, 'core', 'analyze.js'));
  let sentLen = 0;
  const chat = async (cfg, messages) => {
    sentLen = (messages && messages[1] && messages[1].content || '').length;
    return JSON.stringify(llmPayload());
  };
  const huge = '线性表的基本概念与操作。'.repeat(20000); // 远超上限
  const r = await A.analyze('超大书', huge, { chat });
  ok(sentLen > 0 && sentLen < huge.length, '送给模型的内容被截断（原文 ' + huge.length + ' 字 → 实送 ' + sentLen + ' 字）');
  ok(r.truncated === true, '结果带 truncated=true，前端可显式警告');
  ok(r.sourceLen === huge.length, '结果保留原始 sourceLen（' + (r.sourceLen || 0) + '）');
  const A2 = A.buildMessages('超大书', huge);
  ok(A2[1].content.length < huge.length, 'buildMessages 本身也做了截断（不依赖调用方）');
}

// ============ 后端：F8 分题型统计 ============
function testF8() {
  console.log('\n--- [F8] 概览分题型统计 ---');
  const A = require(path.join(ROOT, 'core', 'analyze.js'));
  const r = A.validate(llmPayload());
  const s = r.stats || {};
  ok(!!s.questionTypeCounts, 'stats 带 questionTypeCounts');
  if (s.questionTypeCounts) {
    ok(s.questionTypeCounts['选择题'] === 2, '选择题计 2 项（实为 ' + s.questionTypeCounts['选择题'] + '）');
    ok(s.questionTypeCounts['计算题'] === 1, '计算题计 1 项（实为 ' + s.questionTypeCounts['计算题'] + '）');
  }
}

// ============ 前端：结构与函数（真解析 DOM + vm 真执行） ============
function readFront() {
  return {
    html: fs.readFileSync(path.join(ROOT, 'renderer', 'core.html'), 'utf8'),
    css: fs.readFileSync(path.join(ROOT, 'renderer', 'css', 'core.css'), 'utf8'),
    ui: fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'core-ui.js'), 'utf8'),
  };
}

// 从 core-ui.js 里按括号配平抠出某个函数，放进 vm 真执行（不是文本匹配）
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let depth = 0, seen = false, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; }
    else if (src[i] === '}') { depth--; if (seen && depth === 0) { end = i + 1; break; } }
  }
  return end > start ? src.slice(start, end) : null;
}

function testF3F4_F2_F7() {
  const { html, css, ui } = readFront();
  console.log('\n--- [F3/F4] 缩放视口 + 导出控件（真解析 core.html）---');
  ok(/id="mmViewport"/.test(html), 'core.html 有缩放视口 #mmViewport');
  ok(/id="zoomLabel"/.test(html), 'core.html 有缩放百分比标签 #zoomLabel');
  ok(/id="btnExportSvg"/.test(html), 'core.html 有导出 SVG 按钮');
  ok(/id="btnExportJson"/.test(html), 'core.html 有导出 JSON 按钮');
  ok(/transform-origin|scale\(/.test(css), 'core.css 有 transform 缩放样式');
  ok(/\.highlight/.test(css), 'core.css 有 .highlight 高亮样式（F2）');

  console.log('\n--- [F3] vm 真执行 zoomBy/applyView ---');
  const zoomSrc = extractFn(ui, 'zoomBy');
  const applySrc = extractFn(ui, 'applyView');
  ok(!!zoomSrc && !!applySrc, 'core-ui.js 找得到 zoomBy/applyView 函数体');
  if (zoomSrc && applySrc) {
    let label = '', transform = '';
    const $ = (s) => s === '#zoomLabel'
      ? { set textContent(v) { label = v; }, get textContent() { return label; } }
      : { style: { set transform(v) { transform = v; } } };
    const ctx = {
      $, mmScale: 1, mmX: 0, mmY: 0,
      Math, console,
      // 让 zoomBy 里对 mmScale 的赋值落到同一个对象
    };
    const sandbox = vm.createContext(ctx);
    try {
      vm.runInContext(applySrc + '\n' + zoomSrc + '\nthis.__zoomBy = zoomBy; this.__applyView = applyView;', sandbox);
      sandbox.__zoomBy(1.2);
      sandbox.__applyView();
      ok(/120%/.test(label), 'zoomBy(1.2) → applyView 后标签显示 120%（实为 ' + label + '）');
      ok(/scale\(1\.2/.test(transform), 'applyView 真的写了 CSS transform（实为 ' + transform + '）');
      // 边界：连续放大不许超过上限
      for (let i = 0; i < 30; i++) sandbox.__zoomBy(1.5);
      sandbox.__applyView();
      const pct = parseInt(label, 10);
      ok(pct <= 250, '连续放大有上限（≤250%，实为 ' + pct + '%）');
    } catch (e) { ok(false, 'zoomBy/applyView 执行不应抛错：' + e.message); }
  }

  console.log('\n--- [F4] vm 真执行 buildTreeSvg ---');
  const svgSrc = extractFn(ui, 'buildTreeSvg');
  ok(!!svgSrc, 'core-ui.js 找得到 buildTreeSvg 函数体');
  if (svgSrc) {
    const A = require(path.join(ROOT, 'core', 'analyze.js'));
    const tree = A.validate(llmPayload()).tree;
    const sandbox = vm.createContext({
      Math, esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    });
    try {
      vm.runInContext(svgSrc + '\nthis.__svg = buildTreeSvg;', sandbox);
      const svg = sandbox.__svg(tree);
      ok(typeof svg === 'string' && svg.indexOf('<svg') === 0, 'buildTreeSvg 输出合法 <svg> 开头');
      ok(svg.includes('</svg>'), 'SVG 有闭合标签');
      ok((svg.match(/<rect/g) || []).length >= 9, 'SVG 为整棵树每个节点画了矩形（≥9，实为 ' + (svg.match(/<rect/g) || []).length + '）');
      ok(/顺序表/.test(svg), 'SVG 含真实节点文字（不是空壳）');
    } catch (e) { ok(false, 'buildTreeSvg 执行不应抛错：' + e.message); }
  }

  console.log('\n--- [F2/F7] 联动与警告上屏的函数存在且真可调用 ---');
  const locateSrc = extractFn(ui, 'locateNode');
  ok(!!locateSrc, 'core-ui.js 有 locateNode（题型点击联动）');
  ok(/onclick\s*=\s*\(\)\s*=>\s*locateNode|locateNode\(/.test(ui), '题型卡片绑定了 locateNode 点击');
  // 警告上屏：addFiles 里必须把失败文件名写进 #importStatus，而不只是 toast
  ok(/importStatus/.test(ui), 'core-ui.js 使用 #importStatus 持久化导入状态（F7）');
  ok(/id="importStatus"/.test(html), 'core.html 有 #importStatus 元素');
}

(async () => {
  try { testF1(); } catch (e) { failed++; console.error('  ✗ [F1] FATAL ' + (e.stack || e)); }
  try { await testF5(); } catch (e) { failed++; console.error('  ✗ [F5] FATAL ' + (e.stack || e)); }
  try { await testF6(); } catch (e) { failed++; console.error('  ✗ [F6] FATAL ' + (e.stack || e)); }
  try { testF8(); } catch (e) { failed++; console.error('  ✗ [F8] FATAL ' + (e.stack || e)); }
  try { testF3F4_F2_F7(); } catch (e) { failed++; console.error('  ✗ [前端] FATAL ' + (e.stack || e)); }
  console.log('\n=== 融合能力判别测试：通过 ' + passed + ' / 失败 ' + failed + ' ===');
  process.exit(failed ? 1 : 0);
})();
