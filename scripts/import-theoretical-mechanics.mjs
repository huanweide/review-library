// 理论力学 · 全量资料导入（雨课堂导出 → 复习资料图书馆 core 书）
//
// 资料形态（2026-11-22 实测）：
//   - 20 份课件 PDF + 5 份作业 PDF 全部是图片型（pdf-parse 文字层总计 1026 字符 ≈ 0）；
//   - 配套「原始图片/」36 个子目录 905 张 jpg（课件逐页，含两组重复导出）与
//     「原始图片_作业/」5 个子目录 27 张 jpg（作业逐页）。
//
// 导入策略：
//   - PDF 走 core.addFile（进资料列表；文字层为空是事实，语料由视觉转录补）；
//   - 页面图不走 addFile（否则 900+ 项撑爆资料列表），直接 imagesLib.ingest 进
//     images.json：按 sha256 去重、relPath 落 images/<id>.jpg、caption 带
//     「课件/作业名 + 页号」语义，供视觉转录、题→图关联与前端看图区共用。
//
// 用法：
//   node scripts/import-theoretical-mechanics.mjs            # scan：只统计，不写盘
//   node scripts/import-theoretical-mechanics.mjs --commit   # 真导入（建书 + PDF + 页图）
//   环境变量 YKT_SRC 可覆盖资料根目录。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const { Core } = require('../core/index.js');
const IMG = require('../core/images.js');

const SRC = process.env.YKT_SRC || 'C:/Users/Administrator/Desktop/agent program/雨课堂_理论力学';
const COMMIT = process.argv.includes('--commit');

const PDF_DIR = path.join(SRC, '课件PDF');
const HW_DIR = path.join(SRC, '作业题目PDF');
const IMG_DIRS = [path.join(SRC, '原始图片'), path.join(SRC, '原始图片_作业')];

function listJpgs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.jpe?g$/i.test(f)).sort()
    .map(f => ({ name: f, abs: path.join(dir, f) }));
}

// ---------- scan ----------
const groups = []; // { dir, tag, pages: [{ name, abs, buf }] }
for (const d of IMG_DIRS) {
  for (const sub of fs.readdirSync(d).sort()) {
    const abs = path.join(d, sub);
    if (!fs.statSync(abs).isDirectory()) continue;
    const jpgs = listJpgs(abs);
    groups.push({ dir: sub, tag: path.basename(d), pages: jpgs.map(j => ({ ...j, buf: fs.readFileSync(j.abs) })) });
  }
}
const bySha = new Map(); // sha -> [{ group, idx }]
let total = 0;
for (const g of groups) {
  g.pages.forEach((p, i) => {
    total++;
    const sha = IMG.sha(p.buf);
    p.sha = sha;
    if (!bySha.has(sha)) bySha.set(sha, []);
    bySha.get(sha).push({ group: g.dir, idx: i, tag: g.tag });
  });
}
const dupGroups = [...bySha.values()].filter(a => a.length > 1);
console.log('=== SCAN ===');
console.log('子目录数=' + groups.length + '  总图数=' + total + '  唯一 sha=' + bySha.size + '  多处出现=' + dupGroups.length);
if (dupGroups.length) {
  console.log('重复样例（前 3 组）：');
  dupGroups.slice(0, 3).forEach((a, i) => console.log('  #' + i + ' → ' + a.map(x => x.tag + '/' + x.group + '[' + x.idx + ']').join(' | ')));
}

const pdfs = [];
for (const [dir, kind] of [[PDF_DIR, '课件'], [HW_DIR, '作业']]) {
  for (const f of fs.readdirSync(dir).sort()) {
    if (f.endsWith('.pdf')) pdfs.push({ kind, name: f, abs: path.join(dir, f) });
  }
}
console.log('PDF 数=' + pdfs.length + '（课件 ' + pdfs.filter(p => p.kind === '课件').length + ' / 作业 ' + pdfs.filter(p => p.kind === '作业').length + '）');

if (!COMMIT) {
  console.log('（scan 模式，未写盘。--commit 执行导入）');
  process.exit(0);
}

// ---------- commit ----------
const core = new Core();
const book = core.createBook('理论力学', {
  description: '2026 秋季 · 雨课堂课件 20 讲 + 作业 5 次；资料为图片型 PDF，语料来自视觉模型逐页转录（2026-11-22 导入）',
});
console.log('bookId=' + book.id);

// PDF：进资料列表
for (const p of pdfs) {
  const buf = fs.readFileSync(p.abs);
  const rec = await core.addFile(book.id, buf, { name: p.name });
  console.log('  PDF +' + p.name + '  text=' + ((rec.imageStats && rec.imageStats.error) ? 'err:' + rec.imageStats.error : 'ok'));
}

// 页图：直进 images.json（不污染资料列表）
let added = 0, deduped = 0;
for (const g of groups) {
  for (const p of g.pages) {
    const pageNo = Number(p.name.match(/^0*(\d+)\./)[1]) || 0;
    const cap = (g.tag === '原始图片' ? '课件' : '作业') + '｜' + g.dir + '｜第 ' + pageNo + ' 页';
    // 2026-11-22 根修：meta 直传语义字段（ingest 已支持 page/caption/context，判别测试 G 组锁住）；
    // 旧写法事后改内存对象不落盘，导致 528 条 sources 的 page/caption/context 全空（已另行重建修复）。
    const r = IMG.ingest(core.store._bookDir(book.id), 'img-batch', g.dir + ' 第' + pageNo + '页', '.jpg', p.buf, {
      relPath: '', size: p.buf.length, page: pageNo, caption: cap, context: g.tag,
    });
    if (r.added) added += r.added; else if (r.deduped) deduped += r.deduped;
  }
}
IMG.saveIndex(core.store._bookDir(book.id), IMG.loadIndex(core.store._bookDir(book.id)));
console.log('=== COMMIT DONE ===');
console.log('bookId=' + book.id + '  PDF=' + pdfs.length + '  images added=' + added + ' deduped=' + deduped);
console.log('唯一主图数（primaryImages）=' + IMG.primaryImages(core.store._bookDir(book.id)).length);
