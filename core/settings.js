'use strict';
// 模型配置与密钥的单一权威位置（2026-11-21）。
//
// 用户原话：「就用环境变量的硅基流动（可保存住，可找模型，可设置）保存了使用」。
// 之前每次分析、每次生成考点大全都要重新粘一遍密钥——那不是在用工具，是在喂工具。
//
// 判据（按重要性排序，动手前先读一遍）：
//   1) 密钥只有一处权威位置：服务端。前端从此不持有密钥，也不再要求用户每次输入。
//   2) 回显永不完整：对外只给 sk-…后四位 + 来源（配置文件 / 环境变量）。
//   3) 优先级 = 本次请求显式传的 > 配置文件 > 环境变量。
//      - 显式传的赢：用户当场换一个 key 是更强意图；
//      - 配置文件赢环境变量：那份是用户手填的最近动作，环境变量是「默认值」。
//   4) 落盘位置 library/settings.json —— library/ 已在 .gitignore，绝不入库；
//      写入用临时文件 + rename（半个文件比没文件更糟），尽力设 0600。
//   5) 环境变量读不到就退到 Windows 用户级注册表：从资源管理器/快捷方式启动的进程
//      才有用户环境变量，从某些 shell 拉起的 node 读不到 process.env。这条兜底让
//      「用环境变量的硅基流动」在任何启动方式下都成立。
//
// 本模块不实现任何 LLM 调用，只负责「配置从哪来、存哪去、怎么不泄漏」。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 硅基流动是默认家：地址写死在这里而不是散落在前端三处对话框。
// 默认对话模型取 DeepSeek-V4.1-Flash：2026-11-21 用账号的模型清单实测存在（92 个模型里含它），
// 也是这套分析一直在用的那档。视觉模型不设默认——多一次看图就多一份钱，让用户自己勾。
const DEFAULTS = {
  baseURL: 'https://api.siliconflow.cn/v1',
  model: 'deepseek-ai/DeepSeek-V4.1-Flash',
  visionModel: '',
  deepDive: false,
};
const ENV_API_KEY = 'SILICONFLOW_API_KEY';
const ENV_BASE = 'SILICONFLOW_BASE_URL';
const ENV_MODEL = 'SILICONFLOW_MODEL';
// 同一份配置要被硅基流动主程序、DSH 宿主、WorkBuddy 专家共用；
// 后两组是各宿主既有的环境变量名，按优先级回落，别逼用户为同一个 key 起三个名字。
const ENV_ALIASES = {
  [ENV_API_KEY]: ['SILICONFLOW_API_KEY', 'DSH_LLM_API_KEY', 'REVIEW_LLM_API_KEY'],
  [ENV_BASE]: ['SILICONFLOW_BASE_URL', 'DSH_LLM_BASE_URL', 'REVIEW_LLM_BASE_URL'],
  [ENV_MODEL]: ['SILICONFLOW_MODEL', 'DSH_LLM_MODEL', 'REVIEW_LLM_MODEL'],
};
const SETTINGS_FILE = 'settings.json';

function rootOf(root) {
  return root || path.join(__dirname, '..', 'library');
}
function filePath(root) {
  return path.join(rootOf(root), SETTINGS_FILE);
}

/* ---------------- 环境变量（含 Windows 注册表兜底） ---------------- */

const envCache = new Map(); // name -> { at, val }
let envReader = null; // 仅测试注入：让「有无环境变量」这种外部状态可确定

/** 测试钩子：注入环境变量读取器（传 null 恢复真实读取）。 */
function setEnvReader(fn) {
  envReader = typeof fn === 'function' ? fn : null;
  envCache.clear();
}
function clearEnvCache() { envCache.clear(); }

