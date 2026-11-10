---
title: 高 star 竞品端到端效果 · 阶段零外部基准对照表
date: 2026-11-10
tags: [maxloop, 阶段零, 竞品, 端到端, star-verified, one-shot-api]
source: GitHub REST API 真实 star（2026-11-10 取数）；各项目官方 README 逐字符引文；NotebookLM 官方学生页；rlbuild v1.4.0 源码逐行核销
---

# 阶段零：高 star 竞品的端到端效果（2026-11-10）

对照对象 = `rlbuild v1.4.0`（已发布）：导入 PDF/PPT/Word/图片 → 建书 → 一次 API 整本整体分析
→ 交互式 SVG 导图 + 题型树三级下钻 + 题目详情 → 导出 MD/OPML/SVG/PNG/JSON。

## 零、判据与证据级（先立尺子）

**端到端四段**：① 输入宽度（格式/体量/多源）② 处理深度（整本整体 vs 分块/树索引/RAG）
③ 产出形态（导图/题目/解答/复习闭环）④ 可交付性（导出/分享/跨端/回溯原文）。

**证据级**：A = 真跑或官方可验 demo 产物；B = 官方 README / 产品页明确描述（宣传，未实测）；
C = 第三方评测或推断。**本轮没有部署任何竞品，除 OpenMAIC demo 站点可达外，全部为 B/C，不冒充 A。**

## 一、搜了什么（三组，逐字符锚点）

| # | 组 | 关键词 | 拿到什么 |
|---|---|---|---|
| 1 | 中文功能侧 | 「开源 替代 NotebookLM 上传 PDF 思维导图 题目 闪卡 端到端」 | 找到 `OpenDCAI/opennotebookLM`（API 404，仓库不存在/改名）、`CaviraOSS/PageLM`、`tom1030507/OpenNotebookLM` |
| 2 | GitHub 开源实现 | 「GitHub 高 star AI PDF 生成思维导图 题库 学习套件」 | 找到 `ttang1024/AI_Study_Platform`、`Ashut90/pdf-tutor`、`helixnow/deep-student` |
| 3 | 英文 best practice | 「best open source NotebookLM alternative 2026 mind map flashcards quiz」 | 找到 `lfnovo/open-notebook`、`MODSetter/SurfSense`、`VectifyAI/PageIndex`、`HKUDS/DeepTutor`、`THU-MAIC/OpenMAIC` |

**反幻觉战果**（逐字符可复核）：
- 搜索结果里的 `github.org/000haoji/deep-student` 是镜像域名，GitHub API 返回真实 `full_name: "helixnow/deep-student"`（309 star）。
- `github.es/Lucky-Dog07/AI.exam.helper`、`ghub.com/Huangdingcheng/Open-NotebookLM`、`onlybits.org/...` 均为非官方镜像，未采信。
- `OpenDCAI/opennotebookLM` 在 README 里被写作 clone 地址，API 返回 **404 Not Found**。
- 聚合站写的 star 数（OpenMAIC 42,941 / Open-Notebook 41,749 / PageIndex 40,176 / SurfSense 16,804）
  与 API 真值差 60~150，是**抓取时间差，不是造假**；此处订正我检索过程中的过早判断。
- 第一轮把 16 star（`AI_Study_Platform`）、2 star（`pdf-tutor`）当「竞品」，已剔除出高 star 表。

## 二、star 真值表（GitHub REST API，2026-11-10）

