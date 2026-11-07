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
const dir = path.join(ROOT, 'test');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;

console.log('=== 全量单测 / 判别测试（' + files.length + ' 个套件）===');
for (const f of files) {
  console.log('\n--- ' + f + ' ---');
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { NO_OPEN: '1' })
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) { failed++; console.log('  ✗ ' + f + ' 未通过（exit ' + r.status + '）'); }
}
console.log('\n=== 汇总：' + (files.length - failed) + '/' + files.length + ' 个套件通过 ===');
if (failed) process.exit(1);
