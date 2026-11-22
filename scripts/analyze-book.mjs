// 整本书 LLM 分析（读取已转录语料 → 一次 API 产出知识导图 + 题型题库）。
//
// 用法：
//   node scripts/analyze-book.mjs --book <id> [--model <对话模型>] [--timeoutMs 600000] [--refresh]
//
// 前置：该书图片已用 transcribe-book-images.mjs 转录（否则语料只剩文本型文件）。
// 输出：分析统计（章/节/点/题数）+ 引文审计 + 语料覆盖 + measureQuality 指标。
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const BOOK = arg('book');
const MODEL = arg('model') || '';
const TIMEOUT = Number(arg('timeoutMs') || 600000);
if (!BOOK) { console.error('缺少 --book <id>'); process.exit(1); }

const { Core } = require(path.join(ROOT, 'core/index.js'));
const { mergeCfg } = require(path.join(ROOT, 'core/settings.js'));
const analyzeLib = require(path.join(ROOT, 'core/analyze.js'));

const root = path.join(ROOT, 'library');
const core = new Core(root);
const book = core.getBook(BOOK);
if (!book) { console.error('书不存在：' + BOOK); process.exit(1); }

const cfg = mergeCfg(root, MODEL ? { model: MODEL } : {});
if (!cfg.apiKey) { console.error('没有可用密钥（keySource=none）'); process.exit(1); }
const text = core.getBookText(BOOK);
console.log('[analyze] book=' + BOOK + ' title=' + book.title + ' model=' + cfg.model +
  ' 语料字符=' + (text || '').length + ' 转录段=' + ((text || '').match(/【文件：视觉转录·/g) || []).length);

(async () => {
  const t0 = Date.now();
  try {
    const result = await core.analyze(BOOK, { cfg, timeoutMs: TIMEOUT });
    const m = analyzeLib.measureQuality(result, book.files, {});
    console.log('[analyze] DONE 用时=' + Math.round((Date.now() - t0) / 1000) + 's');
    console.log('[analyze] stats=' + JSON.stringify(result.stats));
    console.log('[analyze] quality=' + JSON.stringify({
      jsonParsed: m.jsonParsed, questionCount: m.questionCount, typeCoverage: m.typeCoverage,
      fieldCompleteRate: m.fieldCompleteRate.toFixed(2), pathHitRate: m.pathHitRate.toFixed(2),
      sourceHitRate: m.sourceHitRate.toFixed(2), placeholderRate: m.placeholderRate,
      answerRichRate: m.answerRichRate.toFixed(2), rationaleAvgLen: m.rationaleAvgLen, passed: m.passed,
    }));
    console.log('[analyze] quoteAudit=' + JSON.stringify({ checked: result.quoteAudit.checked, hit: result.quoteAudit.hit, fullHit: result.quoteAudit.fullHit, rate: result.quoteAudit.rate.toFixed(2) }));
    console.log('[analyze] corpus=' + JSON.stringify({ truncated: result.truncated, totalChars: result.corpusLen, sourceLen: result.sourceLen, files: result.corpusCoverage && result.corpusCoverage.files }));
    // corpusCoverage 是对象 {truncated,totalChars,keptChars,files,coverage:[]}，
    // 逐文件明细在 .coverage 里。旧代码把对象当数组调 .filter，导致分析已成功落盘、
    // 脚本末尾却抛 `cov.filter is not a function` 假失败（exit 1 会误伤自动化门禁）。
    const cov = (result.corpusCoverage && Array.isArray(result.corpusCoverage.coverage))
      ? result.corpusCoverage.coverage : [];
    if (cut.length) console.log('[analyze] 被截断文件=' + cut.length + '（前 5：' + cut.slice(0, 5).map(c => c.file + ':' + c.keptChars + '/' + c.totalChars).join(' | ') + '）');
  } catch (e) {
    console.error('[analyze] FATAL 用时=' + Math.round((Date.now() - t0) / 1000) + 's  ' + (e && e.message));
    process.exitCode = 1;
  }
})();
