#!/usr/bin/env node
/**
 * 模型配置层判别测试（maxloop 纪律：baseline 必红 / candidate 必绿）。
 *
 *   node tools/check-settings.mjs
 *
 * 用户原话：「就用环境变量的硅基流动（可保存住，可找模型，可设置）保存了使用」。
 * 旧行为 baseline：三处对话框各要一次密钥、每次都粘、localStorage 只记得地址不记得 key、
 *   打开「考点大全」页签会静默发起一次 LLM 生成。四种都是真问题，逐条对着判。
 *
 * 七组验收：
 *   A 不泄漏：对外只有掩码，原文永不出现在 publicInfo 里
 *   B 优先级：入参 > 配置文件 > 环境变量（且能说清这次用的是哪一份）
 *   C 持久化：落 disk、留空不覆盖、clearKey 回落环境变量、只写白名单、无残留临时文件
 *   D 找模型：分类正确（embed/rerank 不能当对话模型）、无 key 不发请求
 *   E 接线：服务端真补 key、前端三处共用一套控件、页签探测不花钱
 *   F SW：llm-config.js 进缓存清单（否则改了前端用户看不到）
 *   G 降级：宿主没有配置接口时不许白屏/假装已配置
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const S = require(path.join(ROOT, 'core/settings.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + String(extra).slice(0, 220) : '')); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-check-'));
const KEY_FILE = 'sk-filekey0123456789abcdefWXYZ';
const KEY_ENV = 'sk-envkey9876543210zyxwvutsrq';
const KEY_INPUT = 'sk-inputkey5555555555INPUT9999';
const envMap = {};
S.setEnvReader((n) => envMap[n] || '');

console.log('[A] 对外只给掩码，原文不出现');
S.save(TMP, { apiKey: KEY_FILE, model: 'deepseek-ai/DeepSeek-V4.1-Flash' });
const info = S.publicInfo(TMP);
const infoJson = JSON.stringify(info);
ok('A1 publicInfo 不含密钥原文', !infoJson.includes(KEY_FILE), infoJson.slice(0, 160));
ok('A2 hasKey 为真且给出掩码', info.hasKey === true && /^sk-…/.test(info.keyHint), info.keyHint);
ok('A3 掩码比原文短很多（不是截断复制）', info.keyHint.length <= 12 && KEY_FILE.length > 20, info.keyHint);
ok('A4 说清来源（file=配置文件）', info.keySource === 'file', info.keySource);
ok('A5 内部 mergeCfg 才拿得到真 key', S.mergeCfg(TMP, {}).apiKey === KEY_FILE);

console.log('[B] 优先级：入参 > 配置文件 > 环境变量');
envMap.SILICONFLOW_API_KEY = KEY_ENV;
S.clearEnvCache();
ok('B1 配置文件赢环境变量', S.mergeCfg(TMP, {}).keySource === 'file', S.mergeCfg(TMP, {}).keySource);
ok('B2 入参赢配置文件', S.mergeCfg(TMP, { apiKey: KEY_INPUT }).apiKey === KEY_INPUT);
ok('B3 来源标注为 input', S.mergeCfg(TMP, { apiKey: KEY_INPUT }).keySource === 'input');
const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-env-'));
ok('B4 没有配置文件时用环境变量', S.mergeCfg(TMP2, {}).apiKey === KEY_ENV, S.mergeCfg(TMP2, {}).keySource);
ok('B5 来源标注为 env', S.mergeCfg(TMP2, {}).keySource === 'env');
envMap.SILICONFLOW_API_KEY = '';
S.clearEnvCache();
const noKey = S.mergeCfg(TMP2, {});
ok('B6 什么都没有时不抛错、hasKey=false', noKey.apiKey === undefined && S.publicInfo(TMP2).hasKey === false);
ok('B7 默认地址与默认模型仍可用（首屏不是空的）',
  noKey.baseURL === 'https://api.siliconflow.cn/v1' && !!noKey.model, noKey.baseURL + ' / ' + noKey.model);

console.log('[C] 持久化：落盘、留空不覆盖、clearKey、白名单');
const file = S.filePath(TMP);
ok('C1 落在 <root>/settings.json', file === path.join(TMP, 'settings.json'), file);
ok('C2 文件是合法 JSON', (() => { try { JSON.parse(fs.readFileSync(file, 'utf8')); return true; } catch (e) { return false; } })());
ok('C3 目录里没有残留 .tmp', fs.readdirSync(TMP).every((n) => !/\.tmp$/.test(n)), fs.readdirSync(TMP).join(','));
S.save(TMP, { apiKey: '' });
ok('C4 密钥传空串＝沿用，不会被清掉', S.mergeCfg(TMP, {}).apiKey === KEY_FILE, S.mergeCfg(TMP, {}).keySource);
S.save(TMP, { evil: 'x', __proto__: { polluted: 1 }, baseURL: 'https://api.siliconflow.cn/v1' });
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
ok('C5 只写白名单字段（evil 不落盘）', raw.evil === undefined, Object.keys(raw).join(','));
S.save(TMP, { clearKey: true });
ok('C6 clearKey 删掉文件里的密钥', JSON.parse(fs.readFileSync(file, 'utf8')).apiKey === undefined);
envMap.SILICONFLOW_API_KEY = KEY_ENV;
S.clearEnvCache();
ok('C7 clearKey 后自动回落到环境变量', S.mergeCfg(TMP, {}).keySource === 'env');
// 模拟重启：直接读文件（不经过进程内缓存）
fs.writeFileSync(file, JSON.stringify({ apiKey: KEY_FILE, model: 'm-x', baseURL: 'https://x.test/v1' }));
ok('C8 新进程读回磁盘配置', S.mergeCfg(TMP, {}).model === 'm-x' && S.mergeCfg(TMP, {}).baseURL === 'https://x.test/v1');
ok('C9 损坏的配置文件不会打死应用', (() => {
  fs.writeFileSync(file, '{ 这不是 JSON');
  const r = S.publicInfo(TMP);
  return r.ok === true && typeof r.baseURL === 'string';
})());
fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(TMP2, { recursive: true, force: true });

console.log('[D] 找模型：分类正确、无 key 不发请求');
ok('D1 embed 不算对话模型', S.classifyModel('BAAI/bge-m3') === 'other');
ok('D2 rerank 不算对话模型', S.classifyModel('BAAI/bge-reranker-v2-m3') === 'other');
ok('D3 纯对话模型算 chat', S.classifyModel('deepseek-ai/DeepSeek-V4.1-Flash') === 'chat');
ok('D4 VL 模型算 vision', S.classifyModel('Qwen/Qwen3-VL-32B-Instruct') === 'vision');
ok('D5 VL-Embedding 不能当视觉对话模型', S.classifyModel('Qwen/Qwen3-VL-Embedding-8B') === 'other');
const TMP3 = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-models-'));
envMap.SILICONFLOW_API_KEY = '';
S.clearEnvCache();
let called = 0;
const r0 = await S.listModels(TMP3, {}, { fetchModels: async () => { called++; return []; } });
ok('D6 没密钥时直接返回错误（不去打网络）', r0.ok === false && called === 0, 'called=' + called + ' err=' + r0.error);
envMap.SILICONFLOW_API_KEY = KEY_ENV;
S.clearEnvCache();
const fake = [
  { id: 'deepseek-ai/DeepSeek-V4.1-Flash' }, { id: 'BAAI/bge-m3' },
  { id: 'Qwen/Qwen3-VL-32B-Instruct' }, { id: 'deepseek-ai/DeepSeek-V4.1-Flash' },
];
const r1 = await S.listModels(TMP3, {}, { fetchModels: async (cfg) => {
  ok('D7 传下去的是补齐后的 cfg（有 key）', !!cfg.apiKey && cfg.keySource === 'env');
  return fake;
} });
ok('D8 去重（同一个 id 只出现一次）', r1.count === 3, 'count=' + r1.count);
ok('D9 分类计数正确', r1.chatCount === 1 && r1.visionCount === 1, JSON.stringify({ c: r1.chatCount, v: r1.visionCount }));
ok('D10 对话模型排在最前面（前端下拉第一项就能用）', r1.models[0].kind === 'chat', r1.models[0].id);
const r2 = await S.listModels(TMP3, {}, { fetchModels: async () => { throw new Error('上游返回 401：sk-leak-test-000000000000'); } });
ok('D11 上游报错时回错误但不吞掉原因', r2.ok === false && /401/.test(r2.error), r2.error);
fs.rmSync(TMP3, { recursive: true, force: true });
S.setEnvReader(null);

console.log('[E] 接线：服务端真补 key、前端三处共用、页签探测不花钱');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const BS = fs.readFileSync(path.join(ROOT, 'workbench/src/bookspace.js'), 'utf8');
const VW = fs.readFileSync(path.join(ROOT, 'workbench/src/views.js'), 'utf8');
const LC = fs.readFileSync(path.join(ROOT, 'workbench/src/llm-config.js'), 'utf8');
const HOSTJS = fs.readFileSync(path.join(ROOT, 'workbench/src/host.js'), 'utf8');
const AH = fs.readFileSync(path.join(ROOT, 'core/app-host.js'), 'utf8');
const RQ = fs.readFileSync(path.join(ROOT, 'core/request.js'), 'utf8');

ok('E1 服务端有 /api/settings', /parts\[1\] === 'settings'/.test(SERVER));
ok('E2 服务端有 /api/models', /parts\[1\] === 'models'/.test(SERVER));
ok('E3 action 入口用 mergeCfg 补 key（前端可以不给）', /appHost\.invoke\(core, m\.action, patched/.test(SERVER) && /mergeCfg\(ROOT/.test(SERVER));
ok('E4 分析成功后记住配置（粘一次就够）', /settings\.remember\(ROOT/.test(SERVER));
ok('E5 老 core 协议入口也补 key', /needsCfg/.test(SERVER) && /body\.cfg = settings\.mergeCfg/.test(SERVER));
ok('E6 前端有独立配置模块（三处共用，不各写一份表单）', /export function credentialFields/.test(LC) && /export function credentialDialog/.test(LC));
ok('E7 分析对话框改用共用控件', /credentialFields\(s\)/.test(BS));
ok('E8 生成考点大全不再每次要 key（已配置直接跑）', /await readiness\(\)/.test(BS) && !/地址、模型、密钥都要填/.test(BS),
  '仍存在旧文案或没走 readiness');
ok('E9 前端不再把 key 写进 localStorage', !/localStorage\.setItem\('wb-llm'/.test(BS) && !/localStorage\.setItem\('wb-llm'/.test(VW));
ok('E10 设置页有模型与密钥卡片', /模型与密钥/.test(VW) && /mountLlmSettings/.test(VW));
ok('E11 页签探测只查缓存（cachedOnly）', /cachedOnly: true/.test(BS));
ok('E12 app-host 透传 cachedOnly', /cachedOnly: !!p\.cachedOnly/.test(AH));
ok('E13 request 层透传 cachedOnly', /cachedOnly: !!b\.cachedOnly/.test(RQ));
ok('E14 只读缓存时绝不触发生成', /if \(o\.cachedOnly\) return null;/.test(fs.readFileSync(path.join(ROOT, 'core/index.js'), 'utf8')));
ok('E15 host 有 settings/models 传输方法', /async settings\(patch\)/.test(HOSTJS) && /async models\(override\)/.test(HOSTJS));

console.log('[F] Service Worker：新模块必须进清单，否则用户看不到改动');
const SW = fs.readFileSync(path.join(ROOT, 'workbench/sw.js'), 'utf8');
ok('F1 llm-config.js 在缓存清单里', /\.\/src\/llm-config\.js/.test(SW));
ok('F2 缓存版本已升到 v27', /tiandao-workbench-v27/.test(SW), (SW.match(/tiandao-workbench-v\d+/) || [''])[0]);

console.log('[G] 降级：宿主没有配置接口时不许假装已配置');
ok('G1 Electron 形态返回 unsupported 而不是抛错', /unsupported: true/.test(HOSTJS));
ok('G2 设置页对 unsupported 有明确文案', /没有配置存储/.test(VW));
ok('G3 readiness 只认「有 key 且有 model」才算就绪', /ready: !!s\.model/.test(LC));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
