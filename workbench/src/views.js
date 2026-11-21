// 视图层（workbench）。
// 判据：所有业务动作都经 host.action(action, payload) 走统一协议，
// action 名来自 manifest.capabilities，不在这里手写第二份清单。
// 视图只负责「把后端返回的真实数据画出来」，不自己算业务结论。

import { get, set, setViewData, toast, setTheme, setDensity } from './state.js';
import host from './host.js';
import { go } from './router.js';
import { el, h, clear, card, kv, badge, empty, loading, errorBox, btn, field, input } from './ui.js';
import { mountBookspace } from './bookspace.js';
import { loadSettings, saveSettings, credentialFields, testConnection, describeKeyState } from './llm-config.js';

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

  // 最近的书：打开应用第一屏就能继续读，不用先点书架再找
  const hd = $view('home');
  const recent = ((hd.data && hd.data.data && hd.data.data.books) || []).slice(0, 4);
  if (recent.length) {
    root.appendChild(el('div', { class: 'section-title', text: '继续' }));
    root.appendChild(el('div', { class: 'grid' }, recent.map((b) =>
      el('button', { class: 'tile', onclick: () => go('book', { id: b.id }) }, [
        el('div', { class: 'tile-title', text: b.title || b.id }),
        el('div', { class: 'tile-desc', text: (b.analyzed ? '已分析' : '未分析') + ' · ' + (b.fileCount == null ? 0 : b.fileCount) + ' 份资料' }),
        el('div', { class: 'tile-arrow', text: '→' }),
      ]))));
  }

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
  // 汇总「今日待复习」写进状态，标题栏据此显示入口（只读汇总，按书区分仍看每张卡片）。
  // 必须延后 set：同步 set 会在本次渲染还没结束时就触发 subscribe→renderView，
  // 于是这一遍的 appendChild 落到新容器里，界面出现两份书卡（2026-11-21 真机实测）。
  const dueTotal = books.reduce((a, b) => a + (Number(b.dueCount) || 0), 0);
  // 页头「待复习 N」点下去要真的到得了题：记住第一本有到期卡的书。
  const dueBook = books.find((b) => Number(b.dueCount) > 0);
  const dueBookId = dueBook ? dueBook.id : '';
  if (Number(get().dueTotal || 0) !== dueTotal || String(get().dueBookId || '') !== dueBookId) {
    setTimeout(() => set({ dueTotal, dueBookId }), 0);
  }
  if (!books.length) {
    const box = el('div', { class: 'library-empty' }, [
      el('div', { class: 'bs-cta-art', text: '▤' }),
      el('h3', { text: '书架是空的' }),
      el('p', { text: '建一本书、把资料拖进去，模型会把整本书读一遍，生成思维导图、提纲和题型分类。' }),
      el('div', { class: 'bs-cta-acts' }, [
        btn('＋ 新建第一本书', () => go('create'), 'primary'),
        btn('看示例书怎么用', () => go('about'), 'ghost'),
      ]),
    ]);
    return root.appendChild(box);
  }
  root.appendChild(el('div', { class: 'book-grid' }, books.map(b =>
    el('div', { class: 'book-card', onclick: () => go('book', { id: b.id }) }, [
      el('div', { class: 'book-cover' }, [el('span', { text: String(b.title || '未命名').slice(0, 1) })]),
      el('div', { class: 'book-info' }, [
        el('div', { class: 'book-title', text: b.title || b.id }),
        el('div', { class: 'book-meta' }, [
          badge(b.analyzed ? '已分析' : '未分析', b.analyzed ? 'accent' : 'plain'),
          el('span', { class: 'sub', text: (b.fileCount == null ? 0 : b.fileCount) + ' 份资料' }),
          // 今日待复习（2026-11-21）：书架第一眼要回答「今天该学什么」。
          Number(b.dueCount) > 0 ? badge('待复习 ' + b.dueCount, 'accent') : null,
        ]),
      ]),
      el('div', { class: 'book-actions' }, [
        btn('打开', () => go('book', { id: b.id }), 'primary sm'),
      ]),
    ]))));
}

