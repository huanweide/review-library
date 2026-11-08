#!/usr/bin/env node
'use strict';
// review-analysis driver：DSH skill 的离线引擎。
// 同项目理解：读取当前 review-library 项目的 library/（由 --project 指定），并按
//   REVIEW_ANALYSIS_STATE.json 轮转（处理进度记盘，下次续做，不推翻重来）。
// 一轮轮驱动：每轮处理若干本书（--rounds 控制轮转窗口），think→invoke 本地引擎→observe 聚合。
// 圆满格式：产出 report.md（Markdown 报告）+ mindmap.full.json（全展开思维导图）。
// 零云端：全部走本地 lib/*（store / syllabus / mindmap），不联网、不调用模型。

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--project') a.project = argv[++i];
    else if (x === '--library') a.library = argv[++i];
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--book') a.book = argv[++i];
    else if (x === '--rounds') a.rounds = Math.max(1, parseInt(argv[++i], 10) || 3);
  }
  return a;
}

function resolveCtx(a) {
  const project = path.resolve(a.project || process.cwd());
  let library = a.library;
  if (!library) {
    const cand = path.join(project, 'library');
    library = fs.existsSync(cand) ? cand : path.join(project, 'data');
  }
  library = path.resolve(library);
  if (!fs.existsSync(library)) {
    throw new Error('找不到数据目录，请指定 --project <review-library 根目录> 或 --library <library 目录>');
  }
  // lib 优先用项目内的（仓库内或安装后由 --project 指向项目），否则回退 skill 自带相对路径
  let libDir = path.join(project, 'lib');
  if (!fs.existsSync(libDir)) libDir = path.join(__dirname, '..', '..', 'lib');
  if (!fs.existsSync(libDir)) throw new Error('找不到 lib/ 引擎目录：' + libDir);
  const out = path.resolve(a.out || path.join(project, 'review-analysis-out'));
  return { project, library, libDir, out, book: a.book, rounds: a.rounds || 3 };
}

function slug(s) { return String(s == null ? '' : s).replace(/[^\w一-龥]+/g, '_').slice(0, 48); }
function log(s) { process.stdout.write('[driver] ' + s + '\n'); }

function loadState(project) {
  const f = path.join(project, 'REVIEW_ANALYSIS_STATE.json');
  try { return Object.assign({ lastIndex: 0, books: {} }, JSON.parse(fs.readFileSync(f, 'utf8'))); }
  catch (e) { return { lastIndex: 0, books: {} }; }
}
function saveState(project, st) {
  const f = path.join(project, 'REVIEW_ANALYSIS_STATE.json');
  fs.writeFileSync(f, JSON.stringify(st, null, 2));
}

function groupByLayer(materials) {
  const m = {};
  (materials || []).forEach(x => { const l = x.layer || 1; (m[l] = m[l] || []).push(x); });
  return m;
}

function outlineToMd(outline, L, depth) {
  depth = depth || 0;
  const ind = '  '.repeat(depth) + '- ';
  (outline && outline.chapters || []).forEach(ch => {
    L.push(ind + (ch.title || '章节'));
    (ch.sections || []).forEach(sec => {
      L.push('  '.repeat(depth + 1) + '- ' + (sec.title || '节'));
      (sec.points || []).forEach(p => {
        L.push('  '.repeat(depth + 2) + '- ' + (p.title || p.name || '知识点'));
        (p.children || []).forEach(c => L.push('  '.repeat(depth + 3) + '- ' + (c.title || c.name || '')));
      });
    });
  });
}

function renderReport(books, bookReports, mm) {
  const L = [];
  L.push('# 复习分析总报告');
  L.push('');
  L.push('> 生成时间：' + mm.generatedAt + ' · 项目：' + mm.project);
  L.push('> 书目：' + mm.bookCount + ' 本 · 思维导图节点：' + mm.nodes.length + ' · 边：' + mm.edges.length + '（全展开）');
  L.push('');
  L.push('## 一、书目总览');
  L.push('');
  L.push('| 书名 | 考试 | 科目 | 资料数 | 层分布 |');
  L.push('| --- | --- | --- | --- | --- |');
  bookReports.forEach(br => {
    const layers = Object.keys(br.materials).sort((x, y) => x - y)
      .map(l => 'L' + l + '·' + br.materials[l].length).join('，') || '空';
    L.push('| ' + br.book.title + ' | ' + (br.book.exam || '-') + ' | ' + (br.book.subject || '-') +
      ' | ' + br.total + ' | ' + layers + ' |');
  });
  L.push('');
  L.push('## 二、逐书分析（全展开大纲）');
  L.push('');
  bookReports.forEach(br => {
    L.push('### 《' + br.book.title + '》');
    L.push('');
    L.push('- 考试：' + (br.book.exam || '-') + ' · 科目：' + (br.book.subject || '-'));
    L.push('- 资料：' + (Object.keys(br.materials).sort((x, y) => x - y)
      .map(l => 'L' + l + '·' + br.materials[l].length + ' 份').join('，') || '无'));
    L.push('');
    L.push('#### 考纲大纲');
    outlineToMd(br.outline, L, 0);
    L.push('');
  });
  L.push('## 三、思维导图摘要');
  L.push('');
  L.push('全展开 JSON 见 `mindmap.full.json`。中心节点（每章/每节一张）：');
  L.push('');
  mm.nodes.filter(n => n.kind === 'center').forEach(n => L.push('- ' + n.title + '（' + n.bookTitle + '）'));
  L.push('');
  return L.join('\n');
}

