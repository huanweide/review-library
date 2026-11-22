'use strict';
// 图片视觉理解（2026-11-20）：让模型**真的看图**，而不只是读图注。
//
// 为什么需要（用户原话）：「你也得要看懂这个有图是什么，因为你复现不出来图，但是看得懂啊，
//   跟题目放一起，不要看错了图与题目的对应」。
// 上一版配对靠图注双字重合度 + 模型读清单猜 id——图注恰好写对时看着准，图注缺失/误导/
// 多图相似时必错。真看图才能回答「这张图到底画了什么、哪道题非它不可」。
//
// 边界（不可让）：
//   1. 图字节原样，只用 base64 喂模型看，不重画不重编码不落盘；
//   2. cfg.apiKey 只在内存，绝不写进 images.json / 日志；
//   3. 看不懂 / 模型不支持 / 网络失败 → 诚实标 status，不编造图内容；
//   4. 幂等：已有 vision.ok 且不 force 就跳过，不重复烧 token。
const fs = require('fs');
const path = require('path');
const llm = require('../lib/llm');
const IMG = require('./images');

const VISION_SYSTEM = '你是学科资料看图助手。你把图里真正看得见的内容说清楚，不猜、不编。只输出一个 JSON 对象。';

function buildPrompt(rec, source) {
  const cap = (source && source.caption) ? '\n图注（仅供参考，可能与图不符，以你看到的为准）：' + source.caption : '';
  const ctx = (source && source.context) ? '\n上下文（仅供参考）：' + String(source.context).slice(0, 160) : '';
  return [
    '请仔细看这张图，然后只输出一个 JSON 对象：',
    '{"what":"这张图是什么（一句话，说清图的类型与主题）","details":"图里看得见的关键数据、标注、坐标、区间、数值（两三句，逐字按图上的写，看不清就说看不清）","forQuestions":"什么样的题目必须看这张图才能作答（一句话）"}',
    '要求：what/details 必须来自图里真正看得见的东西；图注和上下文只是参考，若与图矛盾以图为准；不要说「如图所示」这种空话；不要编造图里没有的数字。',
    cap, ctx,
  ].filter(Boolean).join('\n');
}

function toDataUrl(bookDir, rec) {
  const p = path.join(bookDir, rec.relPath);
  if (!fs.existsSync(p)) return null;
  const ext = String(rec.ext || '').toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/png';
  return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
}

