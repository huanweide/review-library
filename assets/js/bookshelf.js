/**
 * bookshelf.js —— 考点罗盘 · 书架层（默认首屏）
 * 职责：渲染封面墙、打开书（注入 book-data.js → 调 BookApp.boot）、新建书、返回书架。
 * 铁律：零云端、零外链；书数据来自本地 books/<id>/book-data.js（file:// 也能加载本地脚本）。
 */
(function () {
  'use strict';
  const INDEX_KEY = '考点罗盘:v1:catalog';
  const BOOK_KEY = '考点罗盘:v1:book:';

  function rawGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function rawSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function getCatalog() {
    // API 优先：服务端 data.json 扫描派生书单，杜绝书单与数据漂移
    let base = [];
    const Api = window.TiandaoApi;
    if (Api) { try { base = await Api.listBooks(); } catch (e) { /* 回退静态 */ } }
    if (!base.length) base = (window.BOOK_INDEX || []).map(b => Object.assign({}, b, { builtin: true }));
    const cust = (rawGet(INDEX_KEY) || {}).custom || [];
    return base.concat(cust);
  }
  function getCustomBookData(id) { return rawGet(BOOK_KEY + id); }

  async function renderShelf() {
    const shelf = document.getElementById('bookshelf');
    if (!shelf) return;
    const books = await getCatalog();
    let html = `<div class="shelf-head">
        <div>
          <h1 class="shelf-title">我的备考书架</h1>
          <p class="shelf-sub">每种期末考试是一本独立的书 · 零云端 · 本地离线</p>
        </div>
        <button class="btn" id="new-book">＋ 新建一本书</button>
      </div>
      <div class="shelf-grid">`;
    books.forEach(b => {
      const cover = b.coverColor || '#2f6f4f';
      const accent = b.accent || '#e8b04b';
      html += `<button class="book-cover" data-id="${esc(b.id)}" style="--cover:${cover};--accent:${accent}">
          <span class="book-spine"></span>
          <span class="book-face">
            <span class="book-subject">${esc(b.subject || '')}</span>
            <span class="book-name">${esc(b.title)}</span>
            <span class="book-desc">${esc(b.desc || '')}</span>
            <span class="book-meta">${b.builtin ? '已内置' : '本地新建'}</span>
          </span>
        </button>`;
    });
    html += `</div>`;
    shelf.innerHTML = html;
    shelf.querySelectorAll('.book-cover').forEach(c => c.onclick = () => openBook(c.dataset.id));
    const nb = document.getElementById('new-book');
    if (nb) nb.onclick = openNewBookForm;
  }

  async function openBook(id) {
    let data = null;
    const Api = window.TiandaoApi;
    if (Api) { try { data = await Api.getBook(id); } catch (e) { /* 回退静态/本地 */ } }
    if (!data) data = window.BOOKS && window.BOOKS[id];
    if (!data) data = getCustomBookData(id);
    if (!data) { alert('找不到这本书：' + id); return; }
    launch(data);
  }

  function launch(data) {
    const shelf = document.getElementById('bookshelf');
    const app = document.getElementById('app');
    const back = document.getElementById('back-shelf');
    const sub = document.getElementById('app-subtitle');
    if (shelf) shelf.classList.add('hidden');
    if (app) app.classList.remove('hidden');
    if (back) back.classList.remove('hidden');
    if (sub) sub.textContent = (data.meta ? data.meta.title : '书') + ' · ' + ((data.meta && data.meta.subject) || '备考');
    if (window.BookApp) window.BookApp.boot(data);
  }

  // 返回书架（暴露给 ← 书架 按钮）
  window.returnToShelf = function () {
    const app = document.getElementById('app');
    const shelf = document.getElementById('bookshelf');
    const back = document.getElementById('back-shelf');
    if (app) app.classList.add('hidden');
    if (shelf) shelf.classList.remove('hidden');
    if (back) back.classList.add('hidden');
    renderShelf();
  };

  function openNewBookForm() {
    const id = 'b' + Date.now().toString(36);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const palette = ['#2f6f4f', '#7a4b2b', '#3a5a8c', '#6b3a6b', '#8c5a2b', '#2b6b6b'];
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
        <h2>新建一本书</h2>
        <label class="label" for="nb-title">书名</label>
        <input class="field" id="nb-title" placeholder="如：高等数学（上）" />
        <label class="label" for="nb-subject">科目 / 类型</label>
        <input class="field" id="nb-subject" placeholder="如：期末考试" />
        <label class="label">封面色</label>
        <div class="color-row" id="nb-colors">
          ${palette.map((c, i) => `<button type="button" class="swatch${i === 0 ? ' is-on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}
        </div>
        <p class="kg-type">新建后立刻可用（空题库）。把题目与资料交给「考点罗盘」助手，它会帮你生成并落盘到 <code>books/${esc(id)}/</code>。</p>
        <div class="qbar">
          <button class="btn" id="nb-create">创建</button>
          <button class="btn btn--ghost" id="nb-cancel">取消</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    let color = palette[0];
    overlay.querySelectorAll('.swatch').forEach(s => s.onclick = () => {
      color = s.dataset.c;
      overlay.querySelectorAll('.swatch').forEach(x => x.classList.remove('is-on'));
      s.classList.add('is-on');
    });
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const close = () => overlay.remove();
    document.getElementById('nb-cancel').onclick = close;
    document.getElementById('nb-create').onclick = () => {
      const title = document.getElementById('nb-title').value.trim();
      const subject = document.getElementById('nb-subject').value.trim() || '备考';
      if (!title) { alert('请填书名'); return; }
      const meta = { id, title, subject, coverColor: color, accent: '#e8b04b', syllabus: '', createdAt: new Date().toISOString().slice(0, 10) };
      const data = { meta, kaogang: [], tiku: [], tikuAns: {} };
      const cat = rawGet(INDEX_KEY) || { custom: [] };
      cat.custom = cat.custom || [];
      cat.custom.push({ id, title, subject, coverColor: color, accent: '#e8b04b', desc: '本地新建 · 空题库', builtin: false });
      rawSet(INDEX_KEY, cat);
      rawSet(BOOK_KEY + id, data);
      overlay.remove();
      renderShelf();
    };
  }

  // 启动：渲染书架
  const backBtn = document.getElementById('back-shelf');
  if (backBtn) backBtn.onclick = window.returnToShelf;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderShelf);
  else renderShelf();
})();
