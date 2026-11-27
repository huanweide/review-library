/**
 * 考点包（2026-11-27）：一份 HTML 同时当「考前打印件 / 可复用导出 / 人可读备份」。
 *
 * 为什么不做成新后端产物：三端（桌面/HTTP/DSH）都要能生成，纯前端吃现有
 * analysis + cards + structure + 原图 URL 就行，不必再开 action、不必重跑模型。
 * 结构用用户结构层叠加后的树，跟画布同源——改过的名字导出也要一样。
 *
 * 纯函数：无 DOM、无 localStorage；imageUrl(id) 由调用方注入。
 */
import { applyStructure, emptyLayer } from './structure-layer.mjs';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function flattenTree(node, depth, out) {
  if (!node) return out;
  out.push({ node, depth });
  (node.children || []).forEach((c) => flattenTree(c, depth + 1, out));
  return out;
}

/** 每点一句话考点：优先用 analysis 的 desc，截断到一句；没有就留空，不编。 */
function oneLine(desc) {
  const s = String(desc || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const cut = s.split(/(?<=[。；;！？!?])/)[0] || s;
  return cut.length > 110 ? cut.slice(0, 108) + '…' : cut;
}

function renderPoints(tree, layer) {
  const rows = flattenTree(applyStructure(tree, layer || emptyLayer()), 0, []);
  if (!rows.length) return '<p class="empty">这本书还没有分析结构。</p>';
  return rows.map(({ node, depth }) => {
    const tag = depth === 0 ? 'h2' : (depth === 1 ? 'h3' : 'h4');
    const line = oneLine(node.desc);
    return '<' + tag + ' class="d' + Math.min(depth, 3) + '">' + esc(node.title || '未命名')
      + (line ? '<span class="one">' + esc(line) + '</span>' : '') + '</' + tag + '>';
  }).join('\n');
}

function renderQuestions(cards, imageUrl) {
  const lessons = (cards && Array.isArray(cards.lessons)) ? cards.lessons : [];
  const groups = lessons.filter((L) => L && !L.error && Array.isArray(L.content));
  if (!groups.length) return '<p class="empty">这本书还没有题卡。</p>';
  return groups.map((L) => {
    const rows = [];
    (L.content || []).forEach((kp) => (kp.cards || []).forEach((c) => {
      if (c && c.stem) rows.push({ c, kp: (kp && kp.name) || '' });
    }));
    if (!rows.length) return '';
    const label = L.kind === 'assignment' ? '作业' : '讲次';
    return '<section class="group"><h3>' + esc(label) + ' · ' + esc(L.title || L.file || '')
      + '<span class="count">' + rows.length + ' 题</span></h3>'
      + rows.map(({ c, kp }, i) => {
        const figs = (Array.isArray(c.imageIds) ? c.imageIds : []).map((id) => {
          const url = typeof imageUrl === 'function' ? imageUrl(id) : '';
          return url ? '<figure><img src="' + esc(url) + '" alt="' + esc(kp + ' · 题目页原图') + '"><figcaption>'
            + esc(kp) + ' · 原图（来自资料，未经重绘）</figcaption></figure>' : '';
        }).join('');
        const steps = Array.isArray(c.solution) && c.solution.length
          ? '<ol>' + c.solution.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' : '';
        return '<article class="q"><div class="qh"><b>' + (i + 1) + '.</b> '
          + '<span class="type">' + esc(c.type || '题目') + '</span>'
          + '<span class="kp">' + esc(kp) + '</span>'
          + (c.needsReview ? '<span class="flag">需复核</span>' : '') + '</div>'
          + '<p class="stem">' + esc(c.stem) + '</p>' + figs
          + '<div class="ans"><b>答案</b><p>' + esc(c.answer || '（原卡没有答案）') + '</p></div>'
          + (steps ? '<div class="ans"><b>分步解答</b>' + steps + '</div>' : '')
          + (c.rationale ? '<div class="ans"><b>为什么这么想</b><p>' + esc(c.rationale) + '</p></div>' : '')
          + (c.pitfalls ? '<div class="ans warn"><b>最容易错</b><p>' + esc(c.pitfalls) + '</p></div>' : '')
          + '</article>';
      }).join('\n') + '</section>';
  }).join('\n');
}

export function buildExamPackHtml(opts) {
  const o = opts || {};
  const book = o.book || {};
  const title = String(book.title || '这本书');
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  return '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + ' · 考点包</title>'
    + '<style>'
    + ':root{--ink:#1b2434;--muted:#5f6b85;--line:#dfe6f1;--brand:#3457d5;--warn:#c07a16}'
    + '*{box-sizing:border-box}body{margin:0;background:#eef1f7;color:var(--ink);'
    + 'font:15px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}'
    + '.page{max-width:900px;margin:24px auto;background:#fff;padding:32px 40px;border-radius:12px;'
    + 'box-shadow:0 8px 30px rgba(20,32,60,.08)}'
    + 'header{border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:22px}'
    + 'h1{font-size:28px;margin:0 0 4px}h2{font-size:21px;margin:28px 0 10px;border-left:4px solid var(--brand);padding-left:10px}'
    + '.sub{color:var(--muted);font-size:13px}.one{display:block;font-size:13px;color:var(--muted);font-weight:400}'
    + 'h3.d3,h4.d4{font-size:14px;margin:8px 0 4px 12px;color:var(--ink)}h3.d2{font-size:16px;margin:14px 0 6px}'
    + '.group{margin:22px 0}.group>h3{font-size:18px;border-top:1px solid var(--line);padding-top:14px}'
    + '.count{font-size:12px;color:var(--muted);font-weight:400;margin-left:8px}'
    + '.q{border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0;break-inside:avoid}'
    + '.qh{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--muted)}'
    + '.type{color:var(--brand)}.flag{color:var(--warn)}.stem{margin:8px 0 6px}'
    + 'figure{margin:10px 0}figure img{max-width:100%;max-height:300px;display:block;border:1px solid var(--line)}'
    + 'figcaption{font-size:11px;color:var(--muted)}'
    + '.ans{margin-top:8px;font-size:13px}.ans b{color:var(--ink)}.ans p{margin:3px 0}'
    + '.ans.warn b{color:var(--warn)}.ans ol{margin:4px 0;padding-left:20px}'
    + '.empty{color:var(--muted)}.bar{position:sticky;top:0;background:#fff;padding:10px 0;text-align:right}'
    + '.bar button{padding:7px 14px;border:1px solid var(--brand);background:#fff;color:var(--brand);border-radius:6px;cursor:pointer}'
    + '@media print{body{background:#fff}.page{margin:0;padding:0;max-width:none;box-shadow:none}'
    + '.bar{display:none}figure img{max-height:220px}h2,h3{break-after:avoid}}'
    + '</style></head><body><div class="page">'
    + '<div class="bar"><button onclick="window.print()">打印这一份（或另存为 PDF）</button></div>'
    + '<header><h1>' + esc(title) + ' · 考点包</h1><p class="sub">生成于 ' + esc(stamp)
    + ' · 结构按你改过的顺序 · ' + esc(String((o.stats && o.stats.chapterCount) || ''))
    + ' 章 / ' + esc(String((o.stats && o.stats.pointCount) || ''))
    + ' 点 / ' + esc(String((o.stats && o.stats.cardCount) || '')) + ' 题</p></header>'
    + '<h2>一、知识结构（一页纸考点）</h2>' + renderPoints(o.analysis && o.analysis.tree, o.structure)
    + '<h2>二、原题卡（按讲次 / 作业）</h2>' + renderQuestions(o.cards, o.imageUrl)
    + '<p class="sub">说明：题图原样引用资料里的页面，未重绘；抽不到选项的题不给假选项，'
    + '在应用里走「自答 → 对照解析 → 四档自评」。标「需复核」的题原卡没有定论，请以教师批改为准。</p>'
    + '</div></body></html>\n';
}
