#!/usr/bin/env node
/**
 * 分析健壮性判别测试（2026-11-19）：
 *   T1 前端 analyze 显式传 timeoutMs（大资料 176s，默认 180s 会卡边缘超时）
 *   T2 quote 显示口径诚实：空 quote 不算「未命中」，讲解型单独标注
 * baseline（优化前备份）应 FAIL；当前应 PASS。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const target = process.argv[2] || path.join(ROOT, 'workbench', 'src', 'bookspace.js');
const bs = fs.readFileSync(target, 'utf8');
let pass = 0, fail = 0;
const check = (ok, label, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + label + (detail ? ' — ' + detail : '')); ok ? pass++ : fail++; };
console.log('检查：' + target + '\n');

// T1：analyze 调用带 timeoutMs，且 >= 360000
const t1 = bs.match(/host\.action\('analyze',\s*\{[^}]*timeoutMs:\s*(\d+)/);
check(!!t1 && Number(t1[1]) >= 360000, 'T1 analyze 显式 timeoutMs ≥ 360s', t1 ? '实测 ' + t1[1] : '未传');

// T2：quote 显示口径——有 quoteGiven 统计 + 讲解型措辞，不再裸显示 quoteTotal
check(/quoteGiven/.test(bs), 'T2a 只统计真正给了引文的条目');
check(/讲解型|无连续原文段/.test(bs), 'T2b 空 quote 用诚实措辞');
check(/quoteGiven\s*\n?\s*\?\s*'原文逐字命中'/.test(bs) || /quoteGiven[\s\S]{0,80}原文逐字命中/.test(bs), 'T2c 命中行基于 quoteGiven 而非 quoteTotal');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
