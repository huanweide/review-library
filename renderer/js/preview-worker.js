'use strict';
// 大文件解包 Worker：只把二进制转成 HTML 字符串，清洗与展示仍在主线程做。
// vendor 用相对路径 importScripts，全部本地文件，不产生任何外部请求。
// file:// 协议下 Worker 可能被浏览器策略拒绝；主线程已备 try/catch 回退路径，功能不丢。
try {
  importScripts('../vendor/mammoth.browser.js', '../vendor/xlsx.full.min.js');
} catch (e) {
  self.postMessage({ id: -1, ok: false, error: 'vendor 加载失败: ' + String(e) });
}

self.onmessage = async function (e) {
  const { id, kind, buf } = e.data || {};
  try {
    let html;
    if (kind === 'docx') {
      if (!self.mammoth) throw new Error('mammoth 不可用');
      const r = await self.mammoth.convertToHtml({ arrayBuffer: buf });
      html = r.value;
    } else {
      if (!self.XLSX) throw new Error('XLSX 不可用');
      const wb = self.XLSX.read(new Uint8Array(buf), { type: 'array', cellStyles: false });
      html = '';
      wb.SheetNames.forEach(n => {
        const full = self.XLSX.utils.sheet_to_html(wb.Sheets[n]);
        const table = (/<table[\s\S]*?<\/table>/i.exec(full) || [full])[0];
        html += '<h2>' + n.replace(/[&<>]/g, '') + '</h2>' + table;
      });
    }
    self.postMessage({ id, ok: true, html });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
