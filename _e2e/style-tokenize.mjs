// 一次性机械变换：把 style.css 的硬编码色值/圆角映射为 tokens.css 的 token。
// 目的：让网页/HTTP 端（index.html）与桌面端共用同一设计系统，且深色模式不再断。
// 变换后务必 git diff 复核 + 真浏览器截图验收。
import { readFileSync, writeFileSync } from 'node:fs';

const f = 'renderer/css/style.css';
let s = readFileSync(f, 'utf8');
const before = s;

// 从 → 到。仅替换独立色标；不触碰 var() 内部 fallback（下面单独处理 #3a7afe）。
const map = {
  // 近黑文字（深色下会变不可见）→ ink
  '#0f172a': 'var(--ink)',
  '#1d4ed8': 'var(--accent-ink)',
  '#2856b8': 'var(--accent-ink)',
  // 浮白卡片底（深色下白卡浮在暗底）→ surface-1 / surface-2
  'background: #fff;': 'background: var(--surface-1);',
  // 浅底高亮块（带默认 ink 文字，深色下会断）→ surface-2
  '#f3f8f5': 'var(--surface-2)',
  '#f8fafc': 'var(--surface-2)',
  '#fbfcff': 'var(--surface-2)',
  '#f8fbff': 'var(--surface-2)',
  '#fff7f5': 'var(--surface-2)',
  '#fcfdff': 'var(--surface-2)',
  '#fff8ec': 'var(--surface-2)',
  '#f0faf4': 'var(--surface-2)',
  '#f1f5f9': 'var(--surface-2)',
  '#eef0f3': 'var(--surface-2)',
  '#f7f9fc': 'var(--surface-2)',
  '#f3f5f9': 'var(--surface-2)',
  '#fafbfc': 'var(--surface-2)',
  // 信息蓝（token 翻转）
  '#eef2ff': 'var(--info-soft)',
  '#3a5bd9': 'var(--info)',
  '#eaf1ff': 'var(--info-soft)',
  '#c9d9ff': 'var(--info-soft)',
  // 自造紫（token 翻转）
  '#f3e8ff': 'var(--selfmade-soft)',
  '#8b5cf6': 'var(--selfmade)',
  '#f3f0ff': 'var(--selfmade-soft)',
  '#ddd6fb': 'var(--selfmade-soft)',
  '#6b4b9c': 'var(--selfmade)',
  '#f1ebfb': 'var(--selfmade-soft)',
  '#eef7ef': 'var(--ok-soft)',
  // 成功绿
  '#1f9d72': 'var(--ok)',
  '#eaf5ef': 'var(--ok-soft)',
  '#bfe3d0': 'var(--ok-soft)',
  '#176b48': 'var(--ok)',
  '#1f7a55': 'var(--ok)',
  '#1f7a52': 'var(--ok)',
  '#2e8b6b': 'var(--ok)',
  // 危险红
  '#fdecea': 'var(--danger-soft)',
  '#f3c2bb': 'var(--danger-soft)',
  '#fdf0ee': 'var(--danger-soft)',
  '#f5c6c0': 'var(--danger-soft)',
  '#a3281a': 'var(--danger)',
  '#a8362a': 'var(--danger)',
  '#b4432e': 'var(--danger)',
  // 警告琥珀
  '#9a5b00': 'var(--warn)',
  '#fff6e6': 'var(--warn-soft)',
  '#f3d9a4': 'var(--warn-soft)',
  '#a4531a': 'var(--warn)',
  '#b07a12': 'var(--warn)',
  '#8a5200': 'var(--warn)',
  '#7a5b00': 'var(--warn)',
  '#8a5a00': 'var(--warn)',
  '#7a4600': 'var(--warn)',
  '#c9891a': 'var(--warn)',
  '#f0d49a': 'var(--warn-soft)',
  '#fff4df': 'var(--warn-soft)',
  '#fff2dc': 'var(--warn-soft)',
  '#fff2e8': 'var(--warn-soft)',
  '#fffaf0': 'var(--warn-soft)',
  '#fdf6e3': 'var(--warn-soft)',
  '#fff7e6': 'var(--warn-soft)',
  '#ffe0a3': 'var(--warn-soft)',
  '#f4cfae': 'var(--warn-soft)',
  '#fff4df': 'var(--warn-soft)',
  '#d98b1f': 'var(--warn)',
  // 灰阶（token 翻转）
  '#94a3b8': 'var(--ink-faint)',
  '#475569': 'var(--ink-soft)',
  '#334155': 'var(--ink-soft)',
  '#e0ecff': 'var(--accent-soft)',
  // 修复未定义变量
  'var(--border)': 'var(--line)',
  // 圆角收敛到系统
  'border-radius: 12px': 'border-radius: var(--radius)',
  'border-radius: 14px': 'border-radius: var(--radius-lg)',
  'border-radius: 16px': 'border-radius: var(--radius-lg)',
};

// 先处理 var() 内部 fallback，再替换裸 #3a7afe（仅剩 rate-btn 两处）
s = s.replaceAll('var(--accent, #3a7afe)', 'var(--accent)');
s = s.replaceAll('#3a7afe', 'var(--accent)');

for (const [k, v] of Object.entries(map)) {
  if (!s.includes(k)) continue;
  const n = s.split(k).length - 1;
  s = s.replaceAll(k, v);
  console.log(`${n}x  ${k} -> ${v}`);
}

// 删除两套死代码（手动 dark toggle，与已建立的 prefers-color-scheme 体系不一致）
s = s.replaceAll('body[data-theme="dark"] .mat-filters { background: #1b2433; }\n', '');
s = s.replaceAll('body[data-theme="dark"] .demo-banner { background: #3a2f12; border-color: #5a4a1a; color: #ffd980; }\n', '');

// .ftype：深色下近黑底上的白字→改用 ink-faint 底 + bg 字（深浅均可读）
s = s.replaceAll(
  '.ftype { font-size: 11px; font-weight: 700; background: #1f2430; color: #fff; padding: 2px 6px; border-radius: 5px; }',
  '.ftype { font-size: 11px; font-weight: 700; background: var(--ink-faint); color: var(--bg); padding: 2px 6px; border-radius: 5px; }'
);

writeFileSync(f, s);
console.log('\n写入完成。改动字节:', before.length - s.length, '| 现存 # 硬编码色标:', (s.match(/#[0-9a-fA-F]{3,6}/g) || []).length);
