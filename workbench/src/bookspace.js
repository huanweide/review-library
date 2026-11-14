// 书内工作区（workbench）——把「打开一本书」做成真正能用的学习空间。
//
// 布局判据（对着需求逐条落）：
//   左栏   书信息 + 拖拽导入 + 资料存放结构（可整栏收拉）+ 题型分类树
//   中间   四个页签：思维导图 / 提纲讲解 / 题型 / 概览；没分析时给「开始分析」的诚实入口
//   右侧   知识点讲解面板：点导图节点或提纲条目就在这里「一步一步讲」
//
// 数据只走统一协议（get / quiz / add / analyze / attempt / rate），不自己读盘、不伪造内容。
// 讲解文本全部来自本书的真实分析结果（节点 desc / 题型 / 真题 / 思路 / 易错），不现编。

import { el, badge, empty, btn } from './ui.js';
import { toast } from './state.js';
import host from './host.js';
import { go } from './router.js';
import { mountMindmap } from './mindmap.js';

const TABS = [
  { id: 'map', label: '思维导图' },
  { id: 'outline', label: '提纲讲解' },
  { id: 'types', label: '题型' },
  { id: 'about', label: '概览' },
];

function fileIcon(ext) {
  const e = String(ext || '').toLowerCase();
  if (['.pdf'].includes(e)) return 'PDF';
  if (['.doc', '.docx'].includes(e)) return 'DOC';
  if (['.ppt', '.pptx'].includes(e)) return 'PPT';
  if (['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].includes(e)) return 'IMG';
  if (['.xls', '.xlsx', '.csv'].includes(e)) return 'XLS';
  return (e.replace('.', '') || 'TXT').toUpperCase().slice(0, 3);
}
function humanSize(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  return (v / 1024 / 1024).toFixed(1) + ' MB';
}
function walkTree(node, depth, path, out) {
  if (!node) return out;
  const cur = path.concat(String(node.title || ''));
  out.push({ node, depth, path: cur });
  (node.children || []).forEach((c) => walkTree(c, depth + 1, cur, out));
  return out;
}
function findNodeById(tree, id) {
  let hit = null;
  (function walk(n) {
    if (!n || hit) return;
    if (String(n.id) === String(id)) { hit = n; return; }
    (n.children || []).forEach(walk);
  })(tree);
  return hit;
}
function pathOfNode(tree, id) {
  let out = null;
  (function walk(n, trail) {
    if (!n || out) return;
    const cur = trail.concat(String(n.title || ''));
    if (String(n.id) === String(id)) { out = cur; return; }
    (n.children || []).forEach((c) => walk(c, cur));
  })(tree, []);
  return out || [];
}
function allQuestions(analysis) {
  const out = [];
  ((analysis && analysis.questionIndex) || []).forEach((g) => {
    (g.items || []).forEach((it) => {
      (it.questions || []).forEach((q) => out.push(Object.assign({ type: g.type, subtype: it.title, path: it.path }, q)));
    });
  });
  return out;
}
// 由近及远找「这条分支上有题」的最近一层。
// 关键点：题目的 pointPath 不含书根（从「第一章」开始），所以必须用**后缀**匹配，
// 拿整条 path 从头比会永远不命中（实测：点了叶子节点，真题步骤一直空白）。
function questionsFromBranch(analysis, pathArr) {
  // 题目的 pointPath 从「第一章」开始，不含书根；而节点的 path 含书根。
  // 所以按「去掉书根后的祖先链」逐层收窄：只要题目的 path 是这一层的前缀，就算命中。
  const path = (pathArr || []).map(String);
  const all = allQuestions(analysis);
  for (let k = path.length; k >= 2; k--) {
    const sub = path.slice(1, k);           // 去掉书根，保留章/节/知识点
    if (!sub.length) continue;
    const hits = all.filter((q) => {
      const pp = (q.pointPath || []).map(String);
      if (!pp.length || pp.length > sub.length) return false;
      for (let i = 0; i < pp.length; i++) if (pp[i] !== sub[i]) return false;
      return true;
    });
    if (hits.length) {
      const pp = (hits[0].pointPath || []).map(String);
      return { list: hits, level: pp[pp.length - 1] || sub[sub.length - 1] };
    }
  }
  return { list: [], level: '' };
}

function questionsOfNode(analysis, node) {
  // 不只匹配当前节点：题目常常挂在更深一层的知识点上，
  // 只看自己会让「章」级节点永远显示 0 题（实测），所以连子树一起收。
  const ids = new Set();
  const titles = new Set();
  (function walk(n) {
    if (!n) return;
    if (n.id) ids.add(String(n.id));
    if (n.title) titles.add(String(n.title));
    (n.children || []).forEach(walk);
  })(node);
  return allQuestions(analysis).filter((q) =>
    (q.pointId && ids.has(String(q.pointId))) ||
    (q.pointPath || []).some((t) => titles.has(String(t))));
}

export async function mountBookspace(root, bookId, params) {
  const S = {
    id: String(bookId || ''),
    tab: TABS.some((t) => t.id === (params && params.tab)) ? params.tab : 'map',
    analysis: null,
    quiz: null,
    practice: null,
    book: null,
    activeType: '',
    picked: null,       // { node, path }
    loading: true,
    err: '',
    analyzing: false,
    importing: false,
    railOpen: true,
    step: 1,            // 讲解面板已展开到第几步
  };

  document.body.classList.add('bs-focus');

  // 文件选择框只建一次：早先放在左栏里、每次重渲染都重建，
  // 用户/自动化选文件的瞬间若赶上重渲染，选中的文件会跟着旧节点一起丢（实测导入变 0 份）。
  const fileInput = el('input', { type: 'file', multiple: true, class: 'hidden' });
  fileInput.addEventListener('change', () => upload(Array.from(fileInput.files || [])));

  const shell = el('div', { class: 'bs' + (S.railOpen ? '' : ' rail-closed') });
  const railEl = el('aside', { class: 'bs-rail' });
  const mainEl = el('section', { class: 'bs-main' });
  const detailEl = el('aside', { class: 'bs-detail hidden' });
  shell.appendChild(railEl);
  shell.appendChild(mainEl);
  shell.appendChild(detailEl);
  shell.appendChild(fileInput);
  root.appendChild(shell);

  // 收拉手柄：整栏资料结构可以「拉出来 / 收回去」，不占死固定宽度
  const handle = el('button', {
    class: 'bs-handle', title: '收起 / 拉出资料栏',
    onclick: () => {
      S.railOpen = !S.railOpen;
      shell.classList.toggle('rail-closed', !S.railOpen);
      handle.textContent = S.railOpen ? '‹' : '›';
    },
  }, [el('span', { text: '‹' })]);
  shell.appendChild(handle);

  async function load() {
    S.loading = true;
    render();
    try {
      const g = await host.action('get', { bookId: S.id });
      if (g && g.ok) {
        S.analysis = g.data;
        S.book = (g.data && g.data.book) || null;
      } else {
        S.analysis = null;
        S.err = (g && g.error) || '';
      }
      // 没分析也要能把书拿回来（标题 / 资料清单）——每次都用列表兜底刷新，
      // 否则「未分析」的书导完资料仍显示 0 份（get 拿不到，旧 S.book 又是空的）。
      const l = await host.action('list', {});
      const hit = ((l && l.ok && l.data && l.data.books) || []).find((b) => b.id === S.id);
      if (hit) S.book = Object.assign({ files: [] }, hit);
      const q = await host.action('quiz', { bookId: S.id });
      S.quiz = (q && q.ok) ? q.data : null;
      const pr = await host.action('practice', { bookId: S.id });
      S.practice = (pr && pr.ok) ? pr.data : null;
    } catch (e) {
      S.err = String(e.message || e);
    }
    S.loading = false;
    render();
  }

  function render() {
    railEl.innerHTML = '';
    mainEl.innerHTML = '';
    buildRail();
    buildMain();
  }

  /* ---------------- 左栏：书 / 导入 / 资料 / 题型 ---------------- */
  function buildRail() {
    const files = (S.book && S.book.files) || [];
    const title = (S.book && S.book.title) || '这本书';
    const groups = (S.analysis && S.analysis.questionIndex) || [];
    const totalQ = allQuestions(S.analysis).length;

    railEl.appendChild(el('div', { class: 'bs-book' }, [
      el('div', { class: 'bs-cover', text: String(title).slice(0, 1) }),
      el('div', { class: 'bs-bookinfo' }, [
        el('div', { class: 'bs-title', text: title }),
        el('div', { class: 'bs-sub', text: S.analysis ? ('已分析 · ' + files.length + ' 份资料 · ' + totalQ + ' 道题') : (files.length + ' 份资料 · 未分析') }),
      ]),
    ]));

    // 导入区：拖进来，或点击选文件。放在左栏顶部，是「打开一本书」最自然的第一个动作。
    const drop = el('div', { class: 'bs-drop' }, [
      el('div', { class: 'bs-drop-main', text: S.importing ? '导入中…' : '拖文件到这里' }),
      el('div', { class: 'bs-drop-sub', text: 'PDF / Word / PPT / 图片，或点击选择' }),
    ]);
    drop.addEventListener('click', () => fileInput.click());
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('on'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('on'); }));
    drop.addEventListener('drop', (e) => {
      const fs = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (fs.length) upload(fs);
    });
    railEl.appendChild(drop);

    // 资料结构：默认展开，可收起（不是死列表，是「能拉出来的抽屉」）
    const filesBox = el('div', { class: 'bs-sec' });
    const filesHead = el('button', { class: 'bs-sec-head', onclick: () => filesBox.classList.toggle('fold') }, [
      el('span', { class: 'caret', text: '▾' }),
      el('span', { text: '资料' }),
      el('span', { class: 'count', text: String(files.length) }),
    ]);
    filesBox.appendChild(filesHead);
    const fileList = el('div', { class: 'bs-list' }, files.length ? files.map((f) => el('div', { class: 'bs-file', title: f.name }, [
      el('span', { class: 'bs-ext', text: fileIcon(f.ext) }),
      el('span', { class: 'bs-file-name', text: f.name }),
      el('span', { class: 'bs-file-size', text: humanSize(f.size) }),
    ])) : [el('div', { class: 'bs-hint', text: '还没有资料，拖一份进来试试' })]);
    filesBox.appendChild(fileList);
    railEl.appendChild(filesBox);

    // 题型分类树：点一项 → 中间切到题型页并定位该分类
    const typesBox = el('div', { class: 'bs-sec' });
    const typesHead = el('button', { class: 'bs-sec-head', onclick: () => typesBox.classList.toggle('fold') }, [
      el('span', { class: 'caret', text: '▾' }),
      el('span', { text: '题型分类' }),
      el('span', { class: 'count', text: String(groups.length) }),
    ]);
    typesBox.appendChild(typesHead);
    const typeList = el('div', { class: 'bs-list' }, groups.length ? groups.map((g) => {
      const n = (g.items || []).reduce((s, it) => s + ((it.questions || []).length), 0);
      return el('button', {
        class: 'bs-type' + (S.activeType === g.type ? ' on' : ''),
        onclick: () => { S.activeType = g.type; S.tab = 'types'; render(); },
      }, [
        el('span', { class: 'bs-type-dot' }),
        el('span', { class: 'bs-type-name', text: String(g.type || '未分类') }),
        el('span', { class: 'count', text: String(n) }),
      ]);
    }) : [el('div', { class: 'bs-hint', text: '分析完成后，这里按题型列出全部题目' })]);
    typesBox.appendChild(typeList);
    railEl.appendChild(typesBox);

    // 底部动作
    const acts = el('div', { class: 'bs-acts' });
    acts.appendChild(btn(S.analysis ? '重新分析' : '开始分析', openAnalyze, 'primary sm'));
    if (S.analysis) acts.appendChild(btn('去练习', () => go('quiz', { id: S.id }), 'ghost sm'));
    railEl.appendChild(acts);
  }

  /* ---------------- 中间：页签 ---------------- */
  function buildMain() {
    const head = el('div', { class: 'bs-head' }, [
      el('div', { class: 'bs-tabs' }, TABS.map((t) => el('button', {
        class: 'bs-tab' + (S.tab === t.id ? ' on' : ''),
        text: t.label,
        onclick: () => { S.tab = t.id; S.picked = null; detailEl.classList.add('hidden'); render(); },
      }))),
      el('div', { class: 'bs-head-right' }, [
        el('button', { class: 'btn ghost sm', text: '← 书架', onclick: () => go('library') }),
      ]),
    ]);
    mainEl.appendChild(head);

    const body = el('div', { class: 'bs-body' });
    mainEl.appendChild(body);
    if (S.loading) { body.appendChild(el('div', { class: 'bs-loading', text: '读取这本书…' })); return; }
    if (S.tab === 'map') return renderMap(body);
    if (S.tab === 'outline') return renderOutline(body);
    if (S.tab === 'types') return renderTypes(body);
    return renderAbout(body);
  }

  function needAnalysis(body, what) {
    if (S.analysis) return false;
    body.appendChild(el('div', { class: 'bs-cta' }, [
      el('div', { class: 'bs-cta-art', text: '✦' }),
      el('h3', { text: '这本书还没有分析结果' }),
      el('p', { text: (S.book && S.book.files && S.book.files.length)
        ? '资料已经就位。点「开始分析」，模型会把整本书当作一个整体，生成思维导图、提纲和题型分类。'
        : '先在左边拖入资料（PDF / Word / PPT / 图片），再开始分析。' }),
      el('div', { class: 'bs-cta-acts' }, [
        btn(S.book && S.book.files && S.book.files.length ? '开始分析' : '先导入资料', () => {
          if (S.book && S.book.files && S.book.files.length) openAnalyze();
          else railEl.querySelector('.bs-drop') && railEl.querySelector('.bs-drop').click();
        }, 'primary'),
        S.err ? btn('看错误详情', () => toast(S.err, 'bad'), 'ghost') : null,
      ]),
      el('p', { class: 'bs-hint', text: what || '' }),
    ]));
    return true;
  }

  function renderMap(body) {
    if (needAnalysis(body)) return;
    body.classList.add('mapmode');
    const wrap = el('div', { class: 'mm-wrap grow' });
    body.appendChild(wrap);
    mountMindmap(wrap, S.analysis.tree, {
      onPick: (node) => {
        S.picked = { node: findNodeById(S.analysis.tree, node.id) || node, path: pathOfNode(S.analysis.tree, node.id) };
        S.step = 1;
        renderDetail();
      },
    });
    body.appendChild(el('p', { class: 'bs-hint', text: '点任一节点 → 右侧逐步讲解这个知识点（是什么 / 常考 / 真题 / 易错）' }));
  }

  function renderOutline(body) {
    if (needAnalysis(body)) return;
    const rows = walkTree(S.analysis.tree, 0, [], []);
    const list = el('div', { class: 'bs-outline' });
    rows.forEach(({ node, depth, path }) => {
      const qs = questionsOfNode(S.analysis, node);
      const hasKids = (node.children || []).length > 0;
      list.appendChild(el('button', {
        class: 'bs-ol-row d' + Math.min(depth, 4) + (hasKids ? ' branch' : ' leaf'),
        onclick: () => { S.picked = { node, path }; S.step = 1; renderDetail(); },
      }, [
        el('span', { class: 'bs-ol-title', text: String(node.title || '未命名') }),
        node.desc ? el('span', { class: 'bs-ol-desc', text: String(node.desc) }) : null,
        qs.length ? el('span', { class: 'count', text: qs.length + ' 题' }) : null,
      ]));
    });
    body.appendChild(list);
    body.appendChild(el('p', { class: 'bs-hint', text: '点任意一条 → 右侧从「这是什么」开始，一步步讲给你听' }));
  }

  function renderTypes(body) {
    if (needAnalysis(body)) return;
    const groups = S.analysis.questionIndex || [];
    if (!groups.length) { body.appendChild(empty('分析结果里没有题型', '重新分析一次，或在提纲里看看知识点')); return; }
    groups.forEach((g) => {
      const qs = (g.items || []).reduce((s, it) => s + ((it.questions || []).length), 0);
      const cardEl = el('div', { class: 'bs-tcard' + (S.activeType === g.type ? ' on' : '') });
      const head = el('button', {
        class: 'bs-tcard-head',
        onclick: () => { S.activeType = S.activeType === g.type ? '' : g.type; render(); },
      }, [
        el('span', { class: 'bs-tname', text: String(g.type || '未分类') }),
        badge(qs + ' 题', 'accent'),
        el('span', { class: 'bs-sub', text: (g.items || []).map((it) => it.title).filter(Boolean).join(' · ') }),
        el('span', { class: 'caret', text: S.activeType === g.type ? '▾' : '▸' }),
      ]);
      cardEl.appendChild(head);
      if (S.activeType === g.type) {
        const box = el('div', { class: 'bs-qlist' });
        (g.items || []).forEach((it) => {
          (it.questions || []).forEach((q, i) => box.appendChild(questionCard(q, it, i)));
        });
        cardEl.appendChild(box);
      }
      body.appendChild(cardEl);
    });
  }

  function questionCard(q, it, i) {
    const answer = el('div', { class: 'bs-ans hidden' }, [
      el('div', { class: 'bs-ans-line', text: '答案：' + (q.answer || '—') }),
      (q.solution || []).length ? el('div', { class: 'bs-sol' }, (q.solution || []).map((s) => el('div', { class: 'bs-step', text: s }))) : null,
      q.rationale ? el('div', { class: 'bs-note', text: '思路：' + q.rationale }) : null,
      q.pitfalls ? el('div', { class: 'bs-note', text: '易错：' + q.pitfalls }) : null,
    ]);
    return el('div', { class: 'bs-q' }, [
      el('div', { class: 'bs-q-head' }, [
        badge('第 ' + (i + 1) + ' 题', 'plain'),
        badge(String(q.difficulty || '基础'), 'plain'),
        el('span', { class: 'bs-sub', text: (it && it.title) || '' }),
      ]),
      el('div', { class: 'bs-q-stem', text: q.stem || '' }),
      (q.options || []).length ? el('div', { class: 'bs-q-opts' }, q.options.map((o) => el('div', { class: 'bs-q-opt', text: o }))) : null,
      el('div', { class: 'bs-q-acts' }, [
        el('button', { class: 'btn ghost sm', text: '显示答案', onclick: (e) => {
          const b = e.currentTarget;
          const hidden = answer.classList.toggle('hidden');
          b.textContent = hidden ? '显示答案' : '收起答案';
        } }),
        q.source && q.source.file ? el('span', { class: 'bs-src', text: '来源：' + q.source.file + (q.source.loc ? ' · ' + q.source.loc : '') }) : null,
      ]),
      answer,
    ]);
  }

  function renderAbout(body) {
    if (needAnalysis(body)) return;
    const a = S.analysis;
    const st = a.stats || {};
    const files = (S.book && S.book.files) || [];
    body.appendChild(el('div', { class: 'bs-grid' }, [
      el('div', { class: 'bs-card' }, [
        el('h4', { text: '这本书' }),
        el('div', { class: 'bs-kv' }, [
          ['书名', (S.book && S.book.title) || '—'],
          ['资料', files.length + ' 份'],
          ['章节', st.chapters == null ? '—' : st.chapters],
          ['知识点', st.points == null ? '—' : st.points],
          ['题型', st.questionTypes == null ? '—' : st.questionTypes],
          ['题目', st.questionCount == null ? '—' : st.questionCount],
          ['模型', a.model || '—'],
        ].map(([k, v]) => el('div', { class: 'bs-kv-row' }, [el('span', { text: k }), el('strong', { text: String(v) })]))),
      ]),
      el('div', { class: 'bs-card' }, [
        el('h4', { text: '摘要' }),
        el('p', { class: 'bs-para', text: a.summary || '（模型没有给摘要）' }),
      ]),
    ]));
    if (files.length) {
      body.appendChild(el('div', { class: 'bs-card' }, [
        el('h4', { text: '资料清单' }),
        el('div', { class: 'bs-list' }, files.map((f) => el('div', { class: 'bs-file' }, [
          el('span', { class: 'bs-ext', text: fileIcon(f.ext) }),
          el('span', { class: 'bs-file-name', text: f.name }),
          el('span', { class: 'bs-file-size', text: humanSize(f.size) }),
        ]))),
      ]));
    }
  }

  /* ---------------- 右侧：一步一步讲 ---------------- */
  function renderDetail() {
    if (!S.picked) { detailEl.classList.add('hidden'); return; }
    const { node, path } = S.picked;
    let qs = questionsOfNode(S.analysis, node);
    let fallbackNote = '';
    if (!qs.length) {
      // 叶子知识点常常没有直接挂题（题目挂在上一层）。诚实回退：
      // 找最近有题的分支，并明确说明这些题来自哪一层，不冒充「本节真题」。
      const fb = questionsFromBranch(S.analysis, path);
      if (fb.list.length) {
        qs = fb.list;
        fallbackNote = '这个知识点本身没有直接挂题，下面是它所在分支「' + fb.level + '」的题。';
      }
    }
    const steps = [
      { t: '先定位：它在全书的哪儿', body: [el('div', { class: 'bs-path', text: (path || []).join('  ›  ') })] },
      { t: '这是什么', body: [el('p', { class: 'bs-para', text: node.desc || (
        (node.children || []).length
          ? '模型没给这一层的说明。它下面有 ' + (node.children || []).length + ' 个分支：' +
            (node.children || []).map((c) => c.title).filter(Boolean).join('、')
          : '这是最末端的一个知识点，底下没有更细的分支；直接看下面的真题最有效。'
      ) })] },
      { t: '常考什么', body: [(node.questionTypes || []).length
        ? el('div', { class: 'bs-chips' }, (node.questionTypes || []).map((x) => badge(x, 'accent')))
        : el('p', { class: 'bs-para', text: '模型没标这个知识点的题型；下面按真题看更准。' })] },
      { t: '真题长什么样', body: fallbackNote ? [el('p', { class: 'bs-note', text: fallbackNote })].concat(
        qs.slice(0, 2).map((q) => el('div', { class: 'bs-mini' }, [
          el('div', { class: 'bs-mini-stem', text: q.stem || '' }),
          el('div', { class: 'bs-note', text: '题型：' + (q.type || '') + (q.subtype ? ' · ' + q.subtype : '') }),
        ]))) : qs.length
        ? qs.slice(0, 2).map((q) => el('div', { class: 'bs-mini' }, [
          el('div', { class: 'bs-mini-stem', text: q.stem || '' }),
          el('div', { class: 'bs-note', text: '题型：' + (q.type || '') + (q.subtype ? ' · ' + q.subtype : '') }),
        ]))
        : [el('p', { class: 'bs-para', text: '这道分支下暂时没有题；换个更靠下的知识点看看。' })] },
      { t: '答案与思路（先自己想一想）', body: qs.length
        ? qs.slice(0, 2).map((q) => el('div', { class: 'bs-mini' }, [
          el('div', { class: 'bs-ans-line', text: '答案：' + (q.answer || '—') }),
          (q.solution || []).slice(0, 4).map((s) => el('div', { class: 'bs-step', text: s })),
          q.rationale ? el('div', { class: 'bs-note', text: '思路：' + q.rationale }) : null,
        ]))
        : [el('p', { class: 'bs-para', text: '暂无可用解析。' })] },
      { t: '最容易错的地方', body: qs.some((q) => q.pitfalls)
        ? qs.filter((q) => q.pitfalls).slice(0, 3).map((q) => el('div', { class: 'bs-note', text: '· ' + q.pitfalls }))
        : [el('p', { class: 'bs-para', text: '分析结果里没有标注易错点。' })] },
    ];
    detailEl.classList.remove('hidden');
    detailEl.innerHTML = '';
    detailEl.appendChild(el('div', { class: 'bs-detail-head' }, [
      el('div', {}, [el('div', { class: 'bs-detail-title', text: String(node.title || '知识点') }),
        el('div', { class: 'bs-sub', text: '第 ' + S.step + ' / ' + steps.length + ' 步' })]),
      el('button', { class: 'bs-x', text: '×', onclick: () => { S.picked = null; detailEl.classList.add('hidden'); } }),
    ]));
    const flow = el('div', { class: 'bs-flow' });
    steps.slice(0, S.step).forEach((s, i) => {
      flow.appendChild(el('div', { class: 'bs-stepcard' }, [
        el('div', { class: 'bs-stepno', text: String(i + 1) }),
        el('div', { class: 'bs-stepbody' }, [el('div', { class: 'bs-stept', text: s.t })].concat(s.body)),
      ]));
    });
    detailEl.appendChild(flow);
    const foot = el('div', { class: 'bs-detail-foot' });
    if (S.step < steps.length) {
      foot.appendChild(btn('继续 →', () => { S.step += 1; renderDetail(); }, 'primary sm'));
      foot.appendChild(btn('一次看完', () => { S.step = steps.length; renderDetail(); }, 'ghost sm'));
    } else {
      foot.appendChild(btn('重新讲一遍', () => { S.step = 1; renderDetail(); }, 'ghost sm'));
      foot.appendChild(btn('做这个知识点的题', () => { S.tab = 'types'; S.activeType = (qs[0] && qs[0].type) || ''; render(); }, 'primary sm'));
    }
    detailEl.appendChild(foot);
  }

  /* ---------------- 导入 / 分析 ---------------- */
  async function upload(files) {
    if (!files.length || S.importing) return;
    try { fileInput.value = ''; } catch (e) { /* 允许再次选同一个文件 */ }
    S.importing = true;
    render();
    try {
      const payload = [];
      for (const f of files) {
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || '').split(',')[1] || '');
          r.onerror = () => reject(new Error('读取失败：' + f.name));
          r.readAsDataURL(f);
        });
        payload.push({ name: f.name, data: b64 });
      }
      const r = await host.action('add', { bookId: S.id, files: payload });
      if (!r || r.ok === false) throw new Error((r && r.error) || '导入失败');
      toast('已导入 ' + payload.length + ' 份资料', 'ok');
      S.importing = false;
      await load();
      if (!S.analysis) toast('资料就位，点「开始分析」生成导图与题型', 'info');
      return;
    } catch (e) {
      toast(String(e.message || e), 'bad');
    }
    S.importing = false;
    render();
  }

  function openAnalyze() {
    const cfg = (() => { try { return JSON.parse(localStorage.getItem('wb-llm') || '{}'); } catch (e) { return {}; } })();
    const base = el('input', { class: 'bs-input', placeholder: 'https://api.example.com/v1', value: cfg.baseURL || '' });
    const model = el('input', { class: 'bs-input', placeholder: '模型名，如 deepseek-chat', value: cfg.model || '' });
    const key = el('input', { class: 'bs-input', type: 'password', placeholder: '密钥（只在本次请求内存在，不落盘）' });
    const status = el('div', { class: 'bs-hint' });
    const mask = el('div', { class: 'bs-mask' });
    const dlg = el('div', { class: 'bs-dialog' }, [
      el('h3', { text: S.analysis ? '重新分析这本书' : '分析这本书' }),
      el('p', { class: 'bs-sub', text: '模型会把整本书当作一个整体读一遍，生成思维导图、提纲与题型分类。资料多时会比较久。' }),
      el('label', { class: 'bs-field' }, [el('span', { text: 'API 地址' }), base]),
      el('label', { class: 'bs-field' }, [el('span', { text: '模型' }), model]),
      el('label', { class: 'bs-field' }, [el('span', { text: '密钥' }), key]),
      status,
      el('div', { class: 'bs-dialog-acts' }, [
        btn('取消', close, 'ghost'),
        btn('开始分析', run, 'primary'),
      ]),
    ]);
    mask.appendChild(dlg);
    document.body.appendChild(mask);
    function close() { mask.remove(); }
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    async function run() {
      const payloadCfg = { baseURL: base.value.trim(), model: model.value.trim(), apiKey: key.value };
      if (!payloadCfg.baseURL || !payloadCfg.model || !payloadCfg.apiKey) { status.textContent = '地址 / 模型 / 密钥都要填'; return; }
      try { localStorage.setItem('wb-llm', JSON.stringify({ baseURL: payloadCfg.baseURL, model: payloadCfg.model })); } catch (e) { /* 忽略 */ }
      const t0 = Date.now();
      let alive = true;
      const tick = setInterval(() => { if (alive) status.textContent = '分析中…已 ' + Math.round((Date.now() - t0) / 1000) + ' 秒（不要关页面）'; }, 1000);
      status.textContent = '分析中…';
      try {
        const r = await host.action('analyze', { bookId: S.id, cfg: payloadCfg });
        alive = false; clearInterval(tick);
        if (!r || r.ok === false) throw new Error((r && r.error) || '分析失败');
        close();
        toast('分析完成', 'ok');
        await load();
        S.tab = 'map';
        render();
      } catch (e) {
        alive = false; clearInterval(tick);
        status.textContent = '失败：' + String(e.message || e);
      }
    }
  }

  await load();
  return { destroy() { /* 无定时器需清理；保留接口 */ } };
}

export default { mountBookspace };
