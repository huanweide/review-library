---
title: 双实现合并与发版 · 阶段零外部基准对照表
date: 2026-11-09
tags: [maxloop, merge, release, single-source-of-truth, electron]
source: 三组真实外查（见下）；A/B 两套实现逐字符对照（C:\Users\Administrator\Desktop\agent program\复习资料图书馆 与 C:\Users\Administrator\Desktop\rlbuild）
---

# 阶段零：外部基准 → 我们缺什么

## 一、三组外查与逐字符证据锚点

### 组 1 · 交互式思维导图开源实现（功能基准）

| 来源 | 逐字符锚点 | 基准能力 |
|---|---|---|
| mindkeeper-map (npm) | `"Pan & zoom — scroll-wheel zoom, drag-to-pan, pinch-to-zoom on touch"` / `"PNG & SVG export — high-DPI PNG and vector SVG"` / `"JSON import/export — fromJSON() / toJSON()"` / `"Event system — nodeClick"` | 缩放/平移 + 导出 PNG/SVG/JSON + 节点点击事件 |
| MindForge (GitHub, Ninso112/MindForge) | `"Label search (Ctrl+F) with match highlighting and jump-to-hit"` / `"Pan, zoom (10–300%), free-drag interaction, and fit-to-window"` / `"PNG, PDF, and SVG export"` | **搜索命中高亮并跳转到节点** + 10–300% 缩放 + 导出 |
| mindmap-viewer (GitHub, iambalaji-k) | `"Live Search: debounced search bar that highlights nodes matching your query"` / `"Export as SVG / PNG / JSON"` / `"Zoom In (+), Zoom Out (-), and Fit to Screen"` | 高亮 + 导出 + 缩放三件套 |

**功能基准 ①**：导图必须可缩放/平移、可导出矢量图与 JSON、索引项点击能定位并高亮节点。

### 组 2 · 双实现合并 / 单一真源（结构基准）

| 来源 | 逐字符锚点 | 基准 |
|---|---|---|
| Strangler Architecture (Plexteq) | `"The new system becomes the single source of truth"` / `"Decommissioning the legacy system Only decommission a feature when it is fully replicated in the strangler application"` / `"Immediate fallback options help keep systems running"` | 先逐项复制能力到新系统，旧系统留作回退，**删旧是结果不是动作** |
| 多项目安全合并 (pgsm.cn) | `"第一步不是搬代码而是冻结合同"` / `"适配层必须窄只允许明确能力迁移期最容易犯的错误是提供一个「执行任意命令」的万能入口"` / `"删除旧项目是迁移完成后的结果不是迁移开始时的动作"` | 窄适配层、禁万能入口、不删旧 |
| DDD Ch.14 (synchronium) | `"ANTICORRUPTION LAYER: the downstream builds a translation layer using FACADE and ADAPTER patterns"` / `"duplicate concepts (the same idea represented separately with no coordination)"` | 防重复概念漂移 |

**结构基准 ②**：只允许一份 canonical core；把 A 的能力**逐项适配**进 B 的 Core/request.js 契约，禁止把 A 那套 core 复制过来形成第二真源；A 保留不删。

### 组 3 · Electron 发版版本治理（发布基准）

| 来源 | 逐字符锚点 | 基准 |
|---|---|---|
| Minnow Maintainer Releasing | `"Bumped version in package.json (and committed)"` / `"release/pkg/ has .exe + latest.yml + .blockmap"` / `"Local packaging never uploads anything (electron-builder runs with --publish never)"` / `"Without the feed file, installed apps never see the release. The feed and the installer must be from the same build."` | 五件套 + 三件套资产 + 本地 `--publish never` |
| BetterClaude DESKTOP-APP.md | `"Keep the package.json version and the git tag in lockstep. A tag without the matching version bump produces a release the running app will not offer as an update."` / `"npm version refuses to run on a dirty working tree — commit first"` | **版本号与 tag 必须一致**；脏树先 commit |
| Electron Shipping Field Guide | `"Keep at least the last two releases so a bad rollout can be rolled back by re-publishing the old latest.yml"` / `"Enforce MAJOR.MINOR.PATCH everywhere"` | 保留旧版可回滚、严格三段版本号 |
| 本机经验卡 `notes/桌面端发版与自动更新.md` | `"改五件套（package.json / changelog-meta / CHANGELOG.md / README / —— tag 最后打）"` / 坑 1 BOM / 坑 6 `ELECTRON_BUILDER_BINARIES_MIRROR` | 顺序纪律 + 只用编辑器/node 写文本文件（PowerShell `Set-Content` 会写 BOM） |

