// 复习总纲批量构建（2026-11-24）。
//
// 背景：考点大全（digest）/ 考纲（syllabus）/ 幻灯片（slides）三个页签收敛成一个
// 「复习总纲」（core/documents.js KINDS.review-guide）。总纲比单形态文档长得多
//（每章 framework + 十几条 points + problems + hooks），全书一次调用会被输出预算
// 截断（core/documents.js 2026-11-19 注记：16000 token 已见 sections 截断）。所以按章分批：
//   阶段一 1 次调用：全书语料 → 章列表 + 每章 framework（骨架小，不会截断）；
//   阶段二 N 次调用：每章一次，喂全书语料 + 本章骨架 → points/problems/hooks；
// 合并后用 documents.finish 一次收口（quote 逐字校验 / 占位词统计 / 字段截断），
// 与 compose 单次产物完全同构，落 documents/review-guide.json（原子写）。
//
// 复用（单一实现，不复制）：core/documents.js 的 KINDS['review-guide'].system（质量契约）
//   + BAD（占位词）+ finish（收口）+ bookList（资料清单注入）；core/analyze.js 的
//   composeCorpus / MAX_CORPUS / extractJson；cfg 同 build-assignment-cards.mjs（mergeCfg）。
//   语料与 server 同链路：new Core(root).getBookText(bookId)（含【文件：视觉转录·X】【页N】段）。
//
// 失败语义：骨架失败重试一次仍失败 → 退出不落盘；某章重试一次仍失败 → 退出不落盘，
// 绝不落半截总纲（半截比没有更害人）。
//
// 用法：node scripts/build-review-guide.mjs [--model deepseek-ai/DeepSeek-V4.1-Flash] [--dry] [--force]
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOK = '87763d2d14a660d0';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const MODEL = arg('model') || 'deepseek-ai/DeepSeek-V4.1-Flash';
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

const { mergeCfg } = require(ROOT + '/core/settings.js');
const llm = require(ROOT + '/lib/llm.js');
const { Core } = require(ROOT + '/core/index.js');
const docs = require(ROOT + '/core/documents.js');
const analyzeLib = require(ROOT + '/core/analyze.js');

const { KINDS, BAD, finish } = docs;

const outPath = path.join(ROOT, 'library', 'books', BOOK, 'documents', 'review-guide.json');
if (!FORCE && fs.existsSync(outPath)) {
  console.log('[review-guide] 已存在 ' + outPath + '（--force 重新生成）');
  process.exit(0);
}

const cfg = Object.assign(mergeCfg(ROOT + '/library', {}), { model: MODEL });
if (!cfg.apiKey) { console.error('没有可用密钥（环境变量 SILICONFLOW_API_KEY 或 settings.json）'); process.exit(1); }
console.log('[review-guide] model=' + MODEL + ' keySource=' + cfg.keySource);

// ---------- 语料：与 server composeDocument 完全同链路（getBookText 含视觉转录段） ----------
const core = new Core(ROOT + '/library');
const book = core.getBook(BOOK);
if (!book) { console.error('书不存在：' + BOOK); process.exit(1); }
const fullText = core.getBookText(BOOK);
const files = (book.files || []).map((f) => ({ name: f.name, isImage: !!f.isImage, focus: !!f.focus, note: String(f.note || '') }));
const corpus = analyzeLib.composeCorpus(fullText, analyzeLib.MAX_CORPUS).corpus;
if (!corpus.trim()) { console.error('全书语料为空（先跑视觉转录）'); process.exit(1); }
console.log('[review-guide] 书「' + book.title + '」语料 ' + corpus.length + ' 字 · 资料 ' + files.length + ' 份' + (DRY ? '（--dry，到此为止，不调模型）' : ''));
if (DRY) process.exit(0);

