'use strict';
// maxloop 判别测试：5 条真缺陷，每条在「修复前」必须红、「修复后」必须绿。
// 判据全部来自真实 Store / 真实 HTTP 服务，不用 mock 掩盖路径差异。
// 依据 PROCESS/research-诚实降级与工程健壮性/best-practices.md
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { Store } = require('../lib/store');
const study = require('../lib/study');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ml-'));
function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ code: r.statusCode, body: d })); }).on('error', rej);
  });
}

(async () => {
  // ── 1) 幽灵书：删资料 → 删书 → 恢复资料 → 恢复书，必须完整可恢复 ──
  {
    const d = tmp(); const s = new Store(d);
    const b = s.createBook({ title: 'A' });
    s.addMaterials(b.id, 1, [{ name: '资料.txt', data: Buffer.from('hello').toString('base64') }], {});
    const mid = s.getBook(b.id).materials[0].id;
    s.deleteMaterial(b.id, mid);
    s.deleteBook(b.id);
    const items = s.listTrash();
    const mItem = items.find(x => x.type === 'material');
    const bItem = items.find(x => x.type === 'book');
    let err = null;
    try { s.restoreMaterial(mItem.key); } catch (e) { err = e; }
    let err2 = null;
    try { s.restoreBook(bItem.key); } catch (e) { err2 = e; }
    const books = s.listBooks();
    ok('D1 恢复资料不会造幽灵书（书能恢复且资料在）',
      !err && !err2 && books.length === 1 && (s.getBook(b.id).materials || []).some(x => x.id === mid),
      'err=' + (err && err.code) + ' err2=' + (err2 && err2.code) + ' books=' + books.length);
    ok('D1b 恢复后回收站清空（没有卡死项）', s.listTrash().length === 0, 'trash=' + JSON.stringify(s.listTrash().map(x => x.type)));
    cleanup(d);
  }

  // ── 2) 真实 Store 落盘的 asset.ext 带点，M3 必须仍能发图 ──
  {
    const d = tmp(); const s = new Store(d);
    const b = s.createBook({ title: 'T' });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    s.addMaterials(b.id, 1, [{ name: 'x.pptx', data: 'AAAA', assets: [{ name: 'slide1.png', data: png.toString('base64'), kind: 'media', slide: 1 }] }], {});
    const ext = s.getBook(b.id).materials[0].assets[0].ext;
    ok('D2 真实落盘 asset.ext 形态已核实', ext === '.png' || ext === 'png', 'ext=' + JSON.stringify(ext));

    const RAW = JSON.stringify({
      points: [{ title: '致密度', summary: '原文', origin: 'source', sourceFile: 'x.pptx', sourceLoc: 'L1', usage: '摘录' }],
      questions: [{ type: 'calc', stem: '求致密度', options: [], answer: '0.74', explanation: '材料未直接覆盖', commonMistake: '', method: '公式 致密度=π/(3√2)≈0.74 代入数值 运算得 0.74 验算 回代', pointTitles: ['致密度'], origin: 'ai', source: null }]
    });
    let sent = null;
    const chat = async (cfg, msgs) => { sent = msgs; return RAW; };
    const r = await study.analyzeWithChat(s, b.id,
      { engine: 'llm', selectedIds: [s.getBook(b.id).materials[0].id], useVision: true, cfg: { baseURL: 'http://x', apiKey: 'k', model: 'm' } }, chat);
    const hasImage = !!(sent && JSON.stringify(sent).includes('image_url'));
    ok('D2b 真实 ext 下 M3 确实把图发给视觉模型', r.ok === true && hasImage, 'ok=' + (r && r.ok) + ' hasImage=' + hasImage);
    cleanup(d);
  }

  // ── 3) 视觉降级：必须披露、不能留读图指令、不能回传伪造图引用 ──
  {
    const A = 'AIMG001';
    const asset = { id: A, name: 'slide1.png', ext: 'png', kind: 'media', slide: 1, page: 1, caption: '' };
    const st = {
      getBook: () => ({ materials: [{ id: 'm1', name: 'x.pptx', layer: 1, ext: 'pptx', size: 10, source: 'user', prompt: '', assets: [asset] }] }),
      readMaterial: () => ({ data: 'AAAA', extractedText: '立方最密堆积配位数12', assets: [asset] }),
      readAsset: () => ({ data: 'iVBORw0KGgo=', mime: 'image/png' }),
      setAssetCaption: () => true
    };
    const RAW = JSON.stringify({
      points: [{ title: '致密度', summary: '原文', origin: 'source', sourceFile: 'x.pptx', sourceLoc: 'L1', usage: '摘录', assetRefs: [A] }],
      questions: [{ type: 'calc', stem: '求致密度', options: [], answer: '0.74', explanation: '材料未直接覆盖', commonMistake: '', method: '公式 致密度=π/(3√2)≈0.74 代入数值 运算得 0.74 验算 回代', pointTitles: ['致密度'], origin: 'ai', source: null }],
      imageCaptions: { [A]: '该图展示最密堆积配位关系（模型凭空编造）' }
    });
    const calls = [];
    const chat = async (c, m) => { calls.push(m); if (calls.length === 1) throw new Error('400 Bad Request: model does not support image input'); return RAW; };
    const r = await study.analyzeWithChat(st, 'b',
      { engine: 'llm', selectedIds: ['m1'], useVision: true, cfg: { baseURL: 'http://x', apiKey: 'k', model: 'm' } }, chat);
    const second = JSON.stringify(calls[1] || '');
    ok('D3 降级结果带用户可见披露标志', r.ok === true && r.visionDegraded === true && /未读图|不支持视觉|降级为纯文本/.test(r.note || ''),
      'flag=' + r.visionDegraded + ' note=' + String(r.note || '').slice(0, 80));
    ok('D3b 降级后不再命令模型读图', !!second && !/请读懂每张图|imageCaptions|assetRefs/.test(second), second.slice(0, 100));
    ok('D3c 降级后不回传伪造图引用/图索引',
      !(r.assetIndex && r.assetIndex[A]) && !(r.points[0].assetRefs || []).length && !(r.imageCaptions && r.imageCaptions[A]),
      'assetIndex=' + !!(r.assetIndex && r.assetIndex[A]) + ' refs=' + JSON.stringify(r.points[0].assetRefs));
    ok('D3d 前端可判定的披露字段存在（不是只写 console）', r.ok === true && typeof r.visionDegraded === 'boolean');
  }

  // ── 4) setAssetCaption 必须真的可用 ──
  {
    const d = tmp(); const s = new Store(d);
    ok('D4 Store 导出 setAssetCaption', typeof s.setAssetCaption === 'function', 'typeof=' + typeof s.setAssetCaption);
    if (typeof s.setAssetCaption === 'function') {
      const b = s.createBook({ title: 'C' });
      const png = Buffer.from('iVBORw0KGgo=', 'base64');
      s.addMaterials(b.id, 1, [{ name: 'x.pptx', data: 'AAAA', assets: [{ name: 'a.png', data: png.toString('base64'), kind: 'media' }] }], {});
      const m = s.getBook(b.id).materials[0];
      s.setAssetCaption(b.id, m.id, m.assets[0].id, '这张图讲了相图');
      const cap = s.getBook(b.id).materials[0].assets[0].caption;
      ok('D4b caption 写回并可读回', cap === '这张图讲了相图', 'caption=' + JSON.stringify(cap));
    } else { ok('D4b caption 写回并可读回', false, '方法不存在，跳过'); }
    cleanup(d);
  }

  // ── 5) 畸形百分号编码不能打死 HTTP 服务 ──
  {
    const d = tmp(); const PORT = 5299;
    const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
      { env: Object.assign({}, process.env, { PORT: String(PORT), LIBRARY_ROOT: d }), stdio: 'ignore' });
    let ready = false;
    for (let i = 0; i < 40; i++) { try { await get('http://127.0.0.1:' + PORT + '/api/books'); ready = true; break; } catch (e) { await new Promise(r => setTimeout(r, 150)); } }
    if (!ready) { ok('D5 服务可启动', false, '未就绪'); }
    else {
      let bad = null;
      try { bad = await get('http://127.0.0.1:' + PORT + '/%ZZ'); } catch (e) { /* 连接被掐断也算失败 */ }
      await new Promise(r => setTimeout(r, 300));
      let after = null;
      try { after = await get('http://127.0.0.1:' + PORT + '/api/books'); } catch (e) { after = null; }
      ok('D5 畸形 % 编码后服务仍活着（后续请求成功）', !!after && after.code === 200,
        'badReq=' + (bad && bad.code) + ' after=' + (after && after.code));
    }
    try { srv.kill('SIGKILL'); } catch (e) {}
    cleanup(d);
  }

  console.log('\nmaxloop 判别测试： ' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { console.log('失败项：' + fails.join('; ')); process.exit(1); }
})().catch(e => { console.error('ERR', e && e.stack); process.exit(1); });
