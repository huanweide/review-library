'use strict';
// 统一核心 · 文本抽取（纯 Node、零额外硬依赖）。
//
// 支持：
//   .md / .txt / .csv / .text  —— 直读
//   .docx / .xlsx / .pptx      —— 复用 lib/insight 的 unzip + xmlText（零依赖已验证）
//   .pdf                       —— pdf-parse（已装 1.1.1）；失败回退原生流抽取
//   .png/.jpg/... 图片         —— 不抽文本，返回 null，由调用方按 isImage 交给多模态 LLM
//
// v3（2026-11-10）· 抽取即打可回溯锚点：
//   PDF 逐页注入 [[PAGE:N]]（真页码，来自 pdf-parse 的 pagerender / pageNumber）；
//   segmentText() 把文本切成 [{ anchor: '【P.3】' | '【块2】', page, text }]，
//   供 composeCorpus 按结构均衡覆盖、verifyQuotes 从原文校验引文。
//   锚点是「语料坐标」，不是模型自报的页码。老缓存没有 [[PAGE:N]] 时按块切，
//   不重抽、不改落盘格式 —— 零数据迁移。
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

// 逐页渲染器：在每页文本前打真实页码标记。
// 签名核实（逐字符锚点）：node_modules/pdf-parse/lib/pdf-parse.js:3-30 默认 render_page、
// :58 允许 options.pagerender 覆盖、:86-93 顺序 await 调用并把各页文本用 \n\n 拼接。
// pageData 为 PDFPageProxy，带 1-based pageNumber；拿不到时用闭包计数兜底。
function pageRenderer(counter) {
  return function (pageData) {
    const n = Number(pageData && pageData.pageNumber) || (counter.n + 1);
    if (n > counter.n) counter.n = n;
    return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
      .then(tc => {
        let lastY, text = '';
        for (const item of tc.items) {
          if (lastY == null || lastY === item.transform[5]) text += item.str;
          else text += '\n' + item.str;
          lastY = item.transform[5];
        }
        return '\n[[PAGE:' + n + ']]\n' + text;
      });
  };
}

let _pdfParse = null;
async function extractPdf(buf) {
  try {
    _pdfParse = _pdfParse || require('pdf-parse');
    const counter = { n: 0 };
    let r;
    try {
      r = await _pdfParse(buf, { pagerender: pageRenderer(counter) });
    } catch (e2) {
      // 兼容降级：某些 PDF / pdfjs 版本不支持自定义 pagerender，退回原默认解析。
      // 此时没有页码锚点，segmentText 会按块切，功能不丢，只是页码精度降级。
      r = await _pdfParse(buf);
    }
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

// ---------- v3：可回溯锚点 ----------
const PAGE_MARK = /\[\[PAGE:(\d+)\]\]/g;
const BLOCK_CHARS = 1600;

function splitOversize(blocks) {
  const out = [];
  blocks.forEach(b => {
    if (b.text.length <= BLOCK_CHARS) { out.push(b); return; }
    let n = 1;
    for (let i = 0; i < b.text.length; i += BLOCK_CHARS) {
      out.push({
        anchor: b.anchor.replace(/】$/, '') + '-' + n + '】',
        page: b.page,
        text: b.text.slice(i, i + BLOCK_CHARS)
      });
      n++;
    }
  });
  return out;
}

// segmentText(text, meta) -> [{ anchor, page, text }]
// PDF 且带 [[PAGE:N]] → 按真页码切（anchor = 【P.N】）；其余按空行分段切（anchor = 【块N】）。
// 超长块再按 BLOCK_CHARS 二次切，保证 composeCorpus 有粒度做均衡覆盖。
function segmentText(text, meta) {
  const s = String(text || '');
  if (!s.trim()) return [];
  const ext = String((meta && meta.ext) || '').toLowerCase();
  const marks = [];
  PAGE_MARK.lastIndex = 0;
  let m;
  while ((m = PAGE_MARK.exec(s))) marks.push({ index: m.index, len: m[0].length, page: Number(m[1]) });
  if (ext === '.pdf' && marks.length) {
    const out = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].index + marks[i].len;
      const end = i + 1 < marks.length ? marks[i + 1].index : s.length;
      const body = s.slice(start, end).trim();
      if (body) out.push({ anchor: '【P.' + marks[i].page + '】', page: marks[i].page, text: body });
    }
    return splitOversize(out);
  }
  const paras = s.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  const base = paras.length ? paras : [s.trim()];
  return splitOversize(base.map((p, i) => ({ anchor: '【块' + (i + 1) + '】', page: 0, text: p })));
}

module.exports = { extractText, isImageExt, IMAGE_EXT, nativePdfText, segmentText, BLOCK_CHARS };
