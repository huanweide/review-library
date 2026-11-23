// 思维导图渲染（workbench）。
// 判据：布局算法只有一份 —— renderer/js/mindmap-layout.js（UMD 纯函数）。
// 这里只负责「加载它 / 提供主题色 / 把点击事件接到业务回调」，绝不另写排版。
import { el } from './ui.js';
import { zoomAt, panBy, resetView, normalizeView, cssTransform } from './map-viewport.mjs';

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

// 导图展开态持久化（2026-11-21 · 融合 markmap 的 foldLevel 判据）。
// 根因：229 点导图每次切页签/刷新都回到初始折叠，用户反复重新找——「刷新即失忆」。
// 做法：展开到哪层、聚焦哪章、什么布局都按书存 localStorage；恢复时校验节点 id 还在当前树里，
// 防止换书/重新分析后 id 变了还拿旧状态（那会画出空图或错高亮）。
const MAP_STATE_KEY = 'wb-map-state-v1';
function readMapState(key) {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const all = JSON.parse(localStorage.getItem(MAP_STATE_KEY) || '{}');
    return all[key] || null;
  } catch (e) { return null; }
}
function saveMapState(key, data) {
  if (!key || typeof localStorage === 'undefined') return;
  try {
    const all = JSON.parse(localStorage.getItem(MAP_STATE_KEY) || '{}');
    all[key] = data;
    localStorage.setItem(MAP_STATE_KEY, JSON.stringify(all));
  } catch (e) { /* 隐私模式/配额满：不挡渲染 */ }
}
// 只保留当前树里真实存在的 id——换书或重新分析后旧 id 一律丢弃
function liveIds(node, acc) {
  if (!node) return acc;
  if (node.id) acc.add(String(node.id));
  (node.children || []).forEach((c) => liveIds(c, acc));
  return acc;
}