**发布基准 ③**：package.json / README / CHANGELOG / tag 四处版本严格一致；只 commit 指定文件；`npm test` 全绿后再 commit；tag 最后打；本地不 `--publish always`。

## 二、A/B 逐字符能力对照（磁盘实测，非摘要）

| 能力 | A（工作区副本 0.8.0） | B（发布正本 1.2.0） | B 缺吗 |
|---|---|---|---|
| canonical 核心 | `core/index.js` 函数式门面 + 复用 `lib/store` | `Core` 类 + `BookStore` + `core/request.js` 路由单一真源 | **B 更强，保留** |
| PDF 抽取 | 前端 pdf.js（Node 侧不抽） | Node 侧 `pdf-parse@1.1.1` + 原生流回退 | **B 更强，保留** |
| 安全加固（11 条） | 部分 | id 白名单 / resolveInside / 4xx-5xx / scrub / 门禁 | **B 更强，保留** |
| 7 类题型 | `QTYPES = ['单选题','多选题','判断题','填空题','简答题','计算题','论述题']` | `QUESTION_TYPES = ['选择题','填空题','名词解释','简答题','判断题','计算题','综合应用题']` | **分类不同，不融合**（B 已接 DSH/专家） |
| 确定性 id + 题型反查 | `normalizeTree()` 分 `n{depth}_{counter}` + `titleMap`；`resolveQuestionIndex()` 回填 `pointId`/`path` | `normalizeNode()` **每个节点都有** `crypto.randomBytes(4)` id，但每次分析都不同（非确定性）；`validate()` 的 questionIndex 只有 `title`/`path`，**无 pointId** | **缺确定性与 pointId，融合** |
| 题型点击联动高亮 | `locateNode(pointId,title)` → 切 tab + `.highlight` + 展开祖先 + `scrollIntoView` | `renderQuestionIndex()` 生成 `.qcard` 但**无 onclick** | **缺，融合** |
| 缩放/平移 | `applyView()` transform + wheel + mousedown 拖拽，0.3–2.5 倍 | 只有「展开全部/收起全部」，CSS 无 transform 样式 | **缺，融合** |
| 导出 SVG/JSON | `buildTreeSvg()` 左→右矢量树 + `exportJson()` + `downloadBlob()` | 无 | **缺，融合** |
| 纯图片/少文本友好报错 | `MIN_TEXT=80` + `imageCount` → `'请先在设置中开启并验证「视觉模型」'` | 仅 `fullText` 为空时报错；有少量文本的纯图片书会静默空分析 | **缺，融合** |
| 语料上限与截断标记 | `MAX_CORPUS=50000` + `truncated` + 概览页警告 | 无上限，超大书直接塞给模型 | **缺，融合** |
| 抽取失败警告上屏 | `importStatus` 显示 `⚠ 文件名：note` | `addFiles()` 失败时 `toast()`，无逐文件 note | **缺，融合**（轻量） |
| 概览统计 | `questionTypeCounts` 分题型卡 + 语料字数 + 截断警告 | chapters/sections/points/subtypes/questionTypes | **缺，融合** |

## 三、结论：这次加什么（检查点句式）

> 搜了 3 组，功能基准是 ① pan&zoom + SVG/JSON 导出 + 索引命中跳转高亮 ② canonical 一份 + 窄适配层逐项迁移、禁止复制第二套核心 ③ package.json 与 tag 严格一致、本地 `--publish never`、三件套资产；对照后 **B 缺 ①（缩放/平移/导出/联动高亮）、确定性 id 反查、纯图片友好报错、语料截断标记、抽取警告上屏、分题型统计**，A 有这些但缺 canonical。**所以这次把 A 的这 6 项能力逐项适配进 B 的 Core 契约，不复制 A 的 core，不覆盖 B 的题型分类，A 保留不删。**

## 四、未找到 / 明确不做（诚实边界）

- **未找到**：A 侧 `_e2e/core-e2e.js` 中关于导出/联动的断言（grep 无命中，文件存在但断言措辞不同），故融合能力以本轮新写的判别测试为准，不引用 A 的旧断言作证据。
- **未找到**：B 仓库的 `CHANGELOG.md`（实测 `无 CHANGELOG.md`），发版五件套需要新建。
- **不做**：把 A 的 `core/` 整体搬进 B（违反结构基准②）；把 A 的题型分类覆盖 B（会破坏已接的 DSH/专家契约）；删除 A 副本（Strangler 要求旧系统留作回退）；本地 `--publish always`（外查基准③明确禁止，且本机 `electron.exe` 缺失）。
- **不做**：`--publish always` 直传 Release、覆盖 `dist/` 里 0.7.0 旧产物。云端 `release.yml` 已配置 `--publish never` + 三件套上传，走 tag 触发即可。
