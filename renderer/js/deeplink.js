'use strict';
// 统一工作台深链桥（2026-11-14）。
//
// 作用：从 portal.html 点某个功能进来时，URL 带 #v=xxx，本脚本把页面切到对应
// tab / view。做法只有一种 —— 找到页面上真实存在的那个按钮，调用它的 .click()，
// 走的是页面原本绑定的 onclick / addEventListener，不复制、不改写任何业务逻辑。
//
// 设计约束（改这个文件前先读）：
//   1) 没有 hash 时立刻 return，对现有页面零影响。所有既有 e2e / 判别测试都直接
//      goto /index.html、/core.html（不带 hash），因此不会因本文件回归。
//   2) 不新增 DOM id / class 契约，不依赖任何内部函数（App.showXxx、switchTab
//      都是闭包内的，外部取不到），只按「按钮存在」这一个事实行动。
//   3) 同一份脚本给 index.html 与 core.html 共用：先试全局导航按钮，再试 tab，
//      最后试模型设置。哪个存在点哪个，靠页面自身结构消歧，不写 if (页面名)。
//   4) 页面脚本在 DOMContentLoaded 里绑定 onclick，故轮询等元素出现后再稍等
//      一拍再点击；最多等 3 秒，超时静默放弃（绝不弹错、绝不改页面状态）。
//
// hash 契约（portal.html 与这里一一对应，加项必须两边同时加）：
//   index.html : #v=shelf | search | review | report | settings
//   core.html  : #v=mindmap | questions | practice | summary | settings
(function () {
  var h = window.location.hash || '';
  if (!h) return;
  var m = /(?:^#|&)v=([a-z0-9_-]+)/i.exec(h);
  if (!m) return;
  var v = m[1].toLowerCase();

  var NAV = {
    shelf: '#nav-shelf',
    search: '#nav-search',
    review: '#nav-review',
    report: '#nav-report'
  };
  var TAB = {
    mindmap: 'mindmap',
    questions: 'questions',
    practice: 'practice',
    summary: 'summary'
  };

  function pick() {
    if (NAV[v]) {
      var nav = document.querySelector(NAV[v]);
      if (nav) return nav;
    }
    if (TAB[v]) {
      var tab = document.querySelector('.tab[data-tab="' + TAB[v] + '"]');
      if (tab) return tab;
    }
    if (v === 'settings') {
      // index.html 的设置是顶部导航；core.html 的设置是右上角弹窗按钮。
      return document.querySelector('#nav-settings') || document.querySelector('#openSettings');
    }
    return null;
  }

  var tries = 0;
  function tick() {
    var el = pick();
    if (el) {
      // 元素已出现，再等一拍让页面自己的 init/bind 把 onclick 挂上。
      setTimeout(function () { try { el.click(); } catch (e) { /* 静默 */ } }, 120);
      return;
    }
    if (++tries < 30) setTimeout(tick, 100);
  }

  function start() { setTimeout(tick, 60); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
