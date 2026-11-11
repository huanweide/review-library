---
title: 学习闭环进统一核心 · 阶段零外部基准对照
date: 2026-11-11
tags: [maxloop, 阶段零, 学习闭环, active-recall, SRS, 对照表]
source: GitHub REST API 仓库元数据（2026-11-11 快照）+ 检索命中的产品页/方法论文章 + 本机 research-学习闭环/best-practices.md + research-competitor-e2e/fusion-decisions.md
---

# 阶段零 · 学习闭环进 core（功能端）

检索日期：2026-11-11。主题：默认入口 `core.html` 只有「看分析结果」，没有「练 / 测 / 记」。
方法：maxloop 信息优先铁律——至少三组查询、star 走 GitHub REST API 取真值、逐字符锚点、
落「基准有什么 / 我们有什么 / 缺什么」对照表，再动手。

---

## 一、三组查询（不搜用户口头关键词，搜完整形态）

| 组 | 查询 | 拿到的东西 |
|---|---|---|
| 中文功能侧 | 复习备考 App 完整功能清单 练习 错题本 间隔重复 自测 学习闭环 PRD | Study Buddy / 知溯 / 备考小助手 / 错题plus / Exam Scholars 的完整功能清单 |
| GitHub 开源实现 | open source spaced repetition flashcard app features Anki FSRS self-quiz active recall | Anki / FSRS / ts-fsrs / repeater / Engram 的算法与产品形态 |
| 英文 best practice | spaced repetition learning app feature architecture best practice active recall quiz FSRS 2026 | 「好 SRS」的科学要求清单（含文献锚点） |
| 本机知识库（第三类外查） | `PROCESS/research-学习闭环/best-practices.md`、`research-competitor-e2e/fusion-decisions.md` | 上一轮已打好的 M1/M2/M3 地基 + F1 决策记录 |

## 二、star 真值（GitHub REST API，2026-11-11 快照）

**核真值的理由**：检索结果里 `tycp.xyz` 写「Anki 29.2k★」、本机 11-06 研究写「32.2k★」，
两个都不是当前值。按 maxloop 证据纪律，star 一律 API 取真值，不采信聚合站/旧快照。

| 仓库 | API `stargazers_count` | 语言 / 许可 | 用途 |
|---|---|---|---|
| `ankitects/anki` | **32728** | Rust / AGPL 系 | 事实标准：per-item lapse、leech、自评分 |
| `open-spaced-repetition/ts-fsrs` | **863** | TypeScript / MIT | FSRS 官方 TS 实现 |
| `open-spaced-repetition/free-spaced-repetition-scheduler` | **734** | — / MIT | DSR 模型原论文仓 |
| `shaankhosla/repeater` | **441** | Rust / Apache-2.0 | 「笔记即卡源」+ 内容哈希身份 + FSRS |
| `bestnite/engram` | **45** | Go / AGPL | 2026-10 新项目，10 种题型自动判分 + REST API |

> Engram 只有 45★且创建于 2026-10-03，**不作为「高 star 权威」使用**，只作为「10 种题型自动判分」
> 这一形态的当期参考，标 C 级。其余 4 个为真实高 star / 官方实现，标 A/B 级。

## 三、逐字符锚点

### A. 功能完整形态（中文产品页，B 级：宣传描述，未实测）

[A1] 知溯（chanpinyuan.cn/news/120.html）原文：
> "整合知识图谱、闪卡复习、智能测评、背书模式、错题本和学习数据等功能，帮助用户高效完成"学-练-记-测"全流程。"

[A2] Study Buddy（Microsoft Store 产品页）原文：
> "每张卡片只需回答「想起了」或「忘了」，系统按 SM-2 算法自动调整熟悉度与下次复习间隔"
> "答错或半对的题目自动进错题本，按记忆曲线(1 / 2 / 4 / 7 / 15 / 30 天)安排复习，连过六关即毕业"

[A3] 备考小助手（App Store）原文：
> "作答后即时批改并展示解析，做错的题自动进入错题本。"

[A4] Exam Scholars（功能清单）原文：
> "08 Submitted exam review — See your overall result, subject breakdowns, selected answers and explanations."
> "09 Smart post-exam review — Focus review on incorrect, unattempted, slow or missed-mark questions"

### B. 科学要求（英文方法论，B 级：文章立论带文献表）

[B1] mindomax.com《What Makes a Good Spaced Repetition App》原文：
> "Active recall enforcement where the answer is hidden by default and grading happens after attempted retrieval. **Immediate corrective feedback**."
> "It forces you to retrieve, not to recognize."

