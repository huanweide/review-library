# 阶段零 · 竞品级能力对照与融合决策（2026-11-07 深夜）

> 本文件是 maxloop 模式 A 阶段零产物。所有「基准」必须能逐字符在真实命令 / 检索输出里找到，不编造。

## 一、逐字符证据锚点

### 1.1 真实 GitHub 仓库（`gh api repos/<owner>/<repo>` 匿名只读，2026-11-07 实跑输出）

```
ankitects/anki                             32647★ | Anki is a smart spaced repetition flashcard program
open-spaced-repetition/fsrs4anki           4127★ | A modern Anki custom scheduling based on Free Spaced Repetition Scheduler algorithm
logseq/logseq                              45507★ | A privacy-first, open-source platform for knowledge management and collaboration.
siyuan-note/siyuan                         47119★ | An open-source, privacy-first, self-hosted knowledge workspace where humans and AI agents work together
TriliumNext/Trilium                        38732★ | Build your personal knowledge base with Trilium Notes
mochi-solutions/mochi                      {"message":"Not Found","status":"404"}
```

### 1.2 FSRS 官方 README 逐字引用（WebFetch `raw.githubusercontent.com/open-spaced-repetition/fsrs4anki/main/README.md`）

> "FSRS4Anki ... consists of two main parts: **the scheduler and the optimizer**."
> "The scheduler replaces Anki's built-in scheduler and **schedules the cards according to the FSRS algorithm**."
> "The optimizer **uses machine learning to learn your memory patterns** and finds parameters that best fit your review history."
> "If you are using Anki 23.10 or newer, refer to [the Anki manual] ... **FSRS is built in**."

→ 关键取舍：**scheduler 可离线自建；optimizer 需要成规模复习历史 + ML，单机新用户无数据，不做**。

### 1.3 竞品功能基准（检索输出逐字片段）

- `chunks.app/blog/best-spaced-repetition-apps-2026`：
  > "A genuine spaced repetition app has three traits: **Variable intervals** ... **Item-level scheduling** ... **Feedback signal** — you grade your recall on each review, and that grade feeds back into the next interval"
  > "Anki **SM-2 by default, FSRS available**"; "Mochi **FSRS**"; "RemNote **SM-2 with custom adjustments**"
- `examo.ai/blog/best-active-recall-apps`：
  > "An app does three jobs for this method: **Prompts retrieval** ... **Gives feedback** ... **Spaces the practice**."
  > "**Feedback quality.** Does the app only mark right or wrong, or does it explain the reasoning?"
  > "**Review any AI-generated card before you trust it. Errors are cheaper to fix before you memorize them.**"
- `longtermemory.com/b/anki-vs-remnote`：
  > "RemNote adds an **exam scheduler**: you set an exam date and RemNote plans reviews around it"
  > "RemNote has a built-in **PDF reader**: you highlight a passage, write a card next to it"
  > "Notes ... **Full editor, backlinks, references, PDF reader**"
- `editorialge.com/best-flashcard-apps-for-spaced-repetition/`：
  > "Traverse combines **mind maps, connected notes and spaced-repetition cards**. Learners can first see how ideas relate and then memorize the details"
  > "Mochi: **Best Minimalist and Offline-First Option** ... The free version works **offline, does not require an account** and allows unlimited cards, decks, **imports and exports**."
- 中文功能侧 `m.crsky.com/mip/soft/1130921.html`：
  > "**AI思维导图生成**、**智能挖空训练**、**多题型出题测试**（错因标签系统）、**个性化学习计划**（艾宾浩斯遗忘曲线）"
  > "**数据可视化分析**：定期生成学习报告，展示背诵进度、题型正确率变化及薄弱词汇分布"

### 1.4 功能基准归纳（7 类，竞品普遍具备）

| 编号 | 基准能力 | 证据来源 |
|---|---|---|
| B1 | 逐项间隔重复排程 + 四档反馈（Again/Hard/Good/Easy） | chunks.app 三特征、Anki FSRS、Quizlet 四档 |
| B2 | 主动回忆：cloze 挖空、先答后揭示、揭示后自评 | examo.ai、editorialge（cloze）、中文挖空训练 |
| B3 | 知识关联：双向链接 / 知识图谱 / 思维导图 | Logseq、SiYuan、Trilium、Traverse、中文 AI 思维导图 |
| B4 | 全局全文搜索 | SiYuan / Trilium / Logseq 全局搜索 |
| B5 | 学习分析：正确率趋势、进度、薄弱分布、复习热力图 | Anki Review Heatmap、中文学习报告、studyglen Review Analytics |
| B6 | 数据可携带：导出 / 导入 / 备份 | Mochi imports and exports、Anki `.apkg` |
| B7 | 考试日期驱动排程 / PDF 批注高亮 | RemNote exam scheduler / PDF reader |

