'use strict';
// 离线复习资料分析引擎（编排层）。
// 纯 CommonJS、零外部依赖：只调用 engine/lib/*（store / syllabus / mindmap），
// 以及 Node 内置 fs/path。不联网、不调用模型。
//
// 对外暴露 analyze(opts)：读取复习资料库 -> 考纲大纲 + 规则版思维导图（全展开）
//   -> 聚合去重 -> 落盘 report.md / mindmap.full.json / book-reports.json，
//   并返回结构化摘要（供 DSH 工具产出模型可读内容）。
//
// opts:
//   library {string} 复习资料库根目录（含各书子目录，每本含 book.json 与 materials.json）
//   out     {string} 输出目录（缺省由调用方决定）
//   book    {string} 只分析指定书名或 book id（缺省全部）
//   rounds  {number} 单次窗口最多处理几本（缺省全部）
//
// 续做累积：若 out 下已有 mindmap.full.json / book-reports.json，会按 id 去重合并，
//   不推翻重来（与 driver 行为一致）。

const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const syllabus = require('./lib/syllabus');
const mindmap = require('./lib/mindmap');

function slug(s) {
  return String(s == null ? '' : s).replace(/[^\w一-龥]+/g, '_').slice(0, 48);
}
function log(s) {
  if (process.env.DSH_REVIEW_ANALYSIS_VERBOSE) process.stdout.write('[review-analysis] ' + s + '\n');
}

function groupByLayer(materials) {
  const m = {};
  (materials || []).forEach((x) => {
    const l = x.layer || 1;
    (m[l] = m[l] || []).push(x);
  });
  return m;
}

