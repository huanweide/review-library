'use strict';
/**
 * 学习报告（纯本地统计，零图表库、零外部请求）。
 * 数据来源全部是已落盘的 exams.grading 与 mistakes.history，不重新调模型、不猜。
 * 对齐基准：Anki Review Heatmap（FSRS4Anki README 兼容表逐字列出）、studyglen「Review Analytics」、
 *          中文竞品「题型正确率变化及薄弱词汇分布」。
 */
function dayKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function buildReport(store, bookId, now, opts) {
  const t = Number(now) || Date.now();
  const span = Math.max(1, Math.min(365, (opts && opts.days) || 30));
  const byDay = {};
  const ensure = (k) => (byDay[k] = byDay[k] || { date: k, total: 0, correct: 0, partial: 0, wrong: 0, reviews: 0 });
  let total = 0, correct = 0, partial = 0, wrong = 0;

  // ① 每次真实批改（按试卷创建时间归到当天）
  let exams = [];
  try { exams = store.listExams(bookId) || []; } catch (e) { /* 无试卷 */ }
  for (const meta of exams) {
    let ex = null;
    try { ex = store.getExam(bookId, meta.id); } catch (e) { continue; }
    if (!ex || !Array.isArray(ex.grading) || !ex.grading.length) continue;
    const d = ensure(dayKey(ex.createdAt || t));
    for (const g of ex.grading) {
      d.total++; total++;
      if (g.verdict === '正确') { d.correct++; correct++; }
      else if (g.verdict === '部分正确') { d.partial++; partial++; }
      else { d.wrong++; wrong++; }
      d.reviews++;
    }
  }

  // ② 错题本历史（补上没有保存 grading 的老数据）
  let mistakes = [];
  try { mistakes = store.getMistakes(bookId) || []; } catch (e) { /* 无错题本 */ }
  for (const r of mistakes) {
    for (const h of (r.history || [])) {
      const d = ensure(dayKey(h.at || t));
      d.reviews++;
    }
  }

  // 连续日期补齐（中间没学的天显示 0，趋势线才不会骗人）
  const days = [];
  const start = t - (span - 1) * 86400000;
  for (let i = 0; i < span; i++) {
    const k = dayKey(start + i * 86400000);
    const d = byDay[k] || { date: k, total: 0, correct: 0, partial: 0, wrong: 0, reviews: 0 };
    d.rate = d.total ? Math.round((d.correct / d.total) * 100) : 0;
    days.push(d);
  }

  // 薄弱点演化：最近一次结果 + 累计 lapse
  const weakTrend = mistakes.map(r => ({
    pointId: r.pointId, title: r.title || r.pointId,
    lapseCount: r.lapseCount || 0, correctCount: r.correctCount || 0,
    lastResult: r.lastResult || '', lastSeen: r.lastSeen || 0,
    dueAt: r.srs && r.srs.dueAt ? r.srs.dueAt : null
  })).sort((a, b) => b.lapseCount - a.lapseCount).slice(0, 12);

  return {
    days,
    overallRate: total ? Math.round((correct / total) * 100) : 0,
    totalReviews: days.reduce((n, d) => n + d.reviews, 0),
    total, correct, partial, wrong,
    examCount: exams.length,
    weakTrend,
    leechCount: weakTrend.filter(x => x.lapseCount >= 3).length,
    dueCount: weakTrend.filter(x => x.dueAt && x.dueAt <= t).length,
    heatmap: days.map(d => ({ date: d.date, value: d.reviews, rate: d.rate }))
  };
}

module.exports = { buildReport, dayKey };
