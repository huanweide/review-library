'use strict';
// 书架：封面墙 + 收录入口。书架即收录。
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const Shelf = {
    async render() {
      let books = [];
      try { books = await API.books.list(); } catch (e) { books = []; }
      const grid = document.getElementById('book-grid');
      grid.innerHTML = '';

      // 收录卡（即收录入口）
      const add = document.createElement('div');
      add.className = 'book-card add-card';
      add.innerHTML = '<div class="add-plus">＋</div><div class="add-label">收录一本书</div>';
      add.onclick = () => App.openCreate();
      grid.appendChild(add);

      if (!books.length) {
        const tip = document.createElement('div');
        tip.className = 'shelf-tip';
        tip.textContent = '还没有书。点「＋ 收录一本书」，按 考试 + 科目 收一本。';
        grid.appendChild(tip);
      }

      books.forEach(b => {
        const layers = Object.keys(b.layerCounts || {}).map(Number).sort((x, y) => x - y)
          .map(l => '<span class="lb">L' + l + '·' + b.layerCounts[l] + '</span>').join('');
        const c = document.createElement('div');
        c.className = 'book-card';
        c.innerHTML =
          '<div class="cover" style="background:' + esc(b.coverColor) + '">' +
            '<div class="cover-title">' + esc(b.title) + '</div>' +
            '<div class="cover-sub">' + esc(b.exam || '') + '</div>' +
          '</div>' +
          '<div class="card-body">' +
            '<div class="card-subject">' + esc(b.subject || '未设科目') + '</div>' +
            '<div class="card-meta">资料 ' + (b.materialCount || 0) + ' · 层 ' + Object.keys(b.layerCounts || {}).length + '</div>' +
            '<div class="layer-badges">' + (layers || '<span class="lb dim">空</span>') + '</div>' +
          '</div>';
        c.onclick = () => App.openBook(b.id);
        grid.appendChild(c);
      });
    }
  };

  window.Shelf = Shelf;
  window.esc = esc;
})();
