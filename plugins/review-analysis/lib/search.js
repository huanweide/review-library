'use strict';
/**
 * 全局全文搜索（跨书 / 资料正文 / 知识点 / 题目 / 错题）。
 * 纯本地顺序扫描，零索引文件、零外部依赖；结果带上定位信息供前端跳转。
 * 对齐基准：SiYuan 47,119★ / Trilium 38,732★ / Logseq 45,507★ 的全局搜索。
 */
const LIMIT_DEFAULT = 80;

function snippet(text, q, radius) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ');
  const i = s.toLowerCase().indexOf(q);
  if (i < 0) return s.slice(0, (radius || 42) * 2);
  const r = radius || 42;
  return (i > r ? '…' : '') + s.slice(Math.max(0, i - r), Math.min(s.length, i + q.length + r)) + (i + q.length + r < s.length ? '…' : '');
}

function searchAll(store, query, opts) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return [];
  const limit = Math.max(1, Math.min(300, (opts && opts.limit) || LIMIT_DEFAULT));
  const out = [];
  const hit = (s) => String(s == null ? '' : s).toLowerCase().includes(q);
  const add = (type, book, id, title, text, loc) => {
    if (out.length >= limit) return;
    out.push({ type, bookId: book.id, bookTitle: book.title || '',
      id: id || '', title: String(title || '').slice(0, 120),
      snippet: snippet(text, q), loc: loc || '' });
  };

  const books = (() => { try { return store.listBooks() || []; } catch (e) { return []; } })();
  for (const b of books) {
    if (hit(b.title) || hit(b.exam) || hit(b.subject) || hit(b.note)) {
      add('book', b, b.id, b.title, [b.title, b.exam, b.subject, b.note].filter(Boolean).join(' · '), '书架');
    }

    // 资料：文件名 / 标签 / 提示词 / **正文 extractedText**
    let g = null;
    try { g = store.getBook(b.id); } catch (e) { /* 书目录损坏时跳过，不让搜索整体崩 */ }
    if (g) {
      for (const m of (g.materials || [])) {
        const body = String(m.extractedText || '');
        if (hit(m.name) || hit((m.tags || []).join(' ')) || hit(m.prompt) || hit(body)) {
          add('material', b, m.id, m.name, body || [m.name, (m.tags || []).join(' '), m.prompt].filter(Boolean).join(' · '),
            '第 ' + (m.layer || 1) + ' 层 · 资料');
        }
      }
    }

    // 分析结果：知识点 / 题目
    let a = null;
    try { a = store.getAnalysis(b.id); } catch (e) { /* 无分析结果 */ }
    if (a) {
      for (const p of (a.points || [])) {
        if (hit(p.title) || hit(p.summary) || hit(p.category)) {
          add('point', b, p.id, p.title, [p.category, p.summary].filter(Boolean).join(' · '), '分析 · 知识点');
        }
      }
      for (const qq of (a.questions || [])) {
        if (hit(qq.stem) || hit(qq.answer) || hit(qq.method) || hit(qq.explanation)) {
          add('question', b, qq.id, qq.stem, [qq.stem, qq.answer, qq.method].filter(Boolean).join(' · '), '分析 · 题目');
        }
      }
    }

    // 错题本：薄弱知识点
    let ms = [];
    try { ms = store.getMistakes(b.id) || []; } catch (e) { /* 无错题本 */ }
    for (const m of ms) {
      if (hit(m.title) || hit(m.pointId)) {
        add('mistake', b, m.pointId, m.title, [m.title, m.lastResult, m.cause].filter(Boolean).join(' · '), '薄弱地图');
      }
    }

    // 已保存试卷的题目（分析结果被覆盖后仍可搜到）
    let exams = [];
    try { exams = store.listExams(b.id) || []; } catch (e) { /* 无试卷 */ }
    for (const meta of exams) {
      let ex = null;
      try { ex = store.getExam(b.id, meta.id); } catch (e) { continue; }
      if (!ex) continue;
      for (const qq of (ex.questions || [])) {
        if (hit(qq.stem) || hit(qq.answer)) {
          add('exam', b, ex.id + '#' + qq.id, qq.stem, [qq.stem, qq.answer].filter(Boolean).join(' · '), '试卷 · 第 ' + ex.round + ' 轮');
        }
      }
    }

    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { searchAll, snippet, LIMIT_DEFAULT };
