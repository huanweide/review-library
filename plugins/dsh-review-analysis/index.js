// dsh-review-analysis —— DeepSeek Harness（Cordis）插件 Host 半边。
//
// 定位（2026-11-08 重做）：本插件**不是独立引擎**，只是「统一复习项目」的一个入口。
// 唯一核心 = 主项目的 core/（Core 类：建书 → 加文件 → 大模型整本整体分析 → 思维导图 + 题型索引）。
// 本文件只做两件事：
//   1. 注册工具 review_analysis（action 分派 list/create/add/analyze/get），全部委托给 core；
//   2. 为左侧栏面板提供同源只读 JSON：GET /review-analysis/api/state。
//
// 与旧版的区别（旧版已被判定「完全不对」）：
//   - 旧：自带 engine/ 副本，groupByLayer 分层、规则版导图、README 写「不联网、不调用模型」；
//   - 新：不复制引擎，直接 require 主项目 core；整体分析必须走 LLM，无离线兜底。
//
// 安全契约：
//   - projectRoot 只来自插件 config / 环境变量，不接受工具参数（防任意路径 require）；
//   - apiKey 只来自工具参数 cfg 或环境变量 DSH_LLM_API_KEY，绝不写进 cordis.patch.yml / 文件 / 日志；
//   - 文件内容只接受 base64，不提供任意路径读取（防模型被诱导读系统文件）。
//
// 依赖说明：不 import '@deepseek-ai/*'（local-plugins 路径下无法解析），
// 只依赖 Node 内置模块 + 主项目 core（经 createRequire 绝对路径加载）。

import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 统一核心根目录（2026-11-21 适配特化）。
 * 优先级：插件 config > DSH_REVIEW_PROJECT_ROOT 环境变量 > 安装时写入的 project-root.json
 *         > 从插件自身位置推导（源码在 <root>/plugins/dsh-review-analysis/）。
 * 为什么不用 cordis.patch.yml 写死绝对路径：那份文件会随 GitHub 仓库发布到别人机器，
 * 写作者本机的 C:/Users/... 路径等于把插件做成只能在我这台机器上跑。
 */
export function resolveProjectRoot(config) {
  // 2026-11-28：四级顺序不变，但每一级「为什么没成」都记下来。
  // 外部基准 Cordis 注册期校验抛带路径的 ValidationError、Koishi Schema 给描述+默认值；
  // 我们原来静默跳过四级、最后一句笼统 throw，DSH 用户配错只能靠猜。
  const tried = [];
  const hasCore = (p) => !!p && fs.existsSync(path.join(p, 'core', 'index.js'));

  const fromConfig = String((config && config.projectRoot) || '').trim();
  if (fromConfig && fromConfig !== '__AUTO__' && hasCore(fromConfig)) return path.resolve(fromConfig);
  if (fromConfig && fromConfig !== '__AUTO__') tried.push('config.projectRoot=' + fromConfig + '（该目录下没有 core/index.js）');
  else tried.push('config.projectRoot=' + (fromConfig || '未配置') + (fromConfig === '__AUTO__' ? '（自动解析标记，跳过）' : ''));

  const fromEnv = String(process.env.DSH_REVIEW_PROJECT_ROOT || '').trim();
  if (fromEnv && hasCore(fromEnv)) return path.resolve(fromEnv);
  tried.push('环境变量 DSH_REVIEW_PROJECT_ROOT=' + (fromEnv || '未设置') + (fromEnv && !hasCore(fromEnv) ? '（该目录下没有 core/index.js）' : ''));

  for (const base of [HERE, path.join(HERE, '..', 'source')]) {
    const stampPath = path.join(base, 'project-root.json');
    try {
      const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
      const root = String(stamp.projectRoot || '').trim();
      if (root && hasCore(root)) return path.resolve(root);
      tried.push('安装戳记 ' + stampPath + ' → ' + (root || '空') + (root && !hasCore(root) ? '（该目录下没有 core/index.js）' : ''));
    } catch (e) {
      tried.push('安装戳记 ' + stampPath + '（' + (e && e.code === 'ENOENT' ? '不存在，正常' : '读取失败：' + String(e.message || e).slice(0, 60)) + '）');
    }
  }
  const derived = path.resolve(HERE, '..', '..');
  if (hasCore(derived)) return derived;
  tried.push('插件相对推导 ' + derived + '（该目录下没有 core/index.js）');

  throw new Error('未找到统一核心目录（需含 core/index.js）。已依次尝试：\n  - ' + tried.join('\n  - ')
    + '\n修复：任选一级给出正确路径，或把插件放回仓库 plugins/dsh-review-analysis/ 下。');
}

