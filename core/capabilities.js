'use strict';
// 统一核心 · 能力清单（canonical 单一真源，2026-11-12「后端革命」）。
//
// 背景：`core/request.js` 早已把「网址 → 功能」的路由语义收成一份，但各入口仍各自
// 手写一张「我能用哪些动作」的清单（CLI 的 --action 分支、DSH 的 tool schema enum）。
// 核心 2026-11-11 新增学习闭环后，两张手写清单都没跟上 → 三种入口能做的事不一样。
// 这是设计层缺口，不是「少写几个 case」。
//
// 本文件收的是「一共有哪些能力」这一层契约，对齐 Anki `proto/anki` 的做法
// （后端方法定义只存在一份，GUI / CLI / Android 都从它派生），降级为纯 JS 表，
// 不引入 protobuf / 代码生成 / 新依赖。
//
// 新增能力的固定顺序（漏任一步，test/core-capability-sync.test.js 的 J1 立即红）：
//   1) 在 ACTIONS / CAPABILITIES 加一行；
//   2) 在 core/index.js 加对应门面方法；
//   3) 在 core/request.js 加对应路由（HTTP / Electron 两形态）；
//   4) 在 plugins/review-analysis/bin/driver.js 与 plugins/dsh-review-analysis/index.js
//      加对应分支（只做协议转换，不复制业务逻辑）；
//   5) 跑 node test/core-capability-sync.test.js，三入口集合必须一致。

// 动作名即对外契约，改名会同时影响 CLI --action 与 DSH tool action 参数。
const ACTIONS = [
  // 资料 → 分析（既有五动作）
  'list', 'create', 'add', 'analyze', 'get',
  // 学习闭环（2026-11-11 F1 落地，本轮同步到全部入口）
  'practice', 'quiz', 'due', 'attempt', 'rate',
];

const PRACTICE_ACTIONS = ['practice', 'quiz', 'due', 'attempt', 'rate'];

// 每个能力对应的 Core 门面方法。插件只做协议转换，方法名从这里取，
// 严禁在 wrapper 里 require core/practice.js 或自行读写 practice.json。
const CAPABILITIES = [
  { action: 'list',      method: 'listBooks',     needsBook: false, group: 'library' },
  { action: 'create',    method: 'createBook',    needsBook: false, group: 'library' },
  { action: 'add',       method: 'addFile',       needsBook: true,  group: 'library' },
  { action: 'analyze',   method: 'analyze',       needsBook: true,  group: 'library' },
  { action: 'get',       method: 'getAnalysis',   needsBook: true,  group: 'library' },
  { action: 'practice',  method: 'getPractice',   needsBook: true,  group: 'practice' },
  { action: 'quiz',      method: 'getQuiz',       needsBook: true,  group: 'practice' },
  { action: 'due',       method: 'getDue',        needsBook: true,  group: 'practice' },
  { action: 'attempt',   method: 'submitAttempt', needsBook: true,  group: 'practice' },
  { action: 'rate',      method: 'rateCard',      needsBook: true,  group: 'practice' },
];

const BY_ACTION = new Map(CAPABILITIES.map(c => [c.action, c]));
const ACTION_SET = new Set(ACTIONS);

function has(action) { return ACTION_SET.has(String(action || '')); }
function byAction(action) { return BY_ACTION.get(String(action || '')) || null; }
function isPractice(action) { return PRACTICE_ACTIONS.includes(String(action || '')); }

// 报错一律带完整可用列表 —— 既是给用户的提示，也是 J1d 行为级漂移守卫的取数处。
function unsupported(action) {
  return '不支持的 action：' + action + '（可用 ' + ACTIONS.join('/') + '）';
}

module.exports = {
  ACTIONS, PRACTICE_ACTIONS, CAPABILITIES,
  has, byAction, isPractice, unsupported,
};
