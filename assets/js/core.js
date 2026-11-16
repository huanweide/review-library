/**
 * core.js —— 考点罗盘 · 纯逻辑层（数据与判分，UI 无关）
 *
 * 单一写入方：web / 将来的 skill / DSH 外壳都复用本文件。
 * 加载顺序：data/*.js → core.js → ui.js（index.html 脚本置于 body 末尾，同步顺序即 data→core→ui，非 defer）。
 * 双导出：浏览器挂 window.KaogangCore；Node 走 module.exports（供纯逻辑单测与 build 复用）。
 */
(function (global) {
  'use strict';
  const Core = {};
  const VERSION = 1;
  const PREFIX = '考点罗盘:v' + VERSION + ':';
  // 按书命名空间：每本书进度互不串（书架模型下必填 Core.ns = bookId）
  Core.ns = '';
  function nsKey(suffix) { return PREFIX + (Core.ns ? Core.ns + ':' : '') + suffix; }

  // ===== XSS 转义（所有用户文本回显一律走它）=====
  Core.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // ===== 章号归一（中文数字 + 阿拉伯，含「二/三」）=====
  const CN_NUM = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };
  function cnToArabic(seg) {
    return seg.split(/[／/]/).map(part => {
      if (/^[0-9]+$/.test(part)) return part;
      let out = ''; for (const ch of part) out += (CN_NUM[ch] !== undefined ? CN_NUM[ch] : ch);
      return out;
    }).join('/');
  }
  Core.chKeyOf = function (label) {
    const m = String(label || '').match(/第(.+?)章/);
    if (!m) return null;
    const key = cnToArabic(m[1]);
    return /^[0-9\/]+$/.test(key) ? key : null;
  };

  // ===== 章节清单（供考纲/练习/模拟考三处统一）=====
  // 来源 KAOGANG（含全部 5 章 chLabel）；返回按首章号升序
  Core.chapters = function (KAOGANG) {
    const map = {};
    KAOGANG.forEach(r => { if (r.chKey && !map[r.chKey]) map[r.chKey] = r.chLabel; });
    return Object.keys(map)
      .sort((a, b) => (+a.split('/')[0]) - (+b.split('/')[0]))
      .map(chKey => ({ chKey, chLabel: map[chKey] }));
  };

  // ===== 题型清单（练习筛选用）=====
  Core.types = function (TIKU) {
    return Array.from(new Set(TIKU.map(x => x.type)));
  };

  // ===== 考纲筛选：章 / 重点 / 搜索 =====
  Core.outlineFilter = function (KAOGANG, opt) {
    const q = (opt.q || '').trim().toLowerCase();
    return KAOGANG.filter(r => {
      if (opt.chKey && opt.chKey !== '全部章节' && r.chKey !== opt.chKey) return false;
      if (opt.hot && !r.hot) return false;
      if (q) {
        const hay = (r.id + ' ' + r.text + ' ' + r.type + ' ' + r.sec + ' ' + r.chLabel).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };

  // ===== 练习筛选：章 / 题型（可剔除已掌握）=====
  Core.quizFilter = function (TIKU, opt) {
    return TIKU.filter(x => {
      if (opt.chKey && opt.chKey !== '全部章节' && x.chKey !== opt.chKey) return false;
      if (opt.type && opt.type !== '全部题型' && x.type !== opt.type) return false;
      if (opt.hideMastered && opt.mastered && opt.mastered[x.id]) return false;
      if (opt.wrongOnly && opt.wrong && !opt.wrong[x.id]) return false;
      return true;
    });
  };

  // ===== 模拟考筛选：按章范围 =====
  Core.examFiltered = function (TIKU, scope) {
    if (!scope || scope === '全部章节') return TIKU.slice();
    return TIKU.filter(x => x.chKey === scope);
  };

  // ===== Fisher–Yates 洗牌（题序不丢、不重复）=====
  Core.shuffle = function (arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  // ===== 判分（依据答案册 TIKU_ANS[id]，不依赖 TIKU 是否带答案）=====
  // 返回 true / false / null（null＝主观题需自评）
  Core.gradeOne = function (ansItem, val) {
    if (!ansItem) return null;
    if (ansItem.correct !== undefined) return (val === ansItem.correct);
    if (ansItem.keys) return ansItem.keys.every(g => g.some(k => String(val).includes(k)));
    return null;
  };

  // ===== 模拟考状态机（零反馈：picks 只存 input，判分仅在 gradeExam 本地算、不回写）=====
  Core.makeExamState = function () {
    return { list: [], shuffled: [], idx: 0, picks: {}, done: false, scope: '全部章节' };
  };
  Core.resetExam = function (state, TIKU, scope) {
    const list = Core.examFiltered(TIKU, scope);
    state.scope = scope;
    state.list = list;
    state.shuffled = Core.shuffle(list.map((_, i) => i));
    state.idx = 0;
    state.picks = {};
    state.done = false;
  };
  Core.submitExam = function (state, item, val) {
    state.picks[item.id] = { input: val }; // 只存作答，绝不存判分
  };
  Core.gradeExam = function (state, TIKU_ANS) {
    const list = state.list, ord = state.shuffled;
    let n = 0, ok = 0; const rows = [];
    ord.forEach(ri => {
      const x = list[ri];
      const p = state.picks[x.id];
      const val = p ? p.input : '';
      const grade = Core.gradeOne(TIKU_ANS[x.id], val);
      if (p) n++;
      if (grade === true) ok++;
      rows.push({ item: x, grade });
    });
    state.done = true;
    return { ok, total: list.length, n, rows };
  };

  // ===== 薄弱点汇总（按章正确率）=====
  Core.weakByChapter = function (rows) {
    const m = {};
    rows.forEach(r => {
      const k = r.item.chKey;
      if (!m[k]) m[k] = { chKey: k, chLabel: r.item.chLabel, total: 0, ok: 0 };
      m[k].total++;
      if (r.grade === true) m[k].ok++;
    });
    return Object.values(m).sort((a, b) => (a.ok / a.total) - (b.ok / b.total));
  };

  // ===== 持久化（localStorage 不可写时静默降级；带版本指纹防旧档污染）=====
  function ls() { try { return global.localStorage; } catch (e) { return null; } }
  Core.PREFIX = PREFIX;
  Core.save = function (suffix, obj) {
    const s = ls(); if (!s) return false;
    try { s.setItem(nsKey(suffix), JSON.stringify(obj)); return true; }
    catch (e) { return false; } // 配额满 / 隐私模式 / 部分 file:// 策略
  };
  Core.load = function (suffix) {
    const s = ls(); if (!s) return null;
    try { const v = s.getItem(nsKey(suffix)); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  };
  Core.clearAll = function (onlyNs) {
    const s = ls(); if (!s) return;
    try {
      const pfx = (onlyNs === undefined)
        ? (PREFIX + (Core.ns ? Core.ns + ':' : ''))
        : (PREFIX + onlyNs + ':');
      const dead = [];
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.indexOf(pfx) === 0) dead.push(k); }
      dead.forEach(k => s.removeItem(k));
    } catch (e) { /* 忽略 */ }
  };
  // 数据指纹：题 id 列表的稳定哈希；不一致则整包清档再重建
  Core.fingerprint = function (TIKU) {
    let h = 5381; const ids = TIKU.map(x => x.id).join(',');
    for (let i = 0; i < ids.length; i++) { h = ((h << 5) + h + ids.charCodeAt(i)) >>> 0; }
    return 't' + h.toString(36) + 'n' + TIKU.length;
  };
  Core.ensureVersion = function (TIKU) {
    const fp = Core.fingerprint(TIKU);
    const meta = Core.load('meta') || {};
    if (meta.fp !== fp) { Core.clearAll(); Core.save('meta', { fp }); }
    return fp;
  };

  // ===== 双导出 =====
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  global.KaogangCore = Core;
})(typeof window !== 'undefined' ? window : globalThis);
