'use strict';
// M1 考纲结构化：把用户手写的「考纲.md」与「题库.json」解析成结构化骨架，
// 让程序忠实呈现考纲（章节→小节→知识点[编号/题型/重点/页码/自拟题]），
// 并把题库按知识点编号挂回去。不再用 localAnalyze 的「碎片当知识点」伪总结。
// 设计依据：阶段零融合决策「保留结构、附来源」（MinerU 原则本地化）；
//          用户自己的考纲.md 已是满分结构，程序只解析、不重总结。
const insight = require('./insight');

// ---------- 工具 ----------
function parseFrontmatter(text) {
  const fm = {};
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (!m) return fm;
  m[1].split(/\n/).forEach(line => {
    const mm = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!mm) return;
    let v = mm[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      try { v = JSON.parse(v.replace(/，/g, ',')); } catch (e) { v = v.slice(1, -1).split(/[,\s]+/).filter(Boolean); }
    }
    fm[mm[1]] = v;
  });
  return fm;
}

// 从「复习 p1-4」「（p1）」之类抽取页码区间
function pageRefOf(s) {
  const m = /p(\d+)(?:[-–](\d+))?/i.exec(String(s || ''));
  if (!m) return null;
  return m[2] ? ('p' + m[1] + '-' + m[2]) : ('p' + m[1]);
}

// 标准题型集合（与题库.json 的 type 字段对齐）
const TYPE_SET = new Set(['选择', '填空', '名词解释', '简答', '判断', '计算']);
function normTypes(cell) {
  if (!cell) return [];
  return String(cell).split(/[／/、,，]/).map(t => {
    const m = /^(.*?)(?:（.*?）|\(.*?\))?$/.exec(t.trim());
    return (m ? m[1] : t).trim();
  }).filter(t => t.length && (TYPE_SET.has(t) || /选择|填空|名词解释|简答|判断|计算/.test(t)));
}

// 从「▲ 重点：1.1.1–1.1.3、1.2.3」解析出知识点编号集合（含区间展开）
function parseKeyRefs(s) {
  const out = new Set();
  const txt = String(s || '');
  // 区间：形如 1.1.1–1.1.3 或 1.1.1-1.1.3
  const ranges = txt.match(/\d+\.\d+\.\d+\s*[-–]\s*\d+\.\d+\.\d+/g) || [];
  ranges.forEach(r => {
    const mm = r.match(/(\d+)\.(\d+)\.(\d+)\s*[-–]\s*\d+\.(\d+)\.(\d+)/);
    if (!mm) return;
    const [, a, b, c, d, e] = mm.map(Number);
    if (a === d && b === e) for (let i = c; i <= e; i++) out.add(a + '.' + b + '.' + i);
  });
  // 单点：1.1.1
  const singles = txt.match(/\d+\.\d+\.\d+/g) || [];
  singles.forEach(x => out.add(x));
  return out;
}

// 解析「Z-章节-序号」自拟题行：- `Z-1-1` 填空：题干
function parseSelfMade(line) {
  const m = /^[-\s]*(?:[`『`'])?(Z-[\d-]+)(?:[`『`'])?\s*(选择|填空|名词解释|简答|判断|计算)?\s*[：:]\s*(.*)$/.exec(line);
  if (!m) return null;
  return { id: m[1], type: m[2] || '简答', stem: m[3].trim() };
}

