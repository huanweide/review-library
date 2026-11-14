'use strict';
// Service Worker（workbench）：只缓存应用自身的静态壳，实现「可安装 / 离线打开」。
// 关键边界：/api/ 与任何宿主协议端点一律**不缓存**，永远走网络取真数据。
// 否则 APP 会拿缓存里的旧书库冒充后端，违反「不造假」与「五形态同源」。

// 缓存策略：**网络优先，缓存兜底**（2026-11-14 订正）。
// 早先是缓存优先，结果改完 JS 刷新页面仍跑旧代码，被误判成「修了没生效」。
// 这个应用是本地服务形态、按需离线，网络优先才是正确取舍：在线永远拿最新，
// 断网才回落到缓存壳；缓存同时被静默更新，安装态也不会落后。
const CACHE = 'tiandao-workbench-v3';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icons/icon.svg',
  './src/style.css', './src/main.js', './src/host.js', './src/state.js',
  './src/router.js', './src/ui.js', './src/views.js', './src/shell.js',
  './src/bookspace.js', './src/mindmap.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // 写操作一律不缓存
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 零外链
  if (url.pathname.includes('/api/')) return;      // 协议端点必须实时
  if (url.search) return;                          // 带查询的动态请求不缓存

  e.respondWith(
    fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
