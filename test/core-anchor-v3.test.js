'use strict';
// v3 引用锚定 + 结构化语料 · 判别测试（baseline 必红 / candidate 必绿）
//
// 反假绿设计：全部断言真调函数、真起临时 Core 书库、真解析合法 PDF，
// 不查源码里有没有那几个字、不查按钮存不存在；旧版缺失的函数用 typeof 守卫，
// 保证 baseline 能跑完并贴出完整红项。
// DOM 层（题目详情显示锚点与校验徽章）由 _e2e/core-ui-verify.js 真浏览器覆盖。
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const A = require('../core/analyze');
const extract = require('../core/extract');
const { Core } = require('../core');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n--- ' + t + ' ---'); }
function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }

const CORPUS = '【文件：chap1.txt】\n' +
  '【块1】顺序表用一段地址连续的存储单元依次存放元素，支持随机访问，按下标查找 O(1)。\n' +
  '【块2】链表用指针串联结点，查找第 i 个元素需要从头遍历，时间复杂度 O(n)。';

const TREE = {
  title: '计算机基础', children: [
    { title: '第一章 数据结构', children: [
      { title: '1.1 线性表', children: [
        { title: '顺序表', desc: '连续存储', questionTypes: ['选择题'], children: [] }
      ] }
    ] }
  ]
};

