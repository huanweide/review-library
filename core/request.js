'use strict';
// 统一核心 · HTTP-like 请求分派（canonical）。
//
// server.js 的 /api/core/* 与 Electron 主进程的 core:request 都调这里，
// 保证「所有形态只是入口」——路由语义只存在一份，杜绝各形态各写一份映射导致漂移。
// DSH 插件 / 专家形态直接用 Core 类方法，不经此层（它们不是 HTTP 入口）。
//
// 入参 path 形如 '/books'、'/books/<id>/files'；返回 { status, data }，不抛到宿主。
//
// 安全边界（2026-11-09 独立复核修复）：本层的 path/id 可能来自低权限渲染进程
// （Electron IPC 没有 HTTP 的 URL 规范化），因此进入任何 Core 方法前必须校验，
// 绝不能让 '..' 之类的 id 流到 bookStore 的 fs.rmSync(recursive)。
const { scrub } = require('../lib/llm');
const { assertSafeId } = require('./bookStore');

const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

// 内部异常 = Node 系统/IO 错误（带 code/syscall/errno）或数据损坏（SyntaxError）。
// 其余一律视为业务错误（参数、模型配置、模型输出格式），这类保持 400 以维持前端契约。
function isInternal(e) {
  if (!e || typeof e !== 'object') return true;
  if (e.code || e.syscall || e.errno) return true;
  if (e instanceof SyntaxError) return true;
  return false;
}

async function dispatch(core, path, method, body) {
  const m = String(method || 'GET').toUpperCase();
  const b = body && typeof body === 'object' ? body : {};
  if (!METHODS.has(m)) return { status: 405, data: { error: '不支持的请求方法：' + m } };
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts[0] !== 'books') return { status: 404, data: { error: 'unknown core route' } };
  try {
    // 入口白名单：id 与 fileId 都只能是可安全拼路径的短标识。
    // 注意 parts.length===1 时没有 id，不能校验；只在真正会用到 id 的分支前校验。
    if (parts.length >= 2) assertSafeId(parts[1], '书 id');
    if (parts.length >= 4 && parts[2] === 'files') assertSafeId(parts[3], '文件 id');

    if (parts.length === 1) {
      if (m === 'GET') return { status: 200, data: { books: core.listBooks() } };
      if (m === 'POST') return { status: 200, data: core.createBook(b.title, { description: b.description }) };
    }
    const id = parts[1];
    if (parts.length === 2) {
      if (m === 'GET') {
        const book = core.getBook(id);
        return book ? { status: 200, data: book } : { status: 404, data: { error: '书不存在' } };
      }
      if (m === 'DELETE') return { status: 200, data: { ok: core.deleteBook(id) } };
    }
    if (parts[2] === 'files' && parts.length === 3 && m === 'POST') {
      if (!b.name || typeof b.data !== 'string') return { status: 400, data: { error: '需要 name 与 data(base64)' } };
      const rec = await core.addFile(id, Buffer.from(b.data, 'base64'), { name: b.name, note: b.note });
      return { status: 200, data: rec };
    }
    if (parts[2] === 'files' && parts.length === 4 && m === 'DELETE') {
      return { status: 200, data: { ok: core.removeFile(id, parts[3]) } };
    }
    // v2：图书原图回读。题目详情里的「原图」经此路由拿到原始字节（base64），
    // 只回读 Core 书库内已登记的文件，不接受任意路径；fileId 已由上方 assertSafeId 校验。
    if (parts[2] === 'files' && parts.length === 5 && parts[4] === 'raw' && m === 'GET') {
      const book = core.getBook(id);
      const rec = book && (book.files || []).find(f => f.id === parts[3]);
      if (!rec) return { status: 404, data: { error: '文件不存在' } };
      const buf = core.getFileBuffer(id, parts[3]);
      if (!buf) return { status: 404, data: { error: '文件字节不可读' } };
      const ext = String(rec.ext || '').toLowerCase();
      const mime = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.tif': 'image/tiff', '.tiff': 'image/tiff', '.pdf': 'application/pdf'
      }[ext] || 'application/octet-stream';
      return { status: 200, data: { name: rec.name, mime, isImage: !!rec.isImage, data: buf.toString('base64') } };
    }
    if (parts[2] === 'analyze' && parts.length === 3 && m === 'POST') {
      const r = await core.analyze(id, { cfg: b.cfg || {}, maxTokens: b.maxTokens, timeoutMs: b.timeoutMs });
      return { status: 200, data: r };
    }
    if (parts[2] === 'analysis' && parts.length === 3 && m === 'GET') {
      const a = core.getAnalysis(id);
      return a ? { status: 200, data: a } : { status: 404, data: { error: '尚未分析' } };
    }
    return { status: 404, data: { error: 'unknown core route' } };
  } catch (e) {
    // 错误文本统一经 scrub（抹掉 apiKey 与 sk- 前缀）。cfg 只在这里用于脱敏，不进日志。
    const msg = scrub(String((e && e.message) || e), b.cfg);
    if (isInternal(e)) {
      // 内部异常必须有可观测性：server.js 的外层 DEBUG 日志拿不到本层异常，故在此记录。
      console.error('[core request] 内部异常：' + msg);
      return { status: 500, data: { error: '服务内部错误（详情见服务端日志）' } };
    }
    // 业务错误：用户可修正（参数 / 模型配置 / 模型输出），保持 400，不写噪声日志。
    return { status: 400, data: { error: msg } };
  }
}

module.exports = { dispatch };
