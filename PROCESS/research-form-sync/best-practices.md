---
title: 多形态单一真源与版本同步 · 外部基准对照表
date: 2026-11-08
tags: [maxloop, 阶段零, 单一真源, 版本同步, DSH, 多形态]
source: DeepSeek Harness 官方 Write a Tool / Dual-Distribution Pattern / version single-sourcing 指南（逐字符锚点见下）
---

# 多形态单一真源与版本同步 · 阶段零对照表

> 本轮任务：用户「更新优化 maxloop 所有版本同步和适配对应部分（dsh 的也做过了但完全不对，把他的也优化好）」。
> 模式A 产品深度迭代。本文只做基准对照，结论落在 `计划追踪/对话计划-2026-11-08.md`。

## 一、三组检索与逐字符证据锚点

| # | 检索组 | 来源 | 逐字符锚点 |
|---|---|---|---|
| 1 | DSH 工具契约（官方） | deepseekdocs.com《Write a Tool》、ssdnodes《Write your own dsh plugin》 | 「the core of tool definition is **parameters (JSON-Schema) + output.schema/render + execute(args, exec)**」；「`export const inject = ['tools']` is the line people leave out… inject tells Cordis to wait until ctx.tools exists」；「Missing/unsupported output → registration fails; a **missing render throws TypeError**」；「A bundle is an npm package whose package.json declares a `dsh.bundle` field pointing at its patch file」 |
| 2 | 多形态分发（GitHub 开源） | vasilyu1983/AI-Agents-public `references/dual-distribution.md` | 「**One canonical source, many wrappers, drift caught by tooling**」；「The naive answer — copy the skill into each target — **guarantees drift**」；「**3. Drift detection runs in CI / pre-commit**… Diffs every bundled-copy distribution against its canonical source and fails if drift detected」；「**What NOT to Do** Hand-edit the bundled copies」 |
| 3 | 版本单一真源（工程规范） | legioncodeinc/vibe-coding-tools `guides/02-sync-versions.md` | 「The single most-violated invariant in a multi-manifest repo: **the version**」；「Source of truth: the version field in **root package.json**. Propagation: **prebuild runs node scripts/sync-versions.mjs**, which writes that version into every harness manifest」；「**Hard rule: Never hand-edit a version in a per-harness manifest**」；「Auditing version sync… reads the root package.json version and diffs it against every harness manifest」 |

## 二、两份基准

**功能清单（一个多形态项目该有什么）**
1. 一个 canonical 核心，所有分发形态只是 wrapper / 入口
2. 各形态 manifest 指向 canonical，不内嵌副本逻辑
3. `sync` 脚本（canonical → 各形态）+ `check` 脚本（漂移检测，CI 门禁）
4. 版本号唯一真源 = 根 `package.json`，`prebuild` 机械传播，禁止手改
5. 每个形态的对外契约（工具定义 / agent 定义 / 面板）与 canonical 语义一致
6. 密钥不进 manifest、不进仓库

**形态结构（本项目实际盘点，2026-11-08 23:37 磁盘核验）**

| 形态 | 位置 | 当前状态 |
|---|---|---|
| canonical 核心 | `rlbuild/core/`（`Core`+`BookStore`+`extract`+`analyze`） | 存在，`server.js:79-119` 已接 `/api/core/*`，注释写「桌面端 / DSH 插件都只接这一层」 |
| 桌面端 Electron | `rlbuild/app/main.js` + `renderer/core.html` | 默认仍开旧 `index.html`（A 副本已修，B 未同步） |
| HTTP server | `rlbuild/server.js` | 已接统一核心 |
| GitHub Pages 演示 | `rlbuild/demo/book.json` | 演示数据，旧结构 |
| **DSH 插件** | `rlbuild/plugins/dsh-review-analysis/` + `~/.dsh/local-plugins/dsh-review-analysis/` | **旧分层离线引擎**，`index.js:201-203`「不联网、不调用模型」 |
| **WorkBuddy 专家** | `rlbuild/plugins/review-analysis/` + `~/.workbuddy/.../review-analysis/` | **旧分层离线引擎**，`agents/review-analysis.md`「Always offline — never call a model or network」 |
| 形态地图 | `rlbuild/plugins/README.md` | 「引擎唯一真源 = DSH 插件仓库的 `engine/`」——方向反了 |
| 同步脚本 | `rlbuild/scripts/sync-engine.mjs` | 同步的是旧 `engine/lib/*`，不是 `core/`；无 check |

