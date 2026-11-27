// 作业题卡批量构建（2026-11-23）。
//
// 背景：17 讲题卡（v1.6.5 批建，cards/lesson-NN.json）只覆盖课件；课后作业 5 份
//（SRC/作业题目PDF/manifest.json）此前没进题卡链路。本脚本把作业页图语料
// 整理成独立作业卡 cards/assignment-NN.json（lessonNo=100+seq，聚合时排在讲卡之后），
// 不动已验收的 17 份讲卡。
//
// 语料链路（与 build-lesson-cards 同源同套路）：
//   - 页图已 ingest（context=原始图片_作业）且已视觉转录（Qwen3-VL-8B），sha 去重直接拿 id；
//   - 若出现新图（added>0）才补跑视觉转录；
//   - 作业 → 讲次对位写进 doc.lessonRef（数据可用，不驱动结构）。
//
// 复用 build-lesson-cards 的三条硬规则 + 程序自检 + 违规重试一次。
//
// 用法：node scripts/build-assignment-cards.mjs --assignments 1,2,3,4,5
//       [--model deepseek-ai/DeepSeek-V4.1-Flash] [--dry] [--force]
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'C:/Users/Administrator/Desktop/agent program/雨课堂_理论力学';
const BOOK = '87763d2d14a660d0';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const ASSIGNS = String(arg('assignments') || arg('assignment') || '').split(',').map(Number).filter(Boolean);
const MODEL = arg('model') || 'deepseek-ai/DeepSeek-V4.1-Flash';
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
if (!ASSIGNS.length) { console.error('缺少 --assignments'); process.exit(1); }

const { mergeCfg } = require(ROOT + '/core/settings.js');
const llm = require(ROOT + '/lib/llm.js');
const IMG = require(ROOT + '/core/images.js');
const vision = require(ROOT + '/core/image-vision.js');
const { collectImageIds } = require(ROOT + '/core/analyze.js');

