'use strict';
/**
 * 跨书「今日复习」队列 + 独立闪卡四档自评（v0.7）。
 *
 * 对齐基准（阶段零逐字锚点）：
 *  - Anki 官方 studying.html「how many cards are due today」/「Study Now」→ 先聚合到期再开始；
 *  - 「only the question is shown at first ... click the Show Answer button」→ 卡只给 prompt，答案由 UI 延迟揭示；
 *  - 「After the answer is shown ... Again / Hard / Good / Easy」「Each answer button shows the next time
 *    a card will be reviewed again」→ 自评必须立刻重排 dueAt，且不记成又一次真实交卷。
 *
 * 诚实边界：Anki 是 per-deck 学习，这里的「跨书」是我们针对多科目期末场景做的聚合，不是官方行为。
 * 卡内容来自已落盘的分析结果（cloze 挖空）与错题本，零模型、零联网、不编答案。
 */
const study = require('./study');
const cloze = require('./cloze');
const srs = require('./srs');

/**
 * 从分析结果里收齐「知识点」清单，供填充（drill）使用。
 * v1.5.1 的 analysis 实际只落 questionIndex（无 points 字段），这里兼容两种来源：
 *  - 若 analysis.points 存在直接用；
 *  - 否则从 questionIndex 展平 pointId + 标题，并取首题的题干/答案为复习素材。
 */
function collectPoints(analysis) {
  const pts = (analysis && analysis.points) || [];
  if (pts.length) return pts;
  const out = [];
  const seen = new Set();
  const qi = (analysis && analysis.questionIndex) || [];
  for (const grp of qi) {
    for (const item of (grp.items || [])) {
      const pid = item.pointId;
      if (!pid || seen.has(pid)) continue;
      const q = (item.questions && item.questions[0]) || null;
      seen.add(pid);
      out.push({
        id: pid,
        title: item.title || (q && q.stem) || pid,
        stem: q ? q.stem : '',
        summary: q ? (q.answer || q.stem || '') : (item.title || '')
      });
    }
  }
  return out;
}

function queueAcrossBooks(store, now, opts) {
  const t = Number(now) || Date.now();
  const limit = Math.max(1, Math.min(500, (opts && opts.limit) || 50));
  // 填充量：默认把队列补到 limit（做成「大量刷题」连续会话）；显式传 0 则只排到期卡。
  const fill = (opts && opts.fill != null)
    ? Math.max(0, Math.min(limit, opts.fill | 0))
    : Math.max(0, limit - 20);
  const books = (() => { try { return store.listBooks() || []; } catch (e) { return []; } })();
  const seen = new Set();
  const cards = [];
  const pushCard = (c) => {
    const k = c.bookId + '|' + c.pointId;
    if (seen.has(k)) return;
    seen.add(k); cards.push(c);
  };

  // 1) 到期卡优先（来自错题本，带真实 srs 状态，透明排程预览最准）。
  for (const b of books) {
    let recs = [];
    try { recs = store.getMistakes(b.id) || []; } catch (e) { /* 无错题本 */ }
    let analysis = null;
    try { analysis = store.getAnalysis(b.id) || {}; } catch (e) { /* 无分析结果 */ }
    const points = (analysis && analysis.points) || [];
    for (const r of recs) {
      if (!r || !r.pointId || !study.isDue(r, t)) continue;
      const p = points.find(x => x.id === r.pointId) ||
        { id: r.pointId, title: r.title || r.pointId, summary: '' };
      const c = cloze.makeCloze(p, {});
      pushCard({
        bookId: b.id, bookTitle: b.title || '', pointId: r.pointId,
        title: r.title || r.pointId,
        prompt: c ? c.masked : ('先回忆：' + (r.title || r.pointId) + ' 讲了什么？'),
        answer: c ? c.answer : (p.summary || r.title || r.pointId),
        hint: c ? c.hint : '',
        dueAt: study.srsDueDate(r, t), lapseCount: r.lapseCount || 0, box: r.box || 1,
        tag: 'due', next: srs.previewNext(r.srs || null, t)
      });
      if (cards.length >= limit) break;
    }
    if (cards.length >= limit) break;
  }

  // 2) 填充：到期不足时，从各书 questionIndex 取知识点补满，做成「大量刷题」连续会话。
  if (cards.length < limit && fill > 0) {
    const target = Math.min(limit, cards.length + fill);
    outer:
    for (const b of books) {
      let analysis = null;
      try { analysis = store.getAnalysis(b.id) || {}; } catch (e) { /* 无分析结果 */ }
      for (const p of collectPoints(analysis)) {
        pushCard({
          bookId: b.id, bookTitle: b.title || '', pointId: p.id,
          title: p.title || p.id,
          prompt: p.stem || ('先回忆：' + (p.title || p.id) + ' 讲了什么？'),
          answer: p.summary || p.title || p.id,
          hint: '',
          dueAt: 0, lapseCount: 0, box: 0,
          tag: 'drill', next: srs.previewNext(null, t)
        });
        if (cards.length >= target) break outer;
      }
    }
  }

  // 排序：到期优先，其次错次降序，再按到期时间升序。
  const rank = c => (c.tag === 'due' ? 0 : 1);
  cards.sort((a, b) => rank(a) - rank(b) || (b.lapseCount - a.lapseCount) || (a.dueAt - b.dueAt));
  return cards;
}

function rateCard(store, bookId, pointId, rating, now) {
  if (!bookId || !pointId) return { ok: false, reason: '缺少书或知识点' };
  const r = Math.max(1, Math.min(4, Math.round(Number(rating) || 3)));
  let analysis = null;
  try { analysis = store.getAnalysis(bookId) || {}; } catch (e) { /* 无分析结果 */ }
  const p = ((analysis && analysis.points) || []).find(x => x.id === pointId);
  let title = p && p.title;
  if (!title) {
    const rec = (() => { try { return (store.getMistakes(bookId) || []).find(x => x.pointId === pointId); } catch (e) { return null; } })();
    title = rec && rec.title;
  }
  // 排程统一由 store.ratePoint 落盘（跨进程锁 + 原子写），不在这里另写一套。
  const res = store.ratePoint(bookId, pointId, r, title || pointId);
  return Object.assign({ ok: true, rating: r, at: Number(now) || Date.now() }, res);
}

module.exports = { queueAcrossBooks, rateCard };
