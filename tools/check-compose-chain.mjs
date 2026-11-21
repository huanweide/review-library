#!/usr/bin/env node
/**
 * 生成链路判别测试：锁死两个真问题的修复。
 *   T1 生成前不再强制弹窗要 key —— 2026-11-21 改：配置存在服务端，
 *      已配置就直接跑（用户原话「保存了使用」），缺配置才问一次。
 *      这一条 2026-11-19 的旧断言（必须每次都弹框、key 必须来自输入框）已被
 *      用户明确否掉，按新契约重写：密钥不得由前端持有，也不得写进 localStorage。
 *   T2 compose 默认输出预算 >= 16000（8000 实测被截断导致"缺 sections"）
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

// T1：生成链路先问「配好了吗」，缺配置才弹窗；密钥一律由服务端补齐
check(/async function askDocCredential\s*\(/.test(bs), 'T1a 生成前走统一配置检查（askDocCredential）');
check(/await readiness\(\)/.test(bs), 'T1b 已配置时直接生成，不弹框');
check(/const entered = await credentialDialog\(/.test(bs), 'T1c 只有缺配置才弹一次（复用共用对话框）');
check(!/localStorage\.setItem\('wb-llm'/.test(bs), 'T1d 前端不再把配置写进 localStorage');
check(/dlg\.addEventListener\('submit'/.test(bs), 'T1e 分析对话框 form 有 submit 防刷新');

// T2：默认 maxTokens >= 16000
const m = doc.match(/maxTokens:\s*maxTokens\s*\|\|\s*(\d+)/);
check(!!m && Number(m[1]) >= 16000, 'T2 compose 默认输出预算 >= 16000', m ? '实测 ' + m[1] : '未找到');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
