'use strict';
// 构建脚本（Windows）：一条命令产出「安装器 + 免安装版 + 自动更新元数据」。
//
// 三个必须知道的坑（都在下面脚本里处理了，别删）：
//  1) 中文路径：NSIS 与 7za 走 ANSI 解析，项目路径含中文时 NSIS 会报
//     「!tempfile: Unable to create temporary file!」「Internal compiler error #12345」，
//     且脚本里的中文路径乱码。→ 解决：把源码复制到纯 ASCII 目录再构建，产物拷回。
//  2) ELECTRON_RUN_AS_NODE=1：宿主环境若带这个变量，Electron 会退化成纯 Node，
//     主进程第一行就崩，打包 exe 静默退出。→ 解决：构建/运行前显式清掉。
//  3) electron-updater 必须在 dependencies 且显式列入 build.files，
//     否则打包后「检查更新」报 Cannot find module。
//
// 用法：node scripts/build-win.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
const ASCII_DIR = path.join(os.homedir(), 'Desktop', 'rlbuild');
const KEEP = ['app', 'lib', 'renderer', 'test', '_e2e', 'scripts', 'server.js',
  'package.json', 'package-lock.json', '.gitignore', 'README.md', 'API配置.md', 'PROCESS',
  '启动.bat', '启动桌面版.bat'];

function log(s) { console.log('[build] ' + s); }
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: false }, opts || {}));
  if (r.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + ' 失败，退出码 ' + r.status);
}
// 复制目录：用 Windows 原生 robocopy。
// 原因：Node 的 fs.cpSync 在「路径含空格 + 中文」时于 Windows 上会静默失败（只复制出空目录），
// 而本项目路径正好是「Desktop\agent program\复习资料图书馆」，必须用 robocopy 才稳。
function copyDir(src, dst) {
  const r = spawnSync('robocopy', [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'],
    { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  // robocopy：0=无改动，1..7=成功复制，>=8=真错误
  if (r.status > 7) throw new Error('robocopy 失败(' + r.status + ')：' + src + ' -> ' + dst + '\n' + String(r.stderr || '').slice(0, 400));
}
function copyFile(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, dst);
}

log('源目录：' + SRC);
if (!/[^\x00-\x7F]/.test(SRC)) log('提示：源路径已是纯 ASCII，可直接原地构建');
else log('源路径含中文 → 复制到纯 ASCII 目录构建：' + ASCII_DIR);

// 1) 准备 ASCII 构建目录
spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', ASCII_DIR], { stdio: 'ignore' });
fs.mkdirSync(ASCII_DIR, { recursive: true });
for (const item of KEEP) {
  const s = path.join(SRC, item);
  if (!fs.existsSync(s)) continue;
  if (fs.statSync(s).isDirectory()) { copyDir(s, path.join(ASCII_DIR, item)); log('复制目录 ' + item); }
  else { copyFile(s, path.join(ASCII_DIR, item)); log('复制文件 ' + item); }
}

// 2) 复用本地缓存（electron zip / NSIS 工具链），避免重复下载
const cacheSrc = path.join(SRC, '.cache');
if (fs.existsSync(cacheSrc)) {
  copyDir(cacheSrc, path.join(ASCII_DIR, '.cache'));
  log('已复制本地构建缓存');
}

// 3) 装依赖
run('npm', ['install', '--no-audit', '--no-fund'], { cwd: ASCII_DIR, shell: true });

// 4) 构建（清掉 ELECTRON_RUN_AS_NODE，否则 Electron 变纯 Node）
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
env.ELECTRON_BUILDER_CACHE = path.join(ASCII_DIR, '.cache', 'eb');
log('开始构建 NSIS 安装器 + portable …');
run('npx', ['electron-builder', '--win', 'nsis', 'portable', '--publish', 'never'], { cwd: ASCII_DIR, env: env, shell: true });

// 5) 产物拷回（dist 已在 .gitignore，不入库）
const distOut = path.join(SRC, 'dist');
fs.mkdirSync(distOut, { recursive: true });
const distSrc = path.join(ASCII_DIR, 'dist');
let n = 0;
for (const f of fs.readdirSync(distSrc)) {
  if (!/\.(exe|blockmap|yml)$/.test(f)) continue;
  fs.copyFileSync(path.join(distSrc, f), path.join(distOut, f));
  n++;
}
log('已拷回 ' + n + ' 个产物到 ' + distOut);
// win-unpacked 目录 = 免安装版本体（可直接双击运行），打包版验证脚本也要用它
const unpackedSrc = path.join(distSrc, 'win-unpacked');
if (fs.existsSync(unpackedSrc)) {
  const unpackedDst = path.join(distOut, 'win-unpacked');
  spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', unpackedDst], { stdio: 'ignore' });
  copyDir(unpackedSrc, unpackedDst);
  log('已拷回免安装版目录 win-unpacked');
}
log('完成。安装器：ReviewLibrary-Setup-<version>.exe；自动更新还需把 latest.yml 与 .blockmap 一起发布到 GitHub Release。');
