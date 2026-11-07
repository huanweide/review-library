'use strict';
// 本地提示词驱动「系统参考资料」生成（全离线、零模型、不编造）。
// 依据阶段零融合决策：AI-Paperless 的「提示词管理 + 目录继承标签」结构本地化；
// 层权重沿用本项目的核心约定（层号越小越重要、参考价值越强）。
// 硬约束：只从已落盘资料抽取原文片段，不产生新知识点；无可读文本时明确失败，不造假内容。
const zlib = require('zlib');

const STOP = new Set(['的', '了', '和', '与', '及', '或', '在', '是', '有', '把', '被', '对', '从', '到', '为', '以', '这', '那', '我', '你', '重点', '复习', '要求', '部分', '内容', '一下', '请', '帮', '看', '并', '中', '上', '下', '个', '们', '就', '都', '也', '要', '会', '可']);

// 从提示词抽关键词：中文取 2-gram，英文/数字取整词；停用词过滤。
function keywords(prompt) {
  const out = new Set();
  String(prompt || '').split(/[^\u4e00-\u9fa5A-Za-z0-9]+/).forEach(seg => {
    if (!seg) return;
    if (/^[A-Za-z0-9]+$/.test(seg)) { if (seg.length >= 2) out.add(seg.toLowerCase()); return; }
    for (let i = 0; i < seg.length - 1; i++) {
      const g = seg.slice(i, i + 2);
      if (!STOP.has(g)) out.add(g);
    }
    if (seg.length === 1 && !STOP.has(seg)) out.add(seg);
  });
  return [...out];
}

// 极简 zip 遍历：返回 {name, data} 列表，只解 deflate(method=8) 的条目。
function unzip(buf) {
  const out = [];
  let pos = 0;
  while (pos + 30 <= buf.length) {
    if (buf.readUInt32LE(pos) !== 0x04034b50) break;
    const method = buf.readUInt16LE(pos + 8);
    const csize = buf.readUInt32LE(pos + 18);
    const fnLen = buf.readUInt16LE(pos + 26);
    const exLen = buf.readUInt16LE(pos + 28);
    const name = buf.slice(pos + 30, pos + 30 + fnLen).toString('utf8');
    const start = pos + 30 + fnLen + exLen;
    if (csize === 0) break;
    if (start + csize > buf.length) break;
    if (method === 8) {
      try { out.push({ name, data: zlib.inflateRawSync(buf.slice(start, start + csize)) }); }
      catch (e) { /* 单条目损坏跳过 */ }
    } else if (method === 0) {
      out.push({ name, data: buf.slice(start, start + csize) });
    }
    pos = start + csize;
  }
  return out;
}

function xmlText(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// 从文件二进制抽纯文本；抽不出返回 null（不猜、不编）。
function extractText(ext, buf) {
  const e = (ext || '').toLowerCase();
  if (e === '.txt' || e === '.md' || e === '.csv') return buf.toString('utf8');
  if (e === '.docx' || e === '.xlsx' || e === '.pptx') {
    const parts = unzip(buf);
    const picks = parts.filter(p => {
      if (e === '.docx') return /^word\/(document|header\d*|footer\d*)\.xml$/.test(p.name);
      if (e === '.xlsx') return /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(p.name);
      return /^ppt\/slides\/slide\d+\.xml$/.test(p.name);
    });
    if (!picks.length) return null;
    return picks.map(p => xmlText(p.data.toString('utf8'))).filter(Boolean).join('\n');
  }
  return null;
}

function fragments(text) {
  return String(text).split(/[\n\r。；;！!？?]+/).map(s => s.trim()).filter(s => s.length >= 6 && s.length <= 300);
}

function score(frag, kws) {
  let hit = 0;
  const low = frag.toLowerCase();
  kws.forEach(k => { if (low.includes(k.toLowerCase())) hit++; });
  return hit;
}

// 主入口：返回 {ok, rec} 或 {ok:false, reason}
function generate(store, bookId, prompt) {
  const p = String(prompt || '').trim();
  if (!p) return { ok: false, reason: '复习要求提示词不能为空' };
  const kws = keywords(p);
  if (!kws.length) return { ok: false, reason: '提示词里没有可识别的关键词' };

  const g = store.getBook(bookId);
  const sources = [];
  g.materials.forEach(m => {
    let raw;
    try { raw = Buffer.from(store.readMaterial(bookId, m.id).data, 'base64'); }
    catch (e) { return; }
    const text = extractText(m.ext, raw);
    if (!text) return;
    const frags = fragments(text);
    const ranked = frags.map(f => ({ f, hit: score(f, kws) }))
      .filter(x => x.hit > 0).sort((a, b) => b.hit - a.hit).slice(0, 3);
    if (!ranked.length) return;
    // 层权重：L1 最重要，层号越大权重越低
    const weight = 1 / m.layer;
    sources.push({
      id: m.id, name: m.name, layer: m.layer,
      weight, score: ranked.reduce((s, x) => s + x.hit, 0) * weight,
      frags: ranked.map(x => x.f)
    });
  });
  if (!sources.length) {
    return { ok: false, reason: '没有命中提示词的资料（或资料格式不可抽文本：扫描版 PDF / 图片 / 旧版 doc）' };
  }
  sources.sort((a, b) => b.score - a.score || a.layer - b.layer);

  const ts = new Date();
  const stamp = ts.getFullYear() + '-' + String(ts.getMonth() + 1).padStart(2, '0') + '-' + String(ts.getDate()).padStart(2, '0') +
    ' ' + String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0');
  const lines = [
    '# 系统复习提纲',
    '',
    '- 生成时间：' + stamp,
    '- 复习要求：' + p,
    '- 关键词：' + kws.slice(0, 12).join(' / '),
    '- 命中资料：' + sources.length + ' 份（按层权重与关键词命中排序）',
    '- 生成方式：本地规则抽取，内容全部来自原文，未联网、未使用模型、未产生新知识点',
    '',
    '## 重点摘录',
    ''
  ];
  sources.forEach((s, i) => {
    lines.push('### ' + (i + 1) + '. ' + s.name + '（L' + s.layer + '）');
    lines.push('');
    s.frags.forEach(f => lines.push('> ' + f));
    lines.push('');
  });
  lines.push('## 来源回链', '');
  sources.forEach(s => lines.push('- L' + s.layer + ' · ' + s.name + '（资料 ID：' + s.id + '）'));
  lines.push('');
  lines.push('> 本文件由系统生成为参考资料，可在书内按层查看；原文以上面回链为准。');

  const md = lines.join('\n');
  const fname = '系统复习提纲-' + stamp.replace(/[: ]/g, '-') + '.md';
  const rec = store.addMaterials(bookId, 1,
    [{ name: fname, data: Buffer.from(md, 'utf8').toString('base64') }],
    { source: 'system', prompt: p, tags: ['系统生成', '复习提纲'], derivedFrom: sources.map(s => s.id) })[0];
  return { ok: true, rec, sourceCount: sources.length, keywords: kws };
}

module.exports = { generate, keywords, extractText, unzip };
