# 统一核心 · 竞品功能基准对照（阶段零外部学习）

**对象**：rlbuild 统一核心（`core/` 引擎 + `renderer/core.html` 前端）。形态＝导入 PDF/PPT/Word/图片 → 建书 → LLM 整体分析 → 可层层展开思维导图 + 题型索引。

**检索日期**：2026-11-08
**检索组**（按 skill 纪律，≥3 组）：
1. 中文功能侧：复习资料管理软件 思维导图 生成；AI 学习平台 多 LLM 多格式解析
2. GitHub 开源实现：markmap / MindGeniusAI / open-study-note-ai / PDF2MindMap / Gen-AI-MindMap-Flow-Builder / Mind Map Wizard
3. 英文 best practice：markmap mindmap from markdown；document to mindmap AI generator；study notes app import pdf docx AI summarize flashcards

## 真实高 star / 代表性项目（逐字符证据锚点）

- **markmap**（github.com/markmap/markmap，13.2K★，MIT）：Markdown 大纲 → 节点层级 → 可交互导图；支持折叠/展开、缩放、**多布局（Classic / Two-sided / Org chart / Tree）**、导出 SVG/PNG/HTML、富标签（粗体/链接/代码/图片/数学）、分支笔记 popover。→ 思维导图渲染事实标准。
- **MindGeniusAI**（github.com/xianjianlf2/MindGeniusAI）："reads your PDFs and draws editable mind maps — visible tool-calling loop, built-in RAG, bring-your-own-key, multi-provider (OpenAI / Claude / DeepSeek / Kimi). Self-hostable." 亮点：按节点 id 外科手术式编辑（不全量重渲染）；键盘优先画布（Tab 子 / Enter 兄弟 / F2 重命名 / Del / ⌘Z 撤销 / 拖拽改父级）；双向画布（手动改后 AI 基于改动继续）；导入导出 MD/OPML/PNG/SVG/Mermaid；多 provider 且 key 只在浏览器。
- **open-study-note-ai**（github.com/bishrulhaq/open-study-note-ai）：上传 PDF/Word/PPT/Image → chunk/embed/存 Postgres(pgvector)；生成 lesson plans / flashcards / quizzes / mindmaps / podcasts；Next.js + Tailwind + Lucide；多 LLM。
- **AI_Study_Platform**（github.com/ttang1024/AI_Study_Platform）：多 LLM（9 种）、多格式解析；摘要/闪卡/题库/术语表/思维导图；key 存 localStorage。
- **PDF2MindMap**（github.com/mdmahbubreza/PDF2MindMap）：PDF → 文本 → Gemini 生成结构化 md 导图 → markmap 渲染；OCR 支持扫描件；可下载摘要/导图/问题。
- **Mind Map Wizard**（github.com/linus-sch/Mind-Map-Wizard）：AI 从主题/URL/PDF 生成多分支多层级导图；双击编辑、右键增删配色、拖拽；AI 编辑助手；导出 PDF/JPG/SVG；链接分享。

## 对照表：基准 / 我们 / 缺什么

| 维度 | 基准（别人怎么做） | 我们有什么 | 缺什么（真问题） |
|---|---|---|---|
| 输入格式 | PDF/Word/PPT/Image/Txt/Md/CSV/网页/音频/视频 | PDF/PPT/Word/Md/Txt/Csv + 图片标记 isImage | 图片只标记、未真正抽取（需视觉模型）；音频/视频/网页超范围 |
| 建书/工作区 | MindGeniusAI 一个工作区 chat+canvas+doc；open-study-note-ai 按 study 分 | 先建书再加文件 ✓（符合用户设想） | — |
| 分析方式 | RAG（chunk+embed+检索）vs 一次性整体生成 | 一次性整体 LLM 分析 ✓（用户明确"不需要分层，直接全体分析"） | 缺对话式二次追问（MindGeniusAI agent）；本轮不做 |
| 思维导图渲染 | markmap：折叠/展开、缩放、多布局、导出 SVG/PNG/HTML、富标签 | 自研 DOM 树：可逐级展开、题型徽章、连接线 | **缺缩放/平移、缺导出、缺聚焦** |
| 编辑能力 | MindGeniusAI 按 id 外科编辑、键盘优先；Mind Map Wizard 双击/右键/拖拽 | 完全只读 | 本轮不做（用户未要求，主链路只读）；观察池 |
| 题型/学习素材 | open-study-note-ai / AI_Study_Platform：flashcards/quizzes/术语表 | 题型分类索引（7 类）✓ | 缺闪卡/测验交互；观察池 |
| 多 LLM/BYOK | MindGeniusAI / AI_Study_Platform：多 provider、key 只在浏览器 | 已有 cfg（base/model/key）转发、key 不落盘 ✓ | 缺多 provider 预设 + 视觉开关；本轮增强 |
| 持久化 | refresh 持久化、Postgres | 落盘 book.json + analysis.json ✓ | — |
| 导出 | markmap SVG/PNG/HTML/MD/OPML/Mermaid；Mind Map Wizard PDF/JPG/SVG | 无 | **缺导出**（本轮做轻量：JSON + SVG） |
| 桌面端入口 | 桌面应用 | app/main.js 仍加载旧 index.html，无 core 路由 | **P0 交付断裂**：桌面端看不到新界面 |

## 本轮决定（融合优点 + R/C/N + KNOWN-LIMITATION）

按"只做合理且必要"，收敛 4 项：

1. **P0 接入桌面端入口**（融合"统一项目"设想）：把 core 以 HTTP 形态接入 Electron（server.js 抽 `startServer` 可复用，app/main.js `loadURL` core.html）。R：符合统一项目；C：app/main.js:194 加载 index.html、无 core 路由；N：不改则桌面端看不到新界面。
2. **思维导图对标 markmap 增强**：加缩放/平移（大书可读性）+ 导出 SVG/JSON（可带走/分享，命中用户"可分享精美"）。R：品类标配 + 用户要精美；C：markmap 导出 SVG/PNG/HTML；N：大书无缩放会拥挤，导出让成果可带走。
3. **题型索引 ↔ 思维导图双向联动**：点题型卡片 → 高亮/定位对应知识点节点。R：命中"齐全详细"；C：questionIndex 已有 `path`；N：体验提升，低成本。
4. **图片分析健壮性**：检测到全书无文本（纯图片）→ 友好提示需视觉模型，不静默失效。R：符合"导入图片"设想；C：open-study-note-ai image 需 vision；N：当前纯图片会静默空分析。

**本轮不做（KNOWN-LIMITATION）**：
- 节点编辑（MindGeniusAI id 级编辑）：用户未要求，主链路只读，列为观察池。
- 对话式二次追问 agent（MindGeniusAI）：超出"整体分析"设想，留待联调/下一轮。
- 闪卡/测验交互（flashcards/quizzes）：用户设想里是"题型分类"非"做题"，观察池。
- 音频/视频/网页导入：超范围。
- DSH 插件复用同一 core：跨仓库（独立 Git + `~/.dsh` 运行环境），本轮只定架构方案、不落地；下一轮执行。
