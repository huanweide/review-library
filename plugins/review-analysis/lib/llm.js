'use strict';
// OpenAI-compatible 转发（Node 内置 http/https，零依赖）。
// 安全契约（对齐阶段零锚点 28/30）：
//  - apiKey 只在本模块函数栈内存在，绝不写文件、绝不 console.log、绝不进入错误文本；
//  - 任何返回给前端的错误都必须经 scrub() 抹掉密钥；
//  - 前端只请求同源 /api/llm/*，由本模块转发，所以浏览器 CSP 的 connect-src 'self' 不用放宽。
const http = require('http');
const https = require('https');
const { URL } = require('url');

function normalizeBase(base) {
  const s = String(base || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('请填写 API 地址');
  if (!/^https?:\/\//i.test(s)) throw new Error('API 地址必须以 http:// 或 https:// 开头');
  return s;
}

// 把任何可能含密钥的文本里的密钥替换掉，防止错误回显泄漏。
function scrub(text, cfg) {
  let s = String(text == null ? '' : text);
  const key = cfg && cfg.apiKey;
  if (key) s = s.split(key).join('***');
  // 兜底：把 sk- 开头的长串也抹掉（上游有时会在错误里回显 Authorization）
  s = s.replace(/sk-[A-Za-z0-9_\-]{12,}/g, '***');
  return s.slice(0, 600);
}

function request(cfg, suffix, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let base, u;
    try {
      base = normalizeBase(cfg && cfg.baseURL);
      u = new URL(base + suffix);
    } catch (e) { return reject(new Error(scrub(e.message, cfg))); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('只支持 http/https 地址'));
    const mod = u.protocol === 'https:' ? https : http;
    const body = payload == null ? null : JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    if (cfg && cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
    const req = mod.request(u, {
      method: body == null ? 'GET' : 'POST',
      headers: Object.assign(headers, body == null ? {} : { 'Content-Length': Buffer.byteLength(body) }),
      timeout: timeoutMs || 60000
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (data.length < 4 * 1024 * 1024) data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data.slice(0, 500) }; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detail = (parsed && (parsed.error && (parsed.error.message || parsed.error) || parsed.message)) || ('HTTP ' + res.statusCode);
          return reject(new Error(scrub('上游返回 ' + res.statusCode + '：' + detail, cfg)));
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时（60 秒）')));
    req.on('error', e => reject(new Error(scrub('连接失败：' + e.message, cfg))));
    if (body != null) req.write(body);
    req.end();
  });
}

// 测试连接：先试 /models（多数 OpenAI-compatible 都实现），不行再退最小 chat 请求。
async function testConnection(cfg) {
  if (!cfg || !cfg.baseURL) return { ok: false, error: '请填写 API 地址' };
  if (!cfg.model) return { ok: false, error: '请填写模型名' };
  let models = [];
  try {
    const r = await request(cfg, '/models', null, 15000);
    if (r && Array.isArray(r.data)) models = r.data.map(x => x && x.id).filter(Boolean).slice(0, 30);
  } catch (e) { /* 有些服务不开放 /models，退回 chat 探测 */ }
  try {
    await request(cfg, '/chat/completions', {
      model: cfg.model,
      messages: [{ role: 'user', content: '请只回复：OK' }],
      max_tokens: 8, temperature: 0
    }, 20000);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: scrub(e.message, cfg), models };
  }
}

// 对话补全：返回纯文本 content。cfg 只在内存里，不落盘。
async function chat(cfg, messages, opts) {
  const o = opts || {};
  if (!cfg || !cfg.baseURL) throw new Error('请填写 API 地址');
  if (!cfg.model) throw new Error('请填写模型名');
  const payload = {
    model: cfg.model,
    messages,
    temperature: typeof o.temperature === 'number' ? o.temperature : 0.3,
    max_tokens: o.maxTokens || 4096
  };
  try {
    const r = await request(cfg, '/chat/completions', payload, o.timeoutMs || 120000);
    const c = r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
    if (typeof c !== 'string' || !c.trim()) throw new Error('上游没有返回文本内容');
    return c;
  } catch (e) {
    throw new Error(scrub(e.message, cfg));
  }
}

// 1×1 红色 PNG（base64），用于探测模型是否支持图片输入，不依赖任何外部资源。
function tinyPngDataUrl() {
  // 最小合法 PNG：1x1, 8-bit RGB，解码为纯红 (255,0,0)。
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return 'data:image/png;base64,' + b64;
}

// 探测用户填的模型能否接收图片输入：发一张极小的红图，让它回答颜色。
// 能在超时内返回即视为支持看图；明确报 vision/image 不支持则视为不支持；其它错误（网络/密钥）视为探测失败。
async function probeVision(cfg, chatFn) {
  const fn = chatFn || chat;
  if (!cfg || !cfg.baseURL || !cfg.model) return { ok: false, supportsVision: false, error: '请先填写 API 地址与模型名' };
  const dataUrl = tinyPngDataUrl();
  try {
    await fn(cfg, [
      { role: 'system', content: '你是图片识别助手。' },
      { role: 'user', content: [
        { type: 'text', text: '这张图里是什么颜色？只回复两三个字。' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ] }
    ], { maxTokens: 16, temperature: 0, timeoutMs: 20000 });
    return { ok: true, supportsVision: true };
  } catch (e) {
    const msg = String((e && e.message) ? e.message : e).toLowerCase();
    const unsupported = /vision|image|multimodal|not support(ed)? (image|vision|multimodal)|does not support image|unsupported (image|media)|invalid.*(image|content)/.test(msg);
    if (unsupported) return { ok: true, supportsVision: false, error: scrub(e && e.message ? e.message : String(e), cfg) };
    return { ok: false, supportsVision: false, error: scrub(e && e.message ? e.message : String(e), cfg) };
  }
}

module.exports = { testConnection, chat, probeVision, normalizeBase, scrub };
