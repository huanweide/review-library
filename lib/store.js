'use strict';
// 复习资料图书馆 · 落盘核心逻辑（纯 Node，无任何框架依赖，Electron 与 server 共用）
// 设计要点：
//  - 每本书一个文件夹：<root>/books/<id>/，内含 book.json + materials.json + layer_<n>/ 资料文件
//  - <root>/index.json 只存摘要，书架渲染不必读每本书，上千本书不卡
//  - 删除一律软删到 <root>/.trash/，可逆，符合项目安全铁律
//  - id 白名单校验 + 拒绝 '..'，防路径穿越
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LAYER_RE = /^\d{1,2}$/;
const TRASH = '.trash';

function rid(prefix) { return prefix + crypto.randomBytes(6).toString('hex'); }
function safeId(x) { return typeof x === 'string' && ID_RE.test(x); }

function mimeOf(ext) {
  const m = {
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.txt': 'text/plain',
    '.md': 'text/markdown', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  return m[(ext || '').toLowerCase()] || 'application/octet-stream';
}

function Store(root) {
  if (!root) throw new Error('Store needs root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, TRASH), { recursive: true });
  fs.mkdirSync(path.join(root, 'books'), { recursive: true });

  const indexFile = () => path.join(root, 'index.json');
  const readIndex = () => {
    try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); }
    catch (e) { return { books: [] }; }
  };
  const writeIndex = (idx) => fs.writeFileSync(indexFile(), JSON.stringify(idx, null, 2));
  const bookDir = (id) => path.join(root, 'books', id);
  const bookJson = (id) => path.join(bookDir(id), 'book.json');
  const materialsJson = (id) => path.join(bookDir(id), 'materials.json');

  function recompute(id) {
    const b = JSON.parse(fs.readFileSync(bookJson(id), 'utf8'));
    let mats = [];
    try { mats = JSON.parse(fs.readFileSync(materialsJson(id), 'utf8')); } catch (e) {}
    const layerCounts = {}; let total = 0;
    mats.forEach(m => { layerCounts[m.layer] = (layerCounts[m.layer] || 0) + 1; total++; });
    return {
      id: b.id, title: b.title, exam: b.exam || '', subject: b.subject || '',
      coverColor: b.coverColor || '#3a7afe', note: b.note || '', createdAt: b.createdAt,
      materialCount: total, layerCounts
    };
  }

  function listBooks() {
    return readIndex().books.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function createBook(meta) {
    const id = rid('b_');
    const b = {
      id, title: (meta && meta.title) || '未命名', exam: (meta && meta.exam) || '',
      subject: (meta && meta.subject) || '', coverColor: (meta && meta.coverColor) || '#3a7afe',
      note: (meta && meta.note) || '', createdAt: Date.now()
    };
    fs.mkdirSync(bookDir(id), { recursive: true });
    fs.writeFileSync(bookJson(id), JSON.stringify(b, null, 2));
    fs.writeFileSync(materialsJson(id), JSON.stringify([], null, 2));
    const idx = readIndex(); idx.books.push(recompute(id)); writeIndex(idx);
    return b;
  }

  function getBook(id) {
    if (!safeId(id)) throw new Error('bad id');
    const b = JSON.parse(fs.readFileSync(bookJson(id), 'utf8'));
    let mats = [];
    try { mats = JSON.parse(fs.readFileSync(materialsJson(id), 'utf8')); } catch (e) {}
    return { book: b, materials: mats };
  }

  function updateBook(id, patch) {
    if (!safeId(id)) throw new Error('bad id');
    const f = bookJson(id);
    const b = JSON.parse(fs.readFileSync(f, 'utf8'));
    ['title', 'exam', 'subject', 'coverColor', 'note'].forEach(k => { if (k in (patch || {})) b[k] = patch[k]; });
    fs.writeFileSync(f, JSON.stringify(b, null, 2));
    const idx = readIndex(); const e = idx.books.find(x => x.id === id);
    if (e) { Object.assign(e, recompute(id)); writeIndex(idx); }
    return b;
  }

  function deleteBook(id) {
    if (!safeId(id)) throw new Error('bad id');
    const key = trashKey('b_');
    const dest = path.join(root, TRASH, key);
    fs.renameSync(bookDir(id), dest);
    const idx = readIndex(); idx.books = idx.books.filter(x => x.id !== id); writeIndex(idx);
    let title = id;
    try { title = (JSON.parse(fs.readFileSync(path.join(dest, 'book.json'), 'utf8')).title) || id; } catch (e) {}
    const t = readTrash();
    t.items.push({ key, type: 'book', bookId: id, name: title, deletedAt: Date.now() });
    writeTrash(t);
    return { ok: true };
  }

  function addMaterials(bookId, layer, items, meta) {
    if (!safeId(bookId)) throw new Error('bad id');
    if (!LAYER_RE.test(String(layer))) throw new Error('bad layer');
    layer = parseInt(layer, 10);
    const layerDir = path.join(bookDir(bookId), 'layer_' + layer);
    fs.mkdirSync(layerDir, { recursive: true });
    let mats = [];
    try { mats = JSON.parse(fs.readFileSync(materialsJson(bookId), 'utf8')); } catch (e) {}
    const added = [];
    (items || []).forEach(it => {
      const origName = it.name || 'file';
      const safeName = String(origName).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 120);
      const ext = path.extname(safeName);
      const mid = rid('m_');
      const fname = mid + ext;
      const buf = Buffer.from(it.data || '', 'base64');
      fs.writeFileSync(path.join(layerDir, fname), buf);
      // 附属图资产（PDF 每页渲染图 / PPTX·DOCX 内嵌媒体）：一等公民，挂在母资料下，不污染资料列表。
      const assetsDir = path.join(layerDir, mid + '.assets');
      const assets = [];
      (it.assets || []).forEach(a => {
        const an = String(a.name || 'asset').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 120);
        const aext = path.extname(an) || '.bin';
        const abuf = Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data || '', 'base64');
        if (!abuf.length) return;
        fs.mkdirSync(assetsDir, { recursive: true });
        const aid = rid('a_');
        fs.writeFileSync(path.join(assetsDir, aid + aext), abuf);
        assets.push({
          id: aid, name: an, ext: aext, size: abuf.length,
          kind: a.kind || 'media', page: a.page || null, slide: a.slide || null, caption: a.caption || ''
        });
      });
      const rec = {
        id: mid, name: safeName, origName, ext, size: buf.length,
        layer, prompt: (meta && meta.prompt) || '', tags: (meta && meta.tags) || [],
        source: (meta && meta.source) || 'user',
        derivedFrom: (meta && Array.isArray(meta.derivedFrom)) ? meta.derivedFrom : [],
        assets: assets, extractedText: it.extractedText ? String(it.extractedText) : '',
        addedAt: Date.now()
      };
      mats.push(rec); added.push(rec);
    });
    fs.writeFileSync(materialsJson(bookId), JSON.stringify(mats, null, 2));
    const idx = readIndex(); const e = idx.books.find(x => x.id === bookId);
    if (e) { Object.assign(e, recompute(bookId)); writeIndex(idx); }
    return added;
  }

  function deleteMaterial(bookId, materialId) {
    if (!safeId(bookId) || !safeId(materialId)) throw new Error('bad id');
    const g = getBook(bookId);
    const rec = g.materials.find(m => m.id === materialId);
    if (!rec) throw new Error('no material');
    const fpath = path.join(bookDir(bookId), 'layer_' + rec.layer, rec.id + rec.ext);
    const assetsDir = path.join(bookDir(bookId), 'layer_' + rec.layer, rec.id + '.assets');
    const key = trashKey('m_');
    if (fs.existsSync(fpath)) fs.renameSync(fpath, path.join(root, TRASH, key));
    if (fs.existsSync(assetsDir)) fs.renameSync(assetsDir, path.join(root, TRASH, key + '.assets'));
    const mats = g.materials.filter(m => m.id !== materialId);
    fs.writeFileSync(materialsJson(bookId), JSON.stringify(mats, null, 2));
    const idx = readIndex(); const e = idx.books.find(x => x.id === bookId);
    if (e) { Object.assign(e, recompute(bookId)); writeIndex(idx); }
    const t = readTrash();
    t.items.push({ key, type: 'material', bookId, materialId, layer: rec.layer, name: rec.name, ext: rec.ext, deletedAt: Date.now(), rec });
    writeTrash(t);
    return { ok: true };
  }

  function moveMaterial(bookId, materialId, toLayer) {
    if (!safeId(bookId) || !safeId(materialId)) throw new Error('bad id');
    if (!LAYER_RE.test(String(toLayer))) throw new Error('bad layer');
    toLayer = parseInt(toLayer, 10);
    const g = getBook(bookId);
    const rec = g.materials.find(m => m.id === materialId);
    if (!rec) throw new Error('no material');
    if (rec.layer === toLayer) return rec;
    const fromDir = path.join(bookDir(bookId), 'layer_' + rec.layer);
    const toDir = path.join(bookDir(bookId), 'layer_' + toLayer);
    fs.mkdirSync(toDir, { recursive: true });
    const src = path.join(fromDir, rec.id + rec.ext);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(toDir, rec.id + rec.ext));
    rec.layer = toLayer;
    fs.writeFileSync(materialsJson(bookId), JSON.stringify(g.materials, null, 2));
    const idx = readIndex(); const e = idx.books.find(x => x.id === bookId);
    if (e) { Object.assign(e, recompute(bookId)); writeIndex(idx); }
    return rec;
  }

  function readMaterial(bookId, materialId) {
    if (!safeId(bookId) || !safeId(materialId)) throw new Error('bad id');
    const g = getBook(bookId);
    const rec = g.materials.find(m => m.id === materialId);
    if (!rec) throw new Error('no material');
    const fpath = path.join(bookDir(bookId), 'layer_' + rec.layer, rec.id + rec.ext);
    const buf = fs.readFileSync(fpath);
    return { id: rec.id, name: rec.name, ext: rec.ext, mime: mimeOf(rec.ext), size: buf.length, data: buf.toString('base64'),
      assets: (rec.assets || []).map(a => ({ id: a.id, name: a.name, ext: a.ext, size: a.size, kind: a.kind, page: a.page, slide: a.slide, caption: a.caption })),
      extractedText: rec.extractedText || '' };
  }

  // 读取某个附属图资产（PDF 页图 / PPTX·DOCX 内嵌媒体）的字节，供预览/分析引用。
  function readAsset(bookId, materialId, assetId) {
    if (!safeId(bookId) || !safeId(materialId) || !safeId(assetId)) throw new Error('bad id');
    const g = getBook(bookId);
    const rec = g.materials.find(m => m.id === materialId);
    if (!rec) throw new Error('no material');
    const a = (rec.assets || []).find(x => x.id === assetId);
    if (!a) throw new Error('no asset');
    const fpath = path.join(bookDir(bookId), 'layer_' + rec.layer, rec.id + '.assets', a.id + a.ext);
    const buf = fs.readFileSync(fpath);
    return { id: a.id, name: a.name, ext: a.ext, kind: a.kind, page: a.page, slide: a.slide, caption: a.caption,
      mime: mimeOf(a.ext), size: buf.length, data: buf.toString('base64') };
  }

  // M3 多模态：把云端视觉模型读懂的图说明写回 asset，供预览/考纲视图显示「这张图讲了什么」。
  function setAssetCaption(bookId, materialId, assetId, caption) {
    if (!safeId(bookId) || !safeId(materialId) || !safeId(assetId)) throw new Error('bad id');
    const g = getBook(bookId);
    const rec = g.materials.find(m => m.id === materialId);
    if (!rec) throw new Error('no material');
    const a = (rec.assets || []).find(x => x.id === assetId);
    if (!a) throw new Error('no asset');
    a.caption = String(caption || '').slice(0, 500);
    writeBookMeta(bookId, g);
    return true;
  }

  // ===== 回收站（软删可逆的补全）=====
  // 删除一律先进 .trash/trash.json 登记，文件/文件夹改名保留，可手动恢复或彻底删除。
  function trashFile() { return path.join(root, TRASH, 'trash.json'); }
  function readTrash() {
    try { return JSON.parse(fs.readFileSync(trashFile(), 'utf8')); }
    catch (e) { return { items: [] }; }
  }
  function writeTrash(t) { fs.writeFileSync(trashFile(), JSON.stringify(t, null, 2)); }
  function trashKey(prefix) { return prefix + Date.now() + '_' + crypto.randomBytes(3).toString('hex'); }

  function listTrash() {
    return readTrash().items.slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  }

  function restoreMaterial(key) {
    if (!safeId(key)) throw new Error('bad key');
    const t = readTrash();
    const it = t.items.find(x => x.key === key && x.type === 'material');
    if (!it) throw new Error('no trash item');
    const src = path.join(root, TRASH, key);
    const assetsSrc = path.join(root, TRASH, key + '.assets');
    if (fs.existsSync(src)) {
      const destDir = path.join(bookDir(it.bookId), 'layer_' + it.layer);
      fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(src, path.join(destDir, it.materialId + it.ext));
    }
    if (fs.existsSync(assetsSrc)) fs.renameSync(assetsSrc, path.join(bookDir(it.bookId), 'layer_' + it.layer, it.materialId + '.assets'));
    let mats = [];
    try { mats = JSON.parse(fs.readFileSync(materialsJson(it.bookId), 'utf8')); } catch (e) {}
    if (it.rec && !mats.find(m => m.id === it.materialId)) {
      mats.push(it.rec);
      fs.writeFileSync(materialsJson(it.bookId), JSON.stringify(mats, null, 2));
    }
    const idx = readIndex(); const e = idx.books.find(x => x.id === it.bookId);
    if (e) { Object.assign(e, recompute(it.bookId)); writeIndex(idx); }
    t.items = t.items.filter(x => x.key !== key); writeTrash(t);
    return { ok: true };
  }

  function restoreBook(key) {
    if (!safeId(key)) throw new Error('bad key');
    const t = readTrash();
    const it = t.items.find(x => x.key === key && x.type === 'book');
    if (!it) throw new Error('no trash item');
    const src = path.join(root, TRASH, key);
    const dest = bookDir(it.bookId);
    if (fs.existsSync(src) && !fs.existsSync(dest)) fs.renameSync(src, dest);
    const idx = readIndex();
    if (!idx.books.find(x => x.id === it.bookId)) { idx.books.push(recompute(it.bookId)); writeIndex(idx); }
    t.items = t.items.filter(x => x.key !== key); writeTrash(t);
    return { ok: true };
  }

  function purgeTrash(key) {
    if (!safeId(key)) throw new Error('bad key');
    const t = readTrash();
    const it = t.items.find(x => x.key === key);
    if (!it) throw new Error('no trash item');
    const p = path.join(root, TRASH, key);
    if (it.type === 'book') { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }
    else {
      try { if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true }); else fs.unlinkSync(p); } catch (e) {}
      const pa = path.join(root, TRASH, key + '.assets');
      try { if (fs.existsSync(pa)) fs.rmSync(pa, { recursive: true, force: true }); } catch (e) {}
    }
    t.items = t.items.filter(x => x.key !== key); writeTrash(t);
    return { ok: true };
  }

  // ===== 学习产物：分析结果 / 试卷（与资料文件分目录，不混进 materials.json）=====
  const studyDir = (id) => path.join(bookDir(id), 'study');
  const analysisJson = (id) => path.join(studyDir(id), 'analysis.json');
  const examsDir = (id) => path.join(studyDir(id), 'exams');
  const examJson = (id, eid) => path.join(examsDir(id), eid + '.json');
  const ensureStudy = (id) => { fs.mkdirSync(examsDir(id), { recursive: true }); };

  function saveAnalysis(id, analysis) {
    if (!safeId(id)) throw new Error('bad id');
    ensureStudy(id);
    const rec = Object.assign({}, analysis, { id: analysis.id || rid('a_'), savedAt: Date.now() });
    fs.writeFileSync(analysisJson(id), JSON.stringify(rec, null, 2));
    return { ok: true, id: rec.id };
  }
  function getAnalysis(id) {
    if (!safeId(id)) throw new Error('bad id');
    try { return JSON.parse(fs.readFileSync(analysisJson(id), 'utf8')); } catch (e) { return null; }
  }
  function saveExam(id, exam) {
    if (!safeId(id) || !safeId(exam.id)) throw new Error('bad id');
    ensureStudy(id);
    fs.writeFileSync(examJson(id, exam.id), JSON.stringify(exam, null, 2));
    return { ok: true, id: exam.id };
  }
  function getExam(id, eid) {
    if (!safeId(id) || !safeId(eid)) throw new Error('bad id');
    try { return JSON.parse(fs.readFileSync(examJson(id, eid), 'utf8')); } catch (e) { return null; }
  }
  function listExams(id) {
    if (!safeId(id)) throw new Error('bad id');
    try {
      return fs.readdirSync(examsDir(id)).filter(f => f.endsWith('.json')).map(f => {
        try {
          const e = JSON.parse(fs.readFileSync(path.join(examsDir(id), f), 'utf8'));
          return { id: e.id, round: e.round, createdAt: e.createdAt, engine: e.engine,
            count: (e.questions || []).length, graded: !!(e.grading && e.grading.length) };
        } catch (err) { return null; }
      }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
    } catch (e) { return []; }
  }

  // ===== 错题本（M1）：每次批改后把薄弱知识点累积落盘，跨会话持久 =====
  // 设计依据：Anki 的 per-item lapse 追踪 + leech（多次答错上浮）。
  // 我们不采用 Anki 的四态卡机（New/Learning/Review/Relearning）——我们的「卡」= 一个薄弱知识点，状态轻得多。
  const mistakesJson = (id) => path.join(studyDir(id), 'mistakes.json');

  function getMistakes(id) {
    if (!safeId(id)) throw new Error('bad id');
    try { return JSON.parse(fs.readFileSync(mistakesJson(id), 'utf8')); }
    catch (e) { return []; }
  }

  // 批改后调用。exam.grading 每项带 pointIds / verdict（正确|部分正确|错误）/ cause。
  // 非「正确」计入 lapse（部分正确也视为没真正掌握，纳入复习）；「正确」计入 correctCount。
  function recordGrade(bookId, exam, analysis) {
    if (!safeId(bookId)) throw new Error('bad id');
    ensureStudy(bookId);
    const f = mistakesJson(bookId);
    let recs = [];
    try { recs = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
    const titleOf = (pid) => {
      const p = ((analysis && analysis.points) || []).find(x => x.id === pid);
      return p ? p.title : pid;
    };
    const map = {};
    recs.forEach(r => { map[r.pointId] = r; });
    const now = Date.now();
    (exam.grading || []).forEach(g => {
      (g.pointIds || []).forEach(pid => {
        let r = map[pid];
        if (!r) {
          r = { pointId: pid, title: titleOf(pid), lapseCount: 0, correctCount: 0, history: [], firstSeen: now, box: 1, source: g.source || null, origin: g.origin || null };
          map[pid] = r; recs.push(r);
        }
        r.title = (r.title && r.title !== pid) ? r.title : titleOf(pid);
        r.lastResult = g.verdict;
        r.lastSeen = now;
        r.history.push({ examId: exam.id, round: exam.round, verdict: g.verdict, cause: g.cause || '', at: now });
        // M2 间隔重复：答对升级盒子（拉长间隔），答错（含部分正确）重置到盒子 1（立刻重来）。
        // 采用 Leitner/SM-2 式轻量盒子，不引入 FSRS 权重拟合（见阶段零研究文档）。
        if (g.verdict === '正确') r.box = Math.min((r.box || 1) + 1, 6);
        else r.box = 1;
        if (g.verdict !== '正确') r.lapseCount = (r.lapseCount || 0) + 1;
        else r.correctCount = (r.correctCount || 0) + 1;
      });
    });
    fs.writeFileSync(f, JSON.stringify(recs, null, 2));
    return { ok: true, updated: (exam.grading || []).length, items: recs.length };
  }

  return { root, listBooks, createBook, getBook, updateBook, deleteBook, addMaterials, deleteMaterial, moveMaterial, readMaterial, readAsset, listTrash, restoreMaterial, restoreBook, purgeTrash, saveAnalysis, getAnalysis, saveExam, getExam, listExams, getMistakes, recordGrade };
}

module.exports = { Store, mimeOf };
