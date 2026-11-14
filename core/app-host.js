'use strict';
// 统一应用协议（canonical，2026-11-14）。
//
// 定位：这是「APP / DSH 面板 / Skills·CLI / Electron / HTTP」五种形态共用的
// 同一层协议。它不实现任何业务逻辑，只做两件事：
//   1) manifest() —— 把 core/capabilities.js 的能力清单 + 视图元数据吐给宿主；
//   2) invoke()   —— 按清单把 action 映射到 Core 门面方法（协议转换，不复制业务）。
//
// 为什么需要它：此前 core/capabilities.js 只在「服务端/CLI/DSH」三入口同步，
// 网页形态若自己写一份 action 列表，就会变成第四份清单、必然漂移。
// 现在网页 APP 启动时 GET manifest 动态生成界面，新增能力只改 capabilities.js
// 一处，五种形态同时生效，由 test/app-unified.test.js 锁死。
//
// 宿主无关：本文件不 require http / electron / cordis，任何宿主拿到 Core 实例
// 就能调用。DSH 的 webServer、Electron 的 ipcMain、server.js 的 /api 各写各的
// 传输适配，但都调这两个函数。
//
// 安全：action 白名单来自 CAPS.has()；bookId 等参数交给 Core 门面与 bookStore
// 的 assertSafeId 校验；cfg.apiKey 只存在于本次调用内存，不写日志、不回显。

const CAPS = require('./capabilities');

const APP_ID = 'tiandao-workbench';
const APP_NAME = '天道书阁';
const PROTOCOL_VERSION = 1;

// 视图元数据：只描述「界面怎么摆」，不定义能力。
// action 字段必须出现在 CAPS.ACTIONS 里，由 validateManifest() 守卫。
const VIEWS = [
  { id: 'home',      label: '启动台',   icon: '◎', group: '总览',   kind: 'home',   desc: '项目全貌、宿主信息与运行状态' },
  { id: 'library',   label: '书架',     icon: '▤', group: '资料',   kind: 'list',   action: 'list',    desc: '全部书与资料，建书 / 导入 / 分析' },
  { id: 'book',      label: '书详情',   icon: '▣', group: '资料',   kind: 'book',   action: 'get',     desc: '单本书的思维导图、题型索引与概览' },
  { id: 'analyze',   label: '整体分析', icon: '✧', group: '资料',   kind: 'action', action: 'analyze', desc: '大模型把整本书当作一个整体分析' },
  { id: 'practice',  label: '练习',     icon: '✎', group: '学习',   kind: 'practice', action: 'practice', desc: '练习过程与题目列表' },
  { id: 'quiz',      label: '题目',     icon: '▦', group: '学习',   kind: 'quiz',   action: 'quiz',    desc: '先答后揭的题目列表（不含答案）' },
  { id: 'due',       label: '今日到期', icon: '◷', group: '学习',   kind: 'due',    action: 'due',     desc: '今天该复习的卡' },
  { id: 'attempt',   label: '提交作答', icon: '✓', group: '学习',   kind: 'form',   action: 'attempt', desc: '提交一次作答并判分' },
  { id: 'rate',      label: '四档自评', icon: '★', group: '学习',   kind: 'form',   action: 'rate',    desc: '重来 / 吃力 / 会了 / 太简单' },
  { id: 'create',    label: '新建书',   icon: '＋', group: '资料',   kind: 'form',   action: 'create',  desc: '建一本新书' },
  { id: 'add',       label: '导入资料', icon: '↥', group: '资料',   kind: 'form',   action: 'add',     desc: '向书里加 PDF / Word / 图片' },
  { id: 'settings',  label: '设置',     icon: '⚙', group: '系统',   kind: 'settings', desc: '主题、宿主信息与连接状态' },
  { id: 'about',     label: '关于',     icon: 'ⓘ', group: '系统',   kind: 'about',  desc: '版本、形态地图与一体架构说明' },
];