| 项目 | star | 最近 push | 许可证 | 定位 |
|---|---:|---|---|---|
| `langgenius/dify` | 160,813 | 2026-11-10 | — | 通用 Agent/RAG 平台（能力层，需自搭链） |
| `open-webui/open-webui` | 158,273 | 2026-11-10 | — | 通用 AI 前端（能力层） |
| `jgraph/drawio` | 9,283 | 2026-11-04 | — | 通用绘图（组件层） |
| `opendatalab/MinerU` | 83,415 | 2026-11-09 | NOASSERTION | PDF/Office → LLM-ready 结构化（解析层） |
| `lobehub/lobe-chat` | 84,686 | 2026-11-10 | — | 通用 AI 工作台 |
| `docling-project/docling` | 70,354 | 2026-11-10 | — | 文档解析（解析层） |
| `Mintplex-Labs/anything-llm` | 68,132 | 2026-11-09 | MIT | 文档工作区，带引用、多用户 |
| **`HKUDS/DeepTutor`** | **57,773** | 2026-11-07 | Apache-2.0 | **端到端学习工作台（最像我们）** |
| `CherryHQ/cherry-studio` | 53,389 | 2026-11-10 | — | 桌面 AI 工作台 |
| **`THU-MAIC/OpenMAIC`** | **43,189** | — | MIT | **主题/资料 → 完整互动课堂** |
| **`lfnovo/open-notebook`** | **41,811** | 2026-11-08 | MIT | 自托管 NotebookLM |
| **`VectifyAI/PageIndex`** | **40,329** | 2026-11-10 | MIT | 无向量树索引 RAG |
| `quivrhq/quivr` | 39,644 | 2026-11-09 | — | 第二大脑 RAG |
| `chatchat-space/Langchain-Chatchat` | 38,712 | 2025-11-10 | — | 本地知识库问答（一年未更新） |
| `khoj-ai/khoj` | 38,096 | 2026-08-02 | — | 第二大脑 |
| `ankitects/anki` | 32,704 | 2026-11-10 | NOASSERTION | 间隔复习（闭环层） |
| `Cinnamon/kotaemon` | 25,899 | 2026-07-14 | Apache-2.0 | 文档 QA + 高亮 PDF 引用 |
| **`MODSetter/SurfSense`** | **16,824** | 2026-11-10 | Apache-2.0 | 离线桌面笔记本，含导图/闪卡/测验 |
| `markmap/markmap` | 13,230 | 2026-11-10 | MIT | Markdown → 交互式 SVG（渲染层） |
| `wanglin2/mind-map` | 12,927 | 2026-08-02 | — | 导图编辑器（渲染层） |
| `echohive42/AI-reads-books-page-by-page` | 3,433 | 2026-10-30 | MIT | 逐页读整本书 |
| `SSShooter/mind-elixir-core` | 3,198 | 2026-11-04 | MIT | 导图内核 |
| `CaviraOSS/PageLM` | 2,065 | 2026-11-04 | NOASSERTION | PDF → 测验/闪卡/笔记/播客 |
| `helixnow/deep-student` | 309 | 2026-11-02 | AGPL-3.0 | 中文 Study Desktop，agent 自动产出全套 |
| `tom1030507/OpenNotebookLM` | 123 | 2026-11-10 | MIT | 自托管 NotebookLM（功能描述最全，star 低） |
| `ttang1024/AI_Study_Platform` | 16 | 2026-10-28 | — | 学习套件（形态像，star 太低，剔除） |
| `Ashut90/pdf-tutor` | 2 | 2026-06-09 | MIT | PDF → VARK/导图/Anki（剔除） |

闭源形态标杆（无 star，不参与排名）：**Google NotebookLM / Gemini Notebook**。

## 三、端到端四段对照（基准有什么 / 我们有什么 / 缺什么）

### 3.1 逐项目链路（逐字符引文）

| 项目 | 输入 → 处理 → 产出 → 交付 | 证据级 |
|---|---|---|
| **NotebookLM** | 「Upload PDFs, websites, YouTube videos, audio files, Google Docs, Google Slides」→「summarize them and make interesting connections between topics」→「Create an auto-generated mind map detailing all the connections across your sources」/「Create personalized quizzes from your sources, with detailed explanations for incorrect answers」/ Flashcards、Slide Decks、Audio/Video Overviews、Study Guide →「provides clear citations for its work, showing you the exact quotes from your sources」 | B（官方学生页） |
| **DeepTutor** 57.8k | 多源建 KB，解析可选「MinerU, Docling, Tika, markitdown, PyMuPDF4LLM」；检索可选「LlamaIndex / PageIndex / GraphRAG / LightRAG」→「the creation flow proposes a chapter outline before content is generated, so you review the shape instead of accepting a blind one-shot output」→「Each chapter compiles into editable typed blocks — text, callouts, quizzes, flash cards, timelines, code, figures, interactive HTML, animations, concept graphs, deep dives, and user notes」→「Immersive Reading: a document open beside the thread, cited page by page」→ Question Bank + Practice（「Answers, mistakes, recall ratings, and the next review date」）→ 导出「Markdown / Word / Anki / .ics」，共享「shared Books with private learning state」 | B（README 含大量截图；有 Windows 安装包，本轮未跑） |
| **OpenMAIC** 43.2k | 「Describe a topic or attach your materials」→ 两阶段「Outline: AI analyzes your input and generates a structured lesson outline」→「Scenes: Each outline item becomes a rich scene — slides, quizzes, interactive modules, or PBL activities」→「AI teachers and peers lecture, discuss, and interact with you in real time」+「Interactive quizzes ... with real-time AI grading and feedback」→ 导出「.pptx / offline .html / classroom ZIP / Resource Pack / MP4」；Deep Interactive Mode 的 Five Types of Interactive UI 含「🧭 Mind Map」 | A-（Live Demo `open.maic.chat` 可达，页面显示 v1.4.0 更新日志与知识库/PBL/导出能力）+ B（README） |
| **Open Notebook** 41.8k | 「PDFs, videos, audio, web pages, Office docs」→「Full-text and vector search across all your content」→「AI-Assisted Notes」「Professional Podcast Generation」「Citations: Get answers with proper source citations」→ REST API / MCP；README 明确「new output formats ... are directions, not dated promises」 | B。**链路断在「学习产物」：README 无思维导图、无题目/闪卡** |
| **PageIndex** 40.3k | 长 PDF →「generate a tree-structure index for each document」→「agentically search that tree with LLM reasoning」→「traceable to explicit references」「Page-level citations」（Cloud 为 Block-level）→ FinanceBench「98.7% accuracy」；成本证据「at 805 pages the document no longer fits in the context window at all」 | B（官方 benchmark，本轮未复现）。**只做检索，不生成导图/题目** |
| **SurfSense** 16.8k | 12+ 格式（PDF/Word/Excel/PPT/CSV/图片/MD/HTML/EPUB/MOBI/录音/播客）→「Research (cited answers)」+「Edits, conversions and PDF tools always make a new file; your original is never changed」→ 格式表明确「**Mind maps, flashcards, quizzes** — ✓ in the app」→ 完全离线「The index stays on your disk ... and there is no account」 | B（README 格式表） |
| **AI-reads-books** 3.4k | 「Give it a book, and an AI reads it the way you would study one: one page at a time」→「Every page is its own model call」「the model only ever sees the page in front of it plus the reader's own notes」→ 每页带页码笔记写 `*_knowledge.json`，「Every 20 pages it stops and writes down what it understands so far」，末页「pulls the whole book together into one final summary」→ 可中断续读 | B |
| **PageLM** 2.1k | PDF/DOCX/Markdown/TXT →「Quizzes – Create interactive quizzes with hints, explanations, and scoring」/「Flashcards ... for spaced repetition」/ Cornell SmartNotes / AI Podcast /「ExamLab - Simulate any exam, get feedback」→ WebSocket 流式、JSON 或向量库 | B。**README 无思维导图** |
| **deep-student** 309 | 一句话 →「The agent opens the right app and produces the notes, mind maps, questions, cards and review plan」→「answers cite the page, sentence or mind-map node they came from」→ FSRS/Anki/APKG | B/C（README 描述，star 低，未实测） |