// opts: { mode, onPick(node), height, outlineFallback(node), storageKey, defaultDepth }
// 返回 { setMode(mode), repaint(), destroy() }，便于父级切布局/换数据。
export function mountMindmap(holder, tree, opts) {
  const o = opts || {};
  const state = { mode: o.mode || 'right' };
  // 无界草图视口（2026-11-23 需求1）：transform 加在 viewport 层，canvas 仍管滚动兜底。
  let view = resetView();
  const bar = el('div', { class: 'mm-bar' });
  const canvas = el('div', { class: 'mm-canvas' + (o.height ? ' fixed' : '') });
  const viewport = el('div', { class: 'mm-viewport' });

  // 单章聚焦（2026-11-19）：全书 5 章 30 节 229 点竖排 ≈ 1.7 万像素，一屏永远只看得到一章。
  // 用户要「界面很全」——整体缩小没用（字会糊），「一次只摊开一章」才真能看全：
  // 顶栏给一行章名，点哪章只画那一章的节与知识点，高度落回一屏可滚；「全书」回到总览。
  let chapterId = '';
  const chapterTree = () => {
    const kids = (tree && Array.isArray(tree.children)) ? tree.children : [];
    if (!chapterId) return null;
    const ch = kids.find((c) => String(c.id) === chapterId);
    if (!ch) { chapterId = ''; return null; }
    // 章自己当根：布局器按 depth 上色，root 实心正好表示「这就是当前这一章」
    return { id: ch.id, title: ch.title, desc: ch.desc || '', children: ch.children || [] };
  };
  const viewRoot = () => chapterTree() || tree;
  const chBar = el('div', { class: 'mm-chapters' });
  const chips = [];
  function buildChips() {
    const kids = (tree && Array.isArray(tree.children)) ? tree.children : [];
    if (kids.length < 2) return;              // 只有一章时不加一条没用的导航
    const mk = (label, id) => {
      const b = el('button', {
        class: 'mm-chip', text: label, title: label,
        onclick: () => { chapterId = id; depthCap = 0; expanded.clear(); paint(); syncChips(); persistMapState(); },
      });
      b.dataset.cid = id;
      chBar.appendChild(b);
      chips.push(b);
    };
    mk('全书 · ' + kids.length + ' 章', '');
    kids.forEach((c, i) => mk(String(c.title || ('第 ' + (i + 1) + ' 章')).replace(/\s+/g, ' ').slice(0, 16), String(c.id)));
    syncChips();
  }
  function syncChips() { chips.forEach((b) => b.classList.toggle('on', b.dataset.cid === chapterId)); }

  if (o.height) canvas.style.maxHeight = o.height;
  canvas.appendChild(viewport);
  holder.appendChild(bar);
  buildChips();
  if (chips.length) holder.appendChild(chBar);
  holder.appendChild(canvas);

  // ---- 无界草图：滚轮缩放 + 拖拽平移 + 工具条 ----
  function applyView() { viewport.style.transform = cssTransform(view); }
  function setView(v) { view = v; applyView(); persistMapState(); }
  // 滚轮以光标为锚缩放。preventDefault 防止页面跟着滚（画布内缩放优先）。
  canvas.addEventListener('wheel', (e) => {
    if (!viewport.firstChild) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    setView(zoomAt(view, e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });
  // 拖拽平移：按住空白处拖（点在节点上不拖，避免和点击冲突）。
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('g.mm-node') || e.target.closest('button')) return;
    dragging = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setView({ scale: view.scale, tx: dragging.tx + (e.clientX - dragging.x), ty: dragging.ty + (e.clientY - dragging.y) });
  });
  const endDrag = () => { dragging = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  const zoomBtn = (label, fn, title) => {
    const b = el('button', { class: 'btn ghost sm mm-zoom', text: label, title: title || label, onclick: fn });
    bar.appendChild(b);
    return b;
  };
  zoomBtn('＋', () => setView(zoomAt(view, canvas.clientWidth / 2, canvas.clientHeight / 2, 1.2)), '放大');
  zoomBtn('－', () => setView(zoomAt(view, canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.2)), '缩小');
  zoomBtn('适应', () => setView(resetView()), '复位到 100%');

  // ---- 大树折叠（2026-11-19）----
  // 根因：229 个知识点的书全量渲染 → 画布高 229×76≈1.7 万像素，被容器 max-height 一压
  // 就缩到 4%，整张图变成一条看不清的竖线。这里按叶子数自动收浅，并允许点节点逐层展开。
  const expanded = new Set();   // 用户手动展开的节点 id（可跨重绘保留）
  let depthCap = 0;             // 0 = 尚未计算

  // 统一落盘：任一状态变化后调一次。存的是「节点 id 列表」不是索引——树重排后 id 仍是身份。
  function persistMapState() {
    saveMapState(o.storageKey, {
      chapterId: String(chapterId || ''),
      expanded: Array.from(expanded),
      depthCap: Number(depthCap) || 0,
      mode: state.mode,
      allOpen: foldBtn.dataset.open === '1',
      view: { scale: view.scale, tx: view.tx, ty: view.ty },
    });
  }
  // 恢复：默认层级来自分析结果（o.defaultDepth，数据层可配），交互态来自本地存储。
  // 校验 id 仍在当前树里，防止换书/重新分析后拿旧状态画出空图。
  function restoreMapState() {
    if (Number(o.defaultDepth) > 0) depthCap = Math.min(99, Math.floor(Number(o.defaultDepth)));
    const saved = readMapState(o.storageKey);
    if (!saved) return;
    const live = liveIds(tree, new Set());
    if (saved.chapterId && live.has(String(saved.chapterId))) chapterId = String(saved.chapterId);
    if (Array.isArray(saved.expanded)) saved.expanded.forEach((id) => { if (live.has(String(id))) expanded.add(String(id)); });
    if (Number(saved.depthCap) > 0) depthCap = Math.min(99, Math.floor(Number(saved.depthCap)));
    if (saved.mode && ['right', 'both', 'org'].includes(saved.mode)) {
      state.mode = saved.mode;
      Array.from(bar.children).forEach((x) => { if (x.dataset && x.dataset.mode) x.classList.toggle('on', x.dataset.mode === state.mode); });
    }
    if (saved.allOpen) { foldBtn.dataset.open = '1'; foldBtn.textContent = '收起到章节'; }
    if (saved.view) { view = normalizeView(saved.view); applyView(); }
  }

  function countLeaves(n) {
    const k = (n && Array.isArray(n.children)) ? n.children : [];
    if (!k.length) return 1;
    return k.reduce((s, c) => s + countLeaves(c), 0);
  }
  function pickDepth(root) {
    const leaves = countLeaves(root);
    if (leaves <= 28) return 99;  // 小书：全展开，不必点
    if (leaves <= 90) return 3;   // 中等：展到知识点层
    return 2;                     // 大书：只展到「章→节」，知识点收起，点开看
  }
  // 按 maxDepth 裁剪 children；被收起的子节点数写进 meta.count，由布局器画成角标。
  function foldTree(node, maxDepth, depth) {
    const kids = (node && Array.isArray(node.children)) ? node.children : [];
    const canOpen = node && expanded.has(String(node.id));
    const limit = canOpen ? maxDepth + 1 : maxDepth;
    const keep = depth < limit ? kids : [];
    const hidden = kids.length - keep.length;
    const copy = Object.assign({}, node, {
      children: keep.map((k) => foldTree(k, maxDepth, depth + 1)),
    });
    if (hidden > 0) copy.meta = { count: hidden };
    return copy;
  }
  const hasHiddenChildren = (n) => (n && Array.isArray(n.children)) ? n.children.length > 0 : false;

  [['右向', 'right'], ['双侧', 'both'], ['组织', 'org']].forEach(([label, mode], i) => {
    const b = el('button', {
      class: 'btn ghost sm' + (mode === state.mode ? ' on' : ''),
      text: label,
      onclick: () => { state.mode = mode; Array.from(bar.children).forEach((x) => { if (x.dataset && x.dataset.mode) x.classList.remove('on'); }); b.classList.add('on'); paint(); persistMapState(); },
    });
    b.dataset.mode = mode;
    bar.appendChild(b);
  });
  // 展开/收起：默认按规模自动收浅，用户可一键全展开或收回。
  const foldBtn = el('button', {
    class: 'btn ghost sm mm-fold',
    text: '展开全部',
    onclick: () => {
      const allOpen = foldBtn.dataset.open === '1';
      if (allOpen) { expanded.clear(); depthCap = pickDepth(tree); foldBtn.textContent = '展开全部'; foldBtn.dataset.open = '0'; }
      else { depthCap = 99; expanded.clear(); foldBtn.textContent = '收起到章节'; foldBtn.dataset.open = '1'; }
      paint(); persistMapState();
    },
  });
  foldBtn.dataset.open = '0';
  bar.appendChild(foldBtn);
  if (o.extraBar) bar.appendChild(o.extraBar);

  let ML = null;
  // 交叉索引（2026-11-19）：节点上标「这里有几道题」。
  // 为什么不用布局器的 meta.count：那个位置被「折叠角标」占着，两者语义不同、撞在一起必乱；
  // 所以只在可读的最深一层（叶子知识点）画一个小圆角标，章/节不画——克制比齐全更耐看。
  const badgeOf = typeof o.badgeOf === 'function' ? o.badgeOf : null;
  function paintBadges(svg, layout) {
    const NS = 'http://www.w3.org/2000/svg';
    svg.querySelectorAll('g.mm-node').forEach((g) => {
      const id = g.getAttribute('data-id');
      const n = (layout.nodes || []).find((x) => String(x.id) === id);
      if (!n) return;
      // 节点只有 224px 宽，长标题必被截断——给一个原生悬停全文，
      // 不点开也能读全（截断是无奈，读不到才是失败）。
      const tip = document.createElementNS(NS, 'title');
      tip.textContent = String(n.title || '') + (n.desc ? '\n' + String(n.desc) : '');
      g.insertBefore(tip, g.firstChild);
      if (!badgeOf) return;
      const hasKids = Array.isArray(n.children) && n.children.length > 0;
      if (hasKids) return;                       // 只看叶子：章/节的合计会重复计数
      const cnt = Number(badgeOf(n)) || 0;
      if (cnt <= 0) return;
      const cx = n.x + n.w - 13, cy = n.y + n.h - 13;
      const grp = document.createElementNS(NS, 'g');
      grp.setAttribute('class', 'mm-badge');
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 10.5);
      c.setAttribute('fill', n.color || '#3457d5');
      c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '1.2');
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', cx); t.setAttribute('y', cy + 4);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '11.5');
      t.setAttribute('font-weight', '700'); t.setAttribute('fill', '#fff');
      t.setAttribute('font-family', 'SFMono-Regular,Consolas,monospace');
      t.textContent = cnt > 9 ? '9+' : String(cnt);
      grp.appendChild(c); grp.appendChild(t); g.appendChild(grp);
    });
  }
  // 「跳到某个节点」：折叠状态下目标常被收起，先把它的祖先链逐层展开，再滚动过去高亮。
  function ancestorsOf(node, id, trail) {
    if (!node) return null;
    if (String(node.id) === String(id)) return trail;
    for (const c of (node.children || [])) {
      const hit = ancestorsOf(c, id, trail.concat(String(node.id)));
      if (hit) return hit;
    }
    return null;
  }
  let pendingFocus = '';
  function paint() {
    if (!ML) return;
    try {
      const root = viewRoot();
      if (!depthCap) depthCap = pickDepth(root);
      const view = depthCap >= 99 ? root : foldTree(root, depthCap, 0);
      const layout = ML.layoutTree(view, state.mode);
      viewport.innerHTML = ML.toSvg(layout, themeColors());
      applyView();
      const svg = viewport.querySelector('svg');
      if (svg) {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = 'auto';
        // 丝滑出现（需求1）：整棵淡入而不是瞬间弹出；节点按序微延迟，展开一支时像「长出来」。
        svg.classList.add('mm-enter');
        svg.querySelectorAll('g.mm-node').forEach((g, i) => {
          g.style.animationDelay = Math.min(i * 8, 260) + 'ms';
        });
        paintBadges(svg, layout);
        // 折叠角标提示：被收起的节点显示「还有 N 个」，并给可展开的手型
        svg.querySelectorAll('g.mm-node').forEach((g) => {
          const id = g.getAttribute('data-id');
          const node = (layout.nodes || []).find((n) => String(n.id) === id);
          const canExpand = node && node.meta && typeof node.meta.count === 'number' && node.meta.count > 0;
          g.style.cursor = 'pointer';
          if (canExpand) g.classList.add('mm-foldable');
          g.addEventListener('click', () => {
            // 有收起子节点：第一下先「展开这一支」；已是叶子再走业务回调（讲解面板）
            if (canExpand) {
              expanded.add(String(id));
              paint(); persistMapState();
              return;
            }
            // 高亮当前节点：把「你点的就是它」这件事画出来，而不是只弹个面板
            svg.querySelectorAll('g.mm-node rect').forEach((r) => r.setAttribute('stroke-width', '1.4'));
            const r = g.querySelector('rect');
            if (r) r.setAttribute('stroke-width', '3');
            if (node && o.onPick) o.onPick(node, g);
          });
        });
        if (pendingFocus) {
          const g = svg.querySelector('g.mm-node[data-id="' + pendingFocus + '"]');
          pendingFocus = '';
          if (g) {
            const r = g.querySelector('rect');
            if (r) r.setAttribute('stroke-width', '3');
            try { g.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (e) { /* 忽略 */ }
          }
        }
      }
    } catch (e) {
      viewport.innerHTML = '';
      canvas.appendChild(el('p', { class: 'sub', text: '导图渲染失败：' + String(e.message || e) }));
    }
  }

  canvas.appendChild(el('div', { class: 'mm-loading', text: '渲染导图…' }));
  loadLayout().then((m) => {
    ML = m;
    restoreMapState();
    syncChips();
    viewport.innerHTML = '';
    paint();
  }).catch((e) => {
    viewport.innerHTML = '';
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

  return {
    setMode: (m) => { state.mode = m; paint(); persistMapState(); },
    repaint: () => { depthCap = 0; expanded.clear(); foldBtn.textContent = '展开全部'; foldBtn.dataset.open = '0'; paint(); persistMapState(); },
    // 从别处（考点大全 / 题型 / 提纲）跳进来时用：切到它所在的那一章 + 展开祖先链 + 滚动高亮
    focus: (id) => {
      const kids = (tree && Array.isArray(tree.children)) ? tree.children : [];
      const isChapter = kids.some((c) => String(c.id) === String(id));
      const chain = ancestorsOf(tree, id, []);
      // 目标在哪个章就切到哪一章：不切的话节点根本不在当前画面上，「跳过去」就是假的
      chapterId = isChapter ? String(id) : ((chain && chain[1]) || '');
      if (chain) chain.forEach((a) => expanded.add(a));
      depthCap = 0;
      pendingFocus = String(id);
      paint();
      syncChips();
      persistMapState();
    },
  };
}

export default { mountMindmap, loadLayout, themeColors };
