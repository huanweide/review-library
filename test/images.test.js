'use strict';
// 图片原样复现 · 判别测试（2026-11-20）
//
// 反假绿：全部用**真实样本文件**真解 zip、真取字节、真落盘。
// 样本：
//   PROCESS/ppt/考试复习包/最终考试包.pptx —— slide7 内嵌 2 张 PNG
//   library/books/b_801c90e933dc/files/...答案-正态分布侦探.docx —— 同样 2 张 PNG（图注在图片后一段）
// 因此能同时验：抽取、rId 映射、图注定位、跨格式 SHA 去重。
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const IMG = require('../core/images');

let passed = 0, failed = 0;
function ok(cond, msg, detail) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg + (detail ? ' | ' + detail : '')); }
}
function section(t) { console.log('\n--- ' + t + ' ---'); }
function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }

const PPTX = path.join(ROOT, 'PROCESS/ppt/考试复习包/最终考试包.pptx');
const DOCX = path.join(ROOT, 'library/books/b_801c90e933dc/files/685aa429a89d7266__答案-正态分布侦探.docx');

(async () => {
  section('A · 真样本抽取');
  if (!fs.existsSync(PPTX) || !fs.existsSync(DOCX)) {
    console.error('样本缺失，本轮判别无效：' + PPTX + ' / ' + DOCX);
    process.exit(2);
  }
  const pptBuf = fs.readFileSync(PPTX);
  const docBuf = fs.readFileSync(DOCX);
  const pptImgs = IMG.fromPptx(pptBuf);
  const docImgs = IMG.fromDocx(docBuf);
  ok(pptImgs.length === 2, 'A1 PPTX 真抽出 2 张内嵌图', '实得 ' + pptImgs.length);
  ok(docImgs.length === 2, 'A2 DOCX 真抽出 2 张内嵌图', '实得 ' + docImgs.length);
  ok(pptImgs.every((x) => x.data && x.data.length > 10000), 'A3 取到的是原图字节（非占位/非空）');
  ok(pptImgs.every((x) => x.pageType === 'slide' && x.page === 7), 'A4 定位到真实的第 7 页幻灯片');
  ok(docImgs.some((x) => /正态分布|3σ|sigma/i.test(x.caption)), 'A5 DOCX 图注取到「正态分布」相关文字',
    JSON.stringify(docImgs.map((x) => x.caption)));

  section('B · rId 映射正确性（不靠猜文件名顺序）');
  // 实测 slide7 rels: rId1→image1.png, rId2→image2.png
  ok(pptImgs[0] && pptImgs[0].part === 'ppt/slides/media/image1.png', 'B1 rId1 → image1.png',
    pptImgs[0] && pptImgs[0].part);
  ok(pptImgs[1] && pptImgs[1].part === 'ppt/slides/media/image2.png', 'B2 rId2 → image2.png',
    pptImgs[1] && pptImgs[1].part);
  const hashes = (arr) => arr.map((x) => IMG.sha(x.data)).sort();
  const ph = hashes(pptImgs), dh = hashes(docImgs);
  ok(ph.length === 2 && dh.length === 2 && ph[0] === dh[0] && ph[1] === dh[1],
    'B3 两个不同格式里是同一对原图（SHA 完全一致）');

  section('C · 落盘 + 跨格式去重（验收 2b：不重复几次）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'images-'));
  try {
    const r1 = IMG.ingest(tmp, 'f_ppt', '最终考试包.pptx', '.pptx', pptBuf);
    const r2 = IMG.ingest(tmp, 'f_doc', '答案-正态分布侦探.docx', '.docx', docBuf);
    ok(r1.added === 2 && r1.deduped === 0, 'C1 首次导入 2 张新图', JSON.stringify({ a: r1.added, d: r1.deduped }));
    ok(r2.added === 0 && r2.deduped === 2, 'C2 换格式导入同 2 张图 → 0 新增、2 去重',
      JSON.stringify({ a: r2.added, d: r2.deduped }));
    const idx = IMG.loadIndex(tmp);
    ok(idx.images.length === 2, 'C3 磁盘索引只有 2 条，不重复存图', '实得 ' + idx.images.length);
    ok(idx.images.every((img) => img.sources.length >= 2), 'C4 每张图保留 2 处出处（PPT 页 + Word 段）',
      JSON.stringify(idx.images.map((x) => x.sources.length)));
    const files = fs.readdirSync(path.join(tmp, 'images'));
    ok(files.length === 2, 'C5 images/ 目录只有 2 个原图文件', files.join(','));
    const reread = IMG.readImage(tmp, idx.images[0].id);
    ok(reread && IMG.sha(reread.data) === idx.images[0].sha256, 'C6 读回的字节与入库 SHA 一致（没被重编码）');

    section('D · 幂等 + 提示词清单');
    const r3 = IMG.ingest(tmp, 'f_ppt', '最终考试包.pptx', '.pptx', pptBuf);
    ok(r3.added === 0, 'D1 同一文件重复导入不新增图');
    const desc = IMG.describeForPrompt(tmp);
    ok(desc.length === 2 && /图1|图2/.test(desc[0]) && /id=/.test(desc[0]),
      'D2 提示词清单带图 id / 图注 / 出处，能喂给模型做「题→图」关联', desc[0]);
    ok(desc.some((x) => /另有 1 处相同原图/.test(x)), 'D3 清单明说同图多处出处，避免模型以为重复');
    const primary = IMG.primaryImages(tmp);
    const hashes = new Set(primary.map((x) => x.sha256));
    ok(primary.length === 2 && hashes.size === 2,
      'D4 同一 SHA 只留一份主图喂配对（不会在等价 id 间乱挑）',
      JSON.stringify(primary.map((x) => (x.sources[0] || {}).pageType)));
    // 有图注时必须优先选有图注的那份（概率统计书实测：正文图 vs 答题截图里的同图）
    const tmpCap = fs.mkdtempSync(path.join(os.tmpdir(), 'img-primary-'));
    try {
      IMG.ingest(tmpCap, 'f_doc', '答案.docx', '.docx', docBuf);
      IMG.ingest(tmpCap, 'f_png', '正态示意图.png', '.png', pptImgs[0].data, {
        relPath: 'files/f_png__正态示意图.png', size: pptImgs[0].data.length,
      });
      const picked = IMG.primaryImages(tmpCap).find((x) => x.sha256 === IMG.sha(pptImgs[0].data));
      ok(picked && (picked.sources[0] || {}).caption && picked.sources[0].pageType === 'paragraph',
        'D5 同图有图注（Word 正文）与无图注（独立 PNG）两份时，主图选有图注那份',
        JSON.stringify(picked && picked.sources[0]));
    } finally { cleanup(tmpCap); }
  } catch (e) {
    failed++;
    console.error('  ✗ 测试执行异常：' + (e && e.stack || e));
  } finally {
    cleanup(tmp);
  }

  section('E · 真 Core 导入链路（零迁移 / 不挡导入）');
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'images-core-'));
  try {
    const { Core } = require('../core');
    const core = new Core(tmp2);
    const book = core.createBook('图片回归书');
    const rec = await core.addFile(book.id, pptBuf, { name: '最终考试包.pptx' });
    ok(rec && rec.imageStats && rec.imageStats.added === 2, 'E1 addFile 返回抽图统计',
      JSON.stringify(rec && rec.imageStats));
    const imgs = core.getImages(book.id);
    ok(imgs && imgs.images.length === 2, 'E2 Core.getImages 返回 2 张内嵌原图');
    const hit = core.getImage(book.id, imgs.images[0].id);
    ok(hit && IMG.sha(hit.data) === imgs.images[0].sha256, 'E3 Core.getImage 取回原字节未变');
    const text = core.getBookText(book.id);
    ok(typeof text === 'string', 'E4 抽图不影响原文本链路');
  } catch (e) {
    failed++;
    console.error('  ✗ 测试执行异常(E)：' + (e && e.stack || e));
  } finally {
    cleanup(tmp2);
  }
  section('F · 题→图关联（提示词注入 + 假 id 拦截）');
  try {
    const A = require('../core/analyze');
    const msgs = A.buildMessages('正态图解', '正文文本', [{ name: '考纲.md' }], [
      '【图1｜id=abc12345】图注：正态分布3σ规则示意图；出处：PPT 第 7 页',
    ]);
    ok(msgs[0].content.includes('id=abc12345'), 'F1 提示词含真实图 id');
    ok(msgs[0].content.includes('imageIds'), 'F2 提示词明确要求题目输出 imageIds');
    const none = A.buildMessages('无图书', '正文文本', [{ name: 'a.md' }], []);
    ok(/imageIds 必须填 \[\]/.test(none[0].content), 'F3 无图时明确禁止编 id');
    const parsed = {
      outline: { title: '图解', children: [{ title: '第一章 分布', children: [
        { title: '1.1 正态', desc: '说明', children: [{ title: '3σ 规则', desc: '说明', children: [] }] },
      ] }] },
      questionIndex: [{ type: '选择题', items: [{ title: '图示判断', path: ['第一章 分布', '1.1 正态'],
        questions: [{ stem: '如图所示，阴影面积约为多少？', options: ['A. 68%'], answer: 'A', imageIds: ['abc12345', 'fake9999'] }] }] }],
    };
    const result = A.validate(parsed, { knownImageIds: new Set(['abc12345']) });
    const q = result.questionIndex[0].items[0].questions[0];
    ok(Array.isArray(q.imageIds) && q.imageIds.length === 1 && q.imageIds[0] === 'abc12345',
      'F4 假图 id 被拦截，只保留真抽取的 id', JSON.stringify(q.imageIds));
    const missing = A.validate(JSON.parse(JSON.stringify(parsed)), { knownImageIds: new Set() });
    ok(missing.questionIndex[0].items[0].questions[0].imageIds.length === 0,
      'F5 模型在无图时也编 id → 全部剥离，前端不会显示死图');
  } catch (e) {
    failed++;
    console.error('  ✗ 测试执行异常(F)：' + (e && e.stack || e));
  }

  section('G · 视觉理解（看懂图再配对，不靠图注猜）');
  try {
    const V = require('../core/image-vision');
    const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'img-vision-'));
    // 真图 + 假 chatFn：验证「图片字节真被送到模型 / 描述真写回索引 / 失败诚实 / 幂等」。
    // 不调真模型：真机看图已单独跑过（4/4 看懂），这里锁的是链路与边界。
    const seed = IMG.ingest(tmp3, 'f1', '考纲题库答案.docx', '.docx', docBuf);
    const rec = IMG.loadIndex(tmp3).images[0];
    let seen = null;
    const fakeChat = async (cfg, messages, opts) => {
      const parts = messages[1].content;
      seen = { hasText: parts.some(p => p.type === 'text'),
        imageUrl: (parts.find(p => p.type === 'image_url') || {}).image_url.url.slice(0, 30),
        maxTokens: opts.maxTokens };
      return JSON.stringify({ what: '正态分布的 3σ 区间示意图',
        details: 'μ±1σ 内 68.27%，μ±2σ 内 95.45%，μ±3σ 内 99.73%',
        forQuestions: '问各 σ 区间占比或异常值判定的题必须看它' });
    };
    const cfg = { baseURL: 'https://x.invalid/v1', apiKey: 'SECRET-DO-NOT-LEAK', model: 'fake-vision' };
    const st1 = await V.describeBook(tmp3, cfg, { chat: fakeChat });
    const after = IMG.loadIndex(tmp3).images[0];
    ok(st1.done >= 1 && after.vision && after.vision.status === 'ok' && /68\.27/.test(after.vision.details),
      'G1 视觉描述真写回 images.json（含图里看出的数值）', JSON.stringify(st1));
    ok(seen && seen.imageUrl.startsWith('data:image/png;base64,'), 'G2 原图字节真以 data URL 喂给模型', seen && seen.imageUrl);
    const written = fs.readFileSync(path.join(tmp3, 'images.json'), 'utf8');
    ok(!written.includes('SECRET-DO-NOT-LEAK'), 'G3 密钥不落盘（描述写库时 apiKey 不进文件）');
    const st2 = await V.describeBook(tmp3, cfg, { chat: fakeChat });
    ok(st2.skipped === st1.total && st2.done === 0, 'G4 幂等：已看过的图不重复烧 token', JSON.stringify(st2));
    const prompt = V.describeForPrompt(tmp3);
    ok(prompt.some(x => x.includes('此图已由视觉模型看过') && x.includes('3σ')),
      'G5 分析提示词改喂「图里真看到的」，并标记已视觉核对');
    // 失败诚实：chat 抛错时必须标 error，不能伪装成看懂
    const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), 'img-vision-fail-'));
    IMG.ingest(tmp4, 'f2', '考纲题库答案.docx', '.docx', docBuf);
    const st3 = await V.describeBook(tmp4, cfg, { chat: async () => { throw new Error('模型不支持图片'); } });
    const bad = IMG.loadIndex(tmp4).images[0].vision;
    ok(st3.failed >= 1 && bad && bad.ok === false && bad.status === 'error' && /不支持图片/.test(bad.error),
      'G6 看图失败诚实标 error，不编造图内容', JSON.stringify(st3));
    cleanup(tmp3); cleanup(tmp4);
  } catch (e) {
    failed++;
    console.error('  ✗ 测试执行异常(G)：' + (e && e.stack || e));
  }

  console.log('\n通过 ' + passed + ' / 失败 ' + failed);
  process.exit(failed ? 1 : 0);
})();
