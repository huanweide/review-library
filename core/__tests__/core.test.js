'use strict';
// 统一核心自测（纯 Node，无外部依赖）：建书 → 加文件(md/docx/pdf) → 抽取 → 用 mock LLM 分析 → 断言结构 & 落盘。
// 运行：node core/__tests__/core.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

const { Core } = require('../index');
const extract = require('../extract');

// —— 构造最小合法 .docx（zip: word/document.xml 用 deflateRaw 压缩）——
function makeDocx(text) {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body><w:p><w:r><w:t xml:space="preserve">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') +
    '</w:t></w:r></w:p></w:body></w:document>';
  const buf = Buffer.from(xml, 'utf8');
  const name = 'word/document.xml';
  const comp = zlib.deflateRawSync(buf);
  const crc = zlib.crc32(buf);
  const local = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // local file header sig
    Buffer.from([0x14, 0x00, 0x00, 0x00, 0x08, 0x00]), // version, flags, method=8
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // time, date
    u32(crc), u32(comp.length), u32(buf.length),
    u16(name.length), u16(0),
    Buffer.from(name, 'utf8'),
    comp
  ]);
  const central = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x01, 0x02]), // central dir sig
    Buffer.from([0x14, 0x00, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    u32(crc), u32(comp.length), u32(buf.length),
    u16(name.length), u16(0), u16(0), u16(0), u16(0), u16(0),
    u32(0),
    Buffer.from(name, 'utf8')
  ]);
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    u16(1), u16(1),
    u32(central.length), u32(local.length),
    u16(0), Buffer.from([0x00, 0x00])
  ]);
  return Buffer.concat([local, central, end]);
}
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; }

