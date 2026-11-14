'use strict';
// Service Worker（workbench）：只缓存应用自身的静态壳，实现「可安装 / 离线打开」。
// 关键边界：/api/ 与任何宿主协议端点一律**不缓存**，永远走网络取真数据。
// 否则 APP 会拿缓存里的旧书库冒充后端，违反「不造假」与「五形态同源」。

const CACHE = 'tiandao-workbench-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icons/icon.svg',
  './src/style.css', './src/main.js', './src/host.js', './src/state.js',
  './src/router.js', './src/ui.js', './src/views.js', './src/shell.js',
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
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
