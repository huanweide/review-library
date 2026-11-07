'use strict';
// 启动打包版并跑真实验证（一条命令）。
//
// 必须先清掉 ELECTRON_RUN_AS_NODE：宿主环境若带这个变量，Electron 会退化成纯 Node，
// 主进程第一行就崩、打包 exe 静默退出，且没有任何报错提示——非常容易误判成"程序坏了"。
//
// 用法：node scripts/verify-packaged.js
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SRC = path.resolve(__dirname, '..');
// 验证用的 exe 优先用 ASCII 路径下的构建目录：
// Chromium 的调试端口在含中文的路径下起不来（CDP 无响应），而本项目路径正好含中文。
const ASCII_UNPACKED = path.join(require('os').homedir(), 'Desktop', 'rlbuild', 'dist', 'win-unpacked');
const LOCAL_UNPACKED = path.join(SRC, 'dist', 'win-unpacked');
const UNPACKED = fs.existsSync(path.join(ASCII_UNPACKED, 'ReviewLibrary.exe')) ? ASCII_UNPACKED : LOCAL_UNPACKED;
const EXE = path.join(UNPACKED, 'ReviewLibrary.exe');
const PORT = 9222;
const DATA = path.join(require('os').homedir(), 'Desktop', 'rlbuild', '_verify-data');

function log(s) { console.log('[verify] ' + s); }

if (!fs.existsSync(EXE)) {
  console.error('找不到打包产物：' + EXE + '\n请先跑：node scripts/build-win.js');
  process.exit(1);
}

// 清残留
spawnSync('taskkill', ['/F', '/IM', 'ReviewLibrary.exe'], { stdio: 'ignore' });
try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
fs.mkdirSync(DATA, { recursive: true });

// 启动：清 ELECTRON_RUN_AS_NODE + 指定独立数据目录 + 开 CDP
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
env.REVIEW_LIBRARY_ROOT = DATA;
log('启动打包 exe（数据目录 ' + DATA + '）…');
const app = spawn(EXE, ['--remote-debugging-port=' + PORT], { env, cwd: UNPACKED, detached: false, stdio: 'ignore' });

// 等 CDP 就绪
const http = require('http');
function cdpReady(cb) {
  http.get('http://127.0.0.1:' + PORT + '/json/version', r => { r.resume(); cb(true); })
    .on('error', () => cb(false));
}
let waited = 0;
const timer = setInterval(() => {
  waited += 500;
  cdpReady(ok => {
    if (ok || waited > 20000) {
      clearInterval(timer);
      if (!ok) { console.error('CDP 未就绪，程序可能启动失败'); try { app.kill(); } catch (e) {} process.exit(1); }
      log('CDP 已就绪，跑打包版验证…');
      const r = spawnSync(process.execPath, [path.join(SRC, 'test', 'packaged-verify.js')],
        { stdio: 'inherit', env: Object.assign({}, process.env, { CDP_URL: 'http://127.0.0.1:' + PORT, SHOT_DIR: path.join(SRC, 'dist') }) });
      try { app.kill(); } catch (e) {}
      process.exit(r.status === 0 ? 0 : 1);
    }
  });
}, 500);
