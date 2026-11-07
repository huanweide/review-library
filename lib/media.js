'use strict';
// 抽取 Office 文档（PPTX / DOCX）内嵌媒体（图片），零依赖（纯 zlib + 自写 zip 遍历）。
// 依据阶段零锚点 C：PPTX 媒体在 ppt/media/，DOCX 在 word/media/；幻灯片与媒体的关联在 ppt/slides/_rels/slideN.xml.rels。
// 设计：复用 insight.unzip 的思路，但独立实现以避免扰动分析用的 unzip；媒体按文件名（basename）反查所属幻灯片。
const zlib = require('zlib');

// 遍历 zip 本地文件头，收集 name → data（method 0 原样，method 8 inflate-raw）。
function zipEntries(buf) {
  const out = [];
  let pos = 0;
  while (pos + 30 <= buf.length) {
    if (buf.readUInt32LE(pos) !== 0x04034b50) break;
    const flags = buf.readUInt16LE(pos + 6);
    const method = buf.readUInt16LE(pos + 8);
    const csize = buf.readUInt32LE(pos + 18);
    const fnLen = buf.readUInt16LE(pos + 26);
    const exLen = buf.readUInt16LE(pos + 28);
    const name = buf.slice(pos + 30, pos + 30 + fnLen).toString('utf8');
    const start = pos + 30 + fnLen + exLen;
    if (start + csize > buf.length) break;
    // 数据描述符（flag bit3）：头部 csize=0，无法安全跳转，best-effort 中止（与"不猜不编"一致）。
    if (csize === 0 && (flags & 0x08)) break;
    if (csize > 0) {
      let data = null;
      try {
        if (method === 8) data = zlib.inflateRawSync(buf.slice(start, start + csize));
        else if (method === 0) data = buf.slice(start, start + csize);
      } catch (e) { data = null; }
      if (data) out.push({ name, data });
    }
    pos = start + csize;
  }
  return out;
}

function basename(p) { return String(p || '').split('/').pop(); }

// 解析 ppt/slides/_rels/slideN.xml.rels：返回 { slideNo: [mediaBasename,...] }
function parseSlideRels(relsXml) {
  const map = {};
  const re = /<Relationship[^>]*Type="[^"]*relationships\/image"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = re.exec(relsXml))) {
    const t = m[1].replace(/^\.\.\//, '');
    // 归属：从 rels 文件名推断 slide 编号；Target 用 basename 反查媒体。
    const slideMatch = /slide(\d+)\.xml\.rels$/.exec(t) || /slide(\d+)\.xml\.rels$/.exec('');
    // 上面 t 是 Target，不是文件名；改用调用方传入的 slideNo。此处只返回 basename 列表。
    map.__last = map.__last || [];
    map.__last.push(basename(t));
  }
  return map.__last || [];
}

function extractOfficeMedia(buf, ext) {
  const e = (ext || '').toLowerCase();
  if (e !== '.pptx' && e !== '.docx') return [];
  const entries = zipEntries(buf);
  const byName = {};
  entries.forEach(en => { byName[en.name] = en.data; });
  const mediaPrefix = e === '.pptx' ? 'ppt/media/' : 'word/media/';
  const media = entries
    .filter(en => en.name.startsWith(mediaPrefix) && /\.(png|jpe?g|gif|webp|bmp|svg|emf|wmf|tiff?)$/i.test(en.name))
    .map(en => ({ name: basename(en.name), data: en.data }));

  if (!media.length) return [];

  // PPTX：把每个媒体按 slideN.xml.rels 的 Target basename 反查到幻灯片编号。
  const slideOf = {};
  if (e === '.pptx') {
    Object.keys(byName).forEach(name => {
      const mm = /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/.exec(name);
      if (!mm) return;
      const slideNo = parseInt(mm[1], 10);
      const xml = byName[name].toString('utf8');
      const re = /Target="([^"]+)"/g; let r;
      while ((r = re.exec(xml))) {
        const bn = basename(r[1].replace(/^\.\.\//, ''));
        if (bn) slideOf[bn] = slideNo;
      }
    });
  }

  return media.map(m => ({
    name: m.name, data: m.data, slide: slideOf[m.name] || null
  }));
}

function isImageExt(ext) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/i.test(ext || '');
}

module.exports = { extractOfficeMedia, zipEntries, isImageExt };