[B2] 同文关键判据表（逐字）：
> "Active recall | 61% vs 40% retention at one week | Roediger & Karpicke (2006)"
> "Adaptive algorithm | 20-30% fewer reviews at same retention | Ye et al. (2022), KDD"

[B3] activerecalling.com 原文：
> "It makes you answer before you flip. The app can't force this, but good ones make it easy to type or say an answer first."
> "A genuine spaced repetition app has three traits: **Variable intervals** / **Item-level scheduling** / **Feedback signal**"

[B4] chunks.app 原文（三判据）：
> "The scheduling column is the one that matters most: it tells you whether the app adjusts each item's interval to how well you remembered it, or only repeats on a fixed timetable."
> "Apps that just send a daily push notification are not spaced repetition apps in this sense. **They are reminder apps with marketing copy.**"

### C. 开源实现形态（A/B 级）

[C1] Anki 官方仓库 API description（逐字）：
> "Anki is a smart spaced repetition flashcard program"

[C2] `shaankhosla/repeater` README（经 linuxlinks 转述，逐字）：
> "Cards are hashed with Blake3; modifying the text produces a new hash and resets that card's performance history."
> —— **内容即身份**：题面变了，复习进度自动作废，不背着旧历史。

[C3] `bestnite/engram` README（逐字）：
> "Interactive Answer Controls: Beyond self-rating, Engram supports built-in interactive question types: text input, numeric, single choice, multiple choice, true/false, ordered list, cloze fill-in-the-blank, and short answer with instant automated grading."

[C4] 本机 `research-学习闭环/best-practices.md` 第 80–82 行（2026-11-06 已定地基）：
> "M1 错题本：照搬 Anki 的"per-item lapse 追踪 + leech 上浮"思想，但砍掉它的多状态卡机"
> "M2 间隔重复：…砍掉 FSRS 的权重拟合优化器…改用 Leitner/SM-2 式的轻量盒子"
> → **本轮沿用这套既有决策，不重新选型、不引入 ts-fsrs 依赖。**

### D. 我方源码锚点（A 级，逐字符）

[D1] `renderer/js/core-ui.js:456`：
> `$('#qdAnswer').textContent = q.answer || '（模型未给出答案）';`

[D2] `renderer/core.html:173-174`：
> `<div class="qd-label">答案</div>` / `<div id="qdAnswer" class="qd-answer"></div>`

[D3] `core/index.js:23-26, 75`：`createBook/listBooks/getBook/deleteBook` … `getAnalysis(id)` —— 门面 9 方法，止于「分析」。

[D4] `core/request.js:75-82`：路由只有 `analyze` 与 `analysis`，无 practice 类。

[D5] `core/bookStore.js:9-13` 落盘结构注释：
> `library/books/<id>/book.json` / `analysis.json` / `files/` —— **没有学习过程数据这一层**。

[D6] `PROCESS/research-competitor-e2e/fusion-decisions.md:18` F1 行：
> "A=`core.html` 缺入口；B=**canonical 只定义了「分析」这一半产品，学习闭环没进入统一核心**，不是 UI 少个按钮"

---

## 四、功能基准（两份，动手前必须齐）

### 基准一：功能清单（学 → 练 → 测 → 记 → 复盘 → 导出）

1. **看**：导入资料 → 整体分析 → 导图 / 题型索引 / 题目详情
2. **练**：题目详情**答案默认隐藏**，先作答后揭晓；支持选择/判断/开放题输入
3. **测**：提交后即时判分 + 展示解析与错因（Anki「Immediate corrective feedback」）
4. **记**：答错自动进错题本，按 per-item 间隔排下次复习；四档自评可重排
5. **复盘**：今日到期队列（只捞到期的）、成绩留档、leech（反复错）上浮
6. **导出**：过程数据可导出、算法可审计（不锁死在应用里）

### 基准二：页面结构（竞品普遍 5 视图）

```
书架 → 书详情(资料 | 分析 | 练习 | 复习 | 统计) → 题目详情(答案隐藏 / 先答后揭)
```

### 对照表：基准有什么 / 我们有什么 / 缺什么

