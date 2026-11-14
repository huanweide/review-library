// 视图层（workbench）。
// 判据：所有业务动作都经 host.action(action, payload) 走统一协议，
// action 名来自 manifest.capabilities，不在这里手写第二份清单。
// 视图只负责「把后端返回的真实数据画出来」，不自己算业务结论。

import { get, set, setViewData, toast, setTheme, setDensity } from './state.js';
import host from './host.js';
import { go } from './router.js';
import { el, h, clear, card, kv, badge, empty, loading, errorBox, btn, field, input } from './ui.js';

function $view(id) { return (get().views && get().views[id]) || {}; }

async function call(action, payload, viewId) {
  setViewData(viewId, { loading: true, error: null });
  try {
    const r = await host.action(action, payload || {});
    setViewData(viewId, { loading: false, data: r, error: r.ok === false ? r.error : null });
    if (r.ok === false) toast(r.error || '操作失败', 'bad');
    return r;
  } catch (e) {
    setViewData(viewId, { loading: false, error: String(e.message || e) });
    toast('连接失败：' + String(e.message || e), 'bad');
    return { ok: false, error: String(e.message || e) };
  }
}

function dataBlock(data) {
  if (data == null) return empty('暂无数据', '执行一个操作后，真实结果会显示在这里');
  return el('pre', { class: 'json' , text: JSON.stringify(data, null, 2) });
}

/* ---------------- 启动台：真实状态 + 形态地图 ---------------- */
function viewHome(root) {
  const s = get(), st = s.state || {}, m = s.manifest || {};
  const hostLabel = s.host.label + (s.host.kind ? ' · ' + s.host.kind : '');
  const online = s.online;

  root.appendChild(el('div', { class: 'hero' }, [
    el('div', { class: 'hero-kicker', text: 'TIANDAO WORKBENCH · 统一应用' }),
    el('h1', { text: '一个应用，五种形态' }),
    el('p', { class: 'hero-p', text:
      '这不是网页，是统一复习项目的应用形态。界面由 core/app-host.js 的清单驱动，' +
      '所有动作回到同一个 core/；桌面端、内置浏览器、DSH 插件、Skills/CLI 读的是同一份书与分析产物。' }),
    el('div', { class: 'hero-chips' }, [
      badge(online ? '服务在线' : '服务离线', online ? 'good' : 'bad'),
      badge(hostLabel, 'plain'),
      badge('协议 v' + (m.protocol || '-'), 'plain'),
      badge('能力 ' + (m.actions || []).length + ' 项', 'plain'),
    ]),
  ]));

  const stats = [
    { n: st.bookCount != null ? st.bookCount : '—', l: '本书' },
    { n: st.analyzedCount != null ? st.analyzedCount : '—', l: '已分析' },
    { n: st.actionCount != null ? st.actionCount : '—', l: '个能力' },
    { n: (m.views || []).length, l: '个视图' },
  ];
  root.appendChild(el('div', { class: 'stats' }, stats.map(x =>
    el('div', { class: 'stat' }, [el('strong', { text: String(x.n) }), el('span', { text: x.l })]))));

  root.appendChild(el('div', { class: 'section-title', text: '快速开始' }));
  const quick = [
    { v: 'library', t: '打开书架', d: '看全部书，建新书、导入资料' },
    { v: 'quiz', t: '开始练习', d: '先答后揭，答案不会提前下发' },
    { v: 'due', t: '今日到期', d: '今天该复习的卡' },
    { v: 'about', t: '形态与架构', d: '五种形态为什么是同一个东西' },
  ];
  root.appendChild(el('div', { class: 'grid' }, quick.map(q =>
    el('button', { class: 'tile', onclick: () => go(q.v) }, [
      el('div', { class: 'tile-title', text: q.t }),
      el('div', { class: 'tile-desc', text: q.d }),
      el('div', { class: 'tile-arrow', text: '→' }),
    ]))));

  root.appendChild(el('div', { class: 'section-title', text: '能力清单（运行时来自统一核心）' }));
  const caps = m.capabilities || [];
  root.appendChild(el('div', { class: 'cap-list' }, caps.map(c =>
    el('div', { class: 'cap-row' }, [
      el('code', { class: 'cap-action', text: c.action }),
      el('span', { class: 'cap-label', text: c.label || c.method }),
      el('span', { class: 'cap-hint', text: c.hint || '' }),
      badge(c.group === 'practice' ? '学习闭环' : '资料', c.group === 'practice' ? 'accent' : 'plain'),
    ]))));

  if (!online) {
    root.appendChild(el('div', { class: 'notice' , html:
      '<b>宿主服务未连接。</b> 真功能需要后端 <code>core/app-host.js</code>。' +
      '本地服务形态：双击 <code>启动.bat</code>；DSH 形态：插件会自动提供同源协议端点。' }));
  }
}

