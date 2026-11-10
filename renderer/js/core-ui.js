'use strict';
/* 统一核心前端：建书 → 加文件 → 整体分析 → 交互式思维导图 + 题型下钻 + 题目详情。
 *
 * v2（2026-11-09）：
 *   - 渲染层换成交互式 SVG 画布（js/mindmap-layout.js 单一真源），DOM 树降级为「大纲模式」；
 *   - 题型分类作为第二视角长进同一张导图，子题型 → 所有题目 → 题目详情（原图/分步解答/思路）；
 *   - 3 布局 / 分支配色 / 全文搜索 / 双击聚焦 / 键盘导航 / JSON·SVG·PNG·MD·OPML 五种导出。
 * 兼容契约：#tree .node、#tree.style.transform、.highlight、qcard 联动、__lastBlob 等既有验收点全部保留。
 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const state = { books: [], current: null, analysis: null };
  // 节点 id → DOM 行映射，供题型索引点击定位高亮（既有 e2e 契约）。
  let nodeEls = {};
  // 导图画布视图状态。
  let mmScale = 1, mmX = 0, mmY = 0;
  // v2 视图状态。
  const view = {
    perspective: 'knowledge',   // knowledge | question
    layout: 'right',            // right | both | org
    mode: 'canvas',             // canvas | outline
    focusId: null,              // 聚焦下钻的子树根 id
    collapsed: {},              // 折叠的节点 id
    hits: [], hitIndex: -1,
    layoutData: null, treeData: null,
    questionById: {}, qitemById: {}
  };

  const ML = window.MindmapLayout || null;

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
    view.focusId = null; view.collapsed = {}; view.hits = []; view.hitIndex = -1;
    renderBookList();
    $('#noSelection').classList.add('hidden');
    $('#bookDetail').classList.remove('hidden');
    $('#bookTitle').textContent = b.title;
    $('#bookMeta').textContent = (b.description ? b.description + ' · ' : '') + b.files.length + ' 个文件 · 创建于 ' + fmtDate(b.createdAt);
    renderFiles(b.files);
    $('#resultArea').classList.add('hidden');
    $('#qitemPanel').classList.add('hidden');
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
    const st = $('#analyzeStatus');
    st.classList.remove('hidden', 'err', 'ok'); st.classList.add('loading');
    st.textContent = '正在把整本书交给大模型整体分析，请稍候…';
    $('#analyzeBtn').disabled = true;
    try {
      const r = await api('/books/' + state.current.id + '/analyze', { method: 'POST', body: JSON.stringify({ cfg }) });
      state.analysis = r;
      renderResult();
      const s = (r && r.stats) || {};
      st.classList.remove('err', 'loading'); st.classList.add('ok');
      st.textContent = '分析完成：' + (s.chapters || 0) + ' 章 / ' + (s.points || 0) + ' 知识点 / ' +
        (s.questionTypes || 0) + ' 类题型 / ' + (s.questionCount || 0) + ' 道题' +
        (r && r.truncated ? '（长书已按锚点均衡取样，见概览）' : '');
      toast('分析完成');
    } catch (e) {
      // 错误态要可恢复：说清原因 + 给下一步，不做死路。
      st.classList.remove('loading', 'ok'); st.classList.add('err');
      st.textContent = '分析失败：' + e.message + ' — 可在「模型设置」检查 API 地址与模型名后重试。';
    } finally {
      $('#analyzeBtn').disabled = false;
    }
  }

  // ---------- 结果渲染 ----------
  function renderResult() {
    if (!state.analysis) return;
    $('#resultArea').classList.remove('hidden');
    indexQuestions();
    renderTree(state.analysis.tree);          // 大纲模式（DOM 树，保留既有验收契约）
    renderCanvas();                           // 导图模式（SVG 画布）
    renderQuestionIndex(state.analysis.questionIndex);
    renderSummary(state.analysis);
  }

  // 题目/子题型按 id 建索引，供画布节点点击下钻。
  function indexQuestions() {
    view.questionById = {}; view.qitemById = {};
    (state.analysis.questionIndex || []).forEach((g, gi) => {
      (g.items || []).forEach((it, ii) => {
        const qid = 'qi_' + gi + '_' + ii;
        view.qitemById[qid] = Object.assign({}, it, { type: g.type });
        (it.questions || []).forEach(q => { view.questionById[q.id] = q; });
      });
    });
  }

  // ---------- 大纲模式（DOM 树，Xmind 大纲模式） ----------
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

  // ---------- v2：SVG 导图画布 ----------
  function activeTree() {
    if (!state.analysis) return null;
    if (view.perspective === 'question') {
      return ML ? ML.buildQuestionTree(state.analysis.questionIndex || []) : state.analysis.tree;
    }
    return state.analysis.tree;
  }
  function findNode(root, id) {
    if (!root || !id) return null;
    if (root.id === id) return root;
    for (const c of (root.children || [])) { const r = findNode(c, id); if (r) return r; }
    return null;
  }
  // 折叠：把被折叠节点的 children 摘掉（只影响画布，不改原始数据）。
  function pruned(node) {
    if (!node) return null;
    const out = Object.assign({}, node);
    out.children = view.collapsed[node.id] ? [] : (node.children || []).map(pruned).filter(Boolean);
    return out;
  }

  // v3 美化：导图 SVG 颜色由 CSS 主题 token 驱动（深色模式不再是一块白）。
  // 只在浏览器调用；Node 侧判别测试直接 require 布局模块，走默认白底。
  function svgTheme() {
    const cs = window.getComputedStyle(document.documentElement);
    const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    return {
      background: v('--surface-1', '#ffffff'),
      nodeFill: v('--surface-1', '#ffffff'),
      textColor: v('--ink', '#1f2733'),
      metaColor: v('--ink-soft', '#6b7688'),
      rootTextColor: '#ffffff'
    };
  }

  function renderCanvas() {
    const box = $('#mmCanvas');
    if (!box) return;
    if (!ML || !state.analysis) { box.innerHTML = ''; return; }
    let root = activeTree();
    if (view.focusId) root = findNode(root, view.focusId) || root;
    root = pruned(root);
    const layout = ML.layoutTree(root, view.layout);
    view.layoutData = layout;
    view.treeData = root;
    box.innerHTML = ML.toSvg(layout, svgTheme());
    box.style.width = layout.width + 'px';
    box.style.height = layout.height + 'px';
    applyView();
    bindCanvasNodes(layout);
    applySearchHighlight();
    $('#btnFocusBack').classList.toggle('hidden', !view.focusId);
  }

  let clickTimer = null;
  function bindCanvasNodes(layout) {
    $$('#mmCanvas .mm-node').forEach(g => {
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = g.dataset.id, kind = g.dataset.kind;
        $$('#mmCanvas .mm-node.selected').forEach(x => x.classList.remove('selected'));
        g.classList.add('selected');
        if (kind === 'question') { const q = view.questionById[id] || (layout.nodes.find(n => n.id === id) || {}).question; if (q) openQuestion(q); return; }
        if (kind === 'qitem') { const it = view.qitemById[id]; if (it) openQitem(it); return; }
        const node = layout.nodes.find(n => n.id === id);
        if (node && (node.childrenCount || hasRenderedChildren(id))) {
          // 单击折叠会重建 DOM；若立即执行会打断 dblclick 事件（真浏览器实测）。
          // 延迟到双击窗口之后，双击时取消即可让单击/双击共存。
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            view.collapsed[id] = !view.collapsed[id];
            renderCanvas();
          }, 220);
        }
      });
      g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        clearTimeout(clickTimer);
        const id = g.dataset.id, kind = g.dataset.kind;
        if (kind === 'question') return;
        view.focusId = (view.focusId === id) ? null : id;
        view.collapsed = {};
        renderCanvas();
        toast(view.focusId ? '已聚焦该分支，双击根节点或点「返回全图」退出' : '已返回全图');
      });
    });
  }
  function hasRenderedChildren(id) {
    return (view.layoutData.nodes || []).some(n => n.parentId === id);
  }

  function switchPerspective(p) {
    view.perspective = p; view.focusId = null; view.collapsed = {};
    $$('[data-perspective]').forEach(b => b.classList.toggle('active', b.dataset.perspective === p));
    renderCanvas();
  }
  function switchLayout(m) {
    view.layout = m;
    $$('[data-layout]').forEach(b => b.classList.toggle('active', b.dataset.layout === m));
    renderCanvas();
  }
  function switchMode(m) {
    view.mode = m;
    $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === m));
    const outline = m === 'outline';
    $('#tree').classList.toggle('hidden', !outline);
    $('#mmCanvas').classList.toggle('hidden', outline);
    $$('#expandAll, #collapseAll').forEach(b => b.disabled = !outline);
  }

  // ---------- 题型索引（速查 tab） ----------
  function renderQuestionIndex(qIndex) {
    const box = $('#questionIndex'); box.innerHTML = '';
    if (!qIndex || !qIndex.length) { box.innerHTML = '<div class="empty-hint">暂无题型索引</div>'; return; }
    qIndex.forEach((q, gi) => {
      const g = document.createElement('div'); g.className = 'qgroup';
      const total = (q.items || []).reduce((s, it) => s + ((it.questions || []).length), 0);
      g.innerHTML = '<div class="qhead">' + esc(q.type) + ' <span class="qcount">' + (q.items || []).length + ' 个子题型 · ' + total + ' 道题</span></div>';
      (q.items || []).forEach((it, ii) => {
        const c = document.createElement('div'); c.className = 'qcard';
        const cnt = (it.questions || []).length;
        c.innerHTML = '<div class="qt-title">' + esc(it.title) + (cnt ? ' <span class="qcount">· ' + cnt + ' 道题</span>' : '') + '</div>' +
          (it.path && it.path.length ? '<div class="qpath">位置：<b>' + it.path.map(esc).join('</b> › <b>') + '</b></div>' : '');
        // 既有契约：点题型项 → 切回导图并高亮对应知识点（e2e 断言恰好 1 个 .highlight）
        c.onclick = () => {
          locateNode(it.pointId, it.title);
          const wrapped = Object.assign({}, it, { id: 'qi_' + gi + '_' + ii, type: q.type });
          // 老分析数据没有 questions 时也要开面板：openQitem 内有「该子题型下暂无题目」文案，
          // 点开后能提示用户重新分析，比「点了没反应」强。
          openQitem(wrapped);
        };
        g.appendChild(c);
      });
      box.appendChild(g);
    });
  }

  function switchTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  }
  function locateNode(pointId, title) {
    switchTab('mindmap');
    if (view.perspective !== 'knowledge') switchPerspective('knowledge');
    let row = pointId && nodeEls[pointId];
    if (!row) {
      const key = String(title || '').toLowerCase();
      row = Object.values(nodeEls).find(r => (r.dataset.title || '').toLowerCase() === key) || null;
    }
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
    $$('#mmCanvas .mm-node.locate').forEach(n => n.classList.remove('locate'));
    if (pointId) {
      const g = $('#mmCanvas .mm-node[data-id="' + cssEsc(pointId) + '"]');
      if (g) { g.classList.add('locate'); g.scrollIntoView && g.scrollIntoView({ block: 'center', inline: 'center' }); }
    }
  }

  // ---------- 子题型 → 所有题目 ----------
  function openQitem(it) {
    const panel = $('#qitemPanel');
    $('#qitemTitle').textContent = (it.type ? it.type + ' · ' : '') + (it.title || '子题型');
    $('#qitemPath').textContent = (it.path || []).length ? '知识点路径：' + it.path.join(' › ') : '未标注知识点路径';
    const list = $('#qitemList'); list.innerHTML = '';
    const qs = it.questions || [];
    if (!qs.length) { list.innerHTML = '<div class="sp-empty">该子题型下暂无题目。</div>'; }
    qs.forEach((q, i) => {
      const d = document.createElement('div'); d.className = 'sp-qlist-item';
      d.innerHTML = '<div class="sp-qlist-top"><span class="sp-qlist-idx">' + (i + 1) + '</span>' +
        '<span class="sp-qlist-tag">' + esc(q.difficulty || '基础') + '</span>' +
        (q.source && q.source.file ? '<span class="sp-qlist-tag">📄 ' + esc(q.source.file) + '</span>' : '') + '</div>' +
        '<div class="sp-qlist-stem">' + esc(q.stem || '（无题干）') + '</div>' +
        '<div class="sp-qlist-go">点击查看图书原图 / 详细解答 / 解题思路 →</div>';
      d.onclick = () => openQuestion(q);
      list.appendChild(d);
    });
    panel.classList.remove('hidden');
  }

  // ---------- 题目详情：原图 + 分步解答 + 思路 ----------
  let currentQuestion = null;
  function openQuestion(q) {
    currentQuestion = q;
    $('#qdTitle').textContent = '题目详情';
    $('#qdStem').textContent = q.stem || '（无题干）';
    $('#qdOptions').innerHTML = (q.options || []).length
      ? q.options.map(o => '<div class="qd-option">' + esc(o) + '</div>').join('') : '';
    $('#qdAnswer').textContent = q.answer || '（模型未给出答案）';
    $('#qdSolution').innerHTML = (q.solution || []).length
      ? q.solution.map(s => '<li>' + esc(s) + '</li>').join('') : '<li>（模型未给出分步解答）</li>';
    $('#qdRationale').textContent = q.rationale || '（模型未给出解题思路）';
    $('#qdPitfalls').textContent = q.pitfalls || '';
    $('#qdPitfallBlock').classList.toggle('hidden', !q.pitfalls);
    $('#qdDifficulty').textContent = '难度：' + (q.difficulty || '基础');
    $('#qdPoint').textContent = (q.pointPath || []).length ? '知识点：' + q.pointPath.join(' › ') : '';
    $('#questionModal').classList.remove('hidden');
    renderQuestionSource(q);
  }

  async function renderQuestionSource(q) {
    const imgBox = $('#qdImage'), srcBox = $('#qdSource');
    imgBox.classList.add('hidden'); imgBox.innerHTML = '';
    const s = q.source || {};
    const file = (state.current && (state.current.files || []).find(f => f.name === s.file)) || null;
    let txt = s.file ? '来源：<b>' + esc(s.file) + '</b>' + (s.page ? ' · 第 <b>' + s.page + '</b> 页' : '') : '来源：未标注';
    // v3：锚点是语料里的真实坐标（PDF 真页码 / 文本块号），不是模型自报的页码。
    if (s.anchor) txt += '<span class="qd-anchor">锚点 ' + esc(s.anchor) + '</span>';
    if (s.quote) txt += '<span class="qd-quote">' + esc(s.quote) + '</span>';
    // 引文由程序从送进模型的语料逐字校验；老分析数据没有该字段，不显示徽章、不谎称已核对。
    if (q.quoteVerified === true) txt += '<div class="qd-verify ok">✓ 引文已与原文逐字核对</div>';
    else if (q.quoteVerified === false) txt += '<div class="qd-verify warn">⚠ 引文未能在原文中定位（可能被改写或编造）</div>';
    // 诚实边界：图片型资料可显示真原图；PDF/Office 在 file:// 下无法渲染页图，只做文本定位。
    if (file && file.isImage && state.current) {
      try {
        const raw = await api('/books/' + state.current.id + '/files/' + file.id + '/raw');
        if (raw && raw.data) {
          imgBox.innerHTML = '<img alt="图书原图" src="data:' + esc(raw.mime || 'image/png') + ';base64,' + raw.data + '" />' +
            '<div class="qd-imgcap">图书原图 · ' + esc(raw.name || s.file) + '</div>';
          imgBox.classList.remove('hidden');
        }
      } catch (e) { txt += '<div class="qd-quote">原图读取失败：' + esc(e.message) + '</div>'; }
    } else if (file && !file.isImage) {
      // 纯文本能直接按锚点+引文定位，不该套用 PDF/Office 的「页图需视觉能力」措辞。
      const textLike = /\.(txt|md|csv|text)$/i.test(String(file.ext || ''));
      txt += textLike
        ? '<div class="qd-quote">纯文本资料，已按「锚点 + 引文」直接定位原文，无需页图。</div>'
        : '<div class="qd-quote">该资料为 ' + esc(file.ext || '文档') + '，当前视图按「文件名 + 页码 + 引文」定位原文；页图渲染需视觉/预览能力，未声称可用。</div>';
    } else if (s.file) {
      txt += '<div class="qd-quote">未在本书资料中找到同名文件，已按模型标注的来源文本定位。</div>';
    }
    srcBox.innerHTML = txt;
  }

  // ---------- 缩放 / 平移 / 复位 ----------
  function applyView() {
    const t = 'translate(' + mmX + 'px,' + mmY + 'px) scale(' + mmScale + ')';
    const tree = $('#tree'); if (tree) tree.style.transform = t;      // 既有 e2e 契约
    const canvas = $('#mmCanvas'); if (canvas) canvas.style.transform = t;
    const label = $('#zoomLabel'); if (label) label.textContent = Math.round(mmScale * 100) + '%';
  }
  function zoomBy(f) {
    mmScale = Math.max(0.3, Math.min(2.5, mmScale * f));
    applyView();
  }
  function resetView() {
    mmScale = 1; mmX = 0; mmY = 0;
    applyView();
  }

  // ---------- 搜索 ----------
  function applySearchHighlight() {
    $$('#mmCanvas .mm-node').forEach(g => g.classList.remove('hit', 'dim'));
    if (!view.hits.length) return;
    const set = new Set(view.hits);
    $$('#mmCanvas .mm-node').forEach(g => {
      if (set.has(g.dataset.id)) g.classList.add('hit');
      else g.classList.add('dim');
    });
  }
  function doSearch(kw) {
    view.hitIndex = -1;
    view.hits = (ML && view.layoutData) ? ML.searchNodes(view.layoutData.nodes, kw) : [];
    $('#searchCount').textContent = kw ? (view.hits.length + ' 个命中') : '';
    applySearchHighlight();
  }
  function nextHit(step) {
    if (!view.hits.length) return;
    view.hitIndex = (view.hitIndex + step + view.hits.length) % view.hits.length;
    const id = view.hits[view.hitIndex];
    $$('#mmCanvas .mm-node.locate').forEach(g => g.classList.remove('locate'));
    const g = $('#mmCanvas .mm-node[data-id="' + cssEsc(id) + '"]');
    if (g) { g.classList.add('locate'); g.scrollIntoView && g.scrollIntoView({ block: 'center', inline: 'center' }); }
  }

  // ---------- 导出（5 种，画布与导出同一份坐标） ----------
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
  function currentSvg() {
    if (!ML || !view.layoutData) return '';
    return ML.toSvg(view.layoutData, svgTheme());
  }
  function exportSvg() {
    if (!state.analysis || !state.analysis.tree) { toast('还没有分析结果'); return; }
    // 优先用画布同一份坐标（单一真源）；无画布数据时回退到自包含的矢量导出。
    downloadBlob(new Blob([currentSvg() || buildTreeSvg(state.analysis.tree)], { type: 'image/svg+xml' }), bookName() + '.svg');
  }

  // 自包含矢量导出（左→右树）。浏览器里优先复用 js/mindmap-layout.js 的坐标，
  // 保证「导出与屏幕一致」；无 window 的纯脚本/沙箱环境退化为内置布局，可独立跑。
  function buildTreeSvg(root) {
    const MLib = (typeof window !== 'undefined' && window.MindmapLayout) || null;
    if (MLib && root) return MLib.toSvg(MLib.layoutTree(root, 'right'), svgTheme());
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
  function exportPng() {
    const svg = currentSvg();
    if (!svg) { toast('还没有分析结果'); return; }
    const d = view.layoutData;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = d.width * 2; c.height = d.height * 2;
        const ctx = c.getContext('2d'); ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
        c.toBlob(b => { if (b) downloadBlob(b, bookName() + '.png'); else toast('PNG 生成失败'); }, 'image/png');
      } catch (e) { toast('PNG 生成失败：' + e.message); }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { toast('PNG 生成失败（SVG 无法光栅化）'); URL.revokeObjectURL(url); };
    img.src = url;
  }
  function exportMd() {
    if (!ML || !view.treeData) { toast('还没有分析结果'); return; }
    downloadBlob(new Blob([ML.toMarkdown(view.treeData)], { type: 'text/markdown' }), bookName() + '.md');
  }
  function exportOpml() {
    if (!ML || !view.treeData) { toast('还没有分析结果'); return; }
    downloadBlob(new Blob([ML.toOpml(view.treeData)], { type: 'text/x-opml' }), bookName() + '.opml');
  }

  function renderSummary(a) {
    $('#summaryBox').textContent = a.summary || '（无概览）';
    const s = a.stats || {};
    const base = [
      ['章', s.chapters], ['节', s.sections], ['知识点', s.points], ['细分', s.subtypes], ['题型', s.questionTypes], ['题目', s.questionCount]
    ].map(([l, n]) => '<div class="stat"><div class="num">' + (n || 0) + '</div><div class="lbl">' + l + '</div></div>');
    const typeCards = Object.keys(s.questionTypeCounts || {}).map(k =>
      '<div class="stat typecount"><div class="num">' + s.questionTypeCounts[k] + '</div><div class="lbl">' + esc(k) + '</div></div>');
    const audit = (a.quoteAudit && typeof a.quoteAudit.checked === 'number') ? a.quoteAudit : null;
    const meta = '<div class="ov-meta">模型：' + esc(a.model || '—') +
      ' ｜ 全书 ' + (a.sourceLen || 0) + ' 字 ｜ 资料 ' + (a.materialCount || 0) + ' 份' +
      (a.imageCount ? ' ｜ 图片 ' + a.imageCount + ' 份' : '') +
      (audit ? ' ｜ 引文核对 <b>' + audit.hit + '/' + audit.checked + '</b> 命中原文' : '') + '</div>';
    // v3：长书不再笼统写「已截断」，而是逐份资料如实显示本次到底读了多少字。
    const cov = a.corpusCoverage;
    const covNote = (cov && cov.truncated)
      ? '<div class="ov-cov">⚠ 全书共 ' + cov.totalChars + ' 字，超过一次 API 的语料预算。' +
        '已按页/段锚点从 <b>' + cov.files + '</b> 份资料中<b>均衡取样 ' + cov.keptChars + ' 字</b>（每份都覆盖）：' +
        (cov.coverage || []).map(c => '<span>' + esc(c.file) + ' ' + c.keptChars + '/' + c.totalChars + ' 字</span>').join('') +
        '</div>'
      : (a.truncated ? '<div class="ov-warn">⚠ 该分析由旧版本生成，语料曾被整体截断；重新分析可获得按锚点均衡覆盖的结果。</div>' : '');
    $('#statsBox').innerHTML = base.concat(typeCards).join('') + meta + covNote;
  }

  // ---------- 工具 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function cssEsc(s) { return String(s || '').replace(/["\\]/g, '\\$&'); }
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

    $$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));

    $('#expandAll').onclick = () => {
      $$('#tree ul ul').forEach(u => u.classList.remove('hidden'));
      $$('#tree .node').forEach(n => n.classList.remove('collapsed'));
      if (view.perspective !== 'knowledge') { view.collapsed = {}; renderCanvas(); }
    };
    $('#collapseAll').onclick = () => {
      $$('#tree ul ul').forEach(u => u.classList.add('hidden'));
      $$('#tree .node').forEach(n => { if (n.querySelector('.twist') && n.querySelector('.twist').textContent) n.classList.add('collapsed'); });
    };

    // v2：视角 / 布局 / 视图切换
    $$('[data-perspective]').forEach(b => b.onclick = () => switchPerspective(b.dataset.perspective));
    $$('[data-layout]').forEach(b => b.onclick = () => switchLayout(b.dataset.layout));
    $$('[data-view]').forEach(b => b.onclick = () => switchMode(b.dataset.view));
    $('#btnFocusBack').onclick = () => { view.focusId = null; view.collapsed = {}; renderCanvas(); };

    $('#mmSearch').addEventListener('input', (e) => doSearch(e.target.value.trim()));
    $('#mmSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nextHit(1); }
    });

    $$('[data-zoom]').forEach(b => b.onclick = () => zoomBy(b.dataset.zoom === 'in' ? 1.15 : 1 / 1.15));
    $('#btnFit').onclick = resetView;
    $('#btnExportJson').onclick = exportJson;
    $('#btnExportSvg').onclick = exportSvg;
    $('#btnExportPng').onclick = exportPng;
    $('#btnExportMd').onclick = exportMd;
    $('#btnExportOpml').onclick = exportOpml;

    const vp = $('#mmViewport');
    if (vp) {
      let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      vp.addEventListener('mousedown', e => {
        if (e.target.closest && (e.target.closest('.node') || e.target.closest('.mm-node'))) return;
        dragging = true; sx = e.clientX; sy = e.clientY; ox = mmX; oy = mmY; vp.classList.add('grabbing');
      });
      window.addEventListener('mouseup', () => { dragging = false; vp.classList.remove('grabbing'); });
      window.addEventListener('mousemove', e => {
        if (!dragging) return;
        mmX = ox + (e.clientX - sx); mmY = oy + (e.clientY - sy); applyView();
      });
      vp.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
    }

    // 子题型面板 / 题目详情
    $('#closeQitem').onclick = () => $('#qitemPanel').classList.add('hidden');
    $('#closeQuestion').onclick = () => $('#questionModal').classList.add('hidden');
    $('#questionModal').addEventListener('click', e => { if (e.target === $('#questionModal')) $('#questionModal').classList.add('hidden'); });
    $('#qdLocate').onclick = () => {
      if (!currentQuestion) return;
      $('#questionModal').classList.add('hidden');
      locateNode(currentQuestion.pointId, (currentQuestion.pointPath || []).slice(-1)[0]);
    };

    // 键盘导航（Xmind / mind-elixir 的键盘优先画布）
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA/.test(tag)) {
        if (e.key === 'Escape') { e.target.blur(); doSearch(''); $('#mmSearch').value = ''; }
        return;
      }
      if (e.key === '/') { e.preventDefault(); $('#mmSearch').focus(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.15); return; }
      if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.15); return; }
      if (e.key === '0') { e.preventDefault(); resetView(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); nextHit(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); nextHit(-1); return; }
      if (e.key === 'Escape') {
        $('#questionModal').classList.add('hidden');
        $('#qitemPanel').classList.add('hidden');
        if (view.focusId) { view.focusId = null; view.collapsed = {}; renderCanvas(); }
      }
    });

    // 设置弹窗
    const modal = $('#settingsModal');
    $('#openSettings').onclick = () => { fillSettings(); modal.classList.remove('hidden'); };
    $('#closeSettings').onclick = () => modal.classList.add('hidden');
    $('#saveSettings').onclick = () => { saveCfg(readSettings()); modal.classList.add('hidden'); toast('已保存模型设置'); };
    $('#testConn').onclick = testConn;
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    // 深色模式跟随系统；切换时立刻用新主题色重绘 SVG 画布。
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onTheme = () => { if (state.analysis) renderCanvas(); };
      if (mq.addEventListener) mq.addEventListener('change', onTheme);
      else if (mq.addListener) mq.addListener(onTheme);
    }

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
