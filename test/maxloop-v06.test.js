/**
 * maxloop v0.6 判别测试：竞品级能力融合 + 两条真缺陷
 *
 * 纪律：本文件必须先在「旧代码」上跑红，改完再跑绿，两份输出都留痕。
 * 全程只用临时目录 / 纯内存 / 本机回环端口，不改项目数据、不发外部请求。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS | ' + name); }
  else { fail++; console.log('  FAIL | ' + name + (extra !== undefined ? ' | ' + String(extra).slice(0, 220) : '')); }
};
const tryMod = (rel) => { try { return require(path.join(ROOT, rel)); } catch (e) { return null; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rlv6-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const { Store } = require(path.join(ROOT, 'lib/store.js'));
const study = require(path.join(ROOT, 'lib/study.js'));

function seedBook(s, title, keyword) {
  const b = s.createBook({ title });
  s.addMaterials(b.id, 1, [{ name: '材料.txt', data: Buffer.from(keyword + ' 的常见考法').toString('base64'),
    extractedText: keyword + ' 是本章重点，常考计算与辨析。' }], {});
  const m = s.getBook(b.id).materials[0];
  s.saveAnalysis(b.id, {
    id: 'a_' + b.id, points: [
      { id: 'p1', title: keyword + '的定义', summary: keyword + ' 指一类结构', category: '晶体', sourceFile: '材料.txt' },
      { id: 'p2', title: keyword + '的计算', summary: keyword + ' 可用公式求解', category: '晶体', sourceFile: '材料.txt' }
    ], questions: [
      { id: 'q1', type: 'calc', stem: '求' + keyword + '的数值', options: [], answer: '0.74',
        method: '公式 代入数值 运算得 0.74 验算 回代', pointIds: ['p1', 'p2'], origin: 'source', source: null }
    ]
  });
  return { bookId: b.id, matId: m.id };
}

function httpReq(port, method, url, body) {
  return new Promise((resolve, reject) => {
    const s = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path: url,
      headers: s ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) } : {} },
      x => { let t = ''; x.on('data', c => t += c); x.on('end', () => resolve(t)); });
    r.on('error', reject);
    if (s) r.write(s);
    r.end();
  });
}

(async () => {
  console.log('=== maxloop v0.6 判别测试（旧代码应红）===');

  // ---------- F1 逐项 SRS + 四档反馈 ----------
  const srs = tryMod('lib/srs.js');
  ok('F1-1 lib/srs.js 存在且导出 schedule/rateLabel', !!srs && typeof srs.schedule === 'function');
  if (srs) {
    const now = Date.now();
    const base = { stability: 0, difficulty: 0, reps: 0, lapses: 0 };
    const a = srs.schedule(base, 1, now), g = srs.schedule(base, 3, now), e = srs.schedule(base, 4, now);
    ok('F1-2 Again < Good < Easy 的下次复习间隔单调递增',
      a.dueAt < g.dueAt && g.dueAt < e.dueAt, JSON.stringify({ a: a.dueAt, g: g.dueAt, e: e.dueAt }));
    ok('F1-3 Again 记一次 lapse 且缩短 stability', a.lapses === 1 && a.stability < g.stability,
      JSON.stringify({ aL: a.lapses, aS: a.stability, gS: g.stability }));
    ok('F1-4 返回的 dueAt 是绝对时间且大于 now', e.dueAt > now);
  }
  // 真 Store 链路：ratings 必须影响落盘的排程
  {
    const d = tmp(); const s = new Store(d);
    const { bookId } = seedBook(s, 'SRS书', '致密度');
    s.saveExam(bookId, { id: 'ex1', round: 1, createdAt: Date.now(), engine: 'local',
      questions: [{ id: 'q1', type: 'single', stem: '致密度是多少', options: ['0.74', '0.5'], answer: '0.74', pointIds: ['p1'], origin: 'source', source: null }],
      answers: {}, grading: [], weakPointIds: [] });
    const ex = s.getExam(bookId, 'ex1');
    study.gradeExam(ex, { q1: 'B' });
    ex.ratings = { q1: 4 }; // Easy
    s.saveExam(bookId, ex);
    s.recordGrade(bookId, ex, s.getAnalysis(bookId));
    const rec = s.getMistakes(bookId).find(x => x.pointId === 'p1');
    ok('F1-5 真 Store：四档评分写进 mistakes 记录（srs.dueAt 落盘）',
      !!rec && !!rec.srs && typeof rec.srs.dueAt === 'number' && rec.srs.lastRating === 4,
      JSON.stringify(rec && rec.srs));
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ---------- F2 全局全文搜索 ----------
  const search = tryMod('lib/search.js');
  ok('F2-1 lib/search.js 存在且导出 searchAll', !!search && typeof search.searchAll === 'function');
  if (search) {
    const d = tmp(); const s = new Store(d);
    seedBook(s, '第一本书', '致密度');
    seedBook(s, '第二本书', '配位数');
    const r = search.searchAll(s, '致密度');
    ok('F2-2 跨书命中资料正文（extractedText）', r.some(x => x.type === 'material' && /第一本书/.test(x.bookTitle || '')),
      JSON.stringify(r.slice(0, 3)));
    ok('F2-3 命中知识点与题目（不只文件名）',
      r.some(x => x.type === 'point') && r.some(x => x.type === 'question'), JSON.stringify(r.map(x => x.type)));
    const r2 = search.searchAll(s, '不存在的词xyz');
    ok('F2-4 无命中返回空数组而不是抛错', Array.isArray(r2) && r2.length === 0);
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ---------- F3 知识点思维导图 ----------
  const graph = tryMod('lib/graph.js');
  ok('F3-1 lib/graph.js 存在且导出 buildGraph', !!graph && typeof graph.buildGraph === 'function');
  if (graph) {
    const a = { points: [
      { id: 'p1', title: '致密度', category: '晶体' }, { id: 'p2', title: '配位数', category: '晶体' },
      { id: 'p3', title: '晶胞', category: '晶体' }],
      questions: [{ id: 'q1', pointIds: ['p1', 'p2'], stem: '求致密度' }, { id: 'q2', pointIds: ['p2', 'p3'], stem: '求配位数' }] };
    const g = graph.buildGraph(a);
    ok('F3-2 生成节点与关系边（不是纯文本分组）',
      g && Array.isArray(g.nodes) && g.nodes.length === 3 && Array.isArray(g.edges) && g.edges.length >= 2,
      JSON.stringify(g && { n: g.nodes.length, e: g.edges.length }));
    ok('F3-3 边带 source/target/weight 且两端都在节点里',
      g && g.edges.every(e => e.source && e.target && typeof e.weight === 'number' &&
        g.nodes.some(n => n.id === e.source) && g.nodes.some(n => n.id === e.target)));
  }

  // ---------- F4 学习分析报告 ----------
  const analytics = tryMod('lib/analytics.js');
  ok('F4-1 lib/analytics.js 存在且导出 buildReport', !!analytics && typeof analytics.buildReport === 'function');
  if (analytics) {
    const d = tmp(); const s = new Store(d);
    const { bookId } = seedBook(s, '统计书', '相图');
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      s.saveExam(bookId, { id: 'e' + i, round: i, createdAt: now - (2 - i) * 86400000, engine: 'local',
        questions: [{ id: 'q' + i, type: 'single', stem: '题' + i, options: ['A', 'B'], answer: 'A', pointIds: ['p1'], origin: 'source', source: null }],
        answers: { ['q' + i]: i === 0 ? 'B' : 'A' }, grading: [], weakPointIds: [] });
      const ex = s.getExam(bookId, 'e' + i);
      study.gradeExam(ex, ex.answers);
      s.saveExam(bookId, ex);
      s.recordGrade(bookId, ex, s.getAnalysis(bookId));
    }
    const rep = analytics.buildReport(s, bookId, now);
    ok('F4-2 报告含按天正确率趋势（days 非空且有 rate）',
      rep && Array.isArray(rep.days) && rep.days.length >= 1 && rep.days.every(d => typeof d.rate === 'number'),
      JSON.stringify(rep && rep.days));
    ok('F4-3 报告含总体正确率与复习总量字段',
      rep && typeof rep.overallRate === 'number' && typeof rep.totalReviews === 'number' && rep.totalReviews >= 3,
      JSON.stringify(rep && { r: rep.overallRate, t: rep.totalReviews }));
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ---------- F5 整库导出 / 导入 ----------
  const backup = tryMod('lib/backup.js');
  ok('F5-1 lib/backup.js 存在且导出 exportAll/importAll', !!backup && typeof backup.exportAll === 'function' && typeof backup.importAll === 'function');
  if (backup) {
    const d1 = tmp(), d2 = tmp();
    const s1 = new Store(d1); seedBook(s1, '要搬家的书', '熵');
    const dump = backup.exportAll(s1);
    ok('F5-2 导出是可解析 JSON 且含版本号与书数据',
      (() => { try { const j = typeof dump === 'string' ? JSON.parse(dump) : dump; return j.format && Array.isArray(j.books) && j.books.length === 1; } catch (e) { return false; } })(),
      String(dump).slice(0, 120));
    const s2 = new Store(d2);
    const res = backup.importAll(s2, dump, { mode: 'replace' });
    ok('F5-3 导入到空库后书名与资料都还在',
      res && res.books === 1 && s2.listBooks().length === 1 && s2.listBooks()[0].title === '要搬家的书',
      JSON.stringify(res));
    ok('F5-4 损坏/非本系统的数据被拒绝而不是清空现有库',
      (() => { try { return backup.importAll(s2, '{"format":"other"}', { mode: 'replace' }) === null || (typeof backup.importAll(s2, '{"format":"other"}', { mode: 'replace' }) === 'object' && false); } catch (e) { return true; } })(),
      '');
    fs.rmSync(d1, { recursive: true, force: true }); fs.rmSync(d2, { recursive: true, force: true });
  }

  // ---------- F6 主动回忆挖空 ----------
  const cloze = tryMod('lib/cloze.js');
  ok('F6-1 lib/cloze.js 存在且导出 makeCloze', !!cloze && typeof cloze.makeCloze === 'function');
  if (cloze) {
    const c = cloze.makeCloze({ id: 'p1', title: '致密度', summary: '面心立方致密度约为 0.74，由原子半径推导' });
    ok('F6-2 生成带遮蔽的文本与可揭示答案',
      c && c.masked && c.answer && c.masked !== c.answer && /____/.test(c.masked), JSON.stringify(c));
    ok('F6-3 空内容不编造，返回 null', cloze.makeCloze({ id: 'p', title: '', summary: '' }) === null);
  }

  // ---------- B1 重复交卷幂等（critic 探针） ----------
  {
    const d = tmp(); const s = new Store(d);
    const b = s.createBook({ title: '幂等探针' });
    s.saveAnalysis(b.id, { id: 'a1', points: [{ id: 'p1', title: 'A' }, { id: 'p2', title: 'B' }], questions: [] });
    s.saveExam(b.id, { id: 'e1', round: 1, createdAt: Date.now(), engine: 'local', questions: [
      { id: 'q1', type: 'single', stem: 't1', options: ['A', 'B'], answer: 'A', pointIds: ['p1'], origin: 'source', source: null },
      { id: 'q2', type: 'explain', stem: 't2', options: [], answer: '甲 乙 丙', pointIds: ['p2'], origin: 'source', source: null }
    ], answers: {}, grading: [], weakPointIds: [] });
    for (let i = 0; i < 3; i++) {
      const ex = s.getExam(b.id, 'e1');
      study.gradeExam(ex, { q1: 'B', q2: '' });
      s.saveExam(b.id, ex);
      s.recordGrade(b.id, ex, s.getAnalysis(b.id));
    }
    const m = s.getMistakes(b.id).find(x => x.pointId === 'p1');
    ok('B1-1 同一套卷交 3 次，错题只记 1 次 lapse / 1 条历史',
      !!m && m.lapseCount === 1 && m.history.length === 1,
      JSON.stringify(m && { lapse: m.lapseCount, hist: m.history.length }));
    const leech = study.summarizeMistakes(s, b.id, Date.now()).leechCount;
    ok('B1-2 不因重放把知识点误标为 leech', leech === 0, 'leechCount=' + leech);
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ---------- B2 多进程共享目录不丢书（critic 双服务探针） ----------
  {
    const d = tmp();
    const server = path.join(ROOT, 'server.js');
    const P1 = 5421, P2 = 5422;
    const a = spawn(process.execPath, [server], { env: Object.assign({}, process.env, { PORT: String(P1), LIBRARY_ROOT: d }), stdio: 'ignore' });
    const b = spawn(process.execPath, [server], { env: Object.assign({}, process.env, { PORT: String(P2), LIBRARY_ROOT: d }), stdio: 'ignore' });
    try {
      let ready = false;
      for (let i = 0; i < 40; i++) {
        try { await httpReq(P1, 'GET', '/api/books'); await httpReq(P2, 'GET', '/api/books'); ready = true; break; } catch (e) { await wait(150); }
      }
      ok('B2-0 两个服务进程都就绪', ready);
      const jobs = [];
      for (let i = 0; i < 6; i++) {
        jobs.push(httpReq(P1, 'POST', '/api/books', { title: 'A' + i }));
        jobs.push(httpReq(P2, 'POST', '/api/books', { title: 'B' + i }));
      }
      const rs = await Promise.all(jobs);
      await wait(500);
      const list = JSON.parse(await httpReq(P1, 'GET', '/api/books'));
      ok('B2-1 12 次并发收录全部成功', rs.filter(x => x.includes('"id"')).length === 12,
        rs.filter(x => x.includes('"id"')).length + '/12');
      ok('B2-2 index.json 实际落 12 本（旧版会静默丢 2 本）', list.length === 12,
        '实际=' + list.length + ' 标题=' + list.map(x => x.title).sort().join(','));
    } catch (e) {
      ok('B2 探针可运行', false, e.message);
    } finally {
      try { a.kill('SIGKILL'); b.kill('SIGKILL'); } catch (e) {}
      await wait(200);
      fs.rmSync(d, { recursive: true, force: true });
    }
  }

  console.log('\n判别测试结果： ' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exit(1);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });
