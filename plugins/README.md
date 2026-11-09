# 形态地图与单一真源（review-analysis 系列）

本文是「这个项目有哪些形态、谁是唯一真源、怎么防漂移」的**唯一权威说明**。

---

## 一句话结论

> **唯一核心 = 仓库根 `core/`**（`Core` 类：建书 → 加文件 → 大模型整本整体分析 → 思维导图 + 题型索引）。
> 桌面端、HTTP server、GitHub Pages 演示、DSH 插件、WorkBuddy 专家**都只是这个统一项目的入口**，不是各自带一份引擎的独立实现。
> 版本号唯一真源 = 根 `package.json`，由 `scripts/sync-versions.mjs` 机械同步。

用户原话：「整体是统一的，只有一个唯一的项目」「大模型把整本书整体分析（不分层）」「DSH 插件只是统一项目的一个入口，必须能承载全部内容」。

---

## 形态地图

| 形态 | 位置 | 怎么接唯一核心 | 入口 |
|---|---|---|---|
| **canonical 核心** | `core/`（`index.js` / `bookStore.js` / `extract.js` / `analyze.js`） | 它自己 | `require('./core')` → `new Core()` |
| 桌面端 Electron | `app/main.js` + `renderer/core.html` | 主进程 require `core/`，经 preload 暴露 `window.api.core` | 默认窗口 `core.html` |
| HTTP server | `server.js` | `const { Core } = require('./core')`，`/api/core/*` 路由 | `npm run dev` → `/core.html` |
| GitHub Pages 演示 | `demo/book.json` + `api-client.js` demo 分支 | 只读演示，不写核心 | 静态预览 |
| **DeepSeek Harness 插件** | `plugins/dsh-review-analysis/` → `~/.dsh/local-plugins/dsh-review-analysis/` | `cordis.patch.yml` 的 `projectRoot` 指向主项目根，Host 用 `createRequire` 加载 `core/index.js` | 工具 `review_analysis` + 左侧栏面板 |
| **WorkBuddy / CodeBuddy 专家** | `plugins/review-analysis/` → `~/.workbuddy/.../review-analysis/` | `bin/driver.js` 的 `--project` 指向主项目根，运行时 require `core/index.js` | agent `review-analysis` + CLI |

所有形态读写**同一份书与同一份分析产物**（`BookStore` 的 `books/<id>/analysis.json`）。在 DSH 里建的书，桌面端打开看得到；反之亦然。

---

## 为什么改（旧版错在哪）

旧版把「做一个插件」理解成「把引擎复制一份进插件目录」。逐字符证据：

- 旧 DSH `index.js:201-203`：「纯本地运行、零外部依赖、**不联网、不调用模型**」← 用户明确要「只做 LLM，不保留离线兜底」
- 旧 DSH `engine/analyze.js:29-35`：`groupByLayer(materials)` ← 正是被推翻的**分层图书馆**
- 旧专家 `agents/review-analysis.md` description：「Always offline — **never call a model or network**」
- 旧 `plugins/README.md`：「引擎唯一真源 = **DSH 插件仓库的 `engine/`**」← 方向反了，真源应在主项目 `core/`
- 旧 `scripts/sync-engine.mjs`：把 `engine/lib/*` 复制到各形态 → 形态越多副本越多，必然漂移

根因：**没建立 canonical → wrapper 的依赖方向**，于是每加一个形态就多一份实现、多一个版本号。修法不是改文案，是把依赖方向翻过来。

---

## 单一真源规则（照抄 Dual-Distribution Pattern）

1. **一个 canonical，绝不两份**：核心逻辑只在 `core/`。任何形态目录里不得出现第二份 `analyze.js` / `BookStore` 实现。
2. **wrapper 只引用，不复制**：DSH 用 `config.projectRoot`，专家用 `--project`，都在运行时 require 主项目 `core/index.js`。
3. **manifest 指向 canonical**：`cordis.patch.yml` 写 `projectRoot`，不内嵌逻辑；`package.json` 的 version 由同步脚本写入，禁止手改。
4. **漂移检测跑在门禁里**：`npm test` 的 `pretest` 自动跑 `sync-versions` + `check-versions`；`npm run forms:check` 检查已安装副本与源码是否一致。
5. **禁止手改被同步的文件**：改 wrapper 改源码目录，然后跑 `npm run forms:sync`。