/* ---------------- 书架 / 书详情 ---------------- */
function viewLibrary(root, view) {
  const d = $view('library');
  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [el('h2', { text: '书架' }), el('p', { class: 'sub', text: '统一核心 core/ 的书库；与桌面端统一核心、DSH 插件、Skills/CLI 完全同源' })]),
    el('div', { class: 'view-actions' }, [
      btn('刷新', () => call('list', {}, 'library'), 'ghost'),
      btn('＋ 新建书', () => go('create'), 'primary'),
    ]),
  ]));
  root.appendChild(el('div', { class: 'notice', html:
    '<b>书库边界</b>：本应用读的是统一核心 <code>core/</code> 的书库。' +
    '旧版全功能工作台（<code>index.html</code> / <code>lib/store.js</code>）是另一套元数据格式、共用目录但刻意不合并，' +
    '那里的书不会出现在这里。在 DSH / 桌面端统一核心 / Skills 里建的书会立刻出现。' }));
  if (d.loading) return root.appendChild(loading('读取书库…'));
  if (d.error) return root.appendChild(errorBox(d.error, () => call('list', {}, 'library')));

  const books = (d.data && d.data.data && d.data.data.books) || (d.data && d.data.books) || [];
  if (!books.length) {
    return root.appendChild(empty('统一核心书库还是空的',
      '点「新建书」，或在 DSH / 桌面端统一核心 / Skills 里建的书会自动出现在这里'));
  }
  root.appendChild(el('div', { class: 'book-grid' }, books.map(b =>
    el('div', { class: 'book-card', onclick: () => go('book', { id: b.id }) }, [
      el('div', { class: 'book-cover' }, [el('span', { text: String(b.title || '未命名').slice(0, 1) })]),
      el('div', { class: 'book-info' }, [
        el('div', { class: 'book-title', text: b.title || b.id }),
        el('div', { class: 'book-id', text: b.id }),
      ]),
      el('div', { class: 'book-actions' }, [
        btn('详情', () => go('book', { id: b.id }), 'ghost sm'),
        btn('练习', () => go('quiz', { id: b.id }), 'ghost sm'),
      ]),
    ]))));
}

