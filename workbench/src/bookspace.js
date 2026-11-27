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
import { loadSettings, saveSettings, credentialFields, credentialDialog, readiness } from './llm-config.js';
import { deriveOverview } from './overview.mjs';
import { answerLetter, optionLetter, judge, splitDesc, hintFor } from './study-hint.mjs';
import { openReader } from './reader.mjs';

const TABS = [
  { id: 'map', label: '思维导图' },
  { id: 'outline', label: '提纲讲解' },
  { id: 'types', label: '题型' },
  // 作业独立入口（2026-11-27）：22 组作业卡原本只在「题型」页最底部、默认全收起，
  // 学生看不到。这里加页签并复用 renderCardGroups 的作业过滤，不写第二套渲染。
  { id: 'assignments', label: '作业' },
  { id: 'review-guide', label: '复习总纲' },
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
// 题目来源行学生口径（critic C18）：「02_2026-08-31_1静力学公理.pdf · [P.6]」→「出处：静力学公理 · 第 6 页」；
// 原始文件名进 title 悬浮，不丢溯源。
function prettySource(q) {
  const src = (q && q.source) || {};
  // 全局题 source 是 {file, anchor}；题卡 source 是 {pdf, page}——两口径都兼容。
  const f = String(src.file || src.pdf || '');
  const base = f.replace(/^\d+_\d{4}-\d{2}-\d{2}_/, '').replace(/\.pdf$/i, '').replace(/（\d+）$/, '');
  const page = String(src.anchor || src.page || '').match(/(\d+)/);
  if (!base) return '';
  return '出处：' + base + (page ? ' · 第 ' + page[1] + ' 页' : '');
}
// 说明文本拆两半：「它是什么」与「从哪几个文件来的」。
// 实测资料说明是「期末总复习提纲：只收 PPT 里的知识点…｜来源：a.md；b.md」这种整句，
// 直接进列表会变成四行长的糊块——列表只留前半句，来源压成一个「来源 2」角标。
// 配图判据（2026-11-23 需求7）：只认 analysis 明确给的 imageIds。
// 曾试过「题干与图注双字重合」猜图，实测把 SOLIDWORKS 界面截图配给静力学题，已全部移除。

function splitNote(note) {
  const s = String(note || '').trim();
  if (!s) return { desc: '', sources: [] };
  const i = s.search(/[｜|]\s*来源\s*[:：]/);
  if (i < 0) return { desc: s, sources: [] };
  return {
    desc: s.slice(0, i).trim(),
    sources: s.slice(i).replace(/^[｜|]\s*来源\s*[:：]\s*/, '').split(/[;；]/).map((x) => x.trim()).filter(Boolean),
  };
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

/* ---------------- 交叉索引（2026-11-19） ----------------
   判据：思维导图 / 提纲 / 题型 / 考点大全 / 考纲 是同一份分析的五个切面，不是五套数据。
   任何一处都要能说清「它和别处是什么关系」，否则点进去就迷路（用户要的「互相索引」）。
   这里不新造数据、不猜内容：只把已有字段（pointId / pointPath / title）编成可反查的表。 */
function buildPointIndex(analysis) {
  const map = new Map();                    // pointId → { node, path, depth, qs }
  const rows = walkTree(analysis && analysis.tree, 0, [], []);
  rows.forEach((r) => {
    if (r.node && r.node.id) map.set(String(r.node.id), { node: r.node, path: r.path, depth: r.depth, qs: [] });
  });
  (analysis && analysis.questionIndex || []).forEach((g) => {
    (g.items || []).forEach((it) => {
      (it.questions || []).forEach((q) => {
        if (q.pointId != null && map.has(String(q.pointId))) {
          map.get(String(q.pointId)).qs.push(Object.assign({ type: g.type }, q));
        }
      });
    });
  });
  return map;
}
// 节点子树题数（章 / 节要连同下面的知识点一起算），导图角标与提纲角标共用这一个口径。
function subtreeQuestionCount(analysis, node) {
  if (!analysis || !node) return 0;
  const ids = new Set();
  (function walk(n) {
    if (!n) return;
    if (n.id) ids.add(String(n.id));
    (n.children || []).forEach(walk);
  })(node);
  return allQuestions(analysis).filter((q) => q.pointId && ids.has(String(q.pointId))).length;
}
// 「这句话在这本书的哪个节点」——考点大全 / 考纲的条目只带章节名，靠标题把条目挂回导图。
// 先精确匹配，再退到包含匹配；匹配不到就诚实返回 null（不硬塞一个错的节点）。
function findNodeByTitle(tree, title) {
  const want = String(title || '').replace(/\s+/g, '').trim();
  if (!want) return null;
  let loose = null;
  for (const r of walkTree(tree, 0, [], [])) {
    const t = String((r.node && r.node.title) || '').replace(/\s+/g, '').trim();
    if (!t) continue;
    if (t === want) return r;
    if (!loose && (t.includes(want) || want.includes(t)) && Math.min(t.length, want.length) >= 4) loose = r;
  }
  return loose;
}

export async function mountBookspace(root, bookId, params) {
  const S = {
    id: String(bookId || ''),
    tab: TABS.some((t) => t.id === (params && params.tab)) ? params.tab : 'map',
    analysis: null,
    quiz: null,
    practice: null,
    cards: null,        // 逐讲/作业题卡（Core.listCards 的 content 含题本体），题型页的讲解卡区块
    openCards: {},      // 题卡第一级分组（讲次/作业组）展开态（key=文件名，默认全收起）
    closedCardSubs: {}, // 题卡第二级题型分组手动收起态（key=文件名::题型，默认全展开）
    book: null,
    activeType: '',
    picked: null,       // { node, path }
    loading: true,
    err: '',
    analyzing: false,
    importing: false,
    railOpen: true,
    step: 1,            // 讲解面板已展开到第几步
    'review-guide': null,  // 复习总纲文档状态 {busy,err,data,tried}（2026-11-24 三形态页签收敛）
    editingFile: '',    // 正在编辑说明的资料 id
    fileQuery: '',      // 资料检索关键词（30 份的书靠滚动找文件太折磨）
    olQuery: '',        // 提纲检索关键词（229 条提纲靠滚动找是折磨）
    focusId: '',        // 从考点大全 / 题型跳回导图时要高亮的节点 id
    images: null,       // get 附带的原图清单（images.json），看图区的数据源
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
        // P1-2 老数据兼容：旧分析有逐字校验结果 quoteVerified 但没有 origin。
        // 用已有校验结果在会话内派生一次，不写回磁盘、不重跑模型——老书也能显示来源，
        // 且判据与新分析一致（真逐字命中才算 material），不会把模型自编题冒充真题。
        ((S.analysis && S.analysis.questionIndex) || []).forEach((grp) => {
          ((grp && grp.items) || []).forEach((it) => {
            ((it && it.questions) || []).forEach((q) => {
              if (q && !q.origin && typeof q.quoteVerified === 'boolean') {
                q.origin = q.quoteVerified ? 'material' : 'model';
              }
            });
          });
        });
        S.book = (g.data && g.data.book) || null;
        // v4：原图清单随 get 一起回来（不新增 action，三端能力清单保持一致）
        S.images = (g.data && g.data.images) || null;
      } else {
        S.analysis = null;
        // 「尚无分析结果」是正常业务状态，不是错误——get 用 ok:false+error 表达它，
        // 若照单全收进 S.err，空状态会冒出「看错误详情」与「先导入资料」两条矛盾引导。
        // 只让真异常（网络/服务端故障）进 S.err；未分析交给 needAnalysis 的诚实空态处理。
        const msg = String((g && g.error) || '');
        S.err = msg.includes('尚无分析结果') ? '' : msg;
        // 未分析的书也会从 get 的失败响应里带回原图清单（导入时已抽取，与分析无关）
        if (g && g.data && g.data.images) S.images = g.data.images;
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
      // 题卡（2026-11-23）：逐讲卡 lesson-NN + 作业卡 assignment-NNN 同口聚合，content 里带题本体。
      const c = await host.action('cards', { bookId: S.id });
      S.cards = (c && c.ok) ? c.data : null;
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

  /* ---- 原图：题目下方独立看图区（2026-11-20） ----
     判据：图原样来自资料，不画不生成；正文周边绝不横插大图——只在题目卡片下方开一个
     固定高度的看图条，点一下再放大。老分析没有 imageIds 时用「如图」+ 双字重合度兜底。 */
  // 配对 / 题旁看图只用主图：同字节的几份图内容一样，但出处该指向正文原图而非答题截图，
  // 否则用户核对时会以为配错了。判据与后端 images.primaryImages 一致。
  function allImages() {
    const list = (S.images && S.images.images) || [];
    const byHash = new Map();
    list.forEach((img) => {
      const s = (img.sources || [])[0] || {};
      const rank = (s.caption ? 4 : 0)
        + ((s.pageType === 'slide' || s.pageType === 'paragraph') ? 2 : 0)
        + ((img.vision && img.vision.ok && img.vision.status === 'ok') ? 1 : 0);
      const prior = byHash.get(img.sha256);
      if (!prior || rank > prior.rank) byHash.set(img.sha256, { img, rank });
    });
    return Array.from(byHash.values()).map((x) => x.img);
  }
  function allImagesRaw() { return (S.images && S.images.images) || []; }
  function imagesForQuestion(q, limit) {
    const max = Number(limit) || 2;
    if (!q || !allImages().length) return [];
    const ids = (Array.isArray(q.imageIds) ? q.imageIds : []).map(String);
    const byId = ids.map((id) => allImages().find((x) => String(x.id) === id)).filter(Boolean);
    // 2026-11-23 需求7「配图要准」：只认 analysis 明确给的 imageIds，不再用双字重合猜图。
    // 旧兜底（score>=2 取图注最像的）实测把 SOLIDWORKS 界面截图配给静力学题——
    // 图注里「受力分析」双字一撞就中，猜出来的图看着有依据其实是错的。宁可留空，不可配错。
    return byId.slice(0, max);
  }
  // 图题并置（2026-11-20 用户纠正）：图是拿来「看懂题、做得出题」的，必须紧挨题目/知识点同屏。
  // 单开页签＝图和题分家，没人会去看，等于没有；64px 缩略条又太小看不清。
  // 所以这里直接嵌原图：字节原样不动，只用 CSS 限制显示高度（~300px）避免大图横插乱排版；
  // 点一下开 lightbox 看全尺寸原图（细节多的答题截图靠这一步看清）。
  function zoomImage(url, cap) {
    if (!url) return;
    const mask = el('div', { class: 'bs-lightbox' }, [
      el('img', { src: url, alt: cap || '原图' }),
      el('div', { class: 'bs-lightbox-cap', text: (cap || '课件原图') + ' · 点任意处关闭' }),
    ]);
    mask.addEventListener('click', () => mask.remove());
    document.body.appendChild(mask);
  }
  function figureStrip(imgs, label) {
    if (!imgs.length) return null;
    return el('div', { class: 'bs-inline-figs' }, [
      label ? el('div', { class: 'bs-inline-figs-t', text: label }) : null,
    ].concat(imgs.map((img) => {
      const url = host.imageUrl(S.id, img.id);
      const s = (img.sources || [])[0] || {};
      const v = img.vision && img.vision.ok && img.vision.status === 'ok' ? img.vision : null;
      // 图注只作补充；主说明用视觉模型「真看到的」，这样图注错/无图注也不会误导配对。
      const cap = (v && v.what) || s.caption || s.context || '资料原图';
      const where = s.pageType === 'slide' ? 'PPT 第 ' + s.page + ' 页' :
        s.pageType === 'paragraph' ? 'Word 第 ' + s.page + ' 段' : s.fileName || '';
      if (!url) return el('div', { class: 'bs-q-fig-none', text: '原图（桌面端请在浏览器查看）' });
      const card = el('div', { class: 'bs-inline-fig-wrap' }, [
        el('button', {
          class: 'bs-inline-fig',
          title: '点开看原图全尺寸' + (cap ? '：' + cap : ''),
          onclick: () => zoomImage(url, cap),
        }, [
          el('img', { src: url, alt: cap, loading: 'lazy' }),
          el('span', { class: 'bs-inline-fig-cap', text: cap }),
          el('span', { class: 'bs-inline-fig-src', text: v ? '出处 · ' + (where || '课件原图') : '出处 · ' + (where || '课件原图') }),
        ]),
      ]);
      // 「看懂了什么」可折叠：默认收起不占地方，想核对模型有没有看错图时展开。
      if (v && (v.details || v.forQuestions)) {
        const detail = el('div', { class: 'bs-fig-vision hidden' }, [
          v.details ? el('div', { class: 'bs-fig-vision-line', text: '图里看见：' + v.details }) : null,
          v.forQuestions ? el('div', { class: 'bs-fig-vision-line', text: '什么题要用：' + v.forQuestions }) : null,
        ]);
        card.appendChild(el('button', {
          class: 'bs-fig-vision-toggle',
          text: '看懂了什么 ▾',
          onclick: (e) => {
            const hidden = detail.classList.toggle('hidden');
            e.currentTarget.textContent = hidden ? '看懂了什么 ▾' : '收起 ▴';
          },
        }));
        card.appendChild(detail);
      }
      return card;
    })));
  }
  // 知识点 → 相关图（2026-11-23 需求7）：只认 analysis 明确挂的 imageIds。
  // 旧的「标题/说明与图注双字重合」猜图实测把 SOLIDWORKS 界面配给静力学知识点——
  // 「受力」「分析」这类双字在图注里一撞就中，看着有依据其实是错的。宁可不配。
  function imagesForNode(node, limit) {
    const max = Number(limit) || 1;
    if (!node || !allImages().length) return [];
    const ids = (Array.isArray(node.imageIds) ? node.imageIds : []).map(String);
    return ids.map((id) => allImages().find((x) => String(x.id) === id)).filter(Boolean).slice(0, max);
  }

  // 索引懒建：重绘很频繁，229 个知识点 × 23 道题不必每次重算，按 analysis 引用做一次缓存。
  function pointIndex() {
    if (!S._pidx || S._pidxFor !== S.analysis) {
      S._pidx = buildPointIndex(S.analysis);
      S._pidxFor = S.analysis;
    }
    return S._pidx;
  }
  // 从任何一页跳回导图的某个节点（考点大全条目 / 题型里的题 / 提纲都走这一条路，
  // 保证「互相索引」只有一个跳转口径，不会各页各写一套定位逻辑）。
  function jumpToMap(node) {
    if (!node || !S.analysis) return;
    S.tab = 'map';
    S.picked = { node, path: pathOfNode(S.analysis.tree, node.id) };
    S.focusId = String(node.id);
    S.step = 1;
    render();
    renderDetail();
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
    // 导入区：未分析的书给完整拖放框（第一个动作就是加资料）；已分析的收成一行小按钮，
    // 把左栏还给资料列表与学习动作（critic C6）。
    if (S.analysis) {
      const dropMini = el('button', { class: 'btn ghost sm', text: '＋ 加资料', onclick: () => fileInput.click() });
      dropMini.style.width = '100%';
      railEl.appendChild(dropMini);
    } else {
      railEl.appendChild(drop);
    }

    // 资料结构：可折叠抽屉；资料多的书默认收起（24 行文件列表压内容区，critic C6）
    const filesBox = el('div', { class: 'bs-sec' + (files.length > 6 ? ' fold' : '') });
    const filesHead = el('button', { class: 'bs-sec-head', onclick: () => filesBox.classList.toggle('fold') }, [
      el('span', { class: 'caret', text: '▾' }),
      el('span', { text: '资料' }),
      el('span', { class: 'count', text: String(files.length) }),
    ]);
    filesBox.appendChild(filesHead);
    // 语义重点（2026-11-14）：★ 一键标重点、✎ 一句话说明为什么重要——
    // 用户不手动分层，分析时模型按这份说明决定侧重。
    // 排版返工（2026-11-19）：一条资料固定两行（文件名行 + 说明行），文件名永远优先占宽、
    // 说明单行省略。长句不再把列表撑成参差的糊块。
    const fileList = el('div', { class: 'bs-list' });
    if (!files.length) {
      fileList.appendChild(el('div', { class: 'bs-hint', text: '还没有资料，拖一份进来试试' }));
    } else {
      const rowsBox = el('div', { class: 'bs-files' });
      if (files.length > 5) {
        const find = el('input', { class: 'bs-find', placeholder: '找资料：文件名或说明', value: S.fileQuery || '' });
        find.addEventListener('input', () => {
          S.fileQuery = find.value;
          paintFiles();
          // 重绘后焦点会丢（实测每敲一个字就跳出输入框），这里手动还回去并保持光标在末尾
          const again = fileList.querySelector('.bs-find');
          if (again) {
            again.focus();
            try { again.setSelectionRange(again.value.length, again.value.length); } catch (e) { /* 忽略 */ }
          }
        });
        fileList.appendChild(find);
      }
      fileList.appendChild(rowsBox);
      paintFiles();

      function paintFiles() {
        rowsBox.innerHTML = '';
        const q = String(S.fileQuery || '').trim().toLowerCase();
        const shown = q
          ? files.filter((f) => (String(f.name || '') + ' ' + String(f.note || '')).toLowerCase().includes(q))
          : files;
        if (!shown.length) {
          rowsBox.appendChild(el('div', { class: 'bs-find-empty', text: '没有匹配「' + q + '」的资料' }));
          return;
        }
        shown.forEach((f) => rowsBox.appendChild(paintFileRow(f)));
      }

      function paintFileRow(f) {
        if (S.editingFile === f.id) {
          const inp = el('input', { class: 'bs-note-input', value: f.note || '', placeholder: '一句话说明它为什么重要（分析会优先参考）' });
          const box = el('div', { class: 'bs-file editing', title: f.name }, [
            el('div', { class: 'bs-file-row' }, [
              el('span', { class: 'bs-ext', text: fileIcon(f.ext) }),
              el('span', { class: 'bs-file-name', text: f.name }),
            ]),
            inp,
            el('div', { class: 'bs-note-acts' }, [
              btn('保存', async () => {
                const r = await host.action('mark', { bookId: S.id, fileId: f.id, note: inp.value });
                if (!r || r.ok === false) return toast((r && r.error) || '保存失败', 'bad');
                f.note = inp.value; S.editingFile = '';
                toast('已保存说明，分析与整理会优先参考', 'ok');
                render();
              }, 'primary sm'),
              btn('取消', () => { S.editingFile = ''; render(); }, 'ghost sm'),
            ]),
          ]);
          setTimeout(() => { try { inp.focus(); } catch (e) { /* 忽略 */ } }, 0);
          return box;
        }
        const cut = splitNote(f.note);
        const tip = [f.name, cut.desc, cut.sources.length ? '来源：' + cut.sources.join('；') : '']
          .filter(Boolean).join('\n');
        // 就地阅读器（2026-11-23 需求6）：点资料行直接预览原字节，按钮点击不冒泡触发。
        const row = el('div', { class: 'bs-file' + (f.focus ? ' focus' : ''), title: tip + '\n（点击就地预览）',
          onclick: (e) => {
            if (e.target.closest('button')) return;   // 星标/编辑说明按钮各走各的
            openReader(S.id, f, () => { toast('已改名', 'ok'); render(); });
          } }, [
          el('div', { class: 'bs-file-row' }, [
            el('span', { class: 'bs-ext', text: fileIcon(f.ext) }),
            el('span', { class: 'bs-file-name', text: f.name }),
            el('span', { class: 'bs-file-size', text: humanSize(f.size) }),
            el('button', { class: 'bs-star' + (f.focus ? ' on' : ''), text: f.focus ? '★' : '☆',
              title: f.focus ? '取消重点' : '标为考试重点',
              onclick: async () => {
                const r = await host.action('mark', { bookId: S.id, fileId: f.id, focus: !f.focus });
                if (!r || r.ok === false) return toast((r && r.error) || '标记失败', 'bad');
                f.focus = !f.focus;
                toast(f.focus ? '已标为重点：分析与整理会优先围绕它' : '已取消重点', 'ok');
                render();
              } }),
            el('button', { class: 'bs-editnote', text: '✎', title: '说明它为什么重要',
              onclick: () => { S.editingFile = f.id; render(); } }),
          ]),
          (cut.desc || cut.sources.length) ? el('div', { class: 'bs-file-row' }, [
            el('span', { class: 'bs-file-desc' + (cut.desc ? '' : ' none'), text: cut.desc || '未写说明',
              title: cut.desc || '' }),
            cut.sources.length ? el('span', { class: 'bs-file-src', text: '来源 ' + cut.sources.length,
              title: cut.sources.join('\n') }) : null,
          ]) : null,
        ]);
        return row;
      }
    }
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
    if (S.analysis) acts.appendChild(btn('去练习', () => go('quiz', { id: S.id, title: (S.book && S.book.title) || '' }), 'ghost sm'));
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
    if (S.tab === 'assignments') return renderAssignments(body);
    if (S.tab === 'review-guide') return renderGuide(body);
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
    const mm = mountMindmap(wrap, S.analysis.tree, {
      // 展开态按书持久化（2026-11-21）：切页签/刷新后回到上次的章与展开层。
      // 默认层可由分析结果里的 mapView.defaultDepth 指定（数据层可配），没给就按规模自动。
      storageKey: 'book:' + S.id,
      defaultDepth: (S.analysis && S.analysis.mapView && S.analysis.mapView.defaultDepth) || 0,
      // 节点角标 = 这个知识点挂了几道题（交叉索引最轻的一层：只给信号，不塞正文）
      badgeOf: (node) => {
        const e = pointIndex().get(String(node && node.id));
        return e ? e.qs.length : 0;
      },
      onPick: (node) => {
        S.picked = { node: findNodeById(S.analysis.tree, node.id) || node, path: pathOfNode(S.analysis.tree, node.id) };
        S.step = 1;
        renderDetail();
      },
    });
    if (S.focusId) {
      const fid = S.focusId;
      S.focusId = '';
      setTimeout(() => { try { mm.focus(fid); } catch (e) { /* 忽略 */ } }, 60);
    }
    body.appendChild(el('p', { class: 'bs-hint', text: '点任一节点 → 右侧逐步讲解；节点右下角数字＝这个知识点挂了几道题。' }));
  }

  function renderOutline(body) {
    if (needAnalysis(body)) return;
    const allRows = walkTree(S.analysis.tree, 0, [], []);
    const q = String(S.olQuery || '').trim().toLowerCase();
    // 二百多条提纲，不给人一个搜索框就只能靠滚轮硬找（用户要的「知识点齐全」体感就在这）。
    // 命中行连同它的祖先一起留下，否则层级会断成一堆没有上下文的孤行。
    let rows = allRows;
    if (q) {
      const keep = new Set();
      (function rec(n) {
        const self = ((String(n.title || '') + ' ' + String(n.desc || '')).toLowerCase().includes(q));
        let any = self;
        (n.children || []).forEach((c) => { if (rec(c)) any = true; });
        if (any) keep.add(String(n.id));
        return any;
      })(S.analysis.tree);
      rows = allRows.filter((r) => keep.has(String(r.node.id)));
    }
    const bar = el('div', { class: 'bs-ol-bar' }, [
      el('input', {
        class: 'bs-find', placeholder: '在 ' + allRows.length + ' 条提纲里找：术语 / 关键词',
        value: S.olQuery || '',
        oninput: (e) => {
          S.olQuery = e.target.value;
          const keepFocus = e.target.selectionStart;
          render();
          const again = mainEl.querySelector('.bs-ol-bar .bs-find');
          if (again) { again.focus(); try { again.setSelectionRange(keepFocus, keepFocus); } catch (err) { /* 忽略 */ } }
        },
      }),
      q ? el('span', { class: 'bs-hint', text: '命中 ' + rows.filter((r) => ((String(r.node.title || '') + ' ' + String(r.node.desc || '')).toLowerCase().includes(q))).length + ' 条（含所在章节）' }) : null,
    ]);
    body.appendChild(bar);
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
    if (!groups.length) {
      body.appendChild(empty('分析结果里没有题型', '重新分析一次，或在提纲里看看知识点'));
      // 全局题不存在不挡题卡：题卡数据来自 cards action，与分析结果无关。
      renderCardGroups(body);
      return;
    }
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
    // 题卡区块（2026-11-23）：接在全局题型之后——逐讲卡 + 作业卡按节分组，讲解卡不判分。
    renderCardGroups(body);
  }

  // 作业页（2026-11-27）：数据本来就在题型页最底部，但 27 个折叠组里埋着 5 份作业，
  // 学生点不进去就等于没有。这里给独立页签、默认展开，渲染仍走 renderCardGroups。
  // 不调 needAnalysis()：题卡来自 cards action，与这本书有没有分析无关。
  function renderAssignments(body) {
    const lessons = (S.cards && Array.isArray(S.cards.lessons)) ? S.cards.lessons : [];
    const has = lessons.some((L) => L && !L.error && L.kind === 'assignment' && Array.isArray(L.content));
    if (!has) return body.appendChild(empty('这本书还没有作业卡',
      '导入作业 PDF 并完成题卡批建后，这里会按每份作业列出原题。'));
    renderCardGroups(body, { onlyAssignment: true });
  }

  // 题卡区块（2026-11-24 两级分组 + 图优先改版）：Core.listCards 的 lessons[].content（knowledgePoints
  // 原数组，cards 挂在 kp.cards 上）。判据：146 张题卡全部无 options → 只能作讲解卡（看思路/看答案），
  // 不进判分练习；可判分练习仍走上面的全局题库 questionIndex。
  // 用户方向修正（2026-11-24）：要的是「题目页原图」而不是再造一道题——
  //   第一级 = 讲次/作业组（讲次在前作业在后，沿用 core 排序再显式排一次做硬保证）；
  //   第二级 = 组内按题型折叠（选择题/填空题/计算题/综合应用题/判断题打头，清单外题型按出现顺序
  //   附后不丢，空题型不显示）。两级组头都可折叠：第一级默认收起，第二级默认展开。
  const CARD_SUB_ORDER = ['选择题', '填空题', '计算题', '综合应用题', '判断题'];
  // 作业页（2026-11-27）复用本函数：onlyAssignment 时只要 kind=assignment 的组，默认全展开。
  // 不写第二套渲染——两处展示同一份 S.cards，避免以后改一处漏一处。
  function renderCardGroups(body, opts) {
    const onlyAssignment = !!(opts && opts.onlyAssignment);
    const data = S.cards;
    const lessons = (data && Array.isArray(data.lessons)) ? data.lessons : [];
    const usable = lessons.filter((L) => L && !L.error && Array.isArray(L.content)
      && (!onlyAssignment || L.kind === 'assignment'));
    if (!usable.length) {
      if (onlyAssignment) body.appendChild(empty('这本书还没有作业卡', '导入作业 PDF 并完成题卡批建后，这里会按每份作业列出原题。'));
      return;
    }
    const kindLabel = (k) => (k === 'assignment' ? '作业' : '讲次');
    const groups = usable.map((L) => {
      const rows = [];
      (L.content || []).forEach((kp) => ((kp && kp.cards) || []).forEach((c) => {
        if (c && c.stem) rows.push({ q: c, kp: (kp && kp.name) || '' });
      }));
      return { key: String(L.file || (L.kind + '-' + L.lesson)), title: String(L.title || ''),
        kind: L.kind, lesson: Number(L.lesson) || 0, rows };
    }).filter((g) => g.rows.length);
    if (!groups.length) return;
    // 讲次在前作业在后：core 已按此排序，这里显式再排一次，不依赖上游顺序。
    groups.sort((a, b) => ((a.kind === 'assignment') - (b.kind === 'assignment')) || (a.lesson - b.lesson));

    let totalCards = 0;
    let totalImgs = 0;
    groups.forEach((g) => {
      const byType = new Map();
      g.imgCount = 0;
      g.rows.forEach((row) => {
        const t = String(row.q.type || '').trim() || '未分类';
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t).push(row);
        g.imgCount += (Array.isArray(row.q.imageIds) ? row.q.imageIds.length : 0);
      });
      totalCards += g.rows.length;
      totalImgs += g.imgCount;
      const rest = [...byType.keys()].filter((t) => !CARD_SUB_ORDER.includes(t));
      g.subs = CARD_SUB_ORDER.filter((t) => byType.has(t)).concat(rest)
        .map((t) => ({ type: t, rows: byType.get(t) }));
    });

    const wrap = el('div', { class: 'bs-cards' });
    wrap.appendChild(el('div', { class: 'bs-hint bs-cards-note', text:
      (onlyAssignment ? '作业 · ' : '题卡（逐讲批建）· ') + groups.length + (onlyAssignment ? ' 份 ' : ' 节 ') + totalCards
        + ' 题 · 题图 ' + totalImgs + ' 张 · 图优先：先看题页原图，题干作定位 · 看思路 / 看答案，不判分'
        + (onlyAssignment ? '。要判分和排程，需先把题卡结构化（补齐选项与答案）。' : '') }));
    groups.forEach((g) => {
      // 作业页默认展开：学生点开「作业」就要直接看到题，不再一层层点。
      const open = onlyAssignment ? true : !!S.openCards[g.key];
      const cardEl = el('div', { class: 'bs-tcard' + (open ? ' on' : '') });
      cardEl.appendChild(el('button', {
        class: 'bs-tcard-head',
        onclick: () => { if (S.openCards[g.key]) delete S.openCards[g.key]; else S.openCards[g.key] = 1; render(); },
      }, [
        el('span', { class: 'bs-tname', text: g.title || g.key }),
        badge(g.rows.length + ' 题', 'accent'),
        // 组头题图数量提示（2026-11-24）：讲次/作业组头都附「图 N 张」，点开才加载，不做页图墙。
        badge('图 ' + g.imgCount + ' 张', 'plain'),
        badge(kindLabel(g.kind), 'plain'),
        el('span', { class: 'caret', text: open ? '▾' : '▸' }),
      ]));
      if (open) {
        const box = el('div', { class: 'bs-qlist' });
        g.subs.forEach((sub) => {
          const subKey = g.key + '::' + sub.type;
          const subOpen = !S.closedCardSubs[subKey]; // 二级题型组默认展开，手动收起后记住
          const subEl = el('div', { class: 'bs-tcard-sub' + (subOpen ? ' on' : '') });
          subEl.appendChild(el('button', {
            class: 'bs-tcard-subhead',
            onclick: () => { if (S.closedCardSubs[subKey]) delete S.closedCardSubs[subKey]; else S.closedCardSubs[subKey] = 1; render(); },
          }, [
            el('span', { class: 'bs-tname', text: sub.type }),
            badge(sub.rows.length + ' 题', 'plain'),
            el('span', { class: 'caret', text: subOpen ? '▾' : '▸' }),
          ]));
          if (subOpen) {
            const list = el('div', { class: 'bs-qlist-sub' });
            sub.rows.forEach((row, i) => list.appendChild(cardForCard(row.q, row.kp, i)));
            subEl.appendChild(list);
          }
          box.appendChild(subEl);
        });
        cardEl.appendChild(box);
      }
      wrap.appendChild(cardEl);
    });
    body.appendChild(wrap);
  }

  // 题卡讲解卡（2026-11-24，从 questionCard 派生的图优先精简版）：
  //   题卡的主体是题目页原图（本节 146/146 张卡都带 imageIds），整页原图宽 720px 直显、
  //   点开 lightbox 看全尺寸；题干文字保留作这张图的定位说明，排在图之后。
  //   判分选项不存在（全部无 options），只留 看思路 / 显示答案 两层与 needsReview「需复核」badge。
  function cardForCard(c, kpName, i) {
    const src = (c && c.source) || {};
    const pdfBase = String(src.pdf || src.file || '').replace(/^\d+_\d{4}-\d{2}-\d{2}_/, '').replace(/\.pdf$/i, '');
    const capBits = [];
    if (pdfBase) capBits.push(pdfBase);
    if (src.page) capBits.push('第 ' + src.page + ' 页');
    const cap = capBits.join(' · ') || (kpName ? kpName + ' · 题目页原图' : '题目页原图');

    // 图优先：imageIds 非空时整页原图直显。卡图 id 不依赖 images 清单映射，直接走 /api/app/image。
    const figs = (Array.isArray(c.imageIds) ? c.imageIds : []).map((id) => {
      const url = host.imageUrl(S.id, id);
      if (!url) return null;
      return el('button', {
        class: 'bs-card-fig',
        title: '点开看原图全尺寸' + (cap ? '：' + cap : ''),
        onclick: () => zoomImage(url, cap),
      }, [el('img', { src: url, alt: cap || '题目页原图', loading: 'lazy' })]);
    }).filter(Boolean);

    // 思路点拨：题卡没有 pointId/pointPath，按知识点标题在导图里找一次；找不到就只剩题型通用法。
    const pointNode = cardPointNode(kpName);
    const hints = hintFor(c, { type: c.type, point: pointNode, siblings: [] });
    const hintBox = el('div', { class: 'bs-hintbox hidden' },
      hints.map((h) => el('div', { class: 'bs-hintrow' }, [
        el('div', { class: 'bs-hintrow-t', text: h.t }),
        el('div', { class: 'bs-hintrow-b', text: h.body }),
      ])));

    // 答案分层：题卡只有 answer + solution（无 rationale/pitfalls），缺的层不渲染，不凑数。
    const answer = el('div', { class: 'bs-ans hidden' }, [
      el('div', { class: 'bs-ans-line', text: '答案：' + (c.answer || '—') }),
      (Array.isArray(c.solution) && c.solution.length) ? el('div', { class: 'bs-ans-sec' }, [
        el('div', { class: 'bs-ans-sec-t', text: '分步解答' }),
        el('div', { class: 'bs-sol' }, c.solution.map((s, k) =>
          el('div', { class: 'bs-step' }, [el('span', { class: 'bs-stepno', text: String(k + 1) }), el('span', { text: String(s).replace(/^第\s*\d+\s*步[：:]\s*/, '') })]))),
      ]) : null,
    ]);

    return el('div', { class: 'bs-q bs-card-q' }, [
      el('div', { class: 'bs-q-head' }, [
        badge(String(c.type || '题'), 'plain'),
        // P1-2：🟢资料原题 / ⚠️模型整理。老数据没有 origin 字段时不显示，不谎称来源。
        c.origin === 'material' ? badge('🟢 资料原题', 'good')
          : c.origin === 'model' ? badge('⚠️ 模型整理', 'warn') : null,
        // 诚实标注：数据层置了 needsReview 的题，学生界面必须看得见。
        c.needsReview === true ? badge('⚠️ 需复核', 'warn') : null,
        kpName ? el('span', { class: 'bs-sub', text: String(kpName) }) : null,
      ]),
      figs.length ? el('div', { class: 'bs-card-figs' }, figs) : null,
      el('div', { class: 'bs-q-stem', text: c.stem || '' }),
      el('div', { class: 'bs-q-acts' }, [
        el('button', { class: 'btn ghost sm', text: '看思路（不给答案）', onclick: (e) => {
          const hidden = hintBox.classList.toggle('hidden');
          e.currentTarget.textContent = hidden ? '看思路（不给答案）' : '收起思路';
        } }),
        el('button', { class: 'btn ghost sm', text: '显示答案', onclick: (e) => {
          const b = e.currentTarget;
          const hidden = answer.classList.toggle('hidden');
          b.textContent = hidden ? '显示答案' : '收起答案';
        } }),
        (src.pdf || src.file) ? el('span', { class: 'bs-src', title: String(src.pdf || src.file) + (src.page ? ' · P.' + src.page : ''), text: prettySource(c) }) : null,
      ]),
      hintBox,
      answer,
    ]);
  }

  // 题卡的知识点 → 导图节点：题卡没有 pointId/pointPath，只有 kp 名（content 里 kp.name），
  // 按标题精确匹配一次；找不到返回 null（hintFor 会退到题型通用法，不硬凑）。
  function cardPointNode(kpName) {
    const t = String(kpName || '').trim();
    if (!t || !S.analysis || !S.analysis.tree) return null;
    let hit = null;
    walkTree(S.analysis.tree, 0, [], []).forEach((row) => {
      if (hit) return;
      const n = row.node || row[0] || row;
      if (n && String(n.title || '') === String(t)) hit = n;
    });
    return hit;
  }

  // 教学化答题卡（2026-11-23 · 需求 3/4/5）：
  //   ④ 选项可点 + 提交判分；③ 答案按「答案→分步→为什么这么想→易错」分层展示；
  //   ⑤ 独立的「思路点拨」——只给方法论/定义/相近概念，绝不吐答案（study-hint.mjs 锁死）。
  // 全部是已有数据的重新排布，零 LLM 调用、零新 action。
  function questionCard(q, it, i) {
    const opts = Array.isArray(q.options) ? q.options : [];
    const canPick = opts.length > 0;
    let picked = '';

    // ---- 思路点拨（不给答案）----
    // 找当前知识点节点：优先 q.pointId，回退按 pointPath 末段标题匹配。
    const pointNode = (function () {
      if (!S.analysis || !S.analysis.tree) return null;
      if (q.pointId) { const n = findNodeById(S.analysis.tree, q.pointId); if (n) return n; }
      const last = Array.isArray(q.pointPath) ? q.pointPath[q.pointPath.length - 1] : '';
      if (!last) return null;
      let hit = null;
      walkTree(S.analysis.tree, 0, [], []).forEach((row) => {
        if (hit) return;
        // walkTree 产出 {node,path,...} 结构，兼容 node 直挂
        const n = row.node || row[0] || row;
        if (n && String(n.title || '') === String(last)) hit = n;
      });
      return hit;
    })();
    const siblings = (function () {
      if (!pointNode || !S.analysis || !S.analysis.tree) return [];
      // 找同父节点标题：从上文 path 定位父，再取其 children
      const path = pathOfNode(S.analysis.tree, pointNode.id) || [];
      let parent = S.analysis.tree;
      for (let d = 1; d < path.length; d++) {
        parent = (parent.children || []).find((c) => String(c.title) === String(path[d])) || parent;
      }
      return (parent.children || []).map((c) => String(c.title || '')).filter((t) => t && t !== String(pointNode.title || ''));
    })();
    const hints = hintFor(q, { type: (it && it.title) || q.type, point: pointNode, siblings });
    const hintBox = el('div', { class: 'bs-hintbox hidden' },
      hints.map((h) => el('div', { class: 'bs-hintrow' }, [
        el('div', { class: 'bs-hintrow-t', text: h.t }),
        el('div', { class: 'bs-hintrow-b', text: h.body }),
      ])));

    // ---- 答案区（教学化分层）----
    const answer = el('div', { class: 'bs-ans hidden' }, [
      el('div', { class: 'bs-ans-line', text: '答案：' + (q.answer || '—') }),
      (q.solution || []).length ? el('div', { class: 'bs-ans-sec' }, [
        el('div', { class: 'bs-ans-sec-t', text: '分步解答' }),
        el('div', { class: 'bs-sol' }, (q.solution || []).map((s, k) =>
          el('div', { class: 'bs-step' }, [el('span', { class: 'bs-stepno', text: String(k + 1) }), el('span', { text: String(s).replace(/^第\s*\d+\s*步[：:]\s*/, '') })]))),
      ]) : null,
      q.rationale ? el('div', { class: 'bs-ans-sec' }, [
        el('div', { class: 'bs-ans-sec-t', text: '为什么这么想' }),
        el('div', { class: 'bs-note', text: String(q.rationale).replace(/^解题思路[：:]\s*/, '') }),
      ]) : null,
      q.pitfalls ? el('div', { class: 'bs-ans-sec' }, [
        el('div', { class: 'bs-ans-sec-t', text: '最容易错' }),
        el('div', { class: 'bs-note', text: String(q.pitfalls).replace(/^易错点[：:]\s*/, '') }),
      ]) : null,
    ]);

    // ---- 选项（可点 + 判分）----
    const verdict = el('div', { class: 'bs-verdict hidden' });
    const optEls = opts.map((o) => {
      const letter = optionLetter(o);
      const node = el('button', {
        class: 'bs-q-opt',
        text: o,
        onclick: () => {
          if (!canPick) return;
          picked = letter || o;
          optEls.forEach((x) => x.classList.remove('picked'));
          node.classList.add('picked');
          verdict.classList.add('hidden');
        },
      });
      return node;
    });

    return el('div', { class: 'bs-q' }, [
      el('div', { class: 'bs-q-head' }, [
        // 全局题号（2026-11-21）：不再按分类内下标重数，否则同屏会出现两个「第 1 题」。
        // 老数据没有 seqNo，用 id（q0 起）反推同一口径，和练习页完全一致。
        badge('第 ' + (Number(q.seqNo) > 0 ? Number(q.seqNo) : (Number(String(q.id || '').replace(/^q/, '')) + 1 || (i + 1))) + ' 题', 'plain'),
        // 题卡没有 difficulty 字段：缺省就不显示，不谎称「基础」。
        q.difficulty ? badge(String(q.difficulty), 'plain') : null,
        // P1-2：🟢资料原题 / ⚠️模型整理。老数据没有 origin 字段时不显示，不谎称来源。
        q.origin === 'material' ? badge('🟢 资料原题', 'good')
          : q.origin === 'model' ? badge('⚠️ 模型整理', 'warn') : null,
        // 诚实标注（2026-11-23）：数据层置了 needsReview 的题，学生界面必须看得见，不能只存在后端。
        q.needsReview === true ? badge('⚠️ 需复核', 'warn') : null,
        el('span', { class: 'bs-sub', text: (it && it.title) || '' }),
      ]),
      el('div', { class: 'bs-q-stem', text: q.stem || '' }),
      figureStrip(imagesForQuestion(q, 2), '这道题要看的图'),
      canPick ? el('div', { class: 'bs-q-opts' }, optEls) : null,
      el('div', { class: 'bs-q-acts' }, [
        canPick ? el('button', { class: 'btn primary sm', text: '提交答案', onclick: () => {
          if (!picked) { verdict.textContent = '先选一个选项再提交。'; verdict.className = 'bs-verdict warn'; return; }
          const r = judge(q, picked);
          verdict.className = 'bs-verdict ' + r;
          verdict.textContent = r === 'correct' ? '✓ 答对了。想确认细节就展开解析。'
            : r === 'wrong' ? '✗ 再想想——可以看思路点拨，或展开解析对数。'
              : '这道题的答案没有可判选项，直接看解析。';
        } }) : null,
        el('button', { class: 'btn ghost sm', text: '看思路（不给答案）', onclick: (e) => {
          const hidden = hintBox.classList.toggle('hidden');
          e.currentTarget.textContent = hidden ? '看思路（不给答案）' : '收起思路';
        } }),
        el('button', { class: 'btn ghost sm', text: '显示答案', onclick: (e) => {
          const b = e.currentTarget;
          const hidden = answer.classList.toggle('hidden');
          b.textContent = hidden ? '显示答案' : '收起答案';
        } }),
        q.source && (q.source.file || q.source.pdf) ? el('span', { class: 'bs-src', title: String(q.source.file || q.source.pdf) + (q.source.anchor ? ' · ' + q.source.anchor : ''), text: prettySource(q) }) : null,
      ]),
      verdict,
      hintBox,
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
        ].map(([k, v]) => el('div', { class: 'bs-kv-row' }, [el('span', { text: k }), el('strong', { text: String(v) })]))),
      ]),
      el('div', { class: 'bs-card' }, [
        el('h4', { text: '这本书讲什么' }),
        (() => {
          // 模型没写 summary 时按真实目录/统计派生，不显示「（模型没有给摘要）」那种空壳。
          const ov = deriveOverview(S.analysis || {});
          return el('div', { class: 'bs-overview' }, [
            el('div', { class: 'bs-overview-list' }, ov.points.map((p) => el('div', { class: 'bs-overview-row' }, [
              el('strong', { text: p.label }),
              el('span', { text: p.text }),
            ]))),
            ov.note ? el('p', { class: 'bs-overview-note', text: ov.note }) : null,
          ]);
        })(),
      ]),
    ]));
    if (files.length) {
      body.appendChild(el('div', { class: 'bs-card' }, [
        el('h4', { text: '资料清单' }),
        el('div', { class: 'bs-list bs-list-cols' }, files.map((f) => el('div', { class: 'bs-file' }, [
          el('span', { class: 'bs-ext', text: fileIcon(f.ext) }),
          el('span', { class: 'bs-file-name', text: f.name }),
          el('span', { class: 'bs-file-size', text: humanSize(f.size) }),
        ]))),
      ]));
    }
    // 图片索引降到概览底部一小节（不再是独立页签）：图已贴在题目/知识点旁，
    // 这里只回答「全书共几张原图、分别在哪些题用到」，给想核对的人兜底，不抢主流程。
    if (allImagesRaw().length) {
      const box = el('div', { class: 'bs-card' }, [el('h4', { text: '资料原图 · 共 ' + allImagesRaw().length + ' 张（含重复原图的不同出处）' })]);
      const allQ = allQuestions(S.analysis);
      allImagesRaw().forEach((img) => {
        const url = host.imageUrl(S.id, img.id);
        const s = (img.sources || [])[0] || {};
        const used = allQ.filter((q) => (Array.isArray(q.imageIds) && q.imageIds.map(String).includes(String(img.id)))
          || imagesForQuestion(q, 2).some((x) => String(x.id) === String(img.id)));
        box.appendChild(el('div', { class: 'bs-fig-index-row' }, [
          url ? el('img', { src: url, alt: s.caption || '原图', loading: 'lazy',
            onclick: () => zoomImage(url, s.caption) }) : null,
          el('div', { class: 'bs-fig-index-txt' }, [
            el('div', { class: 'bs-fig-index-cap', text: s.caption || '资料原图' }),
            el('div', { class: 'bs-fig-index-src', text: (s.pageType === 'slide' ? 'PPT P' + s.page : s.pageType === 'paragraph' ? 'Word 段' + s.page : s.fileName || '') + ' · ' + humanSize(img.bytes) }),
            el('div', { class: 'bs-fig-index-used', text: used.length ? '用于：第 ' + used.slice(0, 6).map((q) => (Number(q.seqNo) > 0 ? Number(q.seqNo) : allQ.indexOf(q) + 1)).join('、') + ' 题' : '暂无题目引用' }),
          ]),
        ]));
      });
      body.appendChild(box);
    }
  }

  /* ---------------- 复习总纲（2026-11-24 收敛：原考点大全/考纲/幻灯片三页签合一） ---------------- */
  // 页签只做「展示已生成的 documents/review-guide.json」，不内置生成入口：
  // 总纲必须按章分批生成才能防截断，走 scripts/build-review-guide.mjs（骨架+逐章调用+finish 收口）；
  // 服务端单次全书调用会截断（core/documents.js 2026-11-19 注记），不能放进按钮里。
  function docState(kind) {
    if (!S[kind]) S[kind] = { busy: false, err: '', data: null, tried: false };
    return S[kind];
  }

  // points 出处（source + page）→ 那一页的整页课件原图：
  // images.json 的 fileName 形如「01_0绪论 第1页」，source 是语料段名【文件：视觉转录·X】的 X。
  // 三重匹配（剥前缀 + fileName 剥「第N页」+ page 相等）都中才显示；找不到就不显示，不拿别的页冒充。
  function pageImageFor(pt) {
    const page = Number(pt && pt.page) || 0;
    const src = String((pt && pt.source) || '').replace(/^视觉转录·/, '').trim();
    if (!page || !src) return null;
    const hit = allImages().find((x) => {
      const s = (x.sources || [])[0] || {};
      if (Number(s.page) !== page) return false;
      const key = String(s.fileName || '').replace(/\s*第\d+页$/, '').trim();
      return key === src || String(s.fileName || '').trim() === src;
    });
    if (!hit) return null;
    const s0 = (hit.sources || [])[0] || {};
    return { id: hit.id, caption: s0.caption || ('出处第 ' + page + ' 页原图') };
  }


  function renderGuide(body) {
    const st = docState('review-guide');
    // 打开页签先静默试一次缓存（cachedOnly 只读 documents/review-guide.json，
    // 没有就停在空态；绝不在这里偷偷发起模型调用）。
    if (!st.data && !st.tried && !st.busy) {
      st.tried = true;
      host.action('compose', { bookId: S.id, kind: 'review-guide', cachedOnly: true }).then((r) => {
        if (r && r.ok !== false && r.data) { st.data = r.data; render(); }
      }).catch(() => { /* 无缓存：保持空态 */ });
    }
    body.appendChild(el('div', { class: 'bs-doc-head' }, [
      el('div', {}, [
        el('h3', { text: '复习总纲' }),
        el('p', { class: 'bs-sub', text: '一份完整的复习卷：每章知识框架 + 细致知识点讲解（怎么考、最容易错、课件原句、整页原图）+ 典型题型解题路径 + 记忆钩子，比直接翻课件更有条理、更扩展。' }),
      ]),
    ]));
    if (st.err) body.appendChild(el('div', { class: 'bs-doc-err', text: st.err }));
    if (!st.data) {
      return body.appendChild(el('div', { class: 'bs-doc-empty' }, [
        el('div', { class: 'bs-cta-art', text: '◈' }),
        el('h3', { text: '还没有复习总纲' }),
        el('p', { text: '总纲由构建脚本分章生成（防长文截断）：在本仓库根目录跑 node scripts/build-review-guide.mjs，落盘后打开这个页签就能看到。' }),
      ]));
    }
    const stats = st.data.stats || {};
    const secs = st.data.sections || [];
    // 显示口径：空 quote 是「资料无连续原文段可引用、用讲解讲清」的诚实形态，
    // 不算「未命中」。只统计真正给了引文的条目，避免「0/9」误导用户以为生成失败。
    const quoteGiven = secs.reduce((n, s) => n + (s.points || []).filter((p) => p.quote).length, 0);
    const hitLine = quoteGiven
      ? '原文逐字命中 ' + (stats.quoteVerified || 0) + '/' + quoteGiven
      : '讲解型（资料无连续原文段可引用，逐条完整讲清）';
    body.appendChild(el('p', { class: 'bs-hint', text: '共 ' + secs.length + ' 章 · ' + (stats.points || 0) + ' 个知识点 · ' + hitLine + (stats.placeholderHits ? ' · 警告：模型输出含占位词 ' + stats.placeholderHits + ' 处' : '') + ' · 生成于 ' + String(st.data.generatedAt || '').slice(0, 16).replace('T', ' ') + ' · ' + String(st.data.model || '') }));
    // 总框架一览：所有章的主干合在一张骨架卡里，先看全局再进章（复习卷的目录页）。
    const overview = el('div', { class: 'bs-doc-sec bs-doc-overview' }, [
      el('div', { class: 'bs-doc-chapter' }, [el('strong', { text: '全书框架一览' })]),
    ]);
    secs.forEach((sec, si) => {
      const row = el('div', { class: 'bs-doc-fw' }, [el('div', { class: 'bs-doc-fw-ch', text: (si + 1) + '. ' + (sec.chapter || '未分章') })]);
      (sec.framework || []).forEach((f) => row.appendChild(el('div', { class: 'bs-doc-fw-item', text: f }))); 
      overview.appendChild(row);
    });
    body.appendChild(overview);
    // 章节跳转条：总纲动辄几十上百条知识点，靠滚轮找章是折磨（沿用旧文档页签的跳转条）。
    if (secs.length > 2) {
      body.appendChild(el('div', { class: 'bs-doc-nav' }, secs.map((sec, i) => el('button', {
        class: 'bs-doc-nav-item',
        title: String(sec.chapter || ''),
        onclick: () => {
          const t = mainEl.querySelector('[data-sec="' + i + '"]');
          if (t) { try { t.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* 忽略 */ } }
        },
      }, [
        el('span', { text: String(sec.chapter || '未分章').slice(0, 18) }),
        el('span', { class: 'n', text: String((sec.points || []).length) }),
      ]))));
    }
    secs.forEach((sec, si) => {
      const box = el('div', { class: 'bs-doc-sec', dataset: { sec: String(si) } });
      box.appendChild(el('div', { class: 'bs-doc-chapter' }, [
        el('strong', { text: (si + 1) + '. ' + (sec.chapter || '未分章') }),
        badge((sec.points || []).length + ' 个知识点', 'plain'),
      ]));
      // 本章知识框架：3~6 条主干，每条一句话，先搭骨架再进细节。
      if ((sec.framework || []).length) {
        const fw = el('div', { class: 'bs-doc-fw' });
        sec.framework.forEach((f, fi) => fw.appendChild(el('div', { class: 'bs-doc-fw-item', text: (fi + 1) + '. ' + f })));
        box.appendChild(fw);
      }
      // 细致知识点：讲解 + 怎么考 + 最容易错 + 课件原句 + 出处页整页原图。
      (sec.points || []).forEach((pt, i) => {
        const fig = pageImageFor(pt);
        // 反向索引：每条整理结果都能回到导图上它的那个节点（找不到就只不跳，不硬指一个错的）
        const back = () => { const h = findNodeByTitle(S.analysis.tree, pt.title); if (h) jumpToMap(h.node); };
        box.appendChild(el('div', { class: 'bs-doc-point', dataset: { doc: si + '-' + i } }, [
          el('div', { class: 'bs-doc-pt-head' }, [
            el('strong', { text: (i + 1) + '. ' + (pt.title || '') }),
            pt.quoteVerified ? badge('原文已核', 'accent') : (pt.quote ? badge('引文未逐字命中', 'plain') : null),
            pt.source ? el('span', { class: 'bs-src', text: pt.source + (pt.page ? ' · 第 ' + pt.page + ' 页' : '') }) : null,
            el('button', { class: 'bs-goto', text: '→ 导图', title: '在思维导图里定位这一条',
              onclick: back }),
          ]),
          pt.must ? el('div', { class: 'bs-doc-must', text: '必背：' + pt.must }) : null,
          el('div', { class: 'bs-doc-detail', text: pt.detail || '' }),
          pt.exam ? el('div', { class: 'bs-doc-exam', text: '怎么考：' + pt.exam }) : null,
          pt.pitfall ? el('div', { class: 'bs-doc-pit', text: '最容易错：' + pt.pitfall }) : null,
          pt.quote ? el('blockquote', { class: 'bs-doc-quote' + (pt.quoteVerified ? ' ok' : ''), text: '「' + pt.quote + '」' }) : null,
          // 出处页整页原图（source+page 三重匹配）；匹配不到就不显示，不拿别的页冒充。
          fig ? el('figure', { class: 'bs-doc-fig' }, [
            el('img', { src: host.imageUrl(S.id, fig.id), alt: fig.caption || '课件原图', loading: 'lazy' }),
            el('figcaption', { text: fig.caption }),
          ]) : null,
        ]));
      });
      // 本章典型题型与解题路径：每步一个可执行动作。
      if ((sec.problems || []).length) {
        const probs = el('div', { class: 'bs-doc-problems' }, [el('div', { class: 'bs-doc-problems-h', text: '本章典型题型与解题路径' })]);
        sec.problems.forEach((pb) => {
          probs.appendChild(el('div', { class: 'bs-doc-prob' }, [
            el('div', { class: 'bs-doc-prob-type', text: pb.type || '题型' }),
            (pb.steps || []).map((s, n) => el('div', { class: 'bs-step', text: (n + 1) + '. ' + s })),
          ]));
        });
        box.appendChild(probs);
      }
      // 记忆钩子 / 口诀。
      if ((sec.hooks || []).length) {
        const hks = el('div', { class: 'bs-doc-hooks' });
        sec.hooks.forEach((h) => hks.appendChild(el('div', { class: 'bs-doc-hook', text: '◇ ' + h })));
        box.appendChild(hks);
      }
      body.appendChild(box);
    });
    body.appendChild(el('p', { class: 'bs-hint', text: '复习路线：先看「全书框架一览」搭骨架，再逐章过知识点；引文带「原文已核」的是逐字引用，图是出处页的整页课件原图。' }));
  }


  /* ---------------- 右侧：一步一步讲 ---------------- */
  function normKey(s) { return String(s || '').replace(/\s+/g, '').trim(); }

  // 在复习总纲里找「讲同一件事」的条目。
  // 总纲条目只带自己的标题，没有 pointId，所以只能按标题对齐；
  // 先精确相等，再退到「一条包含另一条且都不太短」，最多给 3 条，避免糊成一堆弱匹配。
  function docHits(kind, node) {
    const st = S[kind];
    const d = st && st.data;
    const key = normKey(node && node.title);
    if (!d || !key) return [];
    const out = [];
    (d.sections || []).forEach((sec, si) => {
      (sec.points || []).forEach((pt, pi) => {
        const t = normKey(pt.title);
        if (!t) return;
        if (t === key) out.push({ si, pi, pt, sec, exact: true });
        else if (Math.min(t.length, key.length) >= 6 && (t.includes(key) || key.includes(t))) {
          out.push({ si, pi, pt, sec, exact: false });
        }
      });
    });
    return out.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0)).slice(0, 3);
  }

  // 跳到复习总纲的某一条（交叉索引入口都走这里）
  function gotoDoc(kind, si, pi) {
    S.tab = kind;
    render();
    setTimeout(() => {
      const t = mainEl.querySelector('[data-doc="' + si + '-' + pi + '"]');
      if (!t) return;
      try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 忽略 */ }
      t.classList.add('hit');
      setTimeout(() => t.classList.remove('hit'), 1800);
    }, 40);
  }

  // 交叉索引卡：一个知识点要能立刻回答「它在全书哪儿、有几道题、考点大全第几条、考纲第几位、出自哪份资料」。
  // 只显示真的有的东西——没有那一路数据就不出现，不用「共 0 条」占位置。
  function buildXref(node) {
    const path = pathOfNode(S.analysis.tree, node.id) || [];
    const rows = [];
    const chapterNode = findNodeByTitle(S.analysis.tree, path[1] || path[0] || '');
    rows.push(el('button', {
      class: 'bs-xrow' + (chapterNode ? '' : ' static'),
      onclick: () => chapterNode && jumpToMap(chapterNode.node),
    }, [
      el('span', { class: 'k', text: '全书位置' }),
      el('span', { class: 'v', text: path.slice(1).join(' › ') || String(node.title || '') }),
      chapterNode ? el('span', { class: 'go', text: '看这一章' }) : null,
    ]));

    // 题目：这一支（含下级知识点）总共几道。叶子常没有直接挂题（题挂在上一层），
    // 这时按「最近有题的那一层」兜底并写明层级——不冒充「本节真题」。
    let branchQs = questionsOfNode(S.analysis, node);
    let qsLevel = '';
    if (!branchQs.length) {
      const fb = questionsFromBranch(S.analysis, path);
      branchQs = fb.list;
      qsLevel = fb.level;
    }
    if (branchQs.length) {
      const t0 = branchQs[0].type || '';
      rows.push(el('button', {
        class: 'bs-xrow',
        onclick: () => { S.tab = 'types'; S.activeType = t0; render(); },
      }, [
        el('span', { class: 'k', text: '相关题目' }),
        el('span', { class: 'v', text: branchQs.length + ' 道 · ' + Array.from(new Set(branchQs.map((q) => q.type).filter(Boolean))).slice(0, 3).join(' / ') + (qsLevel ? '（' + qsLevel + '）' : '') }),
        el('span', { class: 'go', text: '去做' }),
      ]));
    }

    // 复习总纲：只有生成过才显示，且给出「第几章 · 第几条」这种能核对的位置
    {
      const kind = 'review-guide';
      const hits = docHits(kind, node);
      if (hits.length) {
        const h = hits[0];
        rows.push(el('button', {
          class: 'bs-xrow',
          onclick: () => gotoDoc(kind, h.si, h.pi),
        }, [
          el('span', { class: 'k', text: '复习总纲' }),
          el('span', { class: 'v', text: (h.sec && h.sec.chapter ? h.sec.chapter + ' · ' : '') + '第 ' + (h.pi + 1) + ' 条' }),
          el('span', { class: 'go', text: '去读' }),
        ]));
      }
    }

    // 相关原图（2026-11-23 需求7）：只认节点明确挂的 imageIds，不再按双字重合猜图。
    const figHits = (Array.isArray(node.imageIds) ? node.imageIds : [])
      .map((id) => allImages().find((x) => String(x.id) === String(id))).filter(Boolean).slice(0, 2);
    if (figHits.length) {
      rows.push(el('button', {
        class: 'bs-xrow',
        onclick: () => { S.tab = 'figures'; render(); },
      }, [
        el('span', { class: 'k', text: '资料原图' }),
        el('span', { class: 'v', text: figHits.map((x) => ((x.sources || [])[0] || {}).caption || '原图').join(' / ') }),
        el('span', { class: 'go', text: '看图' }),
      ]));
    }

    // 原始资料出处：题目自带的 source，没有题的节点就退回整本书的资料数
    const srcFile = (branchQs.find((q) => q.source && q.source.file) || {}).source;
    if (srcFile && srcFile.file) {
      rows.push(el('div', { class: 'bs-xrow static' }, [
        el('span', { class: 'k', text: '原文出处' }),
        el('span', { class: 'v', text: srcFile.file + (srcFile.anchor ? ' · ' + srcFile.anchor : ''), title: srcFile.file }),
      ]));
    }

    // 同一节里的其它知识点：最容易「顺手多看一个」的入口
    const parentPath = path.slice(0, -1);
    const parentNode = parentPath.length ? findNodeByTitle(S.analysis.tree, parentPath[parentPath.length - 1]) : null;
    const sibs = ((parentNode && parentNode.node && parentNode.node.children) || [])
      .filter((c) => String(c.id) !== String(node.id))
      .slice(0, 8);
    const box = el('div', { class: 'bs-xref' }, [
      el('div', { class: 'bs-xref-t', text: '这处与全书的连接' }),
    ].concat(rows));
    if (sibs.length) {
      box.appendChild(el('div', { class: 'bs-xref-t', text: '同一节的其它知识点', style: { marginTop: '6px' } }));
      box.appendChild(el('div', { class: 'bs-xchips' }, sibs.map((c) => el('button', {
        class: 'bs-xchip',
        text: String(c.title || '').replace(/^[\d.]+\s*/, ''),
        title: String(c.title || ''),
        onclick: () => jumpToMap(c),
      }))));
    }
    return box;
  }

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
    // desc 三层递进（2026-11-23 需求2）：分析提示词 core/analyze.js:78 早就要求
    // 「是什么；怎么考；最容易错」写在一句里，但前端原文一整段塞进「这是什么」，
    // 用户看到的就是一大坨、另外两步显示「模型没标」。这里拆开各归各位——
    // 不新增字段、不改提示词，只是把已有的教学深度正确呈现。
    const dd = splitDesc(node.desc);
    const paraOr = (txt, fallback) => el('p', { class: 'bs-para', text: txt || fallback });
    const steps = [
      { t: '先定位：它在全书的哪儿', body: [el('div', { class: 'bs-path', text: (path || []).join('  ›  ') })] },
      { t: '① 这是什么（定义 / 本质）', body: [
        paraOr(dd.what, (node.children || []).length
          ? '这一层是对下面 ' + (node.children || []).length + ' 个分支的概括：' +
            (node.children || []).map((c) => c.title).filter(Boolean).join('、')
          : '资料里没有给这个末端知识点的定义；可以看它的相邻知识点或原题反推。'),
        figureStrip(imagesForNode(node, 2), '这个知识点的图'),
      ] },
      { t: '② 怎么考 / 常考什么', body: [
        paraOr(dd.exam, ''),
        (node.questionTypes || []).length
          ? el('div', { class: 'bs-chips' }, (node.questionTypes || []).map((x) => badge(x, 'accent')))
          : null,
        (!dd.exam && !(node.questionTypes || []).length)
          ? el('p', { class: 'bs-para', text: '资料里没有标注这个点的题型；下面按相关真题看更准。' }) : null,
      ] },
      { t: '真题长什么样', body: (function () {
        // P1-3（2026-11-20 · retrieval-first）：配图默认折叠，先自己读题想一遍，
        // 点「看这道题的配图」才展开。来源判据：universal-examprep-skill SKILL.md §4 逐字
        // "Show the question figure before asking the question; show the answer figure only when explaining the answer"，
        // 以及英文 best practice "Each review must be a retrieval attempt — you try to produce the answer before checking it"。
        // 注意：题型卡里的图题并置（figureStrip(q,2,'这道题要看的图')）不动——那是为了「看懂必看图的题」，
        // 这里折叠的是讲解面板的「答案配图」，两者用途不同，不能一刀切。
        const mini = (q) => {
          const figs = imagesForQuestion(q, 1);
          const box = el('div', { class: 'bs-mini' }, [
            el('div', { class: 'bs-mini-stem', text: q.stem || '' }),
            el('div', { class: 'bs-note', text: '题型：' + (q.type || '') + (q.subtype ? ' · ' + q.subtype : '') }),
          ]);
          if (figs.length) {
            const holder = el('div', { class: 'bs-ansfig hidden' });
            const toggle = el('button', {
              class: 'btn ghost sm bs-ansfig-toggle',
              text: '看这道题的配图（先自己想一想）',
              onclick: (e) => {
                const opened = holder.classList.toggle('hidden');
                e.currentTarget.textContent = opened ? '看这道题的配图（先自己想一想）' : '收起配图';
              },
            });
            holder.appendChild(figureStrip(figs, '这道题的配图'));
            box.appendChild(toggle);
            box.appendChild(holder);
          }
          return box;
        };
        if (!qs.length) return [el('p', { class: 'bs-para', text: '这道分支下暂时没有题；换个更靠下的知识点看看。' })];
        const head = fallbackNote ? [el('p', { class: 'bs-note', text: fallbackNote })] : [];
        return head.concat(qs.slice(0, 2).map(mini));
      })() },
      { t: '③ 答案与思路（先自己想一想）', body: qs.length
        ? qs.slice(0, 2).map((q) => el('div', { class: 'bs-mini' }, [
          el('div', { class: 'bs-ans-line', text: '答案：' + (q.answer || '—') }),
          (q.solution || []).slice(0, 4).map((s, k) => el('div', { class: 'bs-step' }, [
            el('span', { class: 'bs-stepno', text: String(k + 1) }),
            el('span', { text: String(s).replace(/^第\s*\d+\s*步[：:]\s*/, '') }),
          ])),
          q.rationale ? el('div', { class: 'bs-note', text: '为什么这么想：' + String(q.rationale).replace(/^解题思路[：:]\s*/, '') }) : null,
        ]))
        : [el('p', { class: 'bs-para', text: '这一支下没有挂题；可以看上面「相关题目」进题型页找同类题。' })] },
      { t: '④ 最容易错的地方', body: (function () {
        const out = [];
        // 先给知识点自身的易错（desc 第三段，教学提示词已写），再补题目里的。
        if (dd.trap) out.push(el('div', { class: 'bs-note', text: '· ' + dd.trap }));
        qs.filter((q) => q.pitfalls).slice(0, 2).forEach((q) =>
          out.push(el('div', { class: 'bs-note', text: '· ' + String(q.pitfalls).replace(/^易错点[：:]\s*/, '') })));
        return out.length ? out : [el('p', { class: 'bs-para', text: '资料里没有专门标注这个点的易错；对照「和谁容易混」自己比一比。' })];
      })() },
      // 递进深挖（2026-11-21）：这一章学生最容易卡的点 + 必须串起来看的知识点。
      // 只在用户分析时勾了「递进深挖」且成功才有；没有就诚实说明，不伪造。
      { t: '⑤ 这一章的坎（递进深挖）', body: (function () {
        const deep = S.analysis && S.analysis.deepDive;
        if (!deep || deep.status !== 'ok' || !Array.isArray(deep.chapters) || !deep.chapters.length) {
          return [el('p', { class: 'bs-para', text: '本次未做递进深挖（分析时勾选可生成）。已有步骤照常可用。' })];
        }
        const chapter = String((path || [])[0] || '');
        const hit = deep.chapters.find((c) => String(c.chapter || '') === chapter)
          || deep.chapters.find((c) => chapter && (String(c.chapter).includes(chapter) || chapter.includes(String(c.chapter))));
        if (!hit) return [el('p', { class: 'bs-para', text: '深挖结果里没有这一章；看其它章或重新分析时勾选递进深挖。' })];
        const out = [];
        if ((hit.traps || []).length) out.push(el('div', { class: 'bs-deep-t', text: '最容易卡住' }),
          ...hit.traps.map((x) => el('div', { class: 'bs-note', text: '· ' + x })));
        if ((hit.links || []).length) out.push(el('div', { class: 'bs-deep-t', text: '要串起来看' }),
          ...hit.links.map((x) => el('div', { class: 'bs-note', text: '· ' + x })));
        return out.length ? out : [el('p', { class: 'bs-para', text: '这一章深挖结果为空（资料里没有依据，不硬凑）。' })];
      })() },
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
    detailEl.appendChild(buildXref(node));
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

  async function openAnalyze() {
    // 判据（llm-config.js 第 10 行写死，2026-11-24 重写时漏接，2026-11-27 补回）：
    // 已配置就零表单直接跑——用户原话「保存了使用」。缺配置才弹共用对话框问一次。
    // 深挖开关从设置页读（s.deepDive），不再塞进分析流程；换模型/视觉模型也在设置页。
    const r = await readiness();
    if (r.ok) {
      // 已就绪：不弹任何表单。cfg 只给地址/模型，密钥由服务端 mergeCfg 补齐。
      const s = r.settings || {};
      return runAnalysis({
        baseURL: s.baseURL,
        model: s.model,
        visionModel: s.visionModel || '',
        deepDive: !!s.deepDive,
      });
    }
    // 缺配置：复用共用对话框，填一次保存后直接跑，不再让用户在分析框里二次确认。
    const cfg = await credentialDialog({
      title: S.analysis ? '重新分析 · 先配置模型' : '开始分析 · 先配置模型',
      sub: '地址、模型与密钥存在本机服务里，填一次以后分析都不用再填。',
      deepDive: !!(r.settings && r.settings.deepDive),
    });
    if (!cfg) return;
    return runAnalysis(cfg);
  }

  /** 真正发起分析，两条入口（零表单 / 配置后）共用这一份，不留第二份分叉。 */
  async function runAnalysis(v) {
    const payloadCfg = { baseURL: v.baseURL, model: v.model };
    if (v.apiKey) payloadCfg.apiKey = v.apiKey;
    const vm = v.visionModel || '';
    const deep = !!v.deepDive;
    // 零表单没有对话框可显示进度，统一用 toast 起头（真机验证过：toast 在场、无需额外 DOM）。
    // 早先试过往 .bs-acts 插一条 .bs-analyzing 状态条，但 railEl 在 render() 时整段重建，
    // 状态条刚插进去就被冲掉——写了却不生效的死代码，2026-11-27 删掉，只留一条真通道。
    toast(vm ? '分析中…先让视觉模型看懂配图' : '分析中…（不要关页面）', 'info');
    try {
      // 填了视觉模型就通过 visionCfg 传给 analyze：它会在出题前先逐张看图（不改协议、
      // 不新增 action，三端能力清单保持一致）。看图失败自动降级按图注配图，不挡分析。
      // 语料上限 12 万字符 + 输出预算 4.8 万 token，真机耗时可能 3-8 分钟（大资料更久）。
      // 超时失败用户一无所得，比慢更糟；给 600s，宁可等也不失败。
      const r = await host.action('analyze', {
        bookId: S.id, cfg: payloadCfg, timeoutMs: 600000,
        // visionCfg 不带密钥也成立：服务端会把配置里那份补给它
        visionCfg: vm ? { baseURL: payloadCfg.baseURL, model: vm } : null,
        deepDive: deep,
      });
      if (!r || r.ok === false) throw new Error((r && r.error) || '分析失败');
      toast('分析完成', 'ok');
      if (vm && r.data && r.data.visionStat) {
        const vs = r.data.visionStat;
        toast(vs.error ? ('看图未完成，本次按图注配图：' + vs.error)
          : ('已看懂 ' + vs.done + ' 张图' + (vs.failed ? '，' + vs.failed + ' 张看图失败' : '') + '，题图已按图内容配对'), vs.error ? 'info' : 'ok');
      }
      if (deep && r.data && r.data.deepDive) {
        const dd = r.data.deepDive;
        toast(dd.status === 'ok' ? ('递进完成：' + (dd.chapters || []).length + ' 章的易错与串联已写入')
          : ('递进深挖未完成（主分析不受影响）：' + (dd.error || '未知原因')), dd.status === 'ok' ? 'ok' : 'info');
      }
      await load();
      S.tab = 'map';
      render();
      // 2026-11-24：分析后不再自动补整理文档——原 digest/syllabus 页签已收敛为「复习总纲」，
      // 总纲按章分批生成（scripts/build-review-guide.mjs），不塞进分析流程自动跑。
    } catch (e) {
      toast('分析失败：' + String(e.message || e), 'bad');
    }
  }

  await load();
  return { destroy() { /* 无定时器需清理；保留接口 */ } };
}

export default { mountBookspace };