function readWindowsUserEnv(name) {
  if (process.platform !== 'win32') return '';
  const read = (hive) => {
    try {
      const out = execFileSync('reg', ['query', hive + '\\Environment', '/v', name], {
        timeout: 3000, windowsHide: true, encoding: 'utf8',
        // 值不存在时 reg.exe 会往 stderr 吐一段 GBK 中文，刷满宿主日志且毫无信息量。
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const m = out.match(new RegExp('^\\s{4}' + name + '\\s+REG_\\w+\\s+(.*)$', 'm'));
      return m ? m[1].trim() : '';
    } catch (e) { return ''; }
  };
  return read('HKCU') || read('HKLM');
}

function envGet(name) {
  if (envReader) {
    // 注入的读取器接收的是真实环境变量名（含别名），不是规范化后的 name，
    // 否则「DSH_LLM_API_KEY 能不能被读到」这类判别会假红。
    for (const alias of (ENV_ALIASES[name] || [name])) {
      const v = envReader(alias);
      if (String(v == null ? '' : v).trim()) return String(v).trim();
    }
    return '';
  }
  const now = Date.now();
  const hit = envCache.get(name);
  if (hit && now - hit.at < 60000) return hit.val;
  let val = '';
  for (const alias of (ENV_ALIASES[name] || [name])) {
    val = String(process.env[alias] || '').trim();
    if (!val) val = readWindowsUserEnv(alias);
    if (val) break;
  }
  envCache.set(name, { at: now, val });
  return val;
}

/* ---------------- 读写 ---------------- */

function cleanBaseURL(v) {
  let s = String(v == null ? '' : v).trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) throw new Error('API 地址必须以 http:// 或 https:// 开头');
  return s;
}

function readRaw(root) {
  try {
    const txt = fs.readFileSync(filePath(root), 'utf8').replace(/^\uFEFF/, '');
    const obj = JSON.parse(txt);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {}; // 文件不存在 / 损坏都当作「还没配过」，不让一份坏配置打死整个应用
  }
}

function writeRaw(root, obj) {
  const dir = rootOf(root);
  const file = filePath(root);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 已存在 */ }
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  try { fs.chmodSync(tmp, 0o600); } catch (e) { /* Windows 上无意义，不阻断 */ }
  fs.renameSync(tmp, file);
  return file;
}

/* ---------------- 对外：只给掩码 ---------------- */

function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  if (k.length <= 8) return '…' + k.slice(-2);
  return k.slice(0, 3) + '…' + k.slice(-4);
}

/**
 * 合并出这次真正要用的 cfg。
 * 返回里带 keySource，好让界面说清「现在用的是哪一份密钥」。
 */
function mergeCfg(root, input) {
  const i = input && typeof input === 'object' ? input : {};
  const stored = readRaw(root);
  const envKey = envGet(ENV_API_KEY);
  const envBase = envGet(ENV_BASE);
  const envModel = envGet(ENV_MODEL);

  const baseURL = cleanBaseURL(i.baseURL) || cleanBaseURL(stored.baseURL) || cleanBaseURL(envBase) || DEFAULTS.baseURL;
  const model = String(i.model || stored.model || envModel || DEFAULTS.model).trim();
  const visionModel = String(i.visionModel || stored.visionModel || '').trim();
  const inputKey = String(i.apiKey || '').trim();
  const fileKey = String(stored.apiKey || '').trim();

  let apiKey = '';
  let keySource = 'none';
  if (inputKey) { apiKey = inputKey; keySource = 'input'; }
  else if (fileKey) { apiKey = fileKey; keySource = 'file'; }
  else if (envKey) { apiKey = envKey; keySource = 'env'; }

  return {
    baseURL,
    model,
    visionModel: visionModel || undefined,
    apiKey: apiKey || undefined,
    keySource,
    deepDive: typeof i.deepDive === 'boolean' ? i.deepDive : !!stored.deepDive,
  };
}

/** 给前端看的配置：永远不含完整密钥。 */
function publicInfo(root) {
  const stored = readRaw(root);
  const envKey = envGet(ENV_API_KEY);
  const fileKey = String(stored.apiKey || '').trim();
  const cfg = mergeCfg(root, {});
  return {
    ok: true,
    baseURL: cfg.baseURL,
    model: cfg.model,
    visionModel: cfg.visionModel || '',
    deepDive: !!stored.deepDive,
    hasKey: !!cfg.apiKey,
    keySource: cfg.keySource,
    keyHint: maskKey(cfg.apiKey),
    envAvailable: !!envKey,
    savedKey: !!fileKey,
    defaultBaseURL: DEFAULTS.baseURL,
    file: 'library/' + SETTINGS_FILE,
    updatedAt: String(stored.updatedAt || ''),
  };
}

/**
 * 保存配置。规则：
 *  - 字段没传 = 不动；空串 = 不动（输入框留空表示「沿用」，不是「删掉」）；
 *  - apiKey: '__clear__' 或 clearKey:true = 删除已存密钥（回到环境变量）；
 *  - 只认白名单字段，前端多传什么都不会被写进文件。
 */
