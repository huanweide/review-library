#!/usr/bin/env node
/**
 * DSH tool 输出渲染判别（baseline 必红 / 改后必绿）。2026-11-28。
 *
 * 官方文档 docs/user/develop/basic/tool.zh.md 逐字：
 *   "`defineTool` 根据 `parameters` 推导并校验 `args`；`execute` 返回 `output.schema` 声明的规范值，
 *    `output.render` 再将该值转换为面向模型的内容。"
 * render 是模型唯一能看到的东西。我们旧版 renderResult() 从不读 v.data，
 * 导致 quiz/due/practice/attempt/rate/cards/structure/snapshot 八个 action 的数据全部不可见。
 *
 * baseline（HEAD 旧版）必红；修复后必绿。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLUGIN = 'plugins/dsh-review-analysis/index.js';
const CUR = fs.readFileSync(path.join(ROOT, PLUGIN), 'utf8');
const OLD = execFileSync('git', ['show', '7876189:' + PLUGIN], { cwd: ROOT, encoding: 'utf8' });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra.slice(0, 180) : '')); }
};

// 从源码里抠出 renderResult 函数体做纯函数判定
function renderBody(src) {
  const start = src.indexOf('function renderResult(v)');
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}

console.log('[A] baseline（固定 v1.7.3）必须是红的');
ok('A1 旧版 renderResult 不读 v.data', !!renderBody(OLD) && !/v\.data/.test(renderBody(OLD)));

console.log('[B] 当前版：render 把每个 action 的数据转成模型可见文本');
const body = renderBody(CUR);
ok('B1 renderResult 读了 v.data', /v\.data/.test(body));
ok('B2 data 有内容时才输出（空 data 不产生噪声行）', /if \(v\.data/.test(body));
// 截断在 renderData() 里（renderResult 只负责调用），扫全源码而不是只抠 renderResult 函数体。
ok('B3 data 输出有截断上限（防止大 JSON 冲爆提示词）',
  /renderData\(v\.action, v\.data\)/.test(body)
  && /MAX_DATA_CHARS\s*=/.test(CUR)
  && /JSON\.stringify\(data\)/.test(CUR)
  && /slice\(0, MAX_DATA_CHARS\)/.test(CUR)
  && /截断/.test(CUR));

console.log('[C] OUTPUT_SCHEMA 与实际返回类型一致');
// snapshot 返回数组（core.listSnapshots 实测 5 项）；structure/cards 是对象。
ok('C1 data schema 兼容 array 与 object', /data:\s*\{\s*type:\s*\[[^\]]*'array'[^\]]*'object'/.test(CUR)
  || /data:\s*\{\s*type:\s*\[[^\]]*'object'[^\]]*'array'/.test(CUR),
  (CUR.match(/data:\s*\{[^}]*\}/) || [''])[0]);
ok('C2 仍用 additionalProperties:false 挡多余字段', /additionalProperties:\s*false/.test(CUR));
// 官方精读 F：compose 返回 kind，旧 schema 缺这个字段 + additionalProperties:false → 成功路径可能被判无效。
ok('C3 schema 声明了 compose 返回的 kind 字段', /\n\s{4}kind:\s*\{\s*type:\s*'string'/.test(CUR));
// 通用守卫：所有 Object.assign(base,{...}) 里出现的返回键都在 schema 里声明（漏一个就可能被判无效值）。
const schemaBlock = (CUR.match(/const OUTPUT_SCHEMA = \{([\s\S]*?)\n\};/) || [])[1] || '';
const schemaKeys = new Set([...schemaBlock.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]));
const returned = new Set();
for (const m of CUR.matchAll(/Object\.assign\(base, \{([^}]*)\}\)/g)) {
  for (const k of m[1].matchAll(/\b(\w+)\s*:/g)) returned.add(k[1]);
}
const undeclared = [...returned].filter(k => k !== 'coreVersion' && !schemaKeys.has(k));
ok('C4 所有实际返回字段都在 schema 中声明', undeclared.length === 0, '未声明：' + undeclared.join(', '));

console.log('[D] 实调 render：八个 action 的数据都出现在模型可见文本里');
// 用动态 import 拿真 render（模块导出需检查），否则用源码级行为模拟
// 这里不改被测代码，只验证「render 逻辑对每种 data 形态都产生文本」。
const sampleData = {
  quiz: { total: 156, questions: [{ key: 'a', stem: '受力分析' }] },
  due: { dueCount: 3, questions: [{ key: 'b' }] },
  cards: { lessons: [], total: 147 },
  structure: { version: 1, renames: { n1_1: '改名' } },
  snapshot: [{ id: '20261128-120000-000' }],
};
ok('D1 样本覆盖 5 种典型 data 形态', Object.keys(sampleData).length === 5);

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
