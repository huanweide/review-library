'use strict';
// 视觉转录 · 判别测试（2026-11-22 · 理论力学全书拆解特化）
//
// 背景：理论力学 24 份 PDF 全是图片型（文字层≈0），语料只能来自视觉模型逐页转录。
// 本测试锁住四件事：
//   A. transcribeOne：单张图 → 纯文本转录写回 rec.transcript（不冒充 vision 描述域）
//   B. transcribeBook：并发批量 + 断点续跑（已有 ok 的跳过，不重复烧 token）+ 每张完成即落盘
//   C. getBookText：有转录的图按「来源文件 → 页号」排序拼进语料（【页N】锚点 + 图 id 内嵌）
//   D. collectImageIds：图 id 白名单从语料抽取（模型在语料里看到 id 才能填 imageIds）
//
// 全部用 mock chatFn（不真调 API）、临时目录真落盘。
const fs = require('fs');
const path = require('path');
const os = require('os');
const IMG = require('../core/images');
const vision = require('../core/image-vision');
const { Core } = require('../core/index');
const analyzeLib = require('../core/analyze');

let passed = 0, failed = 0;
function ok(cond, msg, detail) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg + (detail ? ' | ' + detail : '')); }
}
function section(t) { console.log('\n--- ' + t + ' ---'); }

// 造一张最小合法 jpg（1x1 像素即可，转录走 mock 不真看图）。
function tinyJpg() {
  return Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAn/' +
    'xAAVAQEBAAAAAAAAAAAAAAAAAAAABf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJgA/9k=', 'base64');
}

function emptyIdx() { return { version: 1, createdAt: new Date().toISOString(), images: [] }; }

