'use strict';
// 统一预览渲染：把「文件 base64」变成可安全插入 DOM 的描述对象。
// 安全三层：① 解析库产出的 HTML 一律经 DOMPurify 清洗；② 内容放进 sandbox="" 的 iframe srcdoc，禁脚本执行；
//           ③ 顶层 CSP connect-src 'self' 禁止任何外部网络请求（见 index.html）。
// 性能：>8MB 的 docx/xlsx 解包放 Worker，避免主线程卡死（阶段零锚点：解包 50MB docx 主线程明显卡顿）。
(function () {
  const IMG = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
  const BIG = 8 * 1024 * 1024;

  function b64ToU8(b64) {
    const bin = atob(b64 || '');
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function clean(html) {
    // DOMPurify 缺失时退化为纯文本展示，绝不把未清洗的 HTML 送进 DOM。
    if (!window.DOMPurify) return '<pre>' + esc(String(html).replace(/<[^>]*>/g, '')) + '</pre>';
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }
  function shell(title, body) {
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<style>body{font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1c2430;margin:0;padding:24px 28px;background:#fff}' +
      'h1,h2,h3{line-height:1.3;margin:1.1em 0 .5em}table{border-collapse:collapse;width:100%;margin:10px 0}' +
      'td,th{border:1px solid #cbd5e1;padding:6px 9px;text-align:left}img{max-width:100%;height:auto}' +
      '.pv-imgs{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0 18px}.pv-img{max-width:260px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;padding:4px}' +
      'pre{white-space:pre-wrap;word-break:break-word;background:#f6f8fa;padding:14px;border-radius:8px}' +
      '.pv-h{font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-bottom:16px}' +
      '</style></head><body>' +
      '<div class="pv-h">' + esc(title) + ' · 本地解析预览（版式可能与原件不同）</div>' + body + '</body></html>';
  }
  function srcdoc(title, html) { return { kind: 'srcdoc', html: shell(title, clean(html)) }; }

  // ---- 主线程解析（小文件） ----
  async function parseDocx(u8) {
    if (!window.mammoth) return null;
    try {
      const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      const r = await mammoth.convertToHtml({ arrayBuffer: ab });
      return r.value;
    } catch (e) { return null; }
  }
  function parseSheet(u8) {
    if (!window.XLSX) return null;
    try {
      const wb = XLSX.read(u8, { type: 'array', cellStyles: false });
      let html = '';
      wb.SheetNames.forEach(n => {
        const full = XLSX.utils.sheet_to_html(wb.Sheets[n]);
        const table = (/<table[\s\S]*?<\/table>/i.exec(full) || [full])[0];
        html += '<h2>' + esc(n) + '</h2>' + table;
      });
      return html;
    } catch (e) { return null; }
  }

  // ---- Worker 解析（大文件）：transfer 的必须是同一个 ArrayBuffer ----
  let worker = null, seq = 0;
  const pending = new Map();
  function getWorker() {
    if (worker) return worker;
    try {
      worker = new Worker('js/preview-worker.js');
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        clearTimeout(p.timer);
        e.data.ok ? p.resolve(e.data.html) : p.reject(new Error(e.data.error));
      };
      worker.onerror = () => { worker = null; };
      return worker;
    } catch (e) { return null; }
  }
  function parseInWorker(kind, u8) {
    const w = getWorker();
    if (!w) return null;
    const id = ++seq;
    const copy = u8.slice();          // 唯一副本，既传数据也 transfer
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('解析超时')); }
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      try { w.postMessage({ id, kind, buf: copy.buffer }, [copy.buffer]); }
      catch (e) { pending.delete(id); clearTimeout(timer); reject(e); }
    });
  }

  // pptx 是 zip 包：遍历 local file header，抽 ppt/slides/slideN.xml 里的 <a:t> 文本。
  // 按文件名里的真实页码 N 出每页标题（空文字页也占位），保证与嵌入图（按 slideN 归组）页码对齐。
  // 阶段零锚点：GitHub CasualOffice/slides 的 PPTX_PIPELINE.md 确认 <p:sld> 即一页，页码来自 slideN.xml 文件名。
  async function pptxSlides(u8) {
    if (typeof DecompressionStream === 'undefined') return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const td = new TextDecoder();
    const map = {}; let pos = 0;
    while (pos + 30 < u8.length) {
      if (dv.getUint32(pos, true) !== 0x04034b50) break;
      const method = dv.getUint16(pos + 8, true);
      const csize = dv.getUint32(pos + 18, true);
      const fnLen = dv.getUint16(pos + 26, true);
      const exLen = dv.getUint16(pos + 28, true);
      const name = td.decode(u8.subarray(pos + 30, pos + 30 + fnLen));
      const start = pos + 30 + fnLen + exLen;
      const mm = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
      if (mm && csize > 0) {
        const no = parseInt(mm[1], 10);
        let xml;
        if (method === 8) {
          try {
            const ds = new DecompressionStream('deflate-raw');
            const ab = await new Response(new Blob([u8.subarray(start, start + csize)]).stream().pipeThrough(ds)).arrayBuffer();
            xml = td.decode(new Uint8Array(ab));
          } catch (e) { map[no] = map[no] || ''; continue; } // 单页解压失败也占位，保持页码对齐
        } else {
          xml = td.decode(u8.subarray(start, start + csize)); // method 0 原样存储
        }
        const hits = xml.match(/<a:t>[\s\S]*?<\/a:t>/g) || [];
        const texts = hits.map(h => h.replace(/<\/?a:t>/g, '')).filter(Boolean);
        map[no] = texts.join('\n');
      }
      pos = start + csize;
      if (csize === 0) break; // 用了 data descriptor，不盲扫
    }
    const nos = Object.keys(map).map(Number).sort((a, b) => a - b);
    return nos.length ? nos.map(no => ({ no, text: map[no] })) : null;
  }

  // 取单张嵌入图的可用 src：Electron 走 IPC 拿 base64；HTTP 走同源 /asset/:aid URL。
  // 阶段零锚点：api-client.js 约定——Electron 返 {data,mime}，HTTP 返 {url}（同源字节路由），二者皆离线。
  async function assetSrc(ctx, asset) {
    if (!ctx || !ctx.bookId || !ctx.matId) return null;
    try {
      const a = await window.API.materials.readAsset(ctx.bookId, ctx.matId, asset.id);
      if (a && a.url) return a.url;                       // HTTP 模式：同源字节路由
      if (a && a.data) return 'data:' + (a.mime || 'image/png') + ';base64,' + a.data;  // Electron 模式
    } catch (e) { /* 单图失败不影响其它 */ }
    return null;
  }
  // 把一组嵌入图渲染成图片网格（离线、同源、零外链）。
  async function imgsToHtml(imgs, ctx) {
    let s = '<div class="pv-imgs">';
    for (const im of (imgs || [])) {
      const src = await assetSrc(ctx, im);
      if (src) s += '<img class="pv-img" src="' + esc(src) + '" alt="' + esc(im.name || '图') + '">';
    }
    s += '</div>';
    return s;
  }

  const Preview = {
    // 返回 {kind:'img'|'iframe'|'srcdoc'|'download', ...}
    async render(m, ctx) {
      const ext = (m.ext || '').toLowerCase();
      const url = 'data:' + m.mime + ';base64,' + m.data;
      const name = m.name || '文件';

      if (IMG.includes(ext)) return { kind: 'img', src: url };
      if (ext === '.pdf') return { kind: 'iframe', src: url };
      if (ext === '.txt' || ext === '.md') {
        return srcdoc(name, '<pre>' + esc(new TextDecoder().decode(b64ToU8(m.data))) + '</pre>');
      }
      if (ext === '.doc' || ext === '.ppt') {
        return { kind: 'download', url, name, reason: '旧版二进制格式（' + ext + '）无法本地解析，请另存为 .docx / .pptx' };
      }

      const u8 = b64ToU8(m.data);
      if (ext === '.docx' || ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
        const kind = ext === '.docx' ? 'docx' : 'xlsx';
        let html = null;
        if (u8.length > BIG) {
          const p = parseInWorker(kind, u8);
          if (p) { try { html = await p; } catch (e) { html = null; } }
        }
        if (html == null) html = kind === 'docx' ? await parseDocx(u8) : parseSheet(u8);
        if (html != null) return srcdoc(name, html);
        return { kind: 'download', url, name, reason: '解析失败或当前环境不支持，已提供下载' };
      }
      if (ext === '.pptx') {
        const slides = await pptxSlides(u8).catch(() => null);
        if (!slides) return { kind: 'download', url, name, reason: 'PPT 解析失败，已提供下载' };
        const media = (m.assets || []).filter(a => a.kind === 'media' && a.ext && IMG.includes(a.ext.toLowerCase()));
        const bySlide = {}; const ungrouped = [];
        for (const a of media) { if (a.slide != null) (bySlide[a.slide] = bySlide[a.slide] || []).push(a); else ungrouped.push(a); }
        let body = '';
        for (const s of slides) {
          body += '<h3>第 ' + s.no + ' 页</h3>';
          if (s.text) body += '<p>' + esc(s.text).replace(/\n/g, '<br>') + '</p>';
          if (bySlide[s.no] && bySlide[s.no].length) body += await imgsToHtml(bySlide[s.no], ctx);
        }
        if (ungrouped.length) body += '<h3>未归组图片（无法定位到具体幻灯片）</h3>' + await imgsToHtml(ungrouped, ctx);
        if (!body.trim()) return { kind: 'download', url, name, reason: 'PPT 无可见文字与图片，已提供下载' };
        return srcdoc(name, body);
      }
      return { kind: 'download', url, name, reason: '此类型浏览器不能直接预览' };
    }
  };

  window.Preview = Preview;
})();