| 环节 | 竞品基准 | 我们 `core.html`（默认入口） | 我们 `index.html`（旧入口，绑死旧 store） | 缺口 |
|---|---|---|---|---|
| 看 | 导图 + 题型 + 详情 | **有**（且更强：SVG 3 布局 + 三级下钻） | 部分有 | — |
| 练 | 答案默认隐藏、先答后揭 | **没有**，[D1] 答案直接摊开 | 有 | **P0** |
| 测 | 即时判分 + 解析 | **没有** | 有（gradeExam） | **P0** |
| 记 | 错题自动归集 + per-item 排程 | **没有**（core 无过程数据层，[D5]） | 有（M1/M2） | **P0** |
| 复盘 | 今日到期队列 + leech | **没有** | 有（reviewExam） | **P1** |
| 导出 | 5 种静态格式 + 过程数据 | 5 种静态格式（JSON/SVG/PNG/MD/OPML），**无过程数据** | 部分有 | P1 |

**结论句式（铁律要求）**：搜了中文功能清单 / GitHub 开源 SRS 实现 / 英文 best practice 三组，
功能基准是「看·练·测·记·复盘·导出」六环 + 五视图结构，我们缺「练·测·记·复盘」四环，
所以这次加的是**默认入口 core.html 的最小学习闭环（先答后揭 → 判分 → 落盘 → 到期复习）**，
数据落在 core 书库自己的目录、零迁移。

## 五、R/C/N 融合决策表

| 候选 | R 合理性 | C 正确性（锚点） | N 必要性 / 更轻替代 | 结论 |
|---|---|---|---|---|
| **G1 答案默认隐藏 + 先答后揭 + 即时判分** | 与「复习工具」定位一致，且是差异化（题目带原图/分步解答/锚点）的落点 | [B1][B2][B3]；我方 [D1] 反例 | 更轻替代「只把答案折叠成 details 标签」→ 仍无判分、无过程数据，兑不了闭环 → 否决 | **合** |
| **G2 复用本机既有 Leitner 盒子 + lapse/leech，不引 FSRS/ts-fsrs 依赖** | 与上一轮地基一致，保持零云零依赖 | [C4] 本机第 80–82 行；[B4] 三判据 | 上 FSRS 需大量复习日志拟合权重，起步数据为空收益为负；本机研究已否决 → 不重开 | **合** |
| **G3 新增独立 `practice.json`，不合并旧 store、不迁移已有书库** | 符合「统一核心」架构：把闭环**接进 core** 而非搬旧 store | [D3][D4][D5]；`core/request.js` 是四形态共用 canonical 分派 | 更轻替代「core.html 加按钮跳旧窗口」→ 遮丑、两套 store 仍分裂，F1 已否决；合并两套 store → 砸数据、不可逆 → 均否决 | **合** |
| **G4 内容哈希身份（题面变→复习史作废）** | 与 repeater 的 Blake3 思路一致 | [C2] | 更轻替代「用题目 id」→ 重新分析后同一题换 id，历史静默错位或丢失。用题面+答案的稳定哈希更轻且正确 | **合（小）** |
| G5 10 种题型全自动判分 | R 不过：分析结果只有选择/判断/开放三类 | [C3] 是 Engram（45★，新项目）的产品形态，非本产品数据契约 | 为不存在的题型写判分器＝堆功能 | **否** |
| G6 多设备同步 / 账号 / 云 | R 不过：本地离线零云铁律 | 中文产品页多为云端 App | — | **否** |
| G7 番茄钟 / 成就徽章 / 学习热力图 | R、N 不过：与「资料→导图→题目」主线无关 | [A2] 但属独立产品线 | 能不加就不加 | **否** |
| G8 应用内手动深浅主题开关 | **不属于功能端**（美化端遗留），且上轮明确列为边界 | CHANGELOG KNOWN-LIMITATION | 别混进本轮范围 | **否（本轮）** |

## 六、未找到 / 诚实边界

- **没有任何竞品把「一次 API 整本分析 → 导图三级下钻 → 题目详情」与「作答闭环」做在同一张导图里**（延续 11-10 横向对比结论）。因此本轮没有「照抄某家」的完整模板，只有**各环节的最优做法**可融合。
- 竞品产品页（中文 4 家、英文 3 篇）均为 **B 级证据：官方宣传描述，未真机实测**。star 数为 A 级（API 快照），论文本身未逐篇读原文，只采信文章给出的引用表。
- Engram 45★、创建 2026-10-03，**不是高 star 权威**，仅作当期形态参考。
- `repeater` 的 Blake3 身份是**转述**（linuxlinks / softono 两个二手页一致），未直接读其 Rust 源码；采纳的是「内容即身份」这一思想，不是它的实现。
- 本文件是**阶段零研究**，不含实现；真缺陷清单以独立 critic 报告 + Chair 核销为准。
