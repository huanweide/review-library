'use strict';
// 统一核心 · 文本抽取（纯 Node、零额外硬依赖）。
//
// 支持：
//   .md / .txt / .csv / .text  —— 直读
//   .docx / .xlsx / .pptx      —— 复用 lib/insight 的 unzip + xmlText（零依赖已验证）
//   .pdf                       —— pdf-parse（已装 1.1.1）；失败回退原生流抽取
//   .png/.jpg/... 图片         —— 不抽文本，返回 null，由调用方按 isImage 交给多模态 LLM
//
// extractText(ext, buf) 返回 Promise<string|null>；null = 抽不出（图片/未知/损坏）。
const insight = require('../lib/insight');

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff'];
function isImageExt(ext) { return IMAGE_EXT.includes((ext || '').toLowerCase()); }

async function extractText(ext, buf) {
  const e = (ext || '').toLowerCase();
  if (!Buffer.isBuffer(buf) || !buf.length) return '';
  if (['.txt', '.md', '.csv', '.text'].includes(e)) return buf.toString('utf8');
  if (['.docx', '.xlsx', '.pptx'].includes(e)) {
    try { return insight.extractText(e, buf) || ''; } catch (e2) { return ''; }
  }
  if (e === '.pdf') return extractPdf(buf);
  return null; // 图片 / 其它未知格式
}

let _pdfParse = null;
async function extractPdf(buf) {
  try {
    _pdfParse = _pdfParse || require('pdf-parse');
    const r = await _pdfParse(buf);
    if (r && typeof r.text === 'string' && r.text.trim()) return r.text;
    return nativePdfText(buf);
  } catch (e) {
    return nativePdfText(buf);
  }
}

// 兜底：抓内容流里的 Tj/TJ 文本。对未压缩或简单流有效，压缩/加密 PDF 抽不出（返回 ''）。
function nativePdfText(buf) {
  const s = buf.toString('latin1');
  const out = [];
  const reTj = /\((?:[^()\\]|\\.)*\)\s*Tj/g;
  let m;
  while ((m = reTj.exec(s))) {
    out.push(m[0].slice(1, m[0].indexOf(')')).replace(/\\([nrt()\\])/g, '$1'));
  }
  return out.join('\n');
}

module.exports = { extractText, isImageExt, IMAGE_EXT, nativePdfText };