// 每个 action 的界面文案（能力语义仍以 capabilities.js 为准，这里只补 UI）。
const ACTION_UI = {
  list:     { label: '列出书',     hint: '读取全部书',                 needsBook: false },
  create:   { label: '新建书',     hint: '建一本新书',                 needsBook: false },
  add:      { label: '导入资料',   hint: '向书里加资料',               needsBook: true  },
  analyze:  { label: '整体分析',   hint: '大模型整本整体分析',         needsBook: true  },
  get:      { label: '书详情',     hint: '读取分析结果',               needsBook: true  },
  practice: { label: '练习过程',   hint: '读回练习状态',               needsBook: true  },
  quiz:     { label: '题目列表',   hint: '不含答案，先答后揭',         needsBook: true  },
  due:      { label: '今日到期',   hint: '今天该复习的卡',             needsBook: true  },
  attempt:  { label: '提交作答',   hint: '提交并判分',                 needsBook: true  },
  rate:     { label: '四档自评',   hint: '重排下次复习时间',           needsBook: true  },
};

let warned = false;
function validateManifest() {
  // 任何视图引用了清单里不存在的 action，都是漂移，必须大声失败而不是静默少一项。
  const bad = VIEWS.filter(v => v.action && !CAPS.has(v.action)).map(v => v.id + '→' + v.action);
  const missingUi = CAPS.ACTIONS.filter(a => !ACTION_UI[a]);
  if ((bad.length || missingUi.length) && !warned) {
    warned = true;
    console.error('[app-host] 清单漂移：未知 action=' + bad.join(',') + ' 缺 UI 元数据=' + missingUi.join(','));
  }
  return { ok: bad.length === 0 && missingUi.length === 0, bad, missingUi };
}

/**
 * 生成应用清单。host 由各形态传入（'http' / 'electron' / 'dsh' / 'cli'），
 * 只用于界面显示「我现在跑在哪个宿主里」，不改变任何能力。
 */
function manifest(host, extra) {
  const check = validateManifest();
  return {
    ok: check.ok,
    protocol: PROTOCOL_VERSION,
    app: {
      id: APP_ID,
      name: APP_NAME,
      version: (extra && extra.version) || '',
    },
    host: host || 'unknown',
    // 能力清单唯一真源：前端必须用这个数组生成界面，禁止自己写 action 列表。
    actions: CAPS.ACTIONS.slice(),
    capabilities: CAPS.CAPABILITIES.map(c => Object.assign({}, c, ACTION_UI[c.action] || {})),
    groups: ['总览', '资料', '学习', '系统'],
    views: VIEWS.map(v => Object.assign({}, v)),
    drift: check.ok ? null : { unknown: check.bad, missingUi: check.missingUi },
  };
}

/**
 * 按能力清单执行一个 action。只做协议转换：
 *   action -> CAPS.byAction(action).method -> core[method](...)
 * 不复制任何业务逻辑；新增能力时只要 capabilities.js + Core 门面同步，
 * 这里自动可用（无需改本文件）。
 */
