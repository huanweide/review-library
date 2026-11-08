#!/usr/bin/env node
'use strict';
// review-analysis driver（CLI 壳）。
// 只负责解析参数 + 打印进度，真正的分析逻辑全部委托给权威编排器 analyze.js，
// 确保「WorkBuddy 插件 / 专家版」与「DSH 插件」共用同一套引擎与报告渲染，
// 杜绝两份 outlineToMd 各漂各的（详见仓库顶层 README「版本与索引」）。
//
// 引擎（lib/ 六核心 + analyze.js）由 scripts/sync-engine.mjs 从
// plugins/dsh-review-analysis/engine 同步到本插件根目录；请勿在本目录手工改引擎代码。
//
// 零云端：analyze.js 全程走本地 lib/*，不联网、不调用模型。

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

function resolvePaths(a) {
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
  const out = path.resolve(a.out || path.join(project, 'review-analysis-out'));
  return { project, library, out, book: a.book, rounds: a.rounds };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const { project, library, out, book, rounds } = resolvePaths(a);
  console.log('[driver] 项目：' + project);
  console.log('[driver] 数据目录：' + library);
  console.log('[driver] 输出目录：' + out);

  // 权威编排器：与 DSH 插件同源（由 sync-engine 同步到本插件根目录的 analyze.js）。
  const analyze = require(path.join(__dirname, '..', 'analyze'));
  const r = analyze.analyze({ library, out, book, rounds });

  console.log('[driver] ✅ 已产出：' + path.join(out, 'report.md') + ' 与 ' + path.join(out, 'mindmap.full.json'));
  console.log('[driver]   已分析 ' + r.bookCount + ' 本 · 节点 ' + r.nodeCount + ' / 边 ' + r.edgeCount + '（全展开，累积续做）');
  return r;
}

try {
  main();
} catch (e) {
  console.error('[driver] 失败：' + (e && e.stack || e));
  process.exit(1);
}