// ---------- 阶段一：章骨架（章列表 + framework） ----------
const OUTLINE_SYSTEM = `你是一位把整门课吃透的复习总纲编写专家。这是多阶段生成的第一步：只搭骨架，不写细节。
用户给你一整本书（若干资料拼接成的纯文本，含逐页视觉转录，段头【文件：视觉转录·X】、页锚点【页N】）。任务：通读全书，输出一份「复习总纲」的章节骨架。
规则：
1. 按课程知识大块组织章节（沿用书中篇/章结构，如 第一篇 静力学 / 第二篇 运动学 / 第三篇 动力学；绪论内容少时并入第一章或单独成章，由内容定）。每章就是一份能独立复习的复习卷；章数控制在 3~6 章，不许拆成几十个小节。
2. 每章 framework：3~6 条主干。每条一句话讲清「这条主线是什么、从哪推到哪」，让读者只看框架就能复述本章脉络。
3. 章名沿用书中名称；不写 points/problems/hooks（后续阶段按章分批生成）。
4. 严禁「（略）」「待补充」等占位省略。
只输出一个 JSON 对象：{"chapters":[{"chapter":"章名","framework":["…","…"]}]}`;

function badList(parsed) {
  const bad = [];
  const scan = (s) => { if (BAD.test(String(s || ''))) bad.push('「' + String(s).slice(0, 120) + '」'); };
  const secs = (parsed && (Array.isArray(parsed.chapters) ? parsed.chapters : Array.isArray(parsed.sections) ? parsed.sections : [])) || [];
  secs.forEach((s) => { scan(s && s.chapter); (s && Array.isArray(s.framework) ? s.framework : []).forEach(scan); });
  return bad;
}

async function chatOnce(messages, opts, tag) {
  const t0 = Date.now();
  const text = await llm.chat(cfg, messages, opts);
  console.log('[review-guide] ' + tag + ' 完成 ' + Math.round((Date.now() - t0) / 1000) + 's · 输出 ' + text.length + ' 字符');
  return text;
}
// 生成失败重试一次（额度/网络抖动多半一次就好；连败两次退出，不 tight loop）。
async function chatRetry(messages, opts, tag) {
  try { return await chatOnce(messages, opts, tag); }
  catch (e) {
    console.log('[review-guide] ' + tag + ' 失败（' + String(e.message || e).slice(0, 200) + '）→ 重试一次');
    return await chatOnce(messages, opts, tag + '#retry');
  }
}
// 占位词回喂重跑（复用 documents.compose 的同款思路）：命中 BAD 续跑一次只改违规条目，
// 取占位更少的版本；没命中原样返回。
async function chatClean(messages, opts, tag) {
  const text = await chatRetry(messages, opts, tag);
  let parsed = analyzeLib.extractJson(text);
  if (!parsed) return null;
  for (let round = 0; round < 1; round++) {
    const bad = badList(parsed);
    if (!bad.length) break;
    console.log('[review-guide] ' + tag + ' 占位词 ' + bad.length + ' 处 → 回喂重跑');
    let text2;
    try { text2 = await chatRetry(messages.concat([
      { role: 'assistant', content: text },
      { role: 'user', content: '【上一次输出里有占位/省略表述，本次必须消除】违规条目：\n' + bad.join('\n')
        + '\n\n请依据全书正文把这些条目改写成有真实内容的版本，并重新输出完整 JSON（契约不变，其余条目保持原样）。' },
    ]), Object.assign({}, opts, { temperature: 0.35 }), tag + '#badfix'); }
    catch (e) { console.log('[review-guide] ' + tag + ' 回喂重跑失败（保留首次结果）：' + String(e.message || e).slice(0, 160)); break; }
    const parsed2 = analyzeLib.extractJson(text2);
    if (parsed2 && badList(parsed2).length < bad.length) parsed = parsed2;
  }
  return parsed;
}

