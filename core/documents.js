'use strict';
// 统一核心 · 整理文档生成（2026-11-14）：考点大全（digest）+ 考纲（syllabus）。
//
// 对应斯瑞的两条要求之二：「全篇幅、全链路的自动整理」——
//   (a) 考点大全：囊括全部考点的知识点汇总，能用原话就用原话（quote 逐字）。
//   (b) 考纲：按考试重要性从高到低排布的章式速通手册，出题与知识点混杂，
//       含自编例题与做法步骤；不含「可放弃」内容。
//
// 硬约束风格对齐 analyze.js：显式结构、禁占位省略、quote 逐字命中才标
// quoteVerified=true（未命中保留原文但如实标注，不谎称已核对）。
// 语料与 JSON 抽取复用 analyze.js 的 composeCorpus / extractJson（单一实现，不复制）。
const { chat } = require('../lib/llm');
const analyzeLib = require('./analyze');

const KINDS = {
  digest: {
    label: '考点大全',
    system: `你是一位严谨的考点整理专家。用户给你一整本书（若干资料拼接成的纯文本）。任务：把整本书整理成一份「考点大全」——囊括全书全部考点的知识点汇总。
铁律：
1. 不落下：书中每一个知识点、定义、公式、定理、例题都要收录；严禁「（略）」「待补充」「同上」「此处省略」等任何占位或省略，严禁只挑"经典考点"。
2. 能用原话就用原话：每个考点的 quote 字段从原文逐字抄 20~80 字支撑片段（保持原文用词与标点，不得改写、不得跨段拼接、不得编造）；找不到合适原文时 quote 留空字符串，并在 detail 里完整讲清。
3. detail 要完整：把该考点讲透（是什么、公式、怎么用、易错处），宁多勿少，一字不落。
4. 只输出一个 JSON 对象，结构：
{"sections":[{"chapter":"沿用书中章节名（如 第一章 xxx）","points":[{"title":"考点名","detail":"完整讲解","quote":"逐字原文","source":"原文件名"}]}]}
5. source 只能从【资料文件清单】里选真实文件名。`,
  },
  syllabus: {
    label: '考纲',
    system: `你是一位命题与考前速通专家。用户给你一整本书的纯文本。任务：整理成一份「考纲」——按考试重要性从高到低排布的速通手册，供考前快速过一遍，整体偏「考试速通」。
规则：
1. 以章为单位组织（沿用书中章节），最重要的章排最前；每章给 rank（从 1 开始的全局递增整数）和 why（这一章为什么重要，一句话）。
2. 每章 points 是按考试重要性排序的考点；must 为必背要点（结论/公式/口诀）；formulas 为该点涉及的公式或关键结论数组（没有则空数组）。
3. 出题与知识点的混杂：每个重要考点给一道自编示例题 question（{"stem":"…","answer":"…","steps":["第1步…","第2步…"]}），steps 一步一步说明怎么做；例题必须贴着本书内容出，不许编造书中没有的定理或数据。
4. 考纲不含「可以放弃」的内容——只收会考、大概率会考的内容；拿不准的宁可收录并把 importance 标为"中"。
5. 严禁占位与省略；quote 能逐字抄原文就抄（20~80 字），找不到就留空串。
6. source 只能从【资料文件清单】里选真实文件名。
只输出一个 JSON 对象：
{"sections":[{"rank":1,"chapter":"…","why":"…","points":[{"title":"…","must":"…","formulas":["…"],"importance":"高|中","question":{"stem":"…","answer":"…","steps":["…"]},"quote":"…","source":"…"}]}]}`,
  },
  slides: {
    label: '考点重要幻灯片',
    system: `你是一位复习资料幻灯片设计师。用户给你一整本书（若干资料拼接成的纯文本）。任务：把整本书整理成一套「考点重要幻灯片」——按书中章节组织的幻灯片序列，每页一个主题，便于速通复习与直接导出 PPT。
铁律：
1. **重要页优先收录**：先把资料里「真正的幻灯片页」挑出来——有图的、有公式的、有定义+例题的、老师标了重点/章节标题的页，优先成页；只有书名/目录/版权/空白的页不要收。宁可少几页干货，不要凑一页封面说明。
2. **按考点顺序排**：slides 的顺序按知识展开顺序（章→节→点），让相邻两页能前后接上；每页 title 里写清它属于哪一章哪一节，读者按顺序看就是一条复习线。
3. 不落下核心考点：覆盖全书主要章节；严禁占位省略（不得出现「（略）」「待补充」等）。
4. 每页 slides[i] 含 title（章节/主题名）与 bullets（要点数组）；重点、必背、公式、方法论用 mark=true 标出。
5. 每页 bullets 控制在 4~9 条，每条简明（一句话讲清一个考点 / 公式 / 易错点 / 做题方法）；能用原话就用原话。
6. 整份幻灯片页数依书体量而定（小书 6~10 页，大书 12~20 页），页与页之间不重复、不空泛。
7. source 只能从【资料文件清单】里选真实文件名（用于标注本页引用了哪份资料）。
只输出一个 JSON 对象：
{"slides":[{"title":"页标题（章节名）","source":"引用的资料文件名（可空串）","bullets":[{"text":"要点（可用原话）","mark":true}]}]}`,
  },
  'review-guide': {
    label: '复习总纲',
    // 2026-11-24 收敛：考点大全（digest）/ 考纲（syllabus）/ 幻灯片（slides）三页签合成一个
    // 「复习总纲」——按章输出一份完整复习卷，比直接翻课件更有条理、更扩展、更好记。
    system: `你是一位把整门课吃透的复习总纲编写专家。用户给你一整本书（若干资料拼接成的纯文本，含逐页视觉转录，段头【文件：视觉转录·X】、页锚点【页N】）。任务：写一份「复习总纲」——按章节顺序把全书知识梳理成一份完整的复习卷，比直接看课件更有条理、更扩展、更好记。
质量铁律（逐条执行，缺一即不合格）：
1. 按章节顺序组织：沿用书中章节名，章内小节跟随课件展开顺序，前后衔接成一条复习线，不跳跃、不重复、不遗漏整章。
2. 每章必须包含四块，一块不少：
   ① framework：本章知识框架 3~6 条主干。每条一句话讲清「这条主线是什么、从哪推到哪」，让读者只看框架就能复述本章脉络。
   ② points：细致知识点讲解数组，每个点含：
      - title：知识点名（跟课件术语一致，禁止用页码或「第X个」命名）；
      - detail：白话讲解（是什么+为什么+怎么用）。必须覆盖课件原文的全部要点，并在原文之上适度扩展——补直观理解、常见变式、与前后知识点的联系；要比课件讲得更透，不是复读原文；
      - exam：怎么考——题型+设问方式，写具体（如「计算题：给定物系求各构件约束反力，通常先整体后局部列平衡方程」），不写「会考」这种空话；
      - pitfall：最容易错在哪——写真实易错点（漏力、方向判断、符号约定、适用条件用错等），不写「要认真细心」；
      - quote：支撑本条的课件原句 10~60 字，逐字从语料抄（保持原文用词与标点，不得改写、不得跨段拼接、不得编造）；找不到合适原句就留空串；
      - page：出处页码（整数，取依据的【页N】的 N；没有明确依据页填 0）；
      - source：出处段名，照抄语料里【文件：视觉转录·X】的 X 或【文件：X】的 X，不要自己拼名字；
      - must：必背结论（公式/判定准则一句话），该点没有就留空串。
   ③ problems：本章典型题型与解题路径 1~3 条。每条 type=题型名，steps=解题路径数组，第 1 步做什么、第 2 步做什么……每步一个可执行的动作，学生能照着做。
   ④ hooks：记忆钩子/口诀 1~2 条字符串。要有画面、押韵或结构化（如「先取整体求反力，再拆构件列方程」），不写「认真复习」式废话。
3. 细致完整：细到零基础学生拿着总纲不用翻课件也能复习；严禁「（略）」「待补充」「同上」「此处省略」等任何占位或省略。
4. 只依据语料：source/page 只写真实依据，语料里没有的段名、页码不许编。
只输出一个 JSON 对象，结构：
{"sections":[{"chapter":"章名","framework":["…"],"points":[{"title":"…","detail":"…","exam":"…","pitfall":"…","quote":"…","page":1,"source":"…","must":"…"}],"problems":[{"type":"…","steps":["…"]}],"hooks":["…"]}]}`,
  },
};

