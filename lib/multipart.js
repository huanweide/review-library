/**
 * multipart.js —— 天道书院 · 零依赖 multipart/form-data 解析（仅用于文件上传）
 *
 * 只处理本次需要的字段：普通文本字段 + 文件（filename + 二进制 buffer）。
 * 用 Buffer 按 boundary 切分，避免把二进制 toString('utf8') 弄坏。
 */
'use strict';

function parseMultipart(buffer, contentType) {
  const m = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error('缺少 multipart boundary');
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const fields = {};
  const files = [];
  let pos = 0;
  function indexOfBuf(buf, needle, from) { return buf.indexOf(needle, from); }

  while (pos < buffer.length) {
    const start = indexOfBuf(buffer, boundary, pos);
    if (start < 0) break;
    let p = start + boundary.length;
    if (buffer[p] === 0x2d && buffer[p + 1] === 0x2d) break; // 结束边界 --
    if (buffer[p] === 0x0d) p++;
    if (buffer[p] === 0x0a) p++;
    const headerEnd = indexOfBuf(buffer, Buffer.from('\r\n\r\n'), p);
    if (headerEnd < 0) break;
    const header = buffer.slice(p, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = indexOfBuf(buffer, boundary, dataStart);
    if (nextBoundary < 0) break;
    let dataEnd = nextBoundary;
    // 边界前的 \r\n 属于分隔符，不算数据
    if (buffer[dataEnd - 2] === 0x0d && buffer[dataEnd - 1] === 0x0a) dataEnd -= 2;
    const data = buffer.slice(dataStart, dataEnd);
    // 关键：name 前必须加 (?:^|;)\s* 边界，否则会误匹配 filename="x" 里的 name 子串，
    // 把文件字段错认成普通字段（实测 files 被吞、files[] 为空）。
    const cd = header.match(/Content-Disposition:[^\r\n]*?(?:^|;)\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (cd) {
      const name = cd[1];
      const filename = cd[2];
      if (filename !== undefined) {
        const typeM = header.match(/Content-Type:\s*([^\r\n]+)/i);
        files.push({ field: name, name: filename, type: typeM ? typeM[1].trim() : 'application/octet-stream', buffer: data });
      } else {
        fields[name] = data.toString('utf8');
      }
    }
    pos = nextBoundary;
  }
  return { fields, files };
}
function extOf(name) { const i = String(name || '').lastIndexOf('.'); return i < 0 ? '' : String(name).slice(i).toLowerCase(); }

module.exports = { parseMultipart, extOf };
