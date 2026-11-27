'use strict';
// 统一核心 · 学习过程层（练习 / 判分 / 错题 / 间隔复习）。
//
// 背景：canonical core 此前只建模「资料 → 分析」，默认入口 core.html 只能看答案、不能练。
// 本模块补上「学习过程」这一层数据模型，落盘为每本书独立的 practice.json，
// 与 book.json / analysis.json 并列：**零迁移、不改任何既有结构、删掉即回到原状**。
//
// 数据契约（来自 core/analyze.js:338-362 的 normalizeQuestion，逐字符核对）：
//   题目 { id, stem, options[], answer, solution[], rationale, pitfalls, difficulty,
//          pointPath[], pointId, source }，题型只在 questionIndex[].type（题目本身没有 type）。
//   answer 是「字母 + 内容 + 简要理由」的整句（analyze.js:86 强制，:441 反向惩罚纯字母），
//   因此**不能拿字符串相等判分**；也**不能把答案下发给前端**（否则「先答后揭」是假的）。
//
// 判分边界（诚实，不冒充模型评分）：
//   - 选择题 / 判断题：有唯一可解析的选项答案 → 程序自动判。
//   - 填空题 / 名词解释 / 简答题 / 计算题 / 综合应用题：答案是自由文本，机器硬判＝造假
//     → 返回 verdict='self'，显示标准答案后由用户四档自评（Anki 的本质，见 best-practices [B1]）。
//
// 排程直接复用 lib/srs.js（本机既有、零依赖纯函数），不引入 FSRS/ts-fsrs 依赖。
const crypto = require('crypto');
const srs = require('../lib/srs');

const PRACTICE_VERSION = 1;
const AUTO_TYPES = new Set(['选择题', '判断题']);
const LEECH_THRESHOLD = 3;
const MAX_HISTORY = 30;
const MAX_GIVEN = 2000;

