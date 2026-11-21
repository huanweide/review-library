'use strict';
// 统一核心 · 图片原样复现（2026-11-20）
//
// 铁律（对用户验收 3 的正面回答）：
//   不画、不生成、不重编码。OOXML（pptx/docx/xlsx）本质是 zip，图片本来就躺在
//   ppt/media/ 与 word/media/ 里，取**原字节**落盘即可。任何"重画一张像它的图"
//   都会丢失细节且必然画错——这条路从一开始就不走。
//
// 定位链（真实样本逐字符核实，见 test/images.test.js）：
//   pptx: ppt/slides/slideN.xml 的 <a:blip r:embed="rId1">
//         → ppt/slides/_rels/slideN.xml.rels 的 Target="media/image1.png"
//         → 绝对路径 ppt/slides/media/image1.png
//   docx: word/document.xml 第 i 段 <a:blip r:embed="rId9">
//         → word/_rels/document.xml.rels 的 Target="media/image1.png"
//         → word/media/image1.png；实测**图注就在图片后一段**
//         （"图1 正态分布3σ规则示意图…"），前一段是正文说明。
//
// 去重（对验收 2b「不要重复几次」）：按图片字节 SHA-256 去重，磁盘只存一份原图；
//   同一张图出现在 PPT 和 Word 里 → 索引记两条 sources，各有自己的页/图注/上下文。
//   图只存一次 ≠ 出处只留一个：恰好做到"图全 + 不重复 + 能回指每一处"。
//
// 独立图片文件（用户直接拖 PNG/JPG）由调用方补一条 self 记录，不二次复制字节。
// 零新依赖：复用 lib/insight 的 unzip（已有，且已修过 csize=0 的坑）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { unzip } = require('../lib/insight');

const IMAGE_BASENAME = /\.(png|jpe?g|gif|bmp|webp|tiff?|svg|emf|wmf)$/i;
const INDEX_FILE = 'images.json';

function extOf(name) {
  const m = String(name || '').match(/\.([A-Za-z0-9]+)$/);
  return m ? ('.' + m[1].toLowerCase()) : '.png';
}
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function genId() { return crypto.randomBytes(8).toString('hex'); }

function xmlText(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ').trim();
}

// 解析 .rels：{ rId → { target, isImage } }
function parseRels(xml) {
  const map = {};
  const re = /<Relationship\b[^>]*\/?>/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const tag = m[0];
    const id = (tag.match(/\bId="([^"]+)"/) || [])[1];
    const target = (tag.match(/\bTarget="([^"]+)"/) || [])[1];
    const type = (tag.match(/\bType="([^"]+)"/) || [])[1];
    if (!id || !target) continue;
    map[id] = { target: target.replace(/\\/g, '/'), isImage: !!(type && /\/image$/i.test(type)) };
  }
  return map;
}

// 把 zip 内相对 Target 归一到实际 part 名：
//   slide7.xml 的 "media/image1.png" → ppt/slides/media/image1.png
//   "media/image1.png" 也可能写成 "../media/image1.png"
function joinPart(baseDir, target) {
  const seg = String(target || '').split('/');
  const stack = String(baseDir || '').split('/').filter(Boolean);
  for (const s of seg) {
    if (!s || s === '.') continue;
    if (s === '..') { stack.pop(); continue; }
    stack.push(s);
  }
  return stack.join('/');
}
function findPart(parts, wanted) {
  const exact = parts.find((p) => p.name === wanted);
  if (exact) return exact;
  return parts.find((p) => p.name.toLowerCase() === String(wanted).toLowerCase());
}

// 从 rels 里解析 embed id 指向的媒体 part（返回 { name, data } 或 null）
function resolveImage(parts, rels, embedId, baseDir) {
  const rel = rels[embedId];
  if (!rel) return null;
  // 有些文档 Type 写得不规范；只要 Target 指向图片扩展名就认，不因 Type 缺失漏图。
  if (!rel.isImage && !IMAGE_BASENAME.test(rel.target)) return null;
  const name = joinPart(baseDir, rel.target);
  return findPart(parts, name) || null;
}

function embedIds(xml) {
  const out = [];
  const re = /\br:(?:embed|link)="(rId\d+)"/g;
  let m;
  while ((m = re.exec(String(xml || '')))) out.push(m[1]);
  return out;
}

