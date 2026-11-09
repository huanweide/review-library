# dsh-review-analysis

**DeepSeek Harness 插件 · 统一复习项目的 DSH 入口**（不是独立引擎）。

用户要的是「只有一个唯一项目」：导入 PDF / PPT / Word / 图片 → 建一本书 → 大模型把**整本书整体分析** → 可层层展开的思维导图 + 题型分类索引。**DSH 只是这个项目的一个入口**，与桌面端、HTTP server、WorkBuddy 专家共用同一份 `core/` 与同一份书/分析产物。

---

## 与旧版的区别（旧版已判定「完全不对」）

| | 旧版 | 本版 |
|---|---|---|
| 引擎 | 插件自带 `engine/` 副本（`groupByLayer` 分层、规则版导图、Markdown 报告） | **不复制引擎**，直接 require 主项目 `core/index.js` 的 `Core` 类 |
| 分析 | 「纯本地、零依赖、**不联网、不调用模型**」 | **只用 LLM 做整本整体分析**，无离线兜底 |
| 产物 | 考纲大纲 / 全展开节点边 / `report.md` | 层级思维导图树 `tree` + 题型分类索引 `questionIndex` + `summary` + `stats` |
| 数据 | 读旧分层 `library/books/<id>` | 与桌面端共用 `BookStore`（`books/<id>/book.json` + `analysis.json`） |
| 面板 | centers / points / related + Markdown 报告 | 三页：思维导图（可层层展开）/ 题型索引 / 概览 |

> `engine/` 目录是旧版遗留源码，**不参与运行、不在 `files` 发布清单里**，仅保留供回溯。请勿再基于它开发。

---

## 安装

标准 DSH bundle（`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`）：

```bash
# 把本目录放到 ~/.dsh/local-plugins/dsh-review-analysis/ 后
dsh plugin --profile web add <本目录绝对路径>
# 或 plugin_manager(install_bundle, target=<本目录绝对路径>)
```

装好后**重启一次** DeepSeek Harness 桌面应用。仓库根 `npm run forms:sync` 会把本目录同步到已安装位置（不重启宿主）。

---

## 配置

`cordis.patch.yml`：

| 字段 | 说明 |
|---|---|
| `projectRoot` | **必填**：主项目根目录，必须含 `core/index.js`。插件从这里 `require` 统一核心 |
| `library` | 可选，数据目录；缺省 `<projectRoot>/library` |

**密钥绝不写进 patch / 任何文件。** 模型配置走工具参数 `cfg`，或环境变量：

```bash
DSH_LLM_BASE_URL=https://api.example.com/v1
DSH_LLM_MODEL=your-model
DSH_LLM_API_KEY=...        # 只在进程内存，不落盘
```

版本号唯一真源是主项目根 `package.json`；本目录 `package.json` 的 version 由 `npm run versions:sync` 机械同步，**禁止手改**。

---

## 工具用法（模型侧）

工具名仍为 `review_analysis`，用 `action` 分派五个动作：

| action | 作用 | 主要参数 |
|---|---|---|
| `list` | 列出所有书 | — |
| `create` | 建一本书 | `title`, `description?` |
| `add` | 导入资料 | `bookId`, `files: [{name, data(base64)}]` |
| `analyze` | **整本整体分析（LLM）** | `bookId`, `cfg:{baseURL,model,apiKey}`, `maxTokens?`, `timeoutMs?` |
| `get` | 取分析结果 | `bookId` |

`add` 只接受 base64，**不接受任意文件路径**（安全：防模型被诱导读系统文件）。`analyze` 缺 cfg 会明确报错，不静默降级、不编造结果。

典型链路：`create` → `add`（多份资料）→ `analyze` → 拿到 `tree` / `questionIndex` / `summary` / `stats`。

---

## 面板

左侧栏「复习分析」→ 主面板。三页：

- **思维导图**：按 root → 章 → 节 → 知识点 → 子点层层展开，可全部展开/收起。
- **题型索引**：按题型分组，每项带知识点标题与面包屑路径。
- **概览**：全书摘要 + 章/节/知识点/子点/题型统计 + 模型与资料数。

面板是**只读视图**：`GET /review-analysis/api/state`（同源校验）。要重新分析，在对话里调用 `review_analysis` 工具；模型密钥不进面板、不落盘。

---

## 版本与形态

唯一核心、各形态只做入口的规则见仓库顶层 `plugins/README.md`。漂移检测：`npm run forms:check`、`npm run versions:check`。