// ---------- 身份：内容哈希 ----------
// 只用题面 + 选项 + 答案，不用 q.id（每次分析会重新编号，见 analyze.js:345）。
// 题面改一个字 → key 变，旧复习进度不串到新题（repeater 的 Blake3 思路，见 [C2]）。
function questionKey(q) {
  const s = [String((q && q.stem) || ''), (Array.isArray(q && q.options) ? q.options : []).join('\n'), String((q && q.answer) || '')].join('\n');
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

// ---------- 从分析结果展平题目 ----------
// public=true 时是「脱敏题目」：绝不含 answer / solution / rationale / pitfalls。
// 这份列表才是发给前端的；答案只在服务端判分时通过 findQuestion 取。
function flatten(analysis, publicOnly) {
  const out = [];
  const groups = (analysis && Array.isArray(analysis.questionIndex)) ? analysis.questionIndex : [];
  groups.forEach(g => {
    const type = String((g && g.type) || '');
    ((g && Array.isArray(g.items)) ? g.items : []).forEach(it => {
      ((it && Array.isArray(it.questions)) ? it.questions : []).forEach(q => {
        if (!q || !q.stem) return;
        const base = {
          key: questionKey(q),
          type,
          subtype: String((it && it.title) || ''),
          stem: String(q.stem),
          options: Array.isArray(q.options) ? q.options.slice() : [],
          difficulty: String(q.difficulty || '基础'),
          pointPath: Array.isArray(q.pointPath) ? q.pointPath.slice() : [],
          pointId: String(q.pointId || ''),
          // 全局题号（2026-11-21）：两处显示同一个号，用户才能引用「第 13 题」。
          // 老分析数据没有 seqNo，用 id（q0 起）反推同一口径，不逼用户重跑模型。
          seqNo: Number(q.seqNo) > 0 ? Number(q.seqNo) : (Number(String(q.id || '').replace(/^q/, '')) + 1 || 0),
          // 题目配图（2026-11-21）：练习页必须能带图，否则「根据图中」的题做不了。
          // 脱敏（publicOnly）也要带——图是题面的一部分，不是答案。
          imageIds: Array.isArray(q.imageIds) ? q.imageIds.map((x) => String(x)).filter(Boolean).slice(0, 4) : [],
          auto: AUTO_TYPES.has(type)
        };
        if (!publicOnly) {
          base.answer = String(q.answer || '');
          base.solution = Array.isArray(q.solution) ? q.solution.slice() : [];
          base.rationale = String(q.rationale || '');
          base.pitfalls = String(q.pitfalls || '');
          base.source = q.source || {};
        }
        out.push(base);
      });
    });
  });
  return out;
}

function findQuestion(analysis, key) {
  if (typeof key !== 'string' || !/^[a-f0-9]{16}$/.test(key)) return null; // 同时挡住原型污染与任意路径
  return flatten(analysis, false).find(q => q.key === key) || null;
}

// ---------- 逐讲 / 作业题卡并进练习题库（2026-11-27）----------
// 背景：147 道原题卡此前只在书内题型页「看思路/看答案」，不进 quiz、不判分、不进 SRS；
// 学生最想做的课后原题反而做不了。卡片本来就带 answer + solution（4 步推导），
// 缺的是这条接线，不是重新分析一遍。这里复用同一套 questionKey / 判分 / SRS，
// 不另写一套——和「玩家与 NPC 走同一批函数」同理。
//
// 判分口径（诚实）：只有结构化后确实带 options + answerKey 的题才 auto 判分
// （本轮 146 题里仅 1 道能从原文严格抽出可区分选项）。其余走 Anki 正统的
// 「先自答 → 对照答案 → 四档自评 → SRS」，不是把没判不了的题硬标成可判分。
// 无定论的题（excludedFromQuiz）不进练习——答案都没有，不能拿它考学生。
function flattenCards(cardData, publicOnly) {
  const out = [];
  const lessons = (cardData && Array.isArray(cardData.lessons)) ? cardData.lessons : [];
  lessons.forEach((L) => {
    if (!L || L.error) return;
    (Array.isArray(L.content) ? L.content : []).forEach((kp) => {
      (Array.isArray(kp && kp.cards) ? kp.cards : []).forEach((c) => {
        if (!c || !c.stem || c.excludedFromQuiz) return;
        const type = String(c.type || '');
        const opts = Array.isArray(c.options) ? c.options.slice() : [];
        const src = (c && c.source) || {};
        const base = {
          key: questionKey(c),
          type,
          subtype: String(c.tag || ((kp && kp.name) || '')),
          stem: String(c.stem),
          options: opts,
          imageIds: Array.isArray(c.imageIds) ? c.imageIds.map(String).filter(Boolean).slice(0, 4) : [],
          // 来源维度：练习页可按「全部/作业/讲次/全局题」筛，跟题型页的作业入口同源。
          origin: String(src.kind || '') === 'assignment' ? '作业' : '讲次',
          lessonNo: Number(src.lesson) || 0,
          needsReview: c.needsReview === true,
          auto: AUTO_TYPES.has(type) && opts.length > 0 && !!c.answerKey,
        };
        if (!publicOnly) {
          // 原 answer 原样下发：parseAnswer 已支持「A（1,3,5）：…」这种中文答案格式，
          // 不再派生一个「A. A（…）」的重复前缀（磁盘原文也不动）。
          base.answer = String(c.answer || '');
          base.solution = Array.isArray(c.solution) ? c.solution.slice() : [];
          base.rationale = String(c.rationale || '');
          base.pitfalls = String(c.pitfalls || '');
          base.source = src;
        }
        out.push(base);
      });
    });
  });
  return out;
}
function findCardQuestion(cardData, key) {
  if (typeof key !== 'string' || !/^[a-f0-9]{16}$/.test(key)) return null;
  return flattenCards(cardData, false).find(q => q.key === key) || null;
}

// ---------- 判分 ----------
// 从「B. 8 个 —— 理由」里解析出选项字母与选项文本（供中文作答归一）。
function parseAnswer(q) {
  const answer = String((q && q.answer) || '').trim();
  const opts = Array.isArray(q && q.options) ? q.options : [];
  let letter = '';
  // 末尾 `|$` 不能漏：模型经常只写「B」不带标点。normalizeGiven 早就支持纯字母，
  // 这里少一个 `$` 会让「标准答案是纯字母」的题永远判不了卷、全退化成人工自评（2026-11-21 实测）。
  // 选项字母后允许中文括号（题卡原文形如「A（1,3,5）：速度方向为1…」）。
  const m = answer.match(/^\s*([A-Ha-h])\s*(?:[.．、:：)（(]|\)|）)|^\s*([A-Ha-h])\s*$/);
  if (m) letter = (m[1] || m[2] || '').toUpperCase();
  // 判断题可能只写「错误 —— 理由」不带字母：从答案首个中文结论反查选项。
  let label = '';
  if (letter) {
    const hit = opts.find(o => new RegExp('^\\s*' + letter + '\\s*[.．、:：)）]').test(String(o)));
    if (hit) label = String(hit).replace(/^\s*[A-Ha-h]\s*[.．、:：)）]\s*/, '').trim();
  }
  if (!label) {
    const kw = answer.match(/^\s*(正确|错误|对|错|√|×|是|否|真|假)/);
    if (kw) {
      label = kw[1];
      const hit = opts.find(o => String(o).indexOf(label) >= 0);
      if (hit) {
        const lm = String(hit).match(/^\s*([A-Ha-h])\s*[.．、:：)）]/);
        if (lm) letter = lm[1].toUpperCase();
      }
    }
  }
  return { letter, label, answer };
}