## 三、对照表：基准有什么 / 我们有什么 / 缺什么

| 基准项 | 我们有 | 缺口 |
|---|---|---|
| ① 单一 canonical | `rlbuild/core/` 有，但**另有一个工作区副本 A 的 `core/` 是另一套实现**（md5/行数全不同） | 未声明唯一真源；两实现并存 |
| ② wrapper 指向 canonical | 无：DSH `cordis.patch.yml` 指旧 `library` 路径、自带 `engine/` 副本 | **DSH 必须重做** |
| ③ sync + check 门禁 | `sync-engine.mjs` 有但方向错（同步旧 engine），无 check | 重写 sync、新增 check |
| ④ 版本唯一真源 | **5 个不同数字**：主程序 `0.8.0`(A) / `1.0.0`(B) / DSH `1.1.0` / 专家 `1.0.2` / `CORE_VERSION 0.1.0` | 统一 + 机械传播 + 漂移检测 |
| ⑤ 各形态契约语义一致 | 桌面/server 已是「建书→导入→LLM 整本整体分析→导图+题型索引」 | DSH 与专家仍是「分层图书馆 / 考纲大纲 / 规则版导图 / 离线不调模型」——**与用户原话直接冲突** |
| ⑥ 密钥不落 manifest | 现有 patch 只放路径 | 新工具 cfg 必须走参数或环境变量，不写进 patch |

## 四、未找到 / 诚实边界

- **未找到**：DSH 官方对「插件如何 require 另一个仓库的 CommonJS 核心」的规范做法。本项目用 `createRequire(import.meta.url)` + `config.projectRoot` 绝对路径加载主项目 `core/index.js`，属工程适配，非官方约定；需真机 `npm start` 后验证插件加载。
- **未找到**：用户明确指定「以哪个工作副本为正本」。本轮**假设** `rlbuild`（GitHub `huanweide/review-library`，有 remote 且是实际发布源）为发布正本，`agent program/复习资料图书馆` 为工作区开发副本（其 `core/` 是另一套实现、带 14/14 测试与 e2e）。此假设写在计划与交付里，A 的 core **本轮不覆盖**（避免砸坏已验证资产），作为残留项显式交接。
- **无法验证**：本机 `electron.exe` 缺失，真 Electron GUI 未跑（上一轮已记）；DSH 宿主应用也不重启（不抢占用户正在做的事），插件改动以 Node 侧加载 + 单元判别测试验证。

## 五、检查点句式

搜了 3 组（DSH 官方 Write a Tool 契约、Dual-Distribution Pattern、version single-sourcing prebuild 传播），功能基准是 ① `inject`+`output.schema/render` 完整 ② 一个 canonical 源 + 多 wrapper + sync/check 漂移门禁 ③ 版本号根 `package.json` 唯一真源、机械传播、禁止手改；形态结构基准是 `canonical core/ → distributions/{desktop,server,demo,dsh,expert}` + 形态地图 + sync/check 脚本。**我们缺单一真源声明、sync/check 门禁、版本统一，且 DSH / 专家两个 wrapper 还整个停在旧分层离线引擎**，所以这次做：定正本 → 重做 DSH 工具与面板接统一核心 → 专家形态适配 → 重写形态地图与同步/检查脚本 → 统一版本 → 桌面入口补齐 → 判别测试与 Oracle Gate。
