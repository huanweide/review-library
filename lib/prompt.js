/**
 * prompt.js —— 天道书院 · 分析提示词（只读引用书馆官方正本 + 增量指令）
 *
 * 铁律：提示词正本只有一个——复习资料图书馆/core/analyze.js 的 SYSTEM_PROMPT。
 *       本文件不复制其文本，运行时 require 只读导出，避免"两份提示词各自演化"。
 * 增量：在正本之前拼一段增量指令，告诉模型「本次只分析新增文档，输出仍是同一 schema」。
 */
'use strict';
const path = require('path');
const bookAnalyze = require(path.resolve(__dirname, '../../复习资料图书馆/core/analyze.js'));

// 官方正本（含 {{FILE_LIST}} 占位）。只读取，不复制、不改。
const OFFICIAL = bookAnalyze.SYSTEM_PROMPT;

const INCREMENTAL_PREFIX = `【本次为增量分析 · 最高优先级】
用户在此之前已经分析过一批资料，本轮【只给你新增的资料文件】。你必须：
1. 只基于本轮提供的资料内容组织 outline 与 questionIndex，不要把"书里应该还有别的内容"脑补进来；
2. 每道题的 source.file 只能填本轮资料清单里的文件名，source.quote 只能逐字出自本轮语料——程序会拿本轮语料逐字核验；
3. outline 用新增内容自身的知识结构即可（章/节/知识点标题），合并由程序按标题完成，你不需要知道旧结构；
4. 输出结构与字段约束完全遵守下方官方分析契约，不得删字段、不得改字段名、不得用占位内容。

—— 以下为官方分析契约（不可协商）——

`;

function buildSystemPrompt(files, isIncremental) {
  const sys = OFFICIAL.replace('{{FILE_LIST}}', fileList(files));
  return (isIncremental ? INCREMENTAL_PREFIX : '') + sys;
}
function fileList(files) {
  const arr = (Array.isArray(files) ? files : []).slice(0, 40);
  const lines = arr.map(f => {
    const n = String((f && f.name) || '').trim();
    if (!n) return null;
    let line = '- ' + n;
    if (f && f.isImage) line += '（图片资料，正文不含其内容）';
    if (f && f.focus) line += '【用户重点★】';
    if (f && f.note) line += '（用户说明：' + String(f.note).slice(0, 120) + '）';
    return line;
  }).filter(Boolean);
  return lines.length ? lines.join('\n') : '- （未登记文件名；source.file 请填「未知」，page 填 0）';
}

// 用书馆官方 buildMessages 组装语料（含锚点、文件名清单、覆盖统计），保证引文可回溯。
function buildMessages(bookTitle, corpus, files, isIncremental) {
  const msgs = bookAnalyze.buildMessages(bookTitle, corpus, files);
  // buildMessages 内部已用官方 SYSTEM_PROMPT 填了文件名清单；这里替换成带增量前缀的版本
  if (isIncremental && msgs[0]) msgs[0].content = buildSystemPrompt(files, true);
  return msgs;
}

module.exports = { buildSystemPrompt, buildMessages, fileList, OFFICIAL, INCREMENTAL_PREFIX };
