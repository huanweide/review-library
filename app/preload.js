'use strict';
// Electron 安全桥：只暴露白名单方法给渲染进程，绝不开 nodeIntegration。
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  app: {
    dataDir: () => ipcRenderer.invoke('app:dataDir'),
    env: () => ipcRenderer.invoke('app:env'),
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    createShortcut: () => ipcRenderer.invoke('app:createShortcut'),
    onUpdateStatus: (cb) => ipcRenderer.on('update-status', (e, p) => cb(p))
  },
  books: {
    list: () => ipcRenderer.invoke('books:list'),
    create: (m) => ipcRenderer.invoke('books:create', m),
    get: (id) => ipcRenderer.invoke('books:get', id),
    update: (id, p) => ipcRenderer.invoke('books:update', id, p),
    delete: (id) => ipcRenderer.invoke('books:delete', id)
  },
  materials: {
    add: (b, l, items, m) => ipcRenderer.invoke('materials:add', b, l, items, m),
    delete: (b, m) => ipcRenderer.invoke('materials:delete', b, m),
    move: (b, m, t) => ipcRenderer.invoke('materials:move', b, m, t),
    read: (b, m) => ipcRenderer.invoke('materials:read', b, m),
    readAsset: (b, m, a) => ipcRenderer.invoke('materials:readAsset', b, m, a)
  },
  trash: {
    list: () => ipcRenderer.invoke('trash:list'),
    restore: (m) => ipcRenderer.invoke('trash:restore', m),
    purge: (k) => ipcRenderer.invoke('trash:purge', k)
  },
  insight: { generate: (b, p) => ipcRenderer.invoke('insight:generate', b, p) },
  llm: { test: (cfg) => ipcRenderer.invoke('llm:test', cfg) },
  study: {
    boundary: (b, ids) => ipcRenderer.invoke('study:boundary', b, ids),
    analyze: (b, opts, cfg) => ipcRenderer.invoke('study:analyze', b, opts, cfg),
    saveAnalysis: (b, a) => ipcRenderer.invoke('study:saveAnalysis', b, a),
    state: (b) => ipcRenderer.invoke('study:state', b),
    exam: (b, a, n) => ipcRenderer.invoke('study:exam', b, a, n),
    getExam: (b, e) => ipcRenderer.invoke('study:getExam', b, e),
    grade: (b, e, ans) => ipcRenderer.invoke('study:grade', b, e, ans),
    mistakes: (b) => ipcRenderer.invoke('study:mistakes', b),
    review: (b, maxQ) => ipcRenderer.invoke('study:review', b, maxQ),
    remedial: (b, e) => ipcRenderer.invoke('study:remedial', b, e),
    syllabus: (b) => ipcRenderer.invoke('study:syllabus', b),
    syllabusExam: (b, o) => ipcRenderer.invoke('study:syllabusExam', b, o),
    rate: (b, e, r) => ipcRenderer.invoke('study:rate', b, e, r)
  },
  // v0.6 竞品级能力：全局搜索 / 知识图谱 / 学习报告 / 挖空 / 整库备份
  extra: {
    search: (q, limit) => ipcRenderer.invoke('extra:search', q, limit),
    graph: (b) => ipcRenderer.invoke('extra:graph', b),
    report: (b, d) => ipcRenderer.invoke('extra:report', b, d),
    cloze: (b) => ipcRenderer.invoke('extra:cloze', b),
    backupExport: (settings) => ipcRenderer.invoke('extra:backupExport', settings),
    backupImport: (data, mode) => ipcRenderer.invoke('extra:backupImport', data, mode)
  },
  // v0.7：学完反馈落盘 / 跨书今日复习（与 server.js 的 HTTP 路由一一镜像）
  feedback: {
    save: (b, examId, answers) => ipcRenderer.invoke('feedback:save', b, { examId, answers }),
    list: (b) => ipcRenderer.invoke('feedback:list', b)
  },
  review: {
    queue: (limit) => ipcRenderer.invoke('review:queue', limit),
    rate: (b, pointId, rating) => ipcRenderer.invoke('review:rate', b, pointId, rating)
  },
  dialog: { openFiles: () => ipcRenderer.invoke('dialog:openFiles') }
});
