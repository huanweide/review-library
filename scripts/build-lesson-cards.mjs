// 理论力学 · 逐讲题卡批量构建 v2（2026-11-22 批量模式）。
//
// 相比 v1 的三个变化（对应用户批量模式指令）：
//   1. SYSTEM prompt 写死三条硬规则：题干写全图上已知量、严禁「题面见图」类占位、
//      answer 含数值方向、solution 逐条等号代入——转录语料里有这些信息，逼模型提取；
//   2. 生成后程序自检三条 + 不达标自动重试一次（违规清单回喂）；
//   3. 批量循环多节：--lessons 1,2,3,... 按讲次（title 前导数字）或 seq 解析，
//      已存在的 cards/lesson-NN.json 自动跳过（中断恢复），0 页讲次跳过并记录。
//
// 用法：
//   node scripts/build-lesson-cards.mjs --lessons 14,15,18,19,20,1,2,3,4,5,6,7,8,9,10,11,13
//   [--model deepseek-ai/DeepSeek-V4.1-Flash] [--dry] [--force]（--force 重做已存在节）
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
const LESSONS = String(arg('lessons') || arg('lesson') || '').split(',').map(Number).filter(Boolean);
const MODEL = arg('model') || 'deepseek-ai/DeepSeek-V4.1-Flash';
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
if (!LESSONS.length) { console.error('缺少 --lessons'); process.exit(1); }

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
const cwManifest = readJson(SRC + '/课件PDF/manifest.json', []);
const ctManifest = readJson(SRC + '/课堂题目PDF/manifest.json', []);
function resolveLesson(n) {
  const byTitle = cwManifest.find(m => Number(String(m.title).match(/^(\d+)/)?.[1]) === n);
  if (byTitle) return byTitle;
  return cwManifest.find(m => m.seq === n) || null;
}

// ---------- 批次语料 ----------
function norm(s) {
  return String(s || '').replace(/\s+/g, '').replace(/[，。、；：“”‘’（）()【】\[\],.;:!?\-—_]/g, '');
}
function buildCorpus(rows, dirSuffixes, classroomMapping) {
  const hit = rows.filter(r => {
    const fn = String(r.source.fileName || '');
    const dir = fn.slice(0, fn.lastIndexOf(' 第'));
    return dirSuffixes.some(t => dir === t || dir.endsWith('_' + t));
  });
  const course = hit.filter(r => r.source.context === '原始图片');
  const classroom = hit.filter(r => r.source.context === '原始图片_题目');
  const part = (head, list) => list.length
    ? '【文件：' + head + '】\n' + list.map(r => '【页' + (r.source.page || 1) + '】（图id=' + r.img.id + '）' + r.text).join('\n')
    : '';
  const cl = (Array.isArray(classroomMapping) && classroomMapping.length)
    ? '【文件：课堂题目清单·' + dirSuffixes[0] + '】\n' + classroomMapping.map(x =>
        '【页' + x.classroomPage + '】（图id=' + x.imageId + '）课堂题目 PDF 第 ' + x.classroomPage +
        ' 页' + (x.coursewarePage ? '，与课件第 ' + x.coursewarePage + ' 页同一版面' : '')).join('\n')
    : '';
  return {
    corpus: [part('课件·' + dirSuffixes[0], course), cl, part('课堂题目·' + dirSuffixes[0], classroom)].filter(Boolean).join('\n\n'),
    courseCount: course.length, classroomCount: classroom.length + (classroomMapping ? classroomMapping.length : 0),
  };
}

