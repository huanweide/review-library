/**
 * 导图视口变换（纯函数，2026-11-23 需求1：无界草图空间）。
 * 设计：transform 只在 viewport 层，canvas 保留 overflow:auto 做兜底滚动。
 * 滚轮以鼠标点为锚缩放（缩放前后光标下的内容不动），拖拽平移。
 */
export const MIN_SCALE = 0.35;
export const MAX_SCALE = 3;

export function clampScale(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));
}

/** 以视口内坐标 (px,py) 为锚点缩放：该点对应的内容位置保持不变。 */
export function zoomAt(v, px, py, factor) {
  const next = clampScale(v.scale * factor);
  if (next === v.scale) return v; // 已到上下限：不给「滚了没反应还跳一下」
  const ratio = next / v.scale;
  return {
    scale: next,
    tx: px - (px - v.tx) * ratio,
    ty: py - (py - v.ty) * ratio,
  };
}

/** 平移（屏幕像素增量直接加到位移）。 */
export function panBy(v, dx, dy) {
  return { scale: v.scale, tx: v.tx + dx, ty: v.ty + dy };
}

/** 复位到 100%、不平移。 */
export function resetView() {
  return { scale: 1, tx: 0, ty: 0 };
}

/** 适配宽度：把内容宽缩放到视口宽（有上限，避免放大到糊）。 */
export function fitWidth(v, contentW, viewportW, pad) {
  const p = Number(pad) || 24;
  const avail = Math.max(1, Number(viewportW) - p * 2);
  const w = Number(contentW) || 0;
  if (!w) return v;
  return { scale: clampScale(avail / w), tx: 0, ty: 0 };
}

/** 读存储的老状态：缺字段一律回落默认值，不因旧数据 NaN 把图画飞。 */
export function normalizeView(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const num = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);
  return { scale: clampScale(num(s.scale, 1)), tx: num(s.tx, 0), ty: num(s.ty, 0) };
}

/** 生成 CSS transform 字符串（顺序：先平移后缩放，translate 用 px 不受 scale 影响）。 */
export function cssTransform(v) {
  return 'translate(' + v.tx + 'px,' + v.ty + 'px) scale(' + v.scale + ')';
}
