# 阶段零 · 外部基准：概览摘要 + 导图节点可读性（2026-11-21）

> 本轮 maxloop 的两个真问题（来自 `PROCESS/自检报告-2026-11-21.md` #7/#8/#11）：
> ① 导图节点标题省略号截断、描述 10px 灰字不可读、实心块溢出画布；
> ② 概览页摘要为空，显示「（模型没有给摘要）」。
>
> 搜索纪律：三组查询（中文功能侧 / GitHub 开源实现 / 英文 best practice），star 数取 GitHub API 实时值。
> **本轮不改已定调的事**：导图继续走确定性格子布局（不走力导向），位置必须由状态唯一决定，可回放可核对。

## 一、GitHub 开源实现（真实 star，2026-11-21 拉取）

| 项目 | star | 逐字符证据（原文） | 我们能借鉴什么 |
|---|---:|---|---|
| `markmap/markmap` | 13,277 | README：`Headings and list items become branches you can fold, zoom and pan. Other text, such as paragraphs and code, stays with its branch as a note that opens in a popover.` | **节点只放短标签，长描述作为 note 放 popover**——不是把整句塞进节点后用省略号切断。右栏讲解面板我们已经有，等于现成的 popover 容器。 |
| `markmap/markmap` | 13,277 | README Features：`Themes: classic, cards and minimal, each with a dark mode, and every color can be changed with CSS.` / `Large maps: an SVG renderer for most maps and a canvas renderer for very large ones.` | 主题与深浅色走 CSS 覆盖（我们已有），大图另想退路而不是把字缩到看不见。 |
| `siyuan-note/siyuan` | 47,319 | 仓库描述原文：`An open-source, privacy-first, self-hosted knowledge workspace where humans and AI agents work together 开源、隐私优先、自托管的知识工作空间，让人与智能体在此协作`；topics 含 `mindmap`、`local-first` | 本地优先 + 导图是知识工作空间的一个切面，不是独立画板——对应我们「导图/提纲/题型/考点大全是同一份分析的五个切面」。README_zh_CN.md 本轮取回 404，未作为证据。 |
| `ankitects/anki` | 32,949 | 仓库描述：`Anki is a smart spaced repetition flashcard program` | 复习类工具的主界面是「现在学什么 / 学了多少」，不是技术元信息——支持概览页必须有真实学习状态。 |
| `mengxi-ream/read-frog` | 10,500 | README：`Turn selected text into reusable AI tools that match the way you read and learn. Define your own prompts and structured output fields, choose a provider, model, and icon, then run the action directly from the selection toolbar for dictionary lookups, rewriting, summaries, explanations, or any workflow you design.` | 「摘要」是可配置动作而不是页面空白；但本轮不新增 action（能力清单三端一致优先）。 |

## 二、英文 best practice（节点可读性）

| 来源 | 逐字符证据（原文） | 含义 |
|---|---|---|
| Visual Paradigm · Markmap Editor 更新说明 | `Wrap Width: Improve Text Readability`；`When node text becomes too long, it can affect the overall balance and readability of the diagram. The Wrap Width option addresses this by allowing you to configure the maximum pixel width of a node’s text before it wraps onto a new line.` | 长节点**自动换行到第二行**，不是截断成省略号。 |
| jsMind 文档 `view.node_overflow` | `hidden - Hide part of them to maintain the overall readability of the mind map [default]` / `wrap - Wrap the text to display the entire content` | 明确把「截断」和「换行」做成可选项；默认 hidden 是有代价的（信息丢失）。 |
| MindMup 博客 | `When a node has lots of text inside, MindMup will automatically wrap the text to create nodes of relatively same width.` | 自动换行保持节点宽度一致，长文本不会把画布撑歪。 |
| 个人开发复盘（SuperPDF mindmap，2026-09-25） | `Unit tests that only compare computed values to each other won't catch this class of bug — at some point the computed width has to be checked against what actually got rendered.`；`Only a screenshot caught the truncation` | **宽度计算的自测互相比较是自证，必须真截图验证**——与本 skill 的 Oracle Gate 完全一致。 |