function cleanText(s) {
  // 抽出来的知识点可能是 markdown 标题行（### (1) ...）或正文（答：...），
  // 统一去掉前导 # 号再当大纲标签用，保留可读内容。
  return String(s == null ? '' : s).replace(/^#+\s*/, '').trim();
}

function outlineToMd(outline, L, depth) {
  depth = depth || 0;
  (outline && outline.chapters || []).forEach((ch) => {
    L.push('  '.repeat(depth) + '- ' + cleanText(ch.title || '章节'));
    (ch.sections || []).forEach((sec) => {
      L.push('  '.repeat(depth + 1) + '- ' + cleanText(sec.title || '节'));
      (sec.points || []).forEach((p) => {
        L.push('  '.repeat(depth + 2) + '- ' + cleanText(p.text || p.title || p.name || '知识点'));
        (p.children || []).forEach((c) => L.push('  '.repeat(depth + 3) + '- ' + cleanText(c.text || c.title || c.name || '')));
      });
    });
  });
}

function renderReport(books, bookReports, mm) {
  const L = [];
  L.push('# 复习分析总报告');
  L.push('');
  L.push('> 生成时间：' + mm.generatedAt + ' · 数据目录：' + mm.library);
  L.push('> 书目：' + mm.bookCount + ' 本 · 思维导图节点：' + mm.nodes.length + ' · 边：' + mm.edges.length + '（全展开）');
  L.push('');
  L.push('## 一、书目总览');
  L.push('');
  L.push('| 书名 | 考试 | 科目 | 资料数 | 层分布 |');
  L.push('| --- | --- | --- | --- | --- |');
  bookReports.forEach((br) => {
    const layers = Object.keys(br.materials).sort((x, y) => x - y)
      .map((l) => 'L' + l + '·' + br.materials[l].length).join('，') || '空';
    L.push('| ' + br.book.title + ' | ' + (br.book.exam || '-') + ' | ' + (br.book.subject || '-') +
      ' | ' + br.total + ' | ' + layers + ' |');
  });
  L.push('');
  L.push('## 二、逐书分析（全展开大纲）');
  L.push('');
  bookReports.forEach((br) => {
    L.push('### 《' + br.book.title + '》');
    L.push('');
    L.push('- 考试：' + (br.book.exam || '-') + ' · 科目：' + (br.book.subject || '-'));
    L.push('- 资料：' + (Object.keys(br.materials).sort((x, y) => x - y)
      .map((l) => 'L' + l + '·' + br.materials[l].length + ' 份').join('，') || '无'));
    L.push('');
    L.push('#### 考纲大纲');
    outlineToMd(br.outline, L, 0);
    L.push('');
  });
  L.push('## 三、思维导图摘要');
  L.push('');
  L.push('全展开 JSON 见 `mindmap.full.json`。中心节点（每章/每节一张）：');
  L.push('');
  mm.nodes.filter((n) => n.kind === 'center').forEach((n) => L.push('- ' + n.title + '（' + n.bookTitle + '）'));
  L.push('');
  return L.join('\n');
}

// 续做累积：读取上一轮已产出的全展开图，作为本轮的起点（按 id 去重合并）。
function loadPrevMindmap(out) {
  const f = path.join(out, 'mindmap.full.json');
  try {
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { nodes: m.nodes || [], edges: m.edges || [] };
  } catch (e) {
    return { nodes: [], edges: [] };
  }
}

function analyze(opts) {
  const library = path.resolve(opts.library || '');
  const out = path.resolve(opts.out || path.join(library, '..', 'review-analysis-out'));
  if (!fs.existsSync(library)) {
    throw new Error('找不到数据目录，请确认 library 路径存在：' + library);
  }

  const store = Store(library);
  let books = store.listBooks() || [];
  if (opts.book) books = books.filter((b) => b.id === opts.book || b.title === opts.book);
  if (!books.length) {
    throw new Error('资料库中没有可分析的书（library=' + library + '）。');
  }

  // 续做累积：从上一轮全展开图 + 每书报告缓存起步（按 id 去重）。
  const prev = loadPrevMindmap(out);
  const fullNodes = prev.nodes.slice();
  const fullEdges = prev.edges.slice();
  const nodeById = new Map(fullNodes.map((n) => [n.id, n]));
  const edgeKey = (e) => e.source + ' ' + e.target + ' ' + e.rel;
  const edgeSet = new Set(fullEdges.map(edgeKey));
  const upsertNode = (n) => {
    if (nodeById.has(n.id)) {
      const i = fullNodes.findIndex((x) => x.id === n.id);
      fullNodes[i] = n;
    } else {
      nodeById.set(n.id, n);
      fullNodes.push(n);
    }
  };
  const upsertEdge = (e) => {
    const k = edgeKey(e);
    if (!edgeSet.has(k)) {
      edgeSet.add(k);
      fullEdges.push(e);
    }
  };

  let reportCache = {};
  try {
    reportCache = JSON.parse(fs.readFileSync(path.join(out, 'book-reports.json'), 'utf8')) || {};
  } catch (e) { /* 无缓存则从空起步 */ }

  const window = opts.book ? books.length : Math.min(opts.rounds || books.length, books.length);
  const order = opts.book ? books : books.slice(0, window);

  for (const b of order) {
    const bookId = b.id;
    log('分析《' + b.title + '》');
    let g;
    try { g = store.getBook(bookId) || { materials: [] }; } catch (e) { g = { materials: [] }; }
    const materials = g.materials || [];
    const byLayer = groupByLayer(materials);

    let outline = { chapters: [] };
    let bankQs = [];
    let maps = [];
    try { outline = syllabus.buildBookOutline(store, bookId) || outline; } catch (e) { log('  大纲生成跳过：' + e.message); }
    try { bankQs = syllabus.getBankQuestions(store, bookId) || []; } catch (e) { /* 题库可选 */ }
    try { maps = mindmap.buildRuleMaps(outline, bankQs) || []; } catch (e) { log('  思维导图生成跳过：' + e.message); }

    // 聚合进全展开图（续做累积，按 id 去重）
    maps.forEach((m) => {
      const centerId = 'book:' + bookId + ':center:' + slug(m.centerTitle);
      upsertNode({
        id: centerId, title: m.centerTitle, summary: m.centerSummary || '',
        kind: 'center', bookId, bookTitle: b.title,
      });
      (m.nodes || []).forEach((n) => {
        const nid = 'book:' + bookId + ':node:' + slug(n.title);
        upsertNode({
          id: nid, title: n.title, summary: n.summary || '', layer: n.layer,
          kind: 'point', bookId, bookTitle: b.title,
          children: (n.children || []).map((c) => c.title),
        });
        upsertEdge({ source: centerId, target: nid, rel: 'contains' });
        (n.related || []).forEach((r) => {
          const rid = 'book:' + bookId + ':rel:' + slug(r);
          upsertNode({ id: rid, title: r, kind: 'related', bookId, bookTitle: b.title });
          upsertEdge({ source: nid, target: rid, rel: 'related' });
        });
      });
    });

    reportCache[b.id] = {
      book: b, materials: byLayer, total: materials.length, outline, maps,
    };
  }

  fs.mkdirSync(out, { recursive: true });
  const bookReports = Object.values(reportCache);
  const mm = {
    generatedAt: new Date().toISOString(),
    library,
    bookCount: bookReports.length,
    nodes: fullNodes,
    edges: fullEdges,
    fullExpanded: true,
  };
  fs.writeFileSync(path.join(out, 'mindmap.full.json'), JSON.stringify(mm, null, 2));
  fs.writeFileSync(path.join(out, 'book-reports.json'), JSON.stringify(reportCache, null, 2));
  const reportMd = renderReport(books, bookReports, mm);
  fs.writeFileSync(path.join(out, 'report.md'), reportMd);

  log('✅ 已产出 ' + path.join(out, 'report.md'));
  return {
    ok: true,
    out,
    bookCount: bookReports.length,
    nodeCount: fullNodes.length,
    edgeCount: fullEdges.length,
    books: bookReports.map((br) => ({
      id: br.book.id,
      title: br.book.title,
      materials: br.total,
      maps: (br.maps || []).length,
    })),
    excerpt: reportMd.slice(0, 2000),
  };
}

module.exports = { analyze, renderReport };
