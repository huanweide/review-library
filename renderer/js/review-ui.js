'use strict';
/**
 * v0.7 跨书「今日复习」闪卡流。
 * 对齐 Anki 官方 studying.html：先看到「今天有多少张到期」，点开始后只显示问题，
 * 点 Show Answer 才揭示答案，揭示后给 Again/Hard/Good/Easy 四档自评，自评立刻重排下次复习时间。
 * 全部纯本地：卡内容来自已落盘的分析结果与错题本，零联网、零模型、不编答案。
 */
(function () {
  const $ = id => document.getElementById(id);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RATES = [[1, '重来'], [2, '吃力'], [3, '会了'], [4, '太简单']];

  const ReviewUI = {
    queue: [], done: 0, revealed: false,

    async enter() { await this.load(); },

    async load() {
      const box = $('review-body');
      if (box) box.innerHTML = '<div class="review-loading">正在汇总今天该复习的知识点…</div>';
      let cards = [], err = '';
      try { cards = await API.review.queue(50); } catch (e) { err = String(e && e.message || e); }
      this.queue = Array.isArray(cards) ? cards : [];
      this.done = 0; this.revealed = false;
      if (err) { const st = $('review-status'); if (st) st.textContent = '读取失败：' + err; }
      this.render();
    },

    render() {
      const box = $('review-body'), st = $('review-status');
      if (!box) return;
      const total = this.queue.length + this.done;
      if (st) st.textContent = '今天共 ' + total + ' 张到期卡 · 已完成 ' + this.done + ' 张';
      if (!this.queue.length) {
        box.innerHTML = '<div class="review-done"><h3>' + (total ? '今天的复习做完了' : '今天没有到期的知识点') + '</h3>' +
          '<p>' + (total ? '刚刚的自评已经写进本机，下次复习时间会自动排好。' :
            '先去做一套卷并批改，或到「挖空自测」里揭示答案后自评；产生记录后这里会自动排期。') + '</p>' +
          '<button id="review-reload" class="btn ghost" type="button">重新检查</button></div>';
        const b = $('review-reload'); if (b) b.onclick = () => this.load();
        return;
      }
      const c = this.queue[0];
      box.innerHTML =
        '<div class="review-card" data-pid="' + E(c.pointId) + '">' +
        '<div class="review-card-head"><span class="review-book">' + E(c.bookTitle) + '</span>' +
        '<span class="review-count">还剩 ' + this.queue.length + ' 张</span></div>' +
        '<div class="review-card-title">' + E(c.title) + (c.hint ? ' · ' + E(c.hint) : '') + '</div>' +
        '<div class="review-prompt">' + E(c.prompt) + '</div>' +
        '<div id="review-answer" class="review-answer hidden">答案：<b>' + E(c.answer) + '</b></div>' +
        '<button id="show-answer" class="btn primary" type="button">显示答案</button>' +
        '<div id="review-rates" class="review-rates hidden">' +
        '<span class="review-rate-tip">看完答案，这一下你想起来了吗？选一档，下次复习时间跟着变。</span>' +
        '<div class="review-rate-row">' + RATES.map(([v, label]) =>
          '<button type="button" class="rate-btn review-rate-btn" data-rate="' + v + '">' + label + '</button>').join('') + '</div>' +
        '<span id="review-rate-status" class="review-rate-status"></span></div>' +
        '</div>';
      const sa = $('show-answer');
      if (sa) sa.onclick = () => {
        $('review-answer').classList.remove('hidden');
        $('review-rates').classList.remove('hidden');
        sa.disabled = true; sa.textContent = '答案已显示';
        this.revealed = true;
      };
      box.querySelectorAll('.review-rate-btn').forEach(btn => {
        btn.onclick = () => this.rate(Number(btn.dataset.rate));
      });
    },

    async rate(v) {
      const c = this.queue[0]; if (!c) return;
      const st = $('review-rate-status'); if (st) st.textContent = '保存中…';
      try {
        const r = await API.review.rate(c.bookId, c.pointId, v);
        if (!r || !r.ok) throw new Error((r && r.reason) || '保存失败');
        this.queue.shift(); this.done++; this.revealed = false;
        this.render();
      } catch (e) { if (st) st.textContent = '保存失败：' + String(e && e.message || e); }
    }
  };

  window.ReviewUI = ReviewUI;
})();