async function main() {
  const ctx = resolveCtx(parseArgs(process.argv.slice(2)));
  log('项目：' + ctx.project);
  log('数据目录：' + ctx.library);
  log('引擎目录：' + ctx.libDir);
  log('输出目录：' + ctx.out);

  const { Store } = require(path.join(ctx.libDir, 'store'));
  const syllabus = require(path.join(ctx.libDir, 'syllabus'));
  const mindmap = require(path.join(ctx.libDir, 'mindmap'));
  const store = Store(ctx.library);

  let books = store.listBooks() || [];
  if (ctx.book) books = books.filter(b => b.id === ctx.book || b.title === ctx.book);
  if (!books.length) { log('没有可分析的书。'); return; }

  const state = loadState(ctx.project);
  const fullNodes = [], fullEdges = [], bookReports = [];

  // 一轮轮驱动：按轮转窗口挑书，处理进度记盘到 state，下次续做
  const start = ctx.book ? 0 : (state.lastIndex || 0) % books.length;
  const window = ctx.book ? books.length : Math.min(ctx.rounds, books.length);
  const order = [];
  for (let i = 0; i < window; i++) order.push(books[(start + i) % books.length]);

  for (const b of order) {
    const bookId = b.id;
    log('round：分析《' + b.title + '》');
    // think + invoke 本地引擎（规则版，离线）
    let g; try { g = store.getBook(bookId) || {}; } catch (e) { g = {}; }
    const materials = (g.materials || []);
    const byLayer = groupByLayer(materials);
    let outline = { chapters: [] }, maps = [];
    try { outline = syllabus.buildBookOutline(store, bookId) || outline; } catch (e) { log('  大纲生成跳过：' + e.message); }
    let bankQs = []; try { bankQs = syllabus.getBankQuestions(store, bookId) || []; } catch (e) {}
    try { maps = mindmap.buildRuleMaps(outline, bankQs) || []; } catch (e) { log('  思维导图生成跳过：' + e.message); }

    // observe：聚合进全展开图
    maps.forEach(m => {
      const centerId = 'book:' + bookId + ':center:' + slug(m.centerTitle);
      fullNodes.push({ id: centerId, title: m.centerTitle, summary: m.centerSummary || '', kind: 'center', bookId, bookTitle: b.title });
      (m.nodes || []).forEach(n => {
        const nid = 'book:' + bookId + ':node:' + slug(n.title);
        fullNodes.push({ id: nid, title: n.title, summary: n.summary || '', layer: n.layer, kind: 'point', bookId, bookTitle: b.title, children: (n.children || []).map(c => c.title) });
        fullEdges.push({ source: centerId, target: nid, rel: 'contains' });
        (n.related || []).forEach(r => {
          const rid = 'book:' + bookId + ':rel:' + slug(r);
          if (!fullNodes.find(x => x.id === rid)) fullNodes.push({ id: rid, title: r, kind: 'related', bookId, bookTitle: b.title });
          fullEdges.push({ source: nid, target: rid, rel: 'related' });
        });
      });
    });

    bookReports.push({ book: b, materials: byLayer, total: materials.length, outline, maps });
    state.books[bookId] = { title: b.title, lastAnalyzed: new Date().toISOString(), materials: materials.length, maps: maps.length };
  }

  if (!ctx.book) state.lastIndex = (start + window) % books.length;
  saveState(ctx.project, state);

  fs.mkdirSync(ctx.out, { recursive: true });
  const mm = { generatedAt: new Date().toISOString(), project: ctx.project, library: ctx.library, bookCount: books.length, nodes: fullNodes, edges: fullEdges, fullExpanded: true };
  fs.writeFileSync(path.join(ctx.out, 'mindmap.full.json'), JSON.stringify(mm, null, 2));
  const md = renderReport(books, bookReports, mm);
  fs.writeFileSync(path.join(ctx.out, 'report.md'), md);

  log('✅ 已产出：' + path.join(ctx.out, 'report.md') + ' 与 ' + path.join(ctx.out, 'mindmap.full.json'));
  log('   节点 ' + fullNodes.length + ' / 边 ' + fullEdges.length + '（全展开）');
}

main().catch(e => { console.error('[driver] 失败：' + (e && e.stack || e)); process.exit(1); });
