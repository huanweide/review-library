'use strict';
// 书内视图：层级面板（层重要性视觉）+ 资料网格 + 上传(拖拽/批量) + 预览 + 删除 + 移层 + 搜索。
(function () {
  function esc(s) { return (window.esc || (x => x))(s); }
  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve({ name: file.name, data: (fr.result || '').split(',')[1] || '' });
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function b64ToU8(b64) {
    const bin = atob(b64 || '');
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  // 上传前的预处理：PDF 在本地用 pdfjs 抽文字+逐页图，作为 extractedText 与 assets 随资料入库。
  // 其余类型（PPTX/DOCX 的媒体由主进程抽；散图直接存）维持原样。
  async function prepItem(file) {
    const base = await fileToB64(file);
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (ext === '.pdf' && window.PdfExtract) {
      try {
        const r = await window.PdfExtract.extractPdf(b64ToU8(base.data));
        if (r && (r.assets.length || r.extractedText)) {
          return Object.assign({}, base, { extractedText: r.extractedText || '', assets: r.assets || [] });
        }
      } catch (e) { /* PDF 抽取失败则退回纯文件入库，至少资料不丢 */ }
    }
    return base;
  }
  function extLabel(ext) { return (ext || '?').replace('.', '').toUpperCase().slice(0, 4); }

  function extGroup(ext) {
    const e = (ext || '').toLowerCase();
    if (e === '.pdf') return 'pdf';
    if (['.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx'].includes(e)) return 'office';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(e)) return 'image';
    if (['.txt', '.md'].includes(e)) return 'text';
    return 'other';
  }

  const BookView = {
    id: null, data: null, filterLayer: 'all', query: '', _pendingFiles: null,
    filters: { source: 'all', tag: 'all', since: 'all', ext: 'all' },

    async render(id) {
      this.id = id; this.filterLayer = 'all'; this.query = '';
      this.filters = { source: 'all', tag: 'all', since: 'all', ext: 'all' };
      this.data = await API.books.get(id);
      const b = this.data.book;
      document.getElementById('book-title').textContent = b.title;
      document.getElementById('book-sub').textContent = [b.exam, b.subject].filter(Boolean).join(' · ');
      document.getElementById('mat-search').value = '';
      this.resetFilterControls();
      this.renderTagOptions();
      this.renderLayers();
      this.renderMaterials();
    },

    resetFilterControls() {
      ['f-source', 'f-tag', 'f-since', 'f-ext'].forEach(k => {
        const el = document.getElementById(k); if (el) el.value = 'all';
      });
    },

    // 标签下拉从本书真实标签动态生成，不写死、不造选项
    renderTagOptions() {
      const sel = document.getElementById('f-tag'); if (!sel) return;
      const tags = new Set();
      (this.data.materials || []).forEach(m => (m.tags || []).forEach(t => tags.add(t)));
      const cur = this.filters.tag;
      sel.innerHTML = '<option value="all">全部</option>';
      [...tags].sort().forEach(t => {
        const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o);
      });
      sel.value = tags.has(cur) ? cur : 'all';
      this.filters.tag = sel.value;
    },

    clearFilters() {
      this.filterLayer = 'all'; this.query = '';
      this.filters = { source: 'all', tag: 'all', since: 'all', ext: 'all' };
      const s = document.getElementById('mat-search'); if (s) s.value = '';
      this.resetFilterControls();
      this.renderLayers(); this.renderMaterials();
    },

    renderLayers() {
      const mats = this.data.materials;
      const layers = new Set(mats.map(m => m.layer));
      const maxLayer = Math.max(1, ...[...layers]);
      const panel = document.getElementById('layers');
      panel.innerHTML = '';
      panel.appendChild(this.layerItem('all', '全部资料', mats.length, false));
      for (let l = 1; l <= maxLayer; l++) {
        const cnt = mats.filter(m => m.layer === l).length;
        panel.appendChild(this.layerItem(l, '第 ' + l + ' 层', cnt, l === 1));
      }
    },

    layerItem(val, label, cnt, isCore) {
      const d = document.createElement('div');
      d.className = 'layer-item' + (isCore ? ' core' : '') + (String(this.filterLayer) === String(val) ? ' active' : '');
      d.innerHTML = '<span class="layer-name">' + label + (isCore ? ' <em>核心</em>' : '') + '</span><span class="layer-count">' + cnt + '</span>';
      d.onclick = () => { this.filterLayer = val; this.renderLayers(); this.renderMaterials(); };
      d.ondragover = (e) => { e.preventDefault(); d.classList.add('drag-over'); };
      d.ondragleave = () => d.classList.remove('drag-over');
      d.ondrop = (e) => { e.preventDefault(); d.classList.remove('drag-over'); this.uploadFiles(e.dataTransfer.files, Number(val)); };
      return d;
    },

    renderMaterials() {
      const mats = this.data.materials.slice();
      const q = this.query.trim().toLowerCase();
      const f = this.filters;
      let list = mats;
      // 组合检索：层 / 关键词 / 来源 / 标签 / 时间 / 类型 六者同时成立（AND）
      if (this.filterLayer !== 'all') list = list.filter(m => m.layer === Number(this.filterLayer));
      if (q) list = list.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.tags || []).join(' ').toLowerCase().includes(q) ||
        (m.prompt || '').toLowerCase().includes(q));
      if (f.source !== 'all') list = list.filter(m => (m.source || 'user') === f.source);
      if (f.tag !== 'all') list = list.filter(m => (m.tags || []).includes(f.tag));
      if (f.since !== 'all') {
        const cut = Date.now() - Number(f.since) * 86400000;
        list = list.filter(m => (m.addedAt || 0) >= cut);
      }
      if (f.ext !== 'all') list = list.filter(m => extGroup(m.ext) === f.ext);
      list.sort((a, b) => a.layer - b.layer || a.addedAt - b.addedAt);

      const cnt = document.getElementById('mat-count');
      if (cnt) cnt.textContent = '命中 ' + list.length + ' / 共 ' + mats.length;
      const grid = document.getElementById('material-grid');
      grid.innerHTML = '';
      if (!list.length) {
        grid.innerHTML = '<div class="empty">当前组合条件下没有资料。点「清空筛选」回到全部，或换个条件。</div>';
        return;
      }
      list.forEach(m => grid.appendChild(this.matCard(m)));
    },

    matCard(m) {
      const d = document.createElement('div');
      d.className = 'mat-card';
      const srcBadge = m.source === 'system' ? '<span class="badge system">系统/AI</span>' : '<span class="badge user">用户</span>';
      const tags = (m.tags || []).map(t => '<span class="tag">' + esc(t) + '</span>').join('');
      const prompt = m.prompt ? '<div class="mat-prompt">要求：' + esc(m.prompt) + '</div>' : '';
      const derived = (m.derivedFrom && m.derivedFrom.length)
        ? '<div class="mat-derived">来源回链 ' + m.derivedFrom.length + ' 份资料</div>' : '';
      d.innerHTML =
        '<div class="mat-top"><span class="ftype">' + extLabel(m.ext) + '</span>' +
          '<span class="layer-chip">L' + m.layer + '</span>' + srcBadge + '</div>' +
        '<div class="mat-name" title="' + esc(m.name) + '">' + esc(m.name) + '</div>' +
        (tags ? '<div class="mat-tags">' + tags + '</div>' : '') + prompt + derived +
        '<div class="mat-actions">' +
          '<button class="btn sm" data-act="view">预览</button>' +
          '<button class="btn sm ghost" data-act="move">移层</button>' +
          '<button class="btn sm ghost danger" data-act="del">删除</button>' +
        '</div>';
      d.querySelector('[data-act="view"]').onclick = () => this.preview(m);
      d.querySelector('[data-act="move"]').onclick = () => this.move(m);
      d.querySelector('[data-act="del"]').onclick = () => this.del(m);
      return d;
    },

    async preview(m) {
      const r = await API.materials.read(this.id, m.id);
      const out = await Preview.render(r, { bookId: this.id, matId: m.id });
      const body = document.getElementById('preview-body');
      body.innerHTML = '';
      if (out.kind === 'img') {
        const img = document.createElement('img');
        img.className = 'prev-img'; img.src = out.src; img.alt = m.name;
        body.appendChild(img);
      } else if (out.kind === 'iframe') {
        const f = document.createElement('iframe');
        f.className = 'prev-iframe'; f.src = out.src; f.title = m.name;
        body.appendChild(f);
      } else if (out.kind === 'srcdoc') {
        // sandbox="" 禁脚本/表单/弹窗，样式仍生效；HTML 已在 Preview 内经 DOMPurify 清洗。
        const f = document.createElement('iframe');
        f.className = 'prev-iframe'; f.setAttribute('sandbox', ''); f.srcdoc = out.html; f.title = m.name;
        body.appendChild(f);
      } else {
        const d = document.createElement('div');
        d.className = 'prev-info';
        d.innerHTML = '<p>' + esc(out.reason || '此类型浏览器不能直接预览。') + '</p>' +
          '<a class="dl" href="' + out.url + '" download="' + esc(out.name || m.name) + '">下载「' + esc(out.name || m.name) + '」后查看</a>';
        body.appendChild(d);
      }
      document.getElementById('preview-title').textContent = m.name;
      document.getElementById('preview-modal').classList.remove('hidden');
    },

    async del(m) {
      const yes = await App.confirm('确定删除「' + m.name + '」？删除后进回收站，可手动恢复。', '删除');
      if (!yes) return;
      await API.materials.delete(this.id, m.id);
      this.data = await API.books.get(this.id);
      this.renderTagOptions();
      this.renderLayers(); this.renderMaterials();
    },

    async move(m) {
      const v = await App.prompt('移动到第几层（数字，1 = 核心提纲层）？', String(m.layer));
      if (v == null) return;
      const l = parseInt(v, 10);
      if (!l || l < 1) return;
      await API.materials.move(this.id, m.id, l);
      this.data = await API.books.get(this.id);
      this.renderTagOptions();
      this.renderLayers(); this.renderMaterials();
    },

    async uploadFiles(fileList, layer) {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      const items = await Promise.all(files.map(f => prepItem(f)));
      await API.materials.add(this.id, layer, items, { prompt: '', tags: [] });
      this.data = await API.books.get(this.id);
      this.renderTagOptions();
      this.renderLayers(); this.renderMaterials();
    },

    async submitAdd() {
      const files = this._pendingFiles || [];
      if (!files.length) return;
      const layer = parseInt(document.getElementById('add-layer').value, 10) || 1;
      const prompt = document.getElementById('add-prompt').value;
      const tags = document.getElementById('add-tags').value.split(/[,，\s]+/).filter(Boolean);
      const items = await Promise.all(files.map(f => prepItem(f)));
      await API.materials.add(this.id, layer, items, { prompt, tags });
      this._pendingFiles = null;
      document.getElementById('add-modal').classList.add('hidden');
      this.data = await API.books.get(this.id);
      this.renderTagOptions();
      this.renderLayers(); this.renderMaterials();
    },

    openAdd() {
      this._pendingFiles = null;
      document.getElementById('add-files').value = '';
      document.getElementById('add-files-info').textContent = '未选择文件';
      document.getElementById('add-layer').value = '1';
      document.getElementById('add-prompt').value = '';
      document.getElementById('add-tags').value = '';
      document.getElementById('add-modal').classList.remove('hidden');
    }
  };

  window.BookView = BookView;
})();
