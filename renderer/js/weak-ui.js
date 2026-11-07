'use strict';
// 薄弱地图（M1）：展示错题本累积的薄弱知识点，零云、跨会话持久。
// 数据来自 API.study.mistakes，后端已经按 lapse 聚合、leech 标记、排序好。
const WeakUI = (function () {
  const el = id => document.getElementById(id);

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function lastBadge(verdict) {
    if (verdict === '正确') return '<span class="weak-badge ok">最近正确</span>';
    if (verdict === '部分正确') return '<span class="weak-badge partial">最近部分正确</span>';
    return '<span class="weak-badge wrong">最近错误</span>';
  }

  function renderSummary(s) {
    const items = s.items || [];
    const total = items.length;
    const leech = s.leechCount || 0;
    const due = s.dueCount || 0;
    el('weak-summary').innerHTML =
      '<div class="weak-stat"><div class="weak-num">' + total + '</div><div class="weak-cap">跟踪知识点</div></div>' +
      '<div class="weak-stat"><div class="weak-num warn">' + leech + '</div><div class="weak-cap">leech（优先复习）</div></div>' +
      '<div class="weak-stat"><div class="weak-num due">' + due + '</div><div class="weak-cap">今日到期</div></div>' +
      '<div class="weak-tip">Leitner 盒子：答对升级拉长间隔，答错（含部分正确）重置到盒子 1 立刻重来；『今日到期』的知识点可在「练习」页一键生成今日复习卷。</div>';
  }

  function renderList(s) {
    const list = el('weak-list');
    const items = s.items || [];
    if (!items.length) {
      list.innerHTML = '<div class="weak-empty">还没有错题记录。去做几套题，批改后这里会自动累积你的薄弱点。</div>';
      return;
    }
    list.innerHTML = items.map(r => {
      const leechTag = r.leech ? '<span class="weak-badge leech">leech</span>' : '';
      const dueTag = r.due ? '<span class="weak-badge due">今日到期</span>' : '';
      const hist = (r.history || []).slice(-5).reverse().map(h => {
        const cls = h.verdict === '正确' ? 'ok' : h.verdict === '部分正确' ? 'partial' : 'wrong';
        return '<span class="weak-hist-item ' + cls + '">' + (h.verdict || '—') + '</span>';
      }).join('');
      const boxLabel = '盒子 ' + (r.box || 1);
      const dueLabel = r.due ? '<span class="weak-due now">今日到期</span>' : ('还有 ' + (r.dueInDays || 0) + ' 天');
      return '<div class="weak-card' + (r.leech ? ' is-leech' : '') + '">' +
        '<div class="weak-card-head"><span class="weak-title">' + escapeHtml(r.title) + '</span>' + leechTag + dueTag + lastBadge(r.lastResult) + '</div>' +
        '<div class="weak-meta">' + boxLabel + ' · ' + dueLabel + ' · lapse ' + (r.lapseCount || 0) + ' 次 · 答对 ' + (r.correctCount || 0) + ' 次 · 共 ' + (r.totalTries || 0) + ' 次</div>' +
        '<div class="weak-hist">近 5 次：' + (hist || '<span class="weak-hist-item">—</span>') + '</div>' +
        '</div>';
    }).join('');
  }

  async function enter(bookId) {
    if (!bookId) return;
    const list = el('weak-list');
    list.innerHTML = '<div class="weak-empty">加载中…</div>';
    try {
      const s = await API.study.mistakes(bookId);
      renderSummary(s);
      renderList(s);
    } catch (e) {
      list.innerHTML = '<div class="weak-empty err">加载薄弱地图失败：' + escapeHtml(e.message || e) + '</div>';
    }
  }

  return { enter };
})();