### 3.2 我们 v1.4.0 的真实链路（源码核销，不靠印象）

- 输入：`core/extract.js` 支持 PDF/PPTX/DOCX/图片；纯图片书 `NEEDS_VISION` 明确报错。
- 处理：`core/analyze.js` `MAX_CORPUS = 50000`，超出**截断并标 `truncated` / `sourceLen`**；一次 `chat` 产出单 JSON。
- 产出：`analysis.json` 含 `tree` + `questionIndex[].items[].questions[]`（题干/选项/答案/分步解答/思路/易错点/难度/来源）。
- 交付：MD/OPML/SVG/PNG/JSON；`GET /books/:id/files/:fid/raw` 回读图片型原图。
- **架构断点（本轮最重发现）**：`app/main.js:38` 有 `new Core(DATA_DIR)` 与 `core:request`（:42），
  但 `:54–:147` 一整套 `books:* / study:* / mindmap:* / review:* / feedback:*` 仍走旧 `store`
  （`lib/store.js`）。`app/main.js:215` 默认窗口是 `core.html`，`renderer/core.html`
  Grep `exam|review|答题|复习|出题|批改|quiz|grade|做题` **零命中**；
  `core/index.js` 只有 9 个方法（建书/文件/分析/回读），`core/request.js` 无 study/review 路由。
  → **出题→作答→批改→错题→间隔复习的完整闭环在 legacy `index.html`（另一套 store），
  默认入口够不到；DSH/专家形态只 require `core/index.js`，也够不到。**
  这与「只有一个统一项目、所有形态共用 core/」的目标尚有距离，属架构级未闭合，不是功能缺失。

### 3.3 「我们缺什么」（按链路顺序，不按功能清单）

| # | 断点 | 竞品做到的 | 我们现状 | 严重度 |
|---|---|---|---|---|
| G1 | **规模** | PageIndex 1000+ 页树索引、AI-reads-books 250 页逐页、DeepTutor 多解析引擎 | 50000 字截断，长书静默丢内容（有 `truncated` 标记但无后续补偿） | 高 |
| G2 | **人机协同节点** | DeepTutor「review the shape instead of accepting a blind one-shot output」；OpenMAIC Outline→Scenes 两段 | 一次 API 盲出，无中途确认点。**这是用户硬需求「一次 API」的代价，属取舍**，但代价未在产品里显式告知 | 中（取舍） |
| G3 | **引用可信度** | page-level / block-level /「page, sentence or mind-map node」；解析时锚定 | `source.file/page/quote` 由模型自报；v5 台账 samples 的 page 多为 0，**未从原文校验**，图片型才可回读真原图 | 高 |
| G4 | **闭环** | 出题→作答→评分→错题→间隔复习→Anki/FSRS；OpenMAIC 实时评分反馈 | core 链路止于「看题」；闭环在 legacy 窗口且另一套 store（见 3.2） | **最高（架构）** |
| G5 | **可交付** | MD/Word/PPTX/离线 HTML/Anki/.ics/CSV/MP4/ZIP/共享只读或协作 | MD/OPML/SVG/PNG/JSON；无分享、无 Anki、无作答记录导出 | 高 |
| G6 | **输入宽度** | 视频/音频/网页/YouTube/EPUB/Obsidian/Git/扫描 OCR/50 源跨文档 | PDF/PPT/Word/图片；纯图片需视觉模型 | 中 |
| G7 | **质量可测性的对手面** | 竞品多数无可测输出质量指标；PageIndex 有 FinanceBench 98.7%（QA 任务） | 我们有 9 项判据 + v5 真模型台账，但只量「输出自洽性」，不验答案对错/引文真伪 | 中（双方共缺） |