## 三、中文功能侧（概览该长什么样）

| 来源 | 逐字符证据 | 含义 |
|---|---|---|
| sozai.app 学习指南生成器 | `一页纸上有摘要、带释义的关键词语和可能考到的问题`；`你会得到什么：用一份素材生成一页纸：一段简短的摘要、要点、8 个、12 个或 20 个关键词语…` | 学习资料的「概览」默认就有摘要 + 要点，不是可选装饰。 |
| 复盘小站（CSDN 实测） | `内容总览：用 4–6 个带小标题的要点，整体概括材料讲了什么，不再是一大段文字。` | 摘要是**结构化 4–6 条要点**，不是一大段话，也不是空白。 |
| iWeaver 学习指南 | `一份好的学习指南应该包含什么? 实用的学习指南不只是压缩笔记，还应保留必要的上下文，让你不必重读整章也能有效复习。` | 概览要保留必要上下文；因此兜底必须从真实分析结果派生，不许编。 |

## 四、功能基准 / 结构基准（两份）

**功能基准**：① 短节点标签 + 长文本移至 note/popover；② 长文本自动换行不截断；③ 大图不靠缩小字号硬塞；④ 宽度结论必须真截图验证；⑤ 概览页默认有摘要与要点；⑥ 摘要保留上下文且不编造。

**结构基准**：markmap 把「解析 → 布局 → 渲染 → 交互」拆成 `@markmap/parse` / `render` / `view` / `toolbar` 四层——布局不碰 DOM，渲染不碰数据。我们的对应物是 `core/analyze`（数据）→ `renderer/js/mindmap-layout`（布局）→ `workbench/src/mindmap.js`（交互），层级已对齐，本轮不重构。

## 五、我们缺什么（逐条对照，动手前先看这张表）

| 基准 | 我们现状（源码逐字符锚点） | 缺什么 | 本轮做不做 |
|---|---|---|---|
| ① 短标签 + note/popover | `workbench/src/mindmap.js` 的 SVG 节点把 `n.title` 直接画进 `rect`，`n.desc` 以 10px 灰字塞在节点里；右侧讲解面板已存在但节点不往那里送 | 节点只留可换行短标题，描述从节点里拿掉、点节点进右栏讲解 | **做**（纯前端，不改数据契约） |
| ② 自动换行 | 标题单行、`text-overflow` 省略号（视觉走查 #7 原文：「(1) 正态分布曲线的两个…」） | 两行定宽 + 超出才降级，禁止省略号吞字 | **做** |
| ③ 大图不缩字号 | 全书 229 点竖排 1.7 万像素，已有章 chips 单章聚焦 | 已做，保持 | 不做（已定调） |
| ④ 真截图验证 | 此前只跑 DOM 断言，宽度类问题没截图就宣布修好 | 真浏览器截图前后对照 | **做** |
| ⑤ 概览有摘要 | `workbench/src/bookspace.js:797`：`a.summary \|\| '（模型没有给摘要）'` | 模型没给摘要时，从真实分析结果派生一段可核对的概览 | **做** |
| ⑥ 摘要不编造 | 现有代码无兜底 | 兜底只用 `analysis.tree` / `questionIndex` 里真实存在的章节、知识点数、题型数；数据不足就明说不足，不写形容词 | **做** |

## 六、未找到（诚实边界）

- 未找到「知识点大全/考点大全」类高 star 引擎（此前四关键词检索已确认全是 ≤40★ 内容仓库），本轮不虚构对标。
- `siyuan/README_zh_CN.md` 返回 404，未引用其正文；star 与 topics 来自 GitHub API。
- 未找到开源项目「模型不返回摘要时如何从已有结构化分析结果派生概览」的现成实现；本轮按 ⑤⑥ 自建，并在测试里锁死「只使用真实字段」。

## 七、融合决策表（R/C/N + 根因 A/B，动手前逐条过闸）

