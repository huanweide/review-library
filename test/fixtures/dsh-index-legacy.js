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

const require = createRequire(import.meta.url);

export const name = 'dsh-review-analysis';
export const inject = ['tools', 'webServer'];

const API_STATE = '/review-analysis/api/state';
// 统一应用协议：与 server.js / Electron / CLI 共用 core/app-host.js。
// DSH 只是第 4 个宿主，能力清单不复制第二份。
const API_APP_MANIFEST = '/review-analysis/api/app/manifest';
const API_APP_STATE = '/review-analysis/api/app/state';
const API_APP_ACTION = '/review-analysis/api/app/action';
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
];
const APP_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
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
    const root = String((config && config.projectRoot) || process.env.DSH_REVIEW_PROJECT_ROOT || '').trim();
    if (!root) throw new Error('未配置统一核心目录：请在插件 config.projectRoot（或环境变量 DSH_REVIEW_PROJECT_ROOT）填写主项目根目录（含 core/）。');
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
    const root = String((config && config.projectRoot) || process.env.DSH_REVIEW_PROJECT_ROOT || '').trim();
    if (!root) throw new Error('未配置统一核心目录：config.projectRoot');
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
  const root = String((config && config.projectRoot) || process.env.DSH_REVIEW_PROJECT_ROOT || '').trim();
  if (!root) throw new Error('未配置统一核心目录：请在插件 config.projectRoot（或环境变量 DSH_REVIEW_PROJECT_ROOT）填写主项目根目录（含 core/）。');
  const p = path.resolve(root, 'core', 'capabilities.js');
  if (!fs.existsSync(p)) throw new Error('找不到统一核心能力清单：' + p);
  const mod = require(p);
  if (!mod || !Array.isArray(mod.ACTIONS)) throw new Error('能力清单格式不正确：' + p);
  return mod;
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
  const CAPS = loadCapabilities(config);
  const ACTIONS = CAPS.ACTIONS;

  const tool = {
    name: 'review_analysis',
    description:
      '统一复习项目的入口（不是独立引擎）：先建一本书，导入 PDF/PPT/Word/图片等资料，' +
      '再由大模型把整本书当作一个整体分析，产出可层层展开的思维导图、按题型分类的索引与全书概览。' +
      'action 取 list（列书）/ create（建书）/ add（加资料）/ analyze（整体分析）/ get（取分析结果）' +
      '/ quiz（练习列表）/ due（今日到期）/ attempt（提交作答）/ rate（四档自评）/ practice（读回过程数据）。' +
      '数据与主程序、专家形态共用同一套 core/，此处不复制引擎、不做离线规则分析。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ACTIONS, description: '要执行的动作（与统一核心能力清单同源）' },
        bookId: { type: 'string', description: '书 id；除 list/create 外必填' },
        key: { type: 'string', description: '题目 key（取自 quiz 返回）；attempt/rate 必填' },
        given: { type: 'string', description: 'attempt 的作答内容（选择题可填 A/B/C/D）' },
        rating: { type: 'integer', description: 'rate 的四档自评，1-4（重来/吃力/会了/太简单）' },
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
        kind: { type: 'string', description: 'compose 的文档类型：digest=考点大全 / syllabus=考纲' },
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
  const appRoot = path.resolve(String((config && config.projectRoot) || process.env.DSH_REVIEW_PROJECT_ROOT || ''), 'workbench');
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
  const sharedMindmapFile = path.resolve(String((config && config.projectRoot) || process.env.DSH_REVIEW_PROJECT_ROOT || ''), 'renderer', 'js', 'mindmap-layout.js');
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
          const r = await getAppHost().invoke(getCore().core, m.action, m.payload || {}, { cfg: m.cfg || {} });
          return sendJson(res, 200, r);
        } catch (error) { return sendJson(res, 200, { ok: false, error: errorText(error) }); }
      },
    }),
    'dsh-review-analysis: POST ' + API_APP_ACTION,
  );
}