function save(root, patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = readRaw(root);

  if (p.baseURL != null) {
    const b = cleanBaseURL(p.baseURL);
    if (b) next.baseURL = b;
  }
  if (p.model != null && String(p.model).trim()) next.model = String(p.model).trim();
  if (p.visionModel != null) next.visionModel = String(p.visionModel).trim(); // 显式清空视觉模型是合法操作
  if (typeof p.deepDive === 'boolean') next.deepDive = p.deepDive;

  const k = p.apiKey == null ? '' : String(p.apiKey).trim();
  if (p.clearKey === true || k === '__clear__') delete next.apiKey;
  else if (k) next.apiKey = k;

  next.updatedAt = new Date().toISOString();
  writeRaw(root, next);
  return publicInfo(root);
}

/**
 * 一次成功的调用之后「顺手记住」。只写这次显式传进来的字段，
 * 所以「用户在对话框里粘了一次 key」= 以后不用再粘；
 * 而「环境变量提供的 key」不会被抄一份到磁盘上（那样反而多一个泄漏点）。
 */
function remember(root, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const patch = {};
  if (r.baseURL) patch.baseURL = r.baseURL;
  if (r.model) patch.model = r.model;
  if (r.visionModel) patch.visionModel = r.visionModel;
  if (typeof r.deepDive === 'boolean') patch.deepDive = r.deepDive;
  const k = String(r.apiKey || '').trim();
  if (k && k !== '__clear__') patch.apiKey = k;
  if (!Object.keys(patch).length) return publicInfo(root);
  try { return save(root, patch); } catch (e) { return publicInfo(root); }
}

/* ---------------- 找模型 ---------------- */

// 能不能聊天 / 能不能看图：只按名字粗分，选错了用户还能手输模型名，不设门槛。
const NON_CHAT = /(embed|rerank|bge-|gte-|tts|whisper|speech|audio|asr|sensevoice|moderation|stable-diffusion|kolors|flux|sd-|image|ocr|guard)/i;
const VISION = /(-vl|vl-|vision|llava|internvl|glm-4[.\d]*-?v|gpt-4o|pixtral|gemini|qwen\d*[.\d]*-vl)/i;

function classifyModel(id) {
  const s = String(id || '');
  // 先判「不是对话模型」：Qwen3-VL-Embedding / -Reranker 名字里带 VL，但它不能聊天，
  // 按 VISION 先匹配会把它们塞进视觉下拉，用户选完必然报错。
  if (NON_CHAT.test(s)) return 'other';
  if (VISION.test(s)) return 'vision';
  return 'chat';
}

let defaultFetchModels = null;
function fetchModelsViaLlm(cfg, opts) {
  if (!defaultFetchModels) {
    // 延迟 require：settings 只做配置，不想在加载顺序上跟 llm 互相绑死
    defaultFetchModels = require('../lib/llm').fetchModels;
  }
  return defaultFetchModels(cfg, opts);
}

/**
 * 拉模型清单。deps.fetchModels 可注入（测试不联网）。
 * 返回全部模型并标注 kind，前端按 kind 分两个下拉（对话 / 视觉），不在这里替用户决定。
 */
async function listModels(root, override, deps) {
  const cfg = mergeCfg(root, override || {});
  if (!cfg.apiKey) return { ok: false, error: '还没有密钥，先填一个（或用环境变量 SILICONFLOW_API_KEY）', models: [] };
  const fetchModels = (deps && deps.fetchModels) || fetchModelsViaLlm;
  try {
    const raw = await fetchModels(cfg, { timeoutMs: 15000 });
    const seen = new Set();
    const models = [];
    (Array.isArray(raw) ? raw : []).forEach((m) => {
      const id = String((m && m.id) || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      models.push({ id, kind: classifyModel(id), ownedBy: String((m && m.ownedBy) || '') });
    });
    const order = { chat: 0, vision: 1, other: 2 };
    models.sort((a, b) => (order[a.kind] - order[b.kind]) || a.id.localeCompare(b.id));
    return {
      ok: true,
      count: models.length,
      models,
      chatCount: models.filter((m) => m.kind === 'chat').length,
      visionCount: models.filter((m) => m.kind === 'vision').length,
      baseURL: cfg.baseURL,
      keySource: cfg.keySource,
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { ok: false, error: msg.slice(0, 300), models: [] };
  }
}

module.exports = {
  DEFAULTS, ENV_API_KEY, ENV_ALIASES, SETTINGS_FILE, filePath, publicInfo, save, remember,
  mergeCfg, listModels, classifyModel, maskKey, envGet, setEnvReader, clearEnvCache,
};