// 用户可见的资料清单：含语义重点（★）与一句话说明——「不手动分层」的落点。
function bookList(files) {
  const arr = Array.isArray(files) ? files : [];
  if (!arr.length) return '【资料文件清单】-（未登记文件名）';
  return '【资料文件清单】（source 只能从这里选；标【用户重点★】的是用户指定的核心，整理时优先围绕它们展开）\n'
    + arr.map((f) => '- ' + String(f.name || '')
      + (f.isImage ? '（图片资料，正文不包含其内容）' : '')
      + (f.focus ? '【用户重点★】' : '')
      + (f.note ? '（用户说明：' + f.note + '）' : '')).join('\n');
}

function norm(s) { return String(s || '').replace(/\s+/g, ''); }

// 模型字段统一字符串化：字符串照用；对象/数组转 JSON（可审、不显示 [object Object]）；其余置空。
function toStr(v, max) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim().slice(0, max);
  try { const j = JSON.stringify(v); return j === undefined ? '' : j.slice(0, max); } catch (e) { return ''; }
}
const BAD = /（略）|待补充|同上|此处省略|此处填|此处为|待定|xxx/i;

// 结构收口 + quote 逐字命中校验。宁可丢弃空条目，不造空壳。
function finish({ kind, title, parsed, corpus, files, cfg }) {
  const cNorm = norm(corpus);

  // ---- slides：考点重要幻灯片（与 digest/syllabus 同源协议的第三种形态）----
  if (kind === 'slides') {
    const slides = Array.isArray(parsed && parsed.slides) ? parsed.slides : [];    if (!slides.length) throw new Error('模型输出缺 slides：整理失败，请重试或换模型');
    let placeholder = 0, markCount = 0;
    const outSlides = slides.map((sl) => {
      const bullets = Array.isArray(sl && sl.bullets) ? sl.bullets : [];
      return {
        title: toStr(sl && sl.title, 80),
        source: toStr(sl && sl.source, 120),
        bullets: bullets.map((b) => {
          const t = toStr(b && b.text, 300);
          if (BAD.test(t)) placeholder++;
          if (b && b.mark) markCount++;
          return { text: t, mark: !!(b && b.mark) };
        }).filter((b) => b.text),
      };
    }).filter((sl) => sl.title);
    const kept = outSlides.reduce((n, s) => n + s.bullets.length, 0);
    if (!kept) throw new Error('模型输出没有有效幻灯片要点，请重试或换模型');
    return {
      kind, label: KINDS[kind].label, bookTitle: String(title || ''),
      generatedAt: new Date().toISOString(), model: String((cfg && cfg.model) || ''),
      slides: outSlides,
      stats: { slides: outSlides.length, bullets: kept, markCount, placeholderHits: placeholder },
    };
  }

  // ---- review-guide：复习总纲（2026-11-24：framework + points + problems + hooks 四块结构）----
  if (kind === 'review-guide') {
    const sections = Array.isArray(parsed && parsed.sections) ? parsed.sections : [];
    if (!sections.length) throw new Error('模型输出缺 sections：整理失败，请重试或换模型');
    let total = 0, verified = 0, placeholder = 0, problems = 0, hooks = 0;
    const outSections = sections.map((s) => {
      const fw = Array.isArray(s && s.framework) ? s.framework.map((x) => toStr(x, 300)).filter(Boolean) : [];
      fw.forEach((x) => { if (BAD.test(x)) placeholder++; });
      const pts = Array.isArray(s && s.points) ? s.points : [];
      const probs = Array.isArray(s && s.problems) ? s.problems : [];
      const hks = Array.isArray(s && s.hooks) ? s.hooks : [];
      return {
        chapter: toStr(s && s.chapter, 80),
        framework: fw,
        points: pts.map((p) => {
          total++;
          const o = {
            title: toStr(p && p.title, 120),
            detail: toStr(p && p.detail, 4000),
            exam: toStr(p && p.exam, 600),
            pitfall: toStr(p && p.pitfall, 600),
            quote: toStr(p && p.quote, 400),
            page: Number(p && p.page) || 0,
            source: toStr(p && p.source, 120),
            must: toStr(p && p.must, 600),
          };
          if (o.quote && cNorm.includes(norm(o.quote))) { o.quoteVerified = true; verified++; }
          else o.quoteVerified = false;
          [o.title, o.detail, o.exam, o.pitfall, o.must].forEach((x) => { if (x && BAD.test(x)) placeholder++; });
          return o;
        }).filter((p) => p.title && p.detail),
        problems: probs.map((pb) => {
          problems++;
          const o = {
            type: toStr(pb && pb.type, 80),
            steps: Array.isArray(pb && pb.steps) ? pb.steps.map((x) => toStr(x, 500)).filter(Boolean).slice(0, 10) : [],
          };
          if (o.type && BAD.test(o.type)) placeholder++;
          o.steps.forEach((x) => { if (BAD.test(x)) placeholder++; });
          return o;
        }).filter((pb) => pb.type),
        hooks: hks.map((x) => toStr(x, 300)).filter(Boolean),
      };
    }).filter((s) => s.chapter);
    outSections.forEach((s) => { hooks += s.hooks.length; });
    const kept = outSections.reduce((n, s) => n + s.points.length, 0);
    if (!kept) throw new Error('模型输出没有有效知识点条目，请重试或换模型');
    return {
      kind, label: KINDS[kind].label, bookTitle: String(title || ''),
      generatedAt: new Date().toISOString(), model: String((cfg && cfg.model) || ''),
      sections: outSections,
      stats: {
        sections: outSections.length,
        points: kept,
        problems,
        hooks,
        quoteTotal: total,
        quoteVerified: verified,
        placeholderHits: placeholder,
      },
    };
  }

  // ---- digest / syllabus ----
  const sections = Array.isArray(parsed && parsed.sections) ? parsed.sections : [];
  if (!sections.length) throw new Error('模型输出缺 sections：整理失败，请重试或换模型');
  let total = 0, verified = 0, placeholder = 0;
  const outSections = sections.map((s) => {
    const pts = Array.isArray(s && s.points) ? s.points : [];
    return {
      rank: Number(s && s.rank) || 0,
      chapter: toStr(s && s.chapter, 80),
      why: toStr(s && s.why, 200),
      points: pts.map((p) => {
        total++;
        const o = {
          title: toStr(p && p.title, 120),
          detail: toStr(p && (p.detail || p.must), 2000),
          quote: toStr(p && p.quote, 400),
          source: toStr(p && p.source, 120),
        };
        if (p && p.must != null) o.must = toStr(p.must, 600);
        if (Array.isArray(p && p.formulas)) o.formulas = p.formulas.map((x) => toStr(x, 200)).filter(Boolean).slice(0, 8);
        if (p && p.importance) o.importance = String(p.importance).slice(0, 10);
        if (p && p.question && typeof p.question === 'object') {
          o.question = {
            stem: toStr(p.question.stem, 500),
            answer: toStr(p.question.answer, 500),
            steps: Array.isArray(p.question.steps) ? p.question.steps.map((x) => toStr(x, 300)).filter(Boolean).slice(0, 8) : [],
          };
        }
        if (o.quote && cNorm.includes(norm(o.quote))) { o.quoteVerified = true; verified++; }
        else o.quoteVerified = false;
        if (BAD.test(o.title) || BAD.test(o.detail)) placeholder++;
        return o;
      }).filter((p) => p.title),
    };
  }).filter((s) => s.chapter);
  const kept = outSections.reduce((n, s) => n + s.points.length, 0);
  if (!kept) throw new Error('模型输出没有有效考点条目，请重试或换模型');
  return {
    kind,
    label: KINDS[kind].label,
    bookTitle: String(title || ''),
    generatedAt: new Date().toISOString(),
    model: String((cfg && cfg.model) || ''),
    sections: outSections,
    stats: {
      sections: outSections.length,
      points: kept,
      quoteTotal: total,
      quoteVerified: verified,
      placeholderHits: placeholder,
    },
  };
}

