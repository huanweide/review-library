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
const BAD = /（略）|待补充|同上|此处省略|待定|xxx/i;

// 结构收口 + quote 逐字命中校验。宁可丢弃空条目，不造空壳。
function finish({ kind, title, parsed, corpus, files, cfg }) {
  const cNorm = norm(corpus);
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
  const corpus = analyzeLib.composeCorpus(String(fullText || ''), analyzeLib.MAX_CORPUS);
  const messages = [
    { role: 'system', content: spec.system },
    {
      role: 'user',
      content: '书名：' + String(title || '') + '\n\n' + bookList(files)
        + '\n\n【全书正文】\n' + corpus,
    },
  ];
  const text = await chat(cfg, messages, {
    maxTokens: maxTokens || 8000,
    timeoutMs: timeoutMs || 300000,
    temperature: 0.2,
    responseFormat: 'json_object',
  });
  const parsed = analyzeLib.extractJson(text);
  return finish({ kind, title, parsed, corpus, files, cfg });
}

module.exports = { compose, KINDS };