function auditResult() {
  // 这是「模型返回的原始 JSON」，契约用 outline（validate 读 parsed.outline.children）；
  // 落盘后的结构才是 tree，别混。
  return {
    outline: TREE,
    summary: '测试',
    questionIndex: [{ type: '选择题', items: [{ title: '存储结构辨析', path: ['第一章 数据结构'], questions: [
      {
        stem: '顺序表按下标查找的复杂度是？', options: ['A. O(1)', 'B. O(n)'],
        answer: 'A. O(1) —— 地址连续可直接算偏移。', solution: ['第 1 步：地址连续。'],
        rationale: '抓住地址是否连续这个本质去判断随机访问能力，不要凭印象选。',
        pitfalls: '与链表遍历混淆', difficulty: '基础', pointPath: ['第一章 数据结构', '1.1 线性表', '顺序表'],
        source: { file: 'chap1.txt', anchor: '【块1】', quote: '顺序表用一段地址连续的存储单元依次存放元素' }
      },
      {
        stem: '链表查找第 i 个元素的复杂度是？', options: ['A. O(1)', 'B. O(n)'],
        answer: 'B. O(n) —— 必须从头遍历。', solution: ['第 1 步：只能顺序访问。'],
        rationale: '链表没有下标，找第 i 个必须逐个走指针，这里要区分随机访问与顺序访问。',
        pitfalls: '与数组混淆', difficulty: '基础', pointPath: ['第一章 数据结构', '1.1 线性表', '顺序表'],
        source: { file: 'chap1.txt', anchor: '【块1】', quote: '这句话书里根本没有是模型编造出来的' }
      }
    ] }] }]
  };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-anchor-'));
  try {
    // ---------- A 组：解析层产出可回溯锚点 ----------
    section('A 组：解析层产出可回溯锚点');
    const hasSegment = typeof extract.segmentText === 'function';
    ok(hasSegment, 'A1 extract.segmentText 存在（v1.4.0 无 → baseline 红）');
    if (hasSegment) {
      const pdfish = '[[PAGE:1]]\n第一章 线性表\n顺序表连续存储' +
        '\n[[PAGE:2]]\n链表用指针串联';
      const segs = extract.segmentText(pdfish, { name: '数据结构讲义.pdf', ext: '.pdf' });
      ok(Array.isArray(segs) && segs.length === 2, 'A2 PDF 按页切成 2 块（实为 ' + ((segs || []).length) + '）');
      ok(!!(segs && segs[0] && /P\.1|第\s*1\s*页|页\s*1/.test(segs[0].anchor)), 'A3 首块锚点标真实页码');
      ok(!!(segs && segs[1] && segs[1].text.includes('链表用指针串联')), 'A4 块内保留原文，可用于引文校验');
      const plain = '第一段讲顺序表。\n\n第二段讲链表。\n\n第三段讲栈。';
      const segs2 = extract.segmentText(plain, { name: 'notes.txt', ext: '.txt' });
      ok(Array.isArray(segs2) && segs2.length >= 2, 'A5 纯文本按段切块（实为 ' + ((segs2 || []).length) + '）');
      ok(!!(Array.isArray(segs2) && segs2.every(s => s && s.anchor && s.text)), 'A6 每块都有 anchor + text');
    } else {
      ok(false, 'A2 PDF 按页切成 2 块（函数缺失，无法执行）');
      ok(false, 'A5 纯文本按段切块（函数缺失，无法执行）');
    }

    // ---------- B 组：Core 拼出的整本书语料带锚点 ----------
    section('B 组：Core 拼出的整本书语料带锚点');
    const core = new Core(tmp);
    const book = core.createBook('锚点测试书');
    await core.addFile(book.id,
      Buffer.from('顺序表连续存储，按下标查找 O(1)。\n\n链表用指针串联，查找 O(n)。'),
      { name: 'chap1.txt' });
    const bookText = String(core.getBookText(book.id) || '');
    ok(/【文件：chap1\.txt】/.test(bookText), 'B1 仍保留文件名分隔（旧契约不破）');
    ok(/【P\.|【块|【页|\|\s*P\./.test(bookText), 'B2 语料含可回溯锚点（v1.4.0 无 → baseline 红）');

    // ---------- C 组：长书不再从头静默砍掉后半本 ----------
    section('C 组：长书不再从头静默砍掉后半本');
    function fileBlock(name, ch) {
      return '【文件：' + name + '】\n【块1】' + ('【' + ch + '】' + ch.repeat(197)).repeat(200);
    }
    const long = ['A.txt', 'B.txt', 'C.txt'].map((n, i) => fileBlock(n, 'ABC'[i])).join('\n\n');
    ok(long.length > A.MAX_CORPUS, 'C0 构造语料确实超上限（' + long.length + ' > ' + A.MAX_CORPUS + '）');
    const hasCompose = typeof A.composeCorpus === 'function';
    ok(hasCompose, 'C1 analyze.composeCorpus 存在（v1.4.0 无 → baseline 红）');
    if (hasCompose) {
      const r = A.composeCorpus(long, A.MAX_CORPUS);
      ok(r.corpus.length <= A.MAX_CORPUS + 4000, 'C2 输出仍在预算内（' + r.corpus.length + '）');
      ok(['【A】', '【B】', '【C】'].every(m => r.corpus.includes(m)), 'C3 三个文件的正文都进了语料（均衡覆盖）');
      ok(Array.isArray(r.coverage) && r.coverage.length === 3, 'C4 覆盖统计列出 3 个文件');
      ok(r.truncated === true, 'C5 显式标记发生了截断');
    } else {
      const m = A.buildMessages('长书', long, []);
      ok(m[1].content.includes('【C】'), 'C3(旧路径) 第三个文件内容应出现（v1.4.0 从头砍 → baseline 红）');
      ok(false, 'C4 覆盖统计列出 3 个文件（函数缺失）');
    }

    // ---------- D 组：引文由程序从原文校验 ----------
    section('D 组：引文由程序从原文校验，不再信模型自报');
    const hasVerify = typeof A.verifyQuotes === 'function';
    ok(hasVerify, 'D1 analyze.verifyQuotes 存在（v1.4.0 无 → baseline 红）');
    if (hasVerify) {
      const q = A.verifyQuotes(auditResult(), CORPUS);
      ok(q.checked === 2, 'D2 校验覆盖全部 2 道题（实为 ' + q.checked + '）');
      ok(q.hit === 1 && q.rate === 0.5, 'D3 真引文命中、编造引文被识破（实为 ' + q.hit + '/' + q.checked + '）');
      ok(!!(q.details && q.details[1] && q.details[1].found === false), 'D4 未命中项带可解释细节');
      ok(A.verifyQuotes({ questionIndex: [] }, CORPUS).checked === 0, 'D5 老数据无题目时返回 0 不崩');
    } else {
      ok(false, 'D2 校验覆盖全部 2 道题（函数缺失）');
      ok(false, 'D3 真引文命中、编造引文被识破（函数缺失）');
    }

    // ---------- E 组：生产链路挂上审计，且严格一次 API ----------
    section('E 组：analyze() 生产链路挂上引文审计，且严格一次 API');
    let calls = 0;
    const chat = async () => { calls++; return JSON.stringify(auditResult()); };
    const res = await A.analyze('测试书', CORPUS, { chat, files: [{ name: 'chap1.txt' }] });
    ok(calls === 1, 'E1 仍然只调用一次 chat（一次 API 硬需求不破）');
    ok(!!(res && res.quoteAudit), 'E2 返回结果带引文审计（v1.4.0 无 → baseline 红）');
    if (res && res.quoteAudit) {
      ok(res.quoteAudit.checked >= 1, 'E3 审计真跑了，不是空壳对象');
    }

    // ---------- F 组：提示词把 source 钉在锚点上 ----------
    section('F 组：提示词把 source 钉在锚点上');
    const p = String(A.SYSTEM_PROMPT || '');
    ok(/锚点|anchor|【块|【P\./.test(p), 'F1 提示词说明锚点格式（v1.4.0 无 → baseline 红）');
    ok(/source\.anchor|"anchor"/.test(p), 'F2 契约里增加 anchor 字段（旧版无 → baseline 红）');

    // ---------- G 组：老数据零迁移（防回归，非 baseline 红项） ----------
    section('G 组：老数据零迁移不崩（防回归）');
    const old = { tree: TREE, summary: '老数据', questionIndex: [{ type: '选择题', items: [{ title: 'x', questions: [] }] }] };
    let oldOk = true;
    try { A.measureQuality(old, []); } catch (e) { oldOk = false; }
    ok(oldOk, 'G1 无 anchor/quote 的老分析结果仍能过质量函数');
    // v1.4.0 及更早落盘的题目没有 anchor / quoteVerified；程序校验必须如实报「未命中」，
    // 不能因字段缺失抛异常，更不能假装已核对。
    if (typeof A.verifyQuotes === 'function') {
      const oldWithQ = {
        tree: TREE, summary: '老数据',
        questionIndex: [{ type: '选择题', items: [{ title: 'x', questions: [
          { stem: '老题', answer: 'A', solution: ['s'], rationale: 'r', source: { file: 'chap1.txt', page: 0, quote: '' } }
        ] }] }]
      };
      const oldAudit = A.verifyQuotes(oldWithQ, CORPUS);
      ok(oldAudit.checked === 1 && oldAudit.hit === 0 && oldAudit.details[0].reason === 'no-quote',
        'G2 老题目无 quote 时如实报未命中（不谎称已核对、不崩）');
    }

    // ---------- H 组：真 PDF 逐页锚点（A 级证据，不 mock、不推断） ----------
    section('H 组：真 PDF 逐页注入页码锚点');
    // 夹具来源：pdf-parse@1.1.1 自带的合法 5 页 PDF
    // （node_modules/pdf-parse/test/data/04-valid.pdf），复制到 test/fixtures 使测试自包含。
    // 不用手搓 PDF：实测手写 xref 会触发 pdfjs「bad XRef entry」，默认解析也失败，
    // 只会走 nativePdfText 兜底，验证结果不可信。
    const fixture = path.join(ROOT, 'test', 'fixtures', 'anchor-5page.pdf');
    ok(fs.existsSync(fixture), 'H0 真 PDF 夹具存在');
    const pdfText = String(await extract.extractText('.pdf', fs.readFileSync(fixture)) || '');
    ok((pdfText.match(/\[\[PAGE:\d+\]\]/g) || []).length === 5, 'H1 真 PDF 5 页全注入真实页码标记');
    ok(/\[\[PAGE:1\]\]/.test(pdfText) && /\[\[PAGE:5\]\]/.test(pdfText), 'H2 首末页标记都在');
    const pdfSegs = extract.segmentText(pdfText, { name: 'five.pdf', ext: '.pdf' });
    ok(pdfSegs.length >= 5, 'H3 至少切出 5 个页锚点块（实为 ' + pdfSegs.length + '）');
    const pages = Array.from(new Set(pdfSegs.map(s => s.page)));
    ok(pages.length === 5 && pages[0] === 1 && pages[4] === 5, 'H4 页序 1→5 完整且递增');
    ok(pdfSegs.some(s => s.text.trim().length > 20), 'H5 页块里有真实正文（不是空壳标记）');

    // ---------- I 组：发布前独立复核发现的两处缺陷（防回归） ----------
    section('I 组：引文判据收紧 + 无文件名语料一致性');
    const norm = s => String(s || '').replace(/\s+/g, '')
      .replace(/[，。、；：“”‘’（）()【】\[\],.;:!?\-—_]/g, '');
    const rich = A.composeCorpus(
      CORPUS + '\n【块3】栈是后进先出，队列是先进先出，树是层次结构，图由顶点与边构成。', 50000
    ).corpus;
    const mkQ = quote => ({ questionIndex: [{ type: '选择题', items: [{ title: 't', questions: [
      { id: 'q', stem: 's', source: { file: 'chap1.txt', quote } }
    ] }] }] });
    // 旧实现取前 40 字判命中，实测会把「开头抄原文、后面自由发挥」判为 exact-span。
    const forged = norm(rich).slice(20, 60) + '并且本章还证明了PNP与黎曼猜想成立';
    const attack = A.verifyQuotes(mkQ(forged), rich);
    ok(attack.details[0].found === false, 'I1 前 40 字真 + 后段编造的引文不得判命中');
    const realQuote = '顺序表用一段地址连续的存储单元依次存放元素，支持随机访问，按下标查找 O(1)。';
    const exact = A.verifyQuotes(mkQ(realQuote), rich);
    ok(exact.details[0].found === true && exact.details[0].fullHit === true &&
      exact.details[0].reason === 'exact-span', 'I2 真·逐字引文判为 exact-span（不是前缀冒充）');
    ok(A.verifyQuotes(mkQ(realQuote.slice(0, -3)), rich).details[0].found === true,
      'I3 模型省末尾几字仍容忍命中（不误伤合法引文）');
    const noName = '【块1】没有文件名标注的正文内容。'.repeat(60);
    const cNoName = A.composeCorpus(noName, 300);
    ok(cNoName.truncated === true && !cNoName.corpus.includes('【文件：（未标注文件）】'),
      'I4 无文件名语料被截断时不凭空造文件名头');
  } catch (e) {
    failed++;
    console.error('  ✗ 测试执行异常：' + (e && e.stack || e));
  } finally {
    cleanup(tmp);
  }
  console.log('\n通过 ' + passed + ' / 失败 ' + failed);
  process.exit(failed ? 1 : 0);
})();
