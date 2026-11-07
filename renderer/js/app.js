'use strict';
// 应用路由 + 全局 modal（确认/输入）+ 收录书/添加资料/预览/设置/分析/练习 的交互接线。
(function () {
  const COLORS = ['#3a7afe', '#e0533d', '#1f9d72', '#8b5cf6', '#f59e0b', '#0ea5e9', '#db2777', '#475569'];
  let pickedColor = COLORS[0];

  const Modal = {
    confirm(msg, okText) {
      return new Promise(res => {
        const m = document.getElementById('confirm-modal');
        document.getElementById('confirm-msg').textContent = msg;
        const ok = document.getElementById('confirm-ok'), no = document.getElementById('confirm-no');
        ok.textContent = okText || '确定';
        const close = () => { m.classList.add('hidden'); ok.onclick = null; no.onclick = null; };
        ok.onclick = () => { close(); res(true); };
        no.onclick = () => { close(); res(false); };
        m.classList.remove('hidden');
      });
    },
    prompt(msg, def) {
      return new Promise(res => {
        const m = document.getElementById('prompt-modal');
        document.getElementById('prompt-msg').textContent = msg;
        const inp = document.getElementById('prompt-input');
        inp.value = def || '';
        const ok = document.getElementById('prompt-ok'), no = document.getElementById('prompt-no');
        const close = () => { m.classList.add('hidden'); ok.onclick = null; no.onclick = null; };
        ok.onclick = () => { close(); res(inp.value); };
        no.onclick = () => { close(); res(null); };
        m.classList.remove('hidden'); inp.focus();
      });
    }
  };

  const VIEWS = ['shelf', 'settings', 'book', 'search-view', 'report-view'];
  const PANES = ['materials', 'study', 'exam', 'weak', 'syllabus'];

  const App = {
    init() {
      Settings.init();
      // 封面色板
      const cc = document.getElementById('c-colors');
      COLORS.forEach((c, i) => {
        const s = document.createElement('span');
        s.className = 'swatch' + (i === 0 ? ' on' : '');
        s.style.background = c;
        s.onclick = () => { pickedColor = c; cc.querySelectorAll('.swatch').forEach(x => x.classList.remove('on')); s.classList.add('on'); };
        cc.appendChild(s);
      });
      // 全局导航
      document.getElementById('nav-shelf').onclick = () => App.showShelf();
      document.getElementById('nav-settings').onclick = () => App.showSettings();
      document.getElementById('nav-search').onclick = () => App.showSearch();
      document.getElementById('nav-report').onclick = () => App.showReport();
      // 收录书
      document.getElementById('c-cancel').onclick = () => document.getElementById('create-modal').classList.add('hidden');
      document.getElementById('c-ok').onclick = async () => {
        const title = document.getElementById('c-title').value.trim();
        if (!title) { alert('书名不能为空'); return; }
        await API.books.create({
          title,
          exam: document.getElementById('c-exam').value.trim(),
          subject: document.getElementById('c-subject').value.trim(),
          coverColor: pickedColor,
          note: document.getElementById('c-note').value.trim()
        });
        document.getElementById('create-modal').classList.add('hidden');
        Shelf.render();
      };
      // 添加资料
      document.getElementById('add-cancel').onclick = () => document.getElementById('add-modal').classList.add('hidden');
      document.getElementById('add-files').onchange = (e) => {
        const f = Array.from(e.target.files || []);
        BookView._pendingFiles = f;
        document.getElementById('add-files-info').textContent = f.length ? ('已选 ' + f.length + ' 个文件') : '未选择文件';
      };
      document.getElementById('add-ok').onclick = () => BookView.submitAdd();
      // 预览关闭
      document.getElementById('preview-close').onclick = () => document.getElementById('preview-modal').classList.add('hidden');
      // 书内按钮
      document.getElementById('back-shelf').onclick = () => App.showShelf();
      document.getElementById('add-mat').onclick = () => BookView.openAdd();
      document.getElementById('mat-search').oninput = (e) => { BookView.query = e.target.value; BookView.renderMaterials(); };
      const bindFilter = (id, key) => {
        document.getElementById(id).onchange = (e) => { BookView.filters[key] = e.target.value; BookView.renderMaterials(); };
      };
      bindFilter('f-source', 'source'); bindFilter('f-tag', 'tag');
      bindFilter('f-since', 'since'); bindFilter('f-ext', 'ext');
      document.getElementById('f-clear').onclick = () => BookView.clearFilters();
      document.getElementById('book-del').onclick = async () => {
        const b = BookView.data && BookView.data.book;
        const yes = await App.confirm('确定删除本书「' + (b ? b.title : '') + '」？删除后进回收站，可手动恢复。', '删除本书');
        if (!yes) return;
        await API.books.delete(BookView.id);
        App.showShelf();
      };
      document.getElementById('open-trash').onclick = () => App.openTrash();
      document.getElementById('trash-close').onclick = () => document.getElementById('trash-modal').classList.add('hidden');
      document.getElementById('gen-insight').onclick = () => App.generateInsight();
      // 书内三子页
      document.querySelectorAll('.book-tab').forEach(btn => {
        btn.onclick = () => App.showPane(btn.dataset.pane);
      });
      // 分析页
      document.getElementById('study-run').onclick = () => StudyUI.run();
      document.getElementById('study-save').onclick = () => StudyUI.save();
      document.getElementById('study-exam').onclick = () => StudyUI.makeExam(async paper => {
        await App.showPane('exam');
        ExamUI.show(paper);
        await ExamUI.renderList();
      });
      // 练习页
      document.getElementById('exam-submit').onclick = () => ExamUI.submit();
      document.getElementById('exam-remedial').onclick = () => ExamUI.remedial();
      document.getElementById('exam-new').onclick = () => ExamUI.newFromAnalysis();
      document.getElementById('exam-bank').onclick = () => ExamUI.newFromBank();
      document.getElementById('exam-review').onclick = () => ExamUI.review();
      // 考纲页「从题库出卷」：先切到练习页（会自动 enter 设置 bookId），再组卷
      document.getElementById('syllabus-exam').onclick = async () => {
        if (document.getElementById('syllabus-exam').disabled) return;
        await App.showPane('exam');
        await ExamUI.newFromBank();
      };
      document.getElementById('exam-feedback-save').onclick = () => ExamUI.saveFeedback();
      Settings.onChange(() => Settings.updateBadge());
      Shelf.render();
    },

    showView(name) {
      VIEWS.forEach(v => document.getElementById(v).classList.toggle('hidden', v !== name));
      document.getElementById('nav-shelf').classList.toggle('on', name === 'shelf');
      document.getElementById('nav-settings').classList.toggle('on', name === 'settings');
      document.getElementById('nav-search').classList.toggle('on', name === 'search-view');
      document.getElementById('nav-report').classList.toggle('on', name === 'report-view');
    },
    showShelf() { this.showView('shelf'); Shelf.render(); },
    showSettings() { this.showView('settings'); Settings.init(); },
    showSearch() { this.showView('search-view'); if (window.ExtraUI) ExtraUI.enterSearch(); },
    showReport() { this.showView('report-view'); if (window.ExtraUI) ExtraUI.enterReport(); },

    async openBook(id) {
      this.currentId = id;
      this.showView('book');
      await BookView.render(id);
      await this.showPane('materials');
    },

    async showPane(name) {
      PANES.forEach(p => document.getElementById('pane-' + p).classList.toggle('hidden', p !== name));
      document.querySelectorAll('.book-tab').forEach(b => b.classList.toggle('on', b.dataset.pane === name));
      Settings.updateBadge();
      if (name === 'study') await StudyUI.enter(this.currentId);
      if (name === 'exam') await ExamUI.enter(this.currentId);
      if (name === 'weak') await WeakUI.enter(this.currentId);
      if (name === 'syllabus') await SyllabusUI.enter(this.currentId);
    },

    openCreate() { document.getElementById('create-modal').classList.remove('hidden'); document.getElementById('c-title').focus(); },
    notice(msg, isErr) {
      const grid = document.getElementById('material-grid');
      const n = document.createElement('div');
      n.className = 'mat-notice' + (isErr ? ' err' : '');
      n.textContent = msg;
      grid.insertBefore(n, grid.firstChild);
    },
    async generateInsight() {
      const p = await App.prompt('复习要求提示词（例如：重点看相图与结晶部分）。系统按层权重 + 关键词从本地资料抽重点，不联网、不用模型。', '重点看');
      if (p == null || !String(p).trim()) return;
      const r = await API.insight.generate(BookView.id, String(p).trim());
      if (!r || !r.ok) {
        await BookView.render(BookView.id);
        this.notice('未生成：' + ((r && r.reason) || '未知原因'), true);
        return;
      }
      await BookView.render(BookView.id);
      this.notice('已生成系统复习提纲（L1），命中 ' + r.sourceCount + ' 份资料，来源已回链。', false);
    },
    async openTrash() {
      await this.renderTrash();
      document.getElementById('trash-modal').classList.remove('hidden');
    },
    async renderTrash() {
      let items = [];
      try { items = await API.trash.list(); } catch (e) { items = []; }
      const cnt = document.getElementById('trash-count'); if (cnt) cnt.textContent = items.length;
      const el = document.getElementById('trash-list'); el.innerHTML = '';
      if (!items.length) { el.innerHTML = '<div class="empty">回收站是空的。</div>'; return; }
      items.forEach(it => {
        const d = document.createElement('div'); d.className = 'trash-item';
        const when = new Date(it.deletedAt).toLocaleString('zh-CN');
        const typeLabel = it.type === 'book' ? '📚 书' : '📄 资料';
        d.innerHTML = '<div class="trash-info"><span class="trash-type">' + typeLabel + '</span>' +
          '<span class="trash-name">' + esc(it.name) + '</span>' +
          '<span class="trash-when">' + when + '</span></div>' +
          '<div class="trash-actions"><button class="btn sm primary" data-act="restore">恢复</button>' +
          '<button class="btn sm ghost danger" data-act="purge">彻底删除</button></div>';
        d.querySelector('[data-act="restore"]').onclick = async () => {
          await API.trash.restore({ key: it.key, type: it.type });
          await this.renderTrash(); Shelf.render();
        };
        d.querySelector('[data-act="purge"]').onclick = async () => {
          const yes = await App.confirm('彻底删除「' + it.name + '」？此操作不可恢复。', '彻底删除');
          if (!yes) return;
          await API.trash.purge(it.key);
          await this.renderTrash();
        };
        el.appendChild(d);
      });
    },
    confirm: Modal.confirm, prompt: Modal.prompt
  };

  window.App = App;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', App.init);
  else App.init();
})();