/* ---------------- 思维导图（复用共用布局模块，不复制算法） ---------------- */
// 与 core.html / 静态站读同一份 renderer/js/mindmap-layout.js：
// 布局是纯函数，屏幕坐标与导出坐标必须同源，所以这里绝不另写一套排版。
let layoutPromise = null;
function loadLayout() {
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
function themeColors() {
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
function mountMindmap(holder, tree) {
  const state = { mode: 'right' };
  const bar = el('div', { class: 'mm-bar' });
  const canvas = el('div', { class: 'mm-canvas' });
  holder.appendChild(bar); holder.appendChild(canvas);
  const paint = (ML) => {
    try {
      const layout = ML.layoutTree(tree, state.mode);
      canvas.innerHTML = ML.toSvg(layout, themeColors());
      const svg = canvas.querySelector('svg');
      if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
    } catch (e) {
      canvas.innerHTML = '';
      canvas.appendChild(el('p', { class: 'sub', text: '导图渲染失败：' + String(e.message || e) }));
    }
  };
  [['右向', 'right'], ['双侧', 'both'], ['组织', 'org']].forEach(([label, mode], i) => {
    const b = btn(label, () => {
      state.mode = mode;
      Array.from(bar.children).forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      loadLayout().then(paint).catch(() => {});
    }, 'ghost sm' + (i === 0 ? ' on' : ''));
    bar.appendChild(b);
  });
  canvas.appendChild(loading('渲染导图…'));
  loadLayout().then(paint).catch((e) => {
    canvas.innerHTML = '';
    // 宿主没托管共用模块时的诚实降级：画大纲，而不是假装导图
    const walk = (n, depth) => {
      const li = el('div', { class: 'mm-outline-row', style: { paddingLeft: (depth * 16) + 'px' } }, [
        el('span', { class: 'dot', style: { background: n.color || 'var(--brand)' } }),
        el('span', { text: (n.title || '未命名') + (n.desc ? ' · ' + n.desc : '') }),
      ]);
      const kids = (n.children || []).map((c) => walk(c, depth + 1));
      return el('div', {}, [li].concat(kids));
    };
    canvas.appendChild(el('p', { class: 'sub', text: '导图模块不可用（' + String(e.message || e) + '），已降级为大纲：' }));
    if (tree) canvas.appendChild(walk(tree, 0));
  });
}

function viewBook(root, view, params) {
  const id = params.id || $view('book').bookId || get().lastBookId || '';
  if (id) rememberBook(id);
  const d = $view('book');
  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [el('h2', { text: '书详情' }), el('p', { class: 'sub', text: id ? '书 id：' + id : '未选择书' })]),
    btn('← 返回书架', () => go('library'), 'ghost'),
  ]));
  if (!id) return root.appendChild(empty('先选一本书', '从书架点「详情」进来'));
  if (d.loading) return root.appendChild(loading('读取分析结果…'));
  if (d.error) return root.appendChild(errorBox(d.error, () => call('get', { bookId: id }, 'book')));
  const a = d.data && d.data.data;
  if (!a) return root.appendChild(empty('尚未分析', '这本书还没有分析结果，请在统一核心里做整体分析'));
  root.appendChild(el('div', { class: 'grid' }, [
    card('概览', kv([
      ['章', a.stats && a.stats.chapters], ['知识点', a.stats && a.stats.points],
      ['题型', a.stats && a.stats.questionTypes], ['题目数', a.stats && a.stats.questionCount],
      ['模型', a.model || '—'],
    ])),
    card('摘要', [el('p', { class: 'para', text: a.summary || '（无摘要）' })]),
  ]));
  root.appendChild(el('div', { class: 'section-title', text: '思维导图（真分析结果 · 与 core.html 同一套布局算法）' }));
  const mm = el('div', { class: 'mm-wrap' });
  root.appendChild(mm);
  if (a.tree) mountMindmap(mm, a.tree);
  else root.appendChild(empty('没有导图数据', '这份分析结果里没有 tree'));

  root.appendChild(el('div', { class: 'section-title', text: '题型索引' }));
  root.appendChild(el('div', { class: 'chip-row' }, (a.questionIndex || []).map(g =>
    badge(g.type + ' · ' + ((g.items || []).length) + ' 项', 'accent'))));
  const det = el('details', { class: 'raw-box' }, [
    el('summary', { text: '原始分析结果（JSON，排查用）' }),
    dataBlock(a),
  ]);
  root.appendChild(det);
}

/* ---------------- 学习闭环 ---------------- */
// 记住「上次打开的书」：从侧栏直接点「题目 / 练习 / 今日到期」时，
// 不该因为 URL 没带 id 就掉进空死路（只有一本书时更不该让用户再选一次）。
function rememberBook(id) {
  if (!id) return;
  // 守卫：渲染过程中写状态会立刻触发订阅重渲染 → 又写状态 → 无限递归。
  // 值没变就绝不 set（与「切换 tab 不整页刷新」同一条纪律：只在真变化时动作）。
  if (get().lastBookId === id) return;
  set({ lastBookId: id });
  try { localStorage.setItem('wb-last-book', id); } catch (e) { /* 隐私模式下忽略 */ }
}

function needBook(root, viewId, params) {
  const id = params.id || $view(viewId).bookId || get().lastBookId;
  if (!id) {
    root.appendChild(empty('先选一本书', '到书架选书，或在 URL 带 ?id=xxx'));
    root.appendChild(el('div', { class: 'center' }, [btn('去书架', () => go('library'), 'primary')]));
    return null;
  }
  rememberBook(id);
  return id;
}