> A = 出错点（文件:行号）；B = 设计层根因。只修 A 会再犯，必须 A≠B 同修。
> R = 合理（合定位）／C = 正确（有来源逐字符锚点）／N = 必要（有更轻替代吗）。

| # | 改动 | A 出错点 | B 根因 | R | C | N | 结论 |
|---|---|---|---|---|---|---|---|
| 1 | 节点标题两行自动换行，取消省略号 | `renderer/js/mindmap-layout.js:31-34 short()` + `:253-255` 单行 `<text>` | 把「节点标题」当成完整知识标题的容器，只按单行宽度算字符数，没有「短标签 + 详情外移」的文本层级协议 | 过：导图是主入口，读不全＝拿不到信息 | 过：VP `Wrap Width` + jsMind `view.node_overflow: wrap` 原文 | 过：不改字号、不改格子坐标即可修 | **落** |
| 2 | 节点内不再画 10px 灰字描述；完整标题+描述进既有 tooltip / 右栏讲解 | `:257-259` 11px metaC `<text>` | 把标题和说明两个层级压进 58px 卡片，说明只能是「有信息但看不清」的假完整 | 过：符合「五个切面共用一份分析」定位 | 过：markmap README `stays with its branch as a note that opens in a popover` 原文；tooltip 代码已存在 | 过：容器现成，零新增 UI | **落** |
| 3 | `deriveOverview(analysis)`：模型没给摘要时从真实字段派生 4–6 条要点 | `workbench/src/bookspace.js:797` `a.summary \|\| '（模型没有给摘要）'` | 把「模型可选输出」当成页面唯一来源，缺「分析已产出但字段缺失」的降级路径 | 过：概览是进书第一屏 | 过：sozai / 复盘小站中文原文 + `analysis.json` 实测字段；提示词 `:63` 确有 `summary` 但可为空 | 过：纯前端派生，零模型调用、零新 action | **落** |
| 4 | ~~实心块溢出画布~~ | 评审员真截图未复现（见下「放弃报告」） | — | — | — | — | **放弃：未复现，不改** |

**明确不打回也不扩大的边界**：格子布局不走力导向；`NODE_W=224/NODE_H=58` 不变（尺寸改动会连带整张导图的回放坐标）；不新增 action（能力清单 12 项三端一致）；不为摘要单独再调一次模型（钱与延迟都不划算）。

## 八、放弃报告（评审未复现，不为凑数硬改）

**项**：自检报告 #8「导图实心块溢出画布」。

**证据（ux-reviewer 真截图 + DOM 实测，2026-11-21）**：
- `b_801c90e933dc` 导图 svg viewBox `0 0 3060 1812`，实测 `rect.mm-node` 最大 `x+width=1812`，最小 `x=28`，全部 `x ≥ 0` 且 `y+height ≤ 1812`；
- `b_afb67234524b` svg viewBox `0 0 1106 550`，节点 rect 边界 `x≤1106 / y≤550`；
- 真截图 `screenshots-check/baseline-ux-prob-map.png` 与 `baseline-ux-eng-map.png` 亲眼查看：没有溢出裁切。
- 布局器 `renderer/js/mindmap-layout.js:115-122` 已把双侧模式的负 x 归一化到正坐标，`:127-128` 的 width/height 用全节点包围盒计算。

**结论**：当前版本未复现，本轮不改布局。若将来真出现，先量 `viewBox` 与 rect 边界再动手，不要凭旧截图改尺寸。`KNOWN-LIMITATION`：自检 #8 保留为「历史现象，当前未复现」。

## 九、评审收敛后的两个真缺陷（只有两条，不多找）