export const name = 'dsh-review-analysis';
export const inject = ['tools', 'webServer'];

const API_STATE = '/review-analysis/api/state';
// 统一应用协议：与 server.js / Electron / CLI 共用 core/app-host.js。
// DSH 只是第 4 个宿主，能力清单不复制第二份。
const API_APP_MANIFEST = '/review-analysis/api/app/manifest';
const API_APP_STATE = '/review-analysis/api/app/state';
const API_APP_ACTION = '/review-analysis/api/app/action';
// 模型配置（2026-11-21）：与 server.js 的同名端点同语义，复用 core/settings.js 单一真源。
// DSH 面板里那套 workbench 必须能在这里读写配置，否则它会把宿主判成「不支持配置存储」。
const API_SETTINGS = '/review-analysis/api/settings';
const API_SETTINGS_TEST = '/review-analysis/api/settings/test';
const API_MODELS = '/review-analysis/api/models';
// DSH 侧栏面板内嵌同一个 workbench 应用：静态资源经 webServer 同源托管。
// 只用已验证的 kind:'exact' 逐文件注册，不用未验证的 prefix/wildcard；
// 文件清单固定，路径经 path.resolve + startsWith 双重校验，防目录穿越。
const APP_PREFIX = '/review-analysis/app/';
// APP 复用的共用纯函数（思维导图布局）：与 core.html / HTTP 形态读的是同一份源码，
// 不复制算法，避免「屏幕与导出坐标不一致」。路径按 ../js/ 相对 app 根解析。
const APP_SHARED_MINDMAP = '/review-analysis/js/mindmap-layout.js';
const APP_FILES = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'icons/icon.svg',
  'src/main.js', 'src/host.js', 'src/state.js', 'src/router.js',
  'src/ui.js', 'src/views.js', 'src/shell.js', 'src/style.css',
  'src/bookspace.js', 'src/mindmap.js',
  // 2026-11-21 新增：少列一个模块，DSH 侧栏里的应用就是 404 白屏（不是降级，是缺文件）。
  'src/llm-config.js', 'src/overview.mjs',
  // 2026-11-28：v1.7.0–v1.8.0 新增的五个模块，之前只在 HTTP 形态可访问，DSH 侧栏全是 404。
  // 判别 tools/check-dsh-adapt.mjs#G2 会逐文件比对 workbench/src/ 目录，漏一个就红。
  'src/study-hint.mjs', 'src/map-viewport.mjs', 'src/reader.mjs',
  'src/structure-layer.mjs', 'src/exam-pack.mjs',
];
const APP_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const MAX_TREE_PREVIEW = 40;

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', String(body.length));
  res.end(body);
}
// 读 JSON 请求体。畸形 JSON 只回固定文案，绝不回显原文（可能含 apiKey）。
async function readJsonBody(req) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const m = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return m && typeof m === 'object' ? m : {};
  } catch (e) { return null; }
}