function viewQuiz(root, view, params) {
  const id = needBook(root, 'quiz', params);
  if (!id) return;
  const d = $view('quiz');
  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [el('h2', { text: '练习题目' }), el('p', { class: 'sub', text: '书：' + id + ' · 先答后揭，判分后才下发答案与解析' })]),
    el('div', { class: 'view-actions' }, [
      btn('今日到期', () => go('due', { id }), 'ghost'),
      btn('刷新', () => call('quiz', { bookId: id }, 'quiz'), 'ghost'),
    ]),
  ]));
  if (d.loading) return root.appendChild(loading('取题…'));
  if (d.error) return root.appendChild(errorBox(d.error, () => call('quiz', { bookId: id }, 'quiz')));
  const payload = d.data && d.data.data;
  const qs = (payload && payload.questions) || [];
  if (!qs.length) return root.appendChild(empty('没有可练的题目', '先做整体分析，或看看今日到期'));

  const sel = {};   // key -> 已选文本（仅本视图内存，不入状态树）
  const done = {};  // key -> 判分结果
  root.appendChild(el('div', { class: 'q-list' }, qs.map((q, i) => {
    const key = String(q.key || '');
    const optEls = [];
    const resultBox = el('div', { class: 'q-result hidden' });
    const rateBox = el('div', { class: 'q-rate hidden' });
    const submit = btn('作答', async () => {
      if (done[key]) return;
      if (q.options && q.options.length && !sel[key]) return toast('先选一个选项', 'info');
      const given = (q.options && q.options.length) ? sel[key] : '';
      if (!given) return go('attempt', { id, key }); // 简答题：走自由作答表单
      submit.disabled = true;
      const r = await host.action('attempt', { bookId: id, key, given });
      submit.disabled = false;
      if (!r || r.ok === false) return toast((r && r.error) || '提交失败', 'bad');
      done[key] = r.data;
      renderResult(r.data, optEls, resultBox, rateBox, id, key);
    }, 'primary sm');
    return el('div', { class: 'q-card' }, [
      el('div', { class: 'q-head' }, [
        badge('第 ' + (i + 1) + ' 题', 'plain'),
        badge(String(q.type || '题目'), 'accent'),
        el('span', { class: 'q-key', text: key.slice(0, 12) }),
      ]),
      el('div', { class: 'q-stem', text: q.stem || '' }),
      q.options && q.options.length ? el('div', { class: 'q-opts' }, q.options.map((o) => {
        const b = el('button', {
          class: 'q-opt', text: o,
          onclick: () => {
            if (done[key]) return;
            sel[key] = o;
            optEls.forEach((x) => x.classList.remove('sel'));
            b.classList.add('sel');
          },
        });
        optEls.push(b);
        return b;
      })) : null,
      el('div', { class: 'q-actions' }, [submit]),
      resultBox,
      rateBox,
    ]);
  })));
}

// 判分结果就地展开：答案、分步解答、思路、坑点，以及四档自评（真写 SRS 排程）。
function renderResult(data, optEls, box, rateBox, bookId, key) {
  const good = data.verdict === 'correct';
  const self = data.verdict === 'self';
  box.classList.remove('hidden');
  box.appendChild(el('div', { class: 'q-verdict ' + (good ? 'good' : (self ? 'info' : 'bad')) }, [
    el('strong', { text: good ? '答对了' : (self ? '已提交（需自评）' : '答错了') }),
    el('span', { text: data.mode === 'auto' ? ('　正确答案：' + (data.expected || '')) : '' }),
  ]));
  // 选项着色：对的标绿、选错的标红（只在自动判分时）
  if (data.mode === 'auto' && data.expected) {
    optEls.forEach((b) => {
      const t = b.textContent.trim();
      if (t.startsWith(data.expected + '.') || t.startsWith(data.expected + ' ') || t === data.expected) b.classList.add('right');
      else if (b.classList.contains('sel')) b.classList.add('wrong');
    });
  }
  box.appendChild(el('div', { class: 'q-answer', text: '答案：' + (data.answer || '—') }));
  if (data.solution && data.solution.length) {
    box.appendChild(el('div', { class: 'q-sol' }, data.solution.map((s) => el('div', { class: 'q-step', text: s }))));
  }
  if (data.rationale) box.appendChild(el('div', { class: 'q-note', text: '思路：' + data.rationale }));
  if (data.pitfalls) box.appendChild(el('div', { class: 'q-note', text: '易错：' + data.pitfalls }));
  box.appendChild(el('div', { class: 'q-note', text: '已排程，下次复习：' + (data.dueAt ? new Date(data.dueAt).toLocaleString('zh-CN') : '—') }));

  rateBox.classList.remove('hidden');
  rateBox.appendChild(el('span', { class: 'sub', text: '这次感觉：' }));
  [['重来', 1], ['吃力', 2], ['会了', 3], ['太简单', 4]].forEach((pair) => {
    rateBox.appendChild(btn(pair[0], async () => {
      const r = await host.action('rate', { bookId, key, rating: pair[1] });
      if (!r || r.ok === false) return toast((r && r.error) || '自评失败', 'bad');
      toast('已重排下次复习：' + (r.data && r.data.dueAt ? new Date(r.data.dueAt).toLocaleString('zh-CN') : ''), 'ok');
    }, 'ghost sm'));
  });
}