1. **标题截断 + 描述不可读（已复现）**：`rect.mm-node` 内 `<text>` 单行 `short()` 吞字，例：`(1) 正态分布曲线的两个…`；描述 `font-size:11px / fill:rgba(23,33,48,.56)`，正文 14px，查看要眯眼。截图 `baseline-ux-book-b_801c90e933dc.png`。
2. **摘要为空（已复现，部分书）**：`b_801c90e933dc` 的 `analysis.json` 没有 `summary` 字段，`b_afb67234524b` 有且非空；`core/analyze.js:502` 把模型可空的 summary 直接 `String(...)`，`validate()` 不校验它——所以「分析成功但摘要空」是合法状态。前端 `bookspace.js:797` 直接显示「（模型没有给摘要）」。

## 十、Oracle Gate（放行判据，逐字符锚点）

| 判据 | 结果 |
|---|---|
| (a) 命令真跑贴输出 | `check-overview.mjs`：基线 **7 通过 / 5 失败**，改后 **18 通过 / 0 失败**；`npm test` 24/25（唯一红为 Node24/Windows undici 退出断言，断言 28/28 全过） |
| (b) 改动文件过语法检查 | `node --check renderer/js/mindmap-layout.js`、`node --check workbench/src/bookspace.js`、`node --check overview.mjs` 全 OK；`NODE_W/NODE_H=224 58` 未变 |
| (c) 真实入口可达 | playwright-cli 打开 `#/book?id=b_801c90e933dc`，真浏览器实测：节点 `<text>` 省略号 **0** 个、11px 描述文字 **0** 个、标题逐条为 `(1) 正态分布曲线的两个主要参数` 等；概览页 6 条要点 + 诚实说明；控制台 **0 error / 0 warning** |
| (d) 修复前失败输出 | 基线截图 `screenshots-check/baseline-ux-prob-map.png`（`(1) 正态分布曲线的两个…`、11px 灰描述）；基线摘要「（模型没有给摘要）」由评审员 DOM 取证 |
| (e) 逐字符锚点 | `renderer/js/mindmap-layout.js:31-34 short()`、`:253-255` 单行 `<text>`、`:257-259` 11px desc；`workbench/src/bookspace.js:797` `a.summary \|\| '（模型没有给摘要）'`；`core/analyze.js:63` `"summary": "全书概览（2-4 句）"`、`:502` `summary: String(parsed.summary \|\| '').slice(0, 800)` |

**真截图**：`screenshots-check/final-ux-map.png`、`final-ux-overview.png`、`final-ux-overview-v2.png`（均已亲眼查看，非程序生成占位图）。

**效率指数**：产出级别 100（2 个真缺陷全部真解决并通过 Oracle Gate；第 3 项 #8 评审未复现，按放弃报告移出分母）／轮数 1（单轮收敛）／**效率指数 100**。

## 十一、交付小结（体系化说人话）

- **真问题 1**：导图节点标题被省略号吞字，描述塞成 11px 灰字。锚点 `mindmap-layout.js:31-34 / 253-259`。**修复**：`wrapLabel()` 按中文语义断点换至多三行（字号不变、格子尺寸不变），描述移到既有 tooltip 与右栏讲解，节点里不再画。
- **真问题 2**：书内概览页显示「（模型没有给摘要）」。锚点 `bookspace.js:797` + `analyze.js:502`。**修复**：新增 `workbench/src/overview.mjs`，模型给了摘要就用模型原文；没给就从 `tree` / `questionIndex` / `stats` 派生 4–6 条要点，并明写「不是模型原文」；没数据就直说没有。
- **未复现**：自检 #8 实心块溢出——真截图与 viewBox/rect 边界实测都正常，放弃改动，保留为历史观察。
- **当前状态**：判别 18/18、配置层 52/52、其余六组剧本全绿、门禁 24/25（同已知环境噪声）；SW v27；真浏览器 0 error / 0 warning。
- **KNOWN-LIMITATION**：①老版 renderer（`renderer/js/core-ui.js:645`）仍是 `a.summary || '（无概览）'`，本轮只改 workbench 主入口，老入口保留空文案；②派生概览只陈述结构，不评价重点（那是「考点大全」的职责，避免两个切面说两套话）；③中文标点断行是启发式，极端长串标题（无标点且超三行）仍会在最后一行出现省略号，但 tooltip 保留全文。