## 二、三项对照表：基准有什么 / 我们有什么 / 我们缺什么

| 基准 | 竞品形态 | 我们现状（逐字符锚点） | 缺什么 |
|---|---|---|---|
| B1 排程 | FSRS/SM-2 逐卡 stability / difficulty / dueAt，四档评分回写 | `lib/study.js:754` `const LEITNER = [0, 0, 1, 3, 7, 16, 35];`；`lib/store.js:430-431` `if (g.verdict === '正确') r.box = Math.min((r.box||1)+1,6); else r.box = 1;`；`lib/store.js:393` 注释自认「不采用 Anki 的四态卡机」 | **四档反馈、逐项状态量、动态间隔**；间隔是常量查表，且只由自动批改的二值驱动 |
| B2 主动回忆 | cloze 卡、先答后揭示、揭示后自评 | `renderer/js/exam-ui.js:41-63` 交卷前不显答案；`lib/study.js:266` 唯一"挖空"是题干里一次 `replace(key,'____')` | **逐卡 cloze、揭示后四档自评** |
| B3 知识关联 | 双向链接、图谱节点与边、可交互思维导图 | `renderer/js/study-ui.js:248` 注释「知识点图谱：按类别聚合」；`:253` `<div class="cat-map" id="cat-map">` 纯文本分组 | **真节点/连线/交互**；M2 用户原话「某一类知识点的思维导图」未实现 |
| B4 全文搜索 | 跨库全文、块级定位 | `renderer/js/book.js:122-125` 只匹配 `name / tags / prompt`；`server.js` 无 `/api/search` | **跨书 / 正文 / 知识点 / 题目 / 错题** 全都没有 |
| B5 学习分析 | 趋势线、热力图、分布图 | `renderer/js/weak-ui.js:22-26` 三个静态数字；`lib/study.js:770-774` 返回体仅 `items/leechCount/dueCount` | **趋势 / 时间分布 / 薄弱演化 / 图表** |
| B6 数据可携带 | 导入导出备份 | `server.js:35-173`、`app/main.js:28-137`、`app/preload.js:4-49` 全无 export/import/backup | **整库导出导入**；反馈五问还只写 `localStorage`（`renderer/js/exam-ui.js:165`） |
| B7 考试日期 / PDF 批注 | exam scheduler / PDF 高亮写卡 | 全目录 grep `examDate\|deadline\|annotat` 零命中 | 缺，但见 G1/G2 打回理由 |

## 三、融合决策表（每项过 R / C / N + 根因段 B）

| 项 | 融合内容 | R 合理性 | C 正确性（锚点） | N 必要性 | 结论 |
|---|---|---|---|---|---|
| **F1** | 逐项 SRS：四档自评 → stability/difficulty/dueAt 落盘，替代固定 `LEITNER` 表 | 与「批改→巩固」闭环直接一致；代码注释已自认走该方向 | chunks.app「Variable intervals / Item-level scheduling / Feedback signal」＋ FSRS4Anki README「schedules the cards according to the FSRS algorithm」 | **非加不可**：四档是「评分→排程」唯一人工输入，缺它只能靠自动二值 | ✅ 采纳（**不做 ML 权重拟合**） |
| **F2** | 全局全文搜索（跨书 / 正文 / 知识点 / 题目 / 错题，结果可跳转） | 「图书馆」定位的自然能力，数据已全落盘 | SiYuan 47,119★ / Trilium 38,732★ / Logseq 45,507★ 全局搜索；`lib/store.js:151` 正文 `extractedText` 已落盘却无消费者 | **非加不可**：找不到材料归属，分析与复习无法被主动定位 | ✅ 采纳 |
| **F3** | 知识点思维导图：本地 SVG 节点+边+交互，替换名不副实的文本 `#cat-map`，保留文本视图降级 | **用户 M2 原话明确要求**；README:65 曾主动打回，按本轮「竞品一切更强价值」重估 | Logseq 双向链接 / Traverse mind maps / 中文 AI 思维导图；`renderer/js/study-ui.js:248` 现状是纯文本 | **非加不可**：当前「图谱」名不副实属半成品 | ✅ 采纳（纯本地 SVG，零外部库、零外链） |
| **F4** | 学习报告：正确率趋势、每日复习量、薄弱演化、复习热力图（本地 SVG） | 离线数据已在 `mistakes.history` / `exams.grading` | Anki Review Heatmap（FSRS4Anki README 兼容表逐字列出）、studyglen「Review Analytics Yes」、中文「题型正确率变化」 | **非加不可**：否则「进步不可见」、复习计划无依据 | ✅ 采纳 |
| **F5** | 整库导出 / 导入 / 备份（单文件 JSON，含资料字节），反馈五问一并落盘 | 「数据只在本地、无云同步」→ 出口是安全底线 | Mochi「offline ... allows unlimited cards, decks, **imports and exports**」；Anki `.apkg` | **非加不可**：换电脑/清缓存即全丢 | ✅ 采纳（导入前校验 + 明确覆盖确认） |
| **F6** | 主动回忆 cloze：从知识点原文生成挖空卡，先自答再揭示，揭示后四档自评（与 F1 共用评分通道） | 与「先答后看」现有设计一致 | examo.ai「Prompts retrieval / Gives feedback」；editorialge「Basic, Cloze」；中文「智能挖空训练」 | **非加不可**：竞品普遍具备，且是四档评分的天然载体 | ✅ 采纳（复用 F1 的 `ratings` 通道，不另起炉灶） |
| **B1 修复** | 同一套卷重复交卷幂等 | 缺陷非取舍 | critic 真实探针：`第1次 lapseCount=1 … 第3次 lapseCount=3`、`leechCount= 2`（真实只作答 1 次） | 非修不可 | ✅ 修复 |
| **B2 修复** | 共享 `library/` 多进程写：临时文件 + 原子 rename + 进程间锁 | 与 README:24「四种模式共用同一套落盘逻辑」冲突 | critic 双服务探针：`POST 成功数= 12 /12` → `index.json 实际本数= 10`（B0/B1 消失，API 却返回成功） | 非修不可（P0 静默数据丢失） | ✅ 修复 |

