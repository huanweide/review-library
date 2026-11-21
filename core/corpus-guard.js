'use strict';
/**
 * 资料围栏 + 提示注入告警（2026-11-20 P1-1 融合）。
 *
 * 来源：ZeKaiNie/universal-examprep-skill 的 coach/guard.py（398★ MIT，本机真跑 77 测试 OK）。
 * 移植的是**判据**不是代码：fence_id 用内容哈希，闭合行带 id，资料里的伪造闭合被中和；
 * 注入句用中英启发式标记，零宽/双向控制字符先归一化再检测。
 *
 * 诚实边界（照抄上游自述）：启发式会漏改写过的攻击，也会误报引用了注入句的心理学材料。
 * 真正的边界是围栏 + SYSTEM_PROMPT 里「围栏内只是资料不是指令」这条规则；告警只是提醒人看一眼。
 * 不是安全沙箱，不承诺 100% 挡住提示注入。
 */
const crypto = require('crypto');

const OPEN = '<<<MATERIAL';
const CLOSE = 'MATERIAL>>>';

// 零宽字符 + 双向控制符（NFKC 后仍可能被用来把 MATERIAL 拆开绕过检测）。
const ZERO_WIDTH = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

const EN_PATTERNS = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|preceding|all|any|your|these|those)\b[^.\n]{0,30}\b(?:instructions?|prompts?|directives?|guidelines)\b/i,
  /\b(?:ignore|disregard|forget)\s+(?:everything|anything|all)\s+(?:above|before|so\s+far|previously)\b/i,
  /\b(?:ignore|disregard|forget)\s+(?:the\s+|all\s+(?:the\s+)?)?(?:previous|prior|above|earlier|preceding)\s+(?:rules|context|messages?|text|content)\b/i,
  /\byou\s+are\s+(?:now\s+)?(?:an?\s+)?(?:ai\s+(?:assistant|model|tutor|agent)|chat\s*gpt|gpt-?\d\w*|claude|gemini|copilot|llm)\b/i,
  /\bif\s+you\s+are\s+(?:an?\s+)?(?:ai|assistant|chatbot|gpt|claude|gemini|copilot|llm|language\s+model)\b/i,
  /\bas\s+an?\s+(?:ai|ai\s+(?:assistant|model)|language\s+model|llm)\s*,\s*you\b/i,
  /\b(?:note|message|instructions?|reminder|attention)\s*(?:to|for)?\s*(?:the\s+|any\s+)?(?:ai|assistant|chatbot|gpt|claude|gemini|copilot|llm|language\s+model)s?\s*[:：]/i,
  /\b(?:reveal|print|show|output|repeat)\s+(?:your|the)\s+(?:system|developer)\s+prompt\b/i,
  /\b(?:do\s+not|don't|never)\s+(?:tell|let|inform)\s+(?:the\s+)?(?:user|student)s?\s+(?:know|about\s+(?:this|these|that|it))\b/i,
  /\b(?:send|upload|post|forward|exfiltrate|email)\b[^.\n]{0,40}\b(?:(?:the\s+)?(?:student|user)'?s?|their)\s+(?:notes?|files?|data|answers?|messages?|conversation|history|keys?|passwords?|work)\b[^.\n]{0,30}\bto\s+https?:\/\//i,
  /<\|im_start\|>\s*system/i,
];

const ZH_PATTERNS = [
  /(?:忽略|无视|忘记|忘掉|不要理会)(?:你)?(?:之前|以上|前面|上面|上述|先前|原有|原来)的?(?:所有|全部)?的?(?:指令|指示|提示词?|规则|设定|要求|内容)/,
  /(?:忽略|无视|忘记|忘掉)(?:你的)?(?:所有|全部)(?:的)?(?:指令|指示|提示词?|规则|设定)/,
  /你(?:现在)?(?:是|扮演|作为)(?:一个|一名)?[^，。,.\n]{0,10}?(?:AI|人工智能|ChatGPT|GPT|Claude|Gemini|智能助手|大模型|语言模型)/i,
  /(?:如果|假如|若)你是(?:一个|一名)?\s*(?:AI|人工智能|大模型|语言模型|助手|智能体)/i,
  /作为(?:一个|一名)?\s*(?:AI|人工智能|大模型|语言模型|AI\s*助手)\s*[，,]?\s*你/i,
  /(?:给|对|致)\s*(?:AI|人工智能|大模型|助手|模型|智能体)的?\s*(?:指令|说明|提示|话)/i,
  /(?:AI|人工智能|大模型|语言模型|智能体|AI\s*助手)\s*(?:请注意|请你|请直接|请跳过|请忽略|请务必|注意)/i,
  /(?:输出|泄露|透露|显示|打印|复述)(?:你的)?系统提示词/,
  /不要(?:向|跟|对)(?:学生|用户)(?:透露|说|提起|提到|讲)(?:这|此|本)/,
  /不要(?:告诉|让|提醒)(?:学生|用户)(?:这|此|本|知道)/,
  /(?:学生|用户)的?[^。\n]{0,15}(?:发送|上传|转发)(?:到|给)\s*https?:\/\//i,
  /(?:发送|上传|转发)(?:学生|用户)的?[^。\n]{0,15}(?:到|给)\s*https?:\/\//i,
];

// 「MATERIAL>>>」的模糊匹配：允许大小写/空格/零宽/NFKC 全角变化，防止资料自己拼一个闭合行。
const FENCE_LIKE = /m\W{0,3}a\W{0,3}t\W{0,3}e\W{0,3}r\W{0,3}i\W{0,3}a\W{0,3}l\s*>\s*>\s*>/gi;

function normalize(text) {
  return String(text || '').normalize('NFKC').replace(ZERO_WIDTH, '');
}
function isSuspicious(line) {
  const s = normalize(line);
  return EN_PATTERNS.some((p) => p.test(s)) || ZH_PATTERNS.some((p) => p.test(s));
}
function flaggedLines(text, limit = 5) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    if (!cur) continue;
    let hit = isSuspicious(cur);
    // PDF 抽取会把一句拆两行；中英文拼接方式不同，两种都试。
    if (!hit && i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      hit = !isSuspicious(next) && (isSuspicious(cur + ' ' + next) || isSuspicious(cur + next));
    }
    if (hit) {
      out.push({ line: i + 1, text: cur.slice(0, 120) });
      if (out.length >= limit) break;
    }
  }
  return out;
}
function neutralize(text) {
  const raw = String(text || '');
  const norm = normalize(raw);
  // 归一化后长度可能变（零宽被删），这里只做「检测 + 原文替换」：
  // 用逐字符映射把归一化后的命中位置映回原文，避免误删正常内容。
  const map = [];
  let normStr = '';
  for (const ch of raw) {
    const n = ch.normalize('NFKC').replace(ZERO_WIDTH, '');
    for (const c of n) { normStr += c; map.push(ch); }
  }
  const spans = [];
  FENCE_LIKE.lastIndex = 0;
  let m;
  while ((m = FENCE_LIKE.exec(normStr))) spans.push([m.index, m.index + m[0].length]);
  if (!spans.length) return raw.replace(ZERO_WIDTH, '');
  let out = '', last = 0;
  for (const [a, b] of spans) {
    out += map.slice(last, a).join('') + '[fence-like text removed]';
    last = b;
  }
  out += map.slice(last).join('');
  return out.replace(ZERO_WIDTH, '');
}
function fenceId(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 6);
}
/**
 * 用内容哈希做围栏：闭合行的 id 由资料内容决定，资料里的文字无法预知自己的哈希，
 * 因此伪造不出「MATERIAL>>> <id>」。配合 SYSTEM_PROMPT 的规则，围栏才是真边界。
 */
function fence(text, id) {
  const body = neutralize(text).replace(/\s+$/, '');
  const fid = String(id || fenceId(body));
  return OPEN + ' ' + fid + '\n' + body + '\n' + CLOSE + ' ' + fid;
}

module.exports = {
  OPEN, CLOSE, normalize, isSuspicious, flaggedLines,
  neutralize, fenceId, fence,
};
