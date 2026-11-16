/**
 * ui.js —— 天道书院 · 视图与交互层（依赖 core.js + bookData）
 * 铁律：模拟考提交只调 Core.submitExam（只存 input）；判分仅在交卷时本地算，绝不提前写 DOM / 状态。
 * 信息架构：罗盘格式基底（8 视图零改动）+ 书馆能力扩展（考点大全 / 速通向 / 导图 + 原文已核徽章）。
 */
(function () {
  'use strict';
  const Core = window.KaogangCore;
  // 按书注入：bookData 传入前不读全局，避免多书串数据
  // 后六项是书馆能力扩展：digest/syllabus/mindmap 三视图 + refs + 溯源 + 引文审计
  let K, T, A, CHAPTERS, TYPES, META, DIGEST, SYLLABUS, MINDMAP, REFS, TRACE, EXAM_OUTLINE;
  let DIGEST_VIEW = 'outline'; // 知识点大全的视图：outline(大纲) / tree(树形) —— 吃掉原 mindmap tab
  let UPLOAD_MSG = ''; // 上传/分析结果提示，跨 book boot 重绘保留
  const $ = id => document.getElementById(id);
  const esc = Core.esc;
  function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
  // LLM 配置：key 只存本机浏览器 localStorage，绝不写进书数据 / 不随请求落盘。
  const LLM_KEY = 'tiandao:llm';
  function loadLLM() { try { return JSON.parse(localStorage.getItem(LLM_KEY)) || {}; } catch (e) { return {}; } }
  function saveLLM(cfg) { try { localStorage.setItem(LLM_KEY, JSON.stringify(cfg)); return true; } catch (e) { return false; } }
  function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addActivity(n) { if (!n) return; const d = ymd(new Date()); S.activity[d] = (S.activity[d] || 0) + n; }

  const S = {
    tab: 'dashboard',
    oChKey: '全部章节', oHot: false, oQ: '',
    qChKey: '全部章节', qType: '全部题型', qIdx: 0,
    answers: {}, mastered: {}, wrong: {}, hideMastered: false, wrongOnly: false, favorites: {},
    exam: Core.makeExamState(), examScope: '全部章节', examLimit: 0,
    theme: 'light', themeMode: 'auto',
    daily: { date: '', list: [], idx: 0 },
    activity: {}, examHistory: [],
    wrongView: 'wrong', _treeKey: null, _jump: 0, _inDaily: false,
  };

  // ===== 持久化 =====
  function persist() {
    Core.save('quiz', { answers: S.answers, qIdx: S.qIdx, qChKey: S.qChKey, qType: S.qType });
    Core.save('mastered', S.mastered);
    Core.save('wrong', S.wrong);
    Core.save('favorites', S.favorites);
    Core.save('prefs', { hideMastered: S.hideMastered, wrongOnly: S.wrongOnly });
    Core.save('exam', { scope: S.exam.scope, shuffled: S.exam.shuffled, picks: S.exam.picks, done: S.exam.done, idx: S.exam.idx, limit: S.examLimit });
    Core.save('activity', S.activity);
    Core.save('history', S.examHistory);
    Core.save('meta', { fp: Core.fingerprint(T), themeMode: S.themeMode });
  }
  function restore() {
    const q = Core.load('quiz'); if (q) { S.answers = q.answers || {}; S.qIdx = q.qIdx || 0; S.qChKey = q.qChKey || '全部章节'; S.qType = q.qType || '全部题型'; }
    const m = Core.load('mastered'); if (m) S.mastered = m;
    const w = Core.load('wrong'); if (w) S.wrong = w;
    const f = Core.load('favorites'); if (f) S.favorites = f;
    const p = Core.load('prefs'); if (p) { S.hideMastered = !!p.hideMastered; S.wrongOnly = !!p.wrongOnly; }
    const e = Core.load('exam');
    if (e) {
      S.exam.scope = e.scope || '全部章节';
      S.exam.shuffled = e.shuffled || [];
      S.exam.picks = e.picks || {};
      S.exam.done = !!e.done;
      S.exam.idx = (e.idx | 0);
      S.exam.list = Core.examFiltered(T, S.exam.scope);
      S.examLimit = e.limit || 0;
    }
    const act = Core.load('activity'); if (act && typeof act === 'object') S.activity = act;
    const his = Core.load('history'); if (Array.isArray(his)) S.examHistory = his;
    const meta = Core.load('meta');
    if (meta && meta.themeMode) S.themeMode = meta.themeMode;
  }

  // ===== 主题（支持 跟随系统 / 浅 / 深）=====
  function effectiveTheme() {
    if (S.themeMode === 'auto') {
      return (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    return S.themeMode;
  }
  function applyTheme() {
    const th = effectiveTheme();
    S.theme = th;
    document.documentElement.setAttribute('data-theme', th);
    const btn = $('theme-toggle'); if (btn) btn.textContent = th === 'dark' ? '☀️' : '🌙';
  }

  // ===== 标签切换 =====
  // 收敛后：11 tab → 9 tab。outline/digest/mindmap 三份同树投影合并为「知识点大全」一个产物；
  // syllabus 升级为「考纲考点」（书馆 documents 官方生成），不再是降速通向空壳。
  const PAGES = ['dashboard', 'quiz', 'exam', 'wrong', 'stats', 'digest', 'syllabus', 'refs', 'settings'];
  function switchTab(tab) {
    S.tab = tab;
    document.querySelectorAll('.tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    PAGES.forEach(t => { const p = $('page-' + t); if (p) p.classList.toggle('hidden', t !== tab); });
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'quiz') { S._inDaily = false; renderQuiz(); }
    if (tab === 'exam') renderExam();
    if (tab === 'wrong') renderWrong();
    if (tab === 'stats') renderStats();
    if (tab === 'digest') renderDigest();
    if (tab === 'syllabus') renderSyllabus();
    if (tab === 'refs') renderRefs();
    if (tab === 'settings') renderSettings();
  }

  // ===== 备考中心 Dashboard（默认落地页）=====
  function studyStats() {
    const total = T.length;
    const answered = Object.keys(S.answers).length;
    const ok = Object.values(S.answers).filter(a => a.ok === true).length;
    const mastered = Object.keys(S.mastered).length;
    const wrong = Object.keys(S.wrong).length;
    const fav = Object.keys(S.favorites).length;
    return { total, answered, ok, mastered, wrong, fav, acc: answered ? Math.round(ok / answered * 100) : 0 };
  }
  function renderDashboard() {
    const st = studyStats();
    const mod = (tab, title, desc, cta) =>
      `<button class="mod-card" data-go="${tab}"><div class="mod-ico">${cta.ico}</div><div class="mod-title">${title}</div><div class="mod-desc">${desc}</div><div class="mod-go">${cta.label} →</div></button>`;
    let html = `<div class="dash-hero card">
      <div class="dash-hero-main"><h2>备考中心</h2><p class="dash-sub">${esc(META.title)} · 穷尽考纲、零反馈自测的本地复习系统。先练，再模考，最后查漏补缺。</p>
      <button class="btn" id="dash-daily">🎯 今日一练（随机 8 题）</button></div>
      <div class="dash-stats">
        <div class="stat"><div class="stat-n">${st.answered}<span class="stat-d">/${st.total}</span></div><div class="stat-l">已作答</div></div>
        <div class="stat"><div class="stat-n">${st.acc}<span class="stat-d">%</span></div><div class="stat-l">正确率</div></div>
        <div class="stat"><div class="stat-n">${st.mastered}</div><div class="stat-l">已掌握</div></div>
        <div class="stat"><div class="stat-n">${st.wrong}</div><div class="stat-l">错题</div></div>
        <div class="stat"><div class="stat-n">${st.fav}</div><div class="stat-l">收藏</div></div>
      </div></div>`;
    html += `<div class="mod-grid">`;
    html += mod('quiz', '练习', '按章节/题型逐题自测，答完即看解析。', { ico: '✍️', label: '去练习' });
    html += mod('exam', '模拟考', '仿真实考，交卷前不显示对错（零反馈）。', { ico: '⏱', label: '去模考' });
    html += mod('wrong', '错题本', `答错的题集中重做，可标记掌握、收藏。`, { ico: '📕', label: '去错题本' });
    html += mod('stats', '统计', '按章正确率雷达与薄弱点，看得见进步。', { ico: '📊', label: '看统计' });
    const hasSyl = !!(EXAM_OUTLINE && (EXAM_OUTLINE.sections || []).length);
    html += mod('digest', '知识点大全', K.length + ' 个知识点 + 题型整理，树形/大纲双视图；出题从这里选。', { ico: '📚', label: '看大全' });
    html += mod('syllabus', '考纲考点', hasSyl ? '重点至上 + 解释 + 重点记忆，考前速通。' : '还没生成考纲——去「资料」勾选后分析。', { ico: '🚀', label: '看考纲' });
    html += mod('settings', '设置', '主题、LLM 配置、重置进度。', { ico: '⚙️', label: '去设置' });
    html += `</div>`;
    $('page-dashboard').innerHTML = html;
    $('page-dashboard').querySelectorAll('.mod-card').forEach(b => b.onclick = () => switchTab(b.dataset.go));
    $('dash-daily').onclick = startDaily;
  }

  // ===== 单题 HTML 构造（练习 / 模拟考 / 每日一练共用；不写答案）=====
  function favStar(x) {
    const on = !!S.favorites[x.id];
    return `<button class="star ${on ? 'is-on' : ''}" data-fav="${esc(x.id)}" aria-label="收藏" title="收藏">${on ? '★' : '☆'}</button>`;
  }
  function buildQuestionHTML(x, a, isExam) {
    const name = isExam ? 'eans' : 'ans';
    let input = '';
    if (x.options) {
      input = `<div class="opts">` + x.options.map(o => {
        const v = o.trim()[0];
        return `<label class="opt"><input type="radio" name="${name}" value="${esc(v)}" ${a && a.input === v ? 'checked' : ''}/><span>${esc(o)}</span></label>`;
      }).join('') + `</div>`;
    } else if (A[x.id] && A[x.id].correct !== undefined) {
      input = `<div class="opts">
        <label class="opt"><input type="radio" name="${name}" value="对" ${a && a.input === '对' ? 'checked' : ''}/><span>对</span></label>
        <label class="opt"><input type="radio" name="${name}" value="错" ${a && a.input === '错' ? 'checked' : ''}/><span>错</span></label></div>`;
    } else {
      input = `<textarea class="field" id="${isExam ? 'eAns' : 'ansText'}" placeholder="写下你的答案再提交。填空请几个空都写；简答先自己组织一遍再对参考答案。">${a ? esc(a.input) : ''}</textarea>`;
    }
    const head = `<div class="qhead"><span class="tag">${esc(x.id)}</span><span class="tag">${esc(x.type)}</span><span class="tag">考纲 ${esc(x.kp)}</span><span class="tag">${esc(x.chLabel)}</span>${favStar(x)}</div>`;
    const stem = `<div class="stem">${esc(x.stem)}</div>`;
    return head + stem + input;
  }
  function wireFav(root) {
    (root || document).querySelectorAll('[data-fav]').forEach(b => b.onclick = () => {
      const id = b.dataset.fav;
      if (S.favorites[id]) delete S.favorites[id]; else S.favorites[id] = true;
      persist();
      const cur = S.tab;
      if (cur === 'quiz') renderQuiz(); else if (cur === 'exam') renderExam(); else if (cur === 'wrong') renderWrong(); else if (cur === 'dashboard') renderDashboard();
    });
  }

  // ===== 统一答案区（练习 / 模拟考复盘 / 错题本 / 历史复盘 四处共用）=====
  // 为什么收口：LLM 官方提示词要求每题给 solution(2-4 步) / rationale(≥2 句) / pitfalls / difficulty，
  // 之前只渲染 ans + why，等于把"分步解法/易错点/难度"全丢掉 —— 数据有、界面无，是静默失效。
  function listOf(v) { return Array.isArray(v) ? v.filter(x => x !== null && x !== undefined && String(x).trim() !== '') : []; }

  function answerDetailHTML(x) {
    const a = (x && A[x.id]) || {};
    const tr = (TRACE && TRACE.byQuestion && TRACE.byQuestion[x.id]) || null;
    const badge = !tr ? '' : (tr.quoteVerified
      ? `<span class="quote-badge ok">✓ 原文已核</span>`
      : `<span class="quote-badge warn">△ 原文未核</span>`);
    const steps = listOf(a.solution);
    const diff = String(a.difficulty || '').trim();
    let h = `<div class="ans-wrap">`;

    h += `<div class="ans-head"><b>参考答案</b>${diff ? `<span class="diff-tag">${esc(diff)}</span>` : ''}</div>`;
    h += `<div class="ans-main">${esc(a.ans || '（源数据未给答案）')}</div>`;

    if (steps.length) {
      h += `<div class="ans-sec"><div class="ans-label">分步解法</div><ol class="ans-steps">`
        + steps.map(s => `<li>${esc(s)}</li>`).join('') + `</ol></div>`;
    }
    if (String(a.why || '').trim()) {
      h += `<div class="ans-sec"><div class="ans-label">解析</div><p class="ans-p">${esc(a.why)}</p></div>`;
    }
    if (String(a.pitfalls || '').trim()) {
      h += `<div class="ans-sec is-pitfall"><div class="ans-label">易错点</div><p class="ans-p">${esc(a.pitfalls)}</p></div>`;
    }
    if (tr && tr.quote) {
      h += `<div class="ans-sec is-quote"><div class="ans-label">逐字原文 ${badge}</div><blockquote class="ans-quote">「${esc(tr.quote)}」</blockquote></div>`;
    }
    if (String(a.src || '').trim() || badge) {
      h += `<div class="ans-sec is-src"><div class="ans-label">依据</div><p class="ans-p">${esc(a.src || '')}${tr && tr.quote ? '' : badge}</p></div>`;
    }
    h += `</div>`;
    return h;
  }

  function showResult(x, a, container) {
    const el = $(container); if (!el) return;
    let v = '', cls = '';
    if (a.ok === true) { v = '✓ 答对了'; cls = 'ok'; }
    else if (a.ok === false) { v = '✗ 答错了'; cls = 'bad'; }
    else { v = '参考答案已给出，自己勾一下对错'; cls = 'self'; }
    let html = `<div class="result"><div class="verdict ${cls}">${v}</div>`;
    html += answerDetailHTML(x);
    if (a.ok === null) html += `<div class="qbar"><button class="btn" id="selfOk">我答对了</button><button class="btn btn--ghost" id="selfBad">没答对</button></div>`;
    html += `</div>`;
    el.innerHTML = html;
    const afterGrade = ok => {
      const rec = { ok, input: a.input }; S.answers[x.id] = rec;
      if (ok === true) delete S.wrong[x.id]; else S.wrong[x.id] = true;
      addActivity(1);
      persist(); showResult(x, rec, container);
      if (!S._inDaily) { const li = quizList(); if (S.qIdx < li.length - 1) { const token = ++S._jump; setTimeout(() => { if (S._jump !== token) return; S.qIdx = (S.qIdx + 1) % li.length; renderQuiz(); }, 600); } }
    };
    if ($('selfOk')) $('selfOk').onclick = () => afterGrade(true);
    if ($('selfBad')) $('selfBad').onclick = () => afterGrade(false);
  }

  // ===== 练习 =====
  function quizList() {
    return Core.quizFilter(T, { chKey: S.qChKey, type: S.qType, hideMastered: S.hideMastered, wrongOnly: S.wrongOnly, mastered: S.mastered, wrong: S.wrong });
  }
  function renderQuiz() {
    const chap = [{ chKey: '全部章节', chLabel: '全部章节' }].concat(CHAPTERS);
    if (!$('q-chapter').options.length) $('q-chapter').innerHTML = chap.map(c => `<option value="${esc(c.chKey)}">${esc(c.chLabel)}</option>`).join('');
    const typs = ['全部题型'].concat(TYPES);
    if (!$('q-type').options.length) $('q-type').innerHTML = typs.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('q-chapter').value = S.qChKey; $('q-type').value = S.qType;
    $('q-hideMastered').checked = S.hideMastered; $('q-wrongOnly').checked = S.wrongOnly;

    const list = quizList();
    $('q-count').textContent = `${list.length} / ${T.length} 题`;
    $('q-pills').innerHTML = list.map((x, i) => {
      const a = S.answers[x.id];
      const cls = a ? (a.ok === true ? 'is-done' : (a.ok === false ? 'is-wrong' : '')) : (S.mastered[x.id] ? 'is-done' : '');
      return `<button class="pill ${cls} ${i === S.qIdx ? 'is-current' : ''}" data-i="${i}">${esc(String(i + 1))}</button>`;
    }).join('');
    $('q-pills').querySelectorAll('.pill').forEach(b => b.onclick = () => { S._jump++; S.qIdx = +b.dataset.i; renderQuiz(); });

    const done = list.filter(x => S.answers[x.id]).length;
    const ok = list.filter(x => S.answers[x.id] && S.answers[x.id].ok === true).length;
    $('q-progress').textContent = `本筛选已答 ${done} / ${list.length} 题，答对 ${ok} 题`;

    const main = $('q-main');
    if (!list.length) { main.innerHTML = '<div class="empty">这个筛选下没有题，换一章、换题型，或关掉「只练错题／隐藏已掌握」。</div>'; return; }
    if (S.qIdx >= list.length) S.qIdx = 0;
    const x = list[S.qIdx], a = S.answers[x.id];

    const qhtml = buildQuestionHTML(x, a, false);
    let html = `<div class="qcard">${qhtml}`;
    html += `<div class="qbar${window.innerWidth < 768 ? ' sticky-bottom' : ''}">`;
    html += `<button class="btn" id="submit">提交答案</button>`;
    html += `<button class="btn btn--ghost" id="prev">上一题</button>`;
    html += `<button class="btn btn--ghost" id="next">下一题</button>`;
    html += `<span class="qcount">第 ${S.qIdx + 1} / ${list.length} 题　<label class="switch"><input type="checkbox" id="mast" ${S.mastered[x.id] ? 'checked' : ''}/> 已掌握</label></span>`;
    html += `</div><div id="result"></div></div>`;
    main.innerHTML = html;
    wireFav(main);

    $('mast').onchange = e => { S._jump++; if (e.target.checked) S.mastered[x.id] = true; else delete S.mastered[x.id]; persist(); renderQuiz(); };
    $('prev').onclick = () => { S._jump++; S.qIdx = (S.qIdx - 1 + list.length) % list.length; renderQuiz(); };
    $('next').onclick = () => { S._jump++; S.qIdx = (S.qIdx + 1) % list.length; renderQuiz(); };
    if (a) showResult(x, a, 'result');
    $('submit').onclick = () => {
      let val = '';
      const r = document.querySelector('input[name=ans]:checked');
      if (r) val = r.value; else if ($('ansText')) val = $('ansText').value.trim();
      const ok = Core.gradeOne(A[x.id], val);
      const rec = { ok, input: val };
      S.answers[x.id] = rec;
      if (ok === true) delete S.wrong[x.id]; else if (ok === false) S.wrong[x.id] = true;
      if (ok === true || ok === false) addActivity(1);
      persist();
      showResult(x, rec, 'result');
      if (ok === true || ok === false) {
        const li = quizList();
        if (S.qIdx < li.length - 1) { const token = ++S._jump; setTimeout(() => { if (S._jump !== token) return; S.qIdx = (S.qIdx + 1) % li.length; renderQuiz(); }, 800); }
      }
    };
  }

  // ===== 模拟考（零反馈 + 计时）=====
  let timerHandle = null, timerStart = 0, timerLimit = 0;
  function clearTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }
  function fmt(sec) { sec = Math.max(0, Math.floor(sec)); const m = Math.floor(sec / 60), s = sec % 60; return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }
  function tickTimer() {
    const el = $('exam-timer'); if (!el) return;
    const elaps = (Date.now() - timerStart) / 1000;
    const ring = $('exam-ring');
    if (timerLimit > 0) {
      const remain = timerLimit - elaps;
      el.textContent = '剩 ' + fmt(remain);
      el.classList.toggle('is-warn', remain <= 300 && remain > 0);
      el.classList.toggle('is-over', remain <= 0);
      const frac = Math.max(0, Math.min(1, remain / timerLimit));
      const C = 2 * Math.PI * 15;
      const col = remain <= 0 ? 'var(--bad)' : (remain <= 300 ? 'var(--accent)' : 'var(--brand)');
      if (ring) ring.innerHTML = `<svg viewBox="0 0 36 36" width="34" height="34"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" stroke-width="3"/><circle cx="18" cy="18" r="15" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}" transform="rotate(-90 18 18)"/></svg>`;
      if (remain <= 0) { clearTimer(); doGradeExam(); return; }
    } else {
      el.textContent = '用时 ' + fmt(elaps);
      el.classList.remove('is-warn', 'is-over');
      const C = 2 * Math.PI * 15;
      if (ring) ring.innerHTML = `<svg viewBox="0 0 36 36" width="34" height="34"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--brand)" stroke-width="3" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="0" opacity=".35"/></svg>`;
    }
  }
  function ensureTimer() {
    timerLimit = S.examLimit || 0;
    if (S.exam.done) { clearTimer(); return; }
    if (timerHandle === null) { timerStart = Date.now(); tickTimer(); timerHandle = setInterval(tickTimer, 1000); }
  }
  function doGradeExam() {
    if (!S.exam.list.length) return;
    const cur = S.exam.list[S.exam.shuffled[S.exam.idx]];
    if (cur && S.exam.picks[cur.id] === undefined) {
      let val = '';
      const r = document.querySelector('input[name=eans]:checked');
      if (r) val = r.value; else if ($('eAns')) val = $('eAns').value.trim();
      if (val) Core.submitExam(S.exam, cur, val);
    }
    const answered = Object.keys(S.exam.picks).length;
    if (answered < S.exam.list.length) {
      if (!confirm(`还有 ${S.exam.list.length - answered} 题没答，确定交卷？`)) return;
    }
    const res = Core.gradeExam(S.exam, A); // 本地判分，不回写 picks
    addActivity(res.n); // 计入当日活动（判分后才记，不破坏零反馈）
    // 考试历史快照（纯本地，封顶 20）
    const usedSec = timerLimit > 0
      ? Math.round(Math.min(timerLimit, timerLimit - Math.max(0, timerLimit - (Date.now() - timerStart) / 1000)))
      : Math.round((Date.now() - timerStart) / 1000);
    S.examHistory.unshift({
      ts: Date.now(), date: ymd(new Date()), scope: S.exam.scope, limit: S.examLimit,
      total: res.total, n: res.n, ok: res.ok, usedSec,
      rows: res.rows.map(r => ({ id: r.item.id, input: S.exam.picks[r.item.id] != null ? S.exam.picks[r.item.id].input : '', grade: r.grade })),
    });
    if (S.examHistory.length > 20) S.examHistory.length = 20;
    clearTimer();
    persist();
    renderExam();
  }
  function renderExam() {
    const chap = [{ chKey: '全部章节', chLabel: '全部章节' }].concat(CHAPTERS);
    if (!$('exam-scope').options.length) $('exam-scope').innerHTML = chap.map(c => `<option value="${esc(c.chKey)}">${esc(c.chLabel)}</option>`).join('');
    if (!$('exam-limit').options.length) $('exam-limit').innerHTML = ['<option value="0">不限</option><option value="900">15 分钟</option><option value="1800">30 分钟</option><option value="2700">45 分钟</option><option value="3600">60 分钟</option><option value="5400">90 分钟</option>'].join('');
    $('exam-scope').value = S.examScope; $('exam-limit').value = String(S.examLimit || 0);

    const list = S.exam.list;
    const total = list.length;
    const answered = Object.keys(S.exam.picks).length;
    const pct = total ? Math.round(answered / total * 100) : 0;
    $('exam-fill').style.width = pct + '%';
    const pb = $('exam-progress-block');
    pb.setAttribute('role', 'progressbar'); pb.setAttribute('aria-valuemin', '0');
    pb.setAttribute('aria-valuemax', String(total)); pb.setAttribute('aria-valuenow', String(answered));
    pb.setAttribute('aria-label', '模拟考进度');
    $('exam-progress-lab').textContent = S.exam.done ? '已交卷' : `已作答 ${answered} / ${total}（不显示对错）`;
    $('exam-count').textContent = total ? `已答 ${answered} / ${total} · 剩 ${total - answered}` : '';
    const subBtn = $('exam-submit-all');
    subBtn.disabled = S.exam.done; subBtn.textContent = S.exam.done ? '已交卷' : '交卷';

    $('exam-pills').innerHTML = list.map((x, i) =>
      `<button class="pill ${S.exam.picks[x.id] !== undefined ? 'is-done' : ''} ${i === S.exam.idx ? 'is-current' : ''}" data-i="${i}">${esc(String(i + 1))}</button>`
    ).join('');
    $('exam-pills').querySelectorAll('.pill').forEach(b => b.onclick = () => { S.exam.idx = +b.dataset.i; renderExam(); });

    const main = $('exam-main');
    if (S.exam.done) { renderExamResult(main); return; }
    if (!list.length) { main.innerHTML = '<div class="empty">这个范围内没有题。</div>'; return; }
    ensureTimer();
    const x = list[S.exam.shuffled[S.exam.idx]];
    const a = S.exam.picks[x.id];
    const qhtml = buildQuestionHTML(x, a, true);
    const last = (S.exam.idx >= list.length - 1);
    let html = `<div class="qcard">${qhtml}`;
    html += `<div class="qbar${window.innerWidth < 768 ? ' sticky-bottom' : ''}">`;
    html += `<button class="btn" id="eSubmit">${last ? '交卷' : '提交答案'}</button>`;
    if (S.exam.idx > 0) html += `<button class="btn btn--ghost" id="ePrev">上一题</button>`;
    html += `<span class="qcount">第 ${S.exam.idx + 1} / ${list.length} 题</span>`;
    html += `</div><div id="examResult"></div></div>`;
    main.innerHTML = html;
    wireFav(main);
    if (S.exam.idx > 0) $('ePrev').onclick = () => { S.exam.idx = (S.exam.idx - 1 + list.length) % list.length; renderExam(); };
    $('eSubmit').onclick = () => {
      let val = '';
      const r = document.querySelector('input[name=eans]:checked');
      if (r) val = r.value; else if ($('eAns')) val = $('eAns').value.trim();
      Core.submitExam(S.exam, x, val); // ★ 只存 input，零反馈
      if (last) doGradeExam(); else { S.exam.idx++; persist(); renderExam(); }
    };
  }
  function renderExamResult(main) {
    const res = Core.gradeExam(S.exam, A); // 纯函数，重算结果
    const rows = res.rows;
    let html = `<div class="result"><div class="verdict ${res.ok >= Math.ceil(res.total * 0.6) ? 'ok' : 'bad'}">模拟考成绩：${res.ok} / ${res.total} 答对（作答 ${res.n} 题）</div>`;
    const weak = Core.weakByChapter(rows);
    html += `<div class="blk"><b>薄弱点汇总（按章正确率，标红＝低于 60%）</b></div><div class="weak-grid">`;
    weak.forEach(w => {
      const pct = Math.round(w.ok / w.total * 100);
      const cls = pct < 60 ? 'is-low' : (pct < 85 ? 'is-mid' : 'is-high');
      html += `<div class="weak-card ${cls}"><div class="ch">${esc(w.chLabel)}</div><div class="pct">${pct}%</div><div class="kg-type">${w.ok}/${w.total} 对</div></div>`;
    });
    html += `</div><div class="blk"><b>答错的题</b>（点任一题回看考纲对应编号）</div>`;
    const wrong = rows.filter(r => r.grade === false);
    html += wrong.length ? wrong.map(r => `<div class="highlight miss" style="cursor:pointer" data-kp="${esc(r.item.kp)}">${esc(r.item.id)} · ${esc(r.item.type)} · 考纲 ${esc(r.item.kp)}<br><span class="kg-type">${esc(r.item.src)}</span></div>`).join('') : '<p>没有答错的题，全对！</p>';
    html += `</div><h2 style="margin-top:18px">逐题解析</h2>`;
    rows.forEach(r => {
      const v = r.grade === true ? '✓ 答对' : (r.grade === false ? '✗ 答错' : '— 自评');
      const cls = r.grade === true ? 'ok' : (r.grade === false ? 'bad' : 'self');
      html += `<div class="result"><div class="verdict ${cls}">${esc(r.item.id)} · ${esc(r.item.type)} · ${v}</div>${answerDetailHTML(r.item)}</div>`;
    });
    html += `<div class="qbar"><button class="btn" id="examRestart">重做本卷</button></div>`;
    main.innerHTML = html;
    main.querySelectorAll('.miss').forEach(el => el.onclick = () => { const kp = el.dataset.kp.split(/[–—、,，]/)[0].trim(); S.oQ = kp; S.oChKey = '全部章节'; switchTab('outline'); });
    $('examRestart').onclick = () => { Core.resetExam(S.exam, T, S.examScope); S.examLimit = timerLimit || S.examLimit; persist(); clearTimer(); renderExam(); };
  }

  // ===== 错题本 / 收藏 =====
  function renderWrong() {
    const wantFav = S.wrongView === 'fav';
    const ids = Object.keys(wantFav ? S.favorites : S.wrong);
    $('wrong-count').textContent = wantFav ? `${ids.length} 条收藏` : `${ids.length} 道错题`;
    document.querySelectorAll('#page-wrong .seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.view === S.wrongView));
    if (!ids.length) { $('wrong-main').innerHTML = `<div class="empty">${wantFav ? '还没有收藏任何题。做题时点题号旁的 ☆ 即可收藏。' : '暂无错题，全部做对了！'}</div>`; return; }
    const items = ids.map(id => T.find(x => x.id === id)).filter(Boolean);
    let html = '';
    items.forEach(x => {
      const a = S.answers[x.id];
      const verdict = a && a.ok === true ? '<span class="tag tag--accent">已改对</span>' : '';
      html += `<div class="wrong-item card" data-id="${esc(x.id)}">
        <div class="wrong-head"><span class="tag">${esc(x.id)}</span><span class="tag">${esc(x.type)}</span><span class="tag">${esc(x.chLabel)}</span>${verdict}<button class="star ${S.favorites[x.id] ? 'is-on' : ''}" data-fav="${esc(x.id)}" aria-label="收藏">${S.favorites[x.id] ? '★' : '☆'}</button></div>
        <div class="wrong-stem">${esc(x.stem)}</div>
        <div class="wrong-actions">
          <button class="btn btn--ghost" data-redo="${esc(x.id)}">重做</button>
          <button class="btn btn--ghost" data-master="${esc(x.id)}">标记掌握</button>
          <button class="btn btn--ghost" data-explain="${esc(x.id)}">看解析</button>
        </div>
        <div class="wrong-explain" id="ex-${esc(x.id)}" hidden>${answerDetailHTML(x)}</div>
      </div>`;
    });
    $('wrong-main').innerHTML = html;
    wireFav($('wrong-main'));
    $('wrong-main').querySelectorAll('[data-redo]').forEach(b => b.onclick = () => { S.qChKey = T.find(x => x.id === b.dataset.redo).chKey; S.qType = '全部题型'; S.wrongOnly = false; S.qIdx = 0; switchTab('quiz'); });
    $('wrong-main').querySelectorAll('[data-master]').forEach(b => b.onclick = () => { const id = b.dataset.master; S.mastered[id] = true; delete S.wrong[id]; persist(); renderWrong(); });
    $('wrong-main').querySelectorAll('[data-explain]').forEach(b => b.onclick = () => { const el = $('ex-' + b.dataset.explain); if (el) el.hidden = !el.hidden; });
  }

  // ===== 统计可视化辅助（热力图 / 章节条形 / 考试历史，全 0 依赖）=====
  function heatmapHTML() {
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const start = new Date(end); start.setDate(end.getDate() - 125);
    start.setDate(start.getDate() - start.getDay()); // 对齐到周日
    const cells = []; let d = new Date(start);
    while (d <= end) {
      const key = ymd(d); const c = S.activity[key] || 0;
      const b = c === 0 ? 'h0' : (c <= 2 ? 'h1' : (c <= 4 ? 'h2' : 'h3'));
      cells.push(`<div class="heat-cell ${b}" title="${key} · ${c} 题"></div>`);
      d.setDate(d.getDate() + 1);
    }
    let weeks = '';
    for (let i = 0; i < cells.length; i += 7) weeks += `<div class="heat-week">${cells.slice(i, i + 7).join('')}</div>`;
    const days = Object.keys(S.activity).length;
    const tot = Object.values(S.activity).reduce((a, b) => a + b, 0);
    return `<div class="heatmap"><div class="heat-grid">${weeks}</div>
      <div class="heat-legend">共 <b>${days}</b> 个练习日 · 累计 <b>${tot}</b> 题
        <span class="hlg"><i class="h0"></i>0</span><span class="hlg"><i class="h1"></i>1-2</span><span class="hlg"><i class="h2"></i>3-4</span><span class="hlg"><i class="h3"></i>5+</span></div></div>`;
  }
  function chapterBarsHTML(ca) {
    const rows = ca.map(c => {
      const pct = c.acc == null ? 0 : Math.round(c.acc * 100);
      const cls = c.acc == null ? 'is-none' : (pct < 60 ? 'is-low' : (pct < 85 ? 'is-mid' : 'is-high'));
      const lab = c.acc == null ? `${c.chLabel} · 未练` : `${c.chLabel} · ${c.ok}/${c.total} 对`;
      return `<div class="chbar-row"><div class="chbar-lab">${esc(c.chLabel)}</div><div class="chbar-track"><div class="chbar-fill ${cls}" style="width:${pct}%"></div></div><div class="chbar-pct ${cls}">${c.acc == null ? '—' : pct + '%'}</div></div>`;
    }).join('');
    return `<div class="chbar">${rows}</div>`;
  }
  function historyHTML() {
    if (!S.examHistory.length) return '<p class="kg-type">还没有模拟考记录。去「模拟考」做一场，这里会出现可逐题复盘的考试历史（纯本地保存，不联网）。</p>';
    const items = S.examHistory.map((h, i) => {
      const dt = fmt(h.usedSec);
      const detail = h.rows.map(r => {
        const x = T.find(t => t.id === r.id); if (!x) return '';
        const v = r.grade === true ? '✓ 答对' : (r.grade === false ? '✗ 答错' : '— 自评');
        const cls = r.grade === true ? 'ok' : (r.grade === false ? 'bad' : 'self');
        return `<div class="result"><div class="verdict ${cls}">${esc(x.id)} · ${esc(x.type)} · ${v}</div><div class="ans-sec is-mine"><div class="ans-label">你的作答</div><p class="ans-p">${esc(r.input || '（空）')}</p></div>${answerDetailHTML(x)}</div>`;
      }).join('');
      return `<div class="hist-item"><button class="hist-head" data-h="${i}"><span><b>第 ${i + 1} 场</b> · ${esc(h.date)} · ${esc(h.scope)} · ${h.ok}/${h.total} 对（作答 ${h.n}）· 用时 ${dt}</span><span class="hist-go">复盘 ▾</span></button><div class="hist-detail" id="hist-${i}" hidden>${detail}</div></div>`;
    }).join('');
    return `<div class="hist-list">${items}</div>`;
  }

  // ===== 统计（纯 inline SVG，0 依赖）=====
  function chapterAccuracy() {
    const m = {};
    CHAPTERS.forEach(c => m[c.chKey] = { chKey: c.chKey, chLabel: c.chLabel, total: 0, ok: 0 });
    Object.keys(S.answers).forEach(id => {
      const x = T.find(t => t.id === id); if (!x || !m[x.chKey]) return;
      m[x.chKey].total++; if (S.answers[id].ok === true) m[x.chKey].ok++;
    });
    return CHAPTERS.map(c => { const o = m[c.chKey]; return { chLabel: c.chLabel, acc: o.total ? o.ok / o.total : null, total: o.total, ok: o.ok }; });
  }
  function radarSVG(axes, vals) {
    const n = axes.length, cx = 110, cy = 110, R = 88;
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
    const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
    let grid = '', poly = '';
    for (let g = 1; g <= 4; g++) {
      const rr = R * g / 4; const pts = axes.map((_, i) => pt(i, rr).map(v => v.toFixed(1)).join(',')).join(' ');
      grid += `<polygon points="${pts}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
    }
    axes.forEach((a, i) => { const [x, y] = pt(i, R); grid += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${pt(i, R + 14)[0].toFixed(1)}" y="${pt(i, R + 14)[1].toFixed(1)}" font-size="11" fill="var(--ink-3)" text-anchor="middle">${esc(a)}</text>`; });
    const data = axes.map((_, i) => pt(i, R * (vals[i] == null ? 0 : vals[i])).map(v => v.toFixed(1)).join(','));
    poly = `<polygon points="${data}" fill="rgba(47,111,237,.18)" stroke="var(--brand)" stroke-width="2"/>`;
    axes.forEach((a, i) => { const v = vals[i] == null ? 0 : vals[i]; const [x, y] = pt(i, R * v); poly += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--brand)"/>`; });
    return `<svg viewBox="0 0 220 220" width="100%" style="max-width:320px" role="img" aria-label="按章正确率雷达图"><rect width="220" height="220" fill="transparent"/>${grid}${poly}</svg>`;
  }
  function renderStats() {
    const st = studyStats();
    const ca = chapterAccuracy();
    const labels = ca.map(c => c.chLabel.replace('第', '').replace('章', '章').slice(0, 6));
    const vals = ca.map(c => c.acc == null ? 0 : c.acc);
    const weak = ca.filter(c => c.acc != null && c.acc < 0.6);
    let html = `<div class="card stat-hero"><h2>学习统计</h2>
      <div class="dash-stats">
        <div class="stat"><div class="stat-n">${st.answered}<span class="stat-d">/${st.total}</span></div><div class="stat-l">已作答</div></div>
        <div class="stat"><div class="stat-n">${st.acc}<span class="stat-d">%</span></div><div class="stat-l">整体正确率</div></div>
        <div class="stat"><div class="stat-n">${st.mastered}</div><div class="stat-l">已掌握</div></div>
        <div class="stat"><div class="stat-n">${st.wrong}</div><div class="stat-l">错题</div></div>
      </div></div>`;
    if (!st.answered) html += `<div class="card"><p class="empty">还没做过题。去「练习」或「模拟考」做几道，这里就会出现正确率雷达、章节条形、活动热力图与考试历史。</p></div>`;
    html += `<div class="card"><h3>按章正确率（雷达 + 条形）</h3>${radarSVG(labels, vals)}`;
    html += `<div class="legend">${ca.map(c => `<span class="lg"><i></i>${esc(c.chLabel)} ${c.acc == null ? '未练' : Math.round(c.acc * 100) + '%'}</span>`).join('')}</div>`;
    html += `<h4 class="sub-h">每章掌握度</h4>${chapterBarsHTML(ca)}</div>`;
    html += `<div class="card"><h3>薄弱章节（正确率＜60%）</h3>`;
    html += weak.length ? `<div class="weak-grid">${weak.map(w => `<div class="weak-card is-low"><div class="ch">${esc(w.chLabel)}</div><div class="pct">${Math.round(w.acc * 100)}%</div><div class="kg-type">${w.ok}/${w.total} 对</div></div>`).join('')}</div>` : '<p class="kg-type">目前没有低于 60% 的章节，保持！</p>';
    html += `</div>`;
    html += `<div class="card"><h3>练习活动热力图（近 18 周）</h3>${heatmapHTML()}</div>`;
    html += `<div class="card"><h3>模拟考历史（逐题复盘）</h3>${historyHTML()}</div>`;
    $('page-stats').innerHTML = html;
    $('page-stats').querySelectorAll('[data-h]').forEach(b => b.onclick = () => { const el = $('hist-' + b.dataset.h); if (el) el.hidden = !el.hidden; });
  }

  // ===== 今日一练（确定性种子，每天同一份）=====
  function startDaily() {
    const today = new Date().toISOString().slice(0, 10);
    if (S.daily.date !== today || !S.daily.list.length) {
      let h = 2166136261; for (let i = 0; i < today.length; i++) { h ^= today.charCodeAt(i); h = Math.imul(h, 16777619); }
      let seed = h >>> 0;
      const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const pool = T.slice(); const pick = [];
      while (pick.length < Math.min(8, pool.length) && pool.length) { const i = Math.floor(rng() * pool.length); pick.push(pool.splice(i, 1)[0].id); }
      S.daily = { date: today, list: pick, idx: 0 };
    }
    S._inDaily = true;
    switchTab('quiz');
    renderDaily();
  }
  function renderDaily() {
    const main = $('q-main');
    const list = S.daily.list.map(id => T.find(x => x.id === id)).filter(Boolean);
    if (!list.length) { main.innerHTML = '<div class="empty">今日一练暂无题目。</div>'; return; }
    $('q-count').textContent = `今日一练 ${list.length} 题`;
    $('q-pills').innerHTML = list.map((x, i) => `<button class="pill ${S.answers[x.id] ? 'is-done' : ''} ${i === S.daily.idx ? 'is-current' : ''}" data-i="${i}">${esc(String(i + 1))}</button>`).join('');
    $('q-pills').querySelectorAll('.pill').forEach(b => b.onclick = () => { S.daily.idx = +b.dataset.i; renderDaily(); });
    $('q-progress').textContent = `今日一练 · 第 ${S.daily.idx + 1} / ${list.length} 题`;
    const x = list[S.daily.idx], a = S.answers[x.id];
    const qhtml = buildQuestionHTML(x, a, false);
    let html = `<div class="qcard">${qhtml}`;
    html += `<div class="qbar${window.innerWidth < 768 ? ' sticky-bottom' : ''}">`;
    html += `<button class="btn" id="dSubmit">提交答案</button>`;
    html += `<button class="btn btn--ghost" id="dPrev">上一题</button>`;
    html += `<button class="btn btn--ghost" id="dNext">下一题</button>`;
    html += `</div><div id="dResult"></div></div>`;
    main.innerHTML = html;
    wireFav(main);
    if (a) showResult(x, a, 'dResult');
    $('dPrev').onclick = () => { S.daily.idx = (S.daily.idx - 1 + list.length) % list.length; renderDaily(); };
    $('dNext').onclick = () => { S.daily.idx = (S.daily.idx + 1) % list.length; renderDaily(); };
    $('dSubmit').onclick = () => {
      let val = '';
      const r = document.querySelector('input[name=ans]:checked');
      if (r) val = r.value; else if ($('ansText')) val = $('ansText').value.trim();
      const ok = Core.gradeOne(A[x.id], val);
      const rec = { ok, input: val };
      S.answers[x.id] = rec;
      if (ok === true) delete S.wrong[x.id]; else if (ok === false) S.wrong[x.id] = true;
      if (ok === true || ok === false) addActivity(1);
      persist(); showResult(x, rec, 'dResult');
      if (S.daily.idx < list.length - 1) { const token = ++S._jump; setTimeout(() => { if (S._jump !== token) return; S.daily.idx = (S.daily.idx + 1) % list.length; renderDaily(); }, 800); }
    };
  }

  // ===== 设置（主题 + 重置 + 资料说明）=====
  function renderSettings() {
    const st = studyStats();
    let html = `<div class="card"><h2>设置</h2>
      <div class="set-row"><span class="set-label">主题</span>
        <div class="seg" role="radiogroup" aria-label="主题模式">
          <button class="seg-btn ${S.themeMode === 'auto' ? 'is-active' : ''}" data-mode="auto">跟随系统</button>
          <button class="seg-btn ${S.themeMode === 'light' ? 'is-active' : ''}" data-mode="light">浅色</button>
          <button class="seg-btn ${S.themeMode === 'dark' ? 'is-active' : ''}" data-mode="dark">深色</button>
        </div>
      </div>
      <p class="kg-type">跟随系统＝按你电脑的深色模式自动切换；也可手动固定。</p>
      <div class="qbar" style="margin-top:var(--sp-4); flex-wrap:wrap">
        <button class="btn btn--ghost" id="clearQuiz">清除练习进度</button>
        <button class="btn btn--ghost" id="clearExam">清除模拟考</button>
        <button class="btn btn--ghost" id="clearAll">清除全部进度</button>
      </div></div>`;
    // LLM 配置卡：地址/模型/key 只存本机浏览器；分析时才随请求发给服务端，用完即弃不落盘
    const llmCfg = loadLLM();
    html += `<div class="card"><h2>LLM 分析配置</h2>
      <p class="kg-type">上传新资料后，用你配置的模型按官方提示词做增量分析。密钥只存本机浏览器，分析时临时发给服务端，不写进书、不落盘。</p>
      <div class="llm-form">
        <label class="label" for="llm-base">API 地址（OpenAI 兼容）</label>
        <input class="field" id="llm-base" placeholder="OpenAI 兼容地址，如服务商的 /v1 端点" value="${esc(llmCfg.baseURL || '')}" />
        <label class="label" for="llm-model">模型名</label>
        <input class="field" id="llm-model" placeholder="如 deepseek-chat" value="${esc(llmCfg.model || '')}" />
        <label class="label" for="llm-key">API Key</label>
        <input class="field" id="llm-key" type="password" autocomplete="off" placeholder="${llmCfg.apiKey ? '已保存（留空则不改）' : 'sk-...'}" value="" />
        <div class="qbar" style="margin-top:var(--sp-3)">
          <button class="btn" id="llm-save">保存配置</button>
          <button class="btn btn--ghost" id="llm-test">测试连接</button>
        </div>
        <p class="kg-type" id="llm-status" style="margin-top:var(--sp-2)"></p>
      </div></div>`;
    html += `<div class="card"><h2>这份备考系统依据了什么</h2>
      <p>${esc(META.syllabus || ('全部题目与考点来自本学科复习资料（本机抽取）。考纲只收资料里读得到的文字结论与符号。'))}</p>
      <h2>没收什么（诚实说明）</h2>
      <ul>
        <li><b>图内文字</b>：PPT 里图表上的字没能从文字层抽到。凡依赖图的点，用不依赖图的小题替代，不编相区顺序与图上数值。</li>
        <li><b>公式乱码</b>：课件公式文字层有乱码，只写能读出的文字结论；计算题按知识点自拟，不还原乱码公式。</li>
        <li><b>第十五章</b>：整页为图、无文字层，按「PPT 没有的不需要提」不收。</li>
      </ul>
      <h2>三个设计原则</h2>
      <p>① <b>穷尽覆盖</b>——考纲 ${K.length} 个考点全列出；② <b>零反馈自测</b>——模拟考交卷前绝不显示对错、答案、解析，逼你真回忆；③ <b>本地离线</b>——数据在你电脑上，不联网、不上传、不装渲染依赖。</p>
      <h2>进度存在哪</h2>
      <p>练习进度、已掌握、错题、收藏、模拟考会话都只存在<strong>本机浏览器</strong>。换浏览器、清缓存或换电脑不互通（刻意的无云端设计）。</p></div>`;
    $('page-settings').innerHTML = html;
    $('page-settings').querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.themeMode = b.dataset.mode; applyTheme(); persist(); renderSettings(); });
    $('clearQuiz').onclick = () => { if (confirm('清空练习进度、已掌握、错题本、收藏？不可恢复。')) { Core.save('quiz', null); Core.save('mastered', null); Core.save('wrong', null); Core.save('favorites', null); S.answers = {}; S.mastered = {}; S.wrong = {}; S.favorites = {}; location.reload(); } };
    $('clearExam').onclick = () => { if (confirm('清空当前模拟考会话？不可恢复。')) { Core.save('exam', null); location.reload(); } };
    $('clearAll').onclick = () => { if (confirm('清空本机所有进度（练习/已掌握/错题/收藏/模拟考）？此操作不可恢复。')) { Core.clearAll(); location.reload(); } };
    // LLM 配置：保存只写 localStorage；测试走同源 /api/llm/test（服务端不落盘）
    const readLLMForm = () => {
      const cfg = loadLLM();
      cfg.baseURL = $('llm-base').value.trim();
      cfg.model = $('llm-model').value.trim();
      const k = $('llm-key').value.trim();
      if (k) cfg.apiKey = k; // 留空＝沿用已保存的 key
      return cfg;
    };
    $('llm-save').onclick = () => {
      const cfg = readLLMForm();
      if (!cfg.baseURL || !cfg.model) { $('llm-status').textContent = '请填 API 地址与模型名。'; return; }
      saveLLM(cfg);
      $('llm-status').textContent = '已保存在本机浏览器。';
      $('llm-key').value = '';
    };
    $('llm-test').onclick = async () => {
      const cfg = readLLMForm();
      if (!cfg.baseURL || !cfg.model) { $('llm-status').textContent = '请先填 API 地址与模型名。'; return; }
      $('llm-status').textContent = '测试中…';
      try {
        const r = await (window.TiandaoApi ? fetch('/api/llm/test', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ llm: cfg })
        }) : null);
        if (!r) { $('llm-status').textContent = '直开文件模式不支持测试；请用本地服务打开。'; return; }
        const j = await r.json();
        $('llm-status').textContent = j.ok
          ? ('连接成功' + (j.models && j.models.length ? '（可用模型 ' + j.models.length + ' 个）' : ''))
          : ('连接失败：' + String(j.error || '').slice(0, 120));
        if (j.ok) saveLLM(cfg);
      } catch (e) { $('llm-status').textContent = '测试失败：' + String(e.message || e).slice(0, 120); }
    };
  }

  // ===== 参考资料（零云端 · 纯本地文件）=====
  // ===== 考点大全（书馆能力：逐字原文引用 + 原文已核徽章，罗盘 card 呈现）=====
  function quoteBadge(p) {
    return p.quoteVerified ? '<span class="quote-badge ok">✓ 原文已核</span>'
                           : '<span class="quote-badge warn">△ 未核</span>';
  }
  // ===== 知识点大全（核心产物①：知识点 + 题型整理，树形/大纲双视图）=====
  // 用户明确"不要保留重复的"——原 outline/digest/mindmap 是同一棵树的三份投影，
  // 这里合并成一个产物，树形只是它的一种视图（吃掉原 mindmap tab）。
  function renderKnowledgeTree() {
    const root = (MINDMAP && MINDMAP.tree) || null;
    if (!root) return '<div class="card"><p class="empty">这本书还没有知识点结构。</p></div>';
    const quizByKp = {};
    T.forEach(q => { if (q.kp) (quizByKp[q.kp] = quizByKp[q.kp] || []).push(q); });
    let html = `<div class="card"><h3>${esc(root.title || '知识结构')}</h3><div class="map-tree">`;
    (root.children || []).filter(c => (c.type || '') === 'chapter').forEach((ch, ci) => {
      const chNo = ci + 1;
      html += `<details class="map-ch" open><summary><b>第 ${chNo} 章 · ${esc(ch.title || '')}</b></summary>`;
      let si = 0;
      (ch.children || []).forEach(sec => {
        if ((sec.type || '') !== 'section') return;
        si++;
        const secCode = chNo + '.' + si;
        html += `<details class="map-sec" open><summary>${esc(sec.title || secCode)}</summary><div class="map-pts">`;
        let pi = 0;
        (sec.children || []).forEach(pt => {
          if ((pt.type || '') !== 'point') return;
          pi++;
          const code = secCode + '.' + pi;
          const qs = quizByKp[secCode] || [];
          html += `<div class="map-point">
            <div class="mp-head"><span class="tag">${esc(code)}</span><b>${esc(pt.title || '')}</b></div>
            <div class="mp-desc">${esc(pt.desc || '')}</div>`;
          if (qs.length) html += `<div class="mp-quiz">${qs.map(q => `<button class="btn btn--ghost mp-q" data-q="${esc(q.id)}">${esc(q.id)} · ${esc(q.stem.slice(0, 40))}${q.stem.length > 40 ? '…' : ''}</button>`).join('')}</div>`;
          html += `</div>`;
        });
        if (!(sec.children || []).some(c => (c.type || '') === 'point')) html += `<div class="mp-desc">本节无细分知识点（源数据如此，不编造）。</div>`;
        html += `</div></details>`;
      });
      html += `</details>`;
    });
    return html + `</div></div>`;
  }
  function renderDigest() {
    const p = $('page-digest');
    const secs = (DIGEST && DIGEST.sections) || [];
    const totalPts = K.length || secs.reduce((n, s) => n + (s.points || []).length, 0);
    let html = `<div class="card"><div class="digest-head">
      <div><h2>知识点大全</h2><p class="kg-type">${K.length} 个知识点 · ${T.length} 道题（知识点 + 题型整理）· 出题从这里选</p></div>
      <div class="seg" role="tablist" aria-label="知识点大全视图">
        <button class="seg-btn ${DIGEST_VIEW === 'outline' ? 'is-active' : ''}" data-dview="outline">大纲</button>
        <button class="seg-btn ${DIGEST_VIEW === 'tree' ? 'is-active' : ''}" data-dview="tree">树形</button>
      </div></div></div>`;
    if (DIGEST_VIEW === 'tree') {
      html += renderKnowledgeTree();
    } else if (!K.length) {
      html += '<div class="card"><p class="empty">还没有知识点。去「资料」上传并勾选「知识点大全」分析。</p></div>';
    } else {
      // 大纲视图＝原考纲表格（知识点 + 对应题型）的复用，按章分组；带 ▲ 为重点
      const groups = [];
      K.forEach(r => {
        const key = r.chKey + ' ｜ ' + r.sec;
        if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, rows: [] });
        groups[groups.length - 1].rows.push(r);
      });
      groups.forEach(g => {
        html += `<div class="card doc-sec"><div class="kg-sec">${esc(g.key)}</div>
          <table class="kg-table"><thead><tr><th style="width:92px">编号</th><th>知识点 / 说明</th><th style="width:200px">对应题型 · 可练</th></tr></thead><tbody>`;
        g.rows.forEach(r => {
          const types = listOf(r.questionTypes);
          const subs = listOf(r.subs);
          const qids = listOf(r.qIds);
          html += `<tr class="${r.hot ? 'is-hot' : ''}">
            <td class="kg-id">${esc(r.id)}${r.hot ? '<div style="margin-top:4px"><span class="tag tag--accent">▲重点</span></div>' : ''}</td>
            <td class="kg-text">
              <div class="kp-t">${esc(r.title || r.text)}</div>
              ${r.desc ? `<div class="kp-d">${esc(r.desc)}</div>` : ''}
              ${subs.length ? `<ul class="kp-subs">${subs.map(s => `<li><b>${esc(s.title)}</b>${s.desc ? '：' + esc(s.desc) : ''}</li>`).join('')}</ul>` : ''}
            </td>
            <td class="kg-type">
              ${types.length ? types.map(t => `<span class="tag">${esc(t)}</span>`).join(' ') : '<span class="tag">综合</span>'}
              ${qids.length
                ? `<div class="kp-nq">${qids.map(id => `<button class="btn btn--ghost kp-qbtn" data-q="${esc(id)}">${esc(id)}</button>`).join('')}</div>`
                : `<div class="kp-nq muted">暂无对应题</div>`}
            </td>
          </tr>`;
        });
        html += '</tbody></table></div>';
      });
      // 详解原文（若分析生成了 digest.sections）折叠附在表格后
      if (secs.length) {
        html += `<details class="card doc-sec"><summary><b>逐字原文详解（${secs.reduce((n, s) => n + (s.points || []).length, 0)} 条）</b></summary>`;
        secs.forEach(s => {
          html += `<h3>${esc(s.chapter || '')}</h3>`;
          (s.points || []).forEach(pt => {
            html += `<div class="doc-point"><div class="doc-point-title">${esc(pt.title || '')}</div>
              <div class="doc-point-detail">${esc(pt.detail || '')}</div>`;
            if (pt.quote) html += `<blockquote class="doc-quote">「${esc(pt.quote)}」<div class="doc-quote-src">${esc(pt.source || '')} ${quoteBadge(pt)}</div></blockquote>`;
            html += `</div>`;
          });
        });
        html += `</details>`;
      }
    }
    p.innerHTML = html;
    p.querySelectorAll('[data-dview]').forEach(b => b.onclick = () => { DIGEST_VIEW = b.dataset.dview; renderDigest(); });
    p.querySelectorAll('.mp-q, .kp-qbtn').forEach(b => b.onclick = () => {
      const id = b.dataset.q; S.qChKey = '全部章节'; S.qType = '全部题型'; S._inDaily = false;
      const idx = quizList().findIndex(q => q.id === id); if (idx >= 0) S.qIdx = idx;
      switchTab('quiz');
    });
  }

  // ===== 考纲考点（核心产物②：重点至上 + 解释 + 重点记忆，书馆 documents 官方生成）=====
  function renderSyllabus() {
    const p = $('page-syllabus');
    const secs = (EXAM_OUTLINE && EXAM_OUTLINE.sections) || (SYLLABUS && SYLLABUS.sections) || [];
    const genAt = EXAM_OUTLINE && EXAM_OUTLINE.generatedAt;
    let html = `<div class="card"><h2>考纲 · 考点</h2>
      <p class="kg-type">重点至上 · 每点给必背解释 + 公式 + 自编例题（分步）+ 逐字原文 · 考前速通${genAt ? ' · 生成于 ' + esc(String(genAt).slice(0, 10)) : ''}</p></div>`;
    if (!secs.length) { p.innerHTML = html + '<div class="card"><p class="empty">还没生成考纲。去「资料」上传资料后勾选「考纲考点」分析。</p></div>'; return; }
    secs.forEach(s => {
      html += `<div class="card doc-sec syl-sec"><div class="syl-head"><span class="rank">#${esc(s.rank || 0)}</span><h3>${esc(s.chapter || '')}</h3></div>`;
      if (s.why) html += `<p class="syl-why">为什么重要：${esc(s.why)}</p>`;
      (s.points || []).forEach(pt => {
        html += `<div class="doc-point">
          <div class="doc-point-title">${esc(pt.title || '')}${pt.importance ? ` <span class="imp">重点·${esc(pt.importance)}</span>` : ''}</div>`;
        if (pt.must) html += `<div class="syl-row"><b>必背解释</b><span>${esc(pt.must)}</span></div>`;
        if ((pt.formulas || []).length) html += `<div class="syl-row"><b>公式</b><span>${pt.formulas.map(esc).join(' · ')}</span></div>`;
        if (pt.question && typeof pt.question === 'object') {
          html += `<div class="syl-row"><b>自编例题</b><span>${esc(pt.question.stem || '')}</span></div>`;
          if (pt.question.answer) html += `<div class="syl-row"><b>答案</b><span>${esc(pt.question.answer)}</span></div>`;
          if (listOf(pt.question.steps).length) html += `<div class="syl-row"><b>分步做法</b><ol class="ans-steps syl-steps">${listOf(pt.question.steps).map(st => `<li>${esc(st)}</li>`).join('')}</ol></div>`;
        } else if (pt.question) html += `<div class="syl-row"><b>自编例题</b><span>${esc(pt.question)}</span></div>`;
        if (pt.quote) html += `<blockquote class="doc-quote">「${esc(pt.quote)}」<div class="doc-quote-src">${esc(pt.source || '')} ${quoteBadge(pt)}</div></blockquote>`;
        html += `</div>`;
      });
      html += `</div>`;
    });
    p.innerHTML = html;
  }

  function renderRefs() {
    const p = $('page-refs');
    const refs = (REFS && REFS.length) ? REFS : ((window.BOOK_REFS && window.BOOK_REFS[META.id]) || []);
    const online = !!(window.TiandaoApi && !window.TiandaoApi.isFile());
    const analyzed = (TRACE && TRACE.analyzedFiles) || [];
    let html = `<div class="card"><h2>资料与分析</h2>
      <p class="kg-type">${online ? 'PDF / PPT / Word / 图片 / TXT / MD / CSV 都能拖入。勾选要生成的产物 → 点「开始分析」→ LLM 按书馆官方提示词只分析新增部分，合并进知识点大全 / 考纲考点。' : '当前是直开文件模式，只能阅读已有资料；上传与分析需用本地服务打开（npm start）。'}</p>
      ${online ? `<div class="upload-zone" id="upload-zone">
        <div class="upload-drop" id="upload-drop">拖入资料文件，或 <label class="link-like">点此选择<input type="file" id="upload-input" multiple hidden accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.bmp,.webp,.txt,.md,.csv" /></label></div>
        <div class="upload-options">
          <label class="switch"><input type="checkbox" id="upload-focus" /> 标为重点资料 ★</label>
          <label class="label" for="upload-note">为什么重要（可选）</label>
          <input class="field" id="upload-note" placeholder="一句话说明，分析时会告诉模型重点看什么" />
          <span class="label" style="margin-top:var(--sp-2)">分析生成哪些（可多选，只处理新增资料）</span>
          <div class="target-choices">
            <label class="switch"><input type="checkbox" id="tg-all" checked /> 全选</label>
            <label class="switch"><input type="checkbox" class="tg-item" data-tg="knowledge" checked /> 知识点大全（知识点+题型）</label>
            <label class="switch"><input type="checkbox" class="tg-item" data-tg="syllabus" checked /> 考纲考点（重点+解释+记忆）</label>
          </div>
        </div>
        <div class="qbar" style="margin-top:var(--sp-2)">
          <button class="btn" id="upload-do">上传</button>
          <button class="btn btn--ghost" id="analyze-do">开始分析（只分析新增）</button>
        </div>
        <p class="kg-type" id="upload-status" style="margin-top:var(--sp-2)">${esc(UPLOAD_MSG)}</p>
      </div>` : ''}
    </div>`;
    html += `<div class="card"><h2>资料清单</h2><p class="kg-type">共 ${refs.length} 份${analyzed.length ? ' · 已分析 ' + analyzed.length + ' 份' : ''}</p><div class="ref-grid">`;
    if (!refs.length) html += `<p class="empty">还没有资料。${online ? '用上方上传区添加。' : ''}</p>`;
    refs.forEach((r, i) => {
      const ico = r.type === 'pdf' ? '📄' : (r.type === 'word' ? '📝' : (r.type === 'ppt' ? '📊' : '📃'));
      const isAnalyzed = analyzed.indexOf(r.name) >= 0;
      html += `<div class="ref-card${r.focus ? ' is-focus' : ''}">
        <div class="ref-ico">${ico}${r.focus ? '<span class="focus-star" title="语义重点">★</span>' : ''}</div>
        <div class="ref-name">${esc(r.name)}</div>
        <div class="ref-type">${esc((r.type || '').toUpperCase())}${r.focus ? ' · 重点' : ''}${isAnalyzed ? ' · <span class="ok-text">已分析</span>' : ' · <span class="warn-text">待分析</span>'}</div>
        ${r.note ? `<div class="ref-note">${esc(r.note)}</div>` : ''}
        <button class="btn" data-ref="${i}">${r.type === 'pdf' || r.type === 'txt' || r.type === 'md' ? '阅读' : '下载'}</button>
      </div>`;
    });
    html += `</div></div><div class="card" id="ref-viewer"></div>`;
    p.innerHTML = html;
    p.querySelectorAll('[data-ref]').forEach(b => b.onclick = () => openRef(refs[+b.dataset.ref]));
    if (online) wireUpload();
  }
  function wireUpload() {
    const zone = $('upload-drop'), input = $('upload-input'), status = $('upload-status');
    let picked = [];
    function setPicked(files) {
      picked = Array.from(files || []);
      if (zone) zone.textContent = picked.length
        ? ('已选 ' + picked.length + ' 个文件：' + picked.map(f => f.name).join('、') + '（可继续拖入或点此选择）')
        : '拖入资料文件，或点此选择';
    }
    if (input) input.onchange = e => setPicked(e.target.files);
    if (zone) {
      zone.ondragover = e => { e.preventDefault(); zone.classList.add('is-over'); };
      zone.ondragleave = () => zone.classList.remove('is-over');
      zone.ondrop = e => { e.preventDefault(); zone.classList.remove('is-over'); setPicked(e.dataTransfer.files); };
    }
    const doUpload = $('upload-do');
    if (doUpload) doUpload.onclick = async () => {
      if (!picked.length) { status.textContent = '请先选择或拖入文件。'; return; }
      status.textContent = '上传中…';
      try {
        const fd = new FormData();
        picked.forEach(f => fd.append('files', f, f.name));
        const focus = $('upload-focus').checked ? picked.map(f => f.name).join(',') : '';
        const note = $('upload-note').value.trim();
        if (focus) fd.append('focus', focus);
        if (note) fd.append('notes', picked.map(f => f.name + '=' + note).join('\n'));
        const r = await fetch('/api/books/' + encodeURIComponent(META.id) + '/upload', { method: 'POST', body: fd });
        const j = await r.json();
        if (!r.ok) { status.textContent = '上传失败：' + String(j.error || '').slice(0, 120); return; }
        UPLOAD_MSG = '已上传 ' + j.saved.length + ' 份。现在点「开始分析」让 LLM 学习新增内容。';
        status.textContent = UPLOAD_MSG;
        picked = []; setPicked([]);
        // 从服务端刷新全局数据：只 renderRefs 会读到旧的模块变量 REFS（4 份），界面与真源不一致
        const fresh = await (window.TiandaoApi ? window.TiandaoApi.getBook(META.id) : null);
        if (fresh && window.BookApp) window.BookApp.boot(fresh, true);
        else renderRefs();
      } catch (e) { status.textContent = '上传失败：' + String(e.message || e).slice(0, 120); }
    };
    // 全选 ↔ 单项 联动
    const tgAll = $('tg-all'), tgItems = Array.from(document.querySelectorAll('.tg-item'));
    if (tgAll) tgAll.onchange = () => tgItems.forEach(c => { c.checked = tgAll.checked; });
    tgItems.forEach(c => c.onchange = () => {
      const allOn = tgItems.every(x => x.checked);
      if (tgAll) tgAll.checked = allOn;
      if (!tgItems.some(x => x.checked)) c.checked = true; // 至少保留一个
    });
    function collectTargets() {
      return ($('tg-all') && $('tg-all').checked) ? ['all'] : tgItems.filter(c => c.checked).map(c => c.dataset.tg);
    }
    const doAnalyze = $('analyze-do');
    if (doAnalyze) doAnalyze.onclick = async () => {
      const cfg = loadLLM();
      if (!cfg.baseURL || !cfg.model) { status.textContent = '请先在「设置」里填 API 地址与模型名。'; return; }
      const targets = collectTargets();
      status.textContent = '正在分析（只处理新增资料，目标：' + targets.join('、') + '，可能要几十秒）…';
      doAnalyze.disabled = true;
      try {
        const r = await fetch('/api/books/' + encodeURIComponent(META.id) + '/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ llm: cfg, targets })
        });
        const j = await r.json();
        if (!r.ok) { UPLOAD_MSG = '分析失败：' + String(j.error || '').slice(0, 160); status.textContent = UPLOAD_MSG; return; }
        // 结果必须写进 UPLOAD_MSG：boot 重绘会重建 status 节点，只写 textContent 会被立刻冲掉（用户以为没生效）
        UPLOAD_MSG = j.skipped ? (j.message || '没有新增资料需要分析') : (j.message + '。知识点大全 / 考纲考点已同步更新。');
        status.textContent = UPLOAD_MSG;
        // 重新从服务端拉最新书数据刷新各视图
        const fresh = await (window.TiandaoApi ? window.TiandaoApi.getBook(META.id) : null);
        if (fresh && window.BookApp) window.BookApp.boot(fresh, true); // 保持当前「资料」页，不跳回首页
      } catch (e) { status.textContent = '分析失败：' + String(e.message || e).slice(0, 160); }
      finally { doAnalyze.disabled = false; }
    };
  }
  function openRef(r) {
    const box = $('ref-viewer');
    if (!r) return;
    const url = 'books/' + META.id + '/' + r.file;
    if (r.type === 'pdf') {
      box.innerHTML = `<h3>${esc(r.name)}</h3><iframe class="ref-frame" src="${esc(url)}" title="${esc(r.name)}"></iframe>`;
    } else if (r.type === 'txt' || r.type === 'md') {
      // txt/md 用 fetch 读原文渲染，避免 iframe 下载而不是显示
      box.innerHTML = `<h3>${esc(r.name)}</h3><div class="ref-text" id="ref-text">读取中…</div>`;
      fetch(url).then(resp => resp.ok ? resp.text() : Promise.reject(new Error(String(resp.status))))
        .then(text => { const el = $('ref-text'); if (el) el.textContent = text; })
        .catch(() => { const el = $('ref-text'); if (el) el.textContent = '本地读取失败，请用本地服务方式打开（见设置页说明）。'; });
    } else {
      box.innerHTML = `<h3>${esc(r.name)}</h3><p class="kg-type">浏览器无法直接渲染 ${esc(r.type.toUpperCase())}，点下面按钮下载到本机用对应软件打开。</p>
        <a class="btn" href="${esc(url)}" download>下载 ${esc(r.name)}</a>`;
    }
  }

  // ===== 键盘快捷键（练习 / 模拟考 / 每日一练）=====
  function onKey(e) {
    if (S.tab !== 'quiz' && S.tab !== 'exam' && !S._inDaily) return;
    const isExam = S.tab === 'exam';
    const ae = document.activeElement;
    const inField = ae && /TEXTAREA|INPUT/.test(ae.tagName);
    if (e.key >= '1' && e.key <= '9') {
      if (inField) return;
      const opts = document.querySelectorAll(`input[name=${isExam ? 'eans' : 'ans'}]`);
      const i = +e.key - 1; if (opts[i]) opts[i].checked = true;
    } else if (e.key === 'Enter') {
      if (inField && ae.tagName === 'TEXTAREA') {
        if (e.ctrlKey || e.metaKey) { const btn = isExam ? $('eSubmit') : (S._inDaily ? $('dSubmit') : $('submit')); if (btn) btn.click(); }
        return;
      }
      const btn = isExam ? $('eSubmit') : (S._inDaily ? $('dSubmit') : $('submit')); if (btn) btn.click();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (inField) return;
      if (isExam && S.exam.done) return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (S._inDaily) { const L = S.daily.list.length; if (L) { S.daily.idx = (S.daily.idx + dir + L) % L; renderDaily(); } }
      else if (S.tab === 'quiz') { const L = quizList().length; if (L) { S.qIdx = (S.qIdx + dir + L) % L; renderQuiz(); } }
      else if (isExam) {
        if (dir < 0) { if (S.exam.idx > 0) { S.exam.idx--; renderExam(); } }
        else { const last = S.exam.idx >= S.exam.list.length - 1; if (last) doGradeExam(); else { S.exam.idx++; persist(); renderExam(); } }
      }
    }
  }

  // ===== 本地存储可用性提示 =====
  function checkStorage() {
    if (!Core.save('__t', 1)) {
      const b = document.createElement('div');
      b.className = 'highlight';
      b.style.margin = 'var(--sp-3) var(--sp-5)';
      b.textContent = '当前环境不允许本地存储（可能是直接双击打开且浏览器禁写）。进度不会保存，建议用本地服务方式打开：在本目录运行 python -m http.server 8000，浏览器访问 127.0.0.1:8000/index.html。';
      const tabs = document.querySelector('.tabs'); if (tabs) tabs.parentNode.insertBefore(b, tabs.nextSibling);
    }
  }

  // ===== 初始化（按书启动）=====
  function boot(bookData, keepTab) {
    const prevTab = keepTab ? S.tab : 'dashboard';
    META = bookData.meta || { id: 'book', title: '备考', subject: '', coverColor: '#345', accent: '#e8b04b', syllabus: '' };
    K = bookData.kaogang || [];
    T = bookData.tiku || [];
    A = bookData.tikuAns || {};
    // 书馆能力扩展字段：缺省给空壳，保证老数据 / 空书也能开
    DIGEST = bookData.digest || null;
    SYLLABUS = bookData.syllabus || null;
    MINDMAP = bookData.mindmap || null;
    EXAM_OUTLINE = bookData.examOutline || null; // 考纲考点 = 书馆 documents 官方生成
    REFS = bookData.refs || [];
    TRACE = bookData._trace || null;
    CHAPTERS = Core.chapters(K);
    TYPES = Core.types(T);
    Core.ns = bookData.meta ? bookData.meta.id : '';
    Core.ensureVersion(T);
    restore();
    applyTheme();
    if (!S.exam.list || !S.exam.list.length) { Core.resetExam(S.exam, T, S.examScope); }
    S.examScope = S.exam.scope || '全部章节';

    document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
    // 注：原 outline tab 的 kg-search/kg-hot 绑定已随 tab 收敛删除（DOM 不再存在，强绑会报 null）
    $('q-chapter').onchange = e => { S.qChKey = e.target.value; S.qIdx = 0; S._inDaily = false; renderQuiz(); };
    $('q-type').onchange = e => { S.qType = e.target.value; S.qIdx = 0; S._inDaily = false; renderQuiz(); };
    $('q-hideMastered').onchange = e => { S.hideMastered = e.target.checked; S.qIdx = 0; persist(); renderQuiz(); };
    $('q-wrongOnly').onchange = e => { S.wrongOnly = e.target.checked; S.qIdx = 0; persist(); renderQuiz(); };
    $('exam-scope').onchange = e => { S.examScope = e.target.value; Core.resetExam(S.exam, T, S.examScope); S.examLimit = 0; persist(); clearTimer(); renderExam(); };
    $('exam-limit').onchange = e => { S.examLimit = +e.target.value; clearTimer(); persist(); renderExam(); };
    $('exam-submit-all').onclick = doGradeExam;
    $('wrong-tab-wrong').onclick = () => { S.wrongView = 'wrong'; renderWrong(); };
    $('wrong-tab-fav').onclick = () => { S.wrongView = 'fav'; renderWrong(); };
    $('theme-toggle').onclick = () => { S.themeMode = (effectiveTheme() === 'dark' ? 'light' : 'dark'); applyTheme(); persist(); };
    document.addEventListener('keydown', onKey);
    checkStorage();
    switchTab(prevTab);
  }

  // 暴露启动入口：由 bookshelf.js 在「打开书」时调用；不自动跑，避免未选书就渲染
  window.BookApp = { boot: boot, version: 1 };
})();
