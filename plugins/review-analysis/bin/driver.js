#!/usr/bin/env node
'use strict';
// review-analysis driver —— 统一核心的薄 CLI 壳（WorkBuddy / CodeBuddy 专家形态）。
//
// 与旧版区别：旧版 require 本目录的离线 analyze.js + lib/ 副本（分层、不调模型）；
// 本版**不复制引擎**，直接 require 主项目 core/index.js 的 Core 类，与桌面端 / DSH 插件共用唯一核心。
// 本文件只解析参数、读文件、打印结果；分析逻辑全在 core/。
//
// 模型配置只走环境变量，密钥不落盘：
//   REVIEW_LLM_BASE_URL / REVIEW_LLM_MODEL / REVIEW_LLM_API_KEY
//
// 版本号唯一真源 = 主项目根 package.json；本文件由 scripts/sync-engine.mjs 同步，禁止手改。

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--project') a.project = argv[++i];
    else if (x === '--library') a.library = argv[++i];
    else if (x === '--action') a.action = argv[++i];
    else if (x === '--bookId') a.bookId = argv[++i];
    else if (x === '--title') a.title = argv[++i];
    else if (x === '--text') a.text = argv[++i];
    else if (x === '--file') a.files.push(argv[++i]);
    else if (x === '--maxTokens') a.maxTokens = parseInt(argv[++i], 10);
    else if (x === '--timeoutMs') a.timeoutMs = parseInt(argv[++i], 10);
    // 学习闭环动作入参（key 取题目内容哈希，见 core/practice.js questionKey）。
    else if (x === '--key') a.key = argv[++i];
    else if (x === '--given') a.given = argv[++i];
    else if (x === '--rating') a.rating = parseInt(argv[++i], 10);
  }
  return a;
}

function loadCore(a) {
  const root = a.project || process.env.REVIEW_CORE_ROOT;
  if (!root) throw new Error('缺少 --project <主项目根> 或环境变量 REVIEW_CORE_ROOT（必须含 core/index.js）');
  const entry = path.resolve(root, 'core', 'index.js');
  if (!fs.existsSync(entry)) throw new Error('找不到统一核心入口：' + entry);
  // eslint-disable-next-line import/no-dynamic-require
  const mod = require(entry);
  if (!mod || typeof mod.Core !== 'function') throw new Error('统一核心未导出 Core 类：' + entry);
  const dataRoot = a.library ? path.resolve(a.library) : path.resolve(root, 'library');
  // 能力清单与核心同源：wrapper 不自己维护「能用哪些动作」，避免新增能力时静默漂移。
  const capsPath = path.resolve(root, 'core', 'capabilities.js');
  if (!fs.existsSync(capsPath)) throw new Error('找不到统一核心能力清单：' + capsPath);
  const caps = require(capsPath);
  return { core: new mod.Core(dataRoot), version: mod.CORE_VERSION || '', root, dataRoot, caps };
}

function cfgFromEnv() {
  return {
    baseURL: process.env.REVIEW_LLM_BASE_URL || '',
    model: process.env.REVIEW_LLM_MODEL || '',
    apiKey: process.env.REVIEW_LLM_API_KEY || '',
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const loaded = loadCore(a);
  const { core, caps } = loaded;
  const action = String(a.action || 'list');
  // 单一真源白名单：不在清单里一律大声失败，错误信息带完整可用列表（J1d 行为级守卫取数处）。
  if (!caps.has(action)) throw new Error(caps.unsupported(action));
  let out;

  if (action === 'list') {
    out = { ok: true, action, coreVersion: loaded.version, books: core.listBooks() || [] };
  } else if (action === 'create') {
    const b = core.createBook(a.title || '未命名书', {});
    out = { ok: true, action, bookId: b.id, title: b.title };
  } else if (action === 'add') {
    if (!a.bookId) throw new Error('add 需要 --bookId');
    const items = [];
    for (const f of a.files) {
      if (!fs.existsSync(f)) throw new Error('资料文件不存在：' + f);
      items.push({ buf: fs.readFileSync(f), name: path.basename(f) });
    }
    if (a.text) items.push({ buf: Buffer.from(a.text, 'utf8'), name: 'note.txt' });
    if (!items.length) throw new Error('add 需要 --file <路径> 或 --text <内容>');
    for (const it of items) await core.addFile(a.bookId, it.buf, { name: it.name });
    out = { ok: true, action, bookId: a.bookId, materialCount: items.length };
  } else if (action === 'analyze') {
    if (!a.bookId) throw new Error('analyze 需要 --bookId');
    const cfg = cfgFromEnv();
    const missing = ['baseURL', 'model', 'apiKey'].filter((k) => !cfg[k]);
    if (missing.length) {
      const envNames = { baseURL: 'REVIEW_LLM_BASE_URL', model: 'REVIEW_LLM_MODEL', apiKey: 'REVIEW_LLM_API_KEY' };
      throw new Error('整体分析需要模型配置，缺少环境变量：' + missing.map((k) => envNames[k]).join(' / ') +
        '。密钥不写进文件；不做离线规则分析。');
    }
    const r = await core.analyze(a.bookId, { cfg, maxTokens: a.maxTokens, timeoutMs: a.timeoutMs });
    out = { ok: true, action, bookId: a.bookId, stats: r.stats, tree: r.tree, questionIndex: r.questionIndex, summary: r.summary };
  } else if (action === 'get') {
    if (!a.bookId) throw new Error('get 需要 --bookId');
    const r = core.getAnalysis(a.bookId);
    if (!r || !r.tree) throw new Error('该书尚无分析结果，请先 analyze');
    out = { ok: true, action, bookId: a.bookId, stats: r.stats, tree: r.tree, questionIndex: r.questionIndex, summary: r.summary };
  } else if (caps.isPractice(action)) {
    // 学习闭环：只做协议转换，全部委托给 Core 门面（与桌面端 / 网页端 / DSH 同源）。
    // 不 require core/practice.js、不读写 practice.json —— 业务逻辑只存在核心一处。
    const id = String(a.bookId || '');
    if (!id) throw new Error(action + ' 需要 --bookId');
    let data;
    if (action === 'practice') {
      data = core.getPractice(id);
    } else if (action === 'quiz') {
      data = core.getQuiz(id);
    } else if (action === 'due') {
      data = core.getDue(id);
    } else if (action === 'attempt') {
      if (!a.key) throw new Error('attempt 需要 --key（取自 quiz 返回的题目 key）');
      data = core.submitAttempt(id, { key: a.key, given: a.given == null ? '' : a.given });
    } else { // rate
      if (!a.key) throw new Error('rate 需要 --key（取自 quiz 返回的题目 key）');
      const rating = Number(a.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 4) throw new Error('rate 需要 --rating 1-4（四档自评）');
      data = core.rateCard(id, { key: a.key, rating });
    }
    out = { ok: true, action, bookId: id, data };
  } else {
    throw new Error(caps.unsupported(action));
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return out;
}

main().catch((e) => {
  // 不回显环境变量 / 参数（可能含密钥）。
  process.stderr.write('[driver] ✗ ' + String((e && e.message) || e) + '\n');
  process.exit(1);
});
