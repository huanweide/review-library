// 应用壳（workbench）：标题栏 / 侧边导航 / 内容区 / 状态栏 / 命令面板 / 安装入口。
// 导航**完全由 manifest.views 生成**，加一个能力只改后端清单，界面自动多一项。

import { get, subscribe, set, toast, pushRecent } from './state.js';
import { go } from './router.js';
import { el, h, clear, badge } from './ui.js';
import host from './host.js';

let dom = {};

export function mountShell() {
  const app = document.getElementById('app');
  clear(app);

  const titlebar = el('header', { class: 'titlebar' });
  const sidebar = el('aside', { class: 'sidebar' });
  const main = el('main', { class: 'content', id: 'view-root' });
  const statusbar = el('footer', { class: 'statusbar' });
  const palette = el('div', { class: 'palette-backdrop hidden', id: 'palette' });
  const toaster = el('div', { class: 'toaster', id: 'toaster' });

  app.appendChild(titlebar);
  app.appendChild(el('div', { class: 'workspace' }, [sidebar, main]));
  app.appendChild(statusbar);
  app.appendChild(palette);
  app.appendChild(toaster);

  dom = { app, titlebar, sidebar, main, statusbar, palette, toaster };
  renderTitlebar();
  renderSidebar();
  renderStatusbar();
  renderPalette();
  bindKeys();
  return dom;
}

/* ---------- 标题栏 ---------- */
function renderTitlebar() {
  const s = get(), m = s.manifest || {};
  const view = (m.views || []).find(v => v.id === s.route);
  clear(dom.titlebar);
  dom.titlebar.appendChild(el('div', { class: 'tb-left' }, [
    el('div', { class: 'tb-mark', text: '书' }),
    el('div', { class: 'tb-brand' }, [
      el('strong', { text: (m.app && m.app.name) || '天道书阁' }),
      el('span', { text: 'Workbench' }),
    ]),
    el('span', { class: 'tb-ver', text: 'v' + ((m.app && m.app.version) || '—') }),
  ]));
  dom.titlebar.appendChild(el('div', { class: 'tb-center' }, [
    el('span', { class: 'crumb', text: (view && view.group) || '总览' }),
    el('span', { class: 'crumb-sep', text: '/' }),
    el('span', { class: 'crumb cur', text: (view && view.label) || '启动台' }),
  ]));
  dom.titlebar.appendChild(el('div', { class: 'tb-right' }, [
    el('button', { class: 'tb-btn', title: '命令面板 (Ctrl+K)', text: '⌘ 搜索', onclick: togglePalette }),
    el('button', { class: 'tb-btn ghost', title: '刷新当前视图', text: '↻', onclick: () => {
      const v = (get().manifest.views || []).find(x => x.id === get().route);
      if (v) go(v.id, get().routeParams);
      location.reload();
    } }),
    el('span', { class: 'connection ' + (s.online ? 'on' : 'off') }, [
      el('i', { class: 'dot' }), el('span', { text: s.online ? '在线' : '离线' }),
    ]),
  ]));
}

/* ---------- 侧边导航（清单驱动） ---------- */
function renderSidebar() {
  const s = get(), m = s.manifest || {};
  clear(dom.sidebar);
  const groups = m.groups || [];
  const views = m.views || [];
  groups.forEach(g => {
    const items = views.filter(v => v.group === g);
    if (!items.length) return;
    dom.sidebar.appendChild(el('div', { class: 'nav-group' }, [
      el('div', { class: 'nav-group-title', text: g }),
      ...items.map(v => el('button', {
        class: 'nav-item' + (s.route === v.id ? ' active' : ''),
        onclick: () => go(v.id, get().routeParams && get().routeParams.id ? { id: get().routeParams.id } : {}),
        title: v.desc || v.label,
      }, [
        el('span', { class: 'nav-icon', text: v.icon || '·' }),
        el('span', { class: 'nav-label', text: v.label }),
        v.action ? el('span', { class: 'nav-action', text: v.action }) : null,
      ])),
    ]));
  });
  dom.sidebar.appendChild(el('div', { class: 'side-foot' }, [
    el('div', { class: 'side-host', text: '宿主：' + s.host.label }),
    el('button', { class: 'side-install hidden', id: 'install-btn', text: '安装为应用', onclick: doInstall }),
  ]));
  updateInstallButton();
}