function viewDue(root, view, params) {
  const id = needBook(root, 'due', params);
  if (!id) return;
  const d = $view('due');
  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [el('h2', { text: '今日到期' }), el('p', { class: 'sub', text: '书：' + id })]),
    btn('刷新', () => call('due', { bookId: id }, 'due'), 'ghost'),
  ]));
  if (d.loading) return root.appendChild(loading('取到期队列…'));
  if (d.error) return root.appendChild(errorBox(d.error, () => call('due', { bookId: id }, 'due')));
  const payload = d.data && d.data.data;
  root.appendChild(card('到期概览', kv([
    ['今日到期', payload && payload.dueCount], ['可取题目', payload && payload.questions && payload.questions.length],
  ])));
  root.appendChild(dataBlock(payload));
}

function viewPractice(root, view, params) {
  const id = needBook(root, 'practice', params);
  if (!id) return;
  const d = $view('practice');
  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [el('h2', { text: '练习过程' }), el('p', { class: 'sub', text: '书：' + id + ' · 数据来自 core/practice.json（与 DSH / Skills 同一份）' })]),
    el('div', { class: 'view-actions' }, [
      btn('去答题', () => go('quiz', { id }), 'primary'),
      btn('刷新', () => call('practice', { bookId: id }, 'practice'), 'ghost'),
    ]),
  ]));
  if (d.loading) return root.appendChild(loading('读取练习状态…'));
  if (d.error) return root.appendChild(errorBox(d.error, () => call('practice', { bookId: id }, 'practice')));
  const st = (d.data && d.data.data) || {};
  const cards = st.cards || {};
  const keys = Object.keys(cards);
  const now = Date.now();
  const due = keys.filter((k) => cards[k] && typeof cards[k].dueAt === 'number' && cards[k].dueAt <= now);
  const wrong = keys.filter((k) => (cards[k].lapseCount || 0) > 0);
  const mastered = keys.filter((k) => (cards[k].correctCount || 0) > 0 && !cards[k].leech);
  root.appendChild(el('div', { class: 'grid' }, [
    card('复习进度', kv([
      ['已建卡', keys.length], ['今日到期', due.length],
      ['做错过', wrong.length], ['已掌握', mastered.length],
    ])),
    card('说明', [
      el('p', { class: 'para', text: '每答一题就会在这里建卡；到期时间由四档自评重排。空表示这本书还没开始练。' }),
      el('p', { class: 'sub', text: '更新时间：' + (st.updatedAt || '—') }),
    ]),
  ]));
  root.appendChild(el('div', { class: 'section-title', text: '卡片（按到期先后）' }));
  if (!keys.length) return root.appendChild(empty('还没有练习记录', '去「题目」答一题，这里就会出现卡片与排程'));
  const rows = keys.map((k) => ({ k, c: cards[k] || {} })).sort((a, b) => (a.c.dueAt || 0) - (b.c.dueAt || 0)).slice(0, 40);
  root.appendChild(el('div', { class: 'card-table' }, rows.map(({ k, c }) => el('div', { class: 'card-row' }, [
    el('span', { class: 'mono', text: k.slice(0, 18) }),
    badge(c.leech ? '顽固' : ((c.lapseCount || 0) > 0 ? '易错' : ((c.correctCount || 0) > 0 ? '已掌握' : '新卡')),
      c.leech ? 'bad' : ((c.lapseCount || 0) > 0 ? 'warn' : 'accent')),
    el('span', { class: 'sub', text: '到期 ' + (c.dueAt ? new Date(c.dueAt).toLocaleString('zh-CN') : '—') }),
    el('span', { class: 'sub', text: '对 ' + (c.correctCount || 0) + ' / 错 ' + (c.lapseCount || 0) + ' · 复习 ' + (c.reps || 0) + ' 次' }),
  ]))));
}

