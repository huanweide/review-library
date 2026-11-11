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

// ---------- 判分 ----------
// 从「B. 8 个 —— 理由」里解析出选项字母与选项文本（供中文作答归一）。
function parseAnswer(q) {
  const answer = String((q && q.answer) || '').trim();
  const opts = Array.isArray(q && q.options) ? q.options : [];
  let letter = '';
  const m = answer.match(/^\s*([A-Ha-h])\s*[.．、:：)）]/);
  if (m) letter = m[1].toUpperCase();
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
function attempt(state, q, given, now) {
  const t = Number(now) || Date.now();
  const s = normalizeState(state);
  const g = gradeOne(q, q.type, given);
  const card = ensureCard(s, q, t);
  const givenClean = String(given == null ? '' : given).slice(0, MAX_GIVEN);

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
      card, dueAt: card.dueAt
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

/** 到期队列：只捞 dueAt <= now，leech（反复错）上浮队首。now 可注入，判别测试不靠真实时间。 */
function dueKeys(state, now) {
  const t = Number(now) || Date.now();
  const s = normalizeState(state);
  return Object.keys(s.cards)
    .filter(k => {
      const c = s.cards[k];
      return c && typeof c.dueAt === 'number' && c.dueAt <= t;
    })
    .sort((a, b) => (s.cards[b].lapseCount || 0) - (s.cards[a].lapseCount || 0) || (s.cards[a].dueAt - s.cards[b].dueAt));
}

function summarize(state, now) {
  const t = Number(now) || Date.now();
  const s = normalizeState(state);
  const cards = Object.values(s.cards);
  return {
    total: cards.length,
    dueCount: dueKeys(s, t).length,
    wrongCount: cards.filter(c => (c.lapseCount || 0) > 0).length,
    leechCount: cards.filter(c => (c.lapseCount || 0) >= LEECH_THRESHOLD).length,
    masteredCount: cards.filter(c => (c.correctCount || 0) > 0 && !(c.leech)).length,
    dueKeys: dueKeys(s, t)
  };
}

module.exports = {
  PRACTICE_VERSION, AUTO_TYPES, LEECH_THRESHOLD, MAX_GIVEN,
  questionKey, flatten, findQuestion, parseAnswer, normalizeGiven, gradeOne,
  emptyState, normalizeState, attempt, rate, dueKeys, summarize
};
