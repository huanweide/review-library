// 第二遍修复：① 删死代码 data-theme 手动暗色；② 白字落在会翻转的 token 背景
// （accent/danger/--warn/--core）上时，深色模式对比度塌陷 → 改用 var(--bg)；
// ③ 浅底高亮块/状态块在深色不翻转 → 改 token。两份样式表都修。
import { readFileSync, writeFileSync } from 'node:fs';

function fix(f, whiteOnToken, hexMap, removeDataTheme) {
  let s = readFileSync(f, 'utf8');
  if (removeDataTheme) s = s.replace(/\[data-theme="dark"\][^\n]*\n/g, '');
  for (const sel of whiteOnToken) {
    if (s.includes(sel)) s = s.replace(sel, sel.replace('color: #fff;', 'color: var(--bg);'));
    else console.log(`WARN 未命中 ${f}:`, sel.slice(0, 46));
  }
  for (const [k, v] of Object.entries(hexMap)) if (s.includes(k)) s = s.replaceAll(k, v);
  writeFileSync(f, s);
  console.log(`${f}: 剩余 # 色标 ${((s.match(/#[0-9a-fA-F]{3,6}/g)) || []).length}`);
}

fix('renderer/css/style.css', [
  '.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }',
  '.btn.primary.danger { background: var(--danger); border-color: var(--danger); color: #fff; }',
  ".badge-count { display: inline-block; min-width: 18px; padding: 0 6px; height: 18px; line-height: 18px; text-align: center; font-size: 12px; border-radius: 9px; background: var(--accent); color: #fff; margin-left: 4px; }",
  '.nav-btn.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }',
  '.btn.sm.active { background: var(--accent); color: #fff; border-color: var(--accent); }',
  '.rate-btn.on { background: var(--accent); border-color: var(--accent); color: #fff; }',
  '.weak-badge.leech { color: #fff; background: var(--warn); border-color: var(--warn); font-weight: 500; }',
  '.weak-badge.due { color: #fff; background: var(--accent); border-color: var(--accent); font-weight: 500; }',
  '.layer-item.core .layer-name em { font-style: normal; font-size: 10px; background: var(--core); color: #fff; padding: 1px 5px; border-radius: 5px; margin-left: 4px; }',
], {
  '#e7f6ee': 'var(--ok-soft)',
  '#f1f3f5': 'var(--surface-2)',
  '#9aa3af': 'var(--ink-faint)',
  '#6b7280': 'var(--muted)',
  '#6b4a10': 'var(--warn)',
  '#fff1d9': 'var(--warn-soft)',
  '#6a4b9c': 'var(--selfmade)',
  '#f0f0f0': 'var(--surface-2)',
  '#9a6a12': 'var(--warn)',
  '#f0dca6': 'var(--warn-soft)',
}, true);

fix('renderer/css/core.css', [
  '.seg-btn.active { background: var(--accent); color: #fff; font-weight: 600; }',
  '.sp-qlist-idx { font-size: 10px; color: #fff; background: var(--accent); border-radius: var(--radius-sm); padding: 2px 6px; flex-shrink: 0; }',
  '.primary-btn { background: var(--accent); color: #fff; border: 1px solid var(--accent); border-radius: var(--radius-sm); padding: 8px 15px; font-weight: 600; cursor: pointer; transition: background var(--dur) var(--ease), transform var(--dur) var(--ease); }',
], {}, false);
