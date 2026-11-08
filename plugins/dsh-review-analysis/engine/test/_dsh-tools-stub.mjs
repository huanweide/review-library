// 测试桩：替代真实的 @deepseek-ai/dsh-tools。
// 仅做最小契约校验并原样返回定义，使 index.js 可在无 DSH 运行时的情况下被加载测试。
export function defineTool(def) {
  if (!def || typeof def.name !== 'string') throw new Error('defineTool: missing name');
  if (typeof def.description !== 'string') throw new Error('defineTool: missing description');
  if (!def.parameters || typeof def.parameters !== 'object') throw new Error('defineTool: missing parameters');
  if (!def.output || !def.output.schema || typeof def.output.render !== 'function') {
    throw new Error('defineTool: missing output.schema/render');
  }
  if (typeof def.execute !== 'function') throw new Error('defineTool: missing execute');
  return def;
}
