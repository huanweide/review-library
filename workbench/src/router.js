// 应用路由（workbench）：hash 路由，切换视图不整页刷新。
// 路由目标必须是 manifest.views 里声明的 id —— 界面结构由后端清单决定，
// 前端不自己发明一个「后端没有的页面」，这就是一体的体现。

import { get, set, pushRecent } from './state.js';
import host from './host.js';

let onChange = null;

export function parseHash() {
  const h = String(location.hash || '').replace(/^#\/?/, '');
  const [rawId, qs] = h.split('?');
  const id = (rawId || 'home').trim();
  const params = {};
  new URLSearchParams(qs || '').forEach((v, k) => { params[k] = v; });
  return { id, params };
}

export function go(id, params) {
  const q = new URLSearchParams(params || {}).toString();
  location.hash = '#/' + id + (q ? '?' + q : '');
}

export function currentView() {
  const s = get();
  const { id } = parseHash();
  const views = (s.manifest && s.manifest.views) || [];
  return views.find(v => v.id === id) || views.find(v => v.id === 'home') || null;
}

function sync() {
  const { id, params } = parseHash();
  const s = get();
  const views = (s.manifest && s.manifest.views) || [];
  const valid = views.some(v => v.id === id) ? id : 'home';
  set({ route: valid, routeParams: params, commandOpen: false });
  if (valid !== 'home') pushRecent(valid);
  if (onChange) onChange(currentView(), params);
}

export function start(fn) {
  onChange = fn;
  window.addEventListener('hashchange', sync);
  if (!location.hash) location.replace('#/home');
  sync();
}

export default { go, start, currentView, parseHash };
