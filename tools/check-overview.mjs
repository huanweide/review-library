#!/usr/bin/env node
/**
 * 概览摘要 + 导图节点可读性 · 判别测试（旧版必红 / 改后必绿）。
 *
 *   node tools/check-overview.mjs
 *
 * 锚点：PROCESS/research-概览与导图可读性/best-practices.md
 *   markmap 13,277★：`Other text ... stays with its branch as a note that opens in a popover`
 *   Visual Paradigm `Wrap Width` / jsMind `view.node_overflow: wrap`：长文字换行，不省略号吞字
 *   复盘小站：`内容总览：用 4–6 个带小标题的要点，整体概括材料讲了什么`
 *   SuperPDF 复盘：`Only a screenshot caught the truncation`（宽度类 bug 必须真截图，本脚本只锁可自动判定的部分）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const L = require(path.join(ROOT, 'renderer/js/mindmap-layout.js'));
const BS = fs.readFileSync(path.join(ROOT, 'workbench/src/bookspace.js'), 'utf8');
const MM = fs.readFileSync(path.join(ROOT, 'workbench/src/mindmap.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'workbench/sw.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + String(extra).slice(0, 220) : '')); }
};

const LONG = '(1) 正态分布曲线的两个参数与标准正态分布之间的换算关系';
const DESC = '这一节讲正态分布曲线的两个参数怎么换算，属于历年真题的高频考点';
const TREE = {
  id: 'root', title: '概率统计', desc: '', children: [
    { id: 'ch1', title: '正态分布', desc: '', children: [
      { id: 'p1', title: LONG, desc: DESC, children: [] },
    ] },
  ],
};

console.log('[A] 导图节点：短标签 + 自动换行，长描述不塞节点');
const svg = L.toSvg(L.layoutTree(TREE, 'right'), {});
ok('A1 节点标题有 tspans（换行而不是单行截断）', /<tspan/.test(svg), '没有 tspan');
// 只看目标节点那一个 <text>：整张 SVG 里每个节点都会有多行 tspan，
// 全局数会把所有节点的行加起来，得到假红（本轮实测踩过，行数=5）。
const textBlocks = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1]);
// 换行会把「换算关系」劈到两行里（…换算关 / 系），不能用完整词找块，否则会挑到根节点那块。
const targetBlock = textBlocks.find(b => b.includes('换算')) || textBlocks[0] || '';
const lineTexts = [...targetBlock.matchAll(/<tspan[^>]*>([\s\S]*?)<\/tspan>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
const joined = lineTexts.join('');
ok('A2 长标题全文保留（不吞字）', joined.includes(LONG.slice(0, 10)) && joined.includes('换算关系'), joined.slice(0, 120));
ok('A3 没有省略号截断', !joined.includes('…'), joined);
ok('A4 最多三行（58px 卡片放得下，不缩字号）', lineTexts.length > 0 && lineTexts.length <= 3, '行数=' + lineTexts.length);
ok('A5 节点里不再画 11px 灰色描述', !svg.includes(DESC), 'desc 仍在 SVG 里');
ok('A6 提示框保留全文（信息不丢）', /tip\.textContent = String\(n\.title/.test(MM) && /n\.desc/.test(MM));
ok('A7 不缩小字号硬塞', /const fs = typeFs\(n\.depth\)/.test(fs.readFileSync(path.join(ROOT, 'renderer/js/mindmap-layout.js'), 'utf8')));

console.log('[B] 概览摘要：模型没给也要从真实分析派生');
let derive = null;
try {
  const m = await import(pathToFileURL(path.join(ROOT, 'workbench/src/overview.mjs')).href);
  derive = m.deriveOverview;
} catch (e) { fail++; console.log('  ✗ B0 overview.mjs 可导入  → ' + String(e.message).slice(0, 160)); }
if (derive) {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'library/books/b_801c90e933dc/analysis.json'), 'utf8'));
  const out = derive(real);
  ok('B1 返回结构化要点（4–6 条）', Array.isArray(out.points) && out.points.length >= 3 && out.points.length <= 6,
    '条数=' + (out.points || []).length);
  ok('B2 标明来源是派生而不是模型原文', out.kind === 'derived', out.kind);
  const allText = JSON.stringify(out);
  const chapters = (real.tree && real.tree.children || []).map(c => c.title).filter(Boolean);
  ok('B3 至少含一个真实章节名（不编造）', chapters.some(c => c && allText.includes(String(c).slice(0, 6))), chapters.join(' / ').slice(0, 100));
  ok('B4 含真实统计数', allText.includes(String((real.stats || {}).points)) && allText.includes(String((real.stats || {}).questionCount)), allText.slice(0, 160));
  const modelCase = derive(Object.assign({}, real, { summary: '模型写的摘要' }));
  ok('B5 模型给了摘要就优先用它', modelCase.kind === 'model' && JSON.stringify(modelCase).includes('模型写的摘要'), modelCase.kind);
  const empty = derive({});
  ok('B6 无数据时不编内容、明说不足', empty.kind === 'empty' && /没有可概括|暂无/.test(JSON.stringify(empty)), JSON.stringify(empty));
  ok('B7 不出现空洞占位文案', !JSON.stringify(derive(real)).includes('（模型没有给摘要）'));
}

console.log('[C] 接线：三端一致、不新增 action、前端可加载');
ok('C1 概览页调用 deriveOverview', /deriveOverview\(/.test(BS) && !/a\.summary \|\| '（模型没有给摘要）'/.test(BS));
ok('C2 新模块进 SW 清单', /\.\/src\/overview\.mjs/.test(SW));
ok('C3 能力清单不变（12 项）', require(path.join(ROOT, 'core/capabilities.js')).ACTIONS.length === 12);
ok('C4 导图仍走确定性格子布局（未改力导向）', /NODE_W = 224, NODE_H = 58/.test(fs.readFileSync(path.join(ROOT, 'renderer/js/mindmap-layout.js'), 'utf8')));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