// ---------- 考纲解析 ----------
function parseSyllabusMd(mdText) {
  const fm = parseFrontmatter(mdText);
  const lines = String(mdText).split(/\r?\n/);
  let docTitle = fm.title || '';
  let inFm = false, fmDone = false;
  let curChapter = null, curSection = null;
  const chapters = [];
  const allKeyRefs = new Set(); // 全文累计重点编号（▲ 重点 出现在表之后，故事后统一标记）
  let sawFirstH1 = false;

  function ensureChapter(title, pageRef) {
    curChapter = { title, pageRef, sections: [] };
    chapters.push(curChapter);
    return curChapter;
  }
  function ensureSection(id, title, pageRef) {
    curSection = { id, title, pageRef, points: [], selfMade: [] };
    (curChapter || ensureChapter('概览', null)).sections.push(curSection);
    return curSection;
  }

  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    // frontmatter：只在文档开头、首个 --- 之间当作分隔符；之后的 --- 是普通分隔线，不再进入 fm 模式
    if (!fmDone) {
      if (/^---\s*$/.test(line)) {
        if (!inFm) { inFm = true; continue; }
        inFm = false; fmDone = true; continue;
      }
      if (inFm) continue;
    }
    const h1 = /^#\s+(.*)$/.exec(line);
    const h2 = /^##\s+(.*)$/.exec(line);
    const keyLine = /^▲\s*重点[：:]\s*(.*)$/.exec(line);
    const selfMadeHead = /^\*\*自拟题/.exec(line);

    if (h1) {
      const t = h1[1].trim();
      if (!sawFirstH1) { docTitle = docTitle || t; sawFirstH1 = true; continue; }
      // 真实章节
      ensureChapter(t, pageRefOf(t));
      curSection = null;
      continue;
    }
    if (h2) {
      const t = h2[1].trim();
      const secId = /^([\d.]+\.?\d*)\b/.exec(t);
      ensureSection(secId ? secId[1] : t, t, pageRefOf(t));
      continue;
    }
    if (keyLine) { parseKeyRefs(keyLine[1]).forEach(x => allKeyRefs.add(x)); continue; }
    if (selfMadeHead) { continue; }

    // 知识点表头：含 编号/知识点/对应题型
    if (/编号/.test(line) && /知识点/.test(line) && /对应题型/.test(line) && /^\|/.test(line)) {
      i++; // 跳过表头行
      // 跳过分隔行 |---|---|---
      while (i < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) i++;
      // 读表体（每行 | 编号 | 知识点 | 对应题型 |），直到非 | 行
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
        if (cells.length >= 3 && /^\d+\.\d+\.\d+$/.test(cells[0])) {
          const pid = cells[0];
          curSection = curSection || ensureSection('未分节', '未分节', null);
          curSection.points.push({
            id: pid, text: cells[1], types: normTypes(cells[2]),
            key: false, pageRef: curSection.pageRef
          });
        }
        i++;
      }
      i--; // 回退一格，外层循环正常推进
      continue;
    }
    // 自拟题项
    if (/^[-\s]*(?:[`『`'])?Z-[\d-]+/.test(line)) {
      const sm = parseSelfMade(line);
      if (sm) {
        curSection = curSection || ensureSection('未分节', '未分节', null);
        curSection.selfMade.push(sm);
      }
      continue;
    }
  }

  // 丢弃空 section / 空 chapter
  chapters.forEach(ch => { ch.sections = ch.sections.filter(s => s.points.length || s.selfMade.length); });
  const cleanChapters = chapters.filter(ch => ch.sections.length);

  // 事后统一标记重点（▲ 重点 出现在表之后）
  cleanChapters.forEach(ch => ch.sections.forEach(s => s.points.forEach(p => { if (allKeyRefs.has(p.id)) p.key = true; })));

  let pointCount = 0, selfMadeCount = 0;
  cleanChapters.forEach(ch => ch.sections.forEach(s => {
    pointCount += s.points.length; selfMadeCount += s.selfMade.length;
  }));

  return {
    kind: 'syllabus',
    title: docTitle, source: fm.source || '', tags: fm.tags || [],
    chapters: cleanChapters, pointCount, selfMadeCount
  };
}

