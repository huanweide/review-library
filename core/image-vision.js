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

module.exports = { describeBook, describeOne, describeForPrompt, buildPrompt, VISION_SYSTEM };
