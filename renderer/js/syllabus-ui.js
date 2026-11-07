'use strict';
// 考纲结构化视图（M1 主链路）：忠实呈现用户手写的「考纲.md」与「题库.json」，
// 不重总结、不简化。章节 → 小节 → 知识点（编号/题型徽章/▲重点/页码/题库挂题）。
// 设计依据：用户考纲已是满分结构，程序只解析、只呈现；与「直接看原文件」拉开差距的点在于
// 「结构化导航 + 题库按知识点挂回 + 一键从题库出卷」。
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clip = (s, n) => { const t = String(s == null ? '' : s).trim(); return t.length > n ? (t.slice(0, n) + '…') : t; };

  // 题型短标签（与题库.json 的 type 对齐）
  const TYPE_LABEL_SHORT = {
    single: '单选', multiple: '多选', fill: '填空', judge: '判断',
    explain: '名词解释', essay: '简答', calc: '计算', case: '综合'
  };
  const typeShort = t => TYPE_LABEL_SHORT[t] || t;

  // M4 图文内联：把 assetId 归一为 <img> 可用的 src（Electron 返回 {data,mime}，HTTP 返回 {url}）
  async function assetSrc(matId, assetId) {
    const r = await API.materials.readAsset(SyllabusUI.bookId, matId, assetId);
    return (r && r.url) ? r.url : ('data:' + ((r && r.mime) || 'image/png') + ';base64,' + ((r && r.data) || ''));
  }
  // 轻量 overlay 大图：只创建一次、复用；关闭按钮 / 点遮罩 / Escape 三种关闭，焦点返回触发元素
  function openLightbox(matId, assetId, alt) {
    let lb = document.getElementById('syl-lightbox');
    if (!lb) {
      lb = document.createElement('div'); lb.id = 'syl-lightbox'; lb.className = 'syl-lightbox hidden';
      lb.innerHTML = '<button class="syl-lb-close" type="button" aria-label="关闭大图">×</button><img alt="">';
      document.body.appendChild(lb);
      lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('syl-lb-close')) closeLightbox(lb); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lb.classList.contains('hidden')) closeLightbox(lb); });
    }
    const img = lb.querySelector('img');
    img.alt = alt || ''; img.src = '';
    lb._trigger = document.activeElement;
    assetSrc(matId, assetId).then(src => { img.src = src; }).catch(() => { img.alt = '图加载失败'; });
    lb.classList.remove('hidden');
    lb.querySelector('.syl-lb-close').focus();
  }
  function closeLightbox(lb) { lb.classList.add('hidden'); if (lb._trigger && lb._trigger.focus) lb._trigger.focus(); }

  const SyllabusUI = {
    bookId: null, outline: null,

    async enter(bookId) {
      this.bookId = bookId;
      await this.render();
    },

    async render() {
      let o;
      try { o = await API.study.syllabus(this.bookId); }
      catch (e) { $('syllabus-body').innerHTML = '<div class="empty">读取考纲失败：' + esc(e.message || e) + '</div>'; return; }
      this.outline = o;
      this.renderHead(o);
      this.renderTree(o);
    },

    renderHead(o) {
      $('syllabus-title').textContent = o.title || '考纲';
      const kindLabel = o.kind === 'syllabus' ? '考纲结构' : '自动整理大纲';
      const bankLabel = o.hasBank
        ? (' · 题库「' + esc(o.bankName || '题库') + '」挂题 ' + o.questionCount + ' 道')
        : (o.kind === 'syllabus' ? ' · 未检测到题库.json' : '');
      $('syllabus-meta').textContent = kindLabel + ' · 知识点 ' + (o.pointCount || 0) + bankLabel +
        (o.selfMadeCount ? (' · 自拟题 ' + o.selfMadeCount) : '');
      $('syllabus-exam-n').textContent = o.questionCount || 0;
      const btn = $('syllabus-exam');
      // 没有题库就禁用「从题库出卷」，避免点了出空卷
      if (!o.hasBank) { btn.disabled = true; btn.classList.add('disabled'); }
      else { btn.disabled = false; btn.classList.remove('disabled'); }
    },

    renderTree(o) {
      const body = $('syllabus-body');
      body.innerHTML = '';

      if (o.isFallback) {
        const warn = document.createElement('div');
        warn.className = 'syllabus-warn';
        warn.innerHTML = '未检测到「考纲.md」，下面是根据资料标题自动整理的大纲（仅供参考，准确性不如你手写的考纲）。建议把考纲整理成「考纲.md」放进来，本页会忠实呈现你的结构、题型与重点。';
        body.appendChild(warn);
      }

      const chapters = o.chapters || [];
      if (!chapters.length) {
        body.innerHTML += '<div class="empty">没有可显示的章节。</div>';
        return;
      }

      chapters.forEach(ch => {
        const chEl = document.createElement('div');
        chEl.className = 'syl-chapter';
        const chHead = document.createElement('div');
        chHead.className = 'syl-chapter-head';
        chHead.innerHTML = '<h3>' + esc(ch.title) + (ch.pageRef ? ' <span class="syl-page">' + esc(ch.pageRef) + '</span>' : '') + '</h3>';
        chEl.appendChild(chHead);

        (ch.sections || []).forEach(sec => {
          const secEl = document.createElement('div');
          secEl.className = 'syl-section';
          const secHead = document.createElement('div');
          secHead.className = 'syl-section-head';
          secHead.innerHTML = '<b>' + esc(sec.title) + '</b>' + (sec.pageRef ? ' <span class="syl-page">' + esc(sec.pageRef) + '</span>' : '');
          secEl.appendChild(secHead);

          // 知识点行：编号 / 文本 / 题型徽章 / ▲重点 / 页码 / 题库挂题数
          (sec.points || []).forEach(p => {
            const pEl = document.createElement('div');
            pEl.className = 'syl-point' + (p.key ? ' key' : '');
            const badges = (p.types || []).map(t => '<span class="syl-type">' + esc(typeShort(t)) + '</span>').join('');
            const keyMark = p.key ? '<span class="syl-key">▲重点</span>' : '';
            const qBadge = p.questionCount ? '<span class="syl-q">题库 ' + p.questionCount + ' 题</span>' : '';
            pEl.innerHTML =
              '<span class="syl-pid">' + esc(p.id) + '</span>' +
              '<span class="syl-text">' + esc(p.text) + '</span>' +
              '<span class="syl-badges">' + keyMark + badges + qBadge +
              (p.pageRef ? '<span class="syl-page">' + esc(p.pageRef) + '</span>' : '') + '</span>';
            // M4 图文内联：若知识点按页码关联到了 PPT 嵌入图，内联缩略图网格，点击放大看大图
            if (p.images && p.images.length) {
              const grid = document.createElement('div');
              grid.className = 'syl-imgs';
              p.images.forEach((im, idx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'syl-img-thumb';
                btn.dataset.asset = im.assetId; btn.dataset.mat = im.matId; btn.dataset.slide = im.slide;
                btn.setAttribute('aria-label', '查看第 ' + im.slide + ' 页原图');
                btn.innerHTML = '<span class="syl-img-loading">第 ' + im.slide + ' 页</span><img alt="第 ' + im.slide + ' 页资料原图" loading="' + (idx === 0 ? 'eager' : 'lazy') + '" hidden>';
                assetSrc(im.matId, im.assetId).then(src => {
                  const im2 = btn.querySelector('img'); im2.src = src; im2.hidden = false;
                  const ld = btn.querySelector('.syl-img-loading'); if (ld) ld.remove();
                }).catch(() => { const ld = btn.querySelector('.syl-img-loading'); if (ld) ld.textContent = '图加载失败'; });
                btn.addEventListener('click', () => openLightbox(im.matId, im.assetId, '第 ' + im.slide + ' 页资料原图'));
                grid.appendChild(btn);
              });
              pEl.appendChild(grid);
            }
            // 展开该知识点下挂的题库题（只列题干摘要，答案在练习页交卷后给）
            if (p.questions && p.questions.length) {
              const qList = document.createElement('div');
              qList.className = 'syl-questions';
              p.questions.slice(0, 6).forEach(q => {
                const qEl = document.createElement('div');
                qEl.className = 'syl-q-item';
                qEl.innerHTML = '<span class="syl-q-type">' + esc(typeShort(q.type)) + '</span> ' + esc(clip(q.stem, 120));
                qList.appendChild(qEl);
              });
              if (p.questions.length > 6) {
                const more = document.createElement('div');
                more.className = 'syl-q-more';
                more.textContent = '…还有 ' + (p.questions.length - 6) + ' 道题';
                qList.appendChild(more);
              }
              pEl.appendChild(qList);
            }
            secEl.appendChild(pEl);
          });

          // 自拟题（Z-章节-序号）
          (sec.selfMade || []).forEach(sm => {
            const smEl = document.createElement('div');
            smEl.className = 'syl-point selfmade';
            smEl.innerHTML =
              '<span class="syl-pid">自</span>' +
              '<span class="syl-text">' + esc(sm.stem) + '</span>' +
              '<span class="syl-badges"><span class="syl-type">' + esc(typeShort(sm.type)) + '</span></span>';
            secEl.appendChild(smEl);
          });

          chEl.appendChild(secEl);
        });

        body.appendChild(chEl);
      });
    }
  };

  window.SyllabusUI = SyllabusUI;
})();
