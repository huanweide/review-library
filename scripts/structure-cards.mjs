#!/usr/bin/env node
/**
 * 题卡结构化（2026-11-27）：把逐讲/作业题卡从「只能看」变成「能做、能进 SRS」。
 *
 * 诚实边界（先读数据再定规则，不闭门造车）：
 * - 146 张卡全部已有 answer + solution（4 步推导）+ quote + 原图，缺的是 options /
 *   rationale / pitfalls 与「进练习题库」这条接线。
 * - 只有 2 题 answer 明写「暂无定论/需复核」——这类不进练习，continue 标 needsReview。
 * - 52 道选择题里选项大多在图里，stem 文字不足以区分（例如四张受力图里三个 F1
 *   都写「右上方」）。因此**只有在 answer 以选项字母开头且 stem 里有可读 A/B/C/D
 *   列举时才补 options**，其余保持无选项 → 走 Anki 式自答+四档自评，绝不编选项。
 * - rationale 从 solution 的结论句派生；pitfalls 从 solution 的警示句派生；
 *   抽不到就留空，不生成「本题考查…」这类空话。
 *
 * 用法：
 *   node scripts/structure-cards.mjs --book <id> [--dry-run] [--write]
 * 默认 dry-run；--write 才落盘。幂等：已有 structuredAt 的卡跳过强行覆盖，
 * 只补缺失字段（用户/模型后续手改的 answer/solution 永不被改）。
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BookStore } = require('../core/bookStore');

const VAGUE = /暂无定论|尚无定论|需复核|待确认|请以教师批改|未能确定|无法.{0,6}确定/;
const CONCLUSION = /(?:故|所以|因此|由此|得|可知|综上|应为|应选|即)/;
const CAUTION = /(?:注意|不能|不应|错误|容易|误区|必须|否则|若|要避免|切忌|不可)/;
const LETTER = /^\s*([A-Ha-h])\s*(?:[.．、:：）)]|（|\()/;

function pickConclusions(solution) {
  const lines = (Array.isArray(solution) ? solution : []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!lines.length) return '';
  const hits = lines.filter((l) => CONCLUSION.test(l));
  const src = hits.length ? hits : [lines[lines.length - 1]];
  return src.slice(-2).join(' ').slice(0, 240);
}

function pickPitfalls(solution) {
  const lines = (Array.isArray(solution) ? solution : []).map((x) => String(x || '').trim()).filter(Boolean);
  const hits = lines.filter((l) => CAUTION.test(l) && l.length >= 8);
  return hits.slice(0, 3).map((l) => l.slice(0, 160)).join('；');
}

/**
 * 严格抽选项：只在 answer 明确是字母开头、且 stem 里能读出 >=2 个带字母的候选项时成立。
 * 读不出就返回 []（不猜、不按图编）。返回 {options, letter} 或 null。
 */
function extractOptions(stem, answer) {
  const a = String(answer || '').trim();
  const m = a.match(LETTER);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const text = String(stem || '');
  // 只认「选项：」之后的分号列举（如「选项：A 1,3,5；B 2,4,6；…」）。
  // 早期用全局字母切分，被题干里的「刚体 AB 绕…」骗到，把假 A 当选项——
  // 收紧到这里：宁可一道都抽不到，也不把题干里的字母当候选项。
  const marker = text.match(/选项\s*[:：]\s*(.+)$/);
  if (!marker) return null;
  const found = new Map();
  for (const part of marker[1].split(/[；;]/).map((x) => x.trim()).filter(Boolean)) {
    const pm = part.match(/^([A-H])\s*[.．、:：)）]?\s*(.+)$/);
    if (!pm) continue;
    const clean = pm[2].replace(/[。.]$/, '').trim();
    if (clean.length >= 2 && clean.length <= 120 && !found.has(pm[1])) found.set(pm[1], clean);
  }
  if (!found.has(letter) || found.size < 2 || found.size > 8) return null;
  const letters = [...found.keys()].sort();
  // 字母必须连续从 A 开始，否则是题干里的零散字母，不是选项枚举。
  if (letters[0] !== 'A' || letters.some((x, i) => x !== String.fromCharCode(65 + i))) return null;
  return { options: letters.map((k) => k + '. ' + found.get(k)), letter };
}

function main() {
  const args = process.argv.slice(2);
  const bookIdx = args.indexOf('--book');
  const bookId = bookIdx >= 0 ? args[bookIdx + 1] : null;
  const write = args.includes('--write');
  if (!bookId) { console.error('用法：node scripts/structure-cards.mjs --book <id> [--write]'); process.exit(2); }
  const store = new BookStore();
  const dir = path.join(store._bookDir(bookId), 'cards');
  if (!fs.existsSync(dir)) { console.error('没有题卡目录：' + dir); process.exit(2); }
  const stat = { files: 0, cards: 0, vague: 0, rationale: 0, pitfalls: 0, options: 0, already: 0 };
  const samples = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/^(lesson|assignment)-\d+\.json$/.test(name)) continue;
    const file = path.join(dir, name);
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.error('跳过坏文件 ' + name + ': ' + e.message); continue; }
    let dirty = false;
    stat.files++;
    for (const kp of (Array.isArray(data.knowledgePoints) ? data.knowledgePoints : [])) {
      for (const c of (Array.isArray(kp && kp.cards) ? kp.cards : [])) {
        if (!c || !c.stem) continue;
        stat.cards++;
        if (c.structuredAt) { stat.already++; continue; }
        const answer = String(c.answer || '');
        if (VAGUE.test(answer)) {
          // 没有定论的题不进练习。保留它原来的 needsReview，另外明确标 excludedFromQuiz。
          c.excludedFromQuiz = true;
          c.needsReview = true;
          stat.vague++;
          dirty = true;
          continue;
        }
        const rationale = pickConclusions(c.solution);
        if (rationale && !c.rationale) { c.rationale = rationale; stat.rationale++; dirty = true; }
        const pitfalls = pickPitfalls(c.solution);
        if (pitfalls && !c.pitfalls) { c.pitfalls = pitfalls; stat.pitfalls++; dirty = true; }
        const ex = extractOptions(c.stem, answer);
        if (ex && !Array.isArray(c.options)) {
          c.options = ex.options;
          c.answerKey = ex.letter;
          stat.options++;
          dirty = true;
          if (samples.length < 6) samples.push({ file: name, id: c.id, letter: ex.letter, options: ex.options });
        }
        c.structuredAt = new Date().toISOString();
        dirty = true;
      }
    }
    if (dirty && write) fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
  console.log(JSON.stringify({ mode: write ? 'WRITE' : 'DRY-RUN', ...stat }, null, 2));
  if (samples.length) console.log('严格抽到的选项样例：\n' + samples.map((s) => '  ' + s.file + ' ' + s.id + ' -> ' + s.letter + ' ' + JSON.stringify(s.options)).join('\n'));
  console.log('说明：抽不到选项的题保持无选项，练习页走「自答 → 对照答案 → 四档自评 → SRS」，不是降级。');
}
main();