function viewBook(root, view, params) {
  const id = params.id || $view('book').bookId || get().lastBookId || '';
  if (id) rememberBook(id);
  if (!id) {
    root.appendChild(empty('先选一本书', '从书架点一本书进来'));
    root.appendChild(el('div', { class: 'center' }, [btn('去书架', () => go('library'), 'primary')]));
    return;
  }
  // 书内工作区：左栏资料/题型、中间导图|提纲|题型、右侧逐步讲解。
  // 挂载是异步的（要拉 get/quiz/practice），这里不 await，避免阻塞路由渲染。
  mountBookspace(root, id, params).catch((e) => {
    root.appendChild(el('div', { class: 'bs-cta' }, [
      el('h3', { text: '打开这本书失败' }),
      el('p', { text: String((e && e.message) || e) }),
        el('div', { class: 'bs-cta-acts' }, [btn('重试', () => location.reload(), 'primary')]),
    ]));
  });
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
  const bookTitle = String(params.title || params.bookTitle || '这本书');
  // 2026-11-21：练习页继承书内沉浸态（main.js 已对 BOOK_VIEWS 加 bs-focus），
  // 顶部给一条回书的路，不再是「跳出去换了一个 App」。
  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [
      el('div', { class: 'bs-backline' }, [
        el('a', { class: 'bs-back', href: '#/book?id=' + encodeURIComponent(id), text: '← 回到《' + bookTitle + '》' }),
      ]),
      el('h2', { text: '练习' }),
      el('p', { class: 'sub', text: '先答后揭；答完会告诉你下次什么时候再见，可以改' }),
    ]),
    el('div', { class: 'view-actions' }, [
      // 同屏可切：做题时想起某个知识点，不用先退回书架再进书（2026-11-21）。
      btn('看导图', () => go('book', { id }), 'ghost'),
      btn('今日到期', () => go('due', { id, title: bookTitle }), 'ghost'),
      btn('刷新', () => call('quiz', { bookId: id }, 'quiz'), 'ghost'),
    ]),
  ]));
  if (d.loading) return root.appendChild(loading('取题…'));
  if (d.error) return root.appendChild(errorBox(d.error, () => call('quiz', { bookId: id }, 'quiz')));
  const payload = d.data && d.data.data;
  const qs = (payload && payload.questions) || [];
  if (!qs.length) return root.appendChild(empty('没有可练的题目', '先做整体分析，或看看今日到期'));
  renderQuizCards(root, id, qs);
}

/**
 * 题目列表渲染（2026-11-21 抽出）：练习页与「今日到期」共用同一套题卡。
 * 抽出的理由：到期页原来直接 dump 数据块，用户点「待复习 N」看到的是 JSON——
 * 那不是复习，是调试。两个入口必须是同一个能做题的界面。
 */
