---
name: review-analysis
description: 把「复习资料图书馆（review-library）」项目本地化成一个可复用分析能力——读取当前项目的 library/（同项目理解），一轮轮驱动本地引擎（store/syllabus/mindmap），产出 Markdown 报告 + 全展开思维导图。当用户要在项目里做复习资料的结构化分析、考纲思维导图、资料清点，或要把 review-library 的能力当 skill 调用来做离线分析时使用。
agent_created: true
auto_trigger: false
trigger_words: [复习分析, 思维导图, 考纲大纲, review-analysis, 分析这本书, 资料结构, 全展开图]
---

# review-analysis（复习资料分析 · DSH skill）

把 review-library 的「分层图书馆 + 考纲思维导图 + 离线分析」能力，包装成**可被任意 agent 调用、可在侧边栏打开使用**的 DSH 插件。本 skill **承载思想**（复习分析的方法论在 `references/method.md`），**做成 API 管控**（本地引擎能力契约见 `api-contract.md`），**各种架构相同、一轮轮驱动**（think→invoke→observe 循环，见下），**skills 版本更合理供 agent 用**（直接输出 Markdown + 全展开思维导图 JSON）。

## 何时用

- 用户说「分析这本书 / 生成考纲大纲 / 画思维导图 / 清点资料」。
- 用户要「把 review-library 当 skill 用」「离线跑一次复习分析」。
- 作为 DSH 专家在侧边栏打开，交互式对当前项目做复习分析。

## 前置（同项目理解 · 读当前项目上下文）

本 skill 不处理凭空输入，而是**读当前 review-library 项目**：
- 数据目录：`<project>/library/`（书 + 资料 + 分析结果真落盘处）。
- 轮转状态：`<project>/REVIEW_ANALYSIS_STATE.json`（记上次处理到第几本，下次续做，不推翻重来）。
- 引擎：`lib/store` `lib/syllabus` `lib/mindmap`（CommonJS，离线可调，不联网、不调模型）。

> 类比 `gh-project-optimizer` 的「读 GH_OPTIMIZER_STATE.json + OPTIMIZER_LOG.md 再驱动轮次」——本 skill 的「同项目理解」= 读 library/ 与项目状态文件。

## 一轮轮驱动协议（循环）

每轮严格走四步，绝不闭门造车：

1. **think**：确定本轮要处理的书与要提取的内容（默认按 `REVIEW_ANALYSIS_STATE.json` 轮转窗口 `--rounds` 本）。
2. **invoke**：调本地引擎——`store.getBook` 清点资料 → `syllabus.buildBookOutline` 抽大纲（规则版，离线）→ `mindmap.buildRuleMaps` 生成思维导图。
3. **observe**：把本轮结果聚合进「全展开图」（nodes/edges），并记盘状态。
4. **next**：窗口内还有书 → 回到 think；否则写「圆满格式」产物并结束。

直接跑：

```bash
node skills/review-analysis/driver.js --project <review-library 根目录> [--book <id 或标题>] [--rounds 3] [--out <输出目录>]
```

产出默认落在 `<project>/review-analysis-out/`：`report.md` + `mindmap.full.json`。

## 圆满输出格式（用户原话：直接输出 markdown + 思维导图全展开）

- **`report.md`**：Markdown 报告。含书目总览表、逐书考纲大纲（**全展开**嵌套列表）、思维导图中心节点清单。零基础可读。
- **`mindmap.full.json`**：全展开思维导图数据。`{ nodes:[{id,title,summary,kind,bookId,children}], edges:[{source,target,rel}], fullExpanded:true }`。`kind` ∈ `center|point|related`；`rel` ∈ `contains|related`。可被 D3 力导向图直接渲染，也可被任意前端折叠/展开。

> 为什么是这两种：Markdown 让人直接读结论；全展开 JSON 让 agent / 前端既能整体把握、又能逐节点下钻（节点带 summary 与 children，related 给出真实双链）。与「各种架构相同」一致——同一份数据派生两种形态。

## 边界

- 纯离线、零外链：driver 不调用任何网络或模型；大纲与导图是**规则版**（忠实原文抽取，不产生新知识）。
- 若项目无 library/ 或书无资料，明确报错或输出空结构，不编造。
- 不改写用户 library/ 里的书与资料，只**读**并产生独立分析报告目录。

## 参考

- `api-contract.md`：本地引擎能力契约（materials.add / study.analyze / exam.generate / weak.report / mindmap）。
- `driver.js`：离线循环引擎（本 skill 的「一轮轮驱动」实现）。
- `references/method.md`：复习分析思想（边界清晰、忠实原文、不编造、闭环复习）。
- `expert-manifest.json`：侧边栏「专家」入口元数据（name/profession/defaultInitPrompt/pluginName/industryId）。
