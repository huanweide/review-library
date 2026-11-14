// 应用状态（workbench）：单一状态树 + 订阅，视图只从状态读，不各自缓存。
// 与「唯一核心」同理：界面状态也只留一份，避免多个视图各存一份导致显示不一致。

const S = {
  ready: false,
  online: false,
  error: null,
  host: { kind: 'unknown', label: '检测中' },
  manifest: null,
  state: null,
  route: 'home',
  routeParams: {},
  theme: localStorage.getItem('wb-theme') || 'system',
  density: localStorage.getItem('wb-density') || 'comfortable',
  busy: false,
  toast: null,
  commandOpen: false,
  recent: JSON.parse(localStorage.getItem('wb-recent') || '[]'),
  lastBookId: localStorage.getItem('wb-last-book') || '',  // 记住上次打开的书：进「题目/练习」不再空死路
  views: {},           // 各视图的临时数据（如书列表、练习结果）
};

const subs = new Set();

export function get() { return S; }
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

export function set(patch) {
  Object.assign(S, patch);
  subs.forEach(fn => { try { fn(S); } catch (e) { console.error('[wb state] subscriber', e); } });
}

export function setViewData(id, patch) {
  S.views[id] = Object.assign({}, S.views[id] || {}, patch);
  subs.forEach(fn => { try { fn(S); } catch (e) { /* 单个订阅失败不影响其余 */ } });
}

export function toast(msg, kind) {
  set({ toast: { msg: String(msg || ''), kind: kind || 'info', at: Date.now() } });
  setTimeout(() => { if (S.toast && Date.now() - S.toast.at >= 2600) set({ toast: null }); }, 2700);
}

export function pushRecent(viewId) {
  const next = [viewId].concat(S.recent.filter(x => x !== viewId)).slice(0, 6);
  S.recent = next;
  try { localStorage.setItem('wb-recent', JSON.stringify(next)); } catch (e) { /* 隐私模式 */ }
  set({});
}

export function setTheme(v) {
  S.theme = v;
  try { localStorage.setItem('wb-theme', v); } catch (e) { /* 忽略 */ }
  applyTheme();
  set({});
}
export function setDensity(v) {
  S.density = v;
  try { localStorage.setItem('wb-density', v); } catch (e) { /* 忽略 */ }
  document.documentElement.setAttribute('data-density', v);
  set({});
}

export function applyTheme() {
  const dark = S.theme === 'dark' ||
    (S.theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export default { get, subscribe, set, setViewData, toast, pushRecent, setTheme, setDensity, applyTheme };
