'use strict';
// 练习闭环：脱敏试卷 → 答题卡 → 批改（三判定 + 错因 + 标准答案/解析/来源）→ 只针对薄弱点出巩固卷。
// 交卷前页面上不出现任何答案；答案只在 grade 之后由后端返回。
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const ExamUI = {
    bookId: null, paper: null, lastExamId: null, grading: null,

    async enter(bookId) { this.bookId = bookId; await this.renderList(); },

    async renderList() {
      const state = await API.study.state(this.bookId);
      const exams = (state && state.exams) || [];
      const el = $('exam-list'); el.innerHTML = '';
      if (!exams.length) { el.innerHTML = '<div class="empty">还没有试卷。先去「分析」页跑一次分析。</div>'; return; }
      exams.forEach(e => {
        const d = document.createElement('div'); d.className = 'exam-item';
        const rlabel = e.round === 'review' ? '今日复习卷' : ('第 ' + esc(e.round) + ' 套');
        d.innerHTML = '<b>' + rlabel + '</b><small>' + esc(e.count) + ' 题 · ' +
          new Date(e.createdAt).toLocaleString('zh-CN') + (e.graded ? ' · 已批改' : '') + '</small>';
        d.onclick = async () => {
          const p = await API.study.getExam(this.bookId, e.id);
          if (p && p.questions) this.show(p);
        };
        el.appendChild(d);
      });
    },

    show(paper) {
      this.paper = paper; this.lastExamId = paper.id; this.grading = null;
      $('exam-result').innerHTML = '';
      $('exam-feedback').classList.add('hidden');
      const isReview = paper.round === 'review';
      let h = '<div class="paper-head"><h3>' +
        (isReview ? '今日复习卷（针对到期的薄弱点）' :
          ('第 ' + esc(paper.round) + ' 套试卷' + (paper.round > 1 ? '（巩固卷 · 每个薄弱知识点 1 题，不重复整套）' : ''))) +
        '</h3>' +
        '<span class="paper-hint">共 ' + paper.questions.length + ' 题 · 交卷前不显示答案</span></div>';
      paper.questions.forEach((q, i) => {
        h += '<div class="paper-q" data-qid="' + esc(q.id) + '">' +
          '<div class="paper-q-head"><span class="q-type">' + esc(q.typeLabel || q.type) + '</span><span class="q-no">题 ' + (i + 1) + '</span>' +
          '<span class="' + (q.origin === 'source' ? 'tag-source' : 'tag-ai') + '">' + (q.origin === 'source' ? '来源依据' : 'AI补充') + '</span></div>' +
          '<div class="paper-stem">' + esc(q.stem) + '</div>';
        if (q.type === 'single' || q.type === 'multiple') {
          const t = q.type === 'single' ? 'radio' : 'checkbox';
          (q.options || []).forEach((o, j) => {
            const letter = String.fromCharCode(65 + j);
            h += '<label class="opt"><input type="' + t + '" name="ans-' + esc(q.id) + '" value="' + esc(letter) + '"> ' + esc(letter) + '. ' + esc(o) + '</label>';
          });
        } else if (q.type === 'judge') {
          // 判断题：固定 正确/错误 两个单选，不允许开卷乱填文字
          (q.options && q.options.length ? q.options : ['正确', '错误']).forEach((o) => {
            h += '<label class="opt"><input type="radio" name="ans-' + esc(q.id) + '" value="' + esc(o) + '"> ' + esc(o) + '</label>';
          });
        } else {
          h += '<textarea class="ans-text" data-qid="' + esc(q.id) + '" rows="3" placeholder="写下你的答案"></textarea>';
        }
        if (q.source && q.source.file) h += '<div class="src-detail">出处：' + esc(q.source.file) + ' · ' + esc(q.source.loc || '') + '</div>';
        h += '</div>';
      });
      $('exam-paper').innerHTML = h;
      $('exam-submit').classList.remove('hidden');
      $('exam-remedial').classList.add('hidden');
    },

    collect() {
      const ans = {};
      (this.paper.questions || []).forEach(q => {
        if (q.type === 'single' || q.type === 'multiple') {
          const picked = Array.from(document.querySelectorAll('input[name="ans-' + q.id + '"]:checked')).map(x => x.value);
          ans[q.id] = picked.join('');
        } else if (q.type === 'judge') {
          const picked = document.querySelector('input[name="ans-' + q.id + '"]:checked');
          ans[q.id] = picked ? picked.value : '';
        } else {
          const t = document.querySelector('.ans-text[data-qid="' + q.id + '"]');
          ans[q.id] = t ? t.value.trim() : '';
        }
      });
      return ans;
    },

    async submit() {
      if (!this.paper) return;
      const r = await API.study.grade(this.bookId, this.paper.id, this.collect());
      if (!r || !r.ok) { $('exam-result').textContent = '批改失败：' + ((r && r.reason) || '未知原因'); return; }
      this.grading = r;
      const s = r.summary;
      let h = '<div class="grade-head"><h3>批改结果</h3><span>正确 ' + s.correct + ' · 部分正确 ' + s.partial +
        ' · 错误 ' + s.wrong + ' / 共 ' + s.total + '</span></div>';
      if (r.weakPointIds && r.weakPointIds.length) h += '<div class="weak-note">薄弱知识点 ' + r.weakPointIds.length + ' 个，可生成只针对它们的巩固卷。</div>';
      r.grading.forEach((g, i) => {
        const cls = g.verdict === '正确' ? 'ok' : g.verdict === '部分正确' ? 'partial' : 'bad';
        h += '<div class="grade-item ' + cls + '"><div class="grade-line"><b>题 ' + (i + 1) + '</b>' +
          '<span class="verdict">' + esc(g.verdict) + '</span>' +
          (g.cause ? '<span class="cause">错因：' + esc(g.cause) + '</span>' : '') + '</div>' +
          '<div class="grade-stem">' + esc(g.stem) + '</div>' +
          '<div class="grade-a"><b>你的作答：</b>' + esc(g.given || '（空）') + '</div>' +
          '<div class="grade-a"><b>标准答案：</b>' + esc(g.standard) + '</div>' +
          '<div class="grade-a"><b>解析：</b>' + esc(g.explanation) + '</div>' +
          '<div class="grade-a"><b>常见错误：</b>' + esc(g.commonMistake || '—') + '</div>' +
          (g.source && g.source.file ? '<div class="src-detail">来源依据：' + esc(g.source.file) + ' · ' + esc(g.source.usage || '') + '</div>' :
            '<div class="tag-row"><span class="tag-ai">AI补充</span></div>') + '</div>';
      });
      $('exam-result').innerHTML = h;
      $('exam-submit').classList.add('hidden');
      $('exam-remedial').classList.toggle('hidden', !(r.weakPointIds && r.weakPointIds.length));
      $('exam-feedback').classList.remove('hidden');
      // 试卷可能很长，批改完直接把结果滚到眼前，别让用户自己找
      try { $('exam-result').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
      this.renderList();
    },

    async remedial() {
      if (!this.lastExamId) return;
      const r = await API.study.remedial(this.bookId, this.lastExamId);
      if (!r || !r.ok) { $('exam-result').insertAdjacentHTML('afterbegin', '<div class="study-status err">' + esc((r && r.reason) || '生成失败') + '</div>'); return; }
      this.show(r.paper);
      await this.renderList();
    },

    async newFromAnalysis() {
      const state = await API.study.state(this.bookId);
      const a = (window.StudyUI && StudyUI.analysis) || (state && state.analysis);
      if (!a || !a.questions || !a.questions.length) {
        $('exam-new-status').textContent = '还没有分析结果，先去「分析」页跑一次。'; return;
      }
      const c = Settings.load();
      const paper = await API.study.exam(this.bookId, a, c.questionCount);
      this.show(paper);
      await this.renderList();
      $('exam-new-status').textContent = '新卷已生成（第 1 套）。';
    },

    // 从题库.json 直接组卷：不走分析，直接复用用户已备好的题（来源依据 / 题型准 / 不简化）。
    async newFromBank() {
      const c = Settings.load();
      $('exam-new-status').textContent = '正在从题库组卷…';
      const r = await API.study.syllabusExam(this.bookId, { count: c.questionCount });
      if (!r || !r.ok) {
        $('exam-new-status').textContent = (r && r.reason) || '生成失败：未检测到题库.json';
        return;
      }
      this.show(r.paper);
      await this.renderList();
      $('exam-new-status').textContent = '已从题库生成新卷（' + r.paper.questions.length + ' 题）。';
    },

    async review() {
      const c = Settings.load();
      $('exam-review-status').textContent = '正在挑出到期的薄弱点…';
      const r = await API.study.review(this.bookId, c.questionCount || 20);
      if (!r || !r.ok) { $('exam-review-status').textContent = (r && r.reason) || '生成失败'; return; }
      this.show(r.paper);
      await this.renderList();
      $('exam-review-status').textContent = '今日复习卷已生成（' + (r.dueCount || 0) + ' 个到期薄弱点）。交卷后盒子会按对错升级或重置。';
    },

    saveFeedback() {
      const box = $('exam-feedback');
      const data = Array.from(box.querySelectorAll('textarea,input')).map(x => x.value.trim());
      try {
        const k = 'rl-feedback-' + this.bookId;
        const all = JSON.parse(localStorage.getItem(k) || '[]');
        all.unshift({ at: Date.now(), examId: this.lastExamId, data });
        localStorage.setItem(k, JSON.stringify(all.slice(0, 50)));
      } catch (e) {}
      $('exam-feedback-save').textContent = '已记录';
    }
  };

  window.ExamUI = ExamUI;
})();
