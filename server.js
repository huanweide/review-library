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

const ROOT = process.env.LIBRARY_ROOT || path.join(__dirname, 'library');
const PORT = parseInt(process.env.PORT, 10) || 5178;
const store = new Store(ROOT);
const MAX_BODY = 80 * 1024 * 1024; // 单请求 80MB，足够一份大 PPT/PDF

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

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
        const r = study.gradeExam(ex, m.answers || {});
        store.saveExam(m.bookId, ex);
        // M1：批改后把薄弱知识点累积进错题本（跨会话持久），不阻塞批改返回
        store.recordGrade(m.bookId, ex, store.getAnalysis(m.bookId));
        return send(res, 200, r);
      }
      if (parts[2] === 'mistakes' && parts[3] && method === 'GET') {
        return send(res, 200, study.summarizeMistakes(store, parts[3]));
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
    return send(res, 400, { error: String(e.message || e) });
  }
}

function serveStatic(req, res, u) {
  let p;
  try { p = decodeURIComponent(u.pathname); }
  catch (e) { res.writeHead(400); return res.end('bad request'); }
  if (p === '/' || p === '') p = '/index.html';
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

server.listen(PORT, () => {
  console.log('复习资料图书馆 已启动： http://localhost:' + PORT);
  // Windows 下自动开浏览器；其它平台静默
  if (process.platform === 'win32') {
    try { require('child_process').exec('cmd /c start http://localhost:' + PORT); } catch (e) {}
  }
});
