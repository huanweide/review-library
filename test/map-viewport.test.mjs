/** 导图视口变换判别（2026-11-23 需求1）。 */
import { clampScale, zoomAt, panBy, resetView, normalizeView, cssTransform, MIN_SCALE, MAX_SCALE } from '../workbench/src/map-viewport.mjs';

let pass = 0, fail = 0;
const ok = (c, label, d) => { if (c) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label + (d ? ' — ' + d : '')); } };
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

console.log('== 缩放边界 ==');
ok(near(clampScale(0.01), MIN_SCALE), '下限钳制');
ok(near(clampScale(99), MAX_SCALE), '上限钳制');
ok(near(clampScale('abc'), 1), '非数字回落 1');

console.log('\n== 以光标为锚缩放（关键：锚点不动）==');
const v0 = { scale: 1, tx: 0, ty: 0 };
const v1 = zoomAt(v0, 200, 100, 1.5);
ok(near(v1.scale, 1.5), '缩放倍率 1.5');
// 锚点下的内容坐标：(px - tx)/scale 缩放前后应相等
const before = (200 - v0.tx) / v0.scale;
const after = (200 - v1.tx) / v1.scale;
ok(near(before, after), '光标下的内容位置缩放前后不变', before + ' vs ' + after);
const v2 = zoomAt(v1, 200, 100, 1 / 1.5);
ok(near(v2.scale, 1) && near(v2.tx, 0) && near(v2.ty, 0), '放大再缩小回到原视口', JSON.stringify(v2));

console.log('\n== 到边界不再跳 ==');
const atMax = { scale: MAX_SCALE, tx: 10, ty: 20 };
ok(zoomAt(atMax, 100, 100, 2) === atMax, '已到上限再放大返回原对象（不抖动）');

console.log('\n== 平移与复位 ==');
const p = panBy(v0, 30, -15);
ok(p.tx === 30 && p.ty === -15 && p.scale === 1, '平移只改位移不改缩放');
const r = resetView();
ok(r.scale === 1 && r.tx === 0 && r.ty === 0, '复位全回默认');

console.log('\n== 老状态兼容 ==');
const old = normalizeView({});
ok(old.scale === 1 && old.tx === 0 && old.ty === 0, '空状态回落默认');
const bad = normalizeView({ scale: 'NaN', tx: null, ty: undefined });
ok(bad.scale === 1 && bad.tx === 0 && bad.ty === 0, '坏数据不产生 NaN（不会把图画飞）');
const good = normalizeView({ scale: 1.8, tx: 12, ty: -8 });
ok(good.scale === 1.8 && good.tx === 12 && good.ty === -8, '合法状态原样保留');

console.log('\n== CSS transform ==');
ok(cssTransform({ scale: 1.5, tx: 10, ty: -5 }) === 'translate(10px,-5px) scale(1.5)', 'transform 字符串正确');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