/* ---------- 状态栏 ---------- */
function renderStatusbar() {
  const s = get(), st = s.state || {}, m = s.manifest || {};
  clear(dom.statusbar);
  dom.statusbar.appendChild(el('div', { class: 'sb-left' }, [
    el('span', { class: 'sb-item' + (s.online ? ' ok' : ' bad'), text: '● ' + (s.online ? '统一核心已连接' : '未连接') }),
    el('span', { class: 'sb-item', text: (st.bookCount != null ? st.bookCount : '—') + ' 本书' }),
    el('span', { class: 'sb-item', text: (st.analyzedCount != null ? st.analyzedCount : '—') + ' 已分析' }),
  ]));
  dom.statusbar.appendChild(el('div', { class: 'sb-right' }, [
    el('span', { class: 'sb-item', text: (m.actions || []).length + ' 能力' }),
    el('span', { class: 'sb-item', text: '协议 v' + (m.protocol || '—') }),
    el('span', { class: 'sb-item', text: s.host.kind }),
  ]));
}

/* ---------- 命令面板 ---------- */
let paletteQuery = '';
function renderPalette() {
  const s = get(), views = (s.manifest && s.manifest.views) || [];
  const q = paletteQuery.trim().toLowerCase();
  const list = views.filter(v => !q || (v.label + ' ' + v.id + ' ' + (v.desc || '')).toLowerCase().includes(q));
  clear(dom.palette);
  dom.palette.appendChild(el('div', { class: 'palette' }, [
    el('div', { class: 'palette-search' }, [
      el('span', { class: 'palette-icon', text: '⌕' }),
      (() => { const i = el('input', { class: 'palette-input', placeholder: '搜索视图或能力…（Esc 关闭）', value: paletteQuery });
        i.addEventListener('input', e => { paletteQuery = e.target.value; renderPalette(); focusPaletteInput(); });
        i.addEventListener('keydown', e => {
          if (e.key === 'Enter' && list.length) { go(list[0].id); togglePalette(false); }
          if (e.key === 'Escape') togglePalette(false);
        });
        return i; })(),
    ]),
    el('div', { class: 'palette-list' }, list.length ? list.slice(0, 12).map((v, i) =>
      el('button', { class: 'palette-row' + (i === 0 ? ' first' : ''), onclick: () => { go(v.id); togglePalette(false); } }, [
        el('span', { class: 'palette-ricon', text: v.icon || '·' }),
        el('span', { class: 'palette-rtext' }, [
          el('strong', { text: v.label }),
          el('small', { text: v.desc || '' }),
        ]),
        v.action ? badge(v.action, 'plain') : null,
      ])) : [el('div', { class: 'palette-empty', text: '没有匹配的视图' })]),
    el('div', { class: 'palette-foot', text: '视图列表来自 core/app-host.js 的 manifest，不是前端写死的' }),
  ]));
  dom.palette.onclick = e => { if (e.target === dom.palette) togglePalette(false); };
}
function focusPaletteInput() {
  const i = dom.palette.querySelector('.palette-input');
  if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
export function togglePalette(force) {
  const s = get();
  const open = typeof force === 'boolean' ? force : !s.commandOpen;
  set({ commandOpen: open });
  dom.palette.classList.toggle('hidden', !open);
  if (open) { paletteQuery = ''; renderPalette(); focusPaletteInput(); }
}

/* ---------- 快捷键 ---------- */
function bindKeys() {
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); togglePalette(); }
    if (e.key === 'Escape' && get().commandOpen) togglePalette(false);
  });
}

/* ---------- PWA 安装 ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; updateInstallButton(); });
function updateInstallButton() {
  const b = document.getElementById('install-btn');
  if (b && deferredPrompt) b.classList.remove('hidden');
}
async function doInstall() {
  if (!deferredPrompt) return toast('当前浏览器未提供安装提示，可用「添加到主屏幕」', 'info');
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  updateInstallButton();
}

/* ---------- 统一刷新 ---------- */
export function refreshShell() {
  renderTitlebar();
  renderSidebar();
  renderStatusbar();
  if (get().commandOpen) renderPalette();
  const t = dom.toaster, s = get();
  clear(t);
  if (s.toast) t.appendChild(el('div', { class: 'toast ' + (s.toast.kind || 'info'), text: s.toast.msg }));
  t.classList.toggle('show', !!s.toast);
}

export function viewRoot() { return dom.main; }
export default { mountShell, refreshShell, viewRoot, togglePalette };
