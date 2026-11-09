// dsh-review-analysis —— DeepSeek Harness Web GUI Client 半边（统一核心版）。
//
// 与旧版区别：旧面板读 report.md / mindmap.full.json 的 centers/points/related 结构；
// 本版读 Host 的 GET /review-analysis/api/state，直接渲染统一核心产物：
//   可层层展开的思维导图树 + 按题型分类的索引 + 全书概览。
// 面板是只读视图；「整体分析」由对话里的 review_analysis 工具触发（模型配置不进面板、不落盘）。
//
// 约束：浏览器模块表加载的普通 ESM 片段，只能 require('react') 这类基线模块。

window.__ModuleLoader__.load({
  id: 'dsh-review-analysis',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const PANEL_ID = 'review-analysis';
    const API = '/review-analysis/api/state';

    const TEXT = {
      zh: {
        label: '复习分析', title: '统一复习导图',
        subtitle: '导入资料 → 建一本书 → 大模型整本整体分析',
        loading: '正在读取统一核心…', refresh: '刷新', failed: '读取失败',
        empty: '还没有书。在对话里用 review_analysis 工具建书并导入资料。',
        books: '本书', analyzed: '已分析', points: '知识点', qtypes: '类题型',
        tabMap: '思维导图', tabQuestions: '题型索引', tabOverview: '概览',
        materials: '份资料', noAnalysis: '该书尚未整体分析。在对话里调用 review_analysis 的 analyze 动作（需提供模型配置）。',
        hintAnalyze: '要重新分析，请在对话里调用 review_analysis 工具；模型密钥不进面板、不落盘。',
        expandAll: '全部展开', collapseAll: '全部收起',
        summaryEmpty: '（无概览）', questionEmpty: '（该类暂无）',
        statsChapters: '章', statsSections: '节', statsPoints: '知识点', statsSubtypes: '子点',
        model: '模型', coreVersion: '核心版本',
      },
      en: {
        label: 'Review analysis', title: 'Unified review map',
        subtitle: 'Import files → create a book → analyze the whole book with an LLM',
        loading: 'Loading unified core…', refresh: 'Refresh', failed: 'Could not read state',
        empty: 'No books yet. Use the review_analysis tool in chat to create one and add files.',
        books: 'books', analyzed: 'analyzed', points: 'points', qtypes: 'question types',
        tabMap: 'Mind map', tabQuestions: 'Question index', tabOverview: 'Overview',
        materials: 'files', noAnalysis: 'Not analyzed yet. Call review_analysis with action=analyze in chat (LLM config required).',
        hintAnalyze: 'To re-analyze, call the review_analysis tool in chat; API keys never enter this panel.',
        expandAll: 'Expand all', collapseAll: 'Collapse all',
        summaryEmpty: '(no summary)', questionEmpty: '(none)',
        statsChapters: 'chapters', statsSections: 'sections', statsPoints: 'points', statsSubtypes: 'sub-points',
        model: 'Model', coreVersion: 'Core',
      },
    };
    function localeId(ctx) {
      try {
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
        const snap = locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null;
        const id = snap && (snap.id || snap.locale || snap.language);
        return String(id || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
      } catch { return 'zh'; }
    }
    function text(ctx, key) { return (TEXT[localeId(ctx)] || TEXT.zh)[key] || key; }

    function useView() {
      const [state, setState] = useState({ status: 'loading', data: null, error: null });
      const load = useCallback(async () => {
        setState((s) => Object.assign({}, s, { status: 'loading' }));
        try {
          const r = await fetch(API, { cache: 'no-store' });
          const data = await r.json();
          setState({ status: 'ready', data, error: data && data.ok === false ? data.error : null });
        } catch (e) { setState({ status: 'ready', data: null, error: String(e && e.message || e) }); }
      }, []);
      useEffect(() => { void load(); }, [load]);
      return { state, load };
    }

    function TreeNode({ node, depth, forceOpen }) {
      const kids = (node && node.children) || [];
      const [open, setOpen] = useState(depth < 2);
      const shown = forceOpen == null ? open : forceOpen;
      if (!node) return null;
      return h('div', { className: 'dsra-node' },
        h('button', {
          type: 'button', className: 'dsra-node-head t-' + (node.type || 'point'),
          onClick: () => kids.length && forceOpen == null && setOpen(!shown),
        },
          h('span', { className: 'dsra-tw' }, kids.length ? (shown ? '▾' : '▸') : '·'),
          h('span', { className: 'dsra-node-title' }, node.title || '(未命名)'),
          node.desc ? h('span', { className: 'dsra-node-desc' }, '— ' + node.desc) : null,
          h('span', { className: 'dsra-node-type' }, node.type || ''),
        ),
        kids.length && shown
          ? h('div', { className: 'dsra-node-kids' }, kids.map((k, i) => h(TreeNode, { key: k.id || i, node: k, depth: depth + 1, forceOpen })))
          : null,
      );
    }

    function Mindmap({ book, t }) {
      const [all, setAll] = useState(null);
      if (!book.tree) return h('p', { className: 'dsra-muted' }, t('noAnalysis'));
      return h('div', null,
        h('div', { className: 'dsra-toolbar' },
          h('button', { type: 'button', className: 'dsra-btn', onClick: () => setAll(true) }, t('expandAll')),
          h('button', { type: 'button', className: 'dsra-btn', onClick: () => setAll(false) }, t('collapseAll')),
        ),
        h(TreeNode, { node: book.tree, depth: 0, forceOpen: all }),
      );
    }

    function Questions({ book, t }) {
      const groups = book.questionIndex || [];
      if (!groups.length) return h('p', { className: 'dsra-muted' }, t('noAnalysis'));
      return h('div', { className: 'dsra-qgroups' }, groups.map((g, i) =>
        h('div', { className: 'dsra-qgroup', key: g.type || i },
          h('h4', { className: 'dsra-qgroup-title' }, (g.type || '其他') + ' · ' + ((g.items || []).length)),
          (g.items || []).length
            ? h('ul', { className: 'dsra-qitems' }, (g.items || []).map((it, j) =>
              h('li', { className: 'dsra-qitem', key: j },
                h('div', null, it.title || ''),
                (it.path && it.path.length) ? h('div', { className: 'dsra-qpath' }, it.path.join(' › ')) : null,
              )))
            : h('p', { className: 'dsra-muted' }, t('questionEmpty')),
        )));
    }

    function Overview({ book, t }) {
      const s = book.stats || {};
      const cards = [
        [s.chapters, t('statsChapters')], [s.sections, t('statsSections')],
        [s.points, t('statsPoints')], [s.subtypes, t('statsSubtypes')],
        [s.questionTypes, t('qtypes')],
      ];
      return h('div', null,
        h('div', { className: 'dsra-stats' }, cards.map(([n, label], i) =>
          h('div', { className: 'dsra-stat', key: i }, h('strong', null, n == null ? '—' : n), h('span', null, label)))),
        h('p', { className: 'dsra-summary' }, book.summary || t('summaryEmpty')),
        h('p', { className: 'dsra-muted' }, t('model') + '：' + (book.model || '—') + ' ｜ ' + t('materials') + '：' + book.materialCount),
      );
    }

    function BookCard({ book, t, defaultOpen }) {
      const [open, setOpen] = useState(defaultOpen);
      const [tab, setTab] = useState('map');
      return h('section', { className: 'dsra-book' },
        h('button', { type: 'button', className: 'dsra-book-head', onClick: () => setOpen(!open) },
          h('div', { className: 'dsra-book-main' },
            h('div', { className: 'dsra-book-title' }, book.title || book.id),
            h('div', { className: 'dsra-book-sub' }, book.materialCount + ' ' + t('materials') +
              (book.analyzedAt ? ' · ' + t('analyzed') + ' ' + String(book.analyzedAt).slice(0, 10) : '')),
          ),
          h('div', { className: 'dsra-book-meta' },
            h('span', { className: 'dsra-chip' + (book.hasAnalysis ? ' dsra-chip-brand' : '') }, book.hasAnalysis ? t('analyzed') : t('noAnalysis').slice(0, 8)),
            h('span', { className: 'dsra-chevron' + (open ? ' is-open' : '') }, '▾'),
          ),
        ),
        open ? h('div', { className: 'dsra-book-body' },
          h('div', { className: 'dsra-tabs' },
            [['map', 'tabMap'], ['questions', 'tabQuestions'], ['overview', 'tabOverview']].map(([k, label]) =>
              h('button', { type: 'button', key: k, className: 'dsra-tab' + (tab === k ? ' is-active' : ''), onClick: () => setTab(k) }, t(label)))),
          h('div', { className: 'dsra-panel-inner' },
            tab === 'map' ? h(Mindmap, { book, t }) :
              tab === 'questions' ? h(Questions, { book, t }) : h(Overview, { book, t }),
          ),
        ) : null,
      );
    }

    function PanelIcon({ size }) {
      const s = size || 20;
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8' },
        h('circle', { cx: '5', cy: '12', r: '2' }), h('circle', { cx: '18', cy: '6', r: '2' }),
        h('circle', { cx: '18', cy: '18', r: '2' }),
        h('path', { d: 'M7 12h4M11 12l5-6M11 12l5 6' }));
    }

    function PanelPage() {
      const t = (key) => text(rootCtx, key);
      const { state, load } = useView();
      const data = state.data;
      const stats = data && data.ok !== false ? [
        { value: data.bookCount, label: t('books') },
        { value: data.analyzedCount, label: t('analyzed') },
        { value: data.questionTypeCount, label: t('qtypes') },
      ] : [];
      return h('div', { className: 'dsra-root', 'data-dsh-review-analysis': '' },
        h('header', { className: 'dsra-head' },
          h('div', null, h('h1', { className: 'dsra-title' }, t('title')), h('p', { className: 'dsra-sub' }, t('subtitle'))),
          h('div', { className: 'dsra-actions' },
            h('button', { type: 'button', className: 'dsra-btn', onClick: () => void load(), disabled: state.status === 'loading' }, t('refresh')),
          ),
        ),
        h('div', { className: 'dsra-banner' }, t('hintAnalyze')),
        state.status === 'loading' ? h('p', { className: 'dsra-loading' }, t('loading')) : null,
        state.error ? h('p', { className: 'dsra-error' }, t('failed') + '：' + state.error) : null,
        h('div', { className: 'dsra-content' },
          stats.length ? h('div', { className: 'dsra-stats' }, stats.map((s, i) =>
            h('div', { className: 'dsra-stat', key: i }, h('strong', null, s.value == null ? '—' : s.value), h('span', null, s.label)))) : null,
          data && data.books && data.books.length
            ? h('div', { className: 'dsra-books' }, data.books.map((b, i) => h(BookCard, { key: b.id, book: b, t, defaultOpen: i === 0 })))
            : (state.status !== 'loading' && !state.error ? h('p', { className: 'dsra-empty' }, t('empty')) : null),
        ),
      );
    }

    const CSS = [
      '.dsra-root{display:flex;flex-direction:column;height:100%;font-family:inherit;color:var(--dsw-alias-label-primary,#1f2328)}',
      '.dsra-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 28px 12px;flex:none}',
      '.dsra-title{font-size:20px;font-weight:680;margin:0}.dsra-sub{font-size:12.5px;color:var(--dsw-alias-label-secondary,#6b7280);margin:4px 0 0}',
      '.dsra-actions{display:flex;gap:8px}.dsra-btn{appearance:none;font:inherit;font-size:12.5px;padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));background:transparent;color:inherit;cursor:pointer}',
      '.dsra-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}',
      '.dsra-banner{margin:0 28px 14px;padding:8px 12px;border-radius:8px;font-size:12.5px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#2563eb) 10%,transparent);color:var(--dsw-alias-label-secondary,#6b7280);flex:none}',
      '.dsra-content{flex:1;min-height:0;overflow:auto;padding:0 28px 40px}',
      '.dsra-stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}',
      '.dsra-stat{display:flex;flex-direction:column;gap:2px;min-width:88px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.02))}',
      '.dsra-stat strong{font-size:19px;font-weight:680}.dsra-stat span{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.dsra-books{display:flex;flex-direction:column;gap:12px;max-width:1080px}',
      '.dsra-book{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:12px;overflow:hidden}',
      '.dsra-book-head{appearance:none;font:inherit;display:flex;align-items:center;gap:12px;width:100%;padding:13px 16px;border:0;background:transparent;color:inherit;cursor:pointer;text-align:left}',
      '.dsra-book-head:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.05))}',
      '.dsra-book-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.dsra-book-title{font-size:15px;font-weight:640}.dsra-book-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.dsra-book-meta{display:flex;align-items:center;gap:8px;flex:none}',
      '.dsra-chip{font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}',
      '.dsra-chip-brand{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#2563eb) 14%,transparent);color:var(--dsw-alias-brand-primary,#2563eb)}',
      '.dsra-chevron{font-size:11px;opacity:.55;transition:transform .15s}.dsra-chevron.is-open{transform:rotate(180deg)}',
      '.dsra-book-body{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));padding:8px 14px 18px}',
      '.dsra-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16))}',
      '.dsra-tab{appearance:none;font:inherit;font-size:13px;padding:8px 12px;margin-bottom:-1px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer}',
      '.dsra-tab.is-active{color:var(--dsw-alias-label-primary,#1f2328);border-bottom-color:var(--dsw-alias-brand-primary,#2563eb);font-weight:600}',
      '.dsra-panel-inner{padding-top:12px}.dsra-toolbar{display:flex;gap:8px;margin-bottom:10px}',
      '.dsra-node{display:flex;flex-direction:column}',
      '.dsra-node-head{appearance:none;font:inherit;display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;text-align:left}',
      '.dsra-node-head:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}',
      '.dsra-node-head.t-root{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#2563eb) 12%,transparent);font-weight:640}',
      '.dsra-node-head.t-chapter{font-weight:600}.dsra-tw{width:12px;opacity:.6;font-size:11px;flex:none}',
      '.dsra-node-title{flex:1;min-width:0;font-size:13px;word-break:break-word}',
      '.dsra-node-desc{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.dsra-node-type{font-size:10.5px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:var(--dsw-alias-label-secondary,#6b7280);flex:none}',
      '.dsra-node-kids{margin-left:18px;padding-left:10px;border-left:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}',
      '.dsra-qgroups{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}',
      '.dsra-qgroup{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:10px;padding:10px 12px}',
      '.dsra-qgroup-title{font-size:13px;margin:0 0 8px;font-weight:640}',
      '.dsra-qitems{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.dsra-qitem{font-size:12.5px;word-break:break-word}.dsra-qpath{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);margin-top:2px}',
      '.dsra-summary{font-size:13px;line-height:1.7;word-break:break-word}',
      '.dsra-muted{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px}',
      '.dsra-empty,.dsra-loading,.dsra-error{padding:24px 0;font-size:13px;color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.dsra-error{color:var(--dsw-alias-state-danger-primary,#b91c1c)}',
    ].join('\n');

    let rootCtx = null;
    return {
      inject: ['slots'],
      apply(ctx) {
        rootCtx = ctx;
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.dshPlugin = 'dsh-review-analysis';
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'dsh-review-analysis: panel styles');
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => text(ctx, 'label') }, PanelIcon));
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, PanelPage));
      },
    };
  },
});
