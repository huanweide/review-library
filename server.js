'use strict';
// 开发 / 测试 / 双击即用 模式：用 Node 内置 http 把 store 包成 /api，并托管 renderer 静态文件。
// Electron 模式走 main.js（同一套 store，不依赖本文件）。前端 api-client 同时兼容两种模式。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const insight = require('./lib/insight');
const study = require('./lib/study');
const llm = require('./lib/llm');
const media = require('./lib/media');
// v0.6 竞品级能力（全部纯本地，零外部依赖）
const searchLib = require('./lib/search');
const graphLib = require('./lib/graph');
const analyticsLib = require('./lib/analytics');
const clozeLib = require('./lib/cloze');
const backupLib = require('./lib/backup');
const reviewLib = require('./lib/review');
const mindmapLib = require('./lib/mindmap');
const { Core } = require('./core');
const requestLib = require('./core/request');
const appHost = require('./core/app-host');

const ROOT = process.env.LIBRARY_ROOT || path.join(__dirname, 'library');
const PORT = parseInt(process.env.PORT, 10) || 5178;
const store = new Store(ROOT);
// 统一核心（新架构）：建书→加文件→整体 LLM 分析。桌面端 / DSH 插件共用此引擎。
const core = new Core(ROOT);
// 与 lib/backup.js 的 180MB 单文件上限配套（base64 后约 240MB）。
// 旧版 80MB 会让一份 65MB 扫描件连「显式跳过」都做不到，直接静默不进备份。
const MAX_BODY = 260 * 1024 * 1024;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.webmanifest+json': 'application/manifest+json' };

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let len = 0, chunks = [];
    req.on('data', c => { len += c.length; if (len > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function parseUrl(req) { const u = new URL(req.url, 'http://localhost'); return u; }

async function handleApi(req, res, u) {
  const parts = u.pathname.split('/').filter(Boolean); // ['api','books', ':id', ...]
  const method = req.method;
  try {
    if (parts[0] !== 'api') return false;
    // /api/trash
    if (parts[1] === 'trash') {
      if (parts.length === 2 && method === 'GET') return send(res, 200, store.listTrash());
      if (parts[2] === 'restore' && parts.length === 3 && method === 'POST') {
        const m = JSON.parse(await readBody(req));
        if (m.type === 'book') return send(res, 200, store.restoreBook(m.key));
        return send(res, 200, store.restoreMaterial(m.key));
      }
      if (parts[2] && parts.length === 3 && method === 'DELETE') return send(res, 200, store.purgeTrash(parts[2]));
    }
    // /api/llm/test —— 测试用户填的 API 能否连通。cfg 只在本请求内存里，不落盘不写日志。
    if (parts[1] === 'llm' && parts[2] === 'test' && method === 'POST') {
      const m = JSON.parse(await readBody(req));
      return send(res, 200, await llm.testConnection(m.cfg || {}));
    }
    // /api/llm/probe-vision —— 探测用户填的模型是否支持图片输入（M3 看图）。cfg 只在本请求内存里。
    if (parts[1] === 'llm' && parts[2] === 'probe-vision' && method === 'POST') {
      const m = JSON.parse(await readBody(req));
      return send(res, 200, await llm.probeVision(m.cfg || {}, llm.chat));
    }
    // ===== 统一应用协议（APP / 内置浏览器 / 任意宿主） =====
    // 与 Electron IPC、DSH webServer 共用 core/app-host.js，能力清单不复制第二份。
    if (parts[1] === 'app' && parts[2] === 'manifest' && method === 'GET') {
      return send(res, 200, appHost.manifest('http', { version: require('./package.json').version, coreVersion: require('./core').CORE_VERSION }));
    }
    if (parts[1] === 'app' && parts[2] === 'state' && method === 'GET') {
      return send(res, 200, appHost.state(core, 'http', { version: require('./package.json').version, coreVersion: require('./core').CORE_VERSION }));
    }
    if (parts[1] === 'app' && parts[2] === 'action' && method === 'POST') {
      const m = JSON.parse(await readBody(req) || '{}');
      return send(res, 200, await appHost.invoke(core, m.action, m.payload || {}, { cfg: m.cfg || {} }));
    }
    // 资料原图回读（2026-11-14 图片直显）：只回读已登记文件字节，fileId 校验在 getFileBuffer 内。
    if (parts[1] === 'app' && parts[2] === 'file' && method === 'GET') {
      const q = u.searchParams;
      const bookId = String(q.get('bookId') || '');
      const fileId = String(q.get('fileId') || '');
      if (!bookId || !fileId) return send(res, 400, { error: '需要 bookId 与 fileId' });
      const book = core.getBook(bookId);
      const rec = book && (book.files || []).find((f) => f.id === fileId);
      if (!rec) return send(res, 404, { error: '文件不存在' });
      const buf = core.getFileBuffer(bookId, fileId);
      if (!buf) return send(res, 404, { error: '文件字节不可读' });
      const ext = String(rec.ext || '').toLowerCase();
      const imgMime = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.tif': 'image/tiff', '.tiff': 'image/tiff', '.pdf': 'application/pdf',
      }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': imgMime, 'Cache-Control': 'private, max-age=60' });
      return res.end(buf);
    }
    // ===== 统一核心 API（新架构）：建书 / 加文件 / 整体分析 =====
    // cfg（API 地址/密钥/模型）只在本次请求内存里，不落盘、不写日志。
    if (parts[1] === 'core') {
      // 路由语义只在 core/request.js 一份（与 Electron 主进程共用），此处只做 HTTP 适配。
      // 单独包 JSON.parse：V8 的 SyntaxError 会回显请求体原文片段，而 analyze 的 body 含 cfg.apiKey。
      // 畸形 JSON 只回固定文案，绝不把原文（可能含密钥）送进错误响应或日志。
      let body = {};
      if (method === 'POST') {
        try { body = JSON.parse(await readBody(req) || '{}'); }
        catch (e) { return send(res, 400, { error: '请求体不是合法 JSON' }); }
      }
      const r = await requestLib.dispatch(core, '/' + parts.slice(2).join('/'), method, body);
      return send(res, r.status, r.data);
    }
    // /api/study/* —— 分析 / 出题 / 批改 / 巩固卷。答案只留在后端，前端只拿脱敏试卷。
    if (parts[1] === 'study') {
      const m = method === 'GET' ? {} : JSON.parse(await readBody(req) || '{}');
      if (parts[2] === 'boundary' && method === 'POST') {
        return send(res, 200, study.boundary(store, m.bookId, m.selectedIds));
      }
      if (parts[2] === 'analyze' && method === 'POST') {
        const r = await study.analyze(store, m.bookId, Object.assign({}, m.opts || {}, { cfg: m.cfg }));
        return send(res, 200, r);
      }
      if (parts[2] === 'save-analysis' && method === 'POST') {
        return send(res, 200, store.saveAnalysis(m.bookId, m.analysis));
      }
      if (parts[2] === 'state' && parts[3] && method === 'GET') {
        return send(res, 200, { analysis: store.getAnalysis(parts[3]), exams: store.listExams(parts[3]) });
      }
      if (parts[2] === 'exam' && parts.length === 3 && method === 'POST') {
        const ex = study.makeExam(m.analysis, { questionCount: m.questionCount });
        store.saveExam(m.bookId, ex);
        return send(res, 200, study.paperOf(ex));
      }
      if (parts[2] === 'exam' && parts[3] && parts[4] && method === 'GET') {
        const ex = store.getExam(parts[3], parts[4]);
        return send(res, ex ? 200 : 404, ex ? study.paperOf(ex) : { error: '试卷不存在' });
      }
      if (parts[2] === 'grade' && method === 'POST') {
        const ex = store.getExam(m.bookId, m.examId);
        if (!ex) return send(res, 404, { error: '试卷不存在' });
        // 幂等：批改是一次性事件。重复交卷只返回既有结果，不重算、不追加错题历史。
        if (ex.grading && ex.grading.length) {
          return send(res, 200, {
            ok: true, replayed: true, grading: ex.grading, weakPointIds: ex.weakPointIds || [],
            summary: { total: ex.grading.length,
              correct: ex.grading.filter(g => g.verdict === '正确').length,
              partial: ex.grading.filter(g => g.verdict === '部分正确').length,
              wrong: ex.grading.filter(g => g.verdict === '错误').length }
          });
        }
        const r = study.gradeExam(ex, m.answers || {});
        store.saveExam(m.bookId, ex);
        // M1：批改后把薄弱知识点累积进错题本（跨会话持久），不阻塞批改返回
        store.recordGrade(m.bookId, ex, store.getAnalysis(m.bookId));
        return send(res, 200, r);
      }
      if (parts[2] === 'mistakes' && parts[3] && method === 'GET') {
        return send(res, 200, study.summarizeMistakes(store, parts[3]));
      }
      // 四档自评：看完答案后重排下次复习时间，不重复记一次真实复习。
      if (parts[2] === 'rate' && method === 'POST') {
        return send(res, 200, study.applyRatings(store, m.bookId, m.examId, m.ratings || {}));
      }
      if (parts[2] === 'review' && method === 'POST') {
        const r = study.reviewExam(store, m.bookId, Date.now(), m.maxQ);
        if (!r.ok) return send(res, 200, r);
        store.saveExam(m.bookId, r.exam);
        return send(res, 200, { ok: true, paper: study.paperOf(r.exam), dueCount: r.dueCount });
      }
      if (parts[2] === 'remedial' && method === 'POST') {
        const ex = store.getExam(m.bookId, m.examId);
        if (!ex) return send(res, 404, { error: '试卷不存在' });
        const r = study.remedial(ex, store.getAnalysis(m.bookId));
        if (!r.ok) return send(res, 200, r);
        store.saveExam(m.bookId, r.exam);
        return send(res, 200, { ok: true, paper: study.paperOf(r.exam), weakPointIds: r.weakPointIds });
      }
      // M1 主链路：考纲结构化视图（解析考纲.md + 题库.json 挂题）
      if (parts[2] === 'syllabus' && parts[3] && method === 'GET') {
        return send(res, 200, study.buildBookOutline(store, parts[3]));
      }
      if (parts[2] === 'syllabusExam' && method === 'POST') {
        return send(res, 200, await study.bankExam(store, m.bookId, m.opts || {}));
      }
    }
    // /api/mindmap/* 思维导图（四层镜像：与 preload 的 mindmap:* 一一对应）
    if (parts[1] === 'mindmap') {
      const bookId = parts[2];
      if (parts.length === 3 && method === 'GET') {
        return send(res, 200, mindmapLib.getMaps(store, bookId));
      }
      if (parts.length === 3 && method === 'POST') {
        const m = JSON.parse(await readBody(req) || '{}');
        return send(res, 200, await mindmapLib.generate(store, bookId, m.cfg, { force: !!m.force }));
      }
      if (parts.length === 5 && method === 'GET') {
        // /api/mindmap/:bookId/:mapId/:nodeId —— 取单张图内某个节点详情
        return send(res, 200, mindmapLib.getNode(store, bookId, parts[3], parts[4]));
      }
    }
    // ===== v0.6：全局搜索 / 知识图谱 / 学习报告 / 挖空 / 整库备份 =====
    if (parts[1] === 'search' && parts.length === 2 && method === 'POST') {
      const m = JSON.parse(await readBody(req) || '{}');
      return send(res, 200, searchLib.searchAll(store, m.q, { limit: m.limit }));
    }
    if (parts[1] === 'graph' && parts[2] && parts.length === 3 && method === 'GET') {
      return send(res, 200, graphLib.buildGraph(store.getAnalysis(parts[2]) || {}));
    }
    if (parts[1] === 'report' && parts[2] && parts.length === 3 && method === 'GET') {
      const days = Math.max(1, Math.min(365, Number(u.searchParams.get('days')) || 30));
      return send(res, 200, analyticsLib.buildReport(store, parts[2], Date.now(), { days }));
    }
    if (parts[1] === 'cloze' && parts[2] && parts.length === 3 && method === 'GET') {
      const a = store.getAnalysis(parts[2]) || {};
      return send(res, 200, { cards: clozeLib.makeDeck(a.points || [], { limit: 40 }) });
    }
    // ===== v0.7：学完反馈落盘 / 跨书今日复习 / 备份完整性与设置 =====
    // POST /api/feedback（写）  GET /api/feedback/:bookId（读回展示）
    if (parts[1] === 'feedback' && parts.length === 2 && method === 'POST') {
      const m = JSON.parse(await readBody(req) || '{}');
      return send(res, 200, store.saveFeedback(m.bookId, { examId: m.examId, answers: m.answers, at: m.at }));
    }
    if (parts[1] === 'feedback' && parts[2] && parts.length === 3 && method === 'GET') {
      return send(res, 200, store.listFeedback(parts[2]));
    }
    // GET /api/review/queue（跨书到期卡优先 + 填充成大量刷题会话）  POST /api/review/rate（四档自评回写 SRS）
    if (parts[1] === 'review' && parts[2] === 'queue' && method === 'GET') {
      const limit = Math.max(1, Math.min(500, Number(u.searchParams.get('limit')) || 50));
      const fillRaw = u.searchParams.get('fill');
      const fill = fillRaw != null ? Math.max(0, Math.min(500, Number(fillRaw) || 0)) : undefined;
      return send(res, 200, reviewLib.queueAcrossBooks(store, Date.now(), { limit, fill }));
    }
    if (parts[1] === 'review' && parts[2] === 'rate' && method === 'POST') {
      const m = JSON.parse(await readBody(req) || '{}');
      return send(res, 200, reviewLib.rateCard(store, m.bookId, m.pointId, m.rating, Date.now()));
    }
    // POST 带脱敏设置（引擎 / 模型 / 出题参数）；GET 保留给老调用方。
    if (parts[1] === 'backup' && parts[2] === 'export' && method === 'POST') {
      const m = JSON.parse(await readBody(req) || '{}');
      return send(res, 200, backupLib.buildBackup(store, { settings: m.settings }));
    }
    if (parts[1] === 'backup' && parts[2] === 'export' && method === 'GET') {
      return send(res, 200, backupLib.buildBackup(store));
    }
    if (parts[1] === 'backup' && parts[2] === 'import' && method === 'POST') {
      const m = JSON.parse(await readBody(req) || '{}');
      // 旧版 mode 不设白名单：任何拼写错误都会静默走 merge，让 index 与 books 目录错位。
      if (m.mode != null && m.mode !== 'replace') return send(res, 400, { error: '不支持的恢复模式（只支持 replace 覆盖恢复）' });
      if (typeof m.data !== 'string' || !m.data.length) return send(res, 400, { error: '备份数据为空' });
      return send(res, 200, backupLib.importAll(store, m.data, { mode: m.mode || 'replace' }));
    }
    // /api/books
    if (parts[1] === 'books' && parts.length === 2) {
      if (method === 'GET') return send(res, 200, store.listBooks());
      if (method === 'POST') { const m = JSON.parse(await readBody(req)); return send(res, 200, store.createBook(m)); }
    }
    // /api/books/:id  and  /api/books/:id/materials...
    if (parts[1] === 'books' && parts[2]) {
      const id = parts[2];
      if (parts.length === 3) {
        if (method === 'GET') return send(res, 200, store.getBook(id));
        if (method === 'PUT') { const p = JSON.parse(await readBody(req)); return send(res, 200, store.updateBook(id, p)); }
        if (method === 'DELETE') return send(res, 200, store.deleteBook(id));
      }
      if (parts[3] === 'materials' && parts.length === 4) {
        if (method === 'POST') {
          const m = JSON.parse(await readBody(req));
          if (!m.layer && m.layer !== 0) return send(res, 400, { error: 'layer required' });
          // HTTP 模式也要复刻 Electron 主进程的抽图逻辑：PPTX/DOCX 自动抽取内嵌媒体挂到 assets。
          // PDF 的页图/文字由渲染进程预处理后随 items 传入（见 renderer/js/book.js prepItem）。
          const items = (m.items || []).map(it => {
            const ext = path.extname(it.name || '').toLowerCase();
            if ((ext === '.pptx' || ext === '.docx') && it.data) {
              try {
                const buf = Buffer.from(it.data, 'base64');
                const med = media.extractOfficeMedia(buf, ext);
                if (med.length) it = Object.assign({}, it, {
                  assets: med.map(x => ({ name: x.name, data: x.data, kind: 'media', slide: x.slide, caption: '' }))
                });
              } catch (err) { /* 抽图失败不阻断入库 */ }
            }
            return it;
          });
          return send(res, 200, store.addMaterials(id, m.layer, items, { prompt: m.prompt, tags: m.tags, source: m.source }));
        }
      }
      // /api/books/:id/insight  —— 本地提示词驱动生成系统参考资料
      if (parts[3] === 'insight' && parts.length === 4 && method === 'POST') {
        const m = JSON.parse(await readBody(req));
        return send(res, 200, insight.generate(store, id, m.prompt));
      }
      if (parts[3] === 'materials' && parts[4] && parts.length === 5) {
        const mid = parts[4];
        if (method === 'GET') return send(res, 200, store.readMaterial(id, mid));
        if (method === 'DELETE') return send(res, 200, store.deleteMaterial(id, mid));
        if (method === 'PUT') { const p = JSON.parse(await readBody(req)); if (p.toLayer == null) return send(res, 400, { error: 'toLayer required' }); return send(res, 200, store.moveMaterial(id, mid, p.toLayer)); }
      }
      // /api/books/:id/materials/:mid/asset/:aid  —— 附属图资产（PDF 页图 / PPTX·DOCX 内嵌媒体）原始字节，供预览/内联。
      if (parts[3] === 'materials' && parts[4] && parts[5] === 'asset' && parts[6] && parts.length === 7) {
        try {
          const a = store.readAsset(id, parts[4], parts[6]);
          res.writeHead(200, { 'Content-Type': a.mime || 'application/octet-stream', 'Cache-Control': 'private' });
          return res.end(Buffer.from(a.data, 'base64'));
        } catch (e) { res.writeHead(404); return res.end('not found'); }
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    // JSON.parse 的 V8 SyntaxError 会回显请求体原文（可能含 apiKey），一律固定文案；
    // 其余错误经 scrub() 抹掉 sk- 前缀后再回显，绝不裸回显原文。
    // 边界（不夸大）：此处拿不到 cfg，scrub 的「精确替换 apiKey」不生效，只剩 sk- 正则兜底；
    // 但 /api/core 的畸形 JSON 已在上面单独拦截、llm/study/mindmap 的抛错在上游已 scrub(e.message, cfg)
    // 或本来就是固定中文文案，故当前无可到达的泄漏路径。纵深缺口记录在验收台账 KNOWN-LIMITATION。
    const msg = (e instanceof SyntaxError) ? '请求体不是合法 JSON' : llm.scrub(String(e.message || e));
    return send(res, 400, { error: msg });
  }
}

function serveStatic(req, res, u) {
  let p;
  try { p = decodeURIComponent(u.pathname); }
  catch (e) { res.writeHead(400); return res.end('bad request'); }
  // 默认首页 = 统一应用（workbench）。portal.html 保留为兼容入口。
  // 注意：必须重定向到目录形态 `/workbench/` 而不是直接把 index.html 内容吐在 `/`，
  // 否则 index.html 里的相对路径（./src/main.js、./manifest.webmanifest、./icons/icon.svg）
  // 会按根路径解析成 /src/...，全部 404 —— 页面只剩「正在启动应用…」的空壳（2026-11-14 实测）。
  if (p === '/' || p === '') {
    res.writeHead(302, { Location: '/workbench/' });
    return res.end();
  }
  if (p === '/favicon.ico') {
    return fs.readFile(path.join(__dirname, 'renderer', 'favicon.svg'), (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(data);
    });
  }
  // workbench/ 是独立应用工程（多文件 ES module + PWA），位于项目根，
  // 用目录级白名单映射过去；路径规范化 + startsWith 双重校验，不放宽穿越防护。
  if (p === '/workbench' || p === '/workbench/') p = '/workbench/index.html';
  if (p.startsWith('/workbench/')) {
    const wbRoot = path.join(__dirname, 'workbench');
    const rel = path.normalize(p.slice('/workbench/'.length)).replace(/^(\.\.[\/\\])+/, '');
    const file = path.join(wbRoot, rel);
    if (!file.startsWith(wbRoot)) { res.writeHead(403); return res.end('forbidden'); }
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      const ext = path.extname(file).toLowerCase();
      const mime = MIME[ext] || (ext === '.webmanifest' ? 'application/manifest+json' : 'application/octet-stream');
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  }
  // 工作台里的只读研究件位于项目根 demo/，而服务默认只托管 renderer/。
  // 用单文件精确白名单映射，不开通配、不放宽下面的目录穿越校验。
  if (p === '/demo/mindmap-preview.html') {
    const demoFile = path.join(__dirname, 'demo', 'mindmap-preview.html');
    return fs.readFile(demoFile, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(data);
    });
  }
  const file = path.join(__dirname, 'renderer', path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'renderer'))) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  // 请求级异常绝不能升格为进程级异常：单个畸形请求不许打死整个服务。
  // 根因：原来 async 回调里同步抛出会变成 unhandledRejection，Node 默认直接退出。
  try {
    const u = parseUrl(req);
    if (u.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, u);
      if (handled === false) serveStatic(req, res, u);
    } else {
      serveStatic(req, res, u);
    }
  } catch (e) {
    if (process.env.DEBUG) console.error('[request error]', e);
    if (!res.headersSent) { try { res.writeHead(500); } catch (e2) {} }
    try { res.end('internal error'); } catch (e2) {}
  }
});

// 只绑回环：这是本机单人用的离线软件，破坏性接口（整库恢复）不该暴露到局域网。
// NO_OPEN=1 供自动化测试静默启动，不弹浏览器。
server.listen(PORT, '127.0.0.1', () => {
  console.log('复习资料图书馆 已启动： http://localhost:' + PORT);
  // Windows 下自动开浏览器；其它平台静默
  if (process.platform === 'win32' && !process.env.NO_OPEN) {
    try { require('child_process').exec('cmd /c start http://localhost:' + PORT); } catch (e) {}
  }
});
