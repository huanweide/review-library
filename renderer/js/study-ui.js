'use strict';
// 分析工作台：材料边界 → 分析 → 结果审阅 → 保存 / 生成试卷。
// 融合 ko-lesson：先列纳入/排除清单；结果按「来源依据 / AI补充」双色标注；审阅后才落库。
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const TYPE_LABEL = { single: '单选', multiple: '多选', explain: '概念解释', case: '综合应用', fill: '填空', judge: '判断', essay: '简答', calc: '计算', gap: '待补充题型' };

  // B/C：把 method 渲染成「解题教练」结构——Col 三栏（动机/操作/结果）+ 探路/验算步骤块。
  function renderMethod(q) {
    const m = String((q && q.method) || '').trim();
    if (!m) return '';
    const mot = m.match(/【动机】([\s\S]*?)(?=【操作】|$)/);
    const opr = m.match(/【操作】([\s\S]*?)(?=【结果】|$)/);
    const res = m.match(/【结果】([\s\S]*?)$/);
    let inner = '';
    if (mot && opr && res) {
      inner = '<div class="q-method-col">' +
        '<div class="qm-cell"><div class="qm-h">动机</div><div class="qm-b">' + esc(mot[1].trim()) + '</div></div>' +
        '<div class="qm-cell"><div class="qm-h">操作</div><div class="qm-b">' + esc(opr[1].trim()) + '</div></div>' +
        '<div class="qm-cell"><div class="qm-h">结果</div><div class="qm-b">' + esc(res[1].trim()) + '</div></div>' +
        '</div>';
    } else {
      const steps = m.split(/(?=探路：|验算：|核对：|题型抽象：)/).map(s => s.trim()).filter(Boolean);
      if (steps.length > 1) {
        inner = '<div class="q-method-steps">' + steps.map(s => {
          const mm = s.match(/^(\S+：)([\s\S]*)$/);
          if (mm) return '<div class="q-method-step"><span class="qms-h">' + esc(mm[1]) + '</span><span class="qms-b">' + esc(mm[2].trim()) + '</span></div>';
          return '<div class="q-method-step">' + esc(s) + '</div>';
        }).join('') + '</div>';
      } else {
        inner = '<div class="q-method-text">' + esc(m) + '</div>';
      }
    }
    const hasVerify = /验算|核对|代入/.test(m);
    return '<div class="q-method' + (hasVerify ? ' q-method-verify' : '') + '"><b>解题方法策略：</b>' + inner + '</div>';
  }

  const StudyUI = {
    bookId: null, materials: [], selected: [], analysis: null,

    async enter(bookId) {
      this.bookId = bookId;
      const b = await API.books.get(bookId);
      this.materials = (b && b.materials) || [];
      this.selected = this.materials.map(m => m.id);
      const c = Settings.load();
      $('study-prompt').value = c.prompt || '';
      this.renderBoundary();
      const state = await API.study.state(bookId);
      if (state && state.analysis) { this.analysis = state.analysis; this.renderResult(); }
      else { this.analysis = null; $('study-result').innerHTML = ''; $('study-actions').classList.add('hidden'); $('study-status').textContent = '尚未分析。选好材料后点「开始分析」。'; }
      this._bindTools();
    },

    _bindTools() {
      if (this._bound) return; this._bound = true;
      const maskBtn = $('study-mask');
      if (maskBtn) maskBtn.onclick = () => {
        const r = $('study-result'); if (!r) return;
        const on = r.classList.toggle('masked');
        maskBtn.textContent = on ? '显示答案' : '遮蔽答案（无答案模式）';
        maskBtn.classList.toggle('active', on);
      };
      const res = $('study-result');
      if (res) res.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.q-peek');
        if (!btn) return;
        const card = btn.closest('.q-item'); if (!card) return;
        const rev = card.classList.toggle('revealed');
        btn.textContent = rev ? '遮蔽' : '看答案';
      });
    },

    renderBoundary() {
      const el = $('bd-list'); el.innerHTML = '';
      if (!this.materials.length) { el.innerHTML = '<div class="empty">这本书还没有资料，先去「资料」页添加。</div>'; return; }
      const byLayer = {};
      this.materials.forEach(m => { (byLayer[m.layer] = byLayer[m.layer] || []).push(m); });
      Object.keys(byLayer).sort((a, b) => a - b).forEach(layer => {
        const h = document.createElement('div'); h.className = 'bd-layer';
        h.textContent = '第 ' + layer + ' 层' + (layer === '1' ? '（核心，权重最高）' : '');
        el.appendChild(h);
        byLayer[layer].forEach(m => {
          const row = document.createElement('label'); row.className = 'bd-row';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = this.selected.includes(m.id);
          cb.onchange = () => {
            this.selected = cb.checked ? this.selected.concat([m.id]) : this.selected.filter(x => x !== m.id);
            this.renderBoundaryStatus();
          };
          const txt = document.createElement('span');
          txt.innerHTML = '<b>' + esc(m.name) + '</b><small>' + esc(m.ext || '') + ' · ' +
            (m.layer === 1 ? '划定考试范围' : m.layer === 2 ? '作业 / 认题型' : '补充材料') + '</small>';
          row.appendChild(cb); row.appendChild(txt); el.appendChild(row);
        });
      });
      this.renderBoundaryStatus();
    },

    renderBoundaryStatus() {
      const excluded = this.materials.length - this.selected.length;
      $('study-run-status').textContent = '纳入 ' + this.selected.length + ' 份 · 排除 ' + excluded + ' 份（排除的不会被读取）';
    },

    async run() {
      if (!this.selected.length) { $('study-status').textContent = '至少勾选一份资料。'; return; }
      const c = Settings.load();
      const opts = {
        engine: c.engine, selectedIds: this.selected.slice(),
        prompt: $('study-prompt').value.trim(), pointCount: c.pointCount, questionCount: c.questionCount,
        dedupeThreshold: c.dedupeThreshold
      };
      // 本地引擎根本不把密钥发到后端，减少一次无谓暴露
      const cfg = c.engine === 'llm' ? Settings.cfg() : {};
      $('study-run').disabled = true;
      $('study-status').textContent = c.engine === 'llm' ? '正在调用你填的模型分析…（资料会发往该地址）' : '正在本地抽取…（不联网）';
      let r;
      try { r = await API.study.analyze(this.bookId, opts, cfg); }
      catch (e) { r = { ok: false, reason: e.message }; }
      $('study-run').disabled = false;
      if (!r || !r.ok) {
        $('study-status').textContent = '分析失败：' + ((r && r.reason) || '未知原因');
        $('study-status').className = 'study-status err';
        return;
      }
      this.analysis = r;
      $('study-status').className = 'study-status ok';
      this.renderResult();
    },

    // 质量报告：把去重 / 校验 / 重试 / 降级全过程摊开给用户看，不做黑盒。
    // 依据 self-healing-rag「the reasoning is visible, not a black box」与「返回重复对、不静默删」。
    qualityHTML(q0) {
      if (!q0) return '';
      const d = q0.dedupe || {}, v = q0.validation || {}, r = q0.retry || {};
      const stopMap = {
        accepted_first_pass: '首次生成即通过校验',
        accepted_on_retry: '第 1 次未通过，按校验意见重试 1 次后通过',
        budget_exhausted_degraded: '重试 1 次仍未通过，已诚实降级',
        local_no_retry: '本地生成，离线零重试'
      };
      const stop = stopMap[r.stopReason] || r.stopReason || '—';
      const removed = d.removed || [];
      const exact = removed.filter(x => x.kind === 'exact').length;
      const near = removed.filter(x => x.kind === 'near').length;
      let h = '<div class="quality-card' + (q0.degraded ? ' degraded' : '') + '">' +
        '<div class="quality-head"><b>生成质量报告</b><span class="quality-badge ' + (q0.degraded ? 'warn' : 'ok') + '">' +
        (q0.degraded ? '已降级' : '校验通过') + '</span></div>' +
        '<div class="quality-grid">' +
        '<div class="quality-cell"><span>去重</span><b>阈值 ' + esc(d.threshold) + ' · ' + esc(d.before) + ' → ' + esc(d.after) + ' 道</b>' +
        '<small>合并 ' + esc(d.removedCount) + ' 道（完全相同 ' + exact + ' / 近似 ' + near + '）</small></div>' +
        '<div class="quality-cell"><span>本地校验</span><b>' + (v.ok ? '通过' : '未通过 · ' + esc(v.issueCount) + ' 项') + '</b>' +
        '<small>检查 ' + esc(v.checked) + ' 项，得分 ' + esc(v.score == null ? '—' : v.score) + '</small></div>' +
        '<div class="quality-cell"><span>生成轮次</span><b>' + esc(r.attempts) + ' 次' + (r.retried ? '（含 1 次重试）' : '') + '</b>' +
        '<small>' + esc(stop) + '</small></div></div>';
      if (q0.degraded) {
        h += '<div class="quality-warn">云端结果没通过本地校验，重试预算已用完。相关题目已剥除未核验的来源、强制标为 AI补充。系统没有替你猜答案，请逐题审阅后再保存。</div>';
      }
      const hist = v.history || [];
      if (hist.length) {
        h += '<details class="quality-details"><summary>查看每一步校验与重试（' + hist.length + ' 步）</summary><div class="quality-trace">';
        hist.forEach((x, i) => {
          const failedParse = x.stage === 'parse';
          h += '<div class="quality-trace-row"><b>第 ' + (i + 1) + ' 次 · ' + (failedParse ? '解析' : '校验') + '</b>' +
            '<span class="' + (x.ok ? 'ok' : 'bad') + '">' +
            (x.ok ? '通过' : (failedParse ? '解析失败：' + esc(x.reason || '') : '未通过 · ' + esc(x.issueCount) + ' 项')) + '</span></div>';
          (x.issues || []).slice(0, 4).forEach(is => { h += '<div class="quality-issue">' + esc(is.code) + ' · ' + esc(is.evidence) + '</div>'; });
        });
        h += '</div></details>';
      }
      if (removed.length) {
        h += '<details class="quality-details"><summary>查看被合并的题（' + removed.length + ' 道，原件保留不删除）</summary>';
        removed.slice(0, 10).forEach(x => {
          h += '<div class="quality-dup"><span class="quality-dup-kind">' +
            (x.kind === 'exact' ? '完全相同' : '近似 ' + esc(x.score)) + '</span>' + esc(x.stem) + '</div>';
        });
        h += '</details>';
      }
      return h + '</div>';
    },

    // M3：把知识点/题目关联的原始图（来自分析时传进视觉模型的同一批图）渲染成缩略图网格。
    assetImgsHtml(refs, assetIndex) {
      if (!refs || !refs.length || !assetIndex) return '';
      const items = refs.filter(id => assetIndex[id]).map(id => {
        const info = assetIndex[id];
        const loc = info.slide ? '第' + info.slide + '页' : (info.page ? '第' + info.page + '页' : '');
        return '<figure class="asset-thumb"><img data-aid="' + esc(id) + '" alt="' + esc((info.name || '图') + ' ' + loc) + '">' +
          '<figcaption>' + esc((info.name || '图') + (loc ? ' · ' + loc : '')) + '</figcaption></figure>';
      });
      return items.length ? '<div class="q-imgs">' + items.join('') + '</div>' : '';
    },

    originTag(o, src) {
      if (o === 'source' && src) {
        return '<span class="tag-source">来源依据</span><span class="src-detail">' +
          esc(src.file || '') + ' · ' + esc(src.loc || '') + ' · ' + esc(src.usage || '') + '</span>';
      }
      return '<span class="tag-ai">AI补充</span><span class="src-detail">材料未直接覆盖，非原文</span>';
    },

    renderResult() {
      const a = this.analysis; if (!a) return;
      $('study-status').textContent = '分析完成 · ' + (a.engine === 'llm' ? '云端引擎' : '本地引擎') +
        ' · 纳入 ' + (a.boundary.included.length) + ' 份 / 排除 ' + (a.boundary.excluded.length) + ' 份 · ' +
        a.points.length + ' 个知识点 / ' + a.questions.length + ' 道题';
      $('study-status').className = 'study-status ok';
      let h = '<div class="res-note">' + esc(a.note || '') + '</div>';
      h += this.qualityHTML(a.quality);

      if (a.boundary.excluded.length) {
        h += '<div class="res-excluded"><b>本次明确排除：</b>' +
          a.boundary.excluded.map(x => esc(x.name)).join('、') + '</div>';
      }
      h += '<h3 class="res-h">知识点（' + a.points.length + '）</h3><div class="point-grid">';
      a.points.forEach((p, i) => {
        h += '<div class="point-card ' + (p.origin === 'source' ? 'from-src' : 'from-ai') + '">' +
          '<div class="point-head"><b>' + (i + 1) + '. ' + esc(p.title) + '</b><span class="diff">难度 ' + esc(p.difficulty) + '</span></div>' +
          '<p>' + esc(p.summary) + '</p>' + this.assetImgsHtml(p.assetRefs, a.assetIndex) + '<div class="tag-row">' + this.originTag(p.origin, p.source) + '</div></div>';
      });
      h += '</div>';

      const catOf = {};
      a.points.forEach(p => { catOf[p.id] = p.category || '未分类'; });
      h += '<h3 class="res-h">题目（' + a.questions.length + '，默认显示答案，可切遮蔽模式）</h3><div class="q-list" id="q-list">';
      a.questions.forEach((q, i) => {
        const cat = (q.pointIds && q.pointIds[0] && catOf[q.pointIds[0]]) || '';
        const isGap = q.type === 'gap';
        h += '<div class="q-item' + (isGap ? ' q-gap' : '') + '" data-qid="' + q.id + '">' +
          '<div class="q-head"><span class="q-type">' + esc(TYPE_LABEL[q.type] || q.type) + '</span>' +
          (cat ? '<span class="q-cat">' + esc(cat) + '</span>' : '') +
          '<span class="q-no">题 ' + (i + 1) + '</span>' +
          '<button class="q-peek" type="button">看答案</button></div>' +
          '<div class="q-stem">' + esc(q.stem) + '</div>' +
          (q.options && q.options.length ? '<div class="q-opts">' + q.options.map((o, j) => '<span>' + String.fromCharCode(65 + j) + '. ' + esc(o) + '</span>').join('') + '</div>' : '') +
          '<div class="q-answer"><b>答案：</b>' + esc(q.answer) + (q.explanation ? '<div class="q-exp">' + esc(q.explanation) + '</div>' : '') + '</div>' +
          (q.method ? renderMethod(q) : '') +
          this.assetImgsHtml(q.assetRefs, a.assetIndex) +
          '<div class="tag-row">' + this.originTag(q.origin, q.source) + '</div></div>';
      });
      h += '</div>';

      // 知识点图谱：按类别聚合，不散乱（类别 → 知识点 → 题型清单）
      const byCat = {};
      a.points.forEach(p => { const c = p.category || '未分类'; (byCat[c] = byCat[c] || []).push(p); });
      const catKeys = Object.keys(byCat);
      if (catKeys.length) {
        h += '<h3 class="res-h">知识点图谱（按类别 · ' + catKeys.length + ' 类）</h3><div class="cat-map" id="cat-map">';
        catKeys.forEach(c => {
          h += '<div class="cat-node"><div class="cat-name">' + esc(c) + ' <small>' + byCat[c].length + ' 个知识点</small></div><div class="cat-children">';
          byCat[c].forEach(p => {
            const qs = a.questions.filter(q => (q.pointIds || []).includes(p.id));
            const types = Array.from(new Set(qs.map(q => TYPE_LABEL[q.type] || q.type)));
            h += '<div class="cat-leaf"><b>' + esc(p.title) + '</b>' + (types.length ? '<span class="cat-types">' + types.map(t => esc(t)).join('、') + '</span>' : '<span class="cat-types none">暂无题型</span>') + '</div>';
          });
          h += '</div></div>';
        });
        h += '</div>';
      }
      $('study-result').innerHTML = h;
      $('study-actions').classList.remove('hidden');
      this._fillAssets(a.assetIndex);
    },

    // M3：分析结果显示后，异步把关联图的缩略图字节填进 <img>（图是整理结果的一部分，始终可见）。
    async _fillAssets(assetIndex) {
      if (!assetIndex) return;
      const imgs = Array.from(document.querySelectorAll('#study-result img[data-aid]'));
      for (const img of imgs) {
        const aid = img.getAttribute('data-aid');
        const info = assetIndex[aid];
        if (!info) continue;
        try {
          const r = await API.materials.readAsset(this.bookId, info.matId, aid);
          const src = r.url || (r.data ? 'data:' + (r.mime || 'image/png') + ';base64,' + (r.data || '') : '');
          if (src) img.src = src;
        } catch (e) { /* 图读不到就留空，不影响其余内容 */ }
      }
    },

    async save() {
      if (!this.analysis) return;
      const r = await API.study.saveAnalysis(this.bookId, this.analysis);
      $('study-status').textContent = r && r.ok ? '结果已保存，可在「练习」页生成试卷。' : '保存失败';
    },

    async makeExam(onPaper) {
      if (!this.analysis) return;
      const c = Settings.load();
      const r = await API.study.saveAnalysis(this.bookId, this.analysis);
      if (!r || !r.ok) { $('study-status').textContent = '保存分析结果失败，无法出卷'; return; }
      const a = Object.assign({}, this.analysis, { id: r.id });
      const paper = await API.study.exam(this.bookId, a, c.questionCount);
      if (onPaper) onPaper(paper);
    }
  };

  window.StudyUI = StudyUI;
})();
