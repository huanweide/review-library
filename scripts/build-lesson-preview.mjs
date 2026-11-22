// 题卡预览页生成器：cards/lesson-XX.json → preview/lesson-XX.html（单文件、双击即开）。
//
// 设计（2026-11-22 任务书）：
//   - 数据**预渲染成静态 DOM**：file:// 下 fetch 本地 JSON 会被浏览器拦，所以不拉数据，
//     生成器直接把题卡写进 HTML；折叠用原生 <details>，零 JS、零外链、零依赖。
//   - 图片相对路径 ../images/<id>.jpg（images/ 与 preview/ 同在书目录下），不重编码。
//   - 出处链接 file:///…/雨课堂_理论力学/<分类目录>/<pdf>#page=N（浏览器 PDF 查看器原生跳页）。
//   - quoteVerified=false 的引文不显示（只保留页码）；cards=[] 的知识点只出总结不留空卡区。
//
// 用法：node scripts/build-lesson-preview.mjs --lesson 12,16
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'C:/Users/Administrator/Desktop/agent program/雨课堂_理论力学';
const BOOK = '87763d2d14a660d0';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const LESSONS = String(arg('lesson') || '').split(',').map(Number).filter(Boolean);
if (!LESSONS.length) { console.error('缺少 --lesson 12,16'); process.exit(1); }

