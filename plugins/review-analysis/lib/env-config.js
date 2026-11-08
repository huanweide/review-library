'use strict';
// 从环境变量读取 API 配置，作为 UI 未填写时的兜底（辅助测试用）。
// 安全约定：
//  - 只在 Node 侧（Electron main / server）读取，绝不在渲染进程直接碰 process.env；
//  - 渲染进程通过 preload 的 app.env 桥接取得，密钥同样不落盘、不进日志。
// 变量名：RL_API_BASE / RL_API_KEY / RL_API_MODEL
function readApiEnv() {
  const base = (process.env.RL_API_BASE || '').trim();
  const key = (process.env.RL_API_KEY || '').trim();
  const model = (process.env.RL_API_MODEL || '').trim();
  return { baseURL: base, apiKey: key, model };
}
module.exports = { readApiEnv };
