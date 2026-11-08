// ESM 解析钩子：把裸导入 '@deepseek-ai/dsh-tools' 别名到本地测试桩，
// 这样 index.js（生产代码）可在没有真实 DSH 运行时的情况下被加载与测试。
const stubUrl = new URL('./_dsh-tools-stub.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    return { url: stubUrl, shortCircuit: true };
  }
  return next(specifier, context);
}
