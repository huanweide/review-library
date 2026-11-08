'use strict';
// api-client：同时兼容三种运行环境
//  - Electron：window.api 存在，直接走 ipc
//  - 浏览器/server：用 fetch 打同源 /api
//  - GitHub Pages 预览站（无后端）：自动探测后端，缺失则回退内置示例数据（只读）
(function () {
  const hasApi = !!window.api;
  const J = (url) => fetch(url).then(r => r.json());
  const POST = (url, o) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json());
  const PUT = (url, o) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json());
  const DEL = (url) => fetch(url, { method: 'DELETE' }).then(r => r.json());

  // 无 Electron 时 app 桥接降级为 no-op（设置页会安全跳过这些功能）。
  const noopApp = {
    dataDir: () => Promise.resolve(null),
    env: () => Promise.resolve(null),
    checkUpdate: () => Promise.resolve({ ok: false, error: 'no-electron' }),
    installUpdate: () => Promise.resolve({ ok: false, error: 'no-electron' }),
    createShortcut: () => Promise.resolve({ ok: false, error: 'no-electron' }),
    onUpdateStatus: () => {}
  };

  // ============ 真实 HTTP API（同源 /api，Electron 也用同一套转发） ============
  const httpApi = {
    app: noopApp,
    books: {
      list: () => J('/api/books'),
      create: (m) => POST('/api/books', m),
      get: (id) => J('/api/books/' + encodeURIComponent(id)),
      update: (id, p) => PUT('/api/books/' + encodeURIComponent(id), p),
      delete: (id) => DEL('/api/books/' + encodeURIComponent(id))
    },
    materials: {
      add: (b, l, items, m) => POST('/api/books/' + encodeURIComponent(b) + '/materials', Object.assign({ layer: l, items: items }, m)),
      delete: (b, m) => DEL('/api/books/' + encodeURIComponent(b) + '/materials/' + encodeURIComponent(m)),
      move: (b, m, t) => PUT('/api/books/' + encodeURIComponent(b) + '/materials/' + encodeURIComponent(m), { toLayer: t }),
      read: (b, m) => J('/api/books/' + encodeURIComponent(b) + '/materials/' + encodeURIComponent(m)),
      // 附属图资产：Electron 走 IPC 拿 base64；HTTP 直接拿字节 URL。两者返回结构不同，由调用方统一成 src。
      readAsset: (b, m, a) => {
        if (window.api) return window.api.materials.readAsset(b, m, a);
        return { url: '/api/books/' + encodeURIComponent(b) + '/materials/' + encodeURIComponent(m) + '/asset/' + encodeURIComponent(a) };
      }
    },
    trash: {
      list: () => J('/api/trash'),
      restore: (m) => POST('/api/trash/restore', m),
      purge: (k) => DEL('/api/trash/' + encodeURIComponent(k))
    },
    insight: {
      generate: (b, p) => POST('/api/books/' + encodeURIComponent(b) + '/insight', { prompt: p })
    },
    llm: {
      test: (cfg) => POST('/api/llm/test', { cfg }),
      probeVision: (cfg) => POST('/api/llm/probe-vision', { cfg })
    },
    study: {
      boundary: (b, ids) => POST('/api/study/boundary', { bookId: b, selectedIds: ids }),
      analyze: (b, opts, cfg) => POST('/api/study/analyze', { bookId: b, opts, cfg }),
      saveAnalysis: (b, a) => POST('/api/study/save-analysis', { bookId: b, analysis: a }),
      state: (b) => J('/api/study/state/' + encodeURIComponent(b)),
      exam: (b, a, n) => POST('/api/study/exam', { bookId: b, analysis: a, questionCount: n }),
      getExam: (b, e) => J('/api/study/exam/' + encodeURIComponent(b) + '/' + encodeURIComponent(e)),
      grade: (b, e, ans) => POST('/api/study/grade', { bookId: b, examId: e, answers: ans }),
      mistakes: (b) => J('/api/study/mistakes/' + encodeURIComponent(b)),
      review: (b, n) => POST('/api/study/review', { bookId: b, maxQ: n }),
      remedial: (b, e) => POST('/api/study/remedial', { bookId: b, examId: e }),
      syllabus: (b) => J('/api/study/syllabus/' + encodeURIComponent(b)),
      syllabusExam: (b, o) => POST('/api/study/syllabusExam', { bookId: b, opts: o || {} }),
      rate: (b, e, r) => POST('/api/study/rate', { bookId: b, examId: e, ratings: r })
    },
    // v0.6：与 Electron preload 的 extra 命名空间一一对应（HTTP 模式同样可用）
    extra: {
      search: (q, limit) => POST('/api/search', { q, limit }),
      graph: (b) => J('/api/graph/' + encodeURIComponent(b)),
      report: (b, d) => J('/api/report/' + encodeURIComponent(b) + '?days=' + (d || 30)),
      cloze: (b) => J('/api/cloze/' + encodeURIComponent(b)),
      backupExport: (settings) => POST('/api/backup/export', { settings: settings || {} }),
      backupImport: (data, mode) => POST('/api/backup/import', { data, mode: mode || 'replace' })
    },
    // v0.7：反馈落盘 / 跨书今日复习（与 Electron preload 一一镜像）
    feedback: {
      save: (b, examId, answers) => POST('/api/feedback', { bookId: b, examId, answers }),
      list: (b) => J('/api/feedback/' + encodeURIComponent(b))
    },
    review: {
      queue: (limit) => J('/api/review/queue?limit=' + (limit || 50)),
      rate: (b, pointId, rating) => POST('/api/review/rate', { bookId: b, pointId, rating })
    },
    dialog: { openFiles: null }
  };

  // ============ GitHub Pages 预览站：无后端时回退只读示例 ============
  const DEMO_MSG = '预览站为只读展示，此操作请在桌面版进行';
  const demo = { checked: false, active: false, data: null };

  async function loadDemoData() {
    if (demo.data) return demo.data;
    const r = await fetch('./demo/book.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('demo data load failed: ' + r.status);
    demo.data = await r.json();
    return demo.data;
  }

  // 探测是否真有后端：尝试读 /api/books；失败（404/网络错误）则进入只读预览模式。
  async function ensureBackend() {
    if (demo.checked) return demo.active;
    demo.checked = true;
    if (hasApi) { demo.active = false; return false; }
    try {
      const r = await fetch('./api/books', { method: 'GET' });
      if (r.ok) { demo.active = false; return false; }
    } catch (e) { /* 无后端 */ }
    // 进入只读预览模式
    try { await loadDemoData(); } catch (e) { console.warn('[demo] 示例数据加载失败', e); }
    demo.active = true;
    document.body.classList.add('demo-mode');
    const banner = document.getElementById('demo-banner');
    if (banner) banner.style.display = '';
    return true;
  }

  // 只读示例数据应答：读路径返回内置数据；写路径一律拒绝并给出提示。
  function demoCall(ns, fn, args) {
    const a = args || [];
    const d = demo.data || {};
    const ok = (x) => Promise.resolve(x);
    if (ns === 'app') return ok(noopApp);
    if (ns === 'books') {
      if (fn === 'list') return ok([d.book].filter(Boolean));
      if (fn === 'get') return ok({ book: d.book || { ok: false }, materials: d.materials || [] });
      return ok({ ok: false, demo: true, reason: DEMO_MSG });
    }
    if (ns === 'materials') {
      if (fn === 'list') return ok(d.materials || []);
      if (fn === 'read') return ok((d.materials || []).find(m => m.id === a[1]) || { ok: false });
      if (fn === 'readAsset') return ok({ url: '', demo: true });
      return ok({ ok: false, demo: true, reason: DEMO_MSG });
    }
    if (ns === 'study') {
      if (fn === 'state') return ok({ analysis: d.analysis || null, exams: [] });
      if (fn === 'syllabus') return ok(d.syllabus || { chapters: [] });
      if (fn === 'boundary') return ok({ included: (d.materials || []).map(m => ({ id: m.id, name: m.name, layer: m.layer, role: m.role || '主资料' })), excluded: [] });
      if (fn === 'mistakes') return ok({ points: [] });
      return ok({ ok: false, demo: true, reason: DEMO_MSG });
    }
    if (ns === 'extra') {
      if (fn === 'search') return ok({ results: [] });
      if (fn === 'graph') return ok(d.graph || { nodes: [], edges: [], categories: [] });
      if (fn === 'report') return ok({ days: a[1] || 30, byDay: [], byTag: [], totals: { points: 0, questions: 0, exams: 0 } });
      if (fn === 'cloze') return ok({ cards: [] });
      return ok({ ok: false, demo: true, reason: DEMO_MSG });
    }
    if (ns === 'feedback') {
      if (fn === 'list') return ok([]);
      return ok({ ok: false, demo: true, reason: DEMO_MSG });
    }
    if (ns === 'review') {
      if (fn === 'queue') return ok([]);
      return ok({ ok: false, demo: true, reason: DEMO_MSG });
    }
    if (ns === 'trash') {
      if (fn === 'list') return ok([]);
      return ok({ ok: false, demo: true, reason: DEMO_MSG });
    }
    if (ns === 'insight') return ok({ ok: false, demo: true, reason: DEMO_MSG });
    if (ns === 'llm') return ok({ ok: false, demo: true, reason: DEMO_MSG });
    if (ns === 'dialog') return ok(null);
    return ok({ ok: false, demo: true, reason: DEMO_MSG });
  }

  // 用 demo 模式包装真实 API：先 ensureBackend() 探测，预览模式走示例数据，否则走真实请求。
  function buildDemoAware(realApi) {
    const out = {};
    Object.keys(realApi).forEach(ns => {
      if (ns === 'app' || ns === 'dialog') { out[ns] = realApi[ns]; return; }
      out[ns] = {};
      Object.keys(realApi[ns]).forEach(fn => {
        out[ns][fn] = function (...args) {
          return ensureBackend().then(() => demo.active ? demoCall(ns, fn, args) : realApi[ns][fn].apply(realApi[ns], args));
        };
      });
    });
    out.app = realApi.app || noopApp;
    return out;
  }

  // 决定最终暴露给前端的 API：Electron 直接用原生 ipc；浏览器先探测后端再决定。
  let finalApi;
  if (hasApi) {
    finalApi = window.api;
  } else {
    finalApi = buildDemoAware(httpApi);
    ensureBackend(); // 尽早探测，无后端时进入只读预览模式
  }
  window.API = finalApi;
})();