function errorText(error) {
  if (!error) return '未知错误';
  return error && error.message ? String(error.message) : String(error);
}
// 同源校验：优先让 connection 服务裁决，退化时比对 Host/Origin（挡跨站简单请求）。
function admitted(ctx, req) {
  try {
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
    if (connection && typeof connection.requestRejection === 'function') {
      return connection.requestRejection(req) === undefined;
    }
  } catch { /* 退化为下面的同源比对 */ }
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// 唯一核心：从 config.projectRoot（或环境变量）解析，惰性加载并缓存。
function coreLoader(config) {
  let cached = null;
  return function getCore() {
    if (cached) return cached;
    const root = resolveProjectRoot(config);
    const entry = path.resolve(root, 'core', 'index.js');
    if (!fs.existsSync(entry)) throw new Error('找不到统一核心入口：' + entry + '（确认 projectRoot 指向含 core/ 的主项目根）');
    const mod = require(entry);
    if (!mod || typeof mod.Core !== 'function') throw new Error('统一核心入口未导出 Core 类：' + entry);
    const dataRoot = String((config && config.library) || '').trim() || path.resolve(root, 'library');
    cached = { core: new mod.Core(path.resolve(dataRoot)), version: mod.CORE_VERSION || '', root, entry };
    return cached;
  };
}

// 统一应用协议单一实现：与 server.js / Electron / CLI 共用主项目 core/app-host.js。
// 惰性加载，缺文件提前大声失败（而不是等界面调用了才发现形态漂移）。
function appHostLoader(config) {
  let cached = null;
  return function getAppHost() {
    if (cached) return cached;
    const root = resolveProjectRoot(config);
    const p = path.resolve(root, 'core', 'app-host.js');
    if (!fs.existsSync(p)) throw new Error('找不到统一应用协议：' + p);
    cached = require(p);
    if (!cached || typeof cached.manifest !== 'function' || typeof cached.invoke !== 'function') {
      throw new Error('统一应用协议格式不正确：' + p);
    }
    return cached;
  };
}

// 能力清单单一真源：与 CLI / HTTP / Electron 共用主项目 core/capabilities.js，
// 本插件不再自己维护一份「能用哪些 action」的手写列表。
// projectRoot 本就是插件必填配置（README 已标），这里在注册期就取到清单：
// 配置缺失时提前大声失败，而不是等用户调用工具才发现能力表是旧的。
function loadCapabilities(config) {
  const root = resolveProjectRoot(config);
  const p = path.resolve(root, 'core', 'capabilities.js');
  if (!fs.existsSync(p)) throw new Error('找不到统一核心能力清单：' + p);
  const mod = require(p);
  if (!mod || !Array.isArray(mod.ACTIONS)) throw new Error('能力清单格式不正确：' + p);
  return mod;
}

// 模型配置单一真源：直接 require 主项目的 core/settings.js，不在插件里复制第二份解析规则。
// 这样 DSH 面板里的 workbench 与 HTTP / 桌面端看到的「密钥从哪来」是同一套语义。
function settingsLoader(config) {
  let cached = null;
  return function getSettings() {
    if (cached) return cached;
    const p = path.resolve(resolveProjectRoot(config), 'core', 'settings.js');
    if (!fs.existsSync(p)) throw new Error('找不到统一模型配置模块：' + p);
    cached = require(p);
    return cached;
  };
}

// 密钥只走工具参数或环境变量；任何情况下不写盘。
function cfgFrom(args) {
  const c = (args && args.cfg) || {};
  return {
    baseURL: c.baseURL || process.env.DSH_LLM_BASE_URL || '',
    model: c.model || process.env.DSH_LLM_MODEL || '',
    apiKey: c.apiKey || process.env.DSH_LLM_API_KEY || '',
  };
}
function requireCfg(cfg) {
  const missing = ['baseURL', 'model', 'apiKey'].filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error('整体分析需要大模型配置，缺少：' + missing.join(' / ') +
      '。请在工具参数 cfg 里提供，或设置环境变量 DSH_LLM_BASE_URL / DSH_LLM_MODEL / DSH_LLM_API_KEY（密钥不写进插件配置）。');
  }
}

// 把书 + 分析产物整理成面板可渲染的视图（不再有 centers/points/related 旧结构）。
function buildView(loaded) {
  const { core, version, root } = loaded;
  const books = core.listBooks() || [];
  const items = books.map((b) => {
    const full = core.getBook(b.id) || {};
    const a = core.getAnalysis(b.id);
    const stat = a && a.stats ? a.stats : null;
    return {
      id: b.id,
      title: b.title,
      description: b.description || '',
      materialCount: (full.files || []).length,
      hasAnalysis: !!(a && a.tree),
      analyzedAt: stat && stat.analyzedAt ? stat.analyzedAt : null,
      model: (a && a.model) || '',
      summary: (a && a.summary) || '',
      stats: stat,
      tree: (a && a.tree) || null,
      questionIndex: (a && Array.isArray(a.questionIndex)) ? a.questionIndex : [],
    };
  });
  return {
    ok: true,
    projectRoot: root,
    coreVersion: version,
    bookCount: items.length,
    analyzedCount: items.filter((x) => x.hasAnalysis).length,
    questionTypeCount: items.reduce((n, x) => n + (x.stats && x.stats.questionTypes || 0), 0),
    books: items,
  };
}

