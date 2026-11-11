# API 配置（大白话）

复习资料图书馆的「云端引擎」由**你自己**填的 API 驱动：资料文字会发到你填的地址，由那家模型处理。本程序不替你选服务商、不托管你的密钥。

两类最常用服务商（都兼容 OpenAI 格式，本程序已按此对接）：**硅基流动 SiliconFlow** 和 **DeepSeek 官方**。

---

## 一、硅基流动 SiliconFlow

- **API 地址（填到 /v1 那一级）**：`https://api.siliconflow.cn/v1`
- **密钥**：在 https://cloud.siliconflow.cn/account/ak 申请，格式 `sk-...`
- **推荐模型**：
  - 纯文本 / 通用：`deepseek-ai/DeepSeek-V4.1-Flash`、`deepseek-ai/DeepSeek-V3`
  - **看图（多模态 / 能力 API）**：`Qwen/Qwen3-VL-8B-Instruct`（便宜）、`Qwen/Qwen3-VL-32B-Instruct`（质量高）、`deepseek-ai/deepseek-vl2`
- 设置页里选「服务商预设 → 硅基流动」会自动填好地址和一个默认模型；想看图就把模型名改成上面的视觉模型之一。

## 二、DeepSeek 官方

- **API 地址**：`https://api.deepseek.com`  ← 注意**不带 /v1**（它的 OpenAI 兼容地址本身没有 /v1）
- **密钥**：在 https://platform.deepseek.com 申请
- **推荐模型**：
  - `deepseek-flash`：**V4.1 Flash，原生多模态，自带视觉能力**——可以直接做 M3「看图」，无需换服务商。
  - `deepseek-v4-pro`：纯文本、能力强，但**不支持看图**。
- 设置页选「服务商预设 → DeepSeek 官方」会自动填 `https://api.deepseek.com`，默认模型 `deepseek-flash`。

> 结论：**想要 M3 看图，最省事是 DeepSeek 官方的 `deepseek-flash`（原生视觉）**，或硅基流动的 `Qwen/Qwen3-VL-*` / `deepseek-vl2`。

---

## 三、能力 API 标注（什么模型能「看图」）

M3 多模态视觉依赖模型本身支持图片输入。设置页在「模型名」下方实时显示标记：

- ✅ **支持看图（能力 API）**：`deepseek-flash`（DeepSeek 官方）、`Qwen/Qwen3-VL-8B-Instruct`、`Qwen/Qwen3-VL-32B-Instruct`、`deepseek-ai/deepseek-vl2`（硅基流动）等。
- ⚠️ **不支持看图**：`deepseek-v4-pro`、`gpt-4o-mini`（除非该服务商该模型本身支持）、纯文本模型。**这类模型下 M3 会自动降级为纯文本分析，题目/知识点照常出，只是不引用图。**

判定依据：模型名命中已知视觉模型列表即标 ✅；其它即标 ⚠️ 并提示会降级。列表见 `renderer/js/settings.js` 的 `VISION_MODELS`。

---

## 四、环境变量辅助测试（不用每次手填）

开发 / 自测时，可用环境变量给程序喂 API 配置，省去在界面反复输入。程序在启动时读取，作为「界面没填的那几项」的兜底：

| 变量 | 含义 | 示例 |
|---|---|---|
| `RL_API_BASE` | API 地址 | `https://api.siliconflow.cn/v1` |
| `RL_API_KEY` | API 密钥 | `sk-xxxx` |
| `RL_API_MODEL` | 模型名 | `deepseek-ai/DeepSeek-V4.1-Flash` |

**Windows（PowerShell）：**
```powershell
$env:RL_API_BASE="https://api.siliconflow.cn/v1"
$env:RL_API_KEY="sk-你的密钥"
$env:RL_API_MODEL="deepseek-ai/DeepSeek-V4.1-Flash"
npm run dev        # 或启动 Electron
```

**macOS / Linux（bash）：**
```bash
export RL_API_BASE="https://api.siliconflow.cn/v1"
export RL_API_KEY="sk-你的密钥"
export RL_API_MODEL="deepseek-ai/DeepSeek-V4.1-Flash"
npm run dev
```

优先级：**界面里手动填的 > 环境变量**。即界面某项为空白时，才用环境变量的值；界面填了就以界面为准。环境变量里的密钥同样只在内存/本标签页，不写文件、不进日志。

> 注意：环境变量只在 **Electron 主进程 / server.js** 这一侧读取；纯浏览器 HTTP 模式（无主进程）读不到，需手动在界面填。

---

## 五、安全提醒（务必看清）

1. 选云端引擎后，勾选的资料文字会发到你填的地址，由那家模型处理。**发给谁、发什么，由你填的地址决定**。
2. 调用会产生你自己的 API 费用，建议先在服务商后台设消费上限。
3. **按入口区分，但两者都已分层**：默认窗口 `core.html` 把地址 / 模型 / 参数存在浏览器 `localStorage`（键 `core_llm_cfg`，关掉标签页仍在），**密钥单独存 `sessionStorage`（键 `core_llm_key`，关掉标签页即失效）**；旧版分层视图 `index.html` 同样是参数 `localStorage`（键 `rl-settings-v1`）+ 密钥 `sessionStorage`（键 `rl-api-key`）。两者都不写项目文件、不写日志、不上传、不出现在截图里。公用电脑别填，用完请清浏览器站点数据。
4. 环境变量的密钥同第 3 条，不落盘。
