'use strict';
// api-client：同时兼容两种运行模式
//  - Electron：window.api 存在，直接走 ipc
//  - 浏览器/server：用 fetch 打 /api
(function () {
  const hasApi = !!window.api;
  const J = (url) => fetch(url).then(r => r.json());
  const POST = (url, o) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json());
  const PUT = (url, o) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json());
  const DEL = (url) => fetch(url, { method: 'DELETE' }).then(r => r.json());

  // HTTP / 无 Electron 模式下，app 桥接降级为 no-op（设置页会安全跳过这些功能）。
  const API = hasApi ? window.api : {
    app: {
      dataDir: () => Promise.resolve(null),
      env: () => Promise.resolve(null),
      checkUpdate: () => Promise.resolve({ ok: false, error: 'no-electron' }),
      installUpdate: () => Promise.resolve({ ok: false, error: 'no-electron' }),
      createShortcut: () => Promise.resolve({ ok: false, error: 'no-electron' }),
      onUpdateStatus: () => {}
    },
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
    llm: { test: (cfg) => POST('/api/llm/test', { cfg }) },
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
      syllabusExam: (b, o) => POST('/api/study/syllabusExam', { bookId: b, opts: o || {} })
    },
    dialog: { openFiles: null }
  };
  window.API = API;
})();
