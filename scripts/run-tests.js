#!/usr/bin/env node
'use strict';
/**
 * 统一测试入口（v0.7）。
 * 旧版 `npm test` 只跑 test/store.test.js，v0.6 / regression / v0.7 的判别测试形同虚设；
 * 现在遍历 test/*.test.js 全量跑，任一红则整体非零退出。
 * test/packaged-verify.js 需要打包产物，由 scripts/verify-packaged.js 单独跑，不在这里误判。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// 主套件必须覆盖所有形态的判别测试。DSH 插件的测试是 .mjs（ESM），
// 早期只收 .test.js 导致它从未在根 npm test 里跑过（独立复核实证的覆盖漏）。
const dirs = [
  path.join(ROOT, 'test'),
  path.join(ROOT, 'core', '__tests__'),
  path.join(ROOT, 'plugins', 'dsh-review-analysis', 'test'),
];
const isTest = (f) => f.endsWith('.test.js') || f.endsWith('.test.mjs');
let files = [];
dirs.forEach(d => { if (fs.existsSync(d)) files = files.concat(fs.readdirSync(d).filter(isTest).map(f => path.join(d, f))); });
files.sort();

// --list：真跑收集逻辑、只输出套件名单，不执行任何测试。
// 供判别测试验证「DSH 的 .mjs 套件确实被主链路收集」，避免嵌套调用全套件造成递归与端口冲突。
if (process.argv.includes('--list')) {
  files.forEach((f) => console.log(path.relative(ROOT, f)));
  console.log('=== 收集 ' + files.length + ' 个套件 ===');
  process.exit(0);
}

let failed = 0;
console.log('=== 全量单测 / 判别测试（' + files.length + ' 个套件）===');
for (const f of files) {
  console.log('\n--- ' + path.relative(ROOT, f) + ' ---');
  const r = spawnSync(process.execPath, [f], {
    cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { NO_OPEN: '1' })
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) { failed++; console.log('  ✗ ' + path.relative(ROOT, f) + ' 未通过（exit ' + r.status + '）'); }
}
console.log('\n=== 汇总：' + (files.length - failed) + '/' + files.length + ' 个套件通过 ===');
if (failed) process.exit(1);
