/**
 * 用户结构层（2026-11-27）：模型树是底稿，人按自己的理解改名 / 换父 / 删节点，
 * 改动另存 structure.json —— analysis.json 永远不动。
 *
 * 为什么另存一层（而不是直接改树）：
 * - core/analyze.js 明写「照搬资料，不要改名、不要合并两章」——那是防模型乱改的硬规则，
 *   不能为了人可编辑就把模型契约拆了。
 * - 重新分析会产出新树；用户改动要能明确「恢复回模型原名」，才有回退的锚点。
 * - 题卡挂 pointPath 靠的是节点 id，改名/换父不改 id，所以挂接不丢。
 *
 * 纯函数，无 DOM / 无 localStorage；Node 判别测试与浏览器共用同一份。
 */

export const STRUCTURE_VERSION = 1;

export function emptyLayer() {
  return { version: STRUCTURE_VERSION, renames: {}, moves: {}, deleted: [], updatedAt: '' };
}

export function normalizeLayer(raw) {
  const l = raw && typeof raw === 'object' ? raw : {};
  const out = emptyLayer();
  if (l.renames && typeof l.renames === 'object') {
    for (const [k, v] of Object.entries(l.renames)) {
      if (typeof k === 'string' && /^n\d+_\d+$/.test(k) && typeof v === 'string' && v.trim()) {
        out.renames[k] = v.trim().slice(0, 120);
      }
    }
  }
  if (l.moves && typeof l.moves === 'object') {
    for (const [k, v] of Object.entries(l.moves)) {
      if (typeof k === 'string' && /^n\d+_\d+$/.test(k) && v && typeof v === 'object'
        && typeof v.parent === 'string' && /^n\d+_\d+$/.test(v.parent) && v.parent !== k) {
        out.moves[k] = { parent: v.parent, index: Number.isInteger(v.index) ? Math.max(0, v.index) : 0 };
      }
    }
  }
  if (Array.isArray(l.deleted)) out.deleted = l.deleted.filter((x) => typeof x === 'string' && /^n\d+_\d+$/.test(x));
  out.updatedAt = typeof l.updatedAt === 'string' ? l.updatedAt : '';
  return out;
}

function clone(node) {
  if (!node || typeof node !== 'object') return node;
  return {
    id: node.id, type: node.type, title: node.title, desc: node.desc || '',
    children: (Array.isArray(node.children) ? node.children : []).map(clone),
  };
}

function walk(node, visit) {
  if (!node) return;
  visit(node);
  (node.children || []).forEach((c) => walk(c, visit));
}

/** 所有节点（含根）按先序返回，供「移动到…」列表与 id 校验用。 */
export function listNodes(tree) {
  const out = [];
  walk(tree, (n) => out.push(n));
  return out;
}

/**
 * 把 layer 应用到模型树，产出新的树；原 tree 不改。
 * 安全闸门（防脏 layer 画出空图）：
 * - 只认模型树里真实存在的 id；改名/换父/删除遇到已不存在的 id 一律忽略。
 * - 换父的目标必须存在且不是自己、不是自己的后代（防环）；非法换父直接忽略。
 * - 删除根不允许（没有根就没图了）。
 */
export function applyStructure(tree, layerRaw) {
  if (!tree) return tree;
  const layer = normalizeLayer(layerRaw);
  const root = clone(tree);
  const nodes = listNodes(root);
  const ids = new Set(nodes.map((n) => String(n.id)));
  const originalParent = new Map();
  nodes.forEach((n) => (n.children || []).forEach((c) => originalParent.set(String(c.id), String(n.id))));

  // 1 改名（只改 title，不动 id / desc / children）
  nodes.forEach((n) => {
    const t = layer.renames[String(n.id)];
    if (t) n.title = t;
  });

  // 2 换父：先把要移动的子树摘下来，再挂到目标下；检测环。
  for (const [id, mv] of Object.entries(layer.moves)) {
    if (!ids.has(id) || !ids.has(mv.parent) || id === String(root.id)) continue;
    let from = null;
    walk(root, (n) => { if ((n.children || []).some((c) => String(c.id) === id)) from = n; });
    const node = from && from.children.find((c) => String(c.id) === id);
    if (!node) continue;
    // 目标不能是自己或自己的后代
    let isDescendant = false;
    walk(node, (n) => { if (String(n.id) === mv.parent) isDescendant = true; });
    if (isDescendant) continue;
    from.children = from.children.filter((c) => c !== node);
    let target = null;
    walk(root, (n) => { if (String(n.id) === mv.parent) target = n; });
    if (!target) { from.children.push(node); continue; } // 目标意外消失：原样放回
    if (!Array.isArray(target.children)) target.children = [];
    target.children.splice(Math.min(mv.index, target.children.length), 0, node);
  }

  // 3 删除（根不可删）
  const doomed = new Set(layer.deleted.filter((id) => ids.has(id) && id !== String(root.id)));
  walk(root, (n) => {
    if (doomed.size) n.children = (n.children || []).filter((c) => !doomed.has(String(c.id)));
  });
  return root;
}

/** 纯函数改 layer：不改原对象，返回新 layer。 */
export function withRename(layer, id, title) {
  const l = normalizeLayer(layer);
  const name = String(title || '').trim();
  if (!/^n\d+_\d+$/.test(String(id)) || !name) return l;
  l.renames = Object.assign({}, l.renames, { [id]: name.slice(0, 120) });
  l.updatedAt = new Date().toISOString();
  return l;
}
export function withMove(layer, id, parent, index) {
  const l = normalizeLayer(layer);
  if (!/^n\d+_\d+$/.test(String(id)) || !/^n\d+_\d+$/.test(String(parent)) || id === parent) return l;
  l.moves = Object.assign({}, l.moves, { [id]: { parent, index: Number(index) || 0 } });
  l.updatedAt = new Date().toISOString();
  return l;
}
export function withDelete(layer, id) {
  const l = normalizeLayer(layer);
  if (!/^n\d+_\d+$/.test(String(id)) || l.deleted.includes(id)) return l;
  l.deleted = l.deleted.concat(id);
  l.updatedAt = new Date().toISOString();
  return l;
}
