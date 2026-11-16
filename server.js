/**
 * server.js —— 天道书院 · 应用服务入口（Node 原生 http，零依赖）
 *
 * app 级端口：npm start → 监听 PORT（默认 4090），浏览器只是 UI，数据与逻辑在本进程。
 * 路由：
 *   GET  /api/health            健康检查
 *   GET  /api/books             书目（从 data.json 扫描派生，书单与数据不漂移）
 *   GET  /api/books/:id         完整统一格式书数据
 *   POST /api/books/import      服务端调 adapter 把书馆 analysis 转成书并落盘
 *   POST /api/books/:id/upload  上传新资料（multipart），只落盘、不分析
 *   POST /api/books/:id/analyze 对未分析的新资料做增量 LLM 分析并合并
 *   POST /api/llm/test          测试 LLM 连接（cfg 只内存，不落盘）
 *   其余                        静态资源（safeStatic 挡路径穿越）
 *
 * 安全：路径穿越拦截 / body 20MB 限额 / id 白名单 / 零外链 / 零凭据 / 零调试输出。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const Adapter = require('./assets/js/adapter');
const multipart = require('./lib/multipart');
const analyze = require('./lib/analyze');      // 旧增量引擎（保留兼容，新链路走 engine）
const engine = require('./lib/engine');        // 端到端复用书馆的能力引擎
const llm = require('./lib/llm');
const IMAGE_RE = /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i;

const VERSION = '1.0.0';
const DEFAULT_PORT = 4090;
const MAX_BODY = 20 * 1024 * 1024;
const out = s => process.stdout.write(String(s) + '\n');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf', '.ico': 'image/x-icon'
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, res) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('请求体超过 20MB'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function serveStatic(req, res, pathname, rawUrl) {
  // 第一道：new URL() 会规范化掉 ../，必须检查原始 URL 串才挡得住穿越
  if (String(rawUrl || '').indexOf('..') >= 0) return json(res, 403, { error: '路径越界' });
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const clean = rel.replace(/^[/\\]+/, '');
  const parts = clean.split(/[/\\]/);
  // 第二道：静态白名单。绝不允许读到服务端源码/配置/数据真源（package.json / server.js / lib / test / data.json）
  const allowed = clean === 'index.html'
    || clean === 'books/index.js'   // 静态回退用的公开书目索引（非源码/配置）
    || (parts[0] === 'assets' && parts.length > 1)
    || (parts[0] === 'books' && parts.length === 3 && store.validId(parts[1]) && parts[2] === 'book-data.js')
    || (parts[0] === 'books' && parts.length >= 4 && store.validId(parts[1]) && parts[2] === 'refs');
  if (!allowed) return json(res, 404, { error: '资源不存在' });
  const abs = store.safeStatic(clean);
  if (!abs) return json(res, 403, { error: '路径越界' });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return json(res, 404, { error: '资源不存在' });
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(abs).pipe(res);
}

async function handleImport(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req, res)); }
  catch (e) { return json(res, e.code || 400, { error: '请求体不是合法 JSON', detail: e.message }); }

  const analysis = payload && payload.analysis;
  const meta = (payload && payload.meta) || {};
  if (!analysis || !analysis.tree) return json(res, 400, { error: '缺少 analysis.tree（需要书馆分析结果）' });
  if (!meta.id || !meta.title) return json(res, 400, { error: 'meta.id 与 meta.title 必填' });
  if (!store.validId(meta.id)) return json(res, 400, { error: 'meta.id 非法：只允许字母/数字/下划线/连字符' });
  if (!meta.subject) meta.subject = '备考';
  if (!meta.coverColor) meta.coverColor = '#2f6f4f';
  if (!meta.accent) meta.accent = '#e8b04b';

  try {
    const book = Adapter.buildBookData({
      analysis, meta,
      files: payload.files || [],
      documents: payload.documents || {}
    });
    const r = store.writeBook(String(meta.id), book);
    return json(res, 201, {
      ok: true, id: r.id, bytes: r.bytes,
      stats: {
        kaogang: book.kaogang.length, tiku: book.tiku.length, refs: book.refs.length,
        quoteHit: book._trace.quoteAudit.hit || 0,
        quoteChecked: book._trace.quoteAudit.checked || 0
      }
    });
  } catch (e) {
    return json(res, 500, { error: '转换或落盘失败', detail: e.message });
  }
}

// 上传新资料：只落盘 + 登记，不触发分析（分析由 /analyze 单独触发，便于先看清单再决定）
async function handleUpload(req, res, id) {
  if (!store.validId(id)) return json(res, 400, { error: '非法书 id' });
  const book = store.readBook(id);
  if (!book) return json(res, 404, { error: '书不存在' });
  const chunks = []; let size = 0;
  try {
    await new Promise((resolve, reject) => {
      req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('上传超过 20MB'), { code: 413 })); req.destroy(); return; } chunks.push(c); });
      req.on('end', resolve); req.on('error', reject);
    });
  } catch (e) { return json(res, e.code || 400, { error: '上传失败', detail: e.message }); }
  let parsed;
  try { parsed = multipart.parseMultipart(Buffer.concat(chunks), req.headers['content-type']); }
  catch (e) { return json(res, 400, { error: 'multipart 解析失败', detail: e.message }); }
  if (!parsed.files.length) return json(res, 400, { error: '没有收到文件' });

  const focusNames = String(parsed.fields.focus || '').split(',').map(s => s.trim()).filter(Boolean);
  const notes = {};
  String(parsed.fields.notes || '').split('\n').forEach(line => {
    const i = line.indexOf('='); if (i > 0) notes[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  const saved = [];
  for (const f of parsed.files) {
    const rel = store.writeRefFile(id, f.name, f.buffer);
    saved.push({
      name: f.name, file: rel, type: (multipart.extOf(f.name) || '.txt').slice(1),
      isImage: IMAGE_RE.test(f.name),
      focus: focusNames.indexOf(f.name) >= 0,
      note: notes[f.name] || '', size: f.buffer.length
    });
  }
  // 关键：上传即登记进 book.refs 并落盘，否则刷新后新资料"消失"、analyze 也看不到它。
  const existingNames = new Set(arr(book.refs).map(r => String(r.name)));
  const newRefs = saved.map(s => ({
    name: s.name, file: s.file, type: s.type, isImage: s.isImage, focus: s.focus, note: s.note
  })).filter(r => !existingNames.has(r.name)); // 同名资料只登记一次，避免重复分析
  const refs = arr(book.refs).concat(newRefs);
  const nextBook = Object.assign({}, book, { refs });
  store.writeBook(id, nextBook);
  return json(res, 201, { ok: true, saved, message: '已上传 ' + saved.length + ' 份资料（尚未分析，点「开始分析」触发）' });
}

// 增量分析：只取未分析的新文件送 LLM，合并进现有书
async function handleAnalyze(req, res, id) {
  if (!store.validId(id)) return json(res, 400, { error: '非法书 id' });
  const book = store.readBook(id);
  if (!book) return json(res, 404, { error: '书不存在' });
  let payload;
  try { payload = JSON.parse(await readBody(req, res)); }
  catch (e) { return json(res, e.code || 400, { error: '请求体不是合法 JSON' }); }
  const cfg = payload && payload.llm;
  if (!cfg || !cfg.baseURL || !cfg.model) return json(res, 400, { error: '缺少 LLM 配置（地址与模型名必填）' });

  // 已分析台账：只分析新加的
  const analyzed = new Set(store.getAnalyzed(id));
  const allRefs = arr(book.refs);
  const fresh = allRefs.filter(r => !analyzed.has(String(r.name)));
  // 允许请求里带"本次要分析的额外文件"（刚上传还没进 refs 的情况）
  const extra = arr(payload.files).filter(f => f && f.name);
  const toAnalyze = fresh.concat(extra);
  if (!toAnalyze.length) return json(res, 200, { ok: true, skipped: true, message: '没有新增资料需要分析' });

  // 读取文件 buffer 供抽取
  const withBuffer = toAnalyze.map(r => {
    const abs = store.safeStatic('books/' + id + '/' + String(r.file || '').replace(/^\/+/, ''));
    let buffer = Buffer.alloc(0);
    try { if (abs && fs.existsSync(abs)) buffer = fs.readFileSync(abs); } catch (e) {}
    return {
      name: r.name, ext: (multipart.extOf(r.name) || ''), buffer,
      isImage: !!r.isImage, focus: !!r.focus, note: String(r.note || '')
    };
  });

  try {
    // 端到端复用书馆引擎：按用户勾选的 targets 生成产物（全选/知识点大全/考纲考点）
    const targets = payload.targets;
    const result = await engine.analyzeIncremental(cfg, (book.meta && book.meta.title) || id, book, withBuffer, targets);
    if (!result.ok) return json(res, 422, { ok: false, error: result.error });
    store.writeBook(id, result.book);
    // 台账 = 旧台账 ∪ 本轮实际送分析的文件名（下一轮不再重复分析）
    const analyzedNames = toAnalyze.map(f => String(f.name)).filter(Boolean);
    store.setAnalyzed(id, Array.from(new Set(Array.from(analyzed).concat(analyzedNames))));
    const s = result.stats;
    const produced = (s.targets || []).map(t => engine.TARGETS[t] ? engine.TARGETS[t].label.split('（')[0] : t).join('、');
    return json(res, 200, {
      ok: true, stats: s,
      message: '分析完成（' + produced + '）：新增 ' + s.newPoints + ' 知识点 / ' + s.newQuestions + ' 道题'
        + (s.syllabus && s.syllabus.error ? '；考纲失败：' + s.syllabus.error : '')
        + (s.noText && s.noText.length ? '；' + s.noText.length + ' 份资料无可抽取文本' : '')
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: String(e.message || e).slice(0, 300), detail: String(e.stack || '').slice(0, 600) });
  }
}
function arr(v) { return Array.isArray(v) ? v : []; }

// LLM 连接测试：cfg 只内存，绝不在服务端落盘
async function handleLlmTest(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req, res)); }
  catch (e) { return json(res, 400, { error: '请求体不是合法 JSON' }); }
  const r = await llm.testConnection(payload && payload.llm);
  return json(res, r.ok ? 200 : 422, r);
}

function createServer() {
  return http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); }
    catch (e) { return json(res, 400, { error: '非法 URL' }); }
    const p = u.pathname;

    if (p === '/api/health' && req.method === 'GET')
      return json(res, 200, { ok: true, app: '天道书院', version: VERSION, uptime: Math.round(process.uptime()), port: currentPort });
    if (p === '/api/books' && req.method === 'GET')
      return json(res, 200, store.listBooks());
    if (/^\/api\/books\/[^/]+$/.test(p) && req.method === 'GET') {
      const id = decodeURIComponent(p.split('/').pop());
      const book = store.readBook(id);
      return book ? json(res, 200, book) : json(res, 404, { error: '书不存在' });
    }
    if (p === '/api/books/import' && req.method === 'POST')
      return handleImport(req, res);
    if (p === '/api/llm/test' && req.method === 'POST')
      return handleLlmTest(req, res);
    let m;
    if ((m = p.match(/^\/api\/books\/([^/]+)\/upload$/)) && req.method === 'POST')
      return handleUpload(req, res, decodeURIComponent(m[1]));
    if ((m = p.match(/^\/api\/books\/([^/]+)\/analyze$/)) && req.method === 'POST')
      return handleAnalyze(req, res, decodeURIComponent(m[1]));
    if (p.indexOf('/api/') === 0)
      return json(res, 404, { error: 'API 不存在', path: p });
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return json(res, 405, { error: '方法不允许' });
    return serveStatic(req, res, p, req.url);
  });
}

let currentPort = DEFAULT_PORT;
function startServer(port) {
  currentPort = Number(port || process.env.PORT || DEFAULT_PORT);
  const server = createServer();
  return new Promise(resolve => {
    server.listen(currentPort, '127.0.0.1', () => {
      out('天道书院 v' + VERSION + ' 已启动');
      out('  端口 ' + currentPort + '  →  http://127.0.0.1:' + currentPort + '/');
      out('  数据真源 books/<id>/data.json');
      resolve(server);
    });
  });
}

if (require.main === module) startServer();
module.exports = { createServer, startServer, VERSION, DEFAULT_PORT };
