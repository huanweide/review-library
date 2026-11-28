#!/usr/bin/env node
/**
 * 用户结构层判别测试（2026-11-27）。baseline 必红 / candidate 必绿：
 * 旧版导图只能看模型树，节点 id 稳定但人不能改名、不能换父，改动无处落盘。
 * 2026-11-28：baseline 从 HEAD 改为固定 commit 7876189（v1.7.3），
 * 避免 v1.8.0 提交后 B1-B3 假红（HEAD 已含 structure action，不再是「旧版」）。
 */
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as S from '../workbench/src/structure-layer.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

console.log('\n[BASE] 旧版必须没有用户结构层');
const oldCaps = execFileSync('git', ['show', '7876189:core/capabilities.js'], { cwd: ROOT, encoding: 'utf8' });
const oldIndex = execFileSync('git', ['show', '7876189:core/index.js'], { cwd: ROOT, encoding: 'utf8' });
const oldMap = execFileSync('git', ['show', '7876189:workbench/src/mindmap.js'], { cwd: ROOT, encoding: 'utf8' });
ok('B1 旧版没有 structure action', !/action: 'structure'/.test(oldCaps));
ok('B2 旧版 Core 没有 getStructure', !/getStructure/.test(oldIndex));
ok('B3 旧版导图没有右键改名/拖拽换父', !/contextmenu/.test(oldMap) && !/mm-drop/.test(oldMap));

console.log('\n[L] 纯函数：只叠用户改动，绝不改模型树');
const tree = {
  id: 'root', title: '全书', children: [
    { id: 'n1_1', title: '第一章', children: [
      { id: 'n2_2', title: '第一节', children: [{ id: 'n3_3', title: '知识点' }] },
    ] },
    { id: 'n1_4', title: '第二章', children: [] },
  ],
};
const snapshot = JSON.stringify(tree);
let L = S.emptyLayer();
L = S.withRename(L, 'n2_2', '我改的名字');
let V = S.applyStructure(tree, L);
ok('L1 改名生效', V.children[0].children[0].title === '我改的名字');
ok('L2 原树一个字节都没动', JSON.stringify(tree) === snapshot);
L = S.withMove(L, 'n2_2', 'n1_4');
V = S.applyStructure(tree, L);
ok('L3 换父生效（带子树一起走）',
  V.children[1].children[0].id === 'n2_2' && V.children[1].children[0].children[0].id === 'n3_3');
ok('L4 换父后原位置空了', V.children[0].children.length === 0);
const cyclic = S.applyStructure(tree, S.withMove(S.emptyLayer(), 'n1_1', 'n3_3'));
ok('L5 环检测：不能把祖先后代当父节点', cyclic.children[0].id === 'n1_1');
const bogus = S.applyStructure(tree, S.withRename(S.emptyLayer(), 'no_such_id', '乱改'));
ok('L6 不存在的 id 一律忽略', bogus.children[0].title === '第一章');
const deleted = S.applyStructure(tree, S.withDelete(S.emptyLayer(), 'n2_2'));
ok('L7 删除生效且根不可删',
  deleted.children[0].children.length === 0 && S.applyStructure(tree, S.withDelete(S.emptyLayer(), 'root')).id === 'root');
ok('L8 脏 layer 归一化（非白名单字段剥掉）',
  !JSON.stringify(S.normalizeLayer({ renames: { n1_1: 123, bad: 'x' }, moves: {}, deleted: [], __proto__: {} })).includes('123'));

console.log('\n[D] 落盘：structure.json 独立，analysis.json 不被改写');
const { Core } = require(path.join(ROOT, 'core/index.js'));
const core = new Core();
const BOOK = '87763d2d14a660d0';
const a = core.getAnalysis(BOOK);
const analysisBefore = JSON.stringify(a);
const live = S.withRename(S.withMove(S.emptyLayer(), 'n2_2', 'n1_4'), 'n1_1', '我的第一章');
const saved = core.saveStructure(BOOK, live);
ok('D1 落盘字段齐全', saved.version === 1 && !!saved.renames.n1_1 && !!saved.moves.n2_2);
ok('D2 回读一致', core.getStructure(BOOK).renames.n1_1 === '我的第一章');
ok('D3 analysis.json 未被改写', JSON.stringify(core.getAnalysis(BOOK)) === analysisBefore);
ok('D4 叠加到真实树：改名后节点 id 还在（题卡挂接不丢）',
  S.applyStructure(a.tree, saved).children[0].id === a.tree.children[0].id);
core.saveStructure(BOOK, S.emptyLayer()); // 还原现场，判别不留痕
ok('D5 恢复模型结构＝清空 layer', Object.keys(core.getStructure(BOOK).renames).length === 0);

console.log('\n[W] 三端注册 + 前端接线');
const caps = fs.readFileSync(path.join(ROOT, 'core/capabilities.js'), 'utf8');
const req = fs.readFileSync(path.join(ROOT, 'core/request.js'), 'utf8');
const host = fs.readFileSync(path.join(ROOT, 'core/app-host.js'), 'utf8');
const map = fs.readFileSync(path.join(ROOT, 'workbench/src/mindmap.js'), 'utf8');
const bs = fs.readFileSync(path.join(ROOT, 'workbench/src/bookspace.js'), 'utf8');
ok('W1 capabilities 声明 structure', /action: 'structure'/.test(caps));
ok('W2 HTTP 路由 GET/POST 都接了', /parts\[2\] === 'structure'/.test(req) && /saveStructure/.test(req));
ok('W3 app-host 分发接了', /case 'structure'/.test(host));
ok('W4 导图吃 layer（章聚焦也吃）', /const baseRoot = \(\) => applyStructure/.test(map) && /chapterTree\(\) \|\| baseRoot\(\)/.test(map));
ok('W5 右键改名 + 拖拽换父 + 恢复按钮',
  /contextmenu/.test(map) && /pointerdown/.test(map) && /mm-drop/.test(map) && /恢复模型结构/.test(map));
ok('W6 书内页加载/保存 layer，写失败不假成功',
  /host\.action\('structure'/.test(bs) && /结构保存失败/.test(bs));

console.log('\n结果 ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
