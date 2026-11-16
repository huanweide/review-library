/**
 * adapter.js —— 天道书院 · 统一格式适配器（纯函数，无 DOM 依赖）
 *
 * 职责：把「天道书阁」LLM 产物（analysis.json / documents/*.json / book 元数据）
 *       统一整理成「考点罗盘」的 bookData 契约，并扩展 digest / syllabus / mindmap / _trace。
 *
 * 这是「所有 LLM 解析出的内容统一格式」的实质：
 *   - 输入可以是任何书馆书（四层树 + questionIndex），输出永远是同一套字段；
 *   - 题面 tiku 与答案 tikuAns 物理分离（零反馈模拟考的地基）；
 *   - 结构化引用 source 不降级丢失：字符串 src 供罗盘消费，原对象进 _trace 供"原文已核"徽章。
 *
 * 设计红线（见 00-融合决策表.md）：
 *   D1 树→扁平三级编号；D2 文件级 focus→知识点级 hot；D3 题答分离且不伪造判分信号；
 *   D4 题型归一；D5 知识点↔题关联按真实 pointId 层级（不编造精确到点）；D6 source 双形态保留。
 *
 * 双导出：浏览器挂 window.TiandaoAdapter；Node 走 module.exports（供 build/test 复用）。
 */
(function (global) {
  'use strict';
  const Adapter = {};
  const VERSION = 1;

  // ===== 通用防御：任何字段都不得漏出 undefined / [object Object] =====
  function str(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  Adapter.str = str;

  // ===== D4 题型归一：书馆 7 类 → 罗盘题型；未覆盖的保留原名（不硬塞）=====
  const TYPE_MAP = {
    '单选题': '选择题', '单选': '选择题', '多项选择': '选择题', '多选题': '选择题', '客观题': '选择题',
    '填空': '填空题',
    '判断': '判断题',
    '简答': '简答题',
    '名词解释题': '名词解释',
    '计算': '计算题',
    '综合题': '综合应用题',
    '论述': '论述题'
  };
  Adapter.TYPE_MAP = TYPE_MAP;
  function mapType(t) { const s = str(t).trim(); return TYPE_MAP[s] || s || '其他'; }

  // ===== D1 编号分配：root → chapter(1) → section(1.1) → point(1.1.1) =====
  // 真实样本中题的 pointId 指向 section(n2_2)，因此 section 也有稳定编号，kp 才能据实落位。
  function assignCodes(tree) {
    const root = obj(tree);
    const map = {}, byCode = {}, points = [], chapters = [], secs = [];
    let ci = 0;
    arr(root.children).forEach(ch => {
      if (str(ch.type) !== 'chapter') return;
      ci++;
      const chKey = String(ci);
      const chLabel = str(ch.title || ('第' + chKey + '章'));
      map[str(ch.id)] = { code: chKey, type: 'chapter', chKey, chLabel, sec: '' };
      byCode[chKey] = { id: str(ch.id), type: 'chapter', chKey, chLabel, sec: '' };
      chapters.push({ code: chKey, label: chLabel, id: str(ch.id), node: ch });
      let si = 0, barePoint = 0;
      arr(ch.children).forEach(child => {
        const t = str(child.type);
        if (t === 'section') {
          si++;
          const secCode = chKey + '.' + si;
          const secLabel = str(child.title || secCode);
          map[str(child.id)] = { code: secCode, type: 'section', chKey, chLabel, sec: secLabel };
          byCode[secCode] = { id: str(child.id), type: 'section', chKey, chLabel, sec: secLabel };
          secs.push({ code: secCode, label: secLabel, chKey, chLabel, id: str(child.id), node: child });
          let pi = 0;
          arr(child.children).forEach(pt => {
            if (str(pt.type) !== 'point') return;
            pi++;
            const code = secCode + '.' + pi;
            map[str(pt.id)] = { code, type: 'point', chKey, chLabel, sec: secLabel };
            byCode[code] = { id: str(pt.id), type: 'point', chKey, chLabel, sec: secLabel };
            points.push({ code, node: pt, chKey, chLabel, sec: secLabel, id: str(pt.id) });
          });
        } else if (t === 'point') {
          // 降级兼容：章下直接挂点（无 section 层）时归入隐式节 chKey.0
          barePoint++;
          const secLabel = '章内要点';
          const code = chKey + '.0.' + barePoint;
          map[str(child.id)] = { code, type: 'point', chKey, chLabel, sec: secLabel };
          byCode[code] = { id: str(child.id), type: 'point', chKey, chLabel, sec: secLabel };
          points.push({ code, node: child, chKey, chLabel, sec: secLabel, id: str(child.id) });
        }
      });
    });
    return { map, byCode, points, chapters, secs, root };
  }
  Adapter.assignCodes = assignCodes;

  // ===== D1 输出：kaogang 扁平知识点（只取 point 级，点数 = stats.points）=====
  function flattenTree(codes) {
    return codes.points.map(p => {
      const node = p.node;
      const types = arr(node.questionTypes).map(mapType).filter(Boolean);
      // 细分概念/易混点/公式/特例：提示词允许每个知识点 0-3 个，之前整层丢弃＝丢细节
      const subs = arr(node.children)
        .filter(c => c && str(c.title))
        .map(c => ({ title: str(c.title), desc: str(c.desc) }));
      return {
        id: p.code,
        // text 保留（core.outlineFilter 的搜索/筛选依赖它），同时把结构化字段单列出来供细排版用
        text: str(node.title) + (node.desc ? ' — ' + str(node.desc) : ''),
        title: str(node.title),
        desc: str(node.desc),
        questionTypes: types,
        subs,
        type: types.length ? types.join(' / ') : '综合',
        sec: p.sec,
        chKey: p.chKey,
        chLabel: p.chLabel,
        hot: false,
        hasQuiz: false,
        qIds: []
      };
    });
  }
  Adapter.flattenTree = flattenTree;

  // ===== D6 source → 可读串（结构化对象另存 _trace，能力不降级）=====
  function srcOf(source) {
    const s = obj(source);
    if (!Object.keys(s).length) return '';
    const file = str(s.file);
    const page = s.page == null ? '' : (' p' + str(s.page));
    const anchor = str(s.anchor);
    const quote = str(s.quote);
    let out = file + (page ? ' ' + page : '');
    if (anchor) out += ' · ' + anchor;
    if (quote) out += '｜' + quote;
    return out;
  }
  Adapter.srcOf = srcOf;

  // ===== D3+D5：题面/答案分离 + 知识点关联 =====
  // 诚实边界：书馆 answer 是"答案+理由"长文本，不硬抽字母当 correct；
  //           因此 tikuAns 不含 correct/keys，Core.gradeOne 返回 null → 全部走自评，绝不伪造判分信号。
  function splitQuestions(analysis, codes) {
    const tiku = [], tikuAns = {}, byQuestion = {};
    let n = 0;
    arr(obj(analysis).questionIndex).forEach(group => {
      const g = obj(group);
      const gtype = mapType(g.type);
      arr(g.items).forEach(item => {
        arr(obj(item).questions).forEach(q => {
          if (!q || typeof q !== 'object') return;
          n++;
          const id = 'Q-' + n;
          // 先用 pointId 精确反查；查不到再用 pointPath 末段（节标题）反查——都不编造到 point 级
          let loc = codes.map[str(q.pointId)] || null;
          if (!loc) {
            const path = arr(q.pointPath).map(str);
            const tail = path.length ? path[path.length - 1] : '';
            for (const k in codes.map) {
              if (codes.map[k].type === 'section' && codes.map[k].sec === tail) { loc = codes.map[k]; break; }
            }
          }
          const chKey = loc ? loc.chKey : '';
          const chLabel = loc ? loc.chLabel : (str(arr(q.pointPath)[0]) || '未分章');
          const sec = loc ? loc.sec : (str(arr(q.pointPath)[1]) || '');
          const kp = loc ? loc.code : ''; // section 级编号，如实反映 pointId 层级
          const source = obj(q.source);
          const row = { id, ch: chKey, chKey, chLabel, sec, kp, type: gtype, stem: str(q.stem) };
          const opts = arr(q.options).map(str).filter(Boolean);
          if (opts.length) row.options = opts; // 无选项就不写这个键 → 走主观题 textarea
          tiku.push(row);
          const sol = arr(q.solution).map(str).filter(Boolean);
          const rationale = str(q.rationale);
          tikuAns[id] = {
            ans: str(q.answer),
            why: rationale || sol.join(' '),
            src: srcOf(source),
            solution: sol,
            rationale,
            pitfalls: str(q.pitfalls),
            difficulty: str(q.difficulty)
          };
          byQuestion[id] = {
            file: str(source.file),
            page: source.page == null ? null : source.page,
            anchor: str(source.anchor),
            quote: str(source.quote),
            quoteVerified: q.quoteVerified === true
          };
        });
      });
    });
    return { tiku, tikuAns, byQuestion };
  }
  Adapter.splitQuestions = splitQuestions;

  // ===== D5 回填：题 kp（如 1.1）命中考点 id（如 1.1.1）→ hasQuiz =====
  function linkKp(kaogang, tiku) {
    // 三向匹配，缺一不可（都是实测踩出来的）：
    //   ① k.id === kp      题正好挂在这个知识点
    //   ② k.id 以 kp+'.' 开头  题挂在更粗的节(3.1)，其下每个点(3.1.1)都要算命中
    //   ③ kp 以 k.id+'.' 开头  题挂在更细的点(3.1.1)，其祖先(3.1)也该把它算进来
    // 只做 ② 会漏掉"kp 恰好等于考点"；只做 ①② 会让大纲里"节"级条目显示 0 道题。
    const hit = (kid, c) => {
      kid = str(kid); c = str(c);
      if (!kid || !c) return false;
      return kid === c || kid.indexOf(c + '.') === 0 || c.indexOf(kid + '.') === 0;
    };
    arr(kaogang).forEach(k => {
      const ids = [];
      arr(tiku).forEach(q => { if (hit(k.id, q.kp)) ids.push(str(q.id)); });
      k.hasQuiz = ids.length > 0;
      k.qIds = ids;
    });
    return kaogang;
  }
  Adapter.linkKp = linkKp;

  // ===== D2 hot 映射：文件级 focus + 考纲 importance=高 → 知识点级 hot =====
  // byQuestion 提供 file→kp 的桥；两个来源取并集（书馆 D2 规则原文）
  function markHot(kaogang, opt) {
    const o = obj(opt);
    const focusFiles = arr(o.focusFiles);
    const focusNames = focusFiles.filter(f => f && obj(f).focus).map(f => str(obj(f).name || obj(f).file));
    const byQuestion = obj(o.byQuestion);
    const tiku = arr(o.tiku);
    const hotCodes = {};
    focusNames.forEach(name => {
      tiku.forEach(q => {
        const rec = byQuestion[q.id];
        if (rec && rec.file === name && q.kp) hotCodes[q.kp] = true;
      });
    });
    arr(o.highCodes).forEach(c => { if (c) hotCodes[str(c)] = true; });
    const list = Object.keys(hotCodes);
    arr(kaogang).forEach(k => {
      k.hot = list.some(c => k.id === c || str(k.id).indexOf(c + '.') === 0 || c.indexOf(str(k.id) + '.') === 0);
    });
    return kaogang;
  }
  Adapter.markHot = markHot;

  // ===== 从 analysis 真实题引用派生 section 级 quote =====
  // 书馆 questionIndex 的 pointId 指向 section，故引用只能如实挂到 section 级；
  // 该 section 下所有 point 共享这些真实引用，quoteVerified 取"全部命中才算命中"（宁严不冒）。
  function deriveQuotesBySection(analysis, codes) {
    const bySec = {};
    arr(obj(analysis).questionIndex).forEach(group => {
      arr(obj(group).items).forEach(item => {
        arr(obj(item).questions).forEach(q => {
          const loc = codes.map[str(obj(q).pointId)] || null;
          const secCode = loc ? loc.code : '';
          if (!secCode) return;
          const src = obj(q.source);
          const quote = str(src.quote);
          if (!quote) return;
          if (!bySec[secCode]) bySec[secCode] = [];
          bySec[secCode].push({
            quote,
            source: str(src.file) + (src.page == null ? '' : (' p' + str(src.page))),
            quoteVerified: q.quoteVerified === true
          });
        });
      });
    });
    return bySec;
  }
  Adapter.deriveQuotesBySection = deriveQuotesBySection;
  function sectionCodeOf(pointCode) { return str(pointCode).split('.').slice(0, 2).join('.'); }

  // ===== 考点大全 / 速通向：优先用书馆 documents 产物，缺失则从 analysis 真实引用派生 =====
  function adaptDigest(documents, codes, analysis) {
    const src = obj(obj(documents).digest);
    const rawSections = arr(src.sections);
    const sections = rawSections.length ? rawSections.map(sec => {
      const s = obj(sec);
      return {
        chapter: str(s.chapter || s.title),
        points: arr(s.points).map(p => {
          const q = obj(p);
          return {
            title: str(q.title), detail: str(q.detail),
            quote: str(q.quote), source: str(q.source),
            quoteVerified: q.quoteVerified === true
          };
        })
      };
    }) : (() => {
      const quotes = deriveQuotesBySection(analysis, codes);
      return codes.chapters.map(ch => ({
        chapter: ch.label,
        points: codes.points.filter(p => p.chKey === ch.code).map(p => {
          const qs = quotes[sectionCodeOf(p.code)] || [];
          return {
            title: str(p.node.title), detail: str(p.node.desc),
            quote: qs.map(x => x.quote).join(' ／ '),
            source: qs.map(x => x.source).join(' ／ '),
            quoteVerified: qs.length > 0 && qs.every(x => x.quoteVerified)
          };
        })
      }));
    })();
    return { sections, stats: obj(src.stats) };
  }
  Adapter.adaptDigest = adaptDigest;

  function adaptSyllabus(documents, codes, analysis) {
    const src = obj(obj(documents).syllabus);
    const rawSections = arr(src.sections);
    const sections = rawSections.length ? rawSections.map(sec => {
      const s = obj(sec);
      return {
        rank: s.rank == null ? 0 : s.rank,
        chapter: str(s.chapter || s.title),
        why: str(s.why),
        points: arr(s.points).map(p => {
          const q = obj(p);
          return {
            title: str(q.title), must: str(q.must), formulas: arr(q.formulas).map(str),
            importance: str(q.importance), question: str(q.question),
            quote: str(q.quote), source: str(q.source),
            quoteVerified: q.quoteVerified === true
          };
        })
      };
    }) : (() => {
      const quotes = deriveQuotesBySection(analysis, codes);
      // 按真实题分布排章：题多的章更"重要"，排在前面（书馆"从高到低"规则的数据侧落地）
      const chapQuiz = {};
      arr(obj(analysis).questionIndex).forEach(group => {
        arr(obj(group).items).forEach(item => {
          arr(obj(item).questions).forEach(q => {
            const loc = codes.map[str(obj(q).pointId)];
            if (loc) chapQuiz[loc.chKey] = (chapQuiz[loc.chKey] || 0) + 1;
          });
        });
      });
      const ordered = codes.chapters.slice().sort((a, b) =>
        (chapQuiz[b.code] || 0) - (chapQuiz[a.code] || 0) || (+a.code) - (+b.code));
      return ordered.map((ch, i) => ({
        rank: i + 1,
        chapter: ch.label,
        why: chapQuiz[ch.code] ? ('含 ' + chapQuiz[ch.code] + ' 道题覆盖，优先复习') : '',
        points: codes.points.filter(p => p.chKey === ch.code).map(p => {
          const qs = quotes[sectionCodeOf(p.code)] || [];
          return {
            title: str(p.node.title), must: str(p.node.desc), formulas: [],
            importance: '', question: '',
            quote: qs.map(x => x.quote).join(' ／ '),
            source: qs.map(x => x.source).join(' ／ '),
            quoteVerified: qs.length > 0 && qs.every(x => x.quoteVerified)
          };
        })
      }));
    })();
    // 书馆按重要性从高到低排（rank 升序）；降级产物按章序
    sections.sort((a, b) => (a.rank || 999) - (b.rank || 999));
    return { sections, stats: obj(src.stats) };
  }
  Adapter.adaptSyllabus = adaptSyllabus;

  // syllabus 的 importance=高 点 → 用标题反查编号（供 D2 hot 用）
  function highCodesFromSyllabus(syllabus, codes) {
    const byTitle = {};
    codes.points.forEach(p => { byTitle[str(p.node.title)] = p.code; });
    const out = [];
    arr(obj(syllabus).sections).forEach(sec => {
      arr(obj(sec).points).forEach(p => {
        const q = obj(p);
        if (/高/.test(str(q.importance))) {
          const code = byTitle[str(q.title)];
          if (code) out.push(code);
        }
      });
    });
    return out;
  }

  // ===== 总装：任何书馆产物 → 同一套 bookData =====
  function buildBookData(input) {
    const inp = obj(input);
    const analysis = obj(inp.analysis);
    const metaIn = obj(inp.meta);
    const documents = obj(inp.documents);
    const files = arr(inp.files);

    const codes = assignCodes(analysis.tree);
    const kaogang = flattenTree(codes);
    const split = splitQuestions(analysis, codes);
    linkKp(kaogang, split.tiku);

    const digest = adaptDigest(documents, codes, analysis);
    const syllabus = adaptSyllabus(documents, codes, analysis);
    const highCodes = highCodesFromSyllabus(documents.syllabus, codes);
    markHot(kaogang, {
      focusFiles: files, highCodes,
      byQuestion: split.byQuestion, tiku: split.tiku
    });

    const focusNotes = files.filter(f => f && obj(f).focus).map(f => ({
      name: str(obj(f).name || obj(f).file),
      note: str(obj(f).note)
    }));
    const meta = {
      id: str(metaIn.id || 'book'),
      title: str(metaIn.title || obj(analysis.tree).title || '未命名教材'),
      subject: str(metaIn.subject || '备考'),
      coverColor: str(metaIn.coverColor || '#2f6f4f'),
      accent: str(metaIn.accent || '#e8b04b'),
      syllabus: str(metaIn.syllabus || analysis.summary || ''),
      createdAt: str(metaIn.createdAt || new Date().toISOString().slice(0, 10)),
      source: '天道书阁',
      model: str(analysis.model || ''),
      summary: str(analysis.summary || ''),
      focusNotes
    };
    const refs = files.map(f => {
      const x = obj(f);
      return {
        name: str(x.name || x.file), type: str(x.type || 'txt'),
        file: str(x.file || x.name), focus: x.focus === true,
        note: str(x.note), isImage: x.isImage === true
      };
    });

    return {
      meta,
      kaogang,
      tiku: split.tiku,
      tikuAns: split.tikuAns,
      refs,
      digest,
      syllabus,
      mindmap: { tree: obj(analysis.tree) },
      _trace: {
        version: VERSION,
        quoteAudit: obj(analysis.quoteAudit),
        byQuestion: split.byQuestion,
        stats: obj(analysis.stats),
        // 保留原始 questionIndex（含每题 quoteVerified）：增量合并时靠它保住旧题与旧题的核验状态，
        // 不存这个字段，第二轮增量会把第一轮所有题静默丢掉——这是增量链路的命门。
        questionIndex: arr(analysis.questionIndex),
        // 诚实标注：源数据 pointId 只到 section，故派生引用粒度为 section（不是冒称 point 级）
        quoteGranularity: obj(documents.digest).sections ? 'document' : 'section-derived',
        codes: codes.map,
        byCode: codes.byCode
      }
    };
  }
  Adapter.buildBookData = buildBookData;

  // ===== 双导出 =====
  if (typeof module !== 'undefined' && module.exports) module.exports = Adapter;
  global.TiandaoAdapter = Adapter;
})(typeof window !== 'undefined' ? window : globalThis);