function renderQuizCards(root, id, qs) {
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
      if (!r || r.ok === false) { submit.disabled = false; return toast((r && r.error) || '提交失败', 'bad'); }
      done[key] = r.data;
      // 答完就把按钮定住：同一题不该出现第二个可点的「作答」（真机看着像还能再答一次）。
      submit.textContent = '已作答';
      renderResult(r.data, optEls, resultBox, rateBox, id, key);
    }, 'primary sm');
    return el('div', { class: 'q-card' }, [
      el('div', { class: 'q-head' }, [
        // 全局题号（2026-11-21）：与题型页、概览页同一个号，学生才能说「第 13 题」。
        badge('第 ' + (Number(q.seqNo) > 0 ? Number(q.seqNo) : i + 1) + ' 题', 'plain'),
        badge(String(q.type || '题目'), 'accent'),
        q.subtype ? el('span', { class: 'q-sub', text: String(q.subtype) }) : null,
      ]),
      el('div', { class: 'q-stem', text: q.stem || '' }),
      // 题目配图（2026-11-21）：图是题面的一部分，做题时必须在旁边。
      // 复用书内同一套 .bs-inline-figs 样式，只是这里是练习态（点开放大）。
      quizFigures(id, q),
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
/** 全屏看图（练习页用）。图字节不动，只放大显示。 */
function openLightbox(url, caption) {
  const mask = el('div', { class: 'bs-lightbox' }, [
    el('img', { src: url, alt: caption || '题目配图' }),
    el('div', { class: 'bs-lightbox-cap', text: caption || '资料原图 · 原样复现' }),
  ]);
  mask.addEventListener('click', () => mask.remove());
  document.body.appendChild(mask);
}

/**
 * 练习页的题目配图（2026-11-21）。
 * 判据：题干写「根据图中」的题，做题页面必须看得到图——图是题面的一部分，不是答案。
 * 所以在「作答」之前就渲染，点开可看原尺寸。
 */
function quizFigures(bookId, q) {
  const ids = Array.isArray(q.imageIds) ? q.imageIds.filter(Boolean) : [];
  if (!ids.length) return null;
  const figs = ids.map((imageId) => {
    const url = host.imageUrl(bookId, imageId);
    if (!url) return el('div', { class: 'bs-q-fig-none', text: '题目配图（桌面端请在浏览器查看）' });
    return el('button', {
      class: 'bs-inline-fig',
      title: '点开看原图尺寸',
      onclick: () => openLightbox(url, '题目配图'),
    }, [el('img', { src: url, alt: '题目配图', loading: 'lazy' })]);
  });
  return el('div', { class: 'bs-inline-figs' }, [
    el('div', { class: 'bs-inline-figs-t', text: '这道题要看的图' }),
  ].concat(figs));
}

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

  // 排程结果说人话（2026-11-21，对齐 Anki「评分前显示下一个间隔」）：
  // 先说「已按什么排程、多久后见」，再给可改的四档——用户既不用猜，也不用被迫多点一次。
  const why = data.scheduledBy === 'auto-correct' ? '答对 · 记得'
    : data.scheduledBy === 'auto-wrong' ? '答错 · 重来'
      : data.scheduledBy === 'self' ? '按你的自评' : '已排程';
  const cur = data.currentLabel || (data.dueAt ? new Date(data.dueAt).toLocaleString('zh-CN') : '—');
  box.appendChild(el('div', { class: 'q-note q-sched', text: why + ' → ' + cur + '再见' }));

  rateBox.classList.remove('hidden');
  rateBox.appendChild(el('span', { class: 'sub', text: '觉得不准？改一档：' }));
  const iv = Array.isArray(data.nextIntervals) && data.nextIntervals.length
    ? data.nextIntervals
    : [{ rating: 1, name: '重来', label: '' }, { rating: 2, name: '吃力', label: '' },
       { rating: 3, name: '会了', label: '' }, { rating: 4, name: '太简单', label: '' }];
  iv.forEach((x) => {
    rateBox.appendChild(btn(String(x.name || '') + (x.label ? ' · ' + x.label : ''), async () => {
      const r = await host.action('rate', { bookId, key, rating: x.rating });
      if (!r || r.ok === false) return toast((r && r.error) || '自评失败', 'bad');
      const at = r.data && r.data.dueAt ? new Date(r.data.dueAt).toLocaleString('zh-CN') : '';
      toast('已改成「' + (x.name || '') + '」：' + at + ' 再见', 'ok');
      rateBox.innerHTML = '';
      rateBox.appendChild(el('span', { class: 'sub', text: '已改为「' + (x.name || '') + '」· ' + at + ' 再见' }));
    }, 'ghost sm'));
  });
}

function viewDue(root, view, params) {
  const id = needBook(root, 'due', params);
  if (!id) return;
  const d = $view('due');
  const bookTitle = String(params.title || params.bookTitle || '这本书');
  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [
      el('div', { class: 'bs-backline' }, [
        el('a', { class: 'bs-back', href: '#/book?id=' + encodeURIComponent(id), text: '← 回到《' + bookTitle + '》' }),
      ]),
      el('h2', { text: '今日到期' }),
      el('p', { class: 'sub', text: '今天该复习的题；答完会自动排下一次' }),
    ]),
    el('div', { class: 'view-actions' }, [
      btn('练全部题', () => go('quiz', { id, title: bookTitle }), 'ghost'),
      btn('看导图', () => go('book', { id }), 'ghost'),
      btn('刷新', () => call('due', { bookId: id }, 'due'), 'ghost'),
    ]),
  ]));
  if (d.loading) return root.appendChild(loading('取到期队列…'));
  if (d.error) return root.appendChild(errorBox(d.error, () => call('due', { bookId: id }, 'due')));
  const payload = d.data && d.data.data;
  const qs = (payload && payload.questions) || [];
  if (!qs.length) {
    // 空队列不是错误：说清「现在没到期」，并给一条去练新题的路，不做假数据填充。
    return root.appendChild(el('div', { class: 'bs-cta' }, [
      el('div', { class: 'bs-cta-art', text: '✓' }),
      el('h3', { text: '今天没有到期的题' }),
      el('p', { text: '间隔重复按「该忘的时候再问」排程。想多练可以直接做全部题，不影响排程。' }),
      el('div', { class: 'bs-cta-acts' }, [
        btn('去练全部题', () => go('quiz', { id, title: bookTitle }), 'primary'),
        btn('回到这本书', () => go('book', { id }), 'ghost'),
      ]),
    ]));
  }
  renderQuizCards(root, id, qs);
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
    el('div', {}, [el('h2', { text: '整体分析' }), el('p', { class: 'sub', text: '大模型把整本书当一个整体；密钥存在本机服务，不用每次填' })]),
  ]));
  if (!id) return root.appendChild(empty('先选一本书', '从书架进入'));
  // 已配置时表单只是「看一眼/临时改一下」，不再要求每次粘密钥（2026-11-21）。
  const cfgBox = el('div', {}, [loading('正在读取模型配置…')]);
  root.appendChild(card('模型配置', [
    cfgBox,
    d.loading ? loading('模型正在整本分析…') : null,
    d.error ? el('div', { class: 'inline-error', text: d.error }) : null,
  ]));
  (async () => {
    const s = await loadSettings();
    clear(cfgBox);
    if (s && s.unsupported) cfgBox.appendChild(el('p', { class: 'para', text: '当前宿主没有配置存储（' + (s.error || '') + '），请手动填写地址与密钥。' }));
    const fields = credentialFields(s);
    cfgBox.appendChild(fields.node);
    cfgBox.appendChild(el('div', { class: 'form-actions' }, [
      btn('开始整体分析', async () => {
        const r = fields.read();
        if (!r.model) return fields.setHint('先选一个对话模型（点「找模型」或手填）', 'bad');
        if (!r.apiKey && !(s && s.hasKey)) return fields.setHint('还没有密钥：填一个再开始', 'bad');
        await saveSettings({ baseURL: r.baseURL, model: r.model, apiKey: r.apiKey || undefined });
        const cfg = { baseURL: r.baseURL, model: r.model };
        if (r.apiKey) cfg.apiKey = r.apiKey;
        toast('已提交，整本分析通常要 1–3 分钟', 'info');
        const res = await call('analyze', { bookId: id, cfg }, 'analyze');
        if (res.ok) { toast('分析完成', 'good'); go('book', { id }); }
      }, 'primary'),
    ]));
    fields.setHint(describeKeyState(s).text, describeKeyState(s).kind);
  })();
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
/**
 * 模型与密钥卡片（2026-11-21）。
 * 判据：这是全套应用唯一需要密钥的地方，必须在设置页有一等位置——
 * 只藏在「分析」对话框里的配置，等于用户每次都要重新找一遍。
 */
