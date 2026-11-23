// 图题后处理：给「题干明确说看图、但 imageIds 为空」的题，按 source.file + source.page
// 从本书转录页图里确定性地补 id。2026-11-22。
//
// 为什么需要：主分析第二次重跑 900s 超时（服务端波动），而第一次成功的结果里
// 14 道题 imageIds 全空（当时提示词强制填 []）。题目自带 source.file/page，
// 语料每页带（图id=xxx），两者同源——不必再赌一次模型调用，直接按出处补。
//
// 严格边界（防「看图配错题」）：
//   - 只补题干含图意词（如图/下图/图中/图示/示意图/曲线图/直方图）的题；
//   - 只补 imageIds 为空的题，不覆盖模型已明确填的 id；
//   - 必须 source.file 的标题与页图来源标题一致、页码一致，才认这一张图；
//   - 匹配不到就留空并列入报告，绝不按相似度猜。
//
// 用法：node scripts/attach-source-images.mjs [--book <id>] [--dry]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require2 = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const BOOK = arg('book', '87763d2d14a660d0');
const DRY = process.argv.includes('--dry');
const IMG = require2(ROOT + '/core/images.js');

const bookDir = path.join(ROOT, 'library', 'books', BOOK);
const analysisPath = path.join(bookDir, 'analysis.json');
const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));

// source.file 形如 02_2026-08-31_1静力学公理.pdf → 标题 = 1静力学公理
function pdfTitle(file) {
  const base = String(file || '').replace(/\.pdf$/i, '');
  const p = base.split('_');
  return p.length >= 3 ? p.slice(2).join('_') : (p[p.length - 1] || '');
}
// 页图 fileName 形如 02_1静力学公理 第6页 → 标题 = 1静力学公理
function pageTitle(fileName) {
  const base = String(fileName || '').replace(/\s*第\d+页\s*$/, '');
  const p = base.split('_');
  return p.length >= 2 ? p.slice(1).join('_') : base;
}

const rows = IMG.orderedTranscribed(bookDir);
const byPage = new Map();
rows.forEach((r) => {
  const key = pageTitle(r.source.fileName) + '|' + Number(r.source.page);
  if (!byPage.has(key)) byPage.set(key, []);
  byPage.get(key).push(String(r.img.id));
});

// 图意词（2026-11-23 需求7）：补「受力图 / 受力分析图 / 画出…图 / 内力 / 机构图」——
// 旧正则漏了这些，导致「要求画出 AB 杆、AC 杆及整体的受力图」这类必看图的题被判成纯文字题。
const wantsImage = (q) => /如图|下图|图中|图示|示意图|曲线图|直方图|曲线|受力图|受力分析图|画.{0,8}图|内力图|机构图|结构图|简图/.test(String(q && q.stem || ''));
const report = [];
let filled = 0;

(analysis.questionIndex || []).forEach((g) => {
  (g.items || []).forEach((it) => {
    (it.questions || []).forEach((q) => {
      const ids = Array.isArray(q.imageIds) ? q.imageIds.map(String) : [];
      if (ids.length || !wantsImage(q)) return;
      const src = q.source || {};
      const key = pdfTitle(src.file) + '|' + Number(src.page);
      const candidates = byPage.get(key) || [];
      if (candidates.length !== 1) {
        report.push({ seq: q.seqNo, stem: String(q.stem).slice(0, 36), key, status: candidates.length ? '多图待人工' : '未找到同页图' });
        return;
      }
      q.imageIds = [candidates[0]];
      filled++;
      report.push({ seq: q.seqNo, stem: String(q.stem).slice(0, 36), key, imageId: candidates[0], status: 'ok' });
    });
  });
});

console.log('[attach] book=' + BOOK + ' 页图=' + rows.length + ' 空缺需图题=' + report.length + ' 已匹配=' + filled);
report.forEach((r) => console.log('  ' + JSON.stringify(r)));
if (DRY) { console.log('[attach] --dry：不写盘'); process.exit(0); }

if (filled) {
  const tmp = analysisPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(analysis, null, 2), 'utf8');
  fs.renameSync(tmp, analysisPath);
  console.log('[attach] 已写回 analysis.json（仅改 imageIds，不动题干/答案/统计）');
} else {
  console.log('[attach] 无可补项，未改文件');
}
