'use strict';
// 应用引导（workbench）。
// 顺序：读宿主 → 拉 manifest（唯一能力清单）→ 拉 state（真实数据）→ 建壳 → 起路由。
// 任何一步失败都给可操作的错误界面，不静默降级成假数据。

import host from './host.js';
import { get, set, subscribe, applyTheme } from './state.js';
import { mountShell, refreshShell, viewRoot } from './shell.js';
import { start, currentView, go } from './router.js';
import { renderView, loadForView } from './views.js';
import { el, clear } from './ui.js';

// 需要「一本书」才能工作的视图：URL 没 id、也没记住过书时，
// 若书库只有一本就自动带进去，不让用户从侧栏点进来先撞一堵空墙。
const BOOK_VIEWS = ['book', 'quiz', 'practice', 'due', 'attempt', 'rate'];
async function autoPickBook(v, params) {
  if (!v || BOOK_VIEWS.indexOf(v.id) < 0) return;
  if (params && params.id) return;
  if (get().lastBookId) return;
  try {
    const r = await host.action('list', {});
    const books = (r && r.ok && r.data && r.data.books) || [];
    if (books.length === 1) go(v.id, { id: books[0].id });
  } catch (e) { /* 拉不到就保留空态提示，不假装有书 */ }
}

function fatal(msg, detail) {
  const app = document.getElementById('app');
  clear(app);
  app.appendChild(el('div', { class: 'fatal' }, [
    el('div', { class: 'fatal-card' }, [
      el('h1', { text: '应用无法连接统一核心' }),
      el('p', { text: msg }),
      detail ? el('pre', { class: 'json', text: String(detail) }) : null,
      el('p', { class: 'fatal-hint', html:
        '本地服务形态：双击项目根 <code>启动.bat</code>，再打开 <code>http://localhost:5178/workbench/</code>。<br/>' +
        'DSH 形态：插件提供同源 <code>/review-analysis/api/app/*</code>，由面板注入 <code>window.__WORKBENCH_BASE__</code>。<br/>' +
        'Electron 形态：主进程已注册 <code>workbench:*</code> IPC。' }),
      el('button', { class: 'btn primary', text: '重试', onclick: () => location.reload() }),
    ]),
  ]));
}

async function boot() {
  applyTheme();
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (get().theme === 'system') applyTheme();
    });
  }
  set({ host: { kind: host.kind, label: host.label, base: host.base } });

  let manifest, state;
  try {
    manifest = await host.manifest();
  } catch (e) {
    return fatal('拿不到应用清单 manifest（能力清单来自 core/app-host.js）。', e.message || e);
  }
  if (!manifest || !manifest.ok || !Array.isArray(manifest.actions)) {
    return fatal('应用清单格式不正确或存在能力漂移。', JSON.stringify(manifest && manifest.drift || manifest, null, 2));
  }
  try {
    state = await host.state();
  } catch (e) {
    state = { bookCount: null, analyzedCount: null, actions: manifest.actions, coreVersion: '' };
  }

  set({
    ready: true,
    online: true,
    manifest,
    state,
    error: null,
  });

  mountShell();
  subscribe(() => {
    refreshShell();
    const v = currentView();
    renderView(viewRoot(), v, get().routeParams);
  });

  start(() => {
    refreshShell();
    const v = currentView();
    const params = get().routeParams;
    renderView(viewRoot(), v, params);
    // 数据加载只由路由变化触发：每次进视图都拿后端当前真数据，
    // 不因已缓存旧 data 而跳过（否则切回书架看不到刚建的书）。
    loadForView(v, params);
    autoPickBook(v, params);
  });
  refreshShell();

  // 注册 Service Worker（仅在安全上下文；不阻塞启动，失败不影响使用）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname })
      .catch(() => { /* 安装能力是增强项，失败不报错 */ });
  }

  // 暴露只读状态给自动化验收（不提供任何绕过协议的写入口）
  window.__WORKBENCH__ = {
    host: { kind: host.kind, label: host.label, base: host.base },
    state: () => get(),
    manifest: () => manifest,
  };
}

boot().catch(e => fatal('启动异常。', (e && e.stack) || e));
