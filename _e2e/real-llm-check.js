'use strict';
// 一次 API 完整版 · 真模型效果验证（2026-11-09 maxloop 需求 3）
//
// 用法：node _e2e/real-llm-check.js [--label v1] [--model <name>]
//   key 只从环境变量读（SILICONFLOW_API_KEY / DEEPSEEK_API_KEY），绝不打印、绝不落盘。
//   真调一次 /chat/completions，真解析 JSON，输出 measureQuality 的 9 项效果判据。
//   不达标时按 PROCESS/research-mindmap-v2/fusion-decisions.md D12 迭代提示词并带新 label 重跑。
//
// 输出：控制台指标 + PROCESS/research-mindmap-v2/real-llm-<label>.json（脱敏：只存指标与题目摘要，不存 key）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const A = require(path.join(ROOT, 'core', 'analyze'));

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; }
const LABEL = arg('--label', 'v1');

// 两个通道都探测过连通；默认用硅基流动的 flash 模型（快、便宜、支持 json_object）。
const PROVIDERS = [
  { name: 'siliconflow', baseURL: 'https://api.siliconflow.cn/v1', keyEnv: 'SILICONFLOW_API_KEY', model: 'deepseek-ai/DeepSeek-V4.1-Flash' },
  { name: 'deepseek', baseURL: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' }
];
const forcedModel = arg('--model', '');
const provider = PROVIDERS.find(p => process.env[p.keyEnv]);
if (!provider) { console.error('没有可用的模型 key（SILICONFLOW_API_KEY / DEEPSEEK_API_KEY 均未设置）'); process.exit(2); }
const cfg = { baseURL: provider.baseURL, apiKey: process.env[provider.keyEnv], model: forcedModel || provider.model };

// 真实导入文件名清单（提示词会把题目的 source.file 约束到这两个里）。
const FILES = [
  { name: '数据结构讲义.pdf', isImage: false },
  { name: '线性表示意图.png', isImage: true }
];

// 一篇结构完整、带可出题内容的复习资料（≥ MIN_TEXT；内容具体，方便判断模型有没有编造）。
const CORPUS = [
  '【文件：数据结构讲义.pdf】',
  '第一章 线性表',
  '线性表是由 n 个数据元素组成的有限序列，记作 L=(a1,a2,...,an)。当 n=0 时称为空表。',
  '线性表的两种基本存储结构是顺序存储与链式存储。顺序表用一段地址连续的存储单元依次存放元素，',
  '支持随机访问，按下标查找第 i 个元素的时间复杂度为 O(1)；链表用指针串联结点，插入和删除只需修改指针，',
  '但查找第 i 个元素需要从头遍历，时间复杂度为 O(n)。',
  '在长度为 n 的顺序表中，在第 i 个位置（1≤i≤n+1）插入一个元素，需要把第 i 个及其后的元素全部后移一位，',
  '共移动 n-i+1 个元素。若插入位置等概率，则平均移动次数为 n/2，因此插入运算的平均时间复杂度为 O(n)。',
  '删除第 i 个元素需要前移 n-i 个元素，平均移动次数为 (n-1)/2，同样是 O(n)。',
  '单链表的每个结点包含数据域与指针域。在已知指针 p 所指结点之后插入新结点只需 O(1)，',
  '但在单链表中删除结点 p 本身需要找到其前驱，时间复杂度为 O(n)。',
  '判断题常见误区：链表不支持随机访问，因此「链表查找第 i 个元素比顺序表更快」是错误的。',
  '',
  '第二章 栈与队列',
  '栈是只允许在表尾进行插入和删除的线性表，满足后进先出（LIFO）。栈顶是唯一可操作端。',
  '队列是只允许在表尾插入、表头删除的线性表，满足先进先出（FIFO）。',
  '循环队列用数组实现时，为避免「假溢出」，队空条件是 front == rear，',
  '队满条件是 (rear+1) % m == front，其中 m 为数组容量；这种约定会牺牲一个存储单元。',
  '若循环队列数组容量为 m，则最多可存放 m-1 个元素。',
  '栈的典型应用包括括号匹配、表达式求值、函数调用与递归；队列的典型应用包括层次遍历与缓冲区调度。',
  '例如括号匹配：读到左括号入栈，读到右括号时弹出栈顶并检查是否配对，扫描结束后栈空则匹配成功。',
  '',
  '第三章 树与二叉树',
  '二叉树第 i 层最多有 2^(i-1) 个结点，深度为 k 的二叉树最多有 2^k - 1 个结点。',
  '对任何一棵非空二叉树，若叶子结点数为 n0、度为 2 的结点数为 n2，则 n0 = n2 + 1。',
  '具有 n 个结点的完全二叉树，其深度为 floor(log2(n)) + 1。',
  '二叉树的遍历分为先序（根左右）、中序（左根右）、后序（左右根）与层次遍历。',
  '已知先序序列 ABDECFG 与中序序列 DBEAFCG，可唯一确定一棵二叉树：先序首字符 A 为根，',
  '在中序中找到 A，其左侧 DBE 为左子树、右侧 FCG 为右子树，递归即可还原。',
  '哈夫曼树是带权路径长度 WPL 最小的二叉树，构造时每次选取权值最小的两棵树合并。',
  '',
  '第四章 排序与查找',
  '顺序查找在等概率下的平均查找长度为 (n+1)/2，时间复杂度 O(n)。',
  '折半查找要求表有序且采用顺序存储，每次把区间缩小一半，时间复杂度 O(log2 n)，',
  '对长度为 11 的有序表，最多比较 4 次即可判定查找失败。',
  '快速排序采用分治思想，平均时间复杂度 O(n log n)，最坏情况（初始序列已有序）退化为 O(n^2)。',
  '直接插入排序在初始序列基本有序时效率最高，最好情况时间复杂度为 O(n)，是稳定排序。',
  '堆排序与快速排序都是不稳定排序；冒泡排序、直接插入排序、归并排序是稳定排序。',
  '',
  '第五章 典型例题',
  '例题 1：长为 10 的顺序表，在第 3 个位置插入元素，需要移动多少个元素？答案：10-3+1=8 个。',
  '例题 2：容量为 8 的循环队列，最多能存多少个元素？答案：7 个。',
  '例题 3：一棵二叉树有 5 个度为 2 的结点，叶子结点有多少个？答案：5+1=6 个。',
  '例题 4：对长度 11 的有序表折半查找，最多比较几次？答案：4 次。',
  '易错点：插入位置 i 的精确移动次数 n-i+1 与平均移动次数 n/2 常被混淆；',
  '循环队列队满条件容易被误写成 rear == front，那其实是队空条件。'
].join('\n');

function pct(x) { return (Number(x) * 100).toFixed(1) + '%'; }

(async () => {
  const t0 = Date.now();
  console.log('=== 一次 API 完整版 · 真模型效果验证 [' + LABEL + '] ===');
  console.log('  通道：' + provider.name + ' | 模型：' + cfg.model + ' | 语料：' + CORPUS.length + ' 字 | 文件：' + FILES.map(f => f.name).join(', '));
  console.log('  key：从环境变量读取（不打印）\n');

  // 捕获原始响应：一次 API 失败时不能只报「解析不了」，要能拿到长度/首尾定位是截断还是格式跑偏。
  const llm = require(path.join(ROOT, 'lib', 'llm'));
  let rawResponse = null;
  const captureChat = async (c, m, o) => {
    const r = await llm.chat(c, m, o);
    rawResponse = r;
    return r;
  };
  let result = null, err = null;
  try {
    result = await A.analyze('数据结构复习全书', CORPUS, {
      cfg, files: FILES,
      imageCount: 1, materialCount: 2,
      timeoutMs: 240000,
      chat: captureChat
    });
  } catch (e) { err = e; }

  if (err) {
    console.error('✗ 一次 API 调用失败：' + err.message.slice(0, 300));
    if (rawResponse != null) {
      const s = String(rawResponse);
      console.error('  原始响应长度：' + s.length);
      console.error('  首 260 字：' + JSON.stringify(s.slice(0, 260)));
      console.error('  末 260 字：' + JSON.stringify(s.slice(-260)));
      try { JSON.parse(s); console.error('  直接 JSON.parse：OK（说明是 extractJson/validate 层问题）'); }
      catch (e2) { console.error('  直接 JSON.parse 失败：' + e2.message.slice(0, 200)); }
    } else {
      console.error('  未拿到原始响应（网络/上游报错或 chat 未返回内容）');
    }
    const out = { label: LABEL, ok: false, error: err.message.slice(0, 300), rawLen: rawResponse ? String(rawResponse).length : 0, at: new Date().toISOString() };
    fs.writeFileSync(path.join(ROOT, 'PROCESS', 'research-mindmap-v2', 'real-llm-' + LABEL + '.json'), JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const q = A.measureQuality(result, FILES);
  const s = result.stats || {};
  console.log('  ✓ 一次调用返回合法 JSON（耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
  console.log('  导图：' + s.chapters + ' 章 / ' + s.sections + ' 节 / ' + s.points + ' 知识点 / ' + s.subtypes + ' 细分');
  console.log('  题目：' + q.questionCount + ' 道 / ' + q.typeCoverage + ' 类题型\n');
  console.log('  --- 九项效果判据（阈值来自 measureQuality 的 thresholds，不硬编码）---');
  console.log('  JSON 可解析：                                    ' + (q.checks.jsonParsed ? '✓' : '✗'));
  console.log('  必需字段完整率 (stem/answer/solution/rationale)： ' + pct(q.fieldCompleteRate) + '  ' + (q.checks.fieldCompleteRate ? '✓' : '✗'));
  const qr = q.thresholds || {};
  console.log('  题目总数 ' + qr.minQuestions + '-' + qr.maxQuestions + '：                                  ' + q.questionCount + '  ' + (q.checks.questionCount ? '✓' : '✗'));
  console.log('  题型覆盖 ≥3：                                    ' + q.typeCoverage + '  ' + (q.checks.typeCoverage ? '✓' : '✗'));
  console.log('  pointPath 反查导图命中率：                       ' + pct(q.pathHitRate) + '  ' + (q.checks.pathHitRate ? '✓' : '✗'));
  console.log('  占位符率（必须为 0）：                           ' + pct(q.placeholderRate) + '  ' + (q.checks.placeholderRate ? '✓' : '✗'));
  console.log('  source.file 可回溯到真实文件：                   ' + pct(q.sourceHitRate) + '  ' + (q.checks.sourceHitRate ? '✓' : '✗'));
  console.log('  答案含内容（非单字母）比例：                    ' + pct(q.answerRichRate) + '  ' + (q.checks.answerRichRate ? '✓' : '✗'));
  console.log('  解题思路平均字数（≥30）：                       ' + q.rationaleAvgLen + ' 字  ' + (q.checks.rationaleDepth ? '✓' : '✗'));
  console.log('\n  >>> 整体判定：' + (q.passed ? 'PASSED（一次 API 完整版效果达标）' : 'FAILED（需按 D12 迭代提示词）'));

  // v3：引用锚定效果 —— 模型是否真抄了语料锚点、引文能否被程序从原文校验命中。
  // 这是本轮「优化提示词语逻辑」是否真生效的外部判据，不是自评。
  const audit = result.quoteAudit || { checked: 0, hit: 0, rate: 0 };
  const qs = (result.questionIndex || []).reduce((arr, g) =>
    arr.concat((g.items || []).reduce((b, i) => b.concat(i.questions || []), [])), []);
  const anchorCount = qs.filter(qq => qq.source && qq.source.anchor).length;
  console.log('\n  --- v3 引用锚定（程序从送进模型的语料逐字校验）---');
  console.log('  source.anchor 填写率：                          ' + pct(qs.length ? anchorCount / qs.length : 0) + '  (' + anchorCount + '/' + qs.length + ')');
  console.log('  引文命中原文：                                  ' + audit.hit + '/' + audit.checked + '  ' + pct(audit.rate));

  // 抽 2 道题的真实内容做人工可核的样例（不写 key）。
  const samples = [];
  (result.questionIndex || []).forEach(g => (g.items || []).forEach(it => (it.questions || []).forEach(qq => {
    if (samples.length < 2) samples.push({
      type: g.type, sub: it.title, stem: qq.stem, answer: qq.answer,
      solution: qq.solution, rationale: qq.rationale,
      source: qq.source, pointId: qq.pointId
    });
  })));
  const out = {
    label: LABEL, ok: q.passed, at: new Date().toISOString(),
    provider: provider.name, model: cfg.model, corpusLen: CORPUS.length,
    elapsedMs: Date.now() - t0,
    stats: s, metrics: q, samples,
    quoteAudit: result.quoteAudit || null,
    anchorRate: qs.length ? anchorCount / qs.length : 0
  };
  fs.writeFileSync(path.join(ROOT, 'PROCESS', 'research-mindmap-v2', 'real-llm-' + LABEL + '.json'),
    JSON.stringify(out, null, 2), 'utf8');
  console.log('\n  已落盘：PROCESS/research-mindmap-v2/real-llm-' + LABEL + '.json');
  if (!q.passed) process.exit(1);
})().catch(e => { console.error('验证脚本异常：' + (e && e.message ? e.message.slice(0, 200) : e)); process.exit(1); });
