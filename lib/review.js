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

function queueAcrossBooks(store, now, opts) {
  const t = Number(now) || Date.now();
  const limit = Math.max(1, Math.min(200, (opts && opts.limit) || 50));
  const books = (() => { try { return store.listBooks() || []; } catch (e) { return []; } })();
  const cards = [];
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
      cards.push({
        bookId: b.id, bookTitle: b.title || '', pointId: r.pointId,
        title: r.title || r.pointId,
        prompt: c ? c.masked : ('先回忆：' + (r.title || r.pointId) + ' 讲了什么？'),
        answer: c ? c.answer : (p.summary || r.title || r.pointId),
        hint: c ? c.hint : '',
        dueAt: study.srsDueDate(r, t), lapseCount: r.lapseCount || 0, box: r.box || 1
      });
      if (cards.length >= limit) break;
    }
    if (cards.length >= limit) break;
  }
  // 错得多的先来；同档的按到期时间从早到晚。
  cards.sort((a, b) => (b.lapseCount - a.lapseCount) || (a.dueAt - b.dueAt));
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
