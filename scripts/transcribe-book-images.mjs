// 整本书的原图批量视觉转录（页级，产 transcript 语料）。
//
// 用法：
//   node scripts/transcribe-book-images.mjs --book <id> [--model Qwen/Qwen3-VL-8B-Instruct]
//        [--concurrency 6] [--limit N] [--force] [--tag 进度标记]
//
// 行为：
//   - cfg 从 core/settings.js 解析（密钥：请求显式 > library/settings.json > 环境变量），key 只在内存；
//   - 断点续跑：已有 ok transcript 的图自动跳过（--force 重跑）；
//   - 每张完成即落盘 images.json，中途失败不丢已完成；
//   - 进度按 --tag 输出到 stdout，方便后台盯日志。
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // scripts/ 的上一级 = 项目根

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const BOOK = arg('book');
const MODEL = arg('model') || '';
const CONC = Number(arg('concurrency') || 6);
const LIMIT = Number(arg('limit') || 0);
const FORCE = process.argv.includes('--force');
const TAG = arg('tag') || 'tr';

if (!BOOK) { console.error('缺少 --book <id>'); process.exit(1); }

const { mergeCfg } = require(path.join(ROOT, 'core/settings.js'));
const llm = require(path.join(ROOT, 'lib/llm.js'));
const vision = require(path.join(ROOT, 'core/image-vision.js'));
const IMG = require(path.join(ROOT, 'core/images.js'));

const root = path.join(ROOT, 'library');
const cfg = mergeCfg(root, MODEL ? { model: MODEL, visionModel: MODEL } : {});
if (!cfg.apiKey) { console.error('没有可用密钥（keySource=none）'); process.exit(1); }
const bookDir = path.join(root, 'books', BOOK);
const idx = IMG.loadIndex(bookDir);
const total = idx.images.length;
const need = idx.images.filter(x => FORCE || !(x.transcript && x.transcript.ok && x.transcript.status === 'ok')).length;
console.log('[' + TAG + '] book=' + BOOK + ' model=' + cfg.model + ' keySource=' + cfg.keySource +
  ' 总图=' + total + ' 待转录=' + need + ' concurrency=' + CONC + (FORCE ? ' force' : ''));

const t0 = Date.now();
let lastLogged = 0;
const timer = setInterval(() => {
  const cur = IMG.loadIndex(bookDir).images.filter(x => x.transcript && x.transcript.ok && x.transcript.status === 'ok').length;
  if (cur > lastLogged) {
    lastLogged = cur;
    console.log('[' + TAG + '] progress ' + cur + '/' + total + '  ' + Math.round((Date.now() - t0) / 1000) + 's');
  }
}, 15000);

try {
  const stat = await vision.transcribeBook(bookDir, cfg, {
    concurrency: CONC, limit: LIMIT || undefined, force: FORCE,
    timeoutMs: 120000,
  });
  clearInterval(timer);
  const final = IMG.loadIndex(bookDir);
  const okCount = final.images.filter(x => x.transcript && x.transcript.ok && x.transcript.status === 'ok').length;
  const chars = final.images.reduce((s, x) => s + ((x.transcript && x.transcript.transcript) || '').length, 0);
  const bad = final.images.filter(x => x.transcript && !x.transcript.ok).map(x => x.id + ':' + x.transcript.status);
  console.log('[' + TAG + '] DONE ' + JSON.stringify(stat) + '  累计ok=' + okCount + '/' + total +
    '  转录总字符=' + chars + '  用时=' + Math.round((Date.now() - t0) / 1000) + 's' +
    (bad.length ? '  失败清单=' + bad.slice(0, 20).join(',') : ''));
} catch (e) {
  clearInterval(timer);
  console.error('[' + TAG + '] FATAL ' + (e && e.message));
  process.exitCode = 1;
}
