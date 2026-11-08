'use strict';
// 全局拖入 + 打开文件：把 OS / 浏览器里的资料直接拖进应用，或点「打开文件」选入。
// 路由规则：书架视图→新建一本书并收录；书内视图→加入当前书第 1 层（落在具体层上则由 book.js 接管）。
// 零云端硬约束：所有文件经本地主进程 / 浏览器 File API 处理，绝不外发。
(function () {
  const COLORS = ['#3a7afe', '#e0533d', '#1f9d72', '#8b5cf6', '#f59e0b', '#0ea5e9', '#db2777', '#475569'];
  const esc = (s) => (window.esc || (x => x))(s);
  const $ = (id) => document.getElementById(id);

  // 轻量 toast（供 settings.js 的自检也复用）
  function toast(msg, isErr) {
    let t = $('import-toast');
    if (!t) { t = document.createElement('div'); t.id = 'import-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'import-toast show' + (isErr ? ' err' : '');
    clearTimeout(t._t); t._t = setTimeout(() => { t.className = 'import-toast'; }, 3400);
  }

  const Overlay = {
    el: null,
    show(text) {
      if (!this.el) this.el = $('drop-overlay');
      if (!this.el) return;
      if (text) { const t = this.el.querySelector('.drop-text'); if (t) t.textContent = text; }
      this.el.classList.add('show');
      document.body.classList.add('is-dragging');
    },
    hide() {
      if (this.el) this.el.classList.remove('show');
      document.body.classList.remove('is-dragging');
    }
  };

  function currentView() {
    if ($('book') && !$('book').classList.contains('hidden')) return 'book';
    if ($('shelf') && !$('shelf').classList.contains('hidden')) return 'shelf';
    return 'other';
  }

  async function importToNewBook(files) {
    if (!files || !files.length) return;
    const first = (files[0].name || '新资料').replace(/\.[^.]+$/, '');
    const title = await App.prompt('给这本书起个名（考试 + 科目，例如：材料科学基础）：', first);
    if (title == null) return; // 用户取消
    const name = String(title).trim() || first;
    try {
      const b = await API.books.create({
        title: name, exam: '', subject: '',
        coverColor: COLORS[Math.floor(Math.random() * COLORS.length)], note: ''
      });
      const id = b && (b.id || (b.book && b.book.id));
      if (!id) { toast('建书失败：未返回书目 ID', true); return; }
      await App.openBook(id);
      await BookView.uploadFiles(files, 1);
      Shelf.render();
      toast('已收录《' + name + '》并导入 ' + files.length + ' 份资料');
    } catch (e) { toast('收录失败：' + (e.message || e), true); }
  }

  // 统一的落盘路由：files = FileList/Array；targetEl = 真实 drop 目标（拖放事件冒泡前的原始节点）
  async function routeDrop(files, targetEl) {
    if (!files || !files.length) return;
    const view = currentView();
    // 书内视图且落在具体层上：book.js 的 layerItem.ondrop 已处理，这里不重复导入
    if (view === 'book' && targetEl && targetEl.closest && targetEl.closest('.layer-item')) return;
    if (view === 'book') {
      await BookView.uploadFiles(files, 1);
      toast('已向当前书导入 ' + files.length + ' 份资料（第 1 层）');
    } else if (view === 'shelf') {
      await importToNewBook(files);
    } else {
      App.showShelf();
      await importToNewBook(files);
    }
  }

  function openFiles() { const inp = $('global-open-files'); if (inp) inp.click(); }

  async function onPicked(files) {
    if (!files || !files.length) return;
    const view = currentView();
    if (view === 'book') { await BookView.uploadFiles(files, 1); toast('已导入 ' + files.length + ' 份资料（第 1 层）'); }
    else { await importToNewBook(files); }
  }

  function init() {
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    document.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return; e.preventDefault(); depth++;
      Overlay.show(currentView() === 'book' ? '松手即可导入当前书（第 1 层）' : '松手即可新建一本书并收录');
    });
    document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('dragleave', (e) => {
      if (!e.dataTransfer) return; depth--; if (depth <= 0) { depth = 0; Overlay.hide(); }
    });
    document.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; Overlay.hide();
      await routeDrop(e.dataTransfer.files, e.target);
    });

    const btn = $('open-files');
    if (btn) btn.onclick = () => openFiles();
    const inp = $('global-open-files');
    if (inp) inp.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) onPicked(files);
    };
  }

  window.ImportDrop = { init, openFiles, importToNewBook, toast };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
