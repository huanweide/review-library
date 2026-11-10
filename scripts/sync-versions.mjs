// 版本唯一真源同步：根 package.json 的 version 是唯一真源，机械传播到所有形态 manifest。
// 外查基准：legioncodeinc/vibe-coding-tools《02 - Sync Versions》——
// 「Never hand-edit a version in a per-harness manifest. Bump root package.json, then build.」
// 本脚本挂在 pretest 上，跑 npm test / npm run test 即自动同步，杜绝版本漂移。
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const rootPkg = path.join(ROOT, 'package.json');
const V = JSON.parse(fs.readFileSync(rootPkg, 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(V)) { console.error('[versions] 根 package.json version 非法：' + V); process.exit(1); }

console.log('[versions] 唯一真源 = 根 package.json → ' + V);
let changed = 0;

function sub(file, rel, re, make) {
  if (!fs.existsSync(file)) { console.log('  跳过（不存在）：' + rel); return; }
  const raw = fs.readFileSync(file, 'utf8');
  if (!re.test(raw)) { console.error('  ✗ 找不到版本字段：' + rel); process.exitCode = 1; return; }
  const next = raw.replace(re, make);
  if (next !== raw) { fs.writeFileSync(file, next); changed++; console.log('  已同步：' + rel); }
  else console.log('  已一致：' + rel);
}

// 1. VERSION 文件
const versionFile = path.join(ROOT, 'VERSION');
const want = V + '\n';
if (!fs.existsSync(versionFile) || fs.readFileSync(versionFile, 'utf8') !== want) {
  fs.writeFileSync(versionFile, want); changed++; console.log('  已同步：VERSION');
} else console.log('  已一致：VERSION');

// 1b. README 顶部定位行。check-versions.mjs 会检查第 3 行的版本号，但此前 sync 不写它，
// 于是每次升版本都漂移、必须手改 README，违背「改一处即传播」。这里补齐闭环。
const readmeFile = path.join(ROOT, 'README.md');
if (fs.existsSync(readmeFile)) {
  const rawR = fs.readFileSync(readmeFile, 'utf8');
  const lines = rawR.split('\n');
  const reV = /v\d+\.\d+\.\d+/;
  if (lines[2] && reV.test(lines[2])) {
    const nextLine = lines[2].replace(reV, 'v' + V);
    if (nextLine !== lines[2]) {
      lines[2] = nextLine;
      fs.writeFileSync(readmeFile, lines.join('\n'));
      changed++;
      console.log('  已同步：README.md 顶部定位行');
    } else console.log('  已一致：README.md 顶部定位行');
  } else {
    console.error('  ✗ README.md 第 3 行找不到版本号：' + (lines[2] || ''));
    process.exitCode = 1;
  }
}

// 1c. package-lock.json 的顶层 version 与 packages[""].version。
// npm ci 不校验根 version 一致性（本机 npm ci --dry-run 实测通过），但 lock 留旧号会造成
// 版本号不一致的假象，也会让下次重建 lock 产生无关 diff。只替换文件里前两处 version
// （顶层 + 根包），依赖包版本一律不动；写完用 JSON.parse 复核，防止误伤。
const lockFile = path.join(ROOT, 'package-lock.json');
if (fs.existsSync(lockFile)) {
  const rawL = fs.readFileSync(lockFile, 'utf8');
  let seen = 0;
  const nextL = rawL.replace(/"version"\s*:\s*"\d+\.\d+\.\d+"/g,
    (m) => (++seen <= 2 ? '"version": "' + V + '"' : m));
  try {
    const parsed = JSON.parse(nextL);
    if (parsed.version !== V || !parsed.packages || parsed.packages[''].version !== V) {
      throw new Error('lock 顶层/根包版本未对齐');
    }
  } catch (e) {
    console.error('  ✗ package-lock.json 同步校验失败：' + e.message + '（已放弃写入）');
    process.exitCode = 1;
  }
  if (!(process && process.exitCode)) {
    if (nextL !== rawL) { fs.writeFileSync(lockFile, nextL); changed++; console.log('  已同步：package-lock.json（2 处）'); }
    else console.log('  已一致：package-lock.json');
  }
}

// 2. 根 package.json 的 buildVersion（不动 version 本身，它是真源）
sub(rootPkg, 'package.json#build.buildVersion', /("buildVersion"\s*:\s*")[^"]+(")/, '$1' + V + '$2');

// 3. 统一核心常量
sub(path.join(ROOT, 'core', 'index.js'), 'core/index.js#CORE_VERSION', /(const CORE_VERSION = ')[^']+(')/, '$1' + V + '$2');

// 4. 各形态 manifest（源码）
const manifests = [
  ['plugins/dsh-review-analysis/package.json', 'DSH 插件'],
  ['plugins/review-analysis/.codebuddy-plugin/plugin.json', 'WorkBuddy 专家'],
];
// 5. 已安装副本（若存在；不重启宿主应用）
const installed = [
  [path.join(HOME, '.dsh', 'local-plugins', 'dsh-review-analysis', 'package.json'), '已安装 DSH 插件'],
  [path.join(HOME, '.workbuddy', 'plugins', 'marketplaces', 'my-experts', 'plugins', 'review-analysis', '.codebuddy-plugin', 'plugin.json'), '已安装专家'],
];
for (const [rel, label] of manifests) sub(path.join(ROOT, rel), label + '（源码）', /("version"\s*:\s*")[^"]+(")/, '$1' + V + '$2');
for (const [abs, label] of installed) {
  if (!fs.existsSync(abs)) { console.log('  跳过（不存在）：' + label); continue; }
  const raw = fs.readFileSync(abs, 'utf8');
  const re = /("version"\s*:\s*")[^"]+(")/;
  if (!re.test(raw)) { console.error('  ✗ 找不到版本字段：' + label); process.exitCode = 1; continue; }
  const next = raw.replace(re, '$1' + V + '$2');
  if (next !== raw) { fs.writeFileSync(abs, next); changed++; console.log('  已同步：' + label); }
  else console.log('  已一致：' + label);
}

console.log('[versions] 完成，改动 ' + changed + ' 处');