function normalizeGiven(given, q) {
  const raw = String(given == null ? '' : given).trim();
  if (!raw) return { letter: '', label: '', raw };
  const m = raw.match(/^\s*([A-Ha-h])\s*(?:[.．、:：)）]|$)/);
  if (m) return { letter: m[1].toUpperCase(), label: '', raw };
  // 中文结论（判断题常见）：映射到选项字母。
  const kw = raw.match(/^\s*(正确|错误|对|错|√|×|是|否|真|假)\b|^(正确|错误|对|错|√|×)/);
  if (kw) {
    const word = (kw[1] || kw[2] || '').trim();
    const opts = Array.isArray(q && q.options) ? q.options : [];
    const hit = opts.find(o => String(o).indexOf(word) >= 0);
    if (hit) {
      const lm = String(hit).match(/^\s*([A-Ha-h])\s*[.．、:：)）]/);
      if (lm) return { letter: lm[1].toUpperCase(), label: word, raw };
    }
    return { letter: '', label: word, raw };
  }
  return { letter: '', label: '', raw };
}

/**
 * 判一道题。返回 { verdict, correct, mode, expected }。
 * verdict: 'correct' | 'wrong' | 'self'；self 时 correct 恒为 null（不假判）。
 */
function gradeOne(q, type, given) {
  const t = String(type || (q && q.type) || '');
  if (!AUTO_TYPES.has(t)) {
    return { verdict: 'self', correct: null, mode: 'self', expected: '' };
  }
  const parsed = parseAnswer(q);
  const g = normalizeGiven(given, q);
  // 解析不出唯一选项答案时不冒充判对：诚实降级为自评。
  if (!parsed.letter) return { verdict: 'self', correct: null, mode: 'self', expected: '' };
  let correct = !!g.letter && g.letter === parsed.letter;
  // 用户用完整选项文本作答（如「B. 8 个」）时，字母已能归一；这里兼容纯文本标签。
  if (!correct && g.label && parsed.label && g.label === parsed.label) correct = true;
  return {
    verdict: correct ? 'correct' : 'wrong',
    correct,
    mode: 'auto',
    expected: parsed.letter,
    answerText: parsed.answer
  };
}

// ---------- 状态 ----------
function emptyState() {
  return { version: PRACTICE_VERSION, cards: {}, updatedAt: new Date().toISOString() };
}
function normalizeState(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  return { version: PRACTICE_VERSION, cards: (s.cards && typeof s.cards === 'object' && !Array.isArray(s.cards)) ? s.cards : {}, updatedAt: s.updatedAt || '' };
}