// ---------- 题库解析 ----------
// kp 形如 "1.1.1-1.1.3" / "1.1.3" / "1.2.3、1.2.4" → 展开成知识点编号数组
function expandKp(kp) {
  const out = [];
  String(kp || '').split(/[、,，\s]+/).forEach(part => {
    const range = /^(\d+)\.(\d+)\.(\d+)\s*[-–]\s*(\d+)\.(\d+)\.(\d+)$/.exec(part.trim());
    if (range) {
      const [, a, b, c, d, e, f] = range.map(Number);
      if (a === d && b === e) for (let i = c; i <= f; i++) out.push(a + '.' + b + '.' + i);
      else out.push(part.trim());
    } else if (/^\d+\.\d+\.\d+$/.test(part.trim())) out.push(part.trim());
    else if (part.trim()) out.push(part.trim());
  });
  return out;
}

// 把题库一条规整成练习/批改管线能吃的结构
function bankToExamQuestion(item, bankName) {
  const typeMap = { '选择': 'single', '判断': 'judge', '填空': 'fill', '名词解释': 'explain', '简答': 'essay', '计算': 'calc' };
  const t = typeMap[item.type] || 'explain';
  let options = Array.isArray(item.options) ? item.options.slice() : [];
  let answer = item.correct || item.ans || (Array.isArray(item.keys) ? item.keys.flat().join('、') : '');
  if (t === 'judge') {
    if (!options.length) options = ['正确', '错误'];
    // 判断题答案归一为 正确/错误
    const a = String(item.ans || item.correct || '').replace(/[AB]\s*[．.。]?\s*/, '');
    answer = /错/.test(a) ? '错误' : '正确';
  }
  return {
    id: 'bk_' + item.id, type: t, stem: item.stem || '',
    options, answer: String(answer || ''),
    explanation: item.why || item.ans || '', commonMistake: '',
    pointIds: expandKp(item.kp), origin: 'source',
    source: { file: bankName || '题库', loc: item.ch ? (item.ch + (item.sec ? ' ' + item.sec : '')) : '', usage: '题库题 ' + item.id }
  };
}

function parseQuestionBank(jsonObj, bankName) {
  const items = Array.isArray(jsonObj) ? jsonObj : (jsonObj && jsonObj.items) || [];
  const questions = items.map(it => bankToExamQuestion(it, bankName));
  const byPoint = {};
  questions.forEach(q => q.pointIds.forEach(pid => { (byPoint[pid] = byPoint[pid] || []).push(q); }));
  return {
    meta: (jsonObj && jsonObj.meta) || { title: bankName, count: items.length },
    questions, byPoint, count: questions.length
  };
}

// ---------- 资料分类 ----------
// 返回 'syllabus' | 'questionbank' | 'doc'
function classifyMaterial(store, bookId, m) {
  const name = String(m.name || '').toLowerCase();
  if (/(考纲|大纲|考点|知识点)/.test(name)) return 'syllabus';
  if (/(题库|试题|试卷|习题|答案)/.test(name)) return 'questionbank';
  const ext = (m.ext || '').toLowerCase();
  try {
    const r = store.readMaterial(bookId, m.id);
    const buf = Buffer.from(r.data || '', 'base64');
    if (ext === '.json') {
      const j = JSON.parse(buf.toString('utf8'));
      if (j && Array.isArray(j.items) && j.items[0] && (j.items[0].stem || j.items[0].kp)) return 'questionbank';
      return 'doc';
    }
    if (ext === '.md') {
      const text = insight.extractText('.md', buf) || '';
      const fm = parseFrontmatter(text);
      const tags = [].concat(fm.tags || []);
      if (tags.some(t => /(考纲|大纲|考点|知识点)/.test(t))) return 'syllabus';
      if (tags.some(t => /(题库|试题|试卷|习题|答案)/.test(t))) return 'questionbank';
      if (/编号\s*\|/.test(text) && /知识点\s*\|/.test(text) && /对应题型\s*\|/.test(text)) return 'syllabus';
      return 'doc';
    }
  } catch (e) { /* 读不出按名字/扩展名兜底 */ }
  return 'doc';
}

