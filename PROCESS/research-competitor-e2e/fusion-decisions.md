---
title: 高 star 竞品端到端效果 · 融合决策表（R/C/N + 根因 A→B）
date: 2026-11-10
tags: [maxloop, R-C-N, 融合, 端到端, 竞品, 下一轮候选]
source: best-practices.md 对照表 + 竞品官方 README 逐字符引文 + rlbuild v1.4.0 源码行号
---

# 融合决策表（2026-11-10）

> **本轮不执行任何代码改动。** 用户原话是「横向对比…看看对方的端到端效果」，
> 属研究/信息获取，不是「开始改」。下表是**下一轮候选清单**，等明确指令再动。
> 每项过 R（合理性）/ C（正确性，须有逐字符锚点）/ N（必要性 + 更轻替代）+ 根因 A→B。

## 一、逐项决策

| # | 候选 | R 合理性 | C 正确性（外部锚点） | N 必要性 / 更轻替代 | 根因 A→B | 结论 |
|---|---|---|---|---|---|---|
| F1 | **把 legacy 的出题/批改/错题/间隔复习闭环接进 `core/`**，默认窗口 `core.html` 提供作答入口 | 与「只有一个统一项目、所有形态共用 core/」完全一致 | `app/main.js:38` `new Core(DATA_DIR)`、`:42` `core:request`，但 `:54–:147` 的 `study:*/mindmap:*/review:*` 全走旧 `store`；`core/index.js` 仅 9 方法；`core/request.js` 无 study/review 路由；`core.html` Grep 作答关键词零命中 | 不做则默认入口永远止于「看题」，而 DeepTutor / OpenMAIC / PageLM / SurfSense 全有闭环。更轻替代「core.html 加个按钮跳 legacy 窗口」只遮丑、两套 store 仍分裂 → 否决 | A=`core.html` 缺入口；B=**canonical 只定义了「分析」这一半产品，学习闭环没进入统一核心**，不是 UI 少个按钮 | **合（下一轮最高优先）** |
| F2 | **解析层锚定页码，`source` 由程序校验而非模型自报** | 直接服务用户「图书原图 + 来源」 | DeepTutor「cited page by page」「PageIndex (reasoning retrieval with page-level citations...)」；PageIndex「Page-level citations」/ Cloud「Block-level」；SurfSense「Research (cited answers)」。我方 v5 台账 samples 的 `page` 多为 0 | 模型自报的 `source.file/page/quote` 无法回溯；更轻替代「提示词再强调页码」v5 已实测无效（仍 page=0）→ 否决 | A=`source` 字段由 LLM 填；B=**`core/extract.js` 把多文件拼成纯文本时丢掉了页码坐标**，模型无从得知 | **合** |
| F3 | **长书：解析时保留章节/页码结构，按结构均衡抽样替代粗暴截断** | 保持「一次 API」前提下缓解 G1 | PageIndex 硬证据「at 805 pages the document no longer fits in the context window at all」；我方 `core/analyze.js` `MAX_CORPUS=50000` 且 `truncated` 只是标记 | 长书现在静默丢内容且用户无补救路径。更轻替代「调大上限」→ 会撞 `max_tokens`/上下文窗，治标不治本；「改 RAG 多阶段」→ 破坏用户硬需求 → 均否决 | A=50000 字截断；B=**语料是无结构字符串，无法按重要性取舍**，只能从头砍 | **合（有限）**：只做结构化语料 + 显式告知，不改多阶段 |
| F4 | **先出大纲供人审，再生成内容**（DeepTutor / OpenMAIC 两阶段） | **R 不过**：用户硬需求「一次 API 整本整体分析」 | DeepTutor「the creation flow proposes a chapter outline before content is generated, so you review the shape instead of accepting a blind one-shot output」；OpenMAIC「Outline → Scenes」 | 更轻替代：分析完成后允许「重生成某一分支」，不破坏主链路的一次性 | — | **否**（保留为 KNOWN-LIMITATION，代价已在 best-practices 第五节写明） |
| F5 | **导出 Anki / 作答记录 / 分享只读链接** | 补齐 G5 可交付性 | DeepTutor「Export flashcards (Anki)」「shared Books with private learning state」「export as Markdown or Word」；OpenMAIC「.pptx / offline .html / classroom ZIP」；SurfSense 编辑副本 | **依赖 F1**：没有作答数据就没有可导出的复习资产。单独先做 Markdown/OPML 之外的新格式属堆功能 | A=导出只有 5 种静态格式；B=核心产物是「只读分析结果」，没有「学习过程数据」这一层 | **缓（F1 之后）** |
| F6 | **扩输入：EPUB / TXT / MD / 扫描 OCR / 音视频 / 网页 / YouTube** | 与「复习资料」部分相关 | SurfSense 格式表列 12+ 格式；Open Notebook「PDFs, videos, audio, web pages, Office docs」；PageLM「PDF, DOCX, Markdown, TXT」 | 音视频需转写链路、OCR 需视觉模型，范围膨胀；更轻替代「先补 EPUB/TXT/MD 三种纯文本」成本极低 | A=只支持 4 类；B=`core/extract.js` 的解析器集合是历史子集，非能力上限 | **否（本阶段）**，仅登记候选 |
| F7 | **实时评分 / AI 教师 / 播客 / 视频课堂 / 协作编辑** | **R 不过**：独立产品线，不是「导图内题目详情」 | OpenMAIC「real-time AI grading and feedback」「AI teachers and peers ... in real time」；NotebookLM Audio/Video Overviews；DeepTutor collaborative editing | 需要多智能体、TTS、实时通道、多用户权限；与本地单机定位冲突 | — | **否** |
| F8 | **给「效果好」找外部同口径基准，做数值横比** | 想要但做不到 | 第四节「未找到」：无任何竞品公布「一次 API 产出导图+完整题目详情」的质量指标；PageIndex 的 98.7% 是 QA 任务，口径不同不可比 | 硬凑会把不同任务的数字并列，属造假 | A=只有自定 9 项判据；B=**该形态本身没有行业基准**（见 best-practices 3.4） | **否（记为 KNOWN-LIMITATION）** |