// 四档：1=重来 2=吃力 3=会了 4=太简单。用 lib/srs.js 的真实排程，不另写一套。
function applySchedule(card, rating, now) {
  const prev = {
    stability: card.stability, difficulty: card.difficulty,
    lapses: card.lapses, reps: card.reps
  };
  const r = srs.schedule(prev, srs.clamp(Math.round(Number(rating) || 3), 1, 4), now);
  card.stability = r.stability;
  card.difficulty = r.difficulty;
  card.reps = r.reps;
  card.lapses = r.lapses;
  card.dueAt = r.dueAt;
  card.lastRating = r.lastRating;
  card.lastSeen = r.lastSeen;
  card.leech = (card.lapseCount || 0) >= LEECH_THRESHOLD;
  return card;
}

function ensureCard(state, q, now) {
  const key = q.key;
  if (!state.cards[key]) {
    state.cards[key] = {
      key,
      stem: String(q.stem || '').slice(0, 200),
      type: String(q.type || ''),
      pointPath: Array.isArray(q.pointPath) ? q.pointPath.slice(0, 6) : [],
      correctCount: 0, lapseCount: 0, reps: 0, lapses: 0,
      stability: 0, difficulty: 5, dueAt: now, lastSeen: now,
      lastRating: 0, leech: false, history: []
    };
  }
  return state.cards[key];
}

function pushHistory(card, entry) {
  if (!Array.isArray(card.history)) card.history = [];
  card.history.push(entry);
  if (card.history.length > MAX_HISTORY) card.history = card.history.slice(-MAX_HISTORY);
}

/** 提交一次作答：判分 → 排程 → 落状态。返回给前端的结果里才第一次带上答案与解析。 */
/**
 * 把「还要多少毫秒到期」说成人话。
 * 用户看不懂 stability=2.2，但看得懂「10 分钟后」「4 天后」。
 */
function humanGap(ms) {
  const m = Math.max(0, Math.round(Number(ms) || 0) / 60000);
  if (m < 1) return '马上';
  if (m < 60) return Math.round(m) + ' 分钟后';
  const h = m / 60;
  if (h < 24) return Math.round(h) + ' 小时后';
  const d = h / 24;
  if (d < 30) return Math.round(d) + ' 天后';
  const mo = d / 30;
  if (mo < 12) return Math.round(mo) + ' 个月后';
  return (d / 365).toFixed(1) + ' 年后';
}

/**
 * 四档预览（2026-11-21，对齐 Anki「评分前显示下一个间隔」）。
 * 必须在 applySchedule **之前**用旧状态算——用新状态算出来的是「已经评完再评一次」，会骗人。
 */
function previewRatings(card, now) {
  const prev = {
    stability: card.stability, difficulty: card.difficulty,
    lapses: card.lapses, reps: card.reps
  };
  const names = ['重来', '有点难', '记得', '很简单'];
  return [1, 2, 3, 4].map((r) => {
    const out = srs.schedule(prev, r, now);
    return { rating: r, name: names[r - 1], dueAt: out.dueAt, label: humanGap(out.dueAt - now) };
  });
}

function attempt(state, q, given, now) {
  const t = Number(now) || Date.now();
  const s = normalizeState(state);
  const g = gradeOne(q, q.type, given);
  const card = ensureCard(s, q, t);
  const givenClean = String(given == null ? '' : given).slice(0, MAX_GIVEN);

  // 先算四档（基于当前还没被排程改写的卡），再落排程。
  const nextIntervals = previewRatings(card, t);

  if (g.verdict === 'correct') card.correctCount = (card.correctCount || 0) + 1;
  else if (g.verdict === 'wrong') card.lapseCount = (card.lapseCount || 0) + 1;
  // self：不改对错计数，等 rateCard 的四档自评。

  if (g.mode === 'auto') applySchedule(card, g.correct ? 3 : 1, t);
  pushHistory(card, { at: t, given: givenClean, verdict: g.verdict, mode: g.mode });
  s.updatedAt = new Date(t).toISOString();

  return {
    state: s,
    result: {
      key: q.key, verdict: g.verdict, correct: g.correct, mode: g.mode,
      expected: g.expected || '',
      // ↓ 提交后才下发：这是「先答后揭」的真实边界，不是 CSS 遮挡。
      answer: String(q.answer || ''), solution: q.solution || [],
      rationale: String(q.rationale || ''), pitfalls: String(q.pitfalls || ''),
      card, dueAt: card.dueAt,
      // 四档各自的到期时间：用户可以接受自动结果，也可以改成别的档位。
      nextIntervals,
      scheduledBy: g.mode === 'auto' ? (g.correct ? 'auto-correct' : 'auto-wrong') : 'self',
      currentLabel: humanGap(card.dueAt - t)
    }
  };
}

