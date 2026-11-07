'use strict';
// 用「打包产物 app.asar 里解出的 lib」跑关键行为验证。
// 为什么需要：单测跑源码、打包版验证跑 UI 桥接，都不等于「用户拿到的 exe 里的代码是对的」。
// 这是 maxloop v2.2 最贵教训（单测全绿 ≠ 用户实际路径可达）的针对性防线。
// 用法：先 node scripts/build-win.js，再 node scripts/verify-asar-behavior.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
const ASAR = path.join(SRC, 'dist', 'win-unpacked', 'resources', 'app.asar');
const OUT = path.join(os.tmpdir(), 'rl-asar-verify');
const LIB = path.join(OUT, 'lib');

if (!fs.existsSync(ASAR)) { console.error('找不到 ' + ASAR + '\n请先跑：node scripts/build-win.js'); process.exit(1); }
fs.rmSync(OUT, { recursive: true, force: true });
// 直接调本地 asar CLI（数组参数，不拼字符串）：项目路径含空格，走 shell 字符串会被拆断。
const asarCli = path.join(SRC, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
const r = spawnSync(process.execPath, [asarCli, 'extract', ASAR, OUT], { stdio: 'pipe', encoding: 'utf8' });
if (r.status !== 0) { console.error('asar 解包失败：' + String(r.stderr || '').slice(0, 300)); process.exit(1); }

const { Store } = require(path.join(LIB, 'store'));
const study = require(path.join(LIB, 'study'));
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rlav-'));

(async () => {
  // 1) 打包版 Store 的图说明写回（历史缺陷：方法未导出 + 内部调用不存在的 writeBookMeta）
  const d = tmp(); const s = new Store(d);
  const b = s.createBook({ title: 'A' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  s.addMaterials(b.id, 1, [{ name: 'x.pptx', data: 'AAAA', assets: [{ name: 'slide1.png', data: png.toString('base64'), kind: 'media', slide: 1 }] }], {});
  const m = s.getBook(b.id).materials[0];
  ok('打包版 Store 导出 setAssetCaption', typeof s.setAssetCaption === 'function');
  s.setAssetCaption(b.id, m.id, m.assets[0].id, '打包版图说明');
  ok('打包版 caption 写回并读回', s.getBook(b.id).materials[0].assets[0].caption === '打包版图说明');

  // 2) 纯图资料（无 extractedText）在打包版里也能进视觉模型（历史缺陷：被「无可抽取文本」硬拦）
  const RAW = JSON.stringify({
    points: [{ title: '致密度', summary: '原文', origin: 'source', sourceFile: 'x.pptx', sourceLoc: 'L1', usage: '摘录' }],
    questions: [{ type: 'calc', stem: '求致密度', options: [], answer: '0.74', explanation: '材料未直接覆盖', commonMistake: '', method: '公式 致密度=π/(3√2)≈0.74 代入数值 运算得 0.74 验算 回代', pointTitles: ['致密度'], origin: 'ai', source: null }]
  });
  let sent = null;
  const res = await study.analyzeWithChat(s, b.id,
    { engine: 'llm', selectedIds: [m.id], useVision: true, cfg: { baseURL: 'http://x', apiKey: 'k', model: 'm' } },
    async (c, msgs) => { sent = msgs; return RAW; });
  ok('打包版 纯图资料不被无文本检查拦下', res.ok === true, 'reason=' + (res && res.reason));
  ok('打包版 真实 ext 下图真发出 image_url', !!(sent && JSON.stringify(sent).includes('image_url')));

  // 3) 幽灵书（历史缺陷：不可逆数据丢失）
  const s2 = new Store(tmp()); const b2 = s2.createBook({ title: 'B' });
  s2.addMaterials(b2.id, 1, [{ name: '资料.txt', data: Buffer.from('hi').toString('base64') }], {});
  s2.deleteMaterial(b2.id, s2.getBook(b2.id).materials[0].id);
  s2.deleteBook(b2.id);
  const it = s2.listTrash().find(x => x.type === 'material');
  s2.restoreMaterial(it.key);
  ok('打包版 恢复资料不造幽灵书', s2.listBooks().length === 1 && s2.listTrash().length === 0);

  fs.rmSync(d, { recursive: true, force: true });
  console.log('\n打包产物行为验证： ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e && e.stack); process.exit(1); });