const bookDir = ROOT + '/library/books/' + BOOK;
const cardsDir = path.join(bookDir, 'cards');
fs.mkdirSync(cardsDir, { recursive: true });

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function writeJsonAtomic(p, obj) {
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

// ---------- manifest 对位 ----------
const hwManifest = readJson(SRC + '/作业题目PDF/manifest.json', []);
function resolveAssignment(n) {
  return hwManifest.find(m => m.seq === n)
    || hwManifest.find(m => Number(String(m.title).match(/^(\d+)/)?.[1]) === n) || null;
}

// 作业 → 讲次对位（按主题人工判读，只写数据不驱动结构）：
// 1次受力分析→第2讲；2次平衡方程→第3、4讲；3次刚体基本运动→第7讲；
// 4次点的合成运动→第8、9、10讲；5次刚体平面运动→第11、12、13讲。
const LESSON_REF = { 1: [2], 2: [3, 4], 3: [7], 4: [8, 9, 10], 5: [11, 12, 13] };

// ---------- 作业页图 ensure（sha 去重；已在库的 27 张直接拿 id） ----------
function ensureAssignmentImages(seq, title) {
  const srcDir = SRC + '/原始图片_作业';
  if (!fs.existsSync(srcDir)) return { added: 0, mapping: [], sub: '' };
  const sub = fs.readdirSync(srcDir).find(d => d.endsWith('_' + title) || d === title);
  if (!sub) return { added: 0, mapping: [], sub: '' };
  const bySha = new Map(IMG.loadIndex(bookDir).images.map(x => [x.sha256, x]));
  const mapping = [];
  let added = 0;
  for (const f of fs.readdirSync(srcDir + '/' + sub).filter(f => /\.(jpe?g|png)$/i.test(f)).sort()) {
    const buf = fs.readFileSync(srcDir + '/' + sub + '/' + f);
    const pageNo = Number(f.match(/^0*(\d+)\./)?.[1]) || 0;
    const sha = IMG.sha(buf);
    let rec = bySha.get(sha);
    if (!rec) {
      const r = IMG.ingest(bookDir, 'img-assignment', '作业·' + title + ' 第' + pageNo + '页', path.extname(f).slice(1).toLowerCase(), buf, {
        relPath: '', size: buf.length,
        page: pageNo, context: '原始图片_作业', caption: '作业｜' + title + '｜第 ' + pageNo + ' 页',
      });
      if (r.added && r.records[0]) { rec = r.records[0]; added++; }
    }
    if (rec) {
      const cs = rec.sources[0] || {};
      mapping.push({ hwPage: Number(cs.page) || pageNo, imageId: rec.id });
    }
  }
  return { added, mapping, sub };
}

// ---------- 批次语料（作业行：context=原始图片_作业，目录名对位） ----------
function buildCorpusHW(rows, sub, title) {
  const hit = rows.filter(r => {
    const c = String(r.source.context || '');
    if (c !== '原始图片_作业') return false;
    const fn = String(r.source.fileName || '');
    const dir = fn.slice(0, fn.lastIndexOf(' 第'));
    return dir === sub || dir.endsWith('_' + title);
  });
  if (!hit.length) return '';
  return '【文件：作业·' + title + '】\n' + hit.map(r => '【页' + (r.source.page || 1) + '】（图id=' + r.img.id + '）' + r.text).join('\n');
}

// ---------- prompt（作业版：三条硬规则原样，抽取口径改为作业逐题） ----------
const SYSTEM = `你是理论力学备考题卡整理员。输入是某一次课后作业全部页面的视觉转录，块格式为【页N】（图id=xxx）转录文本。
任务：把作业里的每道题整理成题卡，按考点归组。只依据给定转录，禁止编造转录里没有的题、数据或图 id。

【题干硬规则（违反 = 输出无效）】
- 每道题的 stem 必须把页面上/图上的已知量写全：构件名称、长度数值、角度数值、转向（顺时针/逆时针）、已知速度或角速度数值。这些信息就在转录文本里，逐字提取后组织成完整题干。
- 严禁出现「题面见图」「如图所示」「见上图」「（题面见图）」等任何让读者另去看图的占位表述——题干必须脱离原图也能完整作答。
- 转录里没有数值的题（纯作图/概念题），题干写清定性条件与所求，该卡标 needsReview=true、confidence=low，不许编造数值。

【答案与解析硬规则】
- answer 必须给出最终结论：含数值、方向（如「水平向左」「逆时针」）、单位；禁止只复述公式或定理。作业转录里若给了参考答案或最终结果，必须如实采用。
- solution 3-6 步，每步先写公式、再把转录里的具体数字代入（必须出现等号，如 ω_AB = v_A/AC = Rω/(3R) = ω/3）。
- 转录里没给数值就符号推导，并在该卡标 needsReview=true、confidence=low。

【知识点规则】
- 1-4 个知识点，按本题考点命名（如「光滑接触面约束反力」「速度瞬心的确定」），禁止用作业页码命名；每个归入 block（只能选：静力学/运动学/动力学）。
- 每个知识点 summary 2-4 句：自己的话、能直接背、零基础能懂；覆盖「是什么、怎么考、最容易错在哪」。

【输出契约】只输出一个单行紧凑 JSON 对象（禁止换行/缩进/markdown/代码块），结构：
{"lessonNo":讲次,"title":"作业名","block":"本卷主块","knowledgePoints":[{"name":"...","block":"静力学","summary":"...","cards":[{"stem":"...","imageIds":["图id"],"answer":"...","solution":["..."],"type":"计算题","tag":"...","source":{"page":N,"kind":"assignment","quote":"页面转录原句10-60字"}}]}]}
type 只能选：选择题/填空题/名词解释/简答题/判断题/计算题/综合应用题。imageIds 只能填转录里（图id=xxx）出现过的 id；带图的题必须填。`;

function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) { esc = false; continue; } if (ch === '\\') { esc = true; continue; } if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(a, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}

const TYPES = ['选择题', '填空题', '名词解释', '简答题', '判断题', '计算题', '综合应用题'];
const BLOCKS = ['静力学', '运动学', '动力学'];
const ESCAPE_RE = /(题面见图|如图所示|见上图|见下图|如图|见图)/;