/** 开放题揭晓答案后，或答完想调整掌握度：四档自评重排下次复习时间。 */
function rate(state, key, rating, now) {
  const t = Number(now) || Date.now();
  const s = normalizeState(state);
  const card = s.cards[key];
  if (!card || typeof key !== 'string' || !/^[a-f0-9]{16}$/.test(key)) {
    return { state: s, result: null, error: '没有这道练习记录' };
  }
  const r = srs.clamp(Math.round(Number(rating) || 3), 1, 4);
  // 自评「重来」记一次 lapse，与自动判错口径一致。
  if (r === 1) card.lapseCount = (card.lapseCount || 0) + 1;
  if (r >= 3) card.correctCount = (card.correctCount || 0) + 1;
  applySchedule(card, r, t);
  pushHistory(card, { at: t, rating: r, verdict: 'rated' });
  s.updatedAt = new Date(t).toISOString();
  return { state: s, result: { key, rating: r, dueAt: card.dueAt, card } };
}

/**
 * 到期队列：只捞 dueAt <= now，leech（反复错）上浮队首。now 可注入，判别测试不靠真实时间。
 * validKeys（可选）= 当前分析结果里的题目 key 集合。传了就只统计还存在的题：
 * 重分析会换掉题目内容哈希，旧卡留在盘上当历史，但绝不能再让「今日到期 N」显示 N 却列不出题。
 * 不传时行为与旧版完全一致（向后兼容，判别测试 J2g4 锁住）。
 */
function dueKeys(state, now, validKeys) {
  const t = Number(now) || Date.now();
  const s = normalizeState(state);
  const allow = validKeys instanceof Set ? validKeys : (Array.isArray(validKeys) ? new Set(validKeys) : null);
  return Object.keys(s.cards)
    .filter(k => !allow || allow.has(k))
    .filter(k => {
      const c = s.cards[k];
      return c && typeof c.dueAt === 'number' && c.dueAt <= t;
    })
    .sort((a, b) => (s.cards[b].lapseCount || 0) - (s.cards[a].lapseCount || 0) || (s.cards[a].dueAt - s.cards[b].dueAt));
}

function summarize(state, now, validKeys) {
  const t = Number(now) || Date.now();
  const s = normalizeState(state);
  const allow = validKeys instanceof Set ? validKeys : (Array.isArray(validKeys) ? new Set(validKeys) : null);
  const cards = Object.keys(s.cards)
    .filter(k => !allow || allow.has(k))
    .map(k => s.cards[k]);
  const due = dueKeys(s, t, validKeys);
  return {
    total: cards.length,
    dueCount: due.length,
    wrongCount: cards.filter(c => (c.lapseCount || 0) > 0).length,
    leechCount: cards.filter(c => (c.lapseCount || 0) >= LEECH_THRESHOLD).length,
    masteredCount: cards.filter(c => (c.correctCount || 0) > 0 && !(c.leech)).length,
    dueKeys: due
  };
}

module.exports = {
  PRACTICE_VERSION, AUTO_TYPES, LEECH_THRESHOLD, MAX_GIVEN,
  questionKey, flatten, findQuestion, flattenCards, findCardQuestion, parseAnswer, normalizeGiven, gradeOne,
  emptyState, normalizeState, attempt, rate, dueKeys, summarize
};
