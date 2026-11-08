# 复习资料分析专家（review-analysis）

> DSH 侧边栏专家 / 离线复习资料分析引擎。把分层复习资料库，离线转成结构化大纲、全展开知识图谱与闭环复习报告。

> ⚠️ **命名澄清 + 引擎共用**：本专家装在本机 `~/.workbuddy`（WorkBuddy/CodeBuddy 引擎的「专家」槽位），
> 并非真 DeepSeek Harness（`~/.dsh`）。真 DeepSeek Harness 的插件是同级目录 `dsh-review-analysis/`，
> 两者**共用同一套离线引擎**——引擎唯一真源在 `dsh-review-analysis/engine/`，由 `scripts/sync-engine.mjs` 同步。
> 形态地图、版本索引、防漂移规则见 **[`plugins/README.md`](./README.md)**。

## 它是什么

`review-analysis` 是一个 **DSH（DeepSeekharness）专家（agent 型）**，安装后在侧边栏「我的专家」可见可用。它的本体是一个**自包含的离线引擎**：

- `lib/`：从 review-library 抽离的本地引擎库（store / syllabus / mindmap 等），随插件一起安装，不依赖任何外部仓库。
- `bin/driver.js`：统一驱动入口，按"一轮轮驱动"协议调用本地引擎，产出报告。
- `agents/review-analysis.md`：专家人格与工作流程说明。

## 产品级特性

- **完全离线 / 零云端**：所有分析走本地 `lib/*`，不联网、不调用模型、不外发资料。
- **自包含**：引擎库随插件安装，用户无需先装 review-library 仓库即可使用本专家（数据仍来自用户自己的 review-library 项目）。
- **一轮轮驱动 + 续做**：按窗口逐批处理书；续做靠 `mindmap.full.json` / `book-reports.json` 按节点/边 id 去重累积，重跑同一 `--out` 即接着干、结果累积进同一张全展开图，不推翻重来。
- **圆满格式（同源双形态）**：`report.md`（人读）+ `mindmap.full.json`（机读全展开），同一份真相两种形态。

## 安装

本专家是 **DSH（DeepSeekharness）侧边栏专家**。本仓库 `plugins/review-analysis/` 是单一分发源，通过以下任一渠道装到本机 DSH 后，即可在「我的专家」看到「复习资料分析专家」。

### 渠道一 · 一键安装脚本（推荐，自动对应版本）

```bash
# Unix / macOS / Git Bash（默认装最新插件版本，可传版本号）
bash <(curl -fsSL https://raw.githubusercontent.com/huanweide/review-library/main/plugins/review-analysis/install.sh)
# 指定版本：bash install.sh v1.0.0

# Windows (PowerShell)
irm https://raw.githubusercontent.com/huanweide/review-library/main/plugins/review-analysis/install.ps1 | iex
# 指定版本：.\install.ps1 v1.0.0
```

脚本默认解析最新 `review-analysis-v*` tag 安装；传版本号则装与 review-library 对应的版本（如 `v1.0.0` 插件对应 review-library v1.0.0 引擎）。

### 渠道二 · GitHub Release 资产（版本化，手动）

到 [Releases](https://github.com/huanweide/review-library/releases) 下载 `review-analysis-dsh-plugin-<版本>.zip`，解压到：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/review-analysis
```

### 渠道三 · 源码 tag archive / sparse-clone

```bash
# 仅取插件子目录（省带宽）
git clone --filter=blob:none --sparse https://github.com/huanweide/review-library.git
cd review-library && git sparse-checkout set plugins/review-analysis
# 切到对应版本：git checkout review-analysis-v1.0.0
cp -r plugins/review-analysis ~/.workbuddy/plugins/marketplaces/my-experts/plugins/
```

> 每个 `v*` / `review-analysis-v*` tag 的 GitHub 页面也都提供源码 zip（archive），整体下载后取子目录即可。

### 装好后

注册信息由 `expert-manager` 写入 `my-experts/.codebuddy-plugin/marketplace.json`。重开/刷新 DSH 后，侧边栏「我的专家」即出现「复习资料分析专家」。

## 使用

在对话里直接说，例如：

- "分析我的复习资料库，生成结构化大纲和全展开思维导图"
- "只分析《材料科学基础》这一本"
- "接着上次的分析继续，把剩下没处理的书跑完"

专家会自动调用离线引擎。你也可以手动跑驱动：

```bash
node "<插件目录>/bin/driver.js" \
  --project "<review-library 根目录>" \
  --library "<library 目录>" \
  --out "<输出目录>" \
  --rounds 3            # 本轮处理几本书；不指定则一次性全跑
  # 可选：--book "材料科学基础"
```

`<插件目录>` 默认：

```
C:\Users\Administrator\.workbuddy\plugins\marketplaces\my-experts\plugins\review-analysis
```

## 产出物

| 文件 | 说明 |
| --- | --- |
| `review-analysis-out/report.md` | 书目总览 + 逐书全展开大纲 + 思维导图摘要 |
| `review-analysis-out/mindmap.full.json` | 全展开知识图谱（nodes/edges/fullExpanded） |
| `review-analysis-out/book-reports.json` | 每书报告缓存（续做累积） |
| `review-analysis-out/mindmap.full.json` + `book-reports.json` | 续做进度真源（按 id 去重累积，重跑同一 `--out` 即续做） |

## 数据边界

- **只读**：`<library>/`（即 review-library 的 `library/`）。
- **只写**：`<project>/review-analysis-out/`（`report.md` / `mindmap.full.json` / `book-reports.json`）。
- 不触碰用户其他文件，不联网，不写任何凭据。

## 与 review-library 的关系

`review-analysis` 是 review-library 的**分析侧专家形态**：review-library 负责资料的增删改查与闭环复习（含云端引擎可选），本专家负责**离线结构化分析**——同一份资料，两种视角，零云端即可用。