// kind: 'digest'（考点大全）| 'syllabus'（考纲）。cfg = { baseURL, apiKey, model }。
async function compose({ title, fullText, files, kind, cfg, maxTokens, timeoutMs }) {
  const spec = KINDS[kind];
  if (!spec) throw new Error('未知文档类型：' + kind + '（可用 digest=考点大全 / syllabus=考纲）');
  if (!cfg || !cfg.baseURL || !cfg.model) throw new Error('生成' + spec.label + '需要模型配置（API 地址 + 模型名）');
  const corpus = analyzeLib.composeCorpus(String(fullText || ''), analyzeLib.MAX_CORPUS).corpus;
  const messages = [
    { role: 'system', content: spec.system },
    {
      role: 'user',
      content: '书名：' + String(title || '') + '\n\n' + bookList(files)
        + '\n\n【全书正文】\n' + corpus,
    },
  ];
  const text = await chat(cfg, messages, {
    // 默认 16000：2026-11-19 真机实测（6 份资料 / DeepSeek-V4.1-Flash）
    // 8000 → "模型输出缺 sections"（JSON 被预算截断但 finish_reason 未报 length，
    // lib/llm.js 的截断检测漏过）；16000 → 成功产出 sections。生成按需触发，成本可接受。
    maxTokens: maxTokens || (kind === 'review-guide' ? 32000 : 16000),
    timeoutMs: timeoutMs || 300000,
    temperature: 0.2,
    responseFormat: 'json_object',
  });
  const parsed = analyzeLib.extractJson(text);
  const first = finish({ kind, title, parsed, corpus, files, cfg });

  // 占位词回喂重跑（2026-11-23）：命中占位/省略表述时，不在 UI 只报警告，
  // 同对话续跑一次让模型只重写违规条目（其余页保持），取占位更少的版本。
  if (first.stats.placeholderHits > 0) {
    const bad = [];
    const scan = (s) => { if (BAD.test(s)) bad.push('「' + String(s).slice(0, 120) + '」'); };
    (first.slides || []).forEach((sl) => { scan(sl.title); (sl.bullets || []).forEach((b) => scan(b.text)); });
    (first.sections || []).forEach((sec) => {
      scan(sec.chapter);
      (sec.framework || []).forEach(scan);
      (sec.points || []).forEach((p) => { scan(p.title); scan(p.detail); scan(p.exam); scan(p.pitfall); scan(p.must); });
      (sec.problems || []).forEach((pb) => { scan(pb.type); (pb.steps || []).forEach(scan); });
      (sec.hooks || []).forEach(scan);
    });
    if (bad.length) {
      try {
        const text2 = await chat(cfg, messages.concat([
          { role: 'assistant', content: text },
          { role: 'user', content: '【上一次输出里有占位/省略表述，本次必须消除】违规条目：\n' + bad.join('\n')
            + '\n\n请依据全书正文把这些条目改写成有真实内容的版本，并重新输出完整 JSON（契约不变，其余条目保持原样）。' },
        ]), {
          maxTokens: maxTokens || (kind === 'review-guide' ? 32000 : 16000),
          timeoutMs: timeoutMs || 300000,
          temperature: 0.35,
          responseFormat: 'json_object',
        });
        const parsed2 = analyzeLib.extractJson(text2);
        if (parsed2) {
          const second = finish({ kind, title, parsed: parsed2, corpus, files, cfg });
          if (second.stats.placeholderHits < first.stats.placeholderHits) return second;
        }
      } catch (e) { /* 重跑失败不拖垮首次产出，保留首次结果与 placeholderHits 警告 */ }
    }
  }
  return first;
}

// BAD 占位词表与 finish 收口同时给批量构建脚本复用（scripts/build-review-guide.mjs：
// 分批生成后把各章原样收进 sections，最后 finish({kind:'review-guide',...}) 一次收口，
// 保证产物结构与 compose 单次输出完全同构）。
module.exports = { compose, KINDS, BAD, finish, bookList };
