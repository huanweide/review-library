'use strict';
// 存量书补抽内嵌原图（2026-11-20）。
// 背景：图片抽取能力是后加的，老书导入时 images.json 不存在，但 files/ 里的
// PPTX / DOCX 原字节都还在。这里重跑一遍原样抽取，不重新导入、不重分析、不改 book.json。
//
// 用法：node tools/migrate-images.cjs [--dry-run] [--book <id>]
// 幂等：同一 (fileId, page, ordinal, part) 已存在就不重复登记；重复运行结果不变。
const fs = require('fs');
const path = require('path');
const os = require('os');
const IMG = require('../core/images');

const ROOT = path.resolve(__dirname, '..');
const BOOKS = path.join(ROOT, 'library', 'books');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const onlyIdx = argv.indexOf('--book');
const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : '';

function filesOf(bookDir) {
  const dir = path.join(bookDir, 'files');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

function main() {
  if (!fs.existsSync(BOOKS)) { console.error('没有 books 目录：' + BOOKS); process.exit(2); }
  const dirs = fs.readdirSync(BOOKS).filter((d) => {
    if (only && d !== only) return false;
    return fs.existsSync(path.join(BOOKS, d, 'book.json'));
  });
  let totalAdded = 0, totalDup = 0, totalBooks = 0;
  // dry-run 必须真 dry：写到临时目录，绝不碰真书库。
  const tmpRoot = DRY ? fs.mkdtempSync(path.join(os.tmpdir(), 'img-migrate-')) : '';
  for (const d of dirs) {
    const bookDir = path.join(BOOKS, d);
    const workDir = DRY ? path.join(tmpRoot, d) : bookDir;
    let book;
    try { book = JSON.parse(fs.readFileSync(path.join(bookDir, 'book.json'), 'utf8')); }
    catch (e) { continue; }
    let added = 0, deduped = 0;
    const names = filesOf(bookDir);
    for (const f of (book.files || [])) {
      const disk = names.find((n) => n.startsWith(String(f.id) + '__'));
      if (!disk) continue;
      const src = path.join(bookDir, 'files', disk);
      const buf = fs.readFileSync(src);
      let stats;
      if (/\.(pptx|docx)$/i.test(f.name || '') || /\.(pptx|docx)$/i.test(f.ext || '')) {
        stats = IMG.ingest(workDir, f.id, f.name || disk, f.ext || path.extname(f.name || ''), buf);
      } else if (IMG.extOf(f.ext || f.name) && /^\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(IMG.extOf(f.ext || f.name))) {
        stats = IMG.ingest(workDir, f.id, f.name || disk, f.ext || path.extname(f.name || ''), buf, {
          relPath: path.join('files', disk), size: f.size || buf.length,
        });
      } else continue;
      added += stats.added; deduped += stats.deduped;
    }
    if (added || deduped) {
      totalBooks++; totalAdded += added; totalDup += deduped;
      const idx = IMG.loadIndex(workDir);
      console.log((DRY ? '[dry] ' : '') + d + '  ' + (book.title || '') +
        '  新增 ' + added + ' / 去重 ' + deduped + ' / 合计 ' + idx.images.length + ' 张');
      idx.images.forEach((img, i) => {
        const s = (img.sources || [])[0] || {};
        console.log('   图' + (i + 1) + ' ' + img.id + ' ' + img.ext + ' ' + img.bytes + 'B  ' +
          (s.caption || s.context || '').slice(0, 70));
      });
    }
  }
  console.log('\n合计：' + totalBooks + ' 本书，新增 ' + totalAdded + ' 张，去重 ' + totalDup + ' 条出处' +
    (DRY ? '（dry-run，未落盘）' : ''));
  if (tmpRoot) { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {} }
}

main();
