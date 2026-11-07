'use strict';
/**
 * v0.6 竞品级能力的前端接线（全部纯本地 SVG / DOM，零外部库、零外链）：
 *   全局搜索 · 学习报告 · 知识点思维导图 · 挖空自测 · 四档自评 · 整库备份
 * 与 app.js 的全局视图、study-ui 的分析页、exam-ui 的批改结果、settings 的设置页配合。
 */
(function () {
  const $ = id => document.getElementById(id);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPE_LABEL = { book: '书', material: '资料', point: '知识点', question: '题目', mistake: '错题', exam: '试卷' };
  const RATES = [[1, '重来'], [2, '吃力'], [3, '会了'], [4, '太简单']];
  const bookId = () => (window.BookView && BookView.id) || (window.App && App.currentId);

  function lineChart(days) {
    const W = 640, H = 170, pad = 30;
    const list = (days || []).slice(-30);
    if (!list.length) return '<div class="extra-empty">这段时间还没有批改记录。</div>';
    const n = list.length;
    const x = i => pad + i * (W - 2 * pad) / Math.max(1, n - 1);
    const y = v => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * pad);
    const maxR = Math.max(1, ...list.map(d => d.reviews || 0));
    let bars = '', line = '', dots = '', grid = '';
    [0, 50, 100].forEach(v => {
      grid += '<line x1="' + pad + '" y1="' + y(v) + '" x2="' + (W - pad) + '" y2="' + y(v) + '" stroke="#e2e8f0" stroke-width="1"/>' +
        '<text x="4" y="' + (y(v) + 4) + '" font-size="10" fill="#94a3b8">' + v + '%</text>';
    });
    list.forEach((d, i) => {
      const bh = (d.reviews || 0) / maxR * (H - 2 * pad) * 0.45;
      bars += '<rect x="' + (x(i) - 3).toFixed(1) + '" y="' + (H - pad - bh).toFixed(1) +
        '" width="6" height="' + bh.toFixed(1) + '" fill="#c7d2fe" opacity="0.75"><title>' +
        E(d.date) + ' 复习 ' + (d.reviews || 0) + ' 次</title></rect>';
      line += (i ? ' L ' : 'M ') + x(i).toFixed(1) + ' ' + y(d.rate).toFixed(1);
      dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(d.rate).toFixed(1) + '" r="2.6" fill="#3a7afe"><title>' +
        E(d.date) + ' 正确率 ' + d.rate + '%</title></circle>';
    });
    return '<svg class="report-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="正确率趋势与每日复习量">' +
      grid + bars + '<path d="' + line + '" fill="none" stroke="#3a7afe" stroke-width="2"/>' + dots + '</svg>';
  }

  function graphSVG(g) {
    const nodes = (g && g.nodes) || [], edges = (g && g.edges) || [];
    if (!nodes.length) return '<div class="extra-empty">还没有知识点。先去「分析」页生成并保存分析结果。</div>';
    const cats = (g.categories && g.categories.length) ? g.categories : ['未分类'];
    const rowH = 120, W = 680, H = Math.max(200, cats.length * rowH + 40);
    const pos = {};
    cats.forEach((cat, ci) => {
      const list = nodes.filter(n => n.category === cat);
      list.forEach((n, i) => {
        pos[n.id] = { x: Math.round(70 + (i + 0.5) * (W - 140) / Math.max(1, list.length)), y: 62 + ci * rowH };
      });
    });
    let s = '<svg class="graph-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="知识点关系图">';
    cats.forEach((cat, ci) => {
      s += '<text x="12" y="' + (28 + ci * rowH) + '" font-size="11" fill="#64748b">' + E(cat) + '</text>' +
        '<line x1="12" y1="' + (34 + ci * rowH) + '" x2="' + (W - 12) + '" y2="' + (34 + ci * rowH) + '" stroke="#eef2f7"/>';
    });
    edges.forEach(e => {
      const a = pos[e.source], b = pos[e.target];
      if (!a || !b) return;
      const strong = e.kind === 'co-question';
      s += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y +
        '" stroke="' + (strong ? '#3a7afe' : '#cbd5e1') + '" stroke-width="' + (strong ? 2 : 1) +
        '" opacity="' + (strong ? 0.65 : 0.7) + '"><title>' + (strong ? '同一道题共同考到' : '同一类别') +
        ' · 关联强度 ' + e.weight + '</title></line>';
    });
    nodes.forEach((n, i) => {
      const p = pos[n.id]; if (!p) return;
      s += '<g><circle cx="' + p.x + '" cy="' + p.y + '" r="19" fill="#3a7afe" opacity="0.92"><title>' +
        E(n.title) + ' · ' + E(n.category) + ' · 关联 ' + n.questionCount + ' 题</title></circle>' +
        '<text x="' + p.x + '" y="' + (p.y + 4) + '" text-anchor="middle" font-size="11" fill="#fff">' + (i + 1) + '</text>' +
        '<text x="' + p.x + '" y="' + (p.y + 34) + '" text-anchor="middle" font-size="10" fill="#334155">' +
        E(String(n.title).slice(0, 9)) + '</text></g>';
    });
    return s + '</svg>';
  }

  const ExtraUI = {
    init() {
      const bind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
      bind('study-graph', () => this.toggleGraph());
      bind('study-cloze', () => this.toggleCloze());
      bind('set-export', () => this.exportBackup());
      bind('set-import', () => { const f = $('set-import-file'); if (f) f.click(); });
      const f = $('set-import-file');
      if (f) f.onchange = e => this.importBackup(e);
      const si = $('global-search');
      if (si) si.oninput = () => this.doSearch(si.value);
      const rb = $('report-book');
      if (rb) rb.onchange = () => this.loadReport(rb.value);
    },

    // ---------- 全局搜索 ----------
    enterSearch() { const si = $('global-search'); if (si) si.focus(); this.doSearch(si ? si.value : ''); },
    doSearch(q) {
      const list = $('global-search-list'), st = $('global-search-status');
      clearTimeout(this._timer);
      if (!q || !q.trim()) {
        if (list) list.innerHTML = '<div class="extra-empty">输入关键词开始搜索；会同时搜书名、资料正文、知识点、题目与错题。</div>';
        if (st) st.textContent = '';
        return;
      }
      this._timer = setTimeout(async () => {
        if (st) st.textContent = '搜索中…';
        let rows = [], err = '';
        try { rows = await API.extra.search(q.trim(), 80); } catch (e) { err = String(e && e.message || e); }
        if (st) st.textContent = err ? ('搜索失败：' + err) : ('命中 ' + rows.length + ' 条');
        if (!list) return;
        if (!rows.length) { list.innerHTML = '<div class="extra-empty">没有命中。换个关键词试试（支持资料正文里出现的词）。</div>'; return; }
        list.innerHTML = rows.map(r =>
          '<div class="search-hit" data-book="' + E(r.bookId) + '" data-type="' + E(r.type) + '">' +
          '<span class="hit-type">' + E(TYPE_LABEL[r.type] || r.type) + '</span>' +
          '<span class="hit-book">' + E(r.bookTitle) + '</span>' +
          '<span class="hit-loc">' + E(r.loc) + '</span>' +
          '<div class="hit-title">' + E(r.title) + '</div>' +
          '<div class="hit-snippet">' + E(r.snippet) + '</div></div>').join('');
        list.querySelectorAll('.search-hit').forEach(el => {
          el.onclick = async () => {
            if (!window.App) return;
            await App.openBook(el.dataset.book);
            const t = el.dataset.type;
            const pane = t === 'mistake' ? 'weak' : (t === 'exam' ? 'exam' : (t === 'material' ? 'materials' : 'study'));
            await App.showPane(pane);
          };
        });
      }, 220);
    },

    // ---------- 学习报告 ----------
    async enterReport() {
      const sel = $('report-book'); if (!sel) return;
      let books = [];
      try { books = await API.books.list(); } catch (e) { books = []; }
      const cur = bookId() || (books[0] && books[0].id);
      sel.innerHTML = books.length ? books.map(b => '<option value="' + E(b.id) + '"' +
        (b.id === cur ? ' selected' : '') + '>' + E(b.title) + '</option>').join('') : '<option value="">（还没有书）</option>';
      if (books.length) await this.loadReport(sel.value);
      else $('report-body').innerHTML = '<div class="extra-empty">还没有书，先去书架收录一本。</div>';
    },
    async loadReport(bid) {
      const box = $('report-body'); if (!box || !bid) { if (box) box.innerHTML = '<div class="extra-empty">请先收录一本书。</div>'; return; }
      let r = null, err = '';
      try { r = await API.extra.report(bid, 30); } catch (e) { err = String(e && e.message || e); }
      if (!r) { box.innerHTML = '<div class="extra-empty">报告读取失败：' + E(err) + '</div>'; return; }
      const weak = (r.weakTrend || []).slice(0, 6).map(w =>
        '<div class="report-weak"><b>' + E(w.title) + '</b><span>错 ' + w.lapseCount + ' 次 · 对 ' + w.correctCount +
        ' 次 · 最近 ' + E(w.lastResult || '—') + '</span></div>').join('') || '<div class="extra-empty">还没有错题记录。</div>';
      box.innerHTML =
        '<div class="report-cards">' +
        '<div class="report-card"><span>总体正确率</span><b>' + r.overallRate + '%</b></div>' +
        '<div class="report-card"><span>累计复习</span><b>' + r.totalReviews + '</b></div>' +
        '<div class="report-card"><span>已批改试卷</span><b>' + r.examCount + '</b></div>' +
        '<div class="report-card"><span>今日到期</span><b>' + r.dueCount + '</b></div>' +
        '</div>' +
        '<h4 class="report-h4">近 30 天正确率趋势 <small>（蓝线＝正确率，浅柱＝当天复习量）</small></h4>' +
        lineChart(r.days) +
        '<h4 class="report-h4">最需要盯的知识点</h4><div class="report-weak-list">' + weak + '</div>';
    },

    // ---------- 知识点思维导图 ----------
    async toggleGraph() {
      const box = $('graph-box'); if (!box) return;
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      const cb = $('cloze-box'); if (cb) cb.classList.add('hidden');
      box.innerHTML = '<div class="extra-empty">正在生成关系图…</div>';
      let g = null, err = '';
      try { g = await API.extra.graph(bookId()); } catch (e) { err = String(e && e.message || e); }
      if (!g) { box.innerHTML = '<div class="extra-empty">关系图读取失败：' + E(err) + '</div>'; return; }
      box.innerHTML = '<div class="extra-box-head"><b>知识点关系图</b><span>节点＝知识点；深色连线＝同一道题共同考到，浅色＝同一类别。悬停可看详情。</span></div>' +
        graphSVG(g) +
        '<div class="extra-box-foot">共 ' + g.nodes.length + ' 个知识点 · ' + g.edges.length + ' 条关系 · ' + g.categories.length + ' 类</div>';
    },

    // ---------- 挖空自测（主动回忆） ----------
    async toggleCloze() {
      const box = $('cloze-box'); if (!box) return;
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      const gb = $('graph-box'); if (gb) gb.classList.add('hidden');
      box.innerHTML = '<div class="extra-empty">正在从已保存的知识点生成挖空卡…</div>';
      let r = null, err = '';
      try { r = await API.extra.cloze(bookId()); } catch (e) { err = String(e && e.message || e); }
      const cards = (r && r.cards) || [];
      if (!cards.length) {
        box.innerHTML = '<div class="extra-empty">还没有可挖空的知识点：' + (err || '先分析并保存结果') + '</div>';
        return;
      }
      box.innerHTML = '<div class="extra-box-head"><b>挖空自测</b><span>先自己在心里答，再点「看答案」。答案全部来自你的资料原文，不会编。</span></div>' +
        cards.map((c, i) =>
          '<div class="cloze-card" data-i="' + i + '">' +
          '<div class="cloze-title">' + E(c.title || c.category) + (c.hint ? ' · ' + E(c.hint) : '') + '</div>' +
          '<div class="cloze-masked">' + E(c.masked) + '</div>' +
          '<div class="cloze-answer hidden">答案：<b>' + E(c.answer) + '</b></div>' +
          '<button class="btn ghost sm cloze-reveal" type="button">看答案</button></div>').join('');
      box.querySelectorAll('.cloze-reveal').forEach(btn => {
        btn.onclick = () => {
          const card = btn.closest('.cloze-card');
          const a = card.querySelector('.cloze-answer');
          const hidden = a.classList.toggle('hidden');
          btn.textContent = hidden ? '看答案' : '收起答案';
        };
      });
    },

    // ---------- 四档掌握度自评 ----------
    renderRatings(grading, examId, bid) {
      const box = $('exam-result'); if (!box || !grading || !grading.length) return;
      const old = $('rate-box'); if (old) old.remove();
      const wrap = document.createElement('div');
      wrap.id = 'rate-box';
      wrap.className = 'rate-box';
      wrap.innerHTML = '<div class="extra-box-head"><b>这道题你掌握得怎样？</b>' +
        '<span>四档自评决定该知识点下次什么时候复习；不评则按批改结果自动排。</span></div>' +
        grading.map(g =>
          '<div class="rate-row" data-qid="' + E(g.qid) + '">' +
          '<span class="rate-stem">' + E(String(g.stem).slice(0, 46)) + '</span>' +
          '<span class="rate-btns">' + RATES.map(([v, label]) =>
            '<button type="button" class="rate-btn" data-rate="' + v + '">' + label + '</button>').join('') +
          '</span></div>').join('') +
        '<div class="rate-foot"><button id="rate-save" class="btn primary sm" type="button">保存自评并重排复习</button>' +
        '<span id="rate-status" class="set-test-result"></span></div>';
      box.appendChild(wrap);
      const picked = {};
      wrap.querySelectorAll('.rate-btn').forEach(btn => {
        btn.onclick = () => {
          const row = btn.closest('.rate-row');
          row.querySelectorAll('.rate-btn').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          picked[row.dataset.qid] = Number(btn.dataset.rate);
        };
      });
      const save = $('rate-save');
      if (save) save.onclick = async () => {
        const st = $('rate-status');
        if (!Object.keys(picked).length) { st.textContent = '请至少给一道题选一档。'; return; }
        st.textContent = '保存中…';
        try {
          const r = await API.study.rate(bid, examId, picked);
          st.textContent = r && r.ok ? ('已记录 ' + Object.keys(picked).length + ' 题自评，下次复习时间已重排') :
            ('保存失败：' + ((r && r.reason) || '未知原因'));
        } catch (e) { st.textContent = '保存失败：' + String(e && e.message || e); }
      };
    },

    // ---------- 整库备份 ----------
    async exportBackup() {
      const st = $('backup-status'); if (st) st.textContent = '正在打包…';
      try {
        const r = await API.extra.backupExport();
        if (!r || !r.data) throw new Error('导出为空');
        const blob = new Blob([r.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '复习资料图书馆-备份-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        if (st) st.textContent = '备份已导出（' + Math.round(r.data.length / 1024) + ' KB）';
      } catch (e) { if (st) st.textContent = '导出失败：' + String(e && e.message || e); }
    },
    async importBackup(ev) {
      const st = $('backup-status');
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const yes = window.App ? await App.confirm('恢复备份会覆盖当前数据目录里的全部书（会先保留备份文件，操作不可撤销）。确定继续？', '覆盖恢复') : true;
      ev.target.value = '';
      if (!yes) { if (st) st.textContent = '已取消恢复。'; return; }
      if (st) st.textContent = '正在恢复…';
      try {
        const text = await file.text();
        const r = await API.extra.backupImport(text, 'replace');
        if (!r || !r.ok) throw new Error((r && r.error) || '恢复失败');
        if (st) st.textContent = '已恢复 ' + r.books + ' 本书、' + r.files + ' 个文件';
        if (window.Shelf) Shelf.render();
      } catch (e) { if (st) st.textContent = '恢复失败：' + String(e && e.message || e); }
    }
  };

  window.ExtraUI = ExtraUI;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ExtraUI.init());
  else ExtraUI.init();
})();