## 二、明确不做（防止范围膨胀）

| 否决项 | 哪一关不过 |
|---|---|
| 把「一次 API」改成 RAG / 逐页 / 树索引多阶段 | R 不过：违背用户硬需求；PageIndex / AI-reads-books 的路线是对的，但不是这个产品的路线 |
| 节点编辑 / 拖拽 / 撤销栈 | R、N 不过：本产品是分析结果阅读器，不是导图编辑器；竞品里也只有 DeepTutor 的 Book 做可编辑块，成本极高 |
| 音视频解析、播客/讲义生成、多用户协作 | R 不过：独立产品线（OpenMAIC / Open Notebook / PageLM 各自的主战场） |
| 照抄竞品 star 数或 benchmark 数字做「我们更好」的论证 | C 不过：口径不同（QA 准确率 vs 结构化产出完整率），并列即误导 |

## 三、根因收敛（三句话）

1. **G1/G2/G3 是同一个选择的三面**，不是三个 bug：一次 API 决定了规模受上下文限制、
   无中途人工节点、页码只能模型自报。补法在**解析层与校验层**，不在「多调几次模型」。
2. **G4 是架构未闭合**，不是功能缺失：`core/` 只承载了「分析」，闭环还在 legacy store。
   这是与「唯一项目」目标最直接的距离，也是投入产出比最高的一项。
3. **G5/G6 是 G4 的下游**：没有学习过程数据，导出与分享就没有内容可带。

## 四、下一轮建议顺序（若用户点头）

```
F1（闭环进 core） → F2（页码锚定） → F3（结构化语料） → F5（导出/分享）
```

每项按 maxloop 走：baseline 判别测试必红 → 改动 → candidate 必绿 → 双形态真浏览器验收 →
独立评审 → 发版。F1 会动 `core/index.js` / `core/request.js` / `app/main.js` / `core.html`，
必须先定「两套 store 如何合并或迁移」，否则会砸坏已有书库，属需先确认边界的动作。

## 五、KNOWN-LIMITATION（本轮研究的边界）

- 竞品全部**未真机部署**，除 OpenMAIC Live Demo 站点可达外均为官方 README / 产品页描述（B/C 级）。
- NotebookLM 官方学生页直连失败，引用的是检索命中的官方页文本，未二次核验。
- PageIndex FinanceBench 98.7% 为官方自报，未复现。
- star 数为 2026-11-10 单次 API 快照，会随时间变化；聚合站数字的偏差是时间差，不是造假。
- 研究阶段（2026-11-10 上午）未改任何代码、未发版；研究文档落在 `PROCESS/research-competitor-e2e/`。

## 六、执行状态更新（2026-11-10 下午 · 用户「开始 maxloop 优化改进」）

用户采纳门槛原话：「确认竞品确定是合理的，比我们的合理就开始」。
裁决方式：不照单全收 —— 用我方源码行号与 v5 台账实证「竞品确实比我们合理」才采纳，
与本产品硬需求冲突的一律否决。

| 项 | 上一轮结论 | 本轮 |
|---|---|---|
| F2 页码 / 引用锚定 | 合 | **已执行**：`extract.segmentText()` + PDF `pagerender` 真页码 + `composeCorpus()` 规范语料 + `verifyQuotes()` 程序校验 + 前端锚点与引文核对徽章 |
| F3 结构化语料 | 合（有限） | **已执行**：按文件均分、跨文件均衡覆盖替掉 `raw.slice`；概览逐份如实显示取样字数；**未**改多阶段 |
| F1 闭环进 core | 合（最高优先） | **未动**：两套 store 合并需先定迁移边界，属不可逆动作，留下一轮 |
| F4 两阶段 / F6 扩输入 / F7 实时课堂 / F8 数值横比 | 否 | 维持否决，理由不变 |
| F5 导出 Anki / 分享 | 缓（依赖 F1） | 维持缓做 |

**执行证据**（详见 `iteration-log.md` 与 `CHANGELOG.md` 未发布段）：
- 判别测试 baseline `4 通过 / 13 失败 / exit 1` → candidate `32 / 0`（逐项输出见 `baseline-anchor-v3.txt`）；
- 真模型 `real-llm-v6.json`：15 题 / 6 类 / 九项判据全绿，思路 149 字，
  `source.anchor` 填写率 **15/15**、引文命中原文 **15/15**，158.0s；
- 双形态真浏览器 e2e **121/0**、`npm test` 19/19、`node --check` 73/73、版本 8 处 / 形态 18 处；
- 浅/深真截图目视核对通过。本轮**不发版、不升版本号**。

F1 仍是「与唯一项目目标最直接的距离」，本轮先做不砸坏数据、可独立验收的两块，
**不是把 F1 降级**；动手前需先定「两套 store 如何合并 / 已有书库是否迁移」的边界。