// —— mock LLM：返回一份结构合法的样例分析结果 ——
function mockChat(cfg, messages, opts) {
  const sample = {
    outline: {
      title: '高等数学（上册）',
      children: [
        {
          type: 'chapter', title: '第一章 函数与极限', children: [
            {
              type: 'section', title: '1.1 函数', children: [
                {
                  type: 'point', title: '复合函数', desc: '由若干函数嵌套构成的函数。', questionTypes: ['选择题', '填空题'], children: [
                    { type: 'subtype', title: '定义域求法', desc: '各层函数定义域的交集。', children: [] }
                  ]
                },
                {
                  type: 'point', title: '反函数', desc: '自变量与因变量互换。', questionTypes: ['简答题'], children: []
                }
              ]
            }
          ]
        },
        {
          type: 'chapter', title: '第二章 导数与微分', children: [
            {
              type: 'section', title: '2.1 导数概念', children: [
                {
                  type: 'point', title: '导数定义', desc: '极限形式的差商。', questionTypes: ['计算题', '名词解释'], children: [
                    { type: 'subtype', title: '左导数与右导数', desc: '单侧极限。', children: [] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    questionIndex: [
      { type: '选择题', items: [{ title: '判断复合函数定义域', path: ['第一章 函数与极限', '1.1 函数', '复合函数'] }] },
      { type: '填空题', items: [{ title: '求复合函数值', path: ['第一章 函数与极限', '1.1 函数', '复合函数'] }] },
      { type: '简答题', items: [{ title: '简述反函数性质', path: ['第一章 函数与极限', '1.1 函数', '反函数'] }] },
      { type: '名词解释', items: [{ title: '导数定义说明', path: ['第二章 导数与微分', '2.1 导数概念', '导数定义'] }] },
      { type: '计算题', items: [{ title: '按定义求导', path: ['第二章 导数与微分', '2.1 导数概念', '导数定义'] }] }
    ],
    summary: '全书围绕函数、极限、导数展开。'
  };
  return Promise.resolve(JSON.stringify(sample));
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-test-'));
  const core = new Core(root);
  const results = [];
  const ok = (name, cond) => { results.push([name, !!cond]); };

  // 1) 建书
  const book = core.createBook('高等数学（上册）');
  ok('建书返回 id', book && /^[0-9a-f]{16}$/.test(book.id));
  ok('建书后 listBooks 含 1 本', core.listBooks().length === 1);

  // 2) 加 md / docx / pdf / 图片
  const mdRec = await core.addFile(book.id, Buffer.from('# 标题\n这是一段 markdown 内容。', 'utf8'), { name: '笔记.md' });
  const docxRec = await core.addFile(book.id, makeDocx('文档里有重要的定义和定理。'), { name: '讲义.docx' });
  const pdfBuf = fs.readFileSync('node_modules/pdf-parse/test/data/01-valid.pdf');
  const pdfRec = await core.addFile(book.id, pdfBuf, { name: '教材.pdf' });
  const imgRec = await core.addFile(book.id, Buffer.from([0x89, 0x50, 0x4e, 0x47]), { name: '图1.png' });
  ok('加 4 个文件', book && core.getBook(book.id).files.length === 4);
  ok('pdf 被标记非图片', pdfRec.isImage === false);
  ok('png 被标记图片', imgRec.isImage === true);

  // 3) 抽取验证
  const mdText = core.getFileText(book.id, mdRec.id);
  ok('md 文本抽出', mdText && mdText.includes('markdown'));
  const docxText = core.getFileText(book.id, docxRec.id);
  ok('docx 文本抽出', docxText && docxText.includes('重要的定义'));
  const pdfText = core.getFileText(book.id, pdfRec.id);
  ok('pdf 文本抽出', pdfText && pdfText.length > 0);
  const imgText = core.getFileText(book.id, imgRec.id);
  ok('图片文本为空(留多模态)', imgText === '');

  // 4) 整本书文本拼接
  const full = core.getBookText(book.id);
  ok('全书文本含 md/docx/pdf', full.includes('markdown') && full.includes('重要的定义') && full.includes('Trace-based'));
  ok('全书文本不含图片占位', !full.includes('图1.png'));

  // 5) 用 mock LLM 整体分析
  const analysis = await core.analyze(book.id, { chat: mockChat, cfg: { model: 'mock' } });
  ok('分析 tree.root 存在', analysis && analysis.tree && analysis.tree.type === 'root');
  ok('分析出 2 章', analysis.stats.chapters === 2);
  ok('分析出知识点(point)', analysis.stats.points >= 3);
  ok('题型索引 5 类', analysis.questionIndex.length === 5);
  ok('每类题型含 items', analysis.questionIndex.every(q => q.items.length > 0));

  // 6) 落盘验证
  const aOnDisk = JSON.parse(fs.readFileSync(path.join(root, 'books', book.id, 'analysis.json'), 'utf8'));
  ok('analysis.json 落盘', aOnDisk && aOnDisk.tree && aOnDisk.tree.type === 'root');
  const bookMeta = JSON.parse(fs.readFileSync(path.join(root, 'books', book.id, 'book.json'), 'utf8'));
  ok('book.json 写入 analysisMeta', bookMeta.analysisMeta && bookMeta.analysisMeta.stats.chapters === 2);
  ok('原始文件落盘', fs.existsSync(path.join(root, 'books', book.id, 'files', mdRec.id + '__笔记.md')));

  // 7) getAnalysis 读取一致
  const got = core.getAnalysis(book.id);
  ok('getAnalysis 返回树', got && got.tree && got.tree.children.length === 2);

  // 8) 删除书
  ok('删除书成功', core.deleteBook(book.id) === true);
  ok('删除后无该书', core.getBook(book.id) === null);

  // 汇总
  let pass = 0, fail = 0;
  for (const [name, c] of results) {
    console.log((c ? '  ✓ ' : '  ✗ ') + name);
    c ? pass++ : fail++;
  }
  console.log('\n核心自测：' + pass + ' 通过 / ' + fail + ' 失败');
  fs.rmSync(root, { recursive: true, force: true });
  if (fail) process.exit(1);
}

run().catch(e => { console.error('自测异常：', e); process.exit(1); });