function validateCards(parsed, corpus, knownIds, meta) {
  if (!parsed || !Array.isArray(parsed.knowledgePoints)) throw new Error('输出缺 knowledgePoints');
  const nc = norm(corpus);
  let cardSeq = 0, badQuote = 0, badImg = 0;
  const kps = parsed.knowledgePoints.map((kp, i) => ({
    id: 'kp-' + meta.key + '-' + (i + 1),
    name: String(kp.name || '').trim().slice(0, 60) || ('知识点' + (i + 1)),
    block: BLOCKS.includes(kp.block) ? kp.block : meta.block,
    summary: String(kp.summary || '').trim().slice(0, 1200),
    cards: (Array.isArray(kp.cards) ? kp.cards : []).map(c => {
      cardSeq++;
      const rawIds = Array.isArray(c.imageIds) ? c.imageIds.map(String) : [];
      const imageIds = rawIds.filter(id => knownIds.has(id));
      badImg += rawIds.length - imageIds.length;
      const quote = String(c.source && c.source.quote || '').trim();
      const hit = norm(quote).length >= 8 && nc.includes(norm(quote));
      if (quote && !hit) badQuote++;
      return {
        id: 'c-' + meta.key + '-' + String(cardSeq).padStart(2, '0'),
        type: TYPES.includes(c.type) ? c.type : '综合应用题',
        tag: String(c.tag || '').trim().slice(0, 20),
        stem: String(c.stem || '').trim().slice(0, 2000),
        imageIds,
        answer: String(c.answer || '').trim().slice(0, 3000),
        solution: Array.isArray(c.solution) ? c.solution.map(x => String(x || '').trim().slice(0, 500)).filter(Boolean).slice(0, 6) : [],
        source: {
          lesson: meta.lessonNo, kind: 'assignment',
          pdf: meta.assignmentPdf,
          page: Number(c.source && c.source.page) || 0,
          quote: quote.slice(0, 200), quoteVerified: !!hit,
        },
        needsReview: !!c.needsReview,
        confidence: c.confidence === 'low' ? 'low' : (c.needsReview ? 'low' : 'high'),
        origin: hit ? 'material' : 'model',
      };
    }).filter(c => c.stem && c.answer),
  })).filter(kp => kp.summary || kp.cards.length);
  return { kps, cardSeq, badQuote, badImg };
}

function norm(s) {
  return String(s || '').replace(/\s+/g, '').replace(/[，。、；：“”‘’（）()【】\[\],.;:!?\-—_]/g, '');
}

// 三条自检（与用户验收口径一致，与 build-lesson-cards 同款）
function checkCards(doc) {
  const violations = [];
  const cards = [];
  doc.knowledgePoints.forEach(kp => kp.cards.forEach(c => cards.push(c)));
  for (const c of cards) {
    const all = [c.stem, c.answer, (c.solution || []).join(' ')].join(' ');
    if (ESCAPE_RE.test(all)) violations.push(c.id + ':题干含占位表述');
    if ((c.answer || '').length < 30) violations.push(c.id + ':answer不足30字');
    if ((c.type === '计算题' || c.type === '综合应用题')) {
      const eqLines = (c.solution || []).filter(s => /=/.test(s)).length;
      if (eqLines < 2) violations.push(c.id + ':解析等号代入不足2处');
    }
  }
  return violations;
}

// ---------- cfg ----------
const cfg = Object.assign(mergeCfg(ROOT + '/library', {}), { model: MODEL });
if (!cfg.apiKey) { console.error('没有可用密钥'); process.exit(1); }
console.log('[assignment-cards] model=' + MODEL + ' keySource=' + cfg.keySource + ' assignments=' + ASSIGNS.join(','));

const failed = readJson(cardsDir + '/failed.json', []);
let doneCount = 0;

