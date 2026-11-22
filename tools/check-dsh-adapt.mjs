#!/usr/bin/env node
/**
 * DSH 版本适配特化判别（旧版必红 / 改后必绿）。
 *
 *   node tools/check-dsh-adapt.mjs
 *
 * baseline 用固化夹具 test/fixtures/dsh-index-legacy.js（= 引入 DSH 适配前最后一版
 * 5a150cd 的真实源码，字节原样），**不再取 git HEAD**：
 * HEAD 会随提交前移，一旦新版进了 HEAD，"旧版必须没有 X" 这类对照断言就会集体失真
 * （2026-11-22 搬迁后重跑时真实踩到：HEAD 已是新版，A1–A4 假红 4 条）。
 * 夹具是历史事实的拷贝，不依赖任何一次后续提交。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLUGIN = path.join(ROOT, 'plugins', 'dsh-review-analysis');
const SRC = fs.readFileSync(path.join(PLUGIN, 'index.js'), 'utf8');
const PATCH = fs.readFileSync(path.join(PLUGIN, 'cordis.patch.yml'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-engine.mjs'), 'utf8');
const S = require(path.join(ROOT, 'core', 'settings.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + String(extra).slice(0, 200) : '')); }
};

const LEGACY_FILE = path.join(ROOT, 'test', 'fixtures', 'dsh-index-legacy.js');
let LEGACY = '';
try { LEGACY = fs.readFileSync(LEGACY_FILE, 'utf8'); } catch (e) { LEGACY = ''; }

console.log('[A] baseline（固化旧版夹具）必须是红的，否则这条判别没有分辨力');
// 夹具缺失会让 A1–A4 因空串而「全绿」——那是假绿，必须先钉住夹具本身。
ok('A0 旧版夹具存在且非空', LEGACY.length > 5000, LEGACY ? LEGACY.length + ' 字节' : '缺失');
ok('A1 旧版没有 settings 端点', !!LEGACY && !/\/review-analysis\/api\/settings/.test(LEGACY));
ok('A2 旧版没有 models 端点', !!LEGACY && !/\/review-analysis\/api\/models/.test(LEGACY));
ok('A3 旧版没托管新模块', !!LEGACY && !/src\/overview\.mjs/.test(LEGACY) && !/src\/llm-config\.js/.test(LEGACY));
ok('A4 旧版 projectRoot 只能手工给', !!LEGACY && !/resolveProjectRoot/.test(LEGACY));

console.log('[B] 当前 DSH 插件：所有 DSH 版本共用同一套能力');
ok('B1 注册 settings / settings:test / models 三个端点',
  /API_SETTINGS = '\/review-analysis\/api\/settings'/.test(SRC)
  && /API_SETTINGS_TEST = '\/review-analysis\/api\/settings\/test'/.test(SRC)
  && /API_MODELS = '\/review-analysis\/api\/models'/.test(SRC));
ok('B2 三个端点真的注册进 webServer',
  /path: API_SETTINGS,/.test(SRC) && /path: API_SETTINGS_TEST,/.test(SRC) && /path: API_MODELS,/.test(SRC));
ok('B3 action 入口用 core/settings 补 key（不是另写一套）',
  /getSettings\(\).*mergeCfg|S\.mergeCfg\(root, rawCfg\)/.test(SRC) && /S\.remember\(root, rawCfg\)/.test(SRC));
ok('B4 面板静态资源补上两个新模块', /src\/llm-config\.js/.test(SRC) && /src\/overview\.mjs/.test(SRC));
ok('B5 .mjs 的 MIME 已注册（否则 overview.mjs 下载下来也执行不了）', /'\.mjs': 'text\/javascript/.test(SRC));
ok('B6 新增端点全部做同源校验', (SRC.match(/if \(!admitted\(ctx, req\)\) return sendJson\(res, 403/g) || []).length >= 6);

console.log('[C] 可移植化：所有 DSH 版本都能找到统一核心');
ok('C1 patch 不再写作者本机绝对路径', !/C:\/Users\/Administrator/.test(PATCH) && /__AUTO__/.test(PATCH));
ok('C2 安装同步脚本写 project-root.json 戳记', /project-root\.json/.test(SYNC));
const mod = await import(pathToFileURL(path.join(PLUGIN, 'index.js')).href + '?v=' + Date.now());
ok('C3 源码目录下自动推导 projectRoot = 仓库根', typeof mod.resolveProjectRoot === 'function' && mod.resolveProjectRoot({}) === ROOT,
  typeof mod.resolveProjectRoot === 'function' ? mod.resolveProjectRoot({}) : 'not exported');
const installedStamp = path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'local-plugins', 'dsh-review-analysis', 'project-root.json');
ok('C4 本机已安装副本也有戳记（未跑 forms:sync 则未安装，跳过判绿）',
  !fs.existsSync(path.dirname(installedStamp)) || fs.existsSync(installedStamp), installedStamp);

console.log('[D] 宿主环境变量别名：同一把 key 不用起三个名字');
ok('D1 硅基流动 / DSH / 专家三组别名都在',
  S.ENV_ALIASES[S.ENV_API_KEY].join(',') === 'SILICONFLOW_API_KEY,DSH_LLM_API_KEY,REVIEW_LLM_API_KEY',
  JSON.stringify(S.ENV_ALIASES[S.ENV_API_KEY]));
S.setEnvReader((n) => (n === 'DSH_LLM_API_KEY' ? 'sk-dsh-alias-1234567890' : ''));
ok('D2 DSH_LLM_API_KEY 能被 mergeCfg 读到', S.mergeCfg(ROOT, {}).keySource === 'env', S.mergeCfg(ROOT, {}).keySource);
S.setEnvReader((n) => (n === 'REVIEW_LLM_API_KEY' ? 'sk-expert-alias-12345678' : ''));
ok('D3 REVIEW_LLM_API_KEY 也能被读到', S.mergeCfg(ROOT, {}).keySource === 'env');
S.setEnvReader(null);

console.log('[E] 真跑 Host 半边的端点（不是只 grep 源码）');
const routes = [];
const ctx = {
  get: () => undefined,
  effect: (fn) => { fn(); return () => {}; },
  tools: { register: () => () => {} },
  webServer: { register: (r) => { routes.push(r); return () => {}; } },
};
mod.apply(ctx, { projectRoot: ROOT });
function callRoute(route, method) {
  return new Promise((resolve) => {
    const req = { method, headers: { host: 'localhost' }, async *[Symbol.asyncIterator]() {} };
    const res = {
      statusCode: 0,
      setHeader() {},
      end(body) {
        let parsed = null;
        try { parsed = JSON.parse(String(body || '{}')); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, data: parsed, raw: String(body || '') });
      },
    };
    Promise.resolve(route.handler(req, res)).catch((e) => resolve({ status: -1, error: String(e.message || e) }));
  });
}
const settingsRoute = routes.find((r) => r.path === '/review-analysis/api/settings');
const modelsRoute = routes.find((r) => r.path === '/review-analysis/api/models');
ok('E1 Host 半边确实注册了 settings 路由', !!settingsRoute);
if (settingsRoute) {
  const r = await callRoute(settingsRoute, 'GET');
  ok('E2 GET settings 真返回配置（不是 404）', r.status === 200 && r.data && r.data.ok === true, JSON.stringify(r).slice(0, 160));
  ok('E3 回显不含密钥原文', r.raw.indexOf('sk-') === -1 || /sk-…/.test(r.raw), r.raw.slice(0, 100));
}
ok('E4 Host 半边确实注册了 models 路由', !!modelsRoute);
if (modelsRoute) {
  const r = await callRoute(modelsRoute, 'GET');
  ok('E5 GET models 真返回模型清单', r.status === 200 && r.data && r.data.ok === true && r.data.count > 0,
    (r.data && r.data.error) || ('status=' + r.status));
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