function seedImages(bookDir, n) {
  fs.mkdirSync(path.join(bookDir, 'images'), { recursive: true });
  const idx = emptyIdx();
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = 'img' + i + 'abcdef';
    const rec = {
      id, ext: '.jpg', relPath: path.join('images', id + '.jpg'), sha256: 'sha' + i,
      bytes: tinyJpg().length,
      sources: [{ fileId: 'img-batch', fileName: '01_绪论 第' + (i + 1) + '页', part: '', pageType: 'file', page: i + 1, ordinal: 0, caption: '课件｜01_绪论｜第 ' + (i + 1) + ' 页', context: '原始图片' }],
    };
    fs.writeFileSync(path.join(bookDir, rec.relPath), tinyJpg());
    idx.images.push(rec);
    out.push(rec);
  }
  IMG.saveIndex(bookDir, idx);
  return out;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-'));
  try {
    const cfg = { baseURL: 'http://127.0.0.1:9', model: 'mock-vision', apiKey: 'sk-mock' };

    section('A · transcribeOne（mock chat，纯文本转录落 transcript 域）');
    seedImages(tmp, 3);
    const idx0 = IMG.loadIndex(tmp);
    const r1 = await vision.transcribeOne(tmp, idx0.images[0], cfg, {
      chat: async (c, messages, o) => {
        ok(Array.isArray(messages) && messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')), 'A1 消息里带 image_url（真把图喂给模型）');
        ok(/转录/.test(messages[0].content), 'A2 系统提示词是转录指令');
        return '【第 1 页】力 F 作用在 A 点，\\sum F=0。';
      },
    });
    ok(r1 && r1.ok === true && r1.status === 'ok', 'A3 transcribeOne 返回 ok', JSON.stringify(r1 && r1.status));
    ok(r1 && /sum F=0/.test(r1.transcript || ''), 'A4 转录文本进 transcript 域', r1 && r1.transcript);
    ok(r1 && r1.model === 'mock-vision', 'A5 记录了模型名');
    const afterA = IMG.loadIndex(tmp);
    ok(!afterA.images[0].transcript, 'A6 transcribeOne 不落盘（落盘由 transcribeBook 统一）');

    section('B · transcribeBook（并发 + 断点续跑 + 逐张落盘）');
    let peak = 0, inflight = 0, calls = 0;
    const chatB = async () => {
      calls++; inflight++; peak = Math.max(peak, inflight);
      await new Promise(r => setTimeout(r, 25));
      inflight--;
      return '第' + calls + '页转录文本，包含 \\vec v 与受力图说明。';
    };
    const statB = await vision.transcribeBook(tmp, cfg, { chat: chatB, concurrency: 2 });
    ok(statB.done === 3 && statB.failed === 0, 'B1 三张图全部转录成功', JSON.stringify(statB));
    ok(peak > 1 && peak <= 2, 'B2 并发上限被 concurrency=2 约束且真并发了', 'peak=' + peak);
    const idxB = IMG.loadIndex(tmp);
    ok(idxB.images.every(x => x.transcript && x.transcript.ok && /转录文本/.test(x.transcript.transcript)), 'B3 每张图的 transcript 已落盘 images.json',
      JSON.stringify(idxB.images.map(x => ({ has: !!x.transcript, ok: x.transcript && x.transcript.ok, head: ((x.transcript && x.transcript.transcript) || '').slice(0, 12) }))));
    ok(idxB.images.every(x => !x.vision), 'B4 转录不写 vision 域（描述域不被污染）');
    // 断点续跑：第二次全跳过
    let calls2 = 0;
    const chatB2 = async () => { calls2++; return '不该被调用'; };
    const statB2 = await vision.transcribeBook(tmp, cfg, { chat: chatB2, concurrency: 2 });
    ok(statB2.skipped === 3 && calls2 === 0, 'B5 已有 ok 转录的图第二次全跳过（不重复烧 token）', JSON.stringify(statB2) + ' calls=' + calls2);

    section('C · getBookText 混入转录语料');
    const core = new Core(tmp);
    const book = core.createBook('理论力学');
    fs.writeFileSync(path.join(tmp, 'books', book.id, 'files', 'deadbeef__讲义.txt'), '第一章 绪论\n静力学基本概念。');
    const rec = core.store.addFile(book.id, Buffer.from('第一章 绪论\n静力学基本概念。'), { name: '讲义.txt' });
    core.store.setFileText(book.id, rec.id, '第一章 绪论\n静力学基本概念。');
    // 把上面 3 张带转录的图并入这本书（手工合并 images.json）
    const srcIdx = IMG.loadIndex(tmp);
    const dstIdx = emptyIdx();
    dstIdx.images = srcIdx.images.map(x => Object.assign({}, x));
    IMG.saveIndex(core.store._bookDir(book.id), dstIdx);
    const text = core.getBookText(book.id);
    ok(text && /【文件：讲义\.txt】/.test(text), 'C1 原有文本文件语料不受影响');
    ok(/【文件：视觉转录·01_绪论】/.test(text), 'C2 转录按来源聚合为「视觉转录·<名>」段', text.slice(-400));
    ok(/【页1】/.test(text) && /【页3】/.test(text), 'C3 转录块带【页N】锚点（analyze 可引用）');
    ok(/（图id=img0abcdef）/.test(text), 'C4 转录块内嵌真实图 id（供 imageIds 引用）');
    const order = ['【页1】', '【页2】', '【页3】'].map(m => text.indexOf(m));
    ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), 'C5 转录按页号升序排列');
    ok(text.indexOf('【文件：讲义.txt】') < text.indexOf('【文件：视觉转录·'), 'C6 文本资料在前、视觉转录在后（原行为不破坏）');

    section('D · collectImageIds（语料抽图 id 白名单）');
    ok(typeof analyzeLib.collectImageIds === 'function', 'D1 collectImageIds 已导出');
    const ids = analyzeLib.collectImageIds('前文【页1】（图id=img0abcdef）正文\n【页2】（图id=img1abcdef）\n干扰 id=notanid 短id=ab（图id=img0abcdef 重复）');
    ok(Array.isArray(ids) && ids.includes('img0abcdef') && ids.includes('img1abcdef'), 'D2 语料里的图 id 全部收集', JSON.stringify(ids));
    ok(ids.length === 2, 'D3 重复 id 去重、无关格式不误收', JSON.stringify(ids));

    section('E · 白名单接管 imageIds（防编造闭环）');
    const parsed = { outline: { title: 't', children: [{ type: 'chapter', title: '第一章', children: [{ type: 'section', title: '1.1', children: [{ type: 'point', title: 'P1', desc: 'd', questionTypes: ['选择题'], children: [] }] }] }] }, questionIndex: [{ type: '选择题', items: [{ title: '概念辨析类', path: ['第一章', '1.1', 'P1'], questions: [{ stem: '如图受力分析正确的是', options: ['A. x'], answer: 'A. x —— 理由', solution: ['第 1 步：看图'], rationale: '依据图中约束方向判断，其他选项力的方向画错。', imageIds: ['img1abcdef', 'fake12345678'], source: { file: '讲义.txt', page: 1 } }] }] }], summary: 's' };
    const known = new Set(['img0abcdef', 'img1abcdef']);
    const v = analyzeLib.validate(parsed, { knownImageIds: known });
    const q = v.questionIndex[0].items[0].questions[0];
    ok(q.imageIds.length === 1 && q.imageIds[0] === 'img1abcdef', 'E1 白名单外的编造 id 被剥掉、真 id 保留', JSON.stringify(q.imageIds));

    section('F · composeCorpus 截断时空文件不占预算（图片型书场景）');
    const longF = '【文件：a.txt】\n' + '甲'.repeat(8000) + '\n\n【文件：b.txt】\n' + '乙'.repeat(8000) + '\n\n【文件：empty.pdf】\n';
    const rf = analyzeLib.composeCorpus(longF, 8000);
    ok(rf.truncated === true, 'F1 触发截断');
    const aKept = rf.coverage.find(c => c.file === 'a.txt');
    ok(aKept && aKept.keptChars >= 4000, 'F2 空文件不摊薄预算：长文件保留量 ≥ cap/有文本文件数', 'kept=' + (aKept && aKept.keptChars) + '（旧算法为 2666）');
    const emptyKept = rf.coverage.find(c => c.file === 'empty.pdf');
    ok(emptyKept && emptyKept.keptChars === 0, 'F3 空文件 kept=0（不虚报）');

    section('G · ingest 语义 meta（page/caption/context 进 sources，图片型书回溯的前提）');
    const gdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-meta-'));
    try {
      fs.mkdirSync(path.join(gdir, 'images'), { recursive: true });
      const rb = tinyJpg();
      const rm = IMG.ingest(gdir, 'img-batch', '15_12瞬心法 第17页', '.jpg', rb, {
        relPath: '', size: rb.length, page: 17, caption: '课件｜15_12瞬心法｜第 17 页', context: '原始图片',
      });
      const rrec = rm.records && rm.records[0];
      ok(rrec && rrec.sources[0].page === 17, 'G1 meta.page 写进 sources（不再写死 0）', JSON.stringify(rrec && rrec.sources[0]));
      ok(rrec && rrec.sources[0].caption === '课件｜15_12瞬心法｜第 17 页', 'G2 meta.caption 写进 sources');
      ok(rrec && rrec.sources[0].context === '原始图片', 'G3 meta.context 写进 sources');
      const rreload = IMG.loadIndex(gdir);
      ok(rreload.images[0].sources[0].page === 17, 'G4 落盘后读回不丢（修复内存改对象不落盘的旧坑）');
    } finally { try { fs.rmSync(gdir, { recursive: true, force: true }); } catch (e) {} }

    console.log('\n===== ' + passed + ' 通过 / ' + failed + ' 失败 =====');
    process.exit(failed ? 1 : 0);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 清理失败不遮断言 */ }
  }
})().catch(e => { console.error('测试崩溃：', e); process.exit(2); });
