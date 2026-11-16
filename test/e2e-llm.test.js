/**
 * e2e-llm.test.js —— 增量分析端到端测试（本地 mock LLM，零外网）
 *
 * 走真实 HTTP：起 mock OpenAI-compatible 服务 → 起天道书院服务 → 上传新文档 →
 * POST /analyze → 校验合并结果落盘、旧题不丢、key 不落盘不回显。
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
const baseAnalysis = JSON.parse(fs.readFileSync(REAL, 'utf8'));
const BOOK_ID = 'e2e_' + Date.now().toString(36);

let pass = 0, fail = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(() => { pass++; console.log('  ✓ ' + name); })
    .catch(e => { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); });
}
function req(port, method, pathname, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.isBuffer(body) ? body : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = Object.assign({}, headers || {});
    if (data && !Buffer.isBuffer(body) && typeof body !== 'string') { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: h }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks); let parsed = buf.toString();
        try { parsed = JSON.parse(buf.toString()); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
// 构造 mock LLM 返回的分析 JSON（严格单行，符合官方契约）
function mockAnalysis() {
  return {
    outline: { title: '测试书', children: [{
      title: '第三章 树与二叉树', children: [{
        title: '3.1 二叉树遍历', children: [{
          title: '中序遍历', desc: '左根右顺序访问', questionTypes: ['简答题'], children: []
        }]
      }]
    }] },
    questionIndex: [{ type: '简答题', items: [{
      title: '概念辨析', path: ['第三章 树与二叉树', '3.1 二叉树遍历', '中序遍历'],
      questions: [{
        stem: '简述二叉树中序遍历的访问顺序。',
        options: [],
        answer: '先左子树，再根结点，最后右子树 —— 即左根右。',
        solution: ['第1步：理解中序的定义', '第2步：按左根右递归访问。'],
        rationale: '中序遍历的"中"指根结点在中间访问，因此顺序为左子树、根、右子树。',
        pitfalls: '把中序与先序（根左右）记混。',
        difficulty: '基础',
        pointPath: ['第三章 树与二叉树', '3.1 二叉树遍历', '中序遍历'],
        source: { file: '新讲义.txt', page: 1, anchor: '【块1】', quote: '中序遍历按左、根、右的顺序访问结点' }
      }]
    }] }],
    summary: '新增树与二叉树章节'
  };
}
function makeMultipart(field, filename, content, extraFields) {
  const boundary = '----tdtest' + Date.now();
  const parts = [];
  Object.keys(extraFields || {}).forEach(k => {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + extraFields[k] + '\r\n'));
  });
  parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + field + '"; filename="' + filename + '"\r\nContent-Type: text/plain\r\n\r\n'));
  parts.push(Buffer.from(content, 'utf8'));
  parts.push(Buffer.from('\r\n--' + boundary + '--\r\n'));
  return { buffer: Buffer.concat(parts), type: 'multipart/form-data; boundary=' + boundary };
}

(async () => {
  // 准备一本"现有书"（真实样本第一轮）
  const Adapter = require('../assets/js/adapter');
  const first = Adapter.buildBookData({ analysis: baseAnalysis, meta: { id: BOOK_ID, title: '测试书' }, files: [{ name: '示例讲义.txt', focus: true }] });
  first._trace.questionIndex = baseAnalysis.questionIndex; // 确保旧题索引在（buildBookData 已存，这里保险）
  store.writeBook(BOOK_ID, first);
  // 真实场景：演示书已有内容都分析过了，台账标记示例讲义为已分析；只有新上传的才是"新增"
  store.setAnalyzed(BOOK_ID, ['示例讲义.txt']);
  const oldQIds = first.tiku.map(q => q.id);

  // mock LLM（全选会触发两次调用：analyze 出知识点、documents 出考纲；按 system 前缀分流）
  const capturedCalls = [];
  const mock = http.createServer((req, res) => {
    let data = ''; req.on('data', c => data += c);
    req.on('end', () => {
      if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] })); }
      const payload = JSON.parse(data || '{}');
      capturedCalls.push(payload.messages);
      const sys = String((payload.messages[0] || {}).content || '');
      const reply = sys.includes('命题与考前速通专家')
        ? { sections: [{ rank: 1, chapter: '第三章 树与二叉树', why: '遍历是树结构核心考点', points: [{ title: '中序遍历', must: '左根右，递归访问', formulas: [], importance: '高', question: { stem: '中序顺序？', answer: '左根右', steps: ['先左', '再根', '后右'] }, quote: '中序遍历按左、根、右的顺序访问结点', source: '新讲义.txt' }] }] }
        : mockAnalysis();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(reply) } }] }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const mockPort = mock.address().port;

  const app = createServer();
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const appPort = app.address().port;
  const cfg = { baseURL: 'http://127.0.0.1:' + mockPort + '/v1', apiKey: 'sk-test-secret-key-1234567890', model: 'mock-model' };

  console.log('\n=== A. 上传 + 增量分析全链路 ===');
  await t('POST /upload 上传新文档成功落盘', async () => {
    // 书馆 analyze() 有 MIN_TEXT=80 硬门槛（防纯图片/空壳分析结果），测试语料必须够长
    const doc = '第三章 树与二叉树。中序遍历按左、根、右的顺序访问结点，即所谓左根右。'
      + '先序遍历按照根结点、左子树、右子树的顺序访问，后序遍历则是左子树、右子树、根结点。'
      + '二叉树每个结点最多有两个子结点，分别称为左孩子与右孩子，这是二叉树区别于一般树的核心结构约束，'
      + '也是插入删除与查找代价分析的出发点。';
    const mp = makeMultipart('files', '新讲义.txt', doc, { focus: '新讲义.txt' });
    const r = await req(appPort, 'POST', '/api/books/' + BOOK_ID + '/upload', mp.buffer, { 'Content-Type': mp.type });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.saved.length, 1);
    assert.strictEqual(r.body.saved[0].focus, true);
    assert.ok(fs.existsSync(path.join(store.BOOKS, BOOK_ID, 'refs', '新讲义.txt')));
  });
  await t('POST /analyze 触发增量分析并合并', async () => {
    const r = await req(appPort, 'POST', '/api/books/' + BOOK_ID + '/analyze', { llm: cfg });
    if (r.status !== 200) console.log('      analyze error:', JSON.stringify(r.body).slice(0, 500));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert.ok(r.body.stats.newPoints >= 1, '应有新知识点');
    assert.ok(r.body.stats.newQuestions >= 1, '应有新题');
  });
  await t('合并后旧题 id 全保留、新题追加', async () => {
    const book = store.readBook(BOOK_ID);
    const nowIds = book.tiku.map(q => q.id);
    oldQIds.forEach((id, i) => assert.strictEqual(nowIds[i], id));
    assert.ok(nowIds.length > oldQIds.length);
    assert.strictEqual(book._trace.incremental, true);
    assert.deepStrictEqual(book._trace.analyzedFiles, ['新讲义.txt']);
  });
  await t('新资料引用用本轮语料核验（quoteVerified 正确）', async () => {
    const book = store.readBook(BOOK_ID);
    const newQ = book.tiku.find(q => q.stem.includes('中序遍历'));
    assert.ok(newQ, '新题不存在');
    const trace = book._trace.byQuestion[newQ.id];
    assert.strictEqual(trace.quoteVerified, true, '引文应命中本轮语料');
    assert.strictEqual(trace.file, '新讲义.txt');
  });
  await t('再次 analyze 应跳过（无新增资料）', async () => {
    const r = await req(appPort, 'POST', '/api/books/' + BOOK_ID + '/analyze', { llm: cfg });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.skipped, true);
  });

  console.log('\n=== B. 提示词与密钥安全 ===');
  await t('送进 LLM 的 system = 书馆官方提示词正本（端到端复用）', async () => {
    const analyzeCall = capturedCalls.find(c => String((c[0] || {}).content || '').includes('学科分析与出题专家'));
    assert.ok(analyzeCall, '没捕获到 analyze 请求');
    const sys = analyzeCall[0].content;
    const official = require('../../复习资料图书馆/core/analyze.js').SYSTEM_PROMPT;
    const officialHead = official.split('{{FILE_LIST}}')[0];
    assert.ok(sys.startsWith(officialHead), 'system 应以书馆官方提示词开头');
    assert.ok(sys.includes('新讲义.txt'), '文件名清单应含新文档');
  });
  await t('全选时额外调用了书馆考纲提示词生成考纲考点', async () => {
    const sylCall = capturedCalls.find(c => String((c[0] || {}).content || '').includes('命题与考前速通专家'));
    assert.ok(sylCall, '全选应触发考纲生成调用');
  });
  await t('语料只含新文档（不含旧讲义全文）', async () => {
    const analyzeCall = capturedCalls.find(c => String((c[0] || {}).content || '').includes('学科分析与出题专家'));
    const userMsg = analyzeCall[1].content;
    assert.ok(userMsg.includes('中序遍历按左'));
    assert.ok(!userMsg.includes('顺序表采用连续内存'), '不该把旧资料塞进增量语料');
  });
  await t('key 不落盘：data.json / analyzed.json 无 key 痕迹', async () => {
    const data = fs.readFileSync(store.dataPath(BOOK_ID), 'utf8');
    const analyzed = fs.readFileSync(store.analyzedPath(BOOK_ID), 'utf8');
    assert.ok(!data.includes('sk-test-secret-key') && !data.includes('apiKey'));
    assert.ok(!analyzed.includes('sk-test-secret-key'));
  });
  await t('LLM 测试连接返回 ok 且不回显 key', async () => {
    const r = await req(appPort, 'POST', '/api/llm/test', { llm: cfg });
    assert.strictEqual(r.status, 200);
    assert.ok(!JSON.stringify(r.body).includes('sk-test-secret-key'));
  });

  // 清理：必须把整个书目录递归删干净。
  // 之前用 unlink+rmdir 逐个删，任一步失败就被 catch 静默吞掉，结果 tests 跑完书架上多一本"测试书"。
  try {
    const dir = path.join(store.BOOKS, BOOK_ID);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    if (fs.existsSync(dir)) throw new Error('临时书目录未删除：' + dir);
  } catch (e) {
    console.error('⚠ 清理临时书失败（会残留在书架）：' + e.message);
  }
  // 自检：跑完不该留任何 e2e_ 开头的书（否则书架上会多出"测试书"）
  const leftover = fs.readdirSync(store.BOOKS).filter(d => /^e2e_/.test(d));
  if (leftover.length) { fail++; console.error('  ✗ 临时书未清理：' + leftover.join(', ')); }
  await new Promise(r => app.close(r));
  await new Promise(r => mock.close(r));

  console.log('\n========================================');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('========================================\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