function treePreview(node, depth, out) {
  if (!node || out.length >= MAX_TREE_PREVIEW) return out;
  out.push('  '.repeat(depth) + '- [' + (node.type || 'node') + '] ' + (node.title || ''));
  (node.children || []).forEach((c) => treePreview(c, Math.min(depth + 1, 3), out));
  return out;
}

function renderResult(v) {
  const L = [];
  L.push(v.ok ? '✅ 统一核心 · ' + v.action + ' 成功' : '❌ 统一核心 · ' + v.action + ' 失败：' + (v.error || ''));
  if (v.bookId) L.push('书：' + (v.title || '') + ' (' + v.bookId + ')');
  if (v.books) L.push('共 ' + v.books.length + ' 本书：' + v.books.map((b) => '《' + b.title + '》' + (b.analyzed ? '已分析' : '未分析')).join('；'));
  if (v.materialCount != null) L.push('本次导入 ' + v.materialCount + ' 份资料。');
  if (v.stats) L.push('统计：' + v.stats.chapters + ' 章 / ' + v.stats.sections + ' 节 / ' + v.stats.points + ' 知识点 / ' + v.stats.questionTypes + ' 类题型');
  if (v.summary) L.push('概览：' + String(v.summary).slice(0, 300));
  if (v.questionIndex && v.questionIndex.length) {
    L.push('题型索引：' + v.questionIndex.map((g) => g.type + ' ' + (g.items || []).length + ' 项').join('，'));
  }
  if (v.tree) L.push('思维导图（前 ' + MAX_TREE_PREVIEW + ' 节点）：\n' + treePreview(v.tree, 0, []).join('\n'));
  return [{ type: 'text', text: L.join('\n') }];
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    error: { type: 'string' },
    bookId: { type: 'string' },
    title: { type: 'string' },
    books: { type: 'array', items: { type: 'object' } },
    materialCount: { type: 'integer' },
    stats: { type: 'object' },
    tree: { type: 'object' },
    questionIndex: { type: 'array', items: { type: 'object' } },
    summary: { type: 'string' },
    coreVersion: { type: 'string' },
    data: { type: 'object', description: '学习闭环动作的返回值（quiz/due/attempt/rate/practice）' },
  },
  required: ['ok', 'action'],
};

