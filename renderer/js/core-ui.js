'use strict';
/* 统一核心前端：建书 → 加文件 → 整体分析 → 可层层展开的思维导图 + 题型索引。 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const state = { books: [], current: null, analysis: null };
  // 融合 F1/F2：节点 id → DOM 行映射，供题型索引点击定位高亮。
  let nodeEls = {};
  // 融合 F3：导图画布视图状态。
  let mmScale = 1, mmX = 0, mmY = 0;

  // ---------- API ----------
  async function api(path, opts) {
    const o = opts || {};
    // Electron：preload 暴露 coreRequest，把 /api/core 路径交主进程映射到 Core 类
    // （与 server.js 共用 core/request.js 的同一份路由语义，不复制映射逻辑）。
    if (window.api && typeof window.api.coreRequest === 'function') {
      let body = null;
      try { body = o.body ? JSON.parse(o.body) : null; } catch (e) { body = null; }
      const r = await window.api.coreRequest(path, o.method || 'GET', body);
      if (!r || r.status >= 400) throw new Error((r && r.data && r.data.error) || ('HTTP ' + (r && r.status)));
      return r.data;
    }
    const res = await fetch('/api/core' + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, o));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ---------- 设置 ----------
  const SETTINGS_KEY = 'core_llm_cfg';
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCfg(cfg) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg)); }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  // ---------- 书架 ----------
  async function loadBooks() {
    const r = await api('/books');
    state.books = r.books || [];
    renderBookList();
  }
  function renderBookList() {
    const ul = $('#bookList'); ul.innerHTML = '';
    $('#bookEmpty').classList.toggle('hidden', state.books.length > 0);
    state.books.forEach(b => {
      const li = document.createElement('li');
      li.className = 'book-item' + (state.current && state.current.id === b.id ? ' active' : '');
      li.innerHTML = '<div class="bi-title">' + esc(b.title) + '</div>' +
        '<div class="bi-meta">' + b.fileCount + ' 个文件 · ' + fmtDate(b.updatedAt) +
        (b.analyzed ? ' · <span class="bi-badge">已分析</span>' : '') + '</div>';
      li.onclick = () => openBook(b.id);
      ul.appendChild(li);
    });
  }

  async function newBook() {
    const title = (prompt('新建书名：', '未命名书') || '').trim();
    if (!title) return;
    const b = await api('/books', { method: 'POST', body: JSON.stringify({ title }) });
    await loadBooks();
    openBook(b.id);
    toast('已创建《' + b.title + '》');
  }

  async function openBook(id) {
    const b = await api('/books/' + id);
    state.current = b;
    state.analysis = null;
    renderBookList();
    $('#noSelection').classList.add('hidden');
    $('#bookDetail').classList.remove('hidden');
    $('#bookTitle').textContent = b.title;
    $('#bookMeta').textContent = (b.description ? b.description + ' · ' : '') + b.files.length + ' 个文件 · 创建于 ' + fmtDate(b.createdAt);
    renderFiles(b.files);
    $('#resultArea').classList.add('hidden');
    if (b.analysisMeta) {
      try { state.analysis = await api('/books/' + id + '/analysis'); renderResult(); }
      catch (e) { /* 无分析结果 */ }
    }
  }

  async function deleteBook() {
    if (!state.current) return;
    if (!confirm('确定删除《' + state.current.title + '》？该书的文件和分析结果都会一并删除。')) return;
    await api('/books/' + state.current.id, { method: 'DELETE' });
    state.current = null; state.analysis = null;
    $('#bookDetail').classList.add('hidden');
    $('#noSelection').classList.remove('hidden');
    await loadBooks();
    toast('已删除');
  }

  // ---------- 文件 ----------
  function renderFiles(files) {
    const ul = $('#fileList'); ul.innerHTML = '';
    (files || []).forEach(f => {
      const li = document.createElement('li');
      const icon = f.isImage ? '🖼️' : (/\.pdf$/i.test(f.ext) ? '📕' : /\.(ppt|pptx)$/i.test(f.ext) ? '📊' : /\.(doc|docx)$/i.test(f.ext) ? '📘' : '📄');
      li.innerHTML = '<span class="ficon">' + icon + '</span>' +
        '<span class="fname">' + esc(f.name) + '</span>' +
        '<span class="ftag' + (f.isImage ? ' img' : '') + '">' + (f.isImage ? '图片·看图' : '已抽取文本') + '</span>' +
        '<span class="fdel" title="删除">✕</span>';
      $('.fdel', li).onclick = (e) => { e.stopPropagation(); removeFile(f.id); };
      ul.appendChild(li);
    });
  }

  async function addFiles(fileList) {
    if (!state.current) return;
    // FileList 是活引用：调用方常在 change 后立即 e.target.value = ''，
    // 会把列表清空。先把文件与总数快照下来，否则状态文案会显示「已导入 1/0 份」。
    const files = Array.from(fileList || []);
    const total = files.length;
    const status = $('#importStatus');
    if (status) { status.className = 'import-status'; status.textContent = '正在导入 ' + total + ' 份资料…'; }
    const failedNames = [];
    let added = 0;
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const data = base64FromUint8(new Uint8Array(buf));
      try {
        await api('/books/' + state.current.id + '/files', { method: 'POST', body: JSON.stringify({ name: file.name, data }) });
        added++;
      } catch (e) {
        // 融合 F7：失败逐文件累积并持久显示在界面，不再只靠 2.2 秒就消失的 toast
        failedNames.push(file.name + '（' + (e.message || '失败') + '）');
      }
    }
    if (status) {
      const msg = '已导入 ' + added + '/' + total + ' 份资料。';
      status.textContent = msg + (failedNames.length ? ' ⚠ 未导入：' + failedNames.join('；') : '');
      if (failedNames.length) status.className = 'import-status warn';
    }
    await openBook(state.current.id);
    if (!failedNames.length) toast('已导入 ' + added + ' 个文件');
  }

  async function removeFile(fid) {
    await api('/books/' + state.current.id + '/files/' + fid, { method: 'DELETE' });
    await openBook(state.current.id);
  }

  // ---------- 分析 ----------
  async function analyze() {
    const cfg = loadCfg();
    if (!cfg.baseURL || !cfg.model) { toast('请先在「模型设置」里填写 API 地址与模型名'); $('#openSettings').click(); return; }
    const st = $('#analyzeStatus'); st.classList.remove('hidden', 'err'); st.textContent = '正在把整本书交给大模型整体分析，请稍候…';
    $('#analyzeBtn').disabled = true;
    try {
      const r = await api('/books/' + state.current.id + '/analyze', { method: 'POST', body: JSON.stringify({ cfg }) });
      state.analysis = r;
      renderResult();
      // 成功分支也要更新状态条：原来只弹 toast，界面会一直停在「正在分析…」与「分析完成」自相矛盾。
      const s = (r && r.stats) || {};
      st.classList.remove('err');
      st.textContent = '分析完成：' + (s.chapters || 0) + ' 章 / ' + (s.points || 0) + ' 知识点 / ' + (s.questionTypes || 0) + ' 类题型' +
        (r && r.truncated ? '（语料已截断，见概览）' : '');
      toast('分析完成');
    } catch (e) {
      st.classList.add('err'); st.textContent = '分析失败：' + e.message;
    } finally {
      $('#analyzeBtn').disabled = false;
    }
  }

  // ---------- 结果渲染 ----------
  function renderResult() {
    if (!state.analysis) return;
    $('#resultArea').classList.remove('hidden');
    renderTree(state.analysis.tree);
    renderQuestionIndex(state.analysis.questionIndex);
    renderSummary(state.analysis);
  }

  function renderTree(root) {
    const box = $('#tree'); box.innerHTML = '';
    nodeEls = {};
    resetView();
    if (!root) return;
    const ul = document.createElement('ul');
    ul.appendChild(buildNode(root));
    box.appendChild(ul);
  }

  function buildNode(node) {
    const li = document.createElement('li');
    const hasChildren = node.children && node.children.length;
    const row = document.createElement('div');
    row.className = 'node ' + node.type;
    row.dataset.id = node.id || '';
    row.dataset.title = node.title || '';
    nodeEls[node.id] = row;
    const twist = hasChildren ? '<span class="twist">▼</span>' : '<span class="twist"></span>';
    let inner = twist + '<span class="nt">' + esc(node.title) + '</span>';
    if (node.desc) inner += '<span class="desc">' + esc(node.desc) + '</span>';
    if (node.type === 'point' && node.questionTypes && node.questionTypes.length) {
      inner += '<span class="qt">' + node.questionTypes.map(q => '<span>' + esc(q) + '</span>').join('') + '</span>';
    }
    row.innerHTML = inner;
    li.appendChild(row);

    if (hasChildren) {
      const ul = document.createElement('ul');
      node.children.forEach(c => ul.appendChild(buildNode(c)));
      li.appendChild(ul);
      row.onclick = () => {
        const hidden = ul.classList.toggle('hidden');
        row.classList.toggle('collapsed', hidden);
      };
    }
    return li;
  }

  function renderQuestionIndex(qIndex) {
    const box = $('#questionIndex'); box.innerHTML = '';
    if (!qIndex || !qIndex.length) { box.innerHTML = '<div class="empty-hint">暂无题型索引</div>'; return; }
    qIndex.forEach(q => {
      const g = document.createElement('div'); g.className = 'qgroup';
      g.innerHTML = '<div class="qhead">' + esc(q.type) + ' <span class="qcount">' + q.items.length + ' 项</span></div>';
      (q.items || []).forEach(it => {
        const c = document.createElement('div'); c.className = 'qcard';
        c.innerHTML = '<div class="qt-title">' + esc(it.title) + '</div>' +
          (it.path && it.path.length ? '<div class="qpath">位置：<b>' + it.path.map(esc).join('</b> › <b>') + '</b></div>' : '');
        // 融合 F2：点题型项 → 跳回导图并高亮对应节点
        c.onclick = () => locateNode(it.pointId, it.title);
        g.appendChild(c);
      });
      box.appendChild(g);
    });
  }

  // ---------- 融合 F2：题型索引 → 导图节点定位高亮 ----------
  function switchTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  }
  function locateNode(pointId, title) {
    switchTab('mindmap');
    let row = pointId && nodeEls[pointId];
    if (!row) {
      const key = String(title || '').toLowerCase();
      row = Object.values(nodeEls).find(r => (r.dataset.title || '').toLowerCase() === key) || null;
    }
    // 展开所有祖先，确保被定位节点真的可见
    $$('#tree ul.hidden').forEach(u => u.classList.remove('hidden'));
    $$('#tree .node.collapsed').forEach(n => n.classList.remove('collapsed'));
    if (row) {
      $$('#tree .node.highlight').forEach(n => n.classList.remove('highlight'));
      row.classList.add('highlight');
      setTimeout(() => row.classList.remove('highlight'), 2200);
      if (row.scrollIntoView) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      toast('未找到对应节点：' + (title || ''));
    }
  }

  // ---------- 融合 F3：缩放 / 平移 / 复位 ----------
  function applyView() {
    const tree = $('#tree');
    if (tree) tree.style.transform = 'translate(' + mmX + 'px,' + mmY + 'px) scale(' + mmScale + ')';
    const label = $('#zoomLabel');
    if (label) label.textContent = Math.round(mmScale * 100) + '%';
  }
  function zoomBy(f) {
    mmScale = Math.max(0.3, Math.min(2.5, mmScale * f));
    applyView();
  }
  function resetView() {
    mmScale = 1; mmX = 0; mmY = 0;
    applyView();
  }

  // ---------- 融合 F4：导出 JSON / SVG（矢量，非像素截图） ----------
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function bookName() { return (state.current && state.current.title) || 'analysis'; }
  function exportJson() {
    if (!state.analysis) { toast('还没有分析结果'); return; }
    downloadBlob(new Blob([JSON.stringify(state.analysis, null, 2)], { type: 'application/json' }), bookName() + '.json');
  }
  function exportSvg() {
    if (!state.analysis || !state.analysis.tree) { toast('还没有分析结果'); return; }
    downloadBlob(new Blob([buildTreeSvg(state.analysis.tree)], { type: 'image/svg+xml' }), bookName() + '.svg');
  }
  // 左→右树布局，每个节点一个圆角矩形 + 贝塞尔连线。
  function buildTreeSvg(root) {
    const W = 180, H = 36, padX = 16, padY = 16;
    let row = 0; const pos = {};
    (function assign(n, depth) {
      const kids = n.children || [];
      if (!kids.length) { pos[n.id] = { x: depth, y: row }; row++; return; }
      kids.forEach(k => assign(k, depth + 1));
      const ys = kids.map(k => pos[k.id].y);
      pos[n.id] = { x: depth, y: (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2 };
    })(root, 0);
    const maxY = Math.max(row, 1);
    const maxX = (function maxd(n) { return Math.max(0, ...(n.children || []).map(maxd)) + 1; })(root);
    let body = '';
    (function draw(n) {
      const p = pos[n.id]; if (!p) return;
      const x = padX + p.x * W, y = padY + p.y * H;
      const col = { root: '#3a7afe', chapter: '#eaf1ff', section: '#f3f7ff', point: '#ffffff', subtype: '#ffffff' }[n.type] || '#fff';
      const stroke = n.type === 'root' ? '#3a7afe' : (n.type === 'chapter' ? '#cfe0ff' : '#e3e8f0');
      const txt = (n.title || '').slice(0, 18);
      body += '<rect x="' + x + '" y="' + y + '" width="' + (W - 24) + '" height="' + (H - 8) + '" rx="14" fill="' + col + '" stroke="' + stroke + '" stroke-width="1.2"/>' +
        '<text x="' + (x + (W - 24) / 2) + '" y="' + (y + (H - 8) / 2 + 4) + '" font-size="12" fill="#1f2733" text-anchor="middle" font-family="sans-serif">' + esc(txt) + '</text>';
      (n.children || []).forEach(c => {
        const cp = pos[c.id]; if (!cp) return;
        body += '<path d="M' + (x + W - 24) + ' ' + (y + (H - 8) / 2) + ' C' + (x + W) + ' ' + (y + (H - 8) / 2) +
          ' ' + (padX + cp.x * W - 16) + ' ' + (padY + cp.y * H + (H - 8) / 2) +
          ' ' + (padX + cp.x * W) + ' ' + (padY + cp.y * H + (H - 8) / 2) +
          '" stroke="#c8d2e0" fill="none" stroke-width="1.2"/>';
        draw(c);
      });
    })(root);
    const Wtot = padX * 2 + maxX * W, Htot = padY * 2 + (maxY + 1) * H;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Wtot + '" height="' + Htot + '" viewBox="0 0 ' + Wtot + ' ' + Htot + '">' + body + '</svg>';
  }

  function renderSummary(a) {
    $('#summaryBox').textContent = a.summary || '（无概览）';
    const s = a.stats || {};
    const base = [
      ['章', s.chapters], ['节', s.sections], ['知识点', s.points], ['细分', s.subtypes], ['题型', s.questionTypes]
    ].map(([l, n]) => '<div class="stat"><div class="num">' + (n || 0) + '</div><div class="lbl">' + l + '</div></div>');
    // 融合 F8：分题型统计卡；F6：语料截断与来源信息显式可见
    const typeCards = Object.keys(s.questionTypeCounts || {}).map(k =>
      '<div class="stat typecount"><div class="num">' + s.questionTypeCounts[k] + '</div><div class="lbl">' + esc(k) + '</div></div>');
    const meta = '<div class="ov-meta" style="width:100%;font-size:12px;color:var(--ink-soft);margin-top:10px">模型：' + esc(a.model || '—') +
      ' ｜ 全书 ' + (a.sourceLen || 0) + ' 字 ｜ 资料 ' + (a.materialCount || 0) + ' 份' +
      (a.imageCount ? ' ｜ 图片 ' + a.imageCount + ' 份' : '') + '</div>';
    const warn = a.truncated
      ? '<div class="ov-warn" style="width:100%">⚠ 全书超过 ' + (a.corpusLen || 0) + ' 字的分析上限，已截断；超大书的分析深度可能受限。</div>'
      : '';
    $('#statsBox').innerHTML = base.concat(typeCards).join('') + meta + warn;
  }

  // ---------- 工具 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtDate(iso) { if (!iso) return ''; try { const d = new Date(iso); return d.toLocaleString('zh-CN', { hour12: false }); } catch (e) { return iso; } }
  function base64FromUint8(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }

  // ---------- 事件绑定 ----------
  function bind() {
    $('#newBookBtn').onclick = newBook;
    $('#deleteBookBtn').onclick = deleteBook;
    $('#analyzeBtn').onclick = analyze;
    $('#fileInput').onchange = (e) => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; };

    const dz = $('#dropzone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

    $$('.tab').forEach(t => t.onclick = () => {
      $$('.tab').forEach(x => x.classList.remove('active'));
      $$('.tab-pane').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $('#tab-' + t.dataset.tab).classList.add('active');
    });

    $('#expandAll').onclick = () => {
      $$('#tree ul ul').forEach(u => u.classList.remove('hidden'));
      $$('#tree .node').forEach(n => n.classList.remove('collapsed'));
    };
    $('#collapseAll').onclick = () => {
      $$('#tree ul ul').forEach(u => u.classList.add('hidden'));
      $$('#tree .node').forEach(n => { if (n.querySelector('.twist') && n.querySelector('.twist').textContent) n.classList.add('collapsed'); });
    };

    // 融合 F3/F4：缩放、复位、导出，以及鼠标拖拽平移与滚轮缩放
    $$('[data-zoom]').forEach(b => b.onclick = () => zoomBy(b.dataset.zoom === 'in' ? 1.15 : 1 / 1.15));
    $('#btnFit').onclick = resetView;
    $('#btnExportJson').onclick = exportJson;
    $('#btnExportSvg').onclick = exportSvg;
    const vp = $('#mmViewport');
    if (vp) {
      let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      vp.addEventListener('mousedown', e => {
        if (e.target.closest && e.target.closest('.node')) return; // 点节点是折叠，不触发拖拽
        dragging = true; sx = e.clientX; sy = e.clientY; ox = mmX; oy = mmY; vp.classList.add('grabbing');
      });
      window.addEventListener('mouseup', () => { dragging = false; vp.classList.remove('grabbing'); });
      window.addEventListener('mousemove', e => {
        if (!dragging) return;
        mmX = ox + (e.clientX - sx); mmY = oy + (e.clientY - sy); applyView();
      });
      vp.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
    }

    // 设置弹窗
    const modal = $('#settingsModal');
    $('#openSettings').onclick = () => { fillSettings(); modal.classList.remove('hidden'); };
    $('#closeSettings').onclick = () => modal.classList.add('hidden');
    $('#saveSettings').onclick = () => { saveCfg(readSettings()); modal.classList.add('hidden'); toast('已保存模型设置'); };
    $('#testConn').onclick = testConn;
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    loadBooks();
  }

  function fillSettings() {
    const c = loadCfg();
    $('#cfgBase').value = c.baseURL || ''; $('#cfgModel').value = c.model || ''; $('#cfgKey').value = c.apiKey || '';
  }
  function readSettings() { return { baseURL: $('#cfgBase').value.trim(), model: $('#cfgModel').value.trim(), apiKey: $('#cfgKey').value.trim() }; }
  async function testConn() {
    const cs = $('#connStatus'); cs.textContent = '测试中…'; cs.className = 'conn-status';
    try {
      const cfg = readSettings();
      let d;
      // Electron：preload 暴露 llm.test（走主进程 ipc），file:// 下没有 HTTP server，不能裸 fetch。
      // llm.test 直接返回 { ok, models, error }，不是 Response，无需 r.json()。
      if (window.api && window.api.llm && typeof window.api.llm.test === 'function') {
        d = await window.api.llm.test(cfg);
      } else {
        const r = await fetch('/api/llm/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cfg }) });
        d = await r.json();
      }
      cs.textContent = d.ok ? ('✓ 连通（' + (d.models ? d.models.length : 0) + ' 个模型）') : ('✗ ' + (d.error || '失败'));
      cs.className = 'conn-status ' + (d.ok ? 'ok' : 'err');
    } catch (e) { cs.textContent = '✗ ' + e.message; cs.className = 'conn-status err'; }
  }

  if (document.readyState !== 'loading') bind();
  else document.addEventListener('DOMContentLoaded', bind);
})();