### 根因段 B（A 出错点 ≠ B 根因，两者同修）

- **功能缺口的根因不是「没想到」，是两处设计约定**：① `README.md:65` 把 Obsidian 双链 / md 体系**整体打回**，连「知识点可视化」一起误伤；② `lib/store.js:393` 注释把「轻量」写成**拒绝任何逐项状态量**，导致排程停在常量查表。
  → 只补 UI 不改这两处约定，下次评审还会以「保持轻量」为由删回去；本轮同步修订 README 的功能边界说明。
- **B1 缺陷的根因**：`lib/study.js:687` `exam.grading = grading;` 把「批改」建模成**可覆盖的字段**而非一次性事件；`lib/store.js:427` `r.history.push(...)` 把「一次交卷」当成「一次真实复习」。A 段修按钮不解决重放，必须把幂等做在数据入口。
- **B2 缺陷的根因**：`lib/store.js:40-44` 把共享单文件 JSON 当成「单进程内存对象」做 read-modify-write，`server.js:15` 每进程独立 `new Store(ROOT)` 且无协调。A 段修某一次写不解决，必须改写入范式（原子 rename）+ 跨进程互斥。

## 四、打回清单（G：R/C/N 不过，明确不做）

| 项 | 打回理由 |
|---|---|
| G1 FSRS optimizer（ML 权重拟合） | **N 不过**：FSRS4Anki README 逐字说明 optimizer「uses machine learning to learn your memory patterns ... fit your review history」，单机新用户无历史；Anki 23.10+ 才内置。我们用默认参数的可解释 scheduler，不假装做了拟合。 |
| G2 考试日期驱动排程 | **N 不过**：现有 due 队列已实现「在忘记前复习」，加考试日期只改排序权重，收益小、要多一套日期 UI；列为 KNOWN-LIMITATION。 |
| G3 PDF 批注 / 高亮写卡 | **N 不过**：要重写预览渲染层与坐标落盘，偏「笔记工具」而非「资料→题目」；本轮先把已落盘的 `extractedText` 用起来（F2/F6）。 |
| G4 云同步 / 多端 / 账号 | **R 冲突**：与「零云端、离线优先」定位直接对立。 |
| G5 Obsidian 式 md 双链文件体系 | **R 冲突**：README:65 已论证。F3 做的是**分析结果内的知识点关系图**，不改落盘格式、不引入 md 文件体系。 |

## 五、未找到 / 诚实边界

- `mochi-solutions/mochi` 仓库 404，Mochi 的能力只来自二手评测（`editorialge.com` / `chunks.app`），**不作为 GitHub 锚点**。
- 未找到「离线单机、零外部依赖、可直接抄用的 FSRS JS 实现」的本机副本；F1 按 FSRS 三状态量（stability / difficulty / retrievability）自行实现可解释简版，不冒称等价官方 FSRS。
- 竞品价格 / 平台信息来自 2026 年评测页，可能变动；本轮只采纳**功能形态**，不引用价格做结论。
- 未找到本项目里任何「全局搜索 / 思维导图 / 导出」的半成品实现（critic 全目录 grep 零命中），属于真缺口而非没接线的死代码。
