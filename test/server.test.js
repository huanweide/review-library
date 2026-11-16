/**
 * server.test.js —— 天道书院服务端判别测试（Node 原生，零依赖）
 *
 * 锁住 app 级端口的三条硬指标：真服务进程 / API 数据读写 / 路径穿越拦截。
 * 用真实 analysis.json 走 POST /api/books/import → 落盘 → GET 回读，不留假数据。
 */
'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createServer } = require('../server');
const store = require('../lib/store');

const ROOT = path.resolve(__dirname, '..');
const REAL = path.join(ROOT, '../复习资料图书馆/library/books/320521f8dbafa962/analysis.json');
const analysis = JSON.parse(fs.readFileSync(REAL, 'utf8'));
const TEST_ID = 't_server_' + Date.now().toString(36);

let pass = 0, fail = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(() => { pass++; console.log('  ✓ ' + name); })
    .catch(e => { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); });
}

function req(server, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port: addr.port, path: pathname, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = text; try { parsed = JSON.parse(text); } catch (e) {}
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  console.log('\n=== A. 服务进程与健康检查 ===');
  await t('GET /api/health 返回 ok/app/version/port', async () => {
    const r = await req(server, 'GET', '/api/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.app, '天道书院');
    assert.ok(r.body.port > 0);
  });
  await t('GET / 返回 HTML（静态托管）', async () => {
    const r = await req(server, 'GET', '/');
    assert.strictEqual(r.status, 200);
    assert.ok(String(r.body).includes('天道书院'));
  });

  console.log('\n=== B. 书目与数据 API ===');
  await t('GET /api/books 从真源扫描书单', async () => {
    const r = await req(server, 'GET', '/api/books');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.some(b => b.id === 'ds-demo'));
  });
  await t('GET /api/books/ds-demo 返回完整统一格式', async () => {
    const r = await req(server, 'GET', '/api/books/ds-demo');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.kaogang.length > 0, '应有知识点');
    // 不写死题数：演示书会被增量分析改变（本轮实测 3→4），只锁结构不变量
    assert.ok(r.body.tiku.length > 0, '应有题目');
    assert.strictEqual(Object.keys(r.body.tikuAns).length, r.body.tiku.length);
    r.body.tiku.forEach(q => assert.ok(!('answer' in q), '零反馈：题面不得含答案'));
    assert.ok(r.body._trace.quoteAudit);
  });
  await t('GET 不存在的书返回 404', async () => {
    const r = await req(server, 'GET', '/api/books/not-exist-xyz');
    assert.strictEqual(r.status, 404);
  });

  console.log('\n=== C. import 转换并落盘（真链路）===');
  await t('POST /api/books/import 转换真实 analysis 并落盘', async () => {
    const r = await req(server, 'POST', '/api/books/import', {
      analysis,
      meta: { id: TEST_ID, title: '服务端导入测试书', subject: '期末考试' },
      files: []
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.stats.tiku, 3);
    assert.ok(fs.existsSync(store.dataPath(TEST_ID)));
    assert.ok(fs.existsSync(store.fallbackPath(TEST_ID)));
  });
  await t('落盘后立即可 GET 回读（服务端真源生效）', async () => {
    const r = await req(server, 'GET', '/api/books/' + TEST_ID);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.meta.title, '服务端导入测试书');
    assert.strictEqual(r.body.tiku.length, 3);
    // 零反馈不变量：题面无答案
    assert.ok(!('answer' in r.body.tiku[0]));
  });
  await t('import 缺 analysis.tree 返回 400', async () => {
    const r = await req(server, 'POST', '/api/books/import', { meta: { id: 'x', title: 'x' } });
    assert.strictEqual(r.status, 400);
  });
  await t('import 非法 id（路径穿越）返回 400', async () => {
    const r = await req(server, 'POST', '/api/books/import', {
      analysis, meta: { id: '../evil', title: 'x' }
    });
    assert.strictEqual(r.status, 400);
  });

  console.log('\n=== D. 安全边界 ===');
  await t('静态路径穿越 /../../ 被拦截（403）', async () => {
    const r = await req(server, 'GET', '/api/../../package.json');
    assert.ok(r.status === 403 || r.status === 404);
    assert.ok(String(r.body).indexOf('tiandao-academy') < 0, 'package.json 内容泄漏');
  });
  await t('GET /../server.js 源码读取被拦截', async () => {
    const r = await req(server, 'GET', '/../server.js');
    assert.ok(r.status === 403 || r.status === 404);
    assert.ok(String(r.body).indexOf('createServer') < 0, '服务端源码泄漏');
  });
  await t('静态白名单：直接读 lib/store.js 与 data.json 均 404', async () => {
    const a = await req(server, 'GET', '/lib/store.js');
    const b = await req(server, 'GET', '/books/ds-demo/data.json');
    assert.strictEqual(a.status, 404);
    assert.strictEqual(b.status, 404);
  });
  await t('白名单内资源仍可正常访问（assets / 讲义原文）', async () => {
    const a = await req(server, 'GET', '/assets/js/core.js');
    const b = await req(server, 'GET', '/books/ds-demo/refs/' + encodeURIComponent('示例讲义.txt'));
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 200);
    assert.ok(String(b.body).includes('顺序表采用连续内存'));
  });
  await t('POST 静态资源返回 405', async () => {
    const r = await req(server, 'POST', '/index.html', '{}');
    assert.strictEqual(r.status, 405);
  });

  // 清理测试书（只删本测试新建的，不碰用户资产）
  // 用递归删除而不是 unlink+rmdir：后者任一步失败就被 catch 吞掉，测试书会残留在书架。
  try {
    const dir = path.join(store.BOOKS, TEST_ID);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    if (fs.existsSync(dir)) throw new Error('目录未删除：' + dir);
  } catch (e) {
    console.error('⚠ 清理测试书失败（会残留在书架）：' + e.message);
  }
  // 自检：不该留任何 t_server_ 开头的书
  const leftover = fs.readdirSync(store.BOOKS).filter(d => /^t_server_/.test(d));
  if (leftover.length) { fail++; console.error('  ✗ 测试书未清理：' + leftover.join(', ')); }

  await new Promise(r => server.close(r));
  console.log('\n========================================');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('========================================\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
