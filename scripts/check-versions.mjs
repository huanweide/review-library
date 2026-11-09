// 版本漂移检测：所有形态 manifest 必须与根 package.json 的 version 一致。
// 外查基准：Dual-Distribution Pattern「Drift detection runs in CI / pre-commit」+
// 《02 - Sync Versions》「check-version-sync.sh reads the root version and diffs it against every harness manifest」。
// 任何不一致 → exit 1（挂在 pretest，漂移即阻断测试）。
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const bad = [];
let checked = 0;

function read(rel) {
  const f = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8');
}
function expect(label, got) {
  checked++;
  if (got === null) { bad.push(label + '：文件不存在'); return; }
  if (String(got) !== V) bad.push(label + '：实为 ' + got + '，应为 ' + V);
}
function pickVersion(label, rel) {
  const raw = read(rel);
  if (raw === null) { expect(label, null); return; }
  const m = raw.match(/"version"\s*:\s*"([^"]+)"/);
  expect(label, m ? m[1] : '（无 version 字段）');
}

// 根 buildVersion
const rootRaw = read('package.json');
const bm = rootRaw.match(/"buildVersion"\s*:\s*"([^"]+)"/);
expect('package.json#build.buildVersion', bm ? bm[1] : '（无字段）');

// VERSION 文件
const vf = read('VERSION');
expect('VERSION', vf === null ? null : vf.trim());

// 统一核心常量
const coreRaw = read('core/index.js');
const cm = coreRaw && coreRaw.match(/const CORE_VERSION = '([^']+)'/);
expect('core/index.js#CORE_VERSION', cm ? cm[1] : '（无常量）');

// 各形态 manifest（源码）
pickVersion('DSH 插件 package.json', 'plugins/dsh-review-analysis/package.json');
pickVersion('WorkBuddy 专家 plugin.json', 'plugins/review-analysis/.codebuddy-plugin/plugin.json');

// 已安装副本（存在才检查）
const installed = [
  ['已安装 DSH 插件', path.join(HOME, '.dsh', 'local-plugins', 'dsh-review-analysis', 'package.json')],
  ['已安装专家', path.join(HOME, '.workbuddy', 'plugins', 'marketplaces', 'my-experts', 'plugins', 'review-analysis', '.codebuddy-plugin', 'plugin.json')],
];
for (const [label, abs] of installed) if (fs.existsSync(abs)) pickVersion(label, abs);

// README 顶部定位行必须标当前版本（历史段落里的旧版本号不改，那是事实记录）
const readme = read('README.md');
const line3 = readme ? readme.split('\n')[2] || '' : '';
expect('README.md 顶部定位行', /v(\d+\.\d+\.\d+)/.test(line3) ? line3.match(/v(\d+\.\d+\.\d+)/)[1] : '（未标版本）');

if (bad.length) {
  console.error('[versions] ✗ 检测到版本漂移（' + bad.length + ' 处）：');
  bad.forEach((x) => console.error('  - ' + x));
  process.exit(1);
}
console.log('[versions] ✓ 版本一致：' + V + '（核查 ' + checked + ' 处）');
