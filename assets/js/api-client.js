/**
 * api-client.js —— 天道书院 · 前端数据入口（API 优先，静态回退）
 *
 * 通过端口访问时走真服务（服务端 data.json 为唯一真源）；
 * file:// 双击打开时自动回退 window.BOOK_INDEX / window.BOOKS[id]（保留罗盘零依赖特性）。
 * 零外链、零凭据、零调试输出。
 */
(function (global) {
  'use strict';
  const Api = {};
  function isFile() { return (global.location && global.location.protocol === 'file:'); }
  async function j(url, opt) {
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  Api.isFile = isFile;
  Api.health = async function () {
    if (isFile()) return null;
    try { return await j('/api/health'); } catch (e) { return null; }
  };
  Api.listBooks = async function () {
    if (!isFile()) {
      try { return await j('/api/books'); } catch (e) { /* 服务不可用 → 静态回退 */ }
    }
    return (global.BOOK_INDEX || []).map(b => Object.assign({}, b, { builtin: true }));
  };
  Api.getBook = async function (id) {
    if (!isFile()) {
      try { return await j('/api/books/' + encodeURIComponent(id)); } catch (e) { /* 回退 */ }
    }
    if (global.BOOKS && global.BOOKS[id]) return global.BOOKS[id];
    // 静态回退：按需注入 book-data.js（file:// 下也能加载本地脚本）
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'books/' + encodeURIComponent(id) + '/book-data.js';
      s.onload = () => (global.BOOKS && global.BOOKS[id])
        ? resolve(global.BOOKS[id])
        : reject(new Error('书数据不存在'));
      s.onerror = () => reject(new Error('书数据加载失败'));
      document.body.appendChild(s);
    });
  };
  Api.importBook = async function (payload) {
    return j('/api/books/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  };
  global.TiandaoApi = Api;
})(typeof window !== 'undefined' ? window : globalThis);
