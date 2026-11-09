'use strict';
// 统一核心 · 桌面端 / 服务端同步判别测试（项目约定：普通 node 脚本，失败 exit 1）。
// baseline 取自固定提交 9fb96f1 的真实旧版 app/main.js（未接 core、默认 index.html），
// candidate 为当前磁盘版本；两者用同一套「启动链路 + 路由契约」检查，旧红新绿。
// 注意：不能锚 git HEAD —— HEAD 会随 commit 前移，一旦把新版提交上去，
// 「旧版必红」就失去对照物而假失败（2026-11-09 发版时实测踩过）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MAIN = path.join(ROOT, 'app', 'main.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'core-sync-'));
process.env.REVIEW_LIBRARY_ROOT = TMP;

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ ' + msg); } }

// 用 electron stub 真编译执行 main.js，捕获启动行为与 ipc handler。
function runMain(src) {
  const st = { windows: [], menus: [], handlers: {}, whenReady: null, activate: null };
  class BW {
    constructor(opts) { this.opts = opts || {}; this.loaded = null; this.webContents = { send() {} }; st.windows.push(this); }
    loadFile(p) { this.loaded = p; }
    isDestroyed() { return false; }
    static getAllWindows() { return st.windows; }
  }
  const electron = {
    app: {
      isPackaged: false, getPath: () => TMP, getName: () => 'test', getVersion: () => '1.2.0',
      whenReady: () => ({ then: (cb) => { st.whenReady = cb; } }),
      on: (ev, cb) => { if (ev === 'activate') st.activate = cb; }, quit: () => {},
    },
    BrowserWindow: BW,
    ipcMain: { handle: (ch, fn) => { st.handlers[ch] = fn; } },
    dialog: { showOpenDialog: async () => ({ canceled: true }) },
    shell: { writeShortcutLink: () => true, openExternal: () => {} },
    Menu: { buildFromTemplate: (t) => ({ template: t }), setApplicationMenu: (m) => { st.menus.push(m); } },
  };
  const m = new Module(MAIN, module);
  m.filename = MAIN;
  m.paths = Module._nodeModulePaths(path.dirname(MAIN));
  const origLoad = Module._load;
  Module._load = function (request) { if (request === 'electron') return electron; return origLoad.apply(this, arguments); };
  try { m._compile(src, MAIN); } finally { Module._load = origLoad; }
  if (st.whenReady) st.whenReady();
  return st;
}

function startupIssues(st) {
  const issues = [];
  if (!st.handlers['core:request']) issues.push('未注册 core:request（Electron 侧没接统一核心）');
  if (!(st.windows[0] && /core\.html$/.test(st.windows[0].loaded || ''))) issues.push('默认窗口不是 core.html');
  const tpl = (st.menus[0] && st.menus[0].template) || [];
  const roles = tpl.map((x) => x.role);
  ['fileMenu', 'editMenu', 'windowMenu'].forEach((r) => { if (!roles.includes(r)) issues.push('菜单缺 ' + r); });
  const view = tpl.find((x) => x.label === '视图');
  if (!view || !(view.submenu || []).some((i) => /旧版/.test(i.label || ''))) issues.push('菜单缺旧版入口');
  return issues;
}

console.log('--- 判别测试：桌面端接到统一核心（旧版必红 / 新版必绿）---');
// 固定基线：9fb96f1 是「统一核心」提交之前的真实旧版（未接 core、默认 index.html）。
// 锚定 commit 而非 HEAD，保证以后每次 commit 都不会让 baseline 漂移。
const BASELINE_REV = '9fb96f1';
let oldSrc;
try { oldSrc = cp.execFileSync('git', ['show', BASELINE_REV + ':app/main.js'], { cwd: ROOT, encoding: 'utf8' }); }
catch (e) {
  console.error('  ✗ 无法从固定基线 ' + BASELINE_REV + ' 取旧版 main.js：' + e.message);
  process.exit(1);
}
const oldIssues = startupIssues(runMain(oldSrc));
console.log('  旧版违约项：' + oldIssues.join(' | '));
ok(oldIssues.length > 0, 'BASELINE 红：固定基线 ' + BASELINE_REV + ' 未接 core / 默认旧界面');

const curSrc = fs.readFileSync(MAIN, 'utf8');
const st = runMain(curSrc);
const curIssues = startupIssues(st);
ok(curIssues.length === 0, 'CANDIDATE 绿：当前主进程接上 core 且默认统一视图' + (curIssues.length ? '（' + curIssues.join(' | ') + '）' : ''));

console.log('--- 真跑 core:request 全链路（临时数据目录）---');
const dispatchHandler = st.handlers['core:request'];
if (!dispatchHandler) { ok(false, 'core:request 可用'); }
else {
  (async () => {
    const call = (p, method, body) => dispatchHandler(null, p, method, body);
    const r0 = await call('/books', 'GET');
    ok(r0.status === 200 && Array.isArray(r0.data.books) && r0.data.books.length === 0, 'GET /books：空书架');
    const r1 = await call('/books', 'POST', { title: '同步验证书' });
    ok(r1.status === 200 && !!r1.data.id, 'POST /books：真建书');
    const id = r1.data.id;
    const r2 = await call('/books/' + id + '/files', 'POST', { name: '讲义.txt', data: Buffer.from('第一章 绪论，核心概念。').toString('base64') });
    ok(r2.status === 200 && r2.data.name === '讲义.txt', 'POST files：真导入资料');
    const r3 = await call('/books/' + id, 'GET');
    ok(r3.status === 200 && r3.data.files && r3.data.files.length === 1, 'GET /books/:id：读回书与文件');
    const r4 = await call('/books/' + id + '/analysis', 'GET');
    ok(r4.status === 404, 'GET analysis：未分析时明确 404，不静默给空结果');
    const r5 = await call('/unknown', 'GET');
    ok(r5.status === 404, '未知路由明确 404');

    console.log('--- 路由语义单一真源 ---');
    const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    ok(/requestLib\.dispatch/.test(serverSrc), 'server.js 的 /api/core 走 core/request.js');
    ok(!/core\.createBook\(m\.title/.test(serverSrc), 'server.js 不再自带第二份路由映射');
    ok(/requestLib\.dispatch/.test(curSrc), 'main.js 也走同一份 core/request.js');
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'core.html'), 'utf8');
    // 所有子资源（script 的 src 与 link 的 href）都必须相对：file:// 下绝对路径会解析到盘符根。
    // 早期只查 src="/js/ 漏掉 href="/css/，导致默认窗口 CSS 全丢却仍判绿（独立复核实证）。
    const absRefs = html.match(/(?:src|href)\s*=\s*"\/[^"]*"/gi) || [];
    ok(absRefs.length === 0, 'core.html 所有 src/href 都是相对路径（file:// 可达），实得绝对路径：' + JSON.stringify(absRefs));
    const ui = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'core-ui.js'), 'utf8');
    ok(/coreRequest/.test(ui), 'core-ui.js 有 Electron 分支，不再裸 fetch');
    const preload = fs.readFileSync(path.join(ROOT, 'app', 'preload.js'), 'utf8');
    ok(/coreRequest/.test(preload), 'preload 暴露 coreRequest');

    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    console.log('\n--- 统一核心同步判别测试：通过 ' + passed + ' / 失败 ' + failed + ' ---');
    process.exit(failed ? 1 : 0);
  })().catch((e) => { console.error('FATAL', e); process.exit(1); });
}