/* ---------------- 表单类视图 ---------------- */
function viewCreate(root) {
  const d = $view('create');
  const title = input({ placeholder: '例如：材料科学基础', id: 'wb-create-title' });
  const desc = input({ placeholder: '可选备注' });
  root.appendChild(el('div', { class: 'view-head' }, [el('div', {}, [el('h2', { text: '新建书' }), el('p', { class: 'sub', text: '写入统一核心 core/，其它形态立刻可见' })])]));
  root.appendChild(card('书信息', [
    field('书名', title), field('备注', desc),
    el('div', { class: 'form-actions' }, [
      btn('创建', async () => {
        if (!title.value.trim()) return toast('书名不能为空', 'bad');
        const r = await call('create', { title: title.value.trim(), description: desc.value.trim() }, 'create');
        if (r.ok) { toast('已创建：' + (r.data && r.data.title || ''), 'good'); go('library'); }
      }, 'primary'),
    ]),
    d.error ? el('div', { class: 'inline-error', text: d.error }) : null,
  ]));
}

function viewAdd(root, view, params) {
  const id = params.id || '';
  const d = $view('add');
  const file = el('input', { class: 'input', type: 'file', multiple: true });
  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [el('h2', { text: '导入资料' }), el('p', { class: 'sub', text: id ? '书：' + id : '需要指定书 id' })]),
    btn('← 书架', () => go('library'), 'ghost'),
  ]));
  if (!id) return root.appendChild(empty('先选一本书', '从书架进入'));
  root.appendChild(card('选择文件', [
    field('资料（PDF / Word / 图片 / 文本）', file, '文件在浏览器内转 base64 后交给统一核心，不经第三方'),
    el('div', { class: 'form-actions' }, [
      btn('导入', async () => {
        const files = Array.from(file.files || []);
        if (!files.length) return toast('请先选文件', 'bad');
        const payload = [];
        for (const f of files) {
          const buf = await f.arrayBuffer();
          let bin = '';
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          payload.push({ name: f.name, data: btoa(bin) });
        }
        const r = await call('add', { bookId: id, files: payload }, 'add');
        if (r.ok) { toast('已导入 ' + payload.length + ' 份', 'good'); go('book', { id }); }
      }, 'primary'),
    ]),
    d.error ? el('div', { class: 'inline-error', text: d.error }) : null,
  ]));
}

function viewAnalyze(root, view, params) {
  const id = params.id || '';
  const d = $view('analyze');
  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [el('h2', { text: '整体分析' }), el('p', { class: 'sub', text: '大模型把整本书当一个整体；密钥只在本次请求内存里' })]),
  ]));
  if (!id) return root.appendChild(empty('先选一本书', '从书架进入'));
  const base = input({ placeholder: 'API 地址（到 /v1）' });
  const model = input({ placeholder: '模型名' });
  const key = input({ type: 'password', placeholder: 'API 密钥（不落盘、不写日志）' });
  root.appendChild(card('模型配置', [
    field('API 地址', base), field('模型', model), field('密钥', key, '只在本次请求内存在，关闭页面即失效'),
    el('div', { class: 'form-actions' }, [
      btn('开始整体分析', async () => {
        const cfg = { baseURL: base.value.trim(), model: model.value.trim(), apiKey: key.value };
        if (!cfg.baseURL || !cfg.model || !cfg.apiKey) return toast('地址 / 模型 / 密钥都要填', 'bad');
        toast('已提交，整本分析通常要 1–3 分钟', 'info');
        const r = await call('analyze', { bookId: id, cfg }, 'analyze');
        if (r.ok) { toast('分析完成', 'good'); go('book', { id }); }
      }, 'primary'),
    ]),
    d.loading ? loading('模型正在整本分析…') : null,
    d.error ? el('div', { class: 'inline-error', text: d.error }) : null,
  ]));
}

