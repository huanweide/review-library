'use strict';
// insight.js 单测：本地提示词驱动生成（真落盘 / 层权重 / 回链 / 不造假 / 不可抽文本必失败）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Store } = require('../lib/store');
const insight = require('../lib/insight');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }
function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

// 造一个最小合法 zip（store 模式），用于验证 docx/pptx 的 XML 文本抽取。
function zipStore(entries) {
  const locals = [], centrals = [];
  let off = 0;
  entries.forEach(({ name, data }) => {
    const n = Buffer.from(name, 'utf8'), d = Buffer.from(data, 'utf8');
    const crc = require('zlib').crc32 ? require('zlib').crc32(d) : crc32(d);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22);
    lh.writeUInt16LE(n.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, n, d);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24);
    ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, n);
    off += lh.length + n.length + d.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'insight-test-'));
const store = new Store(tmp);

console.log('Insight 单测：');
// 1) 关键词提取
const kw = insight.keywords('重点看相图与结晶部分');
ok('关键词含「相图」', kw.includes('相图'));
ok('关键词含「结晶」', kw.includes('结晶'));
ok('停用词「重点」被过滤', !kw.includes('重点'));

// 2) zip 文本抽取
const fakeDocx = zipStore([{ name: 'word/document.xml', data: '<w:p><w:t>相图是材料科学的基础</w:t></w:p><w:p><w:t>结晶过程包含形核与长大</w:t></w:p>' }]);
ok('从 docx zip 抽出「相图」', /相图/.test(insight.extractText('.docx', fakeDocx) || ''));
ok('从 docx zip 抽出「结晶」', /结晶/.test(insight.extractText('.docx', fakeDocx) || ''));
ok('扫描版 PDF 不可抽文本 → null', insight.extractText('.pdf', Buffer.from('%PDF-1.4')) === null);

// 3) 判别测试：空书 + 只有不可抽文本的资料 → 必须失败，不许造假
const b0 = store.createBook({ title: '空书' });
store.addMaterials(b0.id, 1, [{ name: '扫描.pdf', data: b64('%PDF-1.4 fake') }], {});
const r0 = insight.generate(store, b0.id, '重点看相图');
ok('无可抽文本时 ok=false', r0.ok === false);
ok('失败给出明确原因', typeof r0.reason === 'string' && r0.reason.length > 0);
ok('失败时未落任何新资料', store.getBook(b0.id).materials.length === 1);

// 4) 正常生成：L1 提纲 + L2 作业，含关键词
const b = store.createBook({ title: '材料科学基础' });
store.addMaterials(b.id, 1,
  [{ name: '总复习.txt', data: b64('相图是描述相平衡关系的图形。\n结晶过程包括形核与长大两个阶段。\n铁碳相图是最重要的相图。') }],
  { prompt: '重点看相图' });
store.addMaterials(b.id, 2,
  [{ name: '作业1.txt', data: b64('根据相图分析冷却曲线。\n无关内容一行。') }], {});
store.addMaterials(b.id, 2, [{ name: '图.png', data: b64('PNGDATA') }], {});

const r = insight.generate(store, b.id, '重点看相图与结晶');
ok('生成成功 ok=true', r.ok === true);
ok('命中 2 份可抽文本资料', r.sourceCount === 2);
const rec = r.rec;
ok('产物 source=system', rec.source === 'system');
ok('产物落在 L1', rec.layer === 1);
ok('产物是 .md', rec.ext === '.md');
ok('产物带 derivedFrom 回链', Array.isArray(rec.derivedFrom) && rec.derivedFrom.length === 2);
ok('产物带原始提示词', rec.prompt === '重点看相图与结晶');
ok('产物真落盘', fs.existsSync(path.join(tmp, 'books', b.id, 'layer_1', rec.id + '.md')));
const md = fs.readFileSync(path.join(tmp, 'books', b.id, 'layer_1', rec.id + '.md'), 'utf8');
ok('提纲含「系统复习提纲」标题', md.includes('# 系统复习提纲'));
ok('提纲含「来源回链」', md.includes('## 来源回链'));
ok('提纲含原文片段「相图」', md.includes('相图'));
ok('提纲声明未联网未用模型', md.includes('未联网') && md.includes('未使用模型'));
ok('索引 materialCount 由 3 变 4', store.listBooks().find(x => x.id === b.id).materialCount === 4);

// 5) 空提示词与无关键词
ok('空提示词被拒', insight.generate(store, b.id, '   ').ok === false);
ok('纯标点提示词被拒', insight.generate(store, b.id, '，。！').ok === false);

console.log('\n结果： ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