### 3.4 我们比竞品强的地方（客观，不只讲差距）

- **链路最短**：真正一次 API 产出完整结构 + 题目实体；竞品普遍多阶段/逐页/多次调用。
- **题型分类长进同一张导图 + 三级下钻到题目详情**：本轮检索的 20+ 项目里**未找到**相同形态
  （见第四节「未找到」）。
- **题目详情字段最细**：分步解答 / 解题思路 / 易错点 / 难度 / 关联知识点 / 来源；
  NotebookLM 只承诺「detailed explanations for incorrect answers」。
- **质量可测**：9 项判据 + 真模型 v1→v5 迭代台账，竞品 README 里基本没有等价物。
- **本地单机、无账号、数据不出机**；自动更新链路已在 v1.4.0 云端实测。

## 四、「未找到」清单（诚实边界）

- **未找到**任何高 star 项目把「题型分类索引」直接作为思维导图第二视图、并能三级点到题目详情。
  该形态来自用户原话，非行业既有做法。
- **未找到** NotebookLM 官方页对「导出格式」的逐字符说明（本轮 `notebooklm.google/students` 直连失败，
  引用的是 WebSearch 命中的官方页缓存文本，标 B，不冒充 A）。
- **未找到**任何竞品公布「一次 API 同时产出导图 + 完整题目详情」的效果指标；
  对比「效果好」只能用我们自己定义的 9 项判据，没有外部同口径基准。
- **未验证**：所有竞品的真机端到端效果（本轮只读 README / 官方页 / Live Demo 落地页，
  未部署、未上传真实资料、未跑一次完整生成）。OpenMAIC demo 站点可达，但只看到版本更新日志，
  没有实际生成一堂课，故标 A- 而非 A。
- **未验证** PageIndex 的 FinanceBench 98.7%（官方自报，本轮未复现）。
- `THU-MAIC/dsh-openmaic`（122 star）是 OpenMAIC 的 DeepSeek Harness 移植，
  与本项目 DSH 插件形态相关，本轮未展开。

## 五、路线冲突（本轮最该带走的结论）

用户硬需求是「**一次 API、整本书整体分析、不分层、只 LLM**」。高 star 项目集体走反方向：

- AI-reads-books：`Nobody understands a book by seeing all of it at once.`
- PageIndex：`at 805 pages the document no longer fits in the context window at all`
- DeepTutor：先提章节大纲让人审，再逐块编译；检索可选 PageIndex/GraphRAG/LightRAG
- OpenMAIC：Outline → Scenes 两阶段

**推导**：一次 API 的收益是链路最短、结果一次成型、无检索误差累积；代价是
① 上下文窗口即规模上限（我们 50000 字截断）② 无法在生成中途让人纠正方向
③ 页码/引文只能由模型自报，没有解析时锚点。这三条正是 G1/G2/G3 的根因，
**不是三个独立 bug，是同一个设计选择的三面**。要补 G1/G3 而不破坏「一次 API」，
只能在「解析阶段」把带页码的结构化语料喂给模型、并在返回后做原文校验，
而不是把分析拆成多次调用。

## 六、检查点句式（skill 硬性）

搜了 3 组（中文功能侧 / GitHub 开源实现 / 英文 best practice）+ 24 个仓库的 API star 真值核对，
端到端基准是「多源输入 → 带引用处理（分阶段或树索引）→ 一次产出导图/题目/笔记/闪卡/讲义 →
作答评分与间隔复习闭环 → 多格式导出与分享」；对照我们 v1.4.0：
**基准有而我们缺的是 G1 规模、G3 引用锚定、G4 闭环（架构未闭合）、G5 可交付、G6 输入宽度；
我们多做的是「真正一次 API」与「题型树长进同一张导图 + 题目详情字段粒度」。**
所以下一轮若要收敛，优先不是加按钮，是**把闭环接进 core/ 并把引用锚定到解析层**。
