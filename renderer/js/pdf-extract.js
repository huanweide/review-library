// PDF 本地抽取：在渲染进程用 pdfjs-dist（浏览器版）把每一页渲染成 PNG（保留图/表/公式），并抽文字。
// 零云、零 CDN：pdfjs 与 worker 均 vendoring 在 vendor/pdfjs/，worker 用 Blob URL 加载。
// 这是修复「不如看 PPT」的关键：PDF 的图、表、公式从此进管线，不再被静默丢弃。
let _lib = null;
let _init = null;

async function ensureLib() {
  if (_lib) return _lib;
  if (!_init) {
    _init = (async () => {
      const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
      try {
        const wurl = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url);
        const blob = await (await fetch(wurl)).blob();
        pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
      } catch (e) {
        // 兜底：直接用相对路径（部分环境 fetch 受限时）
        pdfjs.GlobalWorkerOptions.workerSrc = '../vendor/pdfjs/pdf.worker.min.mjs';
      }
      _lib = pdfjs;
      return pdfjs;
    })();
  }
  return _init;
}

function canvasToDataURL(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((b) => {
      if (!b) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || null);
      fr.readAsDataURL(b);
    }, 'image/png');
  });
}

async function extractPdf(u8) {
  const pdfjs = await ensureLib();
  // 复制一份，避免 pdfjs 接管 buffer 后外部再用
  const data = u8.slice ? u8.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) : new Uint8Array(u8);
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const texts = [];
  const assets = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    try {
      const tc = await page.getTextContent();
      const t = (tc.items || []).map(it => it.str || '').join(' ').replace(/\s+/g, ' ').trim();
      if (t) texts.push(t);
    } catch (e) { /* 单页文字失败不阻断整本 */ }
    try {
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const b64 = await canvasToDataURL(canvas);
      if (b64) assets.push({ name: 'page-' + i + '.png', data: b64, kind: 'page', page: i, caption: '第 ' + i + ' 页' });
    } catch (e) { /* 单页渲染失败不阻断 */ }
    page.cleanup();
  }
  await doc.destroy();
  return {
    pageCount: doc.numPages,
    extractedText: texts.join('\n').replace(/\s+/g, ' ').trim(),
    assets
  };
}

window.PdfExtract = { extractPdf };