// ---------- PPTX ----------
function fromPptx(buf) {
  const parts = unzip(buf);
  const slides = parts
    .filter((p) => /^ppt\/slides\/slide(\d+)\.xml$/.test(p.name))
    .map((p) => ({ p, n: Number(p.name.match(/slide(\d+)/)[1]) }))
    .sort((a, b) => a.n - b.n);
  const out = [];
  for (const { p, n } of slides) {
    const relPart = findPart(parts, 'ppt/slides/_rels/slide' + n + '.xml.rels');
    const rels = parseRels(relPart && relPart.data.toString('utf8'));
    const ids = embedIds(p.data.toString('utf8'));
    if (!ids.length) continue;
    const slideText = xmlText(p.data.toString('utf8'));
    ids.forEach((rid, order) => {
      const media = resolveImage(parts, rels, rid, 'ppt/slides');
      if (!media) return;
      out.push({
        data: media.data, ext: extOf(media.name), part: media.name,
        pageType: 'slide', page: n, ordinal: order,
        context: slideText.slice(0, 240), caption: '',
      });
    });
  }
  return out;
}

// ---------- DOCX ----------
function fromDocx(buf) {
  const parts = unzip(buf);
  const docPart = findPart(parts, 'word/document.xml');
  if (!docPart) return [];
  const relPart = findPart(parts, 'word/_rels/document.xml.rels');
  const rels = parseRels(relPart && relPart.data.toString('utf8'));
  const xml = docPart.data.toString('utf8');
  // 按 <w:p> 切段：图片必落在某段里；图注实测落在紧随其后的段落。
  const paras = xml.split(/<w:p(?:\s|>)/).slice(1);
  const texts = paras.map((x) => xmlText(x));
  const nonempty = (i) => {
    for (let k = i; k >= 0 && k >= i - 8; k--) if (texts[k]) return texts[k];
    return '';
  };
  const after = (i) => {
    for (let k = i + 1; k < texts.length && k <= i + 8; k++) if (texts[k]) return texts[k];
    return '';
  };
  const out = [];
  paras.forEach((para, i) => {
    const ids = embedIds(para);
    ids.forEach((rid, order) => {
      const media = resolveImage(parts, rels, rid, 'word');
      if (!media) return;
      const prev = nonempty(i - 1), next = after(i);
      // 图注判据：紧跟图片、以「图N」「Figure」「Fig.」开头，或整段很短（<=60 字）
      // 且不含句末断言行。拿不准时 caption 留空，context 仍保留前后文——不编图注。
      const capLooksLikeCaption = /^(图\s*\d|图\d|Figure\s*\d|Fig\.?\s*\d|插图\s*\d)/i.test(next)
        || (next.length > 0 && next.length <= 60 && !/[。；;]$/.test(next));
      out.push({
        data: media.data, ext: extOf(media.name), part: media.name,
        pageType: 'paragraph', page: i + 1, ordinal: order,
        context: prev.slice(0, 240),
        caption: capLooksLikeCaption ? next.slice(0, 160) : '',
      });
    });
  });
  return out;
}

// ---------- 独立图片文件：不自复制，只做一条指向原文件的记录 ----------
// 但**要拿真字节算 sha**，否则同一张图「docx 内嵌一份 + 独立 PNG 一份」会被当成两张图
// 存两遍（实测概率统计书就是这个情况）。真哈希才能跨"内嵌/独立"两种形态去重。
function fromStandalone(srcRelPath, ext, size, buf) {
  return [{
    data: buf || null, standalone: true, ext: extOf(ext), part: srcRelPath,
    pageType: 'file', page: 0, ordinal: 0, context: '', caption: '',
    sizeHint: Number(size) || (buf && buf.length) || 0,
  }];
}

// 统一入口：返回 [{ data:Buffer|null, standalone?, ext, part, pageType, page, ordinal, context, caption }]
function extractImages(ext, buf, meta) {
  const e = String(ext || '').toLowerCase();
  if (e === '.pptx') return fromPptx(buf);
  if (e === '.docx') return fromDocx(buf);
  if (IMAGE_BASENAME.test(e)) {
    return fromStandalone((meta && meta.relPath) || '', e, (meta && meta.size) || (buf && buf.length), buf);
  }
  return [];
}

function emptyIndex() {
  return { version: 1, createdAt: new Date().toISOString(), images: [] };
}
function indexPath(bookDir) { return path.join(bookDir, INDEX_FILE); }
function loadIndex(bookDir) {
  try {
    const j = JSON.parse(fs.readFileSync(indexPath(bookDir), 'utf8'));
    if (j && Array.isArray(j.images)) return j;
  } catch (e) { /* 新书 / 损坏都按空索引重建，不让它挡住导入 */ }
  return emptyIndex();
}
function saveIndex(bookDir, idx) {
  idx.updatedAt = new Date().toISOString();
  fs.mkdirSync(bookDir, { recursive: true });
  fs.writeFileSync(indexPath(bookDir), JSON.stringify(idx, null, 2), 'utf8');
  return idx;
}