const outlineOpts = { maxTokens: 4000, timeoutMs: 300000, temperature: 0.2, responseFormat: 'json_object' };
const outline = await chatClean([
  { role: 'system', content: OUTLINE_SYSTEM },
  { role: 'user', content: '书名：' + book.title + '\n\n' + docs.bookList(files) + '\n\n【全书正文】\n' + corpus },
], outlineOpts, '骨架');
const chapters = (outline && Array.isArray(outline.chapters) ? outline.chapters : [])
  .filter((c) => c && String(c.chapter || '').trim());
if (!chapters.length) throw new Error('骨架输出缺 chapters（重试后仍失败），不落盘');
chapters.forEach((c) => {
  const n = Array.isArray(c.framework) ? c.framework.length : 0;
  if (n < 3 || n > 6) console.log('[review-guide] 警告：章「' + c.chapter + '」framework ' + n + ' 条（质量契约要求 3~6 条）');
});
console.log('[review-guide] 骨架：' + chapters.map((c) => c.chapter + '(' + (Array.isArray(c.framework) ? c.framework.length : 0) + ')').join(' / '));

// ---------- 阶段二：每章一次调用（points/problems/hooks） ----------
// system 复用 KINDS['review-guide'].system 全文质量契约，只把输出结构覆盖为「单章对象」。
const CHAPTER_SYSTEM = KINDS['review-guide'].system
  + '\n\n【本次调用只负责指定的这一章】章名与 framework 按用户消息里给定的写；输出结构改为单章对象 '
  + '{"chapter":"…","framework":[…],"points":[…],"problems":[…],"hooks":[…]}，不要输出其他章；'
  + '其余规则（字段、质量铁律、quote 逐字、禁占位、只依据语料）全部不变。';

const chapterOpts = { maxTokens: 16000, timeoutMs: 300000, temperature: 0.2, responseFormat: 'json_object' };
const sections = [];
for (const ch of chapters) {
  const chapter = String(ch.chapter || '').trim();
  const fw = Array.isArray(ch.framework) ? ch.framework : [];
  const parsedCh = await chatClean([
    { role: 'system', content: CHAPTER_SYSTEM },
    { role: 'user', content: '书名：' + book.title + '\n\n' + docs.bookList(files)
      + '\n\n本章：' + chapter + '\n本章知识框架（framework 原样保留输出）：\n' + fw.map((x) => '- ' + x).join('\n')
      + '\n\n【全书正文】\n' + corpus },
  ], chapterOpts, '章·' + chapter.slice(0, 14));
  if (!parsedCh || !Array.isArray(parsedCh.points) || !parsedCh.points.length) {
    throw new Error('章「' + chapter + '」输出缺 points（重试后仍失败），不落盘半截总纲');
  }
  parsedCh.chapter = chapter; // 以骨架章名为准，防模型中途改名
  sections.push(parsedCh);
  console.log('[review-guide] 章「' + chapter + '」points=' + parsedCh.points.length + ' problems=' + (Array.isArray(parsedCh.problems) ? parsedCh.problems.length : 0) + ' hooks=' + (Array.isArray(parsedCh.hooks) ? parsedCh.hooks.length : 0));
}

// ---------- 收口 + 原子落盘（结构与 compose 单次产物完全同构） ----------
const doc = finish({ kind: 'review-guide', title: book.title, parsed: { sections }, corpus, files, cfg });
doc.stats.outlineCalls = 1;
doc.stats.chapterCalls = sections.length;
doc.stats.generatedBy = 'scripts/build-review-guide.mjs';

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const tmp = outPath + '.' + process.pid + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
fs.renameSync(tmp, outPath);

console.log('[review-guide] 落盘 ' + outPath);
console.log('[review-guide] 统计：章 ' + doc.stats.sections + ' · points ' + doc.stats.points + ' · problems ' + doc.stats.problems + ' · hooks ' + doc.stats.hooks
  + ' · quote 已核 ' + doc.stats.quoteVerified + '/' + doc.stats.quoteTotal + ' · 占位词 ' + doc.stats.placeholderHits + ' 处'
  + (doc.stats.placeholderHits ? '（警告）' : ''));
