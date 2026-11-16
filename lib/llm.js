/**
 * llm.js —— 天道书院 · OpenAI-compatible 转发（Node 内置 http/https，零依赖）
 *
 * 安全契约（对齐书馆 lib/llm.js 已验证的口径，但不跨项目 require，避免路径硬耦合）：
 *  - apiKey 只在本模块函数栈内存在，绝不写文件、绝不输出、绝不进入错误文本；
 *  - 任何返回给调用方的错误都经 scrub() 抹掉密钥；
 *  - 密钥由前端每次请求带上，服务端用完即弃，不落盘、不进 data.json、不进日志。
 */
'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');

function normalizeBase(base) {
  const s = String(base || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('请填写 API 地址');
  if (!/^https?:\/\//i.test(s)) throw new Error('API 地址必须以 http:// 或 https:// 开头');
  return s;
}
function scrub(text, cfg) {
  let s = String(text == null ? '' : text);
  const key = cfg && cfg.apiKey;
  if (key) s = s.split(key).join('***');
  s = s.replace(/sk-[A-Za-z0-9_\-]{12,}/g, '***');
  return s.slice(0, 600);
}
function request(cfg, suffix, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(normalizeBase(cfg && cfg.baseURL) + suffix); }
    catch (e) { return reject(new Error(scrub(e.message, cfg))); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('只支持 http/https 地址'));
    const mod = u.protocol === 'https:' ? https : http;
    const body = payload == null ? null : JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    if (cfg && cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
    const req = mod.request(u, {
      method: body == null ? 'GET' : 'POST',
      headers: Object.assign(headers, body == null ? {} : { 'Content-Length': Buffer.byteLength(body) }),
      timeout: timeoutMs || 120000
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (data.length < 8 * 1024 * 1024) data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data.slice(0, 600) }; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detail = (parsed && (parsed.error && (parsed.error.message || parsed.error) || parsed.message)) || ('HTTP ' + res.statusCode);
          return reject(new Error(scrub('上游返回 ' + res.statusCode + '：' + detail, cfg)));
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', e => reject(new Error(scrub('连接失败：' + e.message, cfg))));
    if (body != null) req.write(body);
    req.end();
  });
}
async function testConnection(cfg) {
  if (!cfg || !cfg.baseURL) return { ok: false, error: '请填写 API 地址' };
  if (!cfg.model) return { ok: false, error: '请填写模型名' };
  let models = [];
  try {
    const r = await request(cfg, '/models', null, 15000);
    if (r && Array.isArray(r.data)) models = r.data.map(x => x && x.id).filter(Boolean).slice(0, 30);
  } catch (e) { /* 有些服务不开放 /models，退回最小 chat 探测 */ }
  try {
    await request(cfg, '/chat/completions', {
      model: cfg.model, messages: [{ role: 'user', content: '请只回复：OK' }],
      max_tokens: 8, temperature: 0
    }, 20000);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: scrub(e.message, cfg), models };
  }
}
// chat：返回 content 文本。返回 { text, usage }。cfg 只在内存里，绝不落盘。
async function chat(cfg, messages, opts) {
  const o = opts || {};
  if (!cfg || !cfg.baseURL) throw new Error('请填写 API 地址');
  if (!cfg.model) throw new Error('请填写模型名');
  const payload = {
    model: cfg.model,
    messages,
    temperature: o.temperature == null ? 0.2 : o.temperature,
    max_tokens: o.maxTokens || 8192
  };
  // response_format：兼容只支持 json_object 与不支持的服务，失败会由调用方兜底重试
  if (o.json) payload.response_format = { type: 'json_object' };
  const r = await request(cfg, '/chat/completions', payload, o.timeoutMs || 180000);
  const choice = r && Array.isArray(r.choices) ? r.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : '';
  return { text: Array.isArray(content) ? content.map(x => x.text || '').join('') : String(content || ''), usage: r && r.usage };
}
module.exports = { testConnection, chat, normalizeBase, scrub };