function viewAttempt(root, view, params) {
  const { id, key } = params;
  const given = input({ placeholder: '你的作答（选择题可填 A/B/C/D）' });
  root.appendChild(el('div', { class: 'view-head' }, [el('div', {}, [el('h2', { text: '提交作答' }), el('p', { class: 'sub', text: '书：' + (id || '—') })]), btn('← 题目', () => go('quiz', { id }), 'ghost')]));
  if (!id || !key) return root.appendChild(empty('缺少书 id 或题目 key', '从题目列表点「作答」进来'));
  root.appendChild(card('作答', [
    field('答案', given),
    el('div', { class: 'form-actions' }, [btn('提交并判分', async () => {
      const r = await call('attempt', { bookId: id, key, given: given.value }, 'attempt');
      if (r.ok) go('rate', { id, key });
    }, 'primary')]),
  ]));
  const d = $view('attempt');
  if (d.data) { root.appendChild(el('div', { class: 'section-title', text: '判分结果（答案此时才到达客户端）' })); root.appendChild(dataBlock(d.data.data)); }
}

function viewRate(root, view, params) {
  const { id, key } = params;
  root.appendChild(el('div', { class: 'view-head' }, [el('div', {}, [el('h2', { text: '四档自评' }), el('p', { class: 'sub', text: '重排下次复习时间' })]), btn('← 题目', () => go('quiz', { id }), 'ghost')]));
  if (!id || !key) return root.appendChild(empty('缺少书 id 或题目 key'));
  const labels = [['重来', 1], ['吃力', 2], ['会了', 3], ['太简单', 4]];
  root.appendChild(card('这一题掌握得怎么样', [
    el('div', { class: 'rate-row' }, labels.map(([label, n]) =>
      btn(label, async () => {
        const r = await call('rate', { bookId: id, key, rating: n }, 'rate');
        if (r.ok) { toast('已记录，下次复习时间已重排', 'good'); go('quiz', { id }); }
      }, 'ghost'))),
  ]));
}

/* ---------------- 系统视图 ---------------- */
function viewSettings(root) {
  const s = get();
  root.appendChild(el('div', { class: 'view-head' }, [el('div', {}, [el('h2', { text: '设置' }), el('p', { class: 'sub', text: '只影响本应用的显示，不改变统一核心任何数据' })])]));
  root.appendChild(card('外观', [
    el('div', { class: 'setting-row' }, [
      el('span', { text: '主题' }),
      el('div', { class: 'seg' }, ['light', 'dark', 'system'].map(t =>
        el('button', { class: 'seg-btn' + (s.theme === t ? ' on' : ''), text: { light: '浅色', dark: '深色', system: '跟随系统' }[t], onclick: () => setTheme(t) }))),
    ]),
    el('div', { class: 'setting-row' }, [
      el('span', { text: '密度' }),
      el('div', { class: 'seg' }, ['comfortable', 'compact'].map(t =>
        el('button', { class: 'seg-btn' + (s.density === t ? ' on' : ''), text: t === 'compact' ? '紧凑' : '舒适', onclick: () => setDensity(t) }))),
    ]),
  ]));
  root.appendChild(card('宿主与连接', kv([
    ['宿主', s.host.label], ['传输', s.host.kind], ['协议端点', s.host.base || 'Electron IPC'],
    ['协议版本', s.manifest && s.manifest.protocol], ['核心版本', s.state && s.state.coreVersion],
    ['连接状态', s.online ? '在线' : '离线'],
  ])));
}

