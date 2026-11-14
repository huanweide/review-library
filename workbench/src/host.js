// 宿主适配层（workbench，2026-11-14）。
//
// 这是「APP 能在 DSH 插件中 / 内置浏览器中 / Electron 里都能用」的关键：
// 应用不硬编码任何后端地址，所有请求都经本层。宿主按自己的传输方式实现
// manifest()/state()/action()，应用其余部分完全不关心自己跑在哪。
//
// 识别顺序（不猜，逐级探测）：
//   1) Electron：window.api.workbench（preload 已暴露）
//   2) 宿主注入：window.__WORKBENCH_BASE__（DSH 面板 / 任意嵌入方可设）
//   3) URL 参数：?base=/review-analysis/api/app
//   4) 同源默认：/api/app（server.js 的 HTTP 形态）
//
// 四种都返回同一个 core/app-host.js 协议，能力清单不复制第二份。

const Q = new URLSearchParams(location.search);

function normalize(base) {
  let b = String(base || '').trim();
  if (!b) return '/api/app';
  b = b.replace(/\/+$/, '');
  return b;
}

function detect() {
  // 1) Electron IPC
  if (window.api && window.api.workbench && typeof window.api.workbench.manifest === 'function') {
    return { kind: 'electron', base: null, label: '桌面端 Electron' };
  }
  // 2) 宿主显式注入（DSH 面板最常用）
  if (window.__WORKBENCH_BASE__) {
    return { kind: 'injected', base: normalize(window.__WORKBENCH_BASE__), label: '嵌入宿主' };
  }
  // 3) URL 参数（DSH 侧栏 iframe 可带 ?base=...）
  if (Q.get('base')) {
    return { kind: 'query', base: normalize(Q.get('base')), label: '嵌入宿主（URL 指定）' };
  }
  // 4) 同源 HTTP
  return { kind: 'http', base: '/api/app', label: '本地服务 / 内置浏览器' };
}

const info = detect();

async function getJson(url, opts) {
  const r = await fetch(url, Object.assign({ cache: 'no-store', headers: { Accept: 'application/json' } }, opts || {}));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export const host = {
  kind: info.kind,
  label: info.label,
  base: info.base,

  /** 应用清单：能力集合 + 视图元数据，来自 core/app-host.js */
  async manifest() {
    if (info.kind === 'electron') return window.api.workbench.manifest();
    return getJson(info.base + '/manifest');
  },

  /** 运行状态：真实书数、分析数、宿主、能力数（不造假数字） */
  async state() {
    if (info.kind === 'electron') return window.api.workbench.state();
    return getJson(info.base + '/state');
  },

  /** 调用一个 action：按能力清单分派到 Core 门面 */
  async action(action, payload) {
    if (info.kind === 'electron') return window.api.workbench.action(action, payload || {});
    return getJson(info.base + '/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action, payload: payload || {} }),
    });
  },
};

export default host;