// 对单张图跑一次视觉理解。返回 { ok, what, details, forQuestions, error?, model }。
// 只改内存里的 rec.vision，落盘由 describeBook 统一做（避免一张图一次全量写）。
async function describeOne(bookDir, rec, cfg, opts) {
  const o = opts || {};
  const url = toDataUrl(bookDir, rec);
  if (!url) return { ok: false, status: 'no_bytes', error: '图片字节不可读' };
  const source = (rec.sources || [])[0] || {};
  const messages = [
    { role: 'system', content: VISION_SYSTEM },
    { role: 'user', content: [
      { type: 'text', text: buildPrompt(rec, source) },
      { type: 'image_url', image_url: { url } },
    ] },
  ];
  // chatFn 可注入（判别测试用假模型验链路，真机用默认 llm.chat）
  const chatFn = typeof o.chat === 'function' ? o.chat : llm.chat;
  const raw = await chatFn(cfg, messages, {
    maxTokens: o.maxTokens || 500,
    temperature: 0.05,
    timeoutMs: o.timeoutMs || 60000,
  });
  // 容错抽 JSON：模型偶尔裹代码块或加说明，取第一个完整对象。
  const s = String(typeof raw === 'string' ? raw : (raw && raw.content) || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  let parsed = null;
  if (a >= 0 && b > a) { try { parsed = JSON.parse(s.slice(a, b + 1)); } catch (e) { /* 落到下方 */ } }
  if (!parsed) return { ok: true, status: 'unparsed', what: s.trim().slice(0, 200), details: '', forQuestions: '', model: cfg.model };
  return {
    ok: true, status: 'ok',
    what: String(parsed.what || '').trim().slice(0, 300),
    details: String(parsed.details || '').trim().slice(0, 900),
    forQuestions: String(parsed.forQuestions || '').trim().slice(0, 400),
    model: cfg.model,
    seenAt: new Date().toISOString(),
  };
}

// 给整本书的原图补视觉理解，写回 images.json。返回统计。
// cfg = { baseURL, model, apiKey }（apiKey 只在本次调用内存）。
async function describeBook(bookDir, cfg, opts) {
  const o = opts || {};
  const idx = IMG.loadIndex(bookDir);
  if (!idx.images.length) return { total: 0, done: 0, skipped: 0, failed: 0 };
  let done = 0, skipped = 0, failed = 0;
  for (const rec of idx.images) {
    if (!o.force && rec.vision && rec.vision.ok && rec.vision.status === 'ok') { skipped++; continue; }
    try {
      rec.vision = await describeOne(bookDir, rec, cfg, o);
      if (rec.vision.ok && rec.vision.status === 'ok') done++; else failed++;
    } catch (e) {
      // 失败不编造：明确记下原因，图本体与旧配对完全不受影响。
      rec.vision = {
        ok: false, status: 'error',
        error: String((e && e.message) || e).slice(0, 300),
        model: cfg && cfg.model,
        seenAt: new Date().toISOString(),
      };
      failed++;
    }
    IMG.saveIndex(bookDir, idx);   // 每图一写：中途失败也保留已看懂的，不白烧 token
  }
  return { total: idx.images.length, done, skipped, failed };
}

// 给分析提示词用：图的"真内容"优先，图注只作补充（避免模型被错图注带偏）。
// 无视觉理解时退回原来的图注/上下文清单，功能不中断。
function describeForPrompt(bookDir, limit) {
  const idx = IMG.loadIndex(bookDir);
  const cap = Number(limit) || 60;
  // 同字节多份图只喂「主图」，判据与前端兜底共用 images.primaryImages 单一真源：
  // 有图注 > PPT/Word 正文 > 独立文件；避免模型在等价 id 间随机挑、出处误指答题截图。
  return IMG.primaryImages(bookDir).slice(0, cap).map((img, i) => {
    const s = img.sources[0] || {};
    const where = s.pageType === 'slide' ? ('PPT 第 ' + s.page + ' 页')
      : s.pageType === 'paragraph' ? ('Word 第 ' + s.page + ' 段')
        : ('独立图片 ' + (s.fileName || s.part || ''));
    const v = img.vision;
    const core = (v && v.ok && v.status === 'ok')
      ? ['图里实际看到：' + v.what, v.details ? ('细节：' + v.details) : '',
         v.forQuestions ? ('什么题必须用这张图：' + v.forQuestions) : ''].filter(Boolean).join('；')
      : [s.caption ? '图注：' + s.caption : '', s.context ? '上下文：' + s.context.slice(0, 100) : ''].filter(Boolean).join('；');
    return [
      '【图' + (i + 1) + '｜id=' + img.id + '】',
      core,
      '出处：' + where + (img.sources.length > 1 ? '（另有 ' + (img.sources.length - 1) + ' 处相同原图）' : ''),
      (v && v.ok && v.status === 'ok') ? '（此图已由视觉模型看过）' : '（未做视觉理解，仅据图注，配对把握较低）',
    ].filter(Boolean).join('；');
  });
}

// ---------- 页级视觉转录（2026-11-22 · 理论力学全书拆解特化）----------
// 为什么：图片型 PDF（理论力学 24 份全中）文字层为空，整书语料只能来自视觉模型
// 逐页转录。转录（transcript）是「内容」域，与描述（vision）域严格分离：
//   rec.transcript = { ok, status, transcript, model, seenAt }  —— 語料级，进 getBookText
//   rec.vision     = { ok, what, details, forQuestions }          —— 描述级，进看图条
// 边界继承：图字节原样 base64，不重画不重编码；cfg 只在内存；失败诚实标 status 不编造；
// 已有 ok 转录不重复跑（断点续跑，中途失败已完成的保留）。
const TRANSCRIBE_SYSTEM = '你是理论力学课件的逐页转录员。把页面上的内容完整转录成文本：' +
  '①标题与正文文字逐字抄录；②公式用 LaTeX 写出（如 \\sum F=0）；' +
  '③插图（受力图/运动简图/示意图）用一段话描述画了什么（物体形状、约束类型、力的方向与符号、运动要素），不要试图画图；' +
  '④选择题/例题把题干与选项逐字抄全；⑤若页面主要是照片/截图拼贴（兴趣导入、工程实例展示，非题目非推导），只输出一段不超过 80 字的概述，说清有几张什么照片和页面标题，不要逐张展开；⑥看不清的字写「（此处模糊）」，图里没有的不要编。' +
  '只输出转录文本，不要解释、不要加「以下是转录」。';

// 对单张图跑一次视觉转录，返回 { ok, status, transcript, model, seenAt }（不落盘）。
async function transcribeOne(bookDir, rec, cfg, opts) {
  const o = opts || {};
  const url = toDataUrl(bookDir, rec);
  if (!url) return { ok: false, status: 'no_bytes', error: '图片字节不可读' };
  const messages = [
    { role: 'system', content: TRANSCRIBE_SYSTEM },
    { role: 'user', content: [
      { type: 'text', text: '请转录这一页图片的全部内容。' },
      { type: 'image_url', image_url: { url } },
    ] },
  ];
  const chatFn = typeof o.chat === 'function' ? o.chat : llm.chat;
  const raw = await chatFn(cfg, messages, {
    // 2026-11-22 实测：内容密集页（习题课/大推导）转录 1400 不够（25 张截断）→ 3200 仍有 13 张截断，
    // 最终 6000（≈9000 字，满页推导级）；max_tokens 是上限不是实耗，按实耗计费。
    maxTokens: o.maxTokens || 6000,
    temperature: 0.1,
    timeoutMs: o.timeoutMs || 90000,
  });
  const text = String(typeof raw === 'string' ? raw : (raw && raw.content) || '').trim();
  if (!text) return { ok: false, status: 'empty', error: '模型返回空文本' };
  return { ok: true, status: 'ok', transcript: text.slice(0, 6000), model: cfg && cfg.model, seenAt: new Date().toISOString() };
}

// 整本书的原图批量转录，写回 images.json。opts：
//   concurrency：并发数（默认 2）；limit：只转录前 N 张；force：重跑已有 ok 的；
//   onlyMissing 默认 true（断点续跑）；chat 可注入（判别测试）。
// 每张完成即 saveIndex：中途失败已完成的保留。worker 里的 saveIndex 是同步写，
// 在事件循环里天然串行，不会互相覆盖。
async function transcribeBook(bookDir, cfg, opts) {
  const o = opts || {};
  const idx = IMG.loadIndex(bookDir);
  const targets = idx.images.filter((rec) => {
    if (o.force) return true;
    const t = rec.transcript;
    return !(t && t.ok && t.status === 'ok');
  }).slice(0, Number(o.limit) > 0 ? Number(o.limit) : idx.images.length);
  const concurrency = Math.max(1, Math.min(16, Number(o.concurrency) || 2));
  let done = 0, failed = 0, skipped = idx.images.length - targets.length;
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const rec = targets[cursor++];
      let result;
      try {
        result = await transcribeOne(bookDir, rec, cfg, o);
      } catch (e) {
        result = { ok: false, status: 'error', error: String((e && e.message) || e).slice(0, 300), model: cfg && cfg.model, seenAt: new Date().toISOString() };
      }
      rec.transcript = result;
      if (result.ok && result.status === 'ok') done++; else failed++;
      IMG.saveIndex(bookDir, idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return { total: idx.images.length, done, skipped, failed, concurrency };
}

module.exports = { describeBook, describeOne, describeForPrompt, buildPrompt, VISION_SYSTEM, TRANSCRIBE_SYSTEM, transcribeOne, transcribeBook };
