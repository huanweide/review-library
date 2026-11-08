'use strict';
// Electron 主进程：用 window.api 暴露 store（同一套落盘逻辑），前端无需知道走的是 Electron 还是 server。
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { Store } = require('../lib/store');
const insight = require('../lib/insight');
const media = require('../lib/media');
const study = require('../lib/study');
const llm = require('../lib/llm');
const { readApiEnv } = require('../lib/env-config');
// v0.6 竞品级能力（与 server.js 的 /api 路由一一对应，四层镜像不许缺边）
const searchLib = require('../lib/search');
const graphLib = require('../lib/graph');
const analyticsLib = require('../lib/analytics');
const clozeLib = require('../lib/cloze');
const backupLib = require('../lib/backup');
const reviewLib = require('../lib/review');
const mindmapLib = require('../lib/mindmap');

// asar 是只读虚拟文件系统，数据目录绝不能落在 __dirname/..（打包后会直接崩）。
// 优先级：环境变量 REVIEW_LIBRARY_ROOT
//   > PORTABLE_EXECUTABLE_DIR（electron-builder 单文件 portable 注入，指向用户放置 exe 的目录）
//   > 免安装目录版 exe 同级 library
//   > 开发版项目内 library。
// 为什么必须有第二条：portable exe 会自解压到系统临时目录再运行，
// app.getPath('exe') 指向的是临时解压目录，用它会让数据落在临时目录、关掉即丢。
const DATA_DIR = process.env.REVIEW_LIBRARY_ROOT ||
  (process.env.PORTABLE_EXECUTABLE_DIR
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'library')
    : app.isPackaged
      ? path.join(path.dirname(app.getPath('exe')), 'library')
      : path.join(__dirname, '..', 'library'));
const store = new Store(DATA_DIR);

// 让界面/验证脚本能查到「数据到底存在哪」，避免 portable 版落点成了黑盒。
ipcMain.handle('app:dataDir', () => DATA_DIR);
ipcMain.handle('books:list', () => store.listBooks());
ipcMain.handle('books:create', (e, m) => store.createBook(m));
ipcMain.handle('books:get', (e, id) => store.getBook(id));
ipcMain.handle('books:update', (e, id, patch) => store.updateBook(id, patch));
ipcMain.handle('books:delete', (e, id) => store.deleteBook(id));
ipcMain.handle('materials:add', (e, bookId, layer, items, meta) => {
  // 上传入口：PPTX/DOCX 自动抽取内嵌媒体（图片）挂到资料的 assets 上；PDF 的页图由渲染进程预处理后随 items 传入。
  const prepped = (items || []).map(it => {
    const ext = path.extname(it.name || '').toLowerCase();
    if ((ext === '.pptx' || ext === '.docx') && it.data) {
      try {
        const buf = Buffer.from(it.data, 'base64');
        const med = media.extractOfficeMedia(buf, ext);
        if (med.length) it = Object.assign({}, it, {
          assets: med.map(m => ({ name: m.name, data: m.data, kind: 'media', slide: m.slide, caption: '' }))
        });
      } catch (err) { /* 抽图失败不阻断入库 */ }
    }
    return it;
  });
  return store.addMaterials(bookId, layer, prepped, meta);
});
ipcMain.handle('materials:delete', (e, bookId, mid) => store.deleteMaterial(bookId, mid));
ipcMain.handle('materials:move', (e, bookId, mid, toLayer) => store.moveMaterial(bookId, mid, toLayer));
ipcMain.handle('materials:read', (e, bookId, mid) => store.readMaterial(bookId, mid));
ipcMain.handle('materials:readAsset', (e, bookId, mid, aid) => store.readAsset(bookId, mid, aid));
ipcMain.handle('trash:list', () => store.listTrash());
ipcMain.handle('trash:restore', (e, m) => { if (m && m.type === 'book') return store.restoreBook(m.key); return store.restoreMaterial(m.key); });
ipcMain.handle('trash:purge', (e, key) => store.purgeTrash(key));

