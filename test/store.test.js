'use strict';
// 后端落盘逻辑单测：在临时目录跑完整 CRUD + 软删回收站 + 分层移动 + 读回校验。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }
function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-test-'));
const store = new Store(tmp);

console.log('Store 单测：');
// 1) 建书
const b = store.createBook({ title: '材料科学基础', exam: '2026期末', subject: '材料', coverColor: '#3a7afe', note: '测试' });
ok('createBook 返回 id 与书名', b.id && b.title === '材料科学基础');
ok('index.json 记录了该书', store.listBooks().some(x => x.id === b.id));

// 2) 分层加资料（L1 提纲 + L2 作业）
const a1 = store.addMaterials(b.id, 1, [{ name: '总复习PPT.pdf', data: b64('PDFDATA1') }], { prompt: '重点看相图', tags: ['核心'] });
const a2 = store.addMaterials(b.id, 2, [{ name: '作业1.docx', data: b64('DOCXDATA') }, { name: '作业2.png', data: b64('PNGDATA') }], {});
ok('L1 加 1 份', a1.length === 1 && a1[0].layer === 1);
ok('L2 加 2 份', a2.length === 2 && a2.every(x => x.layer === 2));

// 3) 索引统计正确
const idx = store.listBooks().find(x => x.id === b.id);
ok('materialCount=3', idx.materialCount === 3);
ok('layerCounts={1:1,2:2}', idx.layerCounts['1'] === 1 && idx.layerCounts['2'] === 2);

// 4) 读回资料内容一致
const r1 = store.readMaterial(b.id, a1[0].id);
ok('读回 mime=pdf', r1.mime === 'application/pdf');
ok('读回 data 与写入一致', Buffer.from(r1.data, 'base64').toString('utf8') === 'PDFDATA1');

// 5) 文件真实落盘到 layer_1
const fpath = path.join(tmp, 'books', b.id, 'layer_1', a1[0].id + '.pdf');
ok('文件真实存在于 layer_1 目录', fs.existsSync(fpath));

// 6) 移层：把 L2 的 png 移到 L3
const png = a2.find(x => x.ext === '.png');
const moved = store.moveMaterial(b.id, png.id, 3);
ok('moveMaterial 改层为 3', moved.layer === 3);
ok('移层后文件在 layer_3', fs.existsSync(path.join(tmp, 'books', b.id, 'layer_3', png.id + '.png')) && !fs.existsSync(path.join(tmp, 'books', b.id, 'layer_2', png.id + '.png')));

// 7) 软删资料 → 进 .trash，索引 -1
const delDocxId = a2.find(x => x.ext === '.docx').id;
store.deleteMaterial(b.id, delDocxId);
ok('删资料后 materialCount=2', store.listBooks().find(x => x.id === b.id).materialCount === 2);
ok('删的资料进回收站', fs.readdirSync(path.join(tmp, '.trash')).some(f => f.startsWith('m_')));

// 7b) 恢复误删的资料 → 回原层，索引 +1（回收站可逆闭环）
const tDocx = store.listTrash().find(x => x.materialId === delDocxId);
store.restoreMaterial(tDocx.key);
ok('恢复资料后 materialCount=3', store.listBooks().find(x => x.id === b.id).materialCount === 3);
ok('恢复的资料回 layer_2 目录', fs.existsSync(path.join(tmp, 'books', b.id, 'layer_2', delDocxId + '.docx')));
ok('回收站不再含该资料', !store.listTrash().some(x => x.materialId === delDocxId));

// 8) 软删书 → 进 .trash，索引移除
store.deleteBook(b.id);
ok('删书后不在列表', !store.listBooks().some(x => x.id === b.id));
ok('删的书进回收站', fs.readdirSync(path.join(tmp, '.trash')).some(f => f.startsWith('b_')));

// 8b) 恢复误删的书 → 整本回来（含全部资料）
const tBook = store.listTrash().find(x => x.bookId === b.id && x.type === 'book');
store.restoreBook(tBook.key);
ok('恢复书后回到列表', store.listBooks().some(x => x.id === b.id));
ok('恢复的书 materialCount=3（含全部资料）', store.listBooks().find(x => x.id === b.id).materialCount === 3);
ok('回收站不再含该书', !store.listTrash().some(x => x.type === 'book'));

// 8c) 彻底删（purge）闭环
const b2 = store.createBook({ title: '高数' });
store.deleteBook(b2.id);
const tB2 = store.listTrash().find(x => x.bookId === b2.id);
store.purgeTrash(tB2.key);
ok('purgeTrash 后回收站清空该项', !store.listTrash().some(x => x.bookId === b2.id));
ok('purgeTrash 后物理文件消失', !fs.existsSync(path.join(tmp, '.trash', tB2.key)));

// 9) 路径穿越防护
let blocked = false;
try { store.getBook('../etc'); } catch (e) { blocked = true; }
ok('非法 id 被拒', blocked);

// 10) 改书元数据
store.updateBook(b.id, { coverColor: '#e0533d', note: '改了' });
ok('updateBook 生效', store.getBook(b.id).book.coverColor === '#e0533d');

console.log('\n结果： ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