function viewAbout(root) {
  const s = get(), m = s.manifest || {}, st = s.state || {};
  root.appendChild(el('div', { class: 'view-head' }, [el('div', {}, [el('h2', { text: '关于与形态地图' }), el('p', { class: 'sub', text: '为什么 APP / DSH / Skills 是同一个东西' })])]));
  root.appendChild(card(m.app ? m.app.name + ' · v' + m.app.version : '天道书阁', [
    el('p', { class: 'para', text: '唯一核心 = 仓库根 core/。五种形态都只是入口，不是各自带一份引擎；能力清单只在 core/capabilities.js 定义一次，应用协议只在 core/app-host.js 实现一次。' }),
  ]));
  root.appendChild(el('div', { class: 'section-title', text: '形态地图' }));
  root.appendChild(el('table', { class: 'table' }, [
    el('thead', {}, [el('tr', {}, [el('th', { text: '形态' }), el('th', { text: '入口' }), el('th', { text: '怎么接同一核心' })])]),
    el('tbody', {}, [
      ['本应用（内置浏览器 / PWA）', 'workbench/', '同源 /api/app/* → core/app-host.js'],
      ['桌面端 Electron', 'app/main.js', 'ipcMain workbench:* → core/app-host.js'],
      ['DSH 插件', 'plugins/dsh-review-analysis/', '/review-analysis/api/app/* → core/app-host.js'],
      ['WorkBuddy 专家 / CLI', 'plugins/review-analysis/bin/driver.js', '运行时 require core/index.js + capabilities.js'],
      ['HTTP 服务', 'server.js', '/api/core/* → core/request.js（同一 Core 实例）'],
    ].map(r => el('tr', {}, r.map(c => el('td', { text: c }))))),
  ]));
  root.appendChild(card('当前实例（真实数据）', kv([
    ['宿主', s.host.label], ['书数', st.bookCount], ['已分析', st.analyzedCount],
    ['能力数', st.actionCount], ['能力清单', (st.actions || []).join(' / ')],
    ['清单漂移', st.drift ? '有' : '无'],
  ])));
  root.appendChild(el('div', { class: 'notice', html:
    '<b>诚实边界</b>：DSH 宿主用自己的组件框架渲染侧栏面板，不能字节级复用本应用的 DOM 渲染器；' +
    '但两者消费的是<b>同一份 manifest、同一套 action 语义、同一份书库数据</b>，' +
    '由 <code>test/app-unified.test.js</code> 锁死一致性。' }));
}

/* ---------------- 分派 ---------------- */
const RENDERERS = {
  home: viewHome, library: viewLibrary, book: viewBook,
  practice: viewPractice, quiz: viewQuiz, due: viewDue,
  create: viewCreate, add: viewAdd, analyze: viewAnalyze,
  attempt: viewAttempt, rate: viewRate,
  settings: viewSettings, about: viewAbout,
};

// 进入依赖数据的视图时真拉一次。
// 重要：加载由路由变化触发（main.js 调 loadForView），**不在 renderView 里触发**。
// 否则 renderView 内发起请求 -> setViewData -> 订阅重绘 -> 又 renderView，
// 且「已有 data 就不拉」会让切回视图时永远显示旧数据（实测真 bug）。
const AUTO_LOAD = {
  library: { action: 'list', payload: () => ({}) },
  book: { action: 'get', payload: p => ({ bookId: p.id }), needsId: true },
  quiz: { action: 'quiz', payload: p => ({ bookId: p.id }), needsId: true },
  due: { action: 'due', payload: p => ({ bookId: p.id }), needsId: true },
  practice: { action: 'practice', payload: p => ({ bookId: p.id }), needsId: true },
};

/**
 * 路由变化时调用：每次进入视图都重新拉真数据，保证 APP 里看到的就是后端当前状态。
 * 由 main.js 的 router.start 回调触发，避免与订阅重绘互相递归。
 */
export function loadForView(view, params) {
  if (!view) return;
  const auto = AUTO_LOAD[view.id];
  if (!auto) return;
  // 与视图同一套取 id 规则：URL → 视图缓存 → 上次打开的书。
  // 否则从侧栏点「题目」时视图有书、数据却没去拉，界面会停在空态。
  const p = Object.assign({}, params || {});
  if (auto.needsId && !p.id) p.id = get().lastBookId;
  if (auto.needsId && !p.id) return;
  const payload = auto.payload(p);
  call(auto.action, payload, view.id);
}

export function renderView(root, view, params) {
  clear(root);
  if (!view) { root.appendChild(empty('视图不存在', '清单里没有这个页面')); return; }
  const fn = RENDERERS[view.id];
  if (!fn) { root.appendChild(empty('视图未实现：' + view.id, '这是一个清单漂移，请检查 core/app-host.js')); return; }
  fn(root, view, params || {});
}

export default { renderView, loadForView };