// ---------- 课堂题目图 ensure ----------
function ensureClassroomImages(seq, title) {
  const srcDir = SRC + '/原始图片_题目';
  if (!fs.existsSync(srcDir)) return { added: 0, mapping: [], sub: '' };
  const sub = fs.readdirSync(srcDir).find(d => d.endsWith('_' + title) || d === title);
  if (!sub) return { added: 0, mapping: [], sub: '' };
  const bySha = new Map(IMG.loadIndex(bookDir).images.map(x => [x.sha256, x]));
  const mapping = [];
  let added = 0;
  for (const f of fs.readdirSync(srcDir + '/' + sub).filter(f => /\.jpe?g$/i.test(f)).sort()) {
    const buf = fs.readFileSync(srcDir + '/' + sub + '/' + f);
    const pageNo = Number(f.match(/^0*(\d+)\./)?.[1]) || 0;
    const sha = IMG.sha(buf);
    let rec = bySha.get(sha);
    if (!rec) {
      const r = IMG.ingest(bookDir, 'img-batch', '课堂题·' + sub + ' 第' + pageNo + '页', '.jpg', buf, {
        relPath: '', size: buf.length,
        page: pageNo, context: '原始图片_题目', caption: '课堂题｜' + sub + '｜第 ' + pageNo + ' 页',
      });
      if (r.added && r.records[0]) { rec = r.records[0]; added++; }
    }
    if (rec) {
      const cs = rec.sources[0] || {};
      mapping.push({ classroomPage: pageNo, imageId: rec.id, coursewarePage: cs.page || 0, coursewareFile: cs.fileName || '' });
    }
  }
  return { added, mapping, sub };
}

