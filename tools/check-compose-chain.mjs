#!/usr/bin/env node
/**
 * 生成链路判别测试：锁死两个真问题的修复。
 *   T1 生成前不再强制要 key —— 2026-11-21：配置存在服务端（用户原话「保存了使用」）。
 *      2026-11-24 契约调整：分析对话框保留（要选模型/深挖开关），但配置预填、
 *      密钥由服务端补，前端不持有也不写 localStorage。
 *      旧断言 askDocCredential/readiness/credentialDialog 是 11-21 实现的函数名，
 *      11-24 重写 openAnalyze 后已不存在，按当前真实契约重写，意图不变：
 *      生成前有配置校验、密钥不落盘、表单 submit 不刷新。
 *   T2 compose 默认输出预算 >= 16000（8000 实测被截断导致"缺 sections"）。
 *      11-24 新增 review-guide 分支，默认值从纯数字变成三元表达式
 *      `(kind === 'review-guide' ? 32000 : 16000)`，正则取所有数字并断言最小值。
 * baseline（修复前备份）应 FAIL；当前应 PASS。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const bsPath = process.argv[2] || path.join(ROOT, 'workbench', 'src', 'bookspace.js');
const docPath = process.argv[3] || path.join(ROOT, 'core', 'documents.js');
const bs = fs.readFileSync(bsPath, 'utf8');
const doc = fs.readFileSync(docPath, 'utf8');
let pass = 0, fail = 0;
const check = (ok, label, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + label + (detail ? ' — ' + detail : '')); ok ? pass++ : fail++; };
console.log('检查：' + bsPath + ' / ' + docPath + '\n');

// T1（2026-11-27 闭环）：llm-config.js 第 10 行的契约「已配置默认零表单」终于接线。
// 已就绪 → readiness().ok → 不弹表单直接 runAnalysis；缺配置 → 共用 credentialDialog 弹一次。
check(/async function openAnalyze\s*\(/.test(bs) && /await readiness\(\)/.test(bs) && /if \(r\.ok\)/.test(bs),
  'T1a 先判 readiness，已配置走零表单分支');
check(/return runAnalysis\(/.test(bs) && !/bs-dialog/.test(bs.slice(bs.indexOf('async function openAnalyze'), bs.indexOf('async function runAnalysis'))),
  'T1b 已配置分支不构造任何对话框（零表单）');
check(/await credentialDialog\(/.test(bs) && /if \(!cfg\) return/.test(bs),
  'T1c 缺配置才弹一次共用对话框，取消即退出');
check(/async function runAnalysis\(/.test(bs) && (bs.match(/runAnalysis\(/g) || []).length >= 3,
  'T1d 两条入口共用同一份分析体，不留第二份分叉');
check(!/localStorage\.setItem\('wb-llm'/.test(bs), 'T1d 前端不再把配置写进 localStorage');
// 分析对话框已移除，submit 防刷新由共用的 credentialDialog 与设置页负责（llm-config.js / views.js）。
check(/dlg\.addEventListener\('submit'/.test(fs.readFileSync(path.join(ROOT, 'workbench', 'src', 'llm-config.js'), 'utf8'))
  && /form\.addEventListener\('submit'/.test(fs.readFileSync(path.join(ROOT, 'workbench', 'src', 'views.js'), 'utf8')),
  'T1e 共用对话框与设置页表单都有 submit 防刷新');

// T2：默认 maxTokens >= 16000（含 11-24 的 review-guide 三元分支）
const tail = doc.match(/maxTokens:\s*maxTokens\s*\|\|\s*([^,\n]+)/);
const nums = tail ? (tail[1].match(/\d{4,}/g) || []).map(Number) : [];
check(nums.length > 0 && Math.min(...nums) >= 16000, 'T2 compose 默认输出预算 >= 16000',
  tail ? '实测 ' + nums.join('/') : '未找到');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