// 分析与出题：与 server.js 同一套 lib/study.js，前端不分辨走的是 ipc 还是 http。
ipcMain.handle('llm:test', (e, cfg) => llm.testConnection(cfg || {}));
ipcMain.handle('study:boundary', (e, b, ids) => study.boundary(store, b, ids));
ipcMain.handle('study:analyze', (e, b, opts, cfg) => study.analyze(store, b, Object.assign({}, opts || {}, { cfg })));
ipcMain.handle('study:saveAnalysis', (e, b, a) => store.saveAnalysis(b, a));
ipcMain.handle('study:state', (e, b) => ({ analysis: store.getAnalysis(b), exams: store.listExams(b) }));
ipcMain.handle('study:exam', (e, b, a, n) => {
  const ex = study.makeExam(a, { questionCount: n }); store.saveExam(b, ex); return study.paperOf(ex);
});
ipcMain.handle('study:getExam', (e, b, id) => {
  const ex = store.getExam(b, id); return ex ? study.paperOf(ex) : null;
});
ipcMain.handle('study:grade', (e, b, id, ans) => {
  const ex = store.getExam(b, id); if (!ex) return { ok: false, reason: '试卷不存在' };
  // 幂等：与 server.js /api/study/grade 同口径，重复交卷不重算、不刷错题统计。
  if (ex.grading && ex.grading.length) return {
    ok: true, replayed: true, grading: ex.grading, weakPointIds: ex.weakPointIds || [],
    summary: { total: ex.grading.length,
      correct: ex.grading.filter(g => g.verdict === '正确').length,
      partial: ex.grading.filter(g => g.verdict === '部分正确').length,
      wrong: ex.grading.filter(g => g.verdict === '错误').length }
  };
  const r = study.gradeExam(ex, ans || {}); store.saveExam(b, ex);
  store.recordGrade(b, ex, store.getAnalysis(b));
  return r;
});
ipcMain.handle('study:mistakes', (e, b) => study.summarizeMistakes(store, b));
ipcMain.handle('study:review', (e, b, maxQ) => {
  const r = study.reviewExam(store, b, Date.now(), maxQ);
  if (!r.ok) return r;
  store.saveExam(b, r.exam);
  return { ok: true, paper: study.paperOf(r.exam), dueCount: r.dueCount };
});
ipcMain.handle('study:remedial', (e, b, id) => {
  const ex = store.getExam(b, id); if (!ex) return { ok: false, reason: '试卷不存在' };
  const r = study.remedial(ex, store.getAnalysis(b));
  if (!r.ok) return r;
  store.saveExam(b, r.exam);
  return { ok: true, paper: study.paperOf(r.exam), weakPointIds: r.weakPointIds };
});
ipcMain.handle('study:syllabus', (e, bookId) => study.buildBookOutline(store, bookId));
ipcMain.handle('study:syllabusExam', (e, bookId, opts) => study.bankExam(store, bookId, opts || {}));
ipcMain.handle('study:rate', (e, bookId, examId, ratings) => study.applyRatings(store, bookId, examId, ratings || {}));
// v0.6：全局搜索 / 知识图谱 / 学习报告 / 挖空 / 整库备份（全部纯本地）
ipcMain.handle('extra:search', (e, q, limit) => searchLib.searchAll(store, q, { limit }));
ipcMain.handle('extra:graph', (e, bookId) => graphLib.buildGraph(store.getAnalysis(bookId) || {}));
ipcMain.handle('extra:report', (e, bookId, days) => analyticsLib.buildReport(store, bookId, Date.now(), { days: days || 30 }));
ipcMain.handle('extra:cloze', (e, bookId) => ({ cards: clozeLib.makeDeck((store.getAnalysis(bookId) || {}).points || [], { limit: 40 }) }));
// v0.7：导出带脱敏设置与完整性摘要；导入与 HTTP 侧同口径拒绝非法 mode。
ipcMain.handle('extra:backupExport', (e, settings) => backupLib.buildBackup(store, { settings }));
ipcMain.handle('extra:backupImport', (e, data, mode) => {
  if (mode != null && mode !== 'replace') return { ok: false, error: '不支持的恢复模式（只支持 replace 覆盖恢复）' };
  return backupLib.importAll(store, data, { mode: mode || 'replace' });
});
// 学完反馈落盘（旧版只写 localStorage，恢复备份后全丢）
ipcMain.handle('feedback:save', (e, bookId, payload) => store.saveFeedback(bookId, payload));
ipcMain.handle('feedback:list', (e, bookId) => store.listFeedback(bookId));
ipcMain.handle('mindmap:list', (e, bookId) => mindmapLib.getMaps(store, bookId));
ipcMain.handle('mindmap:generate', async (e, bookId, cfg, force) => mindmapLib.generate(store, bookId, cfg, { force: !!force }));
ipcMain.handle('mindmap:node', (e, bookId, mapId, nodeId) => mindmapLib.getNode(store, bookId, mapId, nodeId));
// 跨书今日复习队列 + 独立闪卡四档自评
ipcMain.handle('review:queue', (e, limit) => reviewLib.queueAcrossBooks(store, Date.now(), { limit: limit || 50 }));
ipcMain.handle('review:rate', (e, bookId, pointId, rating) => reviewLib.rateCard(store, bookId, pointId, rating, Date.now()));
ipcMain.handle('insight:generate', (e, bookId, prompt) => insight.generate(store, bookId, prompt));
ipcMain.handle('dialog:openFiles', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

// 环境变量里的 API 配置（辅助测试兜底），渲染进程经此桥接取得，绝不在渲染进程直接读 process.env。
ipcMain.handle('app:env', () => readApiEnv());

// 创建桌面快捷方式（Windows）。返回是否成功与路径。
ipcMain.handle('app:createShortcut', () => {
  try {
    const desktop = app.getPath('desktop');
    const link = path.join(desktop, 'ReviewLibrary.lnk');
    const exe = app.getPath('exe');
    const ok = shell.writeShortcutLink(link, { target: exe, description: '复习资料图书馆', icon: exe, iconIndex: 0 });
    return { ok, path: link };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// 自动更新：仅打包后启用；开发模式（npm run dev / server.js）跳过，避免 electron-updater 报错。
let mainWin = null;
function send(channel, payload) { if (mainWin && mainWin.webContents && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload); }

function checkForUpdate() {
  if (!app.isPackaged) return { ok: false, error: '开发模式不检查更新' };
  try { require('electron-updater').autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
function installUpdate() {
  if (!app.isPackaged) return { ok: false, error: '开发模式无需安装' };
  try { require('electron-updater').autoUpdater.quitAndInstall(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
// 上游报错可能带一大坨响应体/请求头（GitHub 404 会），对用户只需一句人话。
function friendlyUpdateError(msg) {
  const s = String(msg || '');
  if (/404/.test(s) && /releases/.test(s)) return 'GitHub 上还没有这个仓库的发布版本（404）。仓库建好并发布 Release 后即可自动更新。';
  if (/404/.test(s)) return 'GitHub 上找不到目标（404）。仓库或 Release 尚未创建。';
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network/i.test(s)) return '连不上 GitHub，检查网络或代理设置。';
  if (/401|403/.test(s)) return 'GitHub 拒绝访问（401/403），可能需要鉴权。';
  return s.split('\n')[0].slice(0, 160) || '未知错误';
}
ipcMain.handle('app:checkUpdate', () => checkForUpdate());
ipcMain.handle('app:installUpdate', () => installUpdate());

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { return; }
  autoUpdater.autoDownload = false; // 先提示，用户点「安装并重启」再下
  autoUpdater.on('checking-for-update', () => send('update-status', { state: 'checking' }));
  autoUpdater.on('update-available', (i) => send('update-status', { state: 'available', version: i && i.version, notes: (i && i.releaseNotes) || '' }));
  autoUpdater.on('update-not-available', () => send('update-status', { state: 'uptodate' }));
  autoUpdater.on('error', (e) => send('update-status', { state: 'error', message: friendlyUpdateError((e && e.message) || e) }));
  autoUpdater.on('download-progress', (p) => send('update-status', { state: 'downloading', percent: Math.floor((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', () => send('update-status', { state: 'downloaded' }));
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1320, height: 880, minWidth: 960, minHeight: 640,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => { createWindow(); setupAutoUpdater(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
