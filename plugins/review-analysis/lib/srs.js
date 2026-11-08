'use strict';
/**
 * 逐知识点复习排程（可解释简版 FSRS 思路，纯本地、零外部依赖）
 *
 * 诚实边界：这里实现的是 FSRS 的「三状态量 + 四档评分回写」结构，
 * 不是官方 FSRS 的 17 权重公式，也没有 ML 权重拟合优化器
 * （FSRS4Anki README 逐字：optimizer "uses machine learning to learn your memory patterns"）。
 * 单机新用户没有复习历史可拟合，用可解释的默认参数比假装做了拟合更诚实。
 *
 * 状态量：stability（记忆稳定期，天）/ difficulty（难度 1..10）/ retrievability（目标留存率）
 * 评分：1=Again 重来 / 2=Hard 吃力 / 3=Good 会了 / 4=Easy 太简单
 */
const DAY = 86400000;
const RATE_LABEL = { 1: '重来', 2: '吃力', 3: '会了', 4: '太简单' };
const TARGET_RETENTION = 0.9;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rateLabel(r) { return RATE_LABEL[clamp(Number(r) || 3, 1, 4)] || '会了'; }
function ratingFromVerdict(v) {
  if (v === '正确') return 3;
  if (v === '部分正确') return 2;
  return 1;
}

function schedule(prev, rating, now) {
  const p = prev || {};
  const r = clamp(Math.round(Number(rating) || 3), 1, 4);
  const t = Number(now) || Date.now();
  let S = Math.max(0, Number(p.stability) || 0);
  let D = clamp(Number(p.difficulty == null ? 5 : p.difficulty), 1, 10);
  let lapses = Number(p.lapses) || 0;
  const reps = (Number(p.reps) || 0) + 1;

  if (r === 1) {                       // 忘了：记忆崩塌，立刻（当天）重来，难度上调，记一次 lapse
    S = 0;                             // 0 天 = 当天到期，与 Anki「Again 同日重学」一致
    D = clamp(D + 0.8, 1, 10);
    lapses += 1;
  } else if (r === 2) {                // 想起来了但吃力：小幅增长
    S = Math.max(0.5, (S || 0.5) * 1.25);
    D = clamp(D + 0.3, 1, 10);
  } else if (r === 3) {                // 正常掌握
    S = S ? S * 2.2 : 1;
    D = clamp(D - 0.1, 1, 10);
  } else {                             // 太简单：拉得更长、难度下调
    S = S ? S * 3.2 : 3;
    D = clamp(D - 0.4, 1, 10);
  }
  S = Math.min(S, 365);                // 上限一年，避免数值失控
  return {
    stability: Math.round(S * 1000) / 1000,
    difficulty: Math.round(D * 100) / 100,
    retrievability: TARGET_RETENTION,
    dueAt: t + S * DAY,
    reps, lapses, lastRating: r, lastSeen: t
  };
}

/** 兼容旧数据：有 srs.dueAt 用新排程，没有则回落到 Leitner 盒子，保证升级不丢历史。 */
function dueDate(rec, now, boxIntervalDays) {
  if (rec && rec.srs && typeof rec.srs.dueAt === 'number') return rec.srs.dueAt;
  const t = Number(now) || Date.now();
  const days = typeof boxIntervalDays === 'function' ? boxIntervalDays(rec && rec.box) : 0;
  return (rec && rec.lastSeen ? rec.lastSeen : t) + days * DAY;
}

module.exports = {
  DAY, RATE_LABEL, TARGET_RETENTION,
  schedule, rateLabel, ratingFromVerdict, dueDate, clamp
};
