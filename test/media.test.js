'use strict';
// M0 单测：asset 一等公民 + PPTX/DOCX 内嵌媒体抽取 + PDF 文字透传。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');
const media = require('../lib/media');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra != null ? '  → ' + JSON.stringify(extra) : '')); }
}
function b64(buf) { return Buffer.from(buf).toString('base64'); }

// 构造一个 method=0（stored）的最小 ZIP，供媒体抽取测试（不校验 CRC，crc 填 0）。
function makeZip(entries) {
  const parts = [];
  entries.forEach(e => {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const hdr = Buffer.alloc(30);
    hdr.writeUInt32LE(0x04034b50, 0);
    hdr.writeUInt16LE(20, 4);
    hdr.writeUInt16LE(0, 6);        // flags
    hdr.writeUInt16LE(0, 8);        // method = stored
    hdr.writeUInt16LE(0, 10); hdr.writeUInt16LE(0, 12);
    hdr.writeUInt32LE(0, 14);       // crc
    hdr.writeUInt32LE(data.length, 18);
    hdr.writeUInt32LE(data.length, 22);
    hdr.writeUInt16LE(name.length, 26);
    hdr.writeUInt16LE(0, 28);
    parts.push(hdr, name, data);
  });
  return Buffer.concat(parts);
}

console.log('M0：asset 入库 / 读取 / 删除');
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm0asset-'));
  const store = Store(root);
  const b = store.createBook({ title: 'T' });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]); // 假 PNG 字节
  const added = store.addMaterials(b.id, 1, [{
    name: 'lecture.pdf', data: b64(Buffer.from('%PDF-1.4 fake')), extractedText: '正态分布 均值 方差',
    assets: [{ name: 'page-1.png', data: png, kind: 'page', page: 1, caption: '第 1 页' }]
  }], {});
  const m = added[0];
  ok('readMaterial 返回 extractedText', store.readMaterial(b.id, m.id).extractedText === '正态分布 均值 方差');
  const r = store.readMaterial(b.id, m.id);
  ok('readMaterial 返回 assets 元信息', r.assets.length === 1 && r.assets[0].kind === 'page' && r.assets[0].page === 1, r.assets);
  const a = store.readAsset(b.id, m.id, r.assets[0].id);
  ok('readAsset 字节一致', Buffer.compare(Buffer.from(a.data, 'base64'), png) === 0 && a.mime === 'image/png', { len: a.data.length });
  ok('asset 文件落盘', fs.existsSync(path.join(root, 'books', b.id, 'layer_1', m.id + '.assets', r.assets[0].id + r.assets[0].ext)));
  // 删除资料应连带删除 .assets 文件夹（软删可逆由 trash 处理，这里验证目录被移走/清掉）
  store.deleteMaterial(b.id, m.id);
  ok('删除资料后 .assets 不再作为有效资产存在（readAsset 抛错）', (() => { try { store.readAsset(b.id, m.id, r.assets[0].id); return false; } catch (e) { return true; } })());
}

console.log('M0：PPTX 内嵌媒体抽取 + 幻灯片归属');
{
  const media_png = Buffer.from([1, 2, 3, 4, 5]);
  const rels = '<Relationships xmlns="x">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>';
  const slide = '<p:sld xmlns:a="x"><a:t>均值</a:t></p:sld>';
  const z = makeZip([
    { name: 'ppt/media/image1.png', data: media_png },
    { name: 'ppt/slides/slide1.xml', data: slide },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: rels }
  ]);
  const out = media.extractOfficeMedia(z, '.pptx');
  ok('抽出 1 张媒体', out.length === 1, out.map(o => o.name));
  ok('媒体归属到第 1 页', out[0] && out[0].slide === 1, out[0]);
  ok('媒体名正确', out[0] && out[0].name === 'image1.png');
}
console.log('M0：DOCX 内嵌媒体抽取（无幻灯片概念，slide=null）');
{
  const media_png = Buffer.from([9, 8, 7]);
  const z = makeZip([{ name: 'word/media/image2.png', data: media_png }]);
  const out = media.extractOfficeMedia(z, '.docx');
  ok('抽出 1 张媒体', out.length === 1, out.map(o => o.name));
  ok('DOCX 媒体 slide 为 null', out[0] && out[0].slide === null);
}
console.log('M0：无媒体的 Office 文件返回空');
{
  const z = makeZip([{ name: 'ppt/slides/slide1.xml', data: '<p:sld/>' }]);
  ok('无媒体时返回 []', media.extractOfficeMedia(z, '.pptx').length === 0);
}
console.log('M0：非 Office 类型返回空');
{
  ok('png 不处理', media.extractOfficeMedia(Buffer.from('x'), '.png').length === 0);
  ok('pdf 不处理', media.extractOfficeMedia(Buffer.from('x'), '.pdf').length === 0);
}

console.log('\nM0 media 单测： ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
