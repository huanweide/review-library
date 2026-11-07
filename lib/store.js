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
const srs = require('./srs');

// 原子写：先写同目录临时文件，再 rename 覆盖。读者永远看到完整旧版或完整新版，
// 不会读到写了一半的 JSON（多进程共享 library/ 时的关键防线）。
// 用 rawWrite 别名是为了不让这段实现自己被批量替换成 writeAtomic。
const rawWrite = fs.writeFileSync.bind(fs);
function writeAtomic(file, content) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(3).toString('hex') + '.tmp';
  rawWrite(tmp, content);
  try { fs.renameSync(tmp, file); }
  catch (e) {
    // Windows 上目标被占用时，先删再移；仍失败才退回直接写（总比丢数据强）
    try { fs.rmSync(file, { force: true }); fs.renameSync(tmp, file); }
    catch (e2) { rawWrite(file, content); }
  }
  try { fs.rmSync(tmp, { force: true }); } catch (e3) { /* 已移走 */ }
}

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

  // 跨进程互斥：README 允许 server 模式与桌面版共用同一 library/，
  // 两个进程各自 new Store() 时，read-modify-write 会互相整文件覆盖（真探针复现：12 次收录只落 6 本）。
  // 锁 + 原子 rename 一起改掉这个写入范式，而不是给某一次写打补丁。
  const lockFile = () => path.join(root, '.write.lock');
  function withLock(fn) {
    const f = lockFile();
    let got = false;
    for (let i = 0; i < 800; i++) {
      try {
        const fd = fs.openSync(f, 'wx');
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        got = true;
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        // 进程崩溃留下的陈旧锁，超过 15 秒就清掉，避免永久卡死
        try { const st = fs.statSync(f); if (Date.now() - st.mtimeMs > 15000) { fs.rmSync(f, { force: true }); continue; } }
        catch (e2) { /* 锁刚好被释放 */ }
        const sab = new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(sab, 0, 0, 5);
      }
    }
    if (!got) throw new Error('数据目录正被另一个程序写入，请稍后重试');
    try { return fn(); } finally { try { fs.rmSync(f, { force: true }); } catch (e) { /* 已释放 */ } }
  }

  const indexFile = () => path.join(root, 'index.json');
  const readIndex = () => {
    try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); }
    catch (e) { return { books: [] }; }
  };
  const writeIndex = (idx) => writeAtomic(indexFile(), JSON.stringify(idx, null, 2));
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
    writeAtomic(bookJson(id), JSON.stringify(b, null, 2));
    writeAtomic(materialsJson(id), JSON.stringify([], null, 2));
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
    writeAtomic(f, JSON.stringify(b, null, 2));
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
      writeAtomic(path.join(layerDir, fname), buf);
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
        writeAtomic(path.join(assetsDir, aid + aext), abuf);
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
    writeAtomic(materialsJson(bookId), JSON.stringify(mats, null, 2));
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
    writeAtomic(materialsJson(bookId), JSON.stringify(mats, null, 2));
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
    writeAtomic(materialsJson(bookId), JSON.stringify(g.materials, null, 2));
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
  // 注意：assets/caption 存在 materials.json 的资料记录里，不是 book.json；
  // 且 getBook() 返回的是 {book, materials} 视图，不能拿它当落盘对象。
  function setAssetCaption(bookId, materialId, assetId, caption) {
    if (!safeId(bookId) || !safeId(materialId) || !safeId(assetId)) throw new Error('bad id');
    const f = materialsJson(bookId);
    const mats = JSON.parse(fs.readFileSync(f, 'utf8'));
    const rec = mats.find(m => m.id === materialId);
    if (!rec) throw new Error('no material');
    const a = (rec.assets || []).find(x => x.id === assetId);
    if (!a) throw new Error('no asset');
    a.caption = String(caption || '').slice(0, 500);
    writeAtomic(f, JSON.stringify(mats, null, 2));
    return true;
  }

  // ===== 回收站（软删可逆的补全）=====
  // 删除一律先进 .trash/trash.json 登记，文件/文件夹改名保留，可手动恢复或彻底删除。
  function trashFile() { return path.join(root, TRASH, 'trash.json'); }
  function readTrash() {
    try { return JSON.parse(fs.readFileSync(trashFile(), 'utf8')); }
    catch (e) { return { items: [] }; }
  }
  function writeTrash(t) { writeAtomic(trashFile(), JSON.stringify(t, null, 2)); }
  function trashKey(prefix) { return prefix + Date.now() + '_' + crypto.randomBytes(3).toString('hex'); }

  function listTrash() {
    return readTrash().items.slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  }

  function restoreMaterial(key) {
    if (!safeId(key)) throw new Error('bad key');
    let t = readTrash();
    let it = t.items.find(x => x.key === key && x.type === 'material');
    if (!it) throw new Error('no trash item');
    // 父书必须还活着：否则恢复会把文件搬进一个没有 book.json 的「幽灵书」目录，
    // 资料从回收站消失、书却永久卡在回收站（不可逆数据丢失）。
    // 若书也在回收站，先把书恢复回来，资料再挂回去 —— 保持两个实体的生命周期绑定。
    const idx0 = readIndex();
    const bookAlive = idx0.books.some(x => x.id === it.bookId) && fs.existsSync(bookJson(it.bookId));
    if (!bookAlive) {
      const bookItem = t.items.find(x => x.type === 'book' && x.bookId === it.bookId);
      if (!bookItem) throw new Error('原书已不存在，无法恢复该资料；请先恢复或重建原书');
      restoreBook(bookItem.key);
      // restoreBook 会重写 trash.json；必须重读快照，否则下面写回旧快照会让已恢复的书「复活」成假回收项。
      t = readTrash();
      it = t.items.find(x => x.key === key && x.type === 'material');
      if (!it) return { ok: true };
    }
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
      writeAtomic(materialsJson(it.bookId), JSON.stringify(mats, null, 2));
    }
    const idx = readIndex(); const e = idx.books.find(x => x.id === it.bookId);
    if (e) { Object.assign(e, recompute(it.bookId)); writeIndex(idx); }
    t.items = t.items.filter(x => x.key !== key); writeTrash(t);
    return { ok: true };
  }

  // 递归合并目录：只补目标缺失的条目，绝不覆盖目标已有文件。
  // 用于修复历史遗留的「幽灵书」目录（有 layer_/materials.json 但没有 book.json）。
  function mergeMissing(srcDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const s = path.join(srcDir, ent.name), d = path.join(destDir, ent.name);
      if (ent.isDirectory()) { mergeMissing(s, d); continue; }
      if (!fs.existsSync(d)) fs.copyFileSync(s, d);
    }
  }

  function restoreBook(key) {
    if (!safeId(key)) throw new Error('bad key');
    const t = readTrash();
    const it = t.items.find(x => x.key === key && x.type === 'book');
    if (!it) {
      // 幂等：该书可能已被「恢复资料」连带恢复。仅当回收站里连残留目录都没有才放行，否则大声失败。
      if (!fs.existsSync(path.join(root, TRASH, key))) return { ok: true, alreadyRestored: true };
      throw new Error('no trash item');
    }
    const src = path.join(root, TRASH, key);
    const dest = bookDir(it.bookId);
    if (fs.existsSync(src)) {
      if (!fs.existsSync(dest)) fs.renameSync(src, dest);
      else if (!fs.existsSync(bookJson(it.bookId))) {
        // 幽灵目录：把完整书目录里缺的条目（尤其 book.json）补回去，保留幽灵目录里已有的资料文件。
        mergeMissing(src, dest);
        fs.rmSync(src, { recursive: true, force: true });
      }
      // 目标已是完整书目录时：不覆盖，保留 src 原地，交由 purgeTrash 或人工处理，绝不静默丢数据。
    }
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
    writeAtomic(analysisJson(id), JSON.stringify(rec, null, 2));
    return { ok: true, id: rec.id };
  }
  function getAnalysis(id) {
    if (!safeId(id)) throw new Error('bad id');
    try { return JSON.parse(fs.readFileSync(analysisJson(id), 'utf8')); } catch (e) { return null; }
  }
  function saveExam(id, exam) {
    if (!safeId(id) || !safeId(exam.id)) throw new Error('bad id');
    ensureStudy(id);
    writeAtomic(examJson(id, exam.id), JSON.stringify(exam, null, 2));
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
    const ratings = exam.ratings || {};

    // 四档自评重排：只改下次复习时间，不重复记一次「真实复习」。
    // 自评发生在看完答案之后，不能把它当成又一次交卷（否则 lapse / leech 会被刷爆）。
    if (exam.rerate === true) {
      const byQ = {};
      (exam.grading || []).forEach(g => { byQ[g.qid] = g; });
      Object.keys(ratings).forEach(qid => {
        const g = byQ[qid];
        if (!g) return;
        (g.pointIds || []).forEach(pid => {
          const r = map[pid];
          if (r) { r.srs = srs.schedule(r.srs || {}, ratings[qid], now); r.lastSeen = now; }
        });
      });
      writeAtomic(f, JSON.stringify(recs, null, 2));
      return { ok: true, rerate: true, updated: Object.keys(ratings).length, items: recs.length };
    }

    // 幂等：同一套卷（exam.id + round）只算一次。批改被建模成「一次性事件」而非可覆盖字段，
    // 用户误点重复交卷不会把一次做错记成三次、把知识点误标为 leech。
    const already = recs.some(r => (r.history || []).some(h => h.examId === exam.id && h.round === exam.round));
    if (already) return { ok: true, replayed: true, updated: 0, items: recs.length };

    (exam.grading || []).forEach(g => {
      // 有用户四档自评就用自评；没有则按本地判定映射（错误→重来 / 部分正确→吃力 / 正确→会了）。
      const rating = srs.clamp(Math.round(Number(ratings[g.qid]) || srs.ratingFromVerdict(g.verdict)), 1, 4);
      (g.pointIds || []).forEach(pid => {
        let r = map[pid];
        if (!r) {
          r = { pointId: pid, title: titleOf(pid), lapseCount: 0, correctCount: 0, history: [], firstSeen: now, box: 1, source: g.source || null, origin: g.origin || null };
          map[pid] = r; recs.push(r);
        }
        r.title = (r.title && r.title !== pid) ? r.title : titleOf(pid);
        r.lastResult = g.verdict;
        r.lastSeen = now;
        r.history.push({ examId: exam.id, round: exam.round, verdict: g.verdict, cause: g.cause || '', at: now, rating });
        // 逐项排程：stability / difficulty / dueAt 落盘，替代固定 Leitner 查表（F1）。
        // box 仍按旧契约逐级升/重置（薄弱地图与「今日复习卷」依赖它），两者并存，升级不破坏既有行为。
        r.srs = srs.schedule(r.srs || {}, rating, now);
        if (g.verdict === '正确') r.box = Math.min((r.box || 1) + 1, 6);
        else r.box = 1;
        if (g.verdict !== '正确') r.lapseCount = (r.lapseCount || 0) + 1;
        else r.correctCount = (r.correctCount || 0) + 1;
      });
    });
    writeAtomic(f, JSON.stringify(recs, null, 2));
    return { ok: true, updated: (exam.grading || []).length, items: recs.length };
  }

  const api = { root, listBooks, createBook, getBook, updateBook, deleteBook, addMaterials, deleteMaterial, moveMaterial, readMaterial, readAsset, setAssetCaption, listTrash, restoreMaterial, restoreBook, purgeTrash, saveAnalysis, getAnalysis, saveExam, getExam, listExams, getMistakes, recordGrade };
  // 所有写操作统一走「跨进程锁 + 原子替换」。写在导出层包一层，
  // 内部函数互调（如 restoreMaterial → restoreBook）仍用闭包原函数，不会嵌套加锁。
  const LOCKED = ['createBook', 'updateBook', 'deleteBook', 'addMaterials', 'deleteMaterial',
    'moveMaterial', 'restoreMaterial', 'restoreBook', 'purgeTrash', 'setAssetCaption',
    'saveAnalysis', 'saveExam', 'recordGrade'];
  LOCKED.forEach(k => {
    const fn = api[k];
    api[k] = function () { return withLock(() => fn.apply(null, arguments)); };
  });
  return api;
}

module.exports = { Store, mimeOf };
