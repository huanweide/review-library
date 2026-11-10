'use strict';
/* 统一核心 · 思维导图布局与题型树（UMD：浏览器 window.MindmapLayout / Node require 同源）。
 *
 * 为什么单独成模块：布局算法是纯函数，能被 Node 判别测试真调用；
 * 前端画布、SVG 导出、PNG 光栅化全部复用同一份坐标，杜绝「导出与屏幕不一致」。
 *
 * 对标（PROCESS/research-mindmap-v2/best-practices.md）：
 *   markmap —— 交互式 SVG、branch colors、initial expansion level
 *   Xmind   —— 多结构（右向逻辑图 / 双侧导图 / 组织结构图）、大纲模式、按章配色
 *   mind-elixir —— 简洁 JSON 树 + 事件总线（本模块只产出数据，事件由 core-ui.js 绑定）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MindmapLayout = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 按章分支配色（markmap branch colors / Xmind 彩虹线）。同色贯穿连线与后代。
  const BRANCH_COLORS = ['#3a7afe', '#f2994a', '#27ae60', '#9b51e0', '#eb5757', '#00a3b8', '#d4a017'];
  const NODE_W = 176, NODE_H = 34, GAP_X = 62, GAP_Y = 14, PAD = 28;

  function escXml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }
  function short(s, n) {
    const t = String(s == null ? '' : s);
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }
  function childrenOf(n) { return (n && Array.isArray(n.children)) ? n.children : []; }

  // 收集扁平节点 + 深度 + 所属分支色 + 父 id。先给每个叶子一个「行号」，
  // 父节点取子节点行号均值 —— 这是 Reingold-Tilford 的简化版，够用且无第三方依赖。
  function flatten(root) {
    const flat = [];
    let leafRow = 0;
    const rowOf = {};
    (function walk(node, depth, parentId, color, branch) {
      if (!node || typeof node !== 'object') return null;
      const id = node.id || ('n' + depth + '_' + flat.length);
      const kids = childrenOf(node);
      const b = depth === 1 ? (branch == null ? flat.filter(n => n.depth === 1).length : branch) : branch;
      // 一级分支强制取自己的分支色，不继承 root 的蓝；后代才继承父色。
      const col = depth === 0 ? '#3a7afe'
        : depth === 1 ? BRANCH_COLORS[(b || 0) % BRANCH_COLORS.length]
        : (color || BRANCH_COLORS[0]);
      const rec = {
        id, title: String(node.title || '未命名'), type: node.type || 'node',
        depth, parentId, color: col, w: NODE_W, h: NODE_H,
        desc: node.desc || '', questionTypes: node.questionTypes || [],
        kind: node.kind || null, question: node.question || null,
        meta: node.meta || null, x: 0, y: 0
      };
      flat.push(rec);
      if (!kids.length) { rowOf[id] = leafRow++; return rec; }
      const rows = kids.map(k => walk(k, depth + 1, id, col, b)).filter(Boolean).map(c => rowOf[c.id]);
      rowOf[id] = rows.length ? (Math.min.apply(null, rows) + Math.max.apply(null, rows)) / 2 : leafRow++;
      return rec;
    })(root, 0, null, null, null);
    return { flat, rowOf, maxRow: Math.max(1, leafRow), maxDepth: flat.reduce((m, n) => Math.max(m, n.depth), 0) };
  }

  // 3 种布局。坐标都是「画布内绝对像素」，供 SVG 直接绘制。
  function layoutTree(root, mode) {
    const m = ['right', 'both', 'org'].includes(mode) ? mode : 'right';
    const { flat, rowOf, maxRow, maxDepth } = flatten(root);
    const byId = {};
    flat.forEach(n => { byId[n.id] = n; });

    if (m === 'right') {
      flat.forEach(n => {
        n.x = PAD + n.depth * (NODE_W + GAP_X);
        n.y = PAD + rowOf[n.id] * (NODE_H + GAP_Y);
      });
    } else if (m === 'org') {
      // 组织结构图：自上而下，层级在 y，兄弟在 x。
      flat.forEach(n => {
        n.x = PAD + rowOf[n.id] * (NODE_W + GAP_X * 0.45);
        n.y = PAD + n.depth * (NODE_H + GAP_Y * 1.7);
      });
    } else {
      // 双侧导图：一级分支按奇偶分到左右两侧，两侧各自独立排行号（不互相挤占）。
      const tops = flat.filter(n => n.depth === 1);
      const kidsOf = {};
      flat.forEach(n => { if (n.parentId) (kidsOf[n.parentId] = kidsOf[n.parentId] || []).push(n.id); });
      const sideOf = {}, rowSide = {}, counter = { L: 0, R: 0 };
      tops.forEach((t, i) => {
        const side = i % 2 === 0 ? 'R' : 'L';
        let row = counter[side];
        (function assign(id) {
          sideOf[id] = side;
          const kids = kidsOf[id] || [];
          if (!kids.length) { rowSide[id] = row++; return rowSide[id]; }
          const rows = kids.map(assign);
          rowSide[id] = (Math.min.apply(null, rows) + Math.max.apply(null, rows)) / 2;
          return rowSide[id];
        })(t.id);
        counter[side] = row;
      });
      flat.forEach(n => {
        if (n.depth === 0) return;
        const side = sideOf[n.id] || 'R';
        n.x = (side === 'L' ? -1 : 1) * (PAD + n.depth * (NODE_W + GAP_X));
        n.y = PAD + (rowSide[n.id] || 0) * (NODE_H + GAP_Y);
      });
      // 归一化到正坐标；root 放在左右一级节点的中线、垂直居中。
      const nonRoot = flat.filter(n => n.depth > 0);
      const minX = Math.min.apply(null, nonRoot.map(n => n.x));
      const shift = PAD - minX;
      nonRoot.forEach(n => { n.x += shift; });
      const rootNode = flat.find(n => n.depth === 0);
      if (rootNode) {
        const topXs = flat.filter(n => n.depth === 1).map(n => n.x);
        const maxRows = Math.max(counter.L, counter.R, 1);
        rootNode.x = (Math.min.apply(null, topXs) + Math.max.apply(null, topXs)) / 2;
        rootNode.y = PAD + (maxRows - 1) * (NODE_H + GAP_Y) / 2;
      }
    }

    flat.forEach(n => { n.x = Math.round(n.x); n.y = Math.round(n.y); });
    const width = Math.max.apply(null, flat.map(n => n.x + n.w)) + PAD;
    const height = Math.max.apply(null, flat.map(n => n.y + n.h)) + PAD;
    const edges = flat.filter(n => n.parentId).map(n => ({ from: n.parentId, to: n.id, color: n.color }));
    return { nodes: flat, edges, width, height, mode: m, maxDepth, maxRow };
  }

  // 全文搜索：返回命中节点 id 列表（大小写不敏感）。折叠态下 DOM 里没有文本也能搜。
  function searchNodes(nodes, keyword) {
    const k = String(keyword || '').trim().toLowerCase();
    if (!k) return [];
    return (nodes || []).filter(n => String(n.title || '').toLowerCase().includes(k)).map(n => n.id);
  }

  // 题型分类长进同一张导图：根 → 题型 → 子题型 → 题目（三级下钻的数据形状）。
  function buildQuestionTree(qIndex) {
    const groups = Array.isArray(qIndex) ? qIndex : [];
    const children = groups.map((g, gi) => {
      const items = Array.isArray(g.items) ? g.items : [];
      const itemNodes = items.map((it, ii) => {
        const qs = Array.isArray(it.questions) ? it.questions : [];
        return {
          id: 'qi_' + gi + '_' + ii,
          type: 'qitem', kind: 'qitem',
          title: String(it.title || '未命名子题型'),
          desc: '', path: it.path || [], pointId: it.pointId || null,
          meta: { count: qs.length },
          children: qs.map((q, qi) => ({
            id: String(q.id || ('qq_' + gi + '_' + ii + '_' + qi)),
            type: 'question', kind: 'question',
            title: String(q.stem || '未命名题目').slice(0, 42),
            desc: '', question: q,
            meta: { difficulty: q.difficulty || '基础' },
            children: []
          }))
        };
      });
      const count = itemNodes.reduce((s, i) => s + i.children.length, 0);
      return {
        id: 'qt_' + gi, type: 'qtype', kind: 'qtype',
        title: String(g.type || '未分类'), desc: '',
        meta: { count }, children: itemNodes
      };
    });
    const total = children.reduce((s, c) => s + (c.meta ? c.meta.count : 0), 0);
    return {
      id: 'qt_root', type: 'root', kind: 'qroot',
      title: '题型分类', desc: '', meta: { count: total }, children
    };
  }

  // 大纲导出（Xmind 大纲模式 / Markdown 列表）
  function toMarkdown(tree) {
    const lines = [];
    (function walk(n, depth) {
      if (depth === 0) lines.push('# ' + String(n.title || '未命名'));
      else lines.push('  '.repeat(depth - 1) + '- ' + String(n.title || '未命名'));
      childrenOf(n).forEach(c => walk(c, depth + 1));
    })(tree, 0);
    return lines.join('\n') + '\n';
  }
  // OPML：可导入 Xmind / OmniOutliner / 多数大纲工具
  function toOpml(tree) {
    const out = [];
    (function walk(n) {
      out.push('<outline text="' + escXml(n.title || '') + '">');
      childrenOf(n).forEach(walk);
      out.push('</outline>');
    })(tree);
    return '<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n<head><title>' +
      escXml(tree.title || '') + '</title></head>\n<body>\n' + out.join('\n') + '\n</body>\n</opml>\n';
  }

  // 单一真源：画布与「导出 SVG / PNG」都吃这份坐标。含节点徽章（题型 / 题目数 / 原图）。
  function toSvg(layout, opts) {
    const o = opts || {};
    const pos = {};
    (layout.nodes || []).forEach(n => { pos[n.id] = n; });
    // v3 美化：颜色由调用方按主题 token 注入；缺省仍是白底，
    // 保证 Node 侧判别测试与「不带主题信息的导出」行为不变。
    const bg = o.background || '#ffffff';
    const nodeFill = o.nodeFill || '#ffffff';
    const textColor = o.textColor || '#1f2733';
    const metaColor = o.metaColor || '#6b7688';
    const rootText = o.rootTextColor || '#ffffff';
    let body = '<rect x="0" y="0" width="' + layout.width + '" height="' + layout.height + '" fill="' + bg + '"/>';
    (layout.edges || []).forEach(e => {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return;
      let d;
      if (layout.mode === 'org') {
        const x1 = a.x + a.w / 2, y1 = a.y + a.h;
        const x2 = b.x + b.w / 2, y2 = b.y;
        d = 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (y1 + y2) / 2 + ' ' + x2 + ' ' + (y1 + y2) / 2 + ' ' + x2 + ' ' + y2;
      } else {
        const rightward = b.x >= a.x;
        const x1 = rightward ? a.x + a.w : a.x, y1 = a.y + a.h / 2;
        const x2 = rightward ? b.x : b.x + b.w, y2 = b.y + b.h / 2;
        const mx = (x1 + x2) / 2;
        d = 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2;
      }
      body += '<path d="' + d + '" stroke="' + e.color + '" stroke-width="1.6" fill="none" opacity="0.65"/>';
    });
    (layout.nodes || []).forEach(n => {
      const isRoot = n.depth === 0;
      const fill = isRoot ? n.color : nodeFill;
      const stroke = n.color;
      const tc = isRoot ? rootText : textColor;
      body += '<g class="mm-node" data-id="' + escXml(n.id) + '" data-kind="' + escXml(n.kind || n.type) + '">';
      body += '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="9" fill="' + fill +
        '" stroke="' + stroke + '" stroke-width="' + (isRoot ? 0 : 1.4) + '"/>';
      body += '<text x="' + (n.x + 10) + '" y="' + (n.y + n.h / 2 + 4) + '" font-size="12" font-family="system-ui,sans-serif" fill="' +
        tc + '">' + escXml(short(n.title, 16)) + '</text>';
      if (n.questionTypes && n.questionTypes.length) {
        body += '<circle cx="' + (n.x + n.w - 10) + '" cy="' + (n.y + 10) + '" r="4" fill="' + n.color + '"/>';
      }
      if (n.meta && typeof n.meta.count === 'number') {
        body += '<text x="' + (n.x + n.w - 8) + '" y="' + (n.y + n.h / 2 + 4) + '" font-size="10" text-anchor="end" fill="' +
          (isRoot ? rootText : metaColor) + '" font-family="system-ui,sans-serif">' + n.meta.count + '</text>';
      }
      if (n.question && n.question.source && n.question.source.file) {
        body += '<circle cx="' + (n.x + n.w - 10) + '" cy="' + (n.y + n.h - 9) + '" r="3" fill="#f2994a"/>';
      }
      body += '</g>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + layout.width + '" height="' + layout.height +
      '" viewBox="0 0 ' + layout.width + ' ' + layout.height + '">' + body + '</svg>';
  }

  return {
    layoutTree, searchNodes, buildQuestionTree, toMarkdown, toOpml, toSvg,
    BRANCH_COLORS, NODE_W, NODE_H, escXml
  };
});
