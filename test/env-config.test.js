'use strict';
const assert = require('assert');
const { readApiEnv } = require('../lib/env-config');
let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; fails.push(name + (extra ? ' [' + extra + ']' : '')); } }

// 备份并清掉相关变量，避免宿主环境干扰
const saved = { B: process.env.RL_API_BASE, K: process.env.RL_API_KEY, M: process.env.RL_API_MODEL };
delete process.env.RL_API_BASE; delete process.env.RL_API_KEY; delete process.env.RL_API_MODEL;
ok('无变量时返回空', (() => { const r = readApiEnv(); return r.baseURL === '' && r.apiKey === '' && r.model === ''; })());

process.env.RL_API_BASE = '  https://api.siliconflow.cn/v1  ';
process.env.RL_API_KEY = '  sk-xyz  ';
process.env.RL_API_MODEL = ' deepseek-ai/DeepSeek-V4.1-Flash ';
const r = readApiEnv();
ok('读取并 trim 首尾空格', r.baseURL === 'https://api.siliconflow.cn/v1' && r.apiKey === 'sk-xyz' && r.model === 'deepseek-ai/DeepSeek-V4.1-Flash');

// 还原环境
if (saved.B === undefined) delete process.env.RL_API_BASE; else process.env.RL_API_BASE = saved.B;
if (saved.K === undefined) delete process.env.RL_API_KEY; else process.env.RL_API_KEY = saved.K;
if (saved.M === undefined) delete process.env.RL_API_MODEL; else process.env.RL_API_MODEL = saved.M;

console.log('env-config 单测： ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('  失败：' + fails.join('; ')); process.exit(1); }