for (const n of ASSIGNS) {
  const outPath = cardsDir + '/assignment-' + String(100 + n) + '.json';
  if (!FORCE && fs.existsSync(outPath)) { console.log('SKIP assignment ' + n + '（已落盘 ' + path.basename(outPath) + '）'); continue; }

  const m = resolveAssignment(n);
  if (!m) { console.error('FAIL assignment ' + n + ': manifest 找不到'); failed.push({ time: new Date().toISOString(), assignment: n, error: 'manifest 找不到' }); continue; }
  if ((m.pages_in_pdf || 0) === 0) { console.log('SKIP assignment ' + n + '（' + String(m.title) + ' 0 页）'); continue; }
  const title = String(m.title);
  const lessonNo = 100 + n;
  const key = 'a' + String(n).padStart(2, '0');
  const t0 = Date.now();
  const blockGuess = /受力分析|平衡|静力|力系/.test(title) ? '静力学' : (/动力学/.test(title) ? '动力学' : '运动学');
  const meta = { key, lessonNo, block: blockGuess, title, assignmentPdf: path.basename(String(m.pdf || '')) };
  const lessonRef = LESSON_REF[n] || [];

  try {
    const ens = ensureAssignmentImages(n, title);
    if (!ens.mapping.length) throw new Error('作业页图不在库（目录对位失败：' + title + '）');
    if (ens.added > 0) {
      const vcfg = Object.assign({}, cfg, { model: 'Qwen/Qwen3-VL-8B-Instruct' });
      await vision.transcribeBook(bookDir, vcfg, { concurrency: 3, timeoutMs: 120000 });
    }
    const rowsNow = IMG.orderedTranscribed(bookDir);
    const corpus = buildCorpusHW(rowsNow, ens.sub, title);
    if (!corpus || corpus.length < 100) throw new Error('批次语料为空（转录缺失：' + title + '）');
    const knownIds = new Set(collectImageIds(corpus));

    const runOnce = async (extraNote) => {
      const raw = await llm.chat(cfg, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: '本次作业=' + title + '，作业序号=' + n + '，对应讲次=' + lessonRef.join('、') + '，默认 block=' + blockGuess +
          (extraNote ? '\n\n【上一次输出的违规项，本次必须修正】\n' + extraNote : '') + '\n\n' + corpus },
      ], { maxTokens: Math.min(16000, 5000 + Math.round(corpus.length / 5)), temperature: extraNote ? 0.35 : 0.2, timeoutMs: 420000, responseFormat: 'json_object' });
      return extractJson(raw);
    };

    if (DRY) { console.log('DRY assignment ' + n + '（' + title + '）: 页图 ' + ens.mapping.length + ' 张、语料 ' + corpus.length + ' 字、语料内图 ' + knownIds.size + ' 张 —— 跳过模型'); doneCount++; continue; }

    let parsed = await runOnce(null);
    if (!parsed) {
      parsed = await runOnce('上一次输出不是可解析的 JSON，请重新输出完整单行 JSON。');
    }
    if (!parsed) throw new Error('模型输出两次均不可解析');

    const { kps, cardSeq, badQuote, badImg } = validateCards(parsed, corpus, knownIds, meta);
    let doc = {
      book: BOOK, lesson: lessonNo, lessonNo, seq: m.seq, title, date: m.date || '',
      kind: 'assignment', lessonRef,
      block: parsed.block && BLOCKS.includes(parsed.block) ? parsed.block : blockGuess,
      sourcePdf: { assignment: meta.assignmentPdf },
      stats: { hwPages: ens.mapping.length, knowledgePoints: kps.length, cards: cardSeq, badQuote, badImg },
      generatedAt: new Date().toISOString(), model: MODEL,
      knowledgePoints: kps,
    };

    // 三条自检 + 一次重试
    let violations = DRY ? [] : checkCards(doc);
    if (violations.length) {
      console.log('  [retry] assignment ' + n + ' 自检违规 ' + violations.length + ' 项：' + violations.slice(0, 5).join('；') + ' —— 重试一次');
      const parsed2 = await runOnce(violations.join('\n'));
      if (parsed2) {
        const v2 = validateCards(parsed2, corpus, knownIds, meta);
        const doc2 = Object.assign({}, doc, { knowledgePoints: v2.kps, stats: Object.assign({}, doc.stats, { knowledgePoints: v2.kps.length, cards: v2.cardSeq, badQuote: v2.badQuote, badImg: v2.badImg }), generatedAt: new Date().toISOString() });
        const violations2 = checkCards(doc2);
        if (violations2.length < violations.length) { doc = doc2; violations = violations2; }
      }
    }

    writeJsonAtomic(outPath, doc);
    doneCount++;
    console.log('DONE assignment ' + n + ' → ' + path.basename(outPath) + ': ' + doc.stats.cards + ' 题（知识点 ' + doc.stats.knowledgePoints + '，自检违规 ' + violations.length + (violations.length ? '：' + violations.slice(0, 3).join('；') : '') + '）语料 ' + corpus.length + ' 字  用时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  } catch (e) {
    console.error('FAIL assignment ' + n + ': ' + (e && e.message));
    failed.push({ time: new Date().toISOString(), assignment: n, title, error: String(e && e.message).slice(0, 300) });
    writeJsonAtomic(cardsDir + '/failed.json', failed);
  }
}
console.log('[assignment-cards] 批量结束：本轮 DONE ' + doneCount + ' 份');
