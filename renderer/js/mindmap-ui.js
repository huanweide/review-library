'use strict';
// 考纲思维导图视图（v0.8）：中心辐射 SVG + 侧栏无限嵌套 + 题型分类面板 + 双链跳转。
// 专用 class 前缀 mm-，绝不抢旧选择器。所有数据走 API.mindmap（四层镜像统一入口）。
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const escAttr = s => esc(s).replace(/"/g, '&quot;');
  const clip = (s, n) => { const t = String(s == null ? '' : s).trim(); return t.length > n ? (t.slice(0, n) + '…') : t; };

  function currentCfg() {
    try {
      const c = (window.Settings && Settings.cfg) ? Settings.cfg() : null;
      if (!c || !c.baseURL || !c.model) return null;
      const key = (window.Settings && Settings.getKey) ? Settings.getKey() : '';
      const envKey = (window.Settings && Settings._env && Settings._env.apiKey) || '';
      return { baseURL: c.baseURL, model: c.model, apiKey: key || envKey || '' };
    } catch (e) { return null; }
  }

  const MindmapUI = {
    bookId: null, maps: [], currentMapId: null,

    async enter(bookId) {
      this.bookId = bookId;
      this.bindOnce();
      await this.load();
    },

    bindOnce() {
      if (this._bound) return; this._bound = true;
      const sel = $('mm-map-select');
      sel.onchange = () => this.selectMap(sel.value);
      $('mm-gen-rule').onclick = () => this.generate(null);
      $('mm-gen-llm').onclick = () => this.generate(currentCfg());
    },

    async load() {
      let data;
      try { data = await API.mindmap.list(this.bookId); }
      catch (e) { $('mm-canvas').innerHTML = '<div class="empty">读取思维导图失败：' + esc(e.message || e) + '</div>'; return; }
      this.maps = (data && data.maps) || [];
      if (!this.maps.length) {
        $('mm-title').textContent = '思维导图';
        $('mm-canvas').innerHTML = '<div class="empty">这本书还没有思维导图。点右侧按钮：填了 API 就「用我的 API 生成详解」，没填就「规则版重建」（基于考纲.md + 题库.json 自动生成中心辐射图）。</div>';
        $('mm-hint').textContent = '';
        $('mm-detail').innerHTML = '';
        $('mm-questions').innerHTML = '';
        $('mm-map-select').innerHTML = '';
        return;
      }
      $('mm-map-select').innerHTML = this.maps.map(m => '<option value="' + escAttr(m.centerTitle) + '">' + esc(m.centerTitle) + '</option>').join('');
      this.selectMap(this.maps[0].centerTitle);
      this.renderQuestionPanel();
    },

    selectMap(centerTitle) {
      const m = this.maps.find(x => x.centerTitle === centerTitle);
      if (!m) return;
      this.currentMapId = m.id || m.centerTitle;
      const sel = $('mm-map-select'); if (sel.value !== centerTitle) sel.value = centerTitle;
      $('mm-title').textContent = '思维导图 · ' + m.centerTitle;
      const isLlm = m.source === 'llm';
      $('mm-hint').textContent = isLlm ? '（已用你的 API 生成详解/子类型，题型来自真实题库）' : '（规则版：来自考纲.md + 题库.json；填 API 可生成更详细的解释与子类型）';
      $('mm-canvas').innerHTML = this.radialSvg(m);
      const svg = $('mm-canvas').querySelector('svg');
      svg.querySelectorAll('.mm-node').forEach(c => {
        c.style.cursor = 'pointer';
        c.addEventListener('click', () => this.selectNode(c.getAttribute('data-title')));
      });
      this.selectNode(m.nodes && m.nodes[0] ? m.nodes[0].title : null);
    },

    radialSvg(map) {
      const W = 620, H = 440, cx = W / 2, cy = H / 2, R = 165;
      const nodes = map.nodes || [];
      const n = nodes.length || 1;
      let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mm-svg" xmlns="http://www.w3.org/2000/svg">';
      nodes.forEach((node, i) => {
        const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
        const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
        s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="mm-link"/>';
        s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="34" class="mm-node' + (node.key ? ' mm-key' : '') + '" data-title="' + escAttr(node.title) + '"><title>' + esc(node.title) + '</title></circle>';
        s += '<text x="' + x.toFixed(1) + '" y="' + (y + 5).toFixed(1) + '" class="mm-node-text" text-anchor="middle">' + esc(clip(node.title, 8)) + '</text>';
      });
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="52" class="mm-center"><title>' + esc(map.centerTitle) + '</title></circle>';
      s += '<text x="' + cx + '" y="' + (cy + 6) + '" class="mm-center-text" text-anchor="middle">' + esc(clip(map.centerTitle, 10)) + '</text>';
      s += '</svg>';
      return s;
    },

    selectNode(title, chain) {
      const map = this.maps.find(x => (x.id || x.centerTitle) === this.currentMapId);
      if (!map) return;
      const node = (map.nodes || []).find(n => n.title === title);
      if (!node) return;
      this.renderDetail(node, chain || []);
    },

    // 侧栏：无限嵌套（点子类型继续展开）+ 题型分类 + 双链跳转
    renderDetail(node, chain) {
      const box = $('mm-detail');
      let html = '';
      if (chain && chain.length) {
        html += '<div class="mm-crumb">' + chain.map(c => esc(clip(c, 10))).join(' › ') + '</div>';
      }
      html += '<div class="mm-d-title">' + esc(node.title) + (node.key ? ' <span class="mm-key-tag">重点</span>' : '') + '</div>';
      html += '<div class="mm-d-summary">' + (node.summary ? esc(node.summary) : '<span class="mm-muted">（规则版暂无详解，用你的 API 生成可得详细解释）</span>') + '</div>';

      if (node.children && node.children.length) {
        html += '<div class="mm-sub">子类型（点开继续展开）</div>';
        html += '<ul class="mm-children">';
        node.children.forEach(c => {
          html += '<li><button type="button" class="mm-child-btn" data-title="' + escAttr(c.title) + '">' + esc(c.title) + '</button></li>';
        });
        html += '</ul>';
      }

      if (node.questionTypes && node.questionTypes.length) {
        html += '<div class="mm-sub">题型分类</div>';
        node.questionTypes.forEach(qt => {
          html += '<div class="mm-qt"><b>' + esc(qt.typeLabel || qt.type) + '</b>' + (qt.single ? ' <span class="mm-single">单题</span>' : '') + '</div>';
          (qt.questions || []).forEach(q => {
            html += '<div class="mm-q"><button type="button" class="mm-q-btn" data-qid="' + escAttr(q.id) + '">' + esc(clip(q.stem, 40)) + '</button>' +
              '<div class="mm-q-ans hidden" data-for="' + escAttr(q.id) + '">答：' + esc(q.answer || '') + (q.explanation ? ('　解析：' + esc(q.explanation)) : '') + '</div></div>';
          });
        });
      }

      if (node.related && node.related.length) {
        html += '<div class="mm-sub">关联知识点（点击跳转）</div><ul class="mm-related">';
        node.related.forEach(r => { html += '<li><button type="button" class="mm-rel-btn" data-title="' + escAttr(r) + '">' + esc(r) + '</button></li>'; });
        html += '</ul>';
      }

      box.innerHTML = html;
      box.querySelectorAll('.mm-child-btn').forEach(b => b.onclick = () => {
        const child = this.findChild(node, b.getAttribute('data-title'));
        if (child) this.renderDetail(child, (chain || []).concat(node.title));
      });
      box.querySelectorAll('.mm-q-btn').forEach(b => b.onclick = () => {
        const ans = box.querySelector('.mm-q-ans[data-for="' + b.getAttribute('data-qid') + '"]');
        if (ans) ans.classList.toggle('hidden');
      });
      box.querySelectorAll('.mm-rel-btn').forEach(b => b.onclick = () => this.jumpToRelated(b.getAttribute('data-title')));
    },

    findChild(node, title) {
      return (node.children || []).find(c => c.title === title) || null;
    },

    jumpToRelated(title) {
      const hit = this.maps.find(m => (m.nodes || []).some(n => n.title === title));
      if (!hit) { $('mm-detail').insertAdjacentHTML('beforeend', '<div class="mm-muted">未找到关联知识点「' + esc(title) + '」</div>'); return; }
      this.selectMap(hit.centerTitle);
      this.selectNode(title);
    },

    // 右侧题目分类面板：汇集所有「单题题型」题，点开看具体题
    renderQuestionPanel() {
      const box = $('mm-questions');
      const items = [];
      this.maps.forEach(m => (m.nodes || []).forEach(n => (n.questionTypes || []).forEach(qt => {
        if (qt.single && (qt.questions || []).length) qt.questions.forEach(q => items.push({ map: m.centerTitle, type: qt.typeLabel || qt.type, q }));
      })));
      if (!items.length) { box.innerHTML = '<div class="mm-muted">（暂无「每类仅 1 题」的题型；多题题型在左侧节点卡片内查看）</div>'; return; }
      box.innerHTML = items.map((it, i) =>
        '<div class="mm-sq"><button type="button" class="mm-sq-btn" data-i="' + i + '">[' + esc(it.type) + '] ' + esc(clip(it.q.stem, 36)) + '</button>' +
        '<div class="mm-sq-ans hidden" data-i="' + i + '">答：' + esc(it.q.answer || '') + (it.q.explanation ? ('　解析：' + esc(it.q.explanation)) : '') + '</div></div>'
      ).join('');
      box.querySelectorAll('.mm-sq-btn').forEach(b => b.onclick = () => {
        const ans = box.querySelector('.mm-sq-ans[data-i="' + b.getAttribute('data-i') + '"]');
        if (ans) ans.classList.toggle('hidden');
      });
    },

    async generate(cfg) {
      const status = $('mm-gen-status');
      status.textContent = '生成中…';
      try {
        await API.mindmap.generate(this.bookId, cfg, true);
        status.textContent = cfg ? '已用 API 生成（详解/子类型来自 LLM）' : '已重建（规则版）';
        await this.load();
      } catch (e) {
        status.textContent = '生成失败：' + (e && e.message ? e.message : e);
      }
    }
  };

  window.MindmapUI = MindmapUI;
})();
