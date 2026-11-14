// 思维导图渲染（workbench）。
// 判据：布局算法只有一份 —— renderer/js/mindmap-layout.js（UMD 纯函数）。
// 这里只负责「加载它 / 提供主题色 / 把点击事件接到业务回调」，绝不另写排版。
import { el } from './ui.js';

let layoutPromise = null;

export function loadLayout() {
  if (window.MindmapLayout) return Promise.resolve(window.MindmapLayout);
  if (layoutPromise) return layoutPromise;
  layoutPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '../js/mindmap-layout.js';
    s.onload = () => (window.MindmapLayout ? resolve(window.MindmapLayout) : reject(new Error('模块未挂载')));
    s.onerror = () => reject(new Error('布局模块加载失败'));
    document.head.appendChild(s);
  });
  return layoutPromise;
}

export function themeColors() {
  const cs = getComputedStyle(document.body);
  const v = (k, d) => (cs.getPropertyValue(k) || '').trim() || d;
  return {
    background: 'transparent',
    nodeFill: v('--surface', '#ffffff'),
    textColor: v('--ink', '#1f2733'),
    metaColor: v('--muted', '#6b7688'),
    rootTextColor: '#ffffff',
  };
}

// opts: { mode, onPick(node), height, outlineFallback(node) }
// 返回 { setMode(mode), repaint(), destroy() }，便于父级切布局/换数据。
export function mountMindmap(holder, tree, opts) {
  const o = opts || {};
  const state = { mode: o.mode || 'right' };
  const bar = el('div', { class: 'mm-bar' });
  const canvas = el('div', { class: 'mm-canvas' + (o.height ? ' fixed' : '') });
  if (o.height) canvas.style.maxHeight = o.height;
  holder.appendChild(bar);
  holder.appendChild(canvas);

  [['右向', 'right'], ['双侧', 'both'], ['组织', 'org']].forEach(([label, mode], i) => {
    const b = el('button', {
      class: 'btn ghost sm' + (mode === state.mode ? ' on' : ''),
      text: label,
      onclick: () => { state.mode = mode; Array.from(bar.children).forEach((x) => x.classList.remove('on')); b.classList.add('on'); paint(); },
    });
    bar.appendChild(b);
  });
  if (o.extraBar) bar.appendChild(o.extraBar);

  let ML = null;
  function paint() {
    if (!ML) return;
    try {
      const layout = ML.layoutTree(tree, state.mode);
      canvas.innerHTML = ML.toSvg(layout, themeColors());
      const svg = canvas.querySelector('svg');
      if (svg) {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = 'auto';
        if (o.onPick) {
          svg.querySelectorAll('g.mm-node').forEach((g) => {
            g.style.cursor = 'pointer';
            g.addEventListener('click', () => {
              const id = g.getAttribute('data-id');
              const node = (layout.nodes || []).find((n) => String(n.id) === id);
              // 高亮当前节点：把「你点的就是它」这件事画出来，而不是只弹个面板
              svg.querySelectorAll('g.mm-node rect').forEach((r) => r.setAttribute('stroke-width', '1.4'));
              const r = g.querySelector('rect');
              if (r) r.setAttribute('stroke-width', '3');
              if (node && o.onPick) o.onPick(node, g);
            });
          });
        }
      }
    } catch (e) {
      canvas.innerHTML = '';
      canvas.appendChild(el('p', { class: 'sub', text: '导图渲染失败：' + String(e.message || e) }));
    }
  }

  canvas.appendChild(el('div', { class: 'mm-loading', text: '渲染导图…' }));
  loadLayout().then((m) => {
    ML = m;
    canvas.innerHTML = '';
    paint();
  }).catch((e) => {
    canvas.innerHTML = '';
    // 宿主没托管共用模块时的诚实降级：画大纲，而不是假装有导图
    canvas.appendChild(el('p', { class: 'sub', text: '导图模块不可用（' + String(e.message || e) + '），已降级为大纲：' }));
    const walk = (n, depth) => el('div', {}, [
      el('div', { class: 'mm-outline-row', style: { paddingLeft: (depth * 16) + 'px' } }, [
        el('span', { class: 'dot', style: { background: n.color || 'var(--brand)' } }),
        el('span', { text: (n.title || '未命名') + (n.desc ? ' · ' + n.desc : '') }),
      ]),
    ].concat((n.children || []).map((c) => walk(c, depth + 1))));
    if (tree) canvas.appendChild(walk(tree, 0));
  });

  return { setMode: (m) => { state.mode = m; paint(); }, repaint: paint };
}

export default { mountMindmap, loadLayout, themeColors };