async function invoke(core, action, payload, ctx) {
  const a = String(action || '').trim();
  if (!CAPS.has(a)) return { ok: false, action: a, error: CAPS.unsupported(a) };
  const cap = CAPS.byAction(a);
  if (!cap || typeof core[cap.method] !== 'function') {
    return { ok: false, action: a, error: '统一核心缺少门面方法：' + (cap && cap.method) };
  }
  const p = payload && typeof payload === 'object' ? payload : {};
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  try {
    let data;
    switch (a) {
      case 'list': {
        // 每本附带资料清单（文件名/大小）：书内左栏要画「存放结构」，
        // 未分析的书没有 get 结果可用，只能从这里拿。只加字段，不改 list 的既有语义。
        const books = core.listBooks() || [];
        data = { books: books.map((b) => {
          try {
            const full = core.getBook(b.id);
            return full ? Object.assign({}, b, { files: full.files || [] }) : b;
          } catch (e) { return b; }
        }) };
        break;
      }
      case 'create':
        data = core.createBook(String(p.title || '未命名书'), { description: String(p.description || '') });
        break;
      case 'add': {
        const id = String(p.bookId || '');
        if (!id) throw new Error('add 需要 bookId');
        const files = Array.isArray(p.files) ? p.files : [];
        if (!files.length) throw new Error('add 需要 files：每项 {name, data(base64)}');
        let n = 0;
        for (const f of files) {
          const name = String((f && f.name) || '').trim();
          const b64 = String((f && f.data) || '');
          if (!name) throw new Error('资料缺少 name');
          if (!b64) throw new Error('资料 ' + name + ' 缺少 data(base64)');
          await core.addFile(id, Buffer.from(b64, 'base64'), { name, note: String((f && f.note) || '') });
          n++;
        }
        data = { materialCount: n };
        break;
      }
      case 'analyze': {
        const id = String(p.bookId || '');
        if (!id) throw new Error('analyze 需要 bookId');
        data = await core.analyze(id, {
          cfg: p.cfg || c.cfg || {},
          maxTokens: p.maxTokens,
          timeoutMs: p.timeoutMs,
        });
        break;
      }
      case 'get': {
        const id = String(p.bookId || '');
        if (!id) throw new Error('get 需要 bookId');
        const a2 = core.getAnalysis(id);
        if (!a2 || !a2.tree) return { ok: false, action: a, bookId: id, error: '该书尚无分析结果，请先整体分析' };
        // 附带书元数据（标题/资料清单）：书内工作区要画「存放结构」与资料树，
        // 又不能为此新增一个 action（能力清单必须与 DSH/CLI 保持一致）。
        // 只加字段、不改判据，旧调用方读 a.tree / a.questionIndex 不受影响。
        let book = null;
        try { book = core.getBook(id); } catch (e) { book = null; }
        data = book ? Object.assign({}, a2, { book }) : a2;
        break;
      }
      case 'practice':
        data = core.getPractice(String(p.bookId || ''));
        break;
      case 'quiz':
        data = core.getQuiz(String(p.bookId || ''));
        break;
      case 'due':
        data = core.getDue(String(p.bookId || ''));
        break;
      case 'attempt': {
        const id = String(p.bookId || '');
        const key = String(p.key || '');
        if (!key) throw new Error('attempt 需要 key（取自 quiz 返回）');
        data = core.submitAttempt(id, { key, given: String(p.given || '') });
        break;
      }
      case 'rate': {
        const id = String(p.bookId || '');
        const key = String(p.key || '');
        const rating = Number(p.rating || 3);
        if (!key) throw new Error('rate 需要 key');
        if (!Number.isInteger(rating) || rating < 1 || rating > 4) throw new Error('rate 需要 rating 1-4');
        data = core.rateCard(id, { key, rating });
        break;
      }
      default:
        // 理论上到不了：CAPS.has 已守过。留这条是防止将来加 action 忘了接门面。
        return { ok: false, action: a, error: '应用协议未适配该 action：' + a };
    }
    return { ok: true, action: a, bookId: p.bookId || (data && data.id) || '', data };
  } catch (e) {
    // 不回显 payload（可能含 apiKey），只回业务错误文案。
    const msg = String((e && e.message) || e);
    return { ok: false, action: a, error: msg };
  }
}

/**
 * 只读状态聚合：给启动台 / DSH 面板显示真实统计，不造假数字。
 */
function state(core, host, extra) {
  let books = [];
  try { books = core.listBooks() || []; } catch (e) { /* 保持空 */ }
  const analyzed = books.filter(b => {
    try { const a = core.getAnalysis(b.id); return !!(a && a.tree); } catch (e) { return false; }
  }).length;
  return {
    ok: true,
    host: host || 'unknown',
    app: { id: APP_ID, name: APP_NAME, version: (extra && extra.version) || '' },
    protocol: PROTOCOL_VERSION,
    coreVersion: (extra && extra.coreVersion) || '',
    bookCount: books.length,
    analyzedCount: analyzed,
    actionCount: CAPS.ACTIONS.length,
    actions: CAPS.ACTIONS.slice(),
    books: books.map(b => ({ id: b.id, title: b.title || b.id })),
    drift: manifest(host, extra).drift,
  };
}

module.exports = { manifest, invoke, state, validateManifest, VIEWS, ACTION_UI, APP_ID, APP_NAME, PROTOCOL_VERSION };