// ---------- prompt（批量版：三条硬规则写死） ----------
const SYSTEM = `你是理论力学备考题卡整理员。输入是某一讲全部页面（课件 + 课堂题目）的视觉转录，块格式为【页N】（图id=xxx）转录文本。
任务：提炼知识点树 + 题目卡。只依据给定转录，禁止编造转录里没有的题、数据或图 id。

【题干硬规则（违反 = 输出无效）】
- 每道题的 stem 必须把页面上/图上的已知量写全：构件名称、长度数值、角度数值、转向（顺时针/逆时针）、已知速度或角速度数值。这些信息就在转录文本里，逐字提取后组织成完整题干。
- 严禁出现「题面见图」「如图所示」「见上图」「（题面见图）」等任何让读者另去看图的占位表述——题干必须脱离原图也能完整作答。
- 转录里没有数值的题（纯概念/方法页），题干写清定性条件与所求，该卡标 needsReview=true、confidence=low，不许编造数值。

【答案与解析硬规则】
- answer 必须给出最终结论：含数值、方向（如「水平向左」「逆时针」）、单位；禁止只复述公式或定理。
- solution 3-6 步，每步先写公式、再把转录里的具体数字代入（必须出现等号，如 ω_AB = v_A/AC = Rω/(3R) = ω/3）。
- 转录里给出了数值就代数值；没给数值就符号推导，并在该卡标 needsReview=true、confidence=low。

【知识点树规则】
- 2-5 个知识点，按考试重点命名（如「速度瞬心的确定」「基点法加速度合成」），禁止用课件页码/章节编号命名；每个归入 block（只能选：静力学/运动学/动力学）。
- 每个知识点 summary 3-6 句：自己的话、能直接背、零基础能懂；覆盖「是什么、怎么考、最容易错在哪」。

【输出契约】只输出一个单行紧凑 JSON 对象（禁止换行/缩进/markdown/代码块），结构：
{"lessonNo":讲次,"title":"讲名","block":"本讲主块","knowledgePoints":[{"name":"...","block":"运动学","summary":"...","cards":[{"stem":"...","imageIds":["图id"],"answer":"...","solution":["..."],"type":"计算题","tag":"...","source":{"page":N,"kind":"courseware","quote":"页面转录原句10-60字"}}]}]}
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
          lesson: meta.lessonNo, kind: c.source && c.source.kind === 'classroom' ? 'classroom' : 'courseware',
          pdf: c.source && c.source.kind === 'classroom' ? meta.classroomPdf : meta.coursewarePdf,
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

// 三条自检（与用户验收口径一致）
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
console.log('[cards] model=' + MODEL + ' keySource=' + cfg.keySource + ' lessons=' + LESSONS.join(','));

const failed = readJson(cardsDir + '/failed.json', []);
let doneCount = 0;

for (const n of LESSONS) {
  const outPath = cardsDir + '/lesson-' + String(n).padStart(2, '0') + '.json';
  if (!FORCE && fs.existsSync(outPath)) { console.log('SKIP lesson ' + n + '（已落盘 ' + path.basename(outPath) + '）'); continue; }

  const m = resolveLesson(n);
  if (!m) { console.error('FAIL lesson ' + n + ': manifest 找不到'); failed.push({ time: new Date().toISOString(), lesson: n, error: 'manifest 找不到' }); continue; }
  if ((m.pages_in_pdf || 0) === 0) { console.log('SKIP lesson ' + n + '（' + String(m.title) + ' 平台 0 页）'); continue; }
  const title = String(m.title);
  const lessonNo = Number(title.match(/^(\d+)/)?.[1]) || m.seq;
  const key = String(n).padStart(2, '0');
  const cwPdf = cwManifest.find(x => x.seq === m.seq);
  const ctPdf = ctManifest.find(x => x.seq === m.seq);
  const blockGuess = lessonNo >= 15 ? '动力学' : (lessonNo <= 7 ? '静力学' : '运动学');
  const meta = { key, lessonNo, block: blockGuess, title,
    coursewarePdf: cwPdf ? path.basename(cwPdf.pdf || '') : '', classroomPdf: ctPdf ? path.basename(ctPdf.pdf || '') : '' };

  try {
    const t0 = Date.now();
    const ens = ensureClassroomImages(m.seq, title);
    if (ens.added > 0) {
      const vcfg = Object.assign({}, cfg, { model: 'Qwen/Qwen3-VL-8B-Instruct' });
      await vision.transcribeBook(bookDir, vcfg, { concurrency: 3, timeoutMs: 120000 });
    }
    const rowsNow = IMG.orderedTranscribed(bookDir);
    const { corpus, courseCount, classroomCount } = buildCorpus(rowsNow, [title], ens.mapping);
    if (!corpus || corpus.length < 200) throw new Error('批次语料为空（目录对位失败：' + title + '）');
    const knownIds = new Set(collectImageIds(corpus));

    const runOnce = async (extraNote) => {
      const raw = await llm.chat(cfg, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: '本讲讲次=' + lessonNo + '，讲名=' + title + '，默认 block=' + blockGuess +
          (extraNote ? '\n\n【上一次输出的违规项，本次必须修正】\n' + extraNote : '') + '\n\n' + corpus },
      ], { maxTokens: Math.min(16000, 5000 + Math.round(corpus.length / 5)), temperature: extraNote ? 0.35 : 0.2, timeoutMs: 420000, responseFormat: 'json_object' });
      return extractJson(raw);
    };

    let parsed = DRY ? null : await runOnce(null);
    if (!DRY && !parsed) {
      parsed = await runOnce('上一次输出不是可解析的 JSON，请重新输出完整单行 JSON。');
    }
    if (!parsed) throw new Error('模型输出两次均不可解析');

    const { kps, cardSeq, badQuote, badImg } = validateCards(parsed, corpus, knownIds, meta);
    let doc = {
      book: BOOK, lesson: n, lessonNo, seq: m.seq, title, date: m.date || '',
      block: parsed.block && BLOCKS.includes(parsed.block) ? parsed.block : blockGuess,
      sourcePdf: { courseware: meta.coursewarePdf, classroom: meta.classroomPdf },
      stats: { coursePages: courseCount, classroomPages: classroomCount, knowledgePoints: kps.length, cards: cardSeq, badQuote, badImg },
      generatedAt: new Date().toISOString(), model: MODEL,
      knowledgePoints: kps,
    };

    // 三条自检 + 一次重试
    let violations = DRY ? [] : checkCards(doc);
    if (violations.length) {
      console.log('  [retry] lesson ' + n + ' 自检违规 ' + violations.length + ' 项：' + violations.slice(0, 5).join('；') + ' —— 重试一次');
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
    console.log('DONE lesson ' + key + ': ' + doc.stats.cards + ' 题（知识点 ' + doc.stats.knowledgePoints + '，自检违规 ' + violations.length + (violations.length ? '：' + violations.slice(0, 3).join('；') : '') + '）语料 ' + corpus.length + ' 字  用时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  } catch (e) {
    console.error('FAIL lesson ' + n + ': ' + (e && e.message));
    failed.push({ time: new Date().toISOString(), lesson: n, title: String(m.title), error: String(e && e.message).slice(0, 300) });
    writeJsonAtomic(cardsDir + '/failed.json', failed);
  }
}
console.log('[cards] 批量结束：本轮 DONE ' + doneCount + ' 节');