### 两条命令

```bash
npm run forms:sync     # 源码 wrapper → 本机已安装位置（不重启宿主应用）
npm run forms:check    # 漂移检测；不一致 exit 1
npm run versions:sync  # 根 package.json 版本 → 所有 manifest
npm run versions:check # 版本漂移检测；不一致 exit 1
```

`check-forms.mjs` 还会检查各形态**没有**回退成旧架构（不再 require `engine/`、不再 require 本地 `analyze`、形态地图不含旧话术）。

---

## 版本号

唯一真源 = 根 `package.json` 的 `version`（当前 `1.3.1`）。同步目标：

- `VERSION`、`package.json#build.buildVersion`、`core/index.js#CORE_VERSION`
- `plugins/dsh-review-analysis/package.json`、`plugins/review-analysis/.codebuddy-plugin/plugin.json`
- 两个已安装副本的 manifest
- 根 `README.md` 顶部定位行

**Hard rule：Never hand-edit a version in a per-harness manifest.** 改版本只改根 `package.json`。

---

## 密钥（安全）

模型配置 `cfg = {baseURL, model, apiKey}` 只走：

- DSH：工具参数 `cfg` 或环境变量 `DSH_LLM_BASE_URL` / `DSH_LLM_MODEL` / `DSH_LLM_API_KEY`
- 专家：`REVIEW_LLM_BASE_URL` / `REVIEW_LLM_MODEL` / `REVIEW_LLM_API_KEY`
- 桌面端 / HTTP：前端 `localStorage`（仅本机浏览器），请求时转发

**绝不写进** `cordis.patch.yml`、`plugin.json`、任何仓库文件、日志或错误文本。`lib/llm.js` 的 `scrub()` 会抹掉回显里的密钥。

---

## 安装

```bash
# DSH（真 DeepSeek Harness，读 ~/.dsh）
dsh plugin --profile web add <plugins/dsh-review-analysis 绝对路径>
# WorkBuddy 专家（读 ~/.workbuddy）
cp -r plugins/review-analysis ~/.workbuddy/plugins/marketplaces/my-experts/plugins/review-analysis
```

装完**重启一次**宿主应用。`forms:sync` 只同步文件、不重启，不抢占用户正在做的事。

---

## 废弃清单（保留源码供回溯，不参与运行）

| 位置 | 说明 |
|---|---|
| `plugins/dsh-review-analysis/engine/` | 旧离线分层引擎 + 其测试；`package.json` 的 `files` 已不再打包 |
| `plugins/review-analysis/analyze.js`、`lib/` | 旧离线引擎副本；新 `bin/driver.js` 不再 require 它们 |
| 各 README 里 v0.5–v0.8 章节 | 分层架构时期的历史记录，保留作演进依据，不适用于统一核心 |

> 命名澄清：专家 README 里旧写的「DSH 侧边栏专家」指 WorkBuddy「专家」槽位，**不是**真 DeepSeek Harness。真 DSH 读 `~/.dsh`，WorkBuddy 读 `~/.workbuddy`，两个宿主不同。

---

## 诚实边界

- 本机 `electron.exe` 缺失（包安装损坏），真 Electron GUI 未跑；DSH 宿主也不由脚本重启。插件改动以 Node 侧加载 + 判别测试验证，GUI 实显待用户本机亲验。
- `core/` 目前只在此发布仓库（`huanweide/review-library`）为 canonical。工作区另有一个开发副本 `agent program/复习资料图书馆/`，其 `core/` 是另一套实现（带 14/14 测试与两形态 e2e），**本轮未合并**，见交付小结的 KNOWN-LIMITATION。