// ---------- 组装一本书的考纲骨架 ----------
// 优先级：考纲.md → 骨架；题库.json → 按编号挂题；都没有 → 轻量大纲兜底。
function buildBookOutline(store, bookId) {
  const g = store.getBook(bookId);
  const mats = (g && g.materials) || [];
  let syllabusMat = null, bankMat = null;
  mats.forEach(m => {
    const k = classifyMaterial(store, bookId, m);
    if (k === 'syllabus' && !syllabusMat) syllabusMat = m;
    else if (k === 'questionbank' && !bankMat) bankMat = m;
  });

  let outline = null, bank = null;
  if (syllabusMat) {
    const r = store.readMaterial(bookId, syllabusMat.id);
    const text = insight.extractText(syllabusMat.ext, Buffer.from(r.data || '', 'base64')) || r.extractedText || '';
    outline = parseSyllabusMd(text);
  }
  if (bankMat) {
    const r = store.readMaterial(bookId, bankMat.id);
    try {
      const j = JSON.parse(Buffer.from(r.data || '', 'base64').toString('utf8'));
      bank = parseQuestionBank(j, bankMat.name);
    } catch (e) { bank = null; }
  }

  if (outline) {
    // 把题库按编号挂到知识点
    if (bank) {
      outline.chapters.forEach(ch => ch.sections.forEach(s => s.points.forEach(p => {
        p.questions = (bank.byPoint[p.id] || []).map(q => ({ id: q.id, type: q.type, typeLabel: typeLabelOf(q.type), stem: q.stem, answer: q.answer, explanation: q.explanation, pointIds: q.pointIds }));
        p.questionCount = p.questions.length;
      })));
    }
    // M4 图文内联：把已抽好入库的 PPT 嵌入图按页码关联回知识点（图已抽但没有界面展示，正是头号判据的反面）
    attachImages(store, bookId, outline);
    outline.hasBank = !!bank;
    outline.questionCount = bank ? bank.count : 0;
    outline.bankName = bank ? bank.meta.title : null;
    return outline;
  }

  // 兜底：从最好的文本资料生成轻量大纲（M1 不做深度总结）
  const docText = bestDocText(store, bookId, mats);
  return outlineFallback(docText, mats);
}

function typeLabelOf(t) {
  return ({ single: '单选题', multiple: '多选题', explain: '概念解释题', case: '综合应用题', fill: '填空题', judge: '判断题', essay: '简答题', calc: '计算题' })[t] || t;
}

function bestDocText(store, bookId, mats) {
  let best = null, bestScore = -1;
  mats.forEach(m => {
    const layer = m.layer || 3;
    try {
      const r = store.readMaterial(bookId, m.id);
      const t = insight.extractText(m.ext, Buffer.from(r.data || '', 'base64')) || r.extractedText || '';
      const score = t.length * (1 / layer);
      if (t.length > 200 && score > bestScore) { bestScore = score; best = t; }
    } catch (e) {}
  });
  return best;
}