async function mountLlmSettings(box) {
  const s = await loadSettings(true);
  clear(box);
  if (s && s.unsupported) {
    box.appendChild(el('p', { class: 'para', text: '当前宿主没有配置存储（' + (s.error || '') + '）：分析时仍需手动填地址与密钥。' }));
    return;
  }
  const fields = credentialFields(s);
  // 包一层 form：一是让密码框属于某个表单（浏览器不再报「Password field is not contained in a form」），
  // 二是回车即保存，符合表单肌肉记忆。提交一律 preventDefault，保存逻辑只在按钮里。
  const form = el('form', { class: 'llm-form' });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.appendChild(fields.node);
  const actions = el('div', { class: 'form-actions' }, [
    btn('保存', async () => {
      const r = fields.read();
      if (!r.model) return fields.setHint('还要选一个对话模型（点「找模型」或手填）', 'bad');
      fields.setHint('正在保存…', '');
      const saved = await saveSettings({ baseURL: r.baseURL, model: r.model, visionModel: r.visionModel, apiKey: r.apiKey || undefined });
      if (!saved || saved.ok === false) return fields.setHint('保存失败：' + ((saved && saved.error) || '未知原因'), 'bad');
      fields.setHint('已保存。以后分析、生成考点大全都不再问你要密钥。', 'good');
      toast('模型配置已保存', 'ok');
      // 顶部横幅里那句「还没有密钥」也该跟着消失：重画设置页即可
      setTimeout(() => { if (get().route === 'settings') go('settings'); }, 600);
    }, 'primary'),
    btn('测试连接', async () => {
      const r = fields.read();
      fields.setHint('正在用 ' + (r.model || '默认模型') + ' 发一次最小请求…', '');
      const t = await testConnection(r);
      if (t && t.ok) fields.setHint('连通正常：' + (t.model || r.model) + ' 可用。', 'good');
      else fields.setHint('连不通：' + ((t && t.error) || '未知原因'), 'bad');
    }, 'ghost'),
    btn('清掉已存密钥', async () => {
      const saved = await saveSettings({ clearKey: true });
      if (!saved || saved.ok === false) return toast('清除失败', 'bad');
      toast(saved.hasKey ? '已清除，改用环境变量里的密钥' : '已清除密钥', 'ok');
      mountLlmSettings(box);
    }, 'ghost sm'),
  ]);
  form.appendChild(actions);
  form.appendChild(el('p', { class: 'field-hint', text:
    '密钥只存在本机：优先读环境变量 SILICONFLOW_API_KEY；在这里填过一次后写进 library/settings.json（已在 .gitignore，不入库）。' +
    '页面拿到的永远是掩码，不会回传原文。' }));
  box.appendChild(form);
}

function viewSettings(root) {
  const s = get();
  root.appendChild(el('div', { class: 'view-head' }, [el('div', {}, [el('h2', { text: '设置' }), el('p', { class: 'sub', text: '外观只影响本应用；模型配置是全应用共用的' })])]));
  const llmBox = el('div', {}, [loading('正在读取模型配置…')]);
  root.appendChild(el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h3', { text: '模型与密钥' })]),
    el('div', { class: 'card-body' }, [llmBox]),
  ]));
  mountLlmSettings(llmBox);
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
  home: { action: 'list', payload: () => ({}) },
  library: { action: 'list', payload: () => ({}) },
  // book 自己负责取数（书内工作区要 get + quiz + practice + list 四路并发）：
  // 这里再挂一个 get 会多打一次请求，失败时还会弹「该书尚无分析结果」的红条（实测）。

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
