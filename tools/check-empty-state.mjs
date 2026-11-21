#!/usr/bin/env node
/**
 * workbench 书详情空状态 · 判别测试（maxloop 阶段五）
 *
 * 用法：
 *   node tools/check-empty-state.mjs                              # 当前版本（应 PASS）
 *   node tools/check-empty-state.mjs <path/to/bookspace.js>        # 指定文件（baseline 应 FAIL）
 *
 * 判据：未分析书是正常状态，不得混入 S.err 导致空状态出现「看错误详情」。
 *   baseline（优化前）：S.err = g.error 照单全收 → FAIL
 *   candidate（优化后）：S.err 排除「尚无分析结果」→ PASS
 *
 * 这是 UI 契约静态断言（读源码），不冒充能力测试——统一能力契约见 test/app-unified.test.js。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(HERE, '..', 'workbench', 'src', 'bookspace.js');
const src = fs.readFileSync(target, 'utf8');
let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (detail ? ' — ' + detail : ''));
  ok ? pass++ : fail++;
};

console.log('检查：' + target + '\n');

// 判据 1：get 失败分支不得把「尚无分析结果」原文直接赋给 S.err
const rawAssign = /S\.err\s*=\s*\(g\s*&&\s*g\.error\)\s*\|\|\s*''/;
check(!rawAssign.test(src), 'S.err 不照单全收 g.error', rawAssign.test(src) ? '发现裸赋值' : '已做状态判别');

// 判据 2：必须显式排除「尚无分析结果」这个正常状态
const guards = ['尚无分析结果', 'includes(\'尚无分析结果\')', 'includes("尚无分析结果")'];
check(guards.some(g => src.includes(g)), '显式识别未分析状态', guards.find(g => src.includes(g)) || '未找到判别');

// 判据 3：排除后 S.err 赋空串（真异常仍保留）——保证真异常不被误吞
const filtered = /S\.err\s*=\s*[^;]*includes\([^;]*'\s*'\s*:/.test(src) || /includes\([^)]*\)\s*\?\s*''\s*:/.test(src);
check(filtered, '未分析→空串、真异常→保留原文', filtered ? '三元判别存在' : '未找到三元判别');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