// 把本次抽取结果并入书的 images.json。
// 同一 sha256 只落一份原字节，追加 source；返回 { added, deduped, records }。
function ingest(bookDir, fileId, fileName, ext, buf, meta) {
  const found = extractImages(ext, buf, meta);
  if (!found.length) return { added: 0, deduped: 0, records: [] };
  const idx = loadIndex(bookDir);
  const imgDir = path.join(bookDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  let added = 0, deduped = 0;
  const records = [];
  for (const item of found) {
    // 内嵌图与独立图片都按真字节 sha 去重；没有字节可算时（异常兜底）才退到来源标识
    const digest = item.data ? sha(item.data) : ('self:' + fileId + ':' + item.part);
    const existing = idx.images.find((x) => x.sha256 === digest);
    const source = {
      fileId, fileName: String(fileName || ''), part: item.part,
      pageType: item.pageType, page: Number(item.page) || 0, ordinal: Number(item.ordinal) || 0,
      caption: item.caption || '', context: item.context || '',
    };
    if (existing) {
      // 同一份图别记两次同一出处（重复导入同一文件时保持幂等）
      const dup = existing.sources.some((s) => s.fileId === fileId && s.page === source.page && s.ordinal === source.ordinal && s.part === source.part);
      if (!dup) existing.sources.push(source);
      deduped++;
      records.push(existing);
      continue;
    }
    const id = genId();
    // 独立图片直接指向 files/ 里已有的原字节，不二次复制；绝对路径一律不接受（纵深防御）
    const standaloneRel = item.standalone && item.part && !path.isAbsolute(item.part)
      && !item.part.split(/[\\/]/).includes('..') ? item.part : '';
    const relPath = standaloneRel || path.join('images', id + item.ext);
    if (item.data && !standaloneRel) fs.writeFileSync(path.join(bookDir, relPath), item.data);
    const rec = {
      id, ext: item.ext, relPath, sha256: digest,
      bytes: item.data ? item.data.length : (item.sizeHint || 0),
      sources: [source],
    };
    idx.images.push(rec);
    added++;
    records.push(rec);
  }
  saveIndex(bookDir, idx);
  return { added, deduped, records };
}

// 取原图字节（只读、不加工）。独立图片走 files/ 下的原始文件。
function readImage(bookDir, imageId) {
  const idx = loadIndex(bookDir);
  const rec = idx.images.find((x) => String(x.id) === String(imageId));
  if (!rec) return null;
  const p = path.join(bookDir, rec.relPath);
  if (!fs.existsSync(p)) return null;
  return { data: fs.readFileSync(p), ext: rec.ext, record: rec };
}

// 给分析提示词用的紧凑清单：图 id + 图注 + 上下文 + 出处（不塞字节，模型看的是描述）
function describeForPrompt(bookDir, limit) {
  const idx = loadIndex(bookDir);
  const cap = Number(limit) || 60;
  return idx.images.slice(0, cap).map((img, i) => {
    const s = img.sources[0] || {};
    const where = s.pageType === 'slide' ? ('PPT 第 ' + s.page + ' 页')
      : s.pageType === 'paragraph' ? ('Word 第 ' + s.page + ' 段')
        : ('独立图片 ' + (s.fileName || s.part || ''));
    return [
      '【图' + (i + 1) + '｜id=' + img.id + '】',
      s.caption ? '图注：' + s.caption : '',
      s.context ? '上下文：' + s.context.slice(0, 120) : '',
      '出处：' + where + (img.sources.length > 1 ? '（另有 ' + (img.sources.length - 1) + ' 处相同原图）' : ''),
    ].filter(Boolean).join('；');
  });
}

// 同字节多份图里挑「主图」：有图注 > 出自 PPT/Word 正文 > 独立文件；已视觉看过优先。
// 配对时只认主图，否则模型会在等价的几份 id 间随机挑，出处指到答题截图让人以为配错。
function primaryImages(bookDir) {
  const idx = loadIndex(bookDir);
  const byHash = new Map();
  const rank = (x) => {
    const s0 = (x.sources || [])[0] || {};
    return (s0.caption ? 4 : 0)
      + (s0.pageType === 'slide' || s0.pageType === 'paragraph' ? 2 : 0)
      + ((x.vision && x.vision.ok && x.vision.status === 'ok') ? 1 : 0);
  };
  idx.images.forEach((img) => {
    const prior = byHash.get(img.sha256);
    if (!prior || rank(img) > rank(prior)) byHash.set(img.sha256, img);
  });
  return Array.from(byHash.values());
}

module.exports = {
  extractImages, ingest, loadIndex, saveIndex, readImage, describeForPrompt, primaryImages,
  parseRels, fromPptx, fromDocx, sha, extOf, INDEX_FILE,
};