const bookDir = path.join(ROOT, 'library', 'books', BOOK);
const cardsDir = path.join(bookDir, 'cards');
const previewDir = path.join(bookDir, 'preview');
fs.mkdirSync(previewDir, { recursive: true });

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 出处 → file:/// 链接（空格与中文由 encodeURI 处理；#page=N 由浏览器 PDF 查看器原生跳页）
const pdfDirOf = (kind) => (kind === 'classroom' ? SRC + '/课堂题目PDF' : SRC + '/课件PDF');
function sourceHref(card) {
  const pdf = card.source && card.source.pdf;
  const page = Number(card.source && card.source.page) || 0;
  if (!pdf) return null;
  const abs = path.join(pdfDirOf(card.source.kind), pdf);
  return 'file:///' + encodeURI(abs.replace(/\\/g, '/')).replace(/#/g, '%23') + (page > 0 ? '#page=' + page : '');
}

const CSS = `
:root{--ink:#1f2d3d;--muted:#5b6b7c;--line:#e3e8ee;--brand:#2b6cb0;--card:#ffffff;--bg:#f5f7fa}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:14px 20px}
header .block{display:inline-block;background:var(--brand);color:#fff;font-size:12px;padding:2px 10px;border-radius:999px;margin-right:10px;vertical-align:middle}
header h1{display:inline;font-size:19px;margin:0;font-weight:700;vertical-align:middle}
header .count{float:right;color:var(--muted);font-size:13px;line-height:2.2}
main{max-width:900px;margin:0 auto;padding:18px 16px 60px}
section.kp{margin:26px 0 0}
section.kp>h2{font-size:17px;margin:0 0 8px;padding-left:10px;border-left:4px solid var(--brand)}
p.summary{margin:0 0 6px;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 16px}
article.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:14px 0;box-shadow:0 1px 2px rgba(16,36,64,.04)}
.badges{margin-bottom:8px}
.badges .type{display:inline-block;background:#eef4fb;color:var(--brand);border:1px solid #cfe0f3;font-size:12px;padding:1px 10px;border-radius:999px;margin-right:8px}
.badges .tag{display:inline-block;background:#f2f4f7;color:var(--muted);font-size:12px;padding:1px 10px;border-radius:999px}
.stem{white-space:pre-wrap}
.card img{display:block;max-width:820px;width:100%;height:auto;margin:10px 0 4px;border:1px solid var(--line);border-radius:8px}
details.ans{margin-top:10px;border-top:1px dashed var(--line);padding-top:8px}
details.ans>summary{cursor:pointer;color:var(--brand);font-size:14px;user-select:none;list-style:none}
details.ans>summary::-webkit-details-marker{display:none}
details.ans>summary::before{content:'▸ ';color:var(--muted)}
details.ans[open]>summary::before{content:'▾ '}
details.ans .answer{margin:8px 0 4px;padding:10px 12px;background:#f0f7f0;border:1px solid #d8e8d8;border-radius:8px}
details.ans ol.solution{margin:6px 0 2px;padding-left:22px;color:var(--muted)}
.src-row{margin-top:10px;text-align:right;font-size:13px;color:var(--muted)}
.src-row a{color:var(--brand);text-decoration:none}
.src-row a:hover{text-decoration:underline}
.src-row .verified{margin-left:10px;color:#2f7d33;font-size:12px}
footer{max-width:900px;margin:30px auto 0;color:var(--muted);font-size:12px;padding:0 16px}
`;

function cardHtml(c, lessonNo) {
  const badges = ['<span class="type">' + esc(c.type || '') + '</span>',
    c.tag ? '<span class="tag">' + esc(c.tag) + '</span>' : ''].join('');
  const imgs = (c.imageIds || []).map(id =>
    '<img src="../images/' + esc(id) + '.jpg" alt="题图（原图）" loading="lazy">').join('\n');
  const sol = (c.solution || []).length
    ? '<ol class="solution">' + c.solution.map(s => '<li>' + esc(s) + '</li>').join('') + '</ol>' : '';
  const href = sourceHref(c);
  const page = Number(c.source && c.source.page) || 0;
  const srcText = '第 ' + lessonNo + ' 讲 · 第 ' + (page || '—') + ' 页';
  const link = href ? '<a href="' + href + '" target="_blank" rel="noopener">' + esc(srcText) + ' ↗</a>' : esc(srcText);
  const verified = c.source && c.source.quoteVerified ? '<span class="verified">✓ 原文已核</span>' : '';
  return [
    '<article class="card">',
    '<div class="badges">' + badges + '</div>',
    '<div class="stem">' + esc(c.stem) + '</div>',
    imgs,
    '<details class="ans"><summary>查看答案</summary>',
    '<div class="answer">' + esc(c.answer) + '</div>',
    sol,
    '</details>',
    '<div class="src-row">' + link + verified + '</div>',
    '</article>',
  ].filter(Boolean).join('\n');
}

function lessonHtml(doc) {
  const lessonNo = doc.lessonNo || doc.lesson;
  const name = String(doc.title || '').replace(/^\d+/, '') || doc.title;
  const total = (doc.stats && doc.stats.cards) || doc.knowledgePoints.reduce((s, k) => s + k.cards.length, 0);
  // 知识点排序：有题卡的在前、无卡的在后（各自保持模型给出的相对顺序）——
  // 首屏必须能同时看到总结与带图题卡（验收：一屏内四要素齐）；无卡知识点照常出总结。
  const ordered = doc.knowledgePoints.map((kp, i) => ({ kp, i }))
    .sort((a, b) => (b.kp.cards.length > 0 ? 1 : 0) - (a.kp.cards.length > 0 ? 1 : 0) || a.i - b.i)
    .map(x => x.kp);
  const sections = ordered.map((kp) => {
    const parts = [
      '<section class="kp">',
      '<h2>' + esc(kp.name) + '</h2>',
      kp.summary ? '<p class="summary">' + esc(kp.summary) + '</p>' : '',
      kp.cards.length ? kp.cards.map(c => cardHtml(c, lessonNo)).join('\n') : '',
      '</section>',
    ];
    return parts.filter(Boolean).join('\n');
  }).join('\n');
  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>理论力学 · 第 ' + lessonNo + ' 讲 · 题卡</title>',
    '<style>' + CSS + '</style>',
    '</head><body>',
    '<header><span class="block">' + esc(doc.block || '') + '</span>',
    '<h1>第 ' + lessonNo + ' 讲 · ' + esc(name) + '</h1>',
    '<span class="count">' + total + ' 题 · ' + doc.knowledgePoints.length + ' 个知识点</span></header>',
    '<main>' + sections + '</main>',
    '<footer>题卡来自「复习资料图书馆」逐讲拆解（cards/lesson-' + esc(doc.lesson) + '.json）；题图一律为课件/课堂题原图，未重绘。</footer>',
    '</body></html>',
  ].join('\n');
}

for (const n of LESSONS) {
  // 题卡产物统一用两位补零（lesson-01.json…），但命令行常写 --lesson 1。
  // 旧代码直接拼 n，前 9 讲全部找不到、静默跳过——补零并兼容老命名。
  const pad = String(n).padStart(2, '0');
  let f = path.join(cardsDir, 'lesson-' + pad + '.json');
  if (!fs.existsSync(f)) f = path.join(cardsDir, 'lesson-' + n + '.json');
  if (!fs.existsSync(f)) { console.error('lesson-' + pad + '.json 不存在，跳过'); continue; }
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  const html = lessonHtml(doc);
  const out = path.join(previewDir, 'lesson-' + pad + '.html');
  const tmp = out + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, html, 'utf8');
  fs.renameSync(tmp, out);
  const cards = doc.knowledgePoints.reduce((s, k) => s + k.cards.length, 0);
  console.log('DONE lesson ' + n + ': ' + out + '（' + cards + ' 题 / ' + doc.knowledgePoints.length + ' 知识点）');
}
