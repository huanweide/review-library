#!/usr/bin/env node
/**
 * 「资料自带结构沿用 + 大图排版」判别测试（2026-11-19）
 *
 * 锁死三件事（都是本轮真机暴露的真问题）：
 *   T1 提示词：资料自带章节/编号/目录树时，必须沿用原结构（不许模型重编、合并、砍节）
 *   T2 语料上限：>= 12 万字符（真实考点资料 8.1 万，5 万必截断丢后半本）
 *   T3 输出预算：>= 4.8 万 token（229 个知识点全收 + 24 道完整题）
 *   T4 导图折叠：大树自动收浅 + 可点展开（否则 229 节点被压成一条竖线）
 *
 * baseline（_archive 里的优化前副本）应 FAIL；当前应 PASS。
 * 用法：node tools/check-structure-fidelity.mjs [analyzePath] [mindmapPath]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const analyzePath = process.argv[2] || path.join(ROOT, 'core', 'analyze.js');
const mindmapPath = process.argv[3] || path.join(ROOT, 'workbench', 'src', 'mindmap.js');
const A = fs.readFileSync(analyzePath, 'utf8');
const M = fs.readFileSync(mindmapPath, 'utf8');

let pass = 0, fail = 0;
const check = (ok, label, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + label + (detail ? ' — ' + detail : '')); ok ? pass++ : fail++; };
console.log('检查：\n  ' + analyzePath + '\n  ' + mindmapPath + '\n');

// T1 提示词必须写明「资料自带结构时照搬」
check(/资料自带结构时|一律照搬|照搬/.test(A), 'T1a 提示词要求沿用资料自带结构');
check(/不许重新创作|不许合并|不重编|不许为了「精简」砍节/.test(A), 'T1b 明令不许重编/合并/砍节');
check(/完整性优先于美观|漏掉一个编号条目就是漏考点/.test(A), 'T1c 完整性优先于美观（防模型自我精简）');

// T2 语料上限
const capM = A.match(/const MAX_CORPUS = (\d+)/);
check(!!capM && Number(capM[1]) >= 120000, 'T2 语料上限 ≥ 120000', capM ? '实测 ' + capM[1] : '未找到');

// T3 输出预算
const budM = A.match(/Math\.min\((\d+),\s*24000 \+ Math\.round/);
check(!!budM && Number(budM[1]) >= 48000, 'T3 输出预算上限 ≥ 48000', budM ? '实测 ' + budM[1] : '未找到');

// T4 导图折叠
check(/function foldTree|foldTree\(/.test(M), 'T4a 渲染前折叠 foldTree');
check(/depthCap|pickDepth/.test(M), 'T4b 按规模自动决定展开深度');
check(/mm-foldable|hidden > 0/.test(M), 'T4c 有收起角标 + 可点展开');
check(/expanded\.add|expanded\.has/.test(M), 'T4d 点节点可逐层展开');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