export function apply(ctx, config) {
  const getCore = coreLoader(config);
  const getAppHost = appHostLoader(config);
  const getSettings = settingsLoader(config);
  const CAPS = loadCapabilities(config);
  const ACTIONS = CAPS.ACTIONS;

  const tool = {
    name: 'review_analysis',
    description:
      '统一复习项目的入口（不是独立引擎）：先建一本书，导入 PDF/PPT/Word/图片等资料，' +
      '再由大模型把整本书当作一个整体分析，产出可层层展开的思维导图、按题型分类的索引与全书概览。' +
      'action 取 list（列书）/ create（建书）/ add（加资料）/ analyze（整体分析）/ get（取分析结果）' +
      '/ quiz（练习列表）/ due（今日到期）/ attempt（提交作答）/ rate（四档自评）/ practice（读回过程数据）' +
      '/ cards（题卡只读）/ structure（导图结构，带 layer 才写）/ snapshot（本机快照，带 snapshotId 会恢复）。' +
      '读写属性：list/get/quiz/due/practice/cards 只读；create/add/analyze/attempt/rate/mark/compose 会写入；' +
      'structure 带 layer 时写、不带只读；snapshot 带 snapshotId 是不可逆恢复（调用前须向用户确认）、' +
      '带 label/create 是留档、不带参数是只读列表。analyze/compose 会调用大模型，有费用。' +
      '数据与主程序、专家形态共用同一套 core/，此处不复制引擎、不做离线规则分析。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ACTIONS, description: '要执行的动作（与统一核心能力清单同源）' },
        bookId: { type: 'string', description: '书 id；除 list/create 外必填' },
        key: { type: 'string', description: '题目 key（取自 quiz 返回）；attempt/rate 必填' },
        given: { type: 'string', description: 'attempt 的作答内容（选择题可填 A/B/C/D）' },
        rating: { type: 'integer', enum: [1, 2, 3, 4], description: 'rate 的四档自评，1-4（重来/吃力/会了/太简单）' },
        title: { type: 'string', description: 'create 时的书名' },
        description: { type: 'string', description: 'create 时的备注（可选）' },
        files: {
          type: 'array',
          description: 'add 时的资料列表；每项 {name, data(base64)}。不接受文件路径（安全考虑）',
          items: { type: 'object' },
        },
        cfg: {
          type: 'object',
          description: 'analyze 时的大模型配置 {baseURL, model, apiKey}；也可用 DSH_LLM_* 环境变量，密钥不落盘',
        },
        maxTokens: { type: 'integer', description: 'analyze/compose 的最大输出 token（可选）' },
        timeoutMs: { type: 'integer', description: 'analyze/compose 超时毫秒（可选）' },
        fileId: { type: 'string', description: 'mark 的资料 id（取自 get/list 返回的 files）' },
        focus: { type: 'boolean', description: 'mark：是否标为用户重点（语义分层，无需手动整理层级）' },
        note: { type: 'string', description: 'mark：一句话说明这份资料为什么重要' },
        kind: { type: 'string', enum: ['digest', 'syllabus', 'slides', 'review-guide'], description: 'compose 的文档类型：digest=考点大全 / syllabus=考纲 / slides=考点重要幻灯片 / review-guide=复习总纲' },
        refresh: { type: 'boolean', description: 'compose：true 时忽略缓存强制重生成' },
      },
      required: ['action'],
    },
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => renderResult(value) },
    async execute(args) {
      const action = String((args && args.action) || '').trim();
      const base = { ok: true, action };
      try {
        const loaded = getCore();
        const { core } = loaded;
        if (action === 'list') {
          return Object.assign(base, { books: core.listBooks() || [], coreVersion: loaded.version });
        }
        if (action === 'create') {
          const b = core.createBook(String((args && args.title) || '未命名书'), { description: String((args && args.description) || '') });
          return Object.assign(base, { bookId: b.id, title: b.title });
        }
        if (action === 'add') {
          const id = String((args && args.bookId) || '');
          if (!id) throw new Error('add 需要 bookId（先用 create 建书）');
          const files = (args && Array.isArray(args.files)) ? args.files : [];
          if (!files.length) throw new Error('add 需要 files：每项 {name, data(base64)}');
          let n = 0;
          for (const f of files) {
            const name = String((f && f.name) || '').trim();
            const data = String((f && f.data) || '');
            if (!name) throw new Error('资料缺少 name');
            if (!data) throw new Error('资料 ' + name + ' 缺少 data(base64)；本工具不读取任意文件路径');
            await core.addFile(id, Buffer.from(data, 'base64'), { name, note: String((f && f.note) || '') });
            n++;
          }
          return Object.assign(base, { bookId: id, materialCount: n });
        }
        if (action === 'analyze') {
          const id = String((args && args.bookId) || '');
          if (!id) throw new Error('analyze 需要 bookId');
          const cfg = cfgFrom(args);
          requireCfg(cfg);
          const r = await core.analyze(id, {
            cfg,
            maxTokens: (args && args.maxTokens) || undefined,
            timeoutMs: (args && args.timeoutMs) || undefined,
          });
          return Object.assign(base, {
            bookId: id,
            stats: r.stats || null,
            tree: r.tree || null,
            questionIndex: r.questionIndex || [],
            summary: r.summary || '',
            coreVersion: loaded.version,
          });
        }
        if (action === 'get') {
          const id = String((args && args.bookId) || '');
          if (!id) throw new Error('get 需要 bookId');
          const a = core.getAnalysis(id);
          if (!a || !a.tree) return Object.assign(base, { ok: false, bookId: id, error: '该书尚无分析结果，请先 analyze' });
          return Object.assign(base, {
            bookId: id, stats: a.stats || null, tree: a.tree || null,
            questionIndex: a.questionIndex || [], summary: a.summary || '',
            coreVersion: loaded.version,
          });
        }
        if (CAPS.isPractice(action)) {
          // 学习闭环：只做协议转换，全部委托给 Core 门面，与 CLI / 网页端 / 桌面端同源。
          const id = String((args && args.bookId) || '');
          if (!id) throw new Error(action + ' 需要 bookId');
          let data;
          if (action === 'practice') {
            data = core.getPractice(id);
          } else if (action === 'quiz') {
            data = core.getQuiz(id);
          } else if (action === 'due') {
            data = core.getDue(id);
          } else if (action === 'attempt') {
            const key = String((args && args.key) || '');
            if (!key) throw new Error('attempt 需要 key（取自 quiz 返回的题目 key）');
            data = core.submitAttempt(id, { key, given: String((args && args.given) || '') });
          } else { // rate
            const key = String((args && args.key) || '');
            if (!key) throw new Error('rate 需要 key（取自 quiz 返回的题目 key）');
            const rating = Number((args && args.rating) || 3);
            if (!Number.isInteger(rating) || rating < 1 || rating > 4) throw new Error('rate 需要 rating 1-4（四档自评）');
            data = core.rateCard(id, { key, rating });
          }
          return Object.assign(base, { bookId: id, data, coreVersion: loaded.version });
        }
        if (action === 'mark') {
          // 语义重点：只做协议转换，委托 Core 门面（与 CLI / 网页端同源）。
          const id = String((args && args.bookId) || '');
          const fid = String((args && args.fileId) || '');
          if (!id || !fid) throw new Error('mark 需要 bookId 与 fileId');
          const patchArg = { note: String((args && args.note) || '') };
          if (args && typeof args.focus === 'boolean') patchArg.focus = args.focus;
          const rec = core.markFile(id, fid, patchArg);
          return Object.assign(base, { bookId: id, data: rec, coreVersion: loaded.version });
        }
        if (action === 'compose') {
          // 整理文档（考点大全 / 考纲）：委托 Core 门面；密钥经 cfg，不落盘。
          const id = String((args && args.bookId) || '');
          if (!id) throw new Error('compose 需要 bookId');
          const cfg = cfgFrom(args);
          requireCfg(cfg);
          const d = await core.composeDocument(id, String((args && args.kind) || 'digest'), {
            cfg,
            maxTokens: (args && args.maxTokens) || undefined,
            timeoutMs: (args && args.timeoutMs) || undefined,
            refresh: !!(args && args.refresh),
          });
          return Object.assign(base, { bookId: id, kind: d.kind, stats: d.stats, coreVersion: loaded.version });
        }
        // 2026-11-28：以下三个 action 的 enum 早已从 core/capabilities.js 派生（声明支持），
        // 但分派漏接——调用直接落到末尾 throw「不支持的 action」（错误信息里还列着它自己）。
        // 修法照 core/app-host.js:264-284 做协议转换，业务逻辑一律委托 Core，不在插件里复制。
        if (action === 'cards' || action === 'structure' || action === 'snapshot') {
          const id = String((args && args.bookId) || '');
          if (!id) throw new Error(action + ' 需要 bookId');
          let data;
          if (action === 'cards') {
            data = core.listCards(id);
          } else if (action === 'structure') {
            // 带 layer 是写（用户改动落 structure.json）；不带是读。analysis.json 永不被写。
            data = (args && args.layer) ? core.saveStructure(id, args.layer) : core.getStructure(id);
          } else { // snapshot：snapshotId 恢复（不可逆，调用方须先向用户确认）；否则留档/列表
            if (args && args.snapshotId) data = core.restoreSnapshot(id, String(args.snapshotId));
            else if ((args && args.label) || (args && args.create)) data = core.saveSnapshot(id, String((args && args.label) || ''));
            else data = { items: core.listSnapshots(id) };
          }
          return Object.assign(base, { bookId: id, data, coreVersion: loaded.version });
        }
        throw new Error('不支持的 action：' + action + '（可用 ' + ACTIONS.join('/') + '）');
      } catch (error) {
        // 不回显 args（可能含 apiKey），也不回显上游原始错误体。
        return { ok: false, action, error: errorText(error) };
      }
    },
  };

  ctx.effect(() => ctx.tools.register(tool), 'dsh-review-analysis: review_analysis tool (unified core)');

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: API_STATE,
      handler: async (req, res) => {
        if (!admitted(ctx, req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        try { return sendJson(res, 200, buildView(getCore())); }
        catch (error) { return sendJson(res, 200, { ok: false, books: [], error: errorText(error) }); }
      },
    }),
    'dsh-review-analysis: GET ' + API_STATE,
  );

  // ===== 统一应用协议（第 4 个宿主：DSH 侧栏面板 / APP） =====
  // 与 server.js 的 /api/app/*、Electron 的 workbench:* 共用 core/app-host.js。
  // APP 跑在 DSH 里时，能力清单、action 语义、书库数据与其余形态完全一致。
  const meta = () => {
    const loaded = getCore();
    return { version: loaded.version || '', coreVersion: loaded.version || '' };
  };

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: API_APP_MANIFEST,
      handler: async (req, res) => {
        if (!admitted(ctx, req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        try { return sendJson(res, 200, getAppHost().manifest('dsh', meta())); }
        catch (error) { return sendJson(res, 200, { ok: false, error: errorText(error) }); }
      },
    }),
    'dsh-review-analysis: GET ' + API_APP_MANIFEST,
  );

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: API_APP_STATE,
      handler: async (req, res) => {
        if (!admitted(ctx, req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        try { return sendJson(res, 200, getAppHost().state(getCore().core, 'dsh', meta())); }
        catch (error) { return sendJson(res, 200, { ok: false, error: errorText(error) }); }
      },
    }),
    'dsh-review-analysis: GET ' + API_APP_STATE,
  );

  // 同一个 APP 在 DSH 侧栏里打开：逐文件 exact 托管 workbench 静态资源。
  // 应用通过 ?base=/review-analysis/api/app 自动把协议端点指回本插件，
  // 因此 DSH 里的 APP 与内置浏览器 / Electron 里的 APP 是同一份代码、同一份数据。
  const appRoot = path.resolve(resolveProjectRoot(config), 'workbench');
  APP_FILES.forEach(rel => {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path: APP_PREFIX + rel,
        handler: async (req, res) => {
          if (!admitted(ctx, req)) { res.statusCode = 403; return res.end('forbidden'); }
          if (req.method !== 'GET') { res.statusCode = 405; return res.end('method not allowed'); }
          const file = path.resolve(appRoot, rel);
          if (!file.startsWith(appRoot)) { res.statusCode = 403; return res.end('forbidden'); }
          try {
            const buf = fs.readFileSync(file);
            res.statusCode = 200;
            res.setHeader('content-type', APP_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
            res.setHeader('cache-control', 'no-store');
            res.setHeader('content-length', String(buf.length));
            return res.end(buf);
          } catch (e) { res.statusCode = 404; return res.end('not found'); }
        },
      }),
      'dsh-review-analysis: APP asset ' + rel,
    );
  });

  // 共用导图布局模块：APP 以 ../js/mindmap-layout.js 相对路径加载，
  // 在 DSH 宿主下映射到同一份 renderer/js/mindmap-layout.js（唯一源码，不复制）。
  // 2026-11-28：与 APP 资源分支同样做 startsWith 校验（外部基准 Koishi 的原则是「无例外分支」）。
  // 这里路径由代码固定拼出、不含请求输入，穿越风险本就极低；补这道是 defense-in-depth，
  // 防止将来改成可配置路径时忘记加校验，而不是修已发生的事故。
  const coreRoot = resolveProjectRoot(config);
  const sharedMindmapFile = path.resolve(coreRoot, 'renderer', 'js', 'mindmap-layout.js');
  if (!sharedMindmapFile.startsWith(coreRoot)) throw new Error('共用导图模块路径越界：' + sharedMindmapFile);
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: APP_SHARED_MINDMAP,
      handler: async (req, res) => {
        if (!admitted(ctx, req)) { res.statusCode = 403; return res.end('forbidden'); }
        if (req.method !== 'GET') { res.statusCode = 405; return res.end('method not allowed'); }
        try {
          const buf = fs.readFileSync(sharedMindmapFile);
          res.statusCode = 200;
          res.setHeader('content-type', 'text/javascript; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.setHeader('content-length', String(buf.length));
          return res.end(buf);
        } catch (e) { res.statusCode = 404; return res.end('not found'); }
      },
    }),
    'dsh-review-analysis: APP shared mindmap-layout',
  );

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: API_APP_ACTION,
      handler: async (req, res) => {
        if (!admitted(ctx, req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        try {
          // 只接受 JSON 对象，不回显 body（可能含 cfg.apiKey）。
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const raw = Buffer.concat(chunks).toString('utf8');
          const m = JSON.parse(raw || '{}');
          if (!m || typeof m !== 'object' || typeof m.action !== 'string') {
            return sendJson(res, 200, { ok: false, error: '需要 action 字符串' });
          }
          // 与 server.js 同语义：前端可以只传模型名，密钥由 core/settings.js 从
          // 配置文件 / SILICONFLOW_* / DSH_LLM_* / REVIEW_LLM_* 补齐。
          const root = resolveProjectRoot(config);
          const S = getSettings();
          const rawCfg = m.cfg || (m.payload && m.payload.cfg) || {};
          const cfg = S.mergeCfg(root, rawCfg);
          const payload = Object.assign({}, m.payload || {}, { cfg });
          if (payload.visionCfg) payload.visionCfg = S.mergeCfg(root, payload.visionCfg);
          const r = await getAppHost().invoke(getCore().core, m.action, payload, { cfg });
          if (r && r.ok && (m.action === 'analyze' || m.action === 'compose')) S.remember(root, rawCfg);
          return sendJson(res, 200, r);
        } catch (error) { return sendJson(res, 200, { ok: false, error: errorText(error) }); }
      },
    }),
    'dsh-review-analysis: POST ' + API_APP_ACTION,
  );

  // ===== 模型配置 / 找模型（2026-11-21 DSH 特化） =====
  // 面板里的 workbench 通过 ?base=/review-analysis/api/app 推导 /review-analysis/api/settings，
  // 这三个端点缺一个，DSH 里的「模型与密钥」就只会显示「宿主不支持」——不是能力问题，是没接线。
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: API_SETTINGS,
      handler: async (req, res) => {
        if (!admitted(ctx, req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
        try {
          const S = getSettings();
          if (req.method === 'GET') return sendJson(res, 200, S.publicInfo(resolveProjectRoot(config)));
          if (req.method === 'POST') {
            const m = await readJsonBody(req);
            if (m === null) return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
            return sendJson(res, 200, S.save(resolveProjectRoot(config), m));
          }
          return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        } catch (error) { return sendJson(res, 200, { ok: false, error: errorText(error) }); }
      },
    }),
    'dsh-review-analysis: settings',
  );

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: API_SETTINGS_TEST,
      handler: async (req, res) => {
        if (!admitted(ctx, req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const m = await readJsonBody(req) || {};
          const root = resolveProjectRoot(config);
          const cfg = getSettings().mergeCfg(root, m.cfg || {});
          // 复用主项目的 lib/llm.js，不在插件里再写一份 HTTP 客户端。
          const llm = require(path.resolve(root, 'lib', 'llm.js'));
          const r = await llm.testConnection(cfg);
          return sendJson(res, 200, Object.assign({}, r, { model: cfg.model, keySource: cfg.keySource, models: (r && r.models) || [] }));
        } catch (error) { return sendJson(res, 200, { ok: false, error: errorText(error) }); }
      },
    }),
    'dsh-review-analysis: settings/test',
  );

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: API_MODELS,
      handler: async (req, res) => {
        if (!admitted(ctx, req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
        if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const m = req.method === 'POST' ? (await readJsonBody(req) || {}) : {};
          return sendJson(res, 200, await getSettings().listModels(resolveProjectRoot(config), m));
        } catch (error) { return sendJson(res, 200, { ok: false, error: errorText(error), models: [] }); }
      },
    }),
    'dsh-review-analysis: models',
  );
}
