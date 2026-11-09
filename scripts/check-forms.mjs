// 形态漂移检测（Dual-Distribution Pattern 的 check.sh 门禁）。
// 检查两件事：① 已安装 wrapper 与源码逐字节一致；② 各形态没有回退成旧分层离线架构。
// 任何一项不一致 → exit 1。用法：npm run forms:check
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, FORMS } from './_forms.mjs';

const bad = [];
let checked = 0;
let skipped = 0;
// 严格模式：CI / 发版前用，任何形态未安装都判定为「一致性未验证」并失败。
const requireInstalled = process.argv.includes('--require-installed');

for (const form of FORMS) {
  // 「未安装」不是「一致」：跳过只能得出「未验证」，绝不能打印 ✓ 一致（独立复核实证的造假）。
  if (!fs.existsSync(form.dst)) {
    skipped++;
    console.log('  ⚠ 未安装（一致性未验证）：' + form.label + ' -> ' + form.dst);
    continue;
  }
  for (const rel of form.files) {
    const from = path.join(form.src, rel);
    const to = path.join(form.dst, rel);
    checked++;
    if (!fs.existsSync(from)) { bad.push(form.label + ' / ' + rel + '：源码缺失'); continue; }
    if (!fs.existsSync(to)) { bad.push(form.label + ' / ' + rel + '：已安装副本缺失'); continue; }
    if (!fs.readFileSync(from).equals(fs.readFileSync(to))) bad.push(form.label + ' / ' + rel + '：与源码不一致（跑 npm run forms:sync）');
  }
}

// 旧架构回退检查（逐字符证据锚点）
const guards = [
  ['DSH Host 仍 require 旧 engine', path.join(ROOT, 'plugins', 'dsh-review-analysis', 'index.js'), /require\(['"]\.\/engine\//],
  ['DSH 发布清单仍打包 engine', path.join(ROOT, 'plugins', 'dsh-review-analysis', 'package.json'), /"engine\//],
  ['专家 driver 仍 require 本地 analyze', path.join(ROOT, 'plugins', 'review-analysis', 'bin', 'driver.js'), /require\(path\.join\(__dirname[^)]*analyze/],
  ['专家 agent 仍写 Always offline', path.join(ROOT, 'plugins', 'review-analysis', 'agents', 'review-analysis.md'), /Always offline|never call a model/i],
  ['形态地图仍是旧「引擎唯一真源 = DSH engine」', path.join(ROOT, 'plugins', 'README.md'), /引擎唯一真源\s*=\s*DSH 插件仓库的\s*`engine\//],
  ['同步脚本仍在复制 engine/lib', path.join(ROOT, 'scripts', 'sync-engine.mjs'), /engine\/lib\/\*/],
];
for (const [label, file, re] of guards) {
  checked++;
  if (!fs.existsSync(file)) { bad.push(label + '：文件不存在 ' + file); continue; }
  // 只看非注释行：说明文字里提到旧路径不算回退。
  const code = fs.readFileSync(file, 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|#|\/\*|\*|>)/.test(l)).join('\n');
  if (re.test(code)) bad.push(label + '（旧架构回退）');
}

if (bad.length) {
  console.error('[forms] ✗ 检测到形态漂移 / 旧架构回退（' + bad.length + ' 处）：');
  bad.forEach((x) => console.error('  - ' + x));
  process.exit(1);
}
if (skipped > 0) {
  console.warn('[forms] ⚠ ' + skipped + ' 个形态未安装，一致性未验证（已核查 ' + checked + ' 处守卫/文件）；结论为「部分验证」，不是「全部一致」');
  if (requireInstalled) {
    console.error('[forms] ✗ --require-installed：存在未安装形态，禁止放行');
    process.exit(1);
  }
  process.exit(0);
}
console.log('[forms] ✓ 形态一致且均指向唯一核心（核查 ' + checked + ' 处）');