// 轻量大纲：按标题拆章节、关键句当知识点；明确标注是兜底、不如考纲。
function outlineFallback(text, mats) {
  const t = String(text || '');
  if (!t.trim()) {
    return { kind: 'outline', title: '（无可用文本）', source: '', chapters: [], pointCount: 0, questionCount: 0, hasBank: false, isFallback: true };
  }
  // 章节：以「第X章」「X.X」「数字.」开头的行当小节标题；否则整段当一个小节
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const sections = [];
  let cur = null;
  const pushCur = () => { if (cur && (cur.points.length || cur.sentences.length)) sections.push(cur); };
  lines.forEach(s => {
    const head = /^(第[一二三四五六七八九十\d]+章|[\d]+\.[\d]+\s+[^\n]{1,20}|^[（(]?\d+[)）]?\s*[^\n]{2,20}$)/.exec(s);
    if (head && s.length <= 24 && !/[。，；;]$/.test(s)) {
      pushCur();
      cur = { id: sections.length + 1, title: s.replace(/^[（(]\d+[)）]\s*/, ''), points: [], sentences: [] };
    } else {
      if (!cur) cur = { id: 1, title: '资料内容', points: [], sentences: [] };
      // 关键句：长度适中且含术语感（去停用后还有内容）
      const sent = s.replace(/^[-*]\s*/, '');
      if (sent.length >= 14 && sent.length <= 160) cur.sentences.push(sent);
    }
  });
  pushCur();
  if (!sections.length) sections.push({ id: 1, title: '资料内容', points: [], sentences: [] });

  const chapters = [{ title: '资料内容（自动整理·仅供参考）', pageRef: null, sections: sections.slice(0, 30).map(sec => ({
    id: String(sec.id), title: sec.title, pageRef: null,
    points: sec.sentences.slice(0, 12).map((s, i) => ({ id: sec.id + '.' + (i + 1), text: s, types: [], key: false, pageRef: null, questions: [], questionCount: 0 })),
    selfMade: []
  })) }];
  let pointCount = 0;
  chapters.forEach(ch => ch.sections.forEach(s => pointCount += s.points.length));
  return {
    kind: 'outline', title: '自动整理大纲（未检测到考纲，仅供参考）', source: '',
    chapters, pointCount, questionCount: 0, hasBank: false, isFallback: true
  };
}

// 取出一本书的题库全部题目（规整后的引擎结构），无则返回 []
function getBankQuestions(store, bookId) {
  const g = store.getBook(bookId);
  const mats = (g && g.materials) || [];
  for (const m of mats) {
    if (classifyMaterial(store, bookId, m) === 'questionbank') {
      try {
        const r = store.readMaterial(bookId, m.id);
        const j = JSON.parse(Buffer.from(r.data || '', 'base64').toString('utf8'));
        return parseQuestionBank(j, m.name).questions;
      } catch (e) { return []; }
    }
  }
  return [];
}

// ---------- M4 图文内联：知识点 ↔ PPT 幻灯片图 按页码关联 ----------
// 把 'p1-4' / 'p1' 展开成页码数组 [1,2,3,4] / [1]
function pageNumsOf(ref) {
  const m = /p(\d+)(?:[-–](\d+))?/i.exec(String(ref || ''));
  if (!m) return [];
  if (m[2]) { const a = parseInt(m[1], 10), b = parseInt(m[2], 10); const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }
  return [parseInt(m[1], 10)];
}

// 扫描 book 内 PPTX 资料的嵌入图（按 slide 号归组），把页码匹配到的图挂回对应知识点。
// 不做强行 OCR/版面猜测：只利用用户考纲已写的页码标注 + 已抽好入库的 slide 图，零额外依赖。
function attachImages(store, bookId, outline) {
  const g = store.getBook(bookId);
  const mats = (g && g.materials) || [];
  const slideMap = {}; // slideNo -> { assetId, matId, slide }
  mats.forEach(m => {
    if ((m.ext || '').toLowerCase() !== '.pptx') return;
    try {
      const r = store.readMaterial(bookId, m.id);
      (r.assets || []).forEach(a => {
        if (a.slide != null && !slideMap[a.slide]) slideMap[a.slide] = { assetId: a.id, matId: m.id, slide: a.slide };
      });
    } catch (e) { /* 读不出该资料图就跳过，不影响考纲 */ }
  });
  if (!Object.keys(slideMap).length) return; // 没有图就不挂，避免无谓字段
  outline.chapters.forEach(ch => ch.sections.forEach(s => s.points.forEach(p => {
    if (!p.pageRef) return;
    const imgs = [];
    pageNumsOf(p.pageRef).forEach(n => { const im = slideMap[n]; if (im) imgs.push(im); });
    if (imgs.length) p.images = imgs;
  })));
}

module.exports = {
  parseFrontmatter, parseSyllabusMd, parseQuestionBank, classifyMaterial, buildBookOutline, getBankQuestions,
  bankToExamQuestion, expandKp, typeLabelOf, normTypes, pageRefOf, attachImages, pageNumsOf
};
