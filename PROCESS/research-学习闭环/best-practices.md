# 阶段零 · 学习闭环深化（M1 错题本 / M2 间隔重复 / M3 导出）

检索日期：2026-11-06
主题：复习工具「学了之后真记住」的三件套——错题沉淀、间隔重复、产物导出。
方法：maxloop 纪律——真实 GitHub 高 star 项目逐字符锚定，R/C/N 三关融合，不泛化。

---

## 一、检索项目清单（4 组）

| 组 | 项目 | star / 性质 | 用途 |
|---|---|---|---|
| SRS 算法 | open-spaced-repetition/free-spaced-repetition-scheduler (FSRS) + ts-fsrs | DSR 记忆模型，官方 TS 实现 | M2 间隔重复的理论地基 |
| SRS 对照 | smartrecallai / chessatlas 的 SM-2 vs FSRS vs Leitner 长文 | 算法横向对比 | M2 选型依据 |
| 错题/卡片 | ankitects/anki (32.2k★) + Anki Review-Finder | 自评分 + lapse 追踪 + leech | M1 错题本模型 |
| 导出 | dolanmiu/docx (~6k★, MIT) / eKoopmans/html2pdf.js (10k★) / parallax/jsPDF | 本地生成 Word / PDF | M3 导出选型 |

---

## 二、逐字符锚点

### A. 间隔重复理论（M2）

[A1] FSRS 仓库 README（open-spaced-repetition/free-spaced-repetition-scheduler）：
> "FSRS runs entirely locally and has no risk under others' control."
> "FSRS springs from MaiMemo's DHP model ... variant of the DSR model ... three variables that affect memory: difficulty, stability, and retrievability."
> "Stability refers to the storage strength of memory; the higher it is, the slower it is forgotten."

[A2] smartrecallai 对比文（原文引 FSRS 定义）：
> "Stability S — 你这张卡的可提取概率衰减到 90% 还需要多少天。S = 30 意思是:30 天后你有 90% 概率仍然记得。"
> "Difficulty D — 每张卡一个常数(0-10),调节稳定性在每次复习后的增长速度。"
> "Retrievability (R): probability of recall right now ... R = exp(-t/S)"
> "At 90% desired retention, the next interval equals stability, by definition."

[A3] 同文算法横向表（逐字摘录关键列）：
> "Leitner 1972 盒子编号 (1-5) 对 / 错 隐式(~85%) 没有按卡定时;同盒所有卡一视同仁"
> "SM-2 1987 EF + 间隔 0-5 评分 隐式(~90%) 手调常数"

[A4] ts-fsrs API 示例（open-spaced-repetition/ts-fsrs）：
> `const retrievability = scheduler.get_retrievability(result.card, new Date(), false)`
> `const nextState = scheduler.next_state(memoryState, elapsedDays, Rating.Good)`
> `const nextInterval = scheduler.next_interval(nextState.stability, elapsedDays)`
> 评级：`Rating.Again / Hard / Good / Easy`；卡状态 `State.New / Learning / Review / Relearning`

### B. 错题 / 卡片模型（M1）

[B1] Anki 社区说明（lemmy 长文，逐字）：
> "Again means you grade yourself as incorrect, and Anki will remember this mistake."
> "If you choose one of the three correct scores (Hard, Good, Easy), Anki remembers that you've answered correctly, and will schedule the card some time in the future."
> "The worse you are with other cards, the more Anki shows you those particular cards you keep making mistakes with."
> 全文核心：Timer + self-grading == you only see the cards you're doing bad with.

[B2] Anki Review-Finder（forums.ankiweb.net）审计反模式：
> "Information Leaks (leak): Prompts inadvertently revealing the answer."
> "leeches" 概念：多次 lapse 的卡被单独标记。

[B3] Anki 元信息（open-source-tools）：32.2k stars，Rust，AGPL；关键词 Spaced repetition / Customizable flashcards。

### C. 导出（M3）

[C1] docx（dolanmiu/docx）README：
> "Easily generate and modify .docx files with JS/TS with a nice declarative API. Works for Node and on the Browser."
> 浏览器示例：`docx.Packer.toBlob(doc).then((blob) => { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "example.docx"; link.click(); });`
> 声明式：`new docx.Document({ sections: [{ children: [new docx.Paragraph(...)] }] })`
> MIT，~6k★，零外部依赖。

[C2] html2pdf.js（eKoopmans/html2pdf.js）介绍文（solosoft.dev）：
> "html2pdf.js converts any webpage or element into a printable PDF entirely client-side using html2canvas and jsPDF."
> "over 10,000 GitHub stars"
> "the PDF output closely mirrors what the user sees in the browser ... text is not selectable in the generated PDF."

[C3] jsPDF（parallax/jsPDF）docs（关键坑，逐字）：
> "Use of UTF-8 / TTF: The 14 standard fonts in PDF are limited to the ASCII-codepage. If you want to use UTF-8 you have to to integrate a custom font ... So if you want to have for example chinese text in your pdf, your font has to have the necessary chinese glyphs."
> 用法：`import { jsPDF } from "jspdf"; const doc = new jsPDF(); doc.text("Hello world!", 10, 10); doc.save("a4.pdf");`

---

## 三、功能基准（从锚点推出我们该做什么）

1. **M1 错题本**：照搬 Anki 的"per-item lapse 追踪 + leech 上浮"思想，但砍掉它的多状态卡机（New/Learning/Review/Relearning）——我们的"卡"就是"一个薄弱知识点"，不需要那么重的状态机。每条薄弱点落盘：答对/答错历史、lapse 次数、最近一次结果。
2. **M2 间隔重复**：采纳 FSRS 的"在忘记前复习"原则（R 降到约 90% 时该出现），但**砍掉 FSRS 的权重拟合优化器**——它需要成百上千条复习日志才能拟合，我们起步没有。改用 Leitner/SM-2 式的轻量盒子：每个薄弱点一个 box 等级，答对升级（间隔拉长）、答错降级（立刻重来）。纯本地算法、零云、零模型。
3. **M3 导出**：Word 走 docx（结构化、可选中、MIT、浏览器可用）；PDF 走 html2pdf.js（渲染真实 DOM，中文不会丢字，代价是文本不可选中）。**绝不用裸 jsPDF 出中文**（[C3] 证明需嵌 TTF，体积大且我们零云不想塞几 MB 字体）。学生版/教师版开关，导出时严守现有"试卷不含答案"脱敏不变量（对应 [B2] leak 反模式）。

---

## 四、R/C/N 融合决策表

| 项 | R 采纳（融合优点） | C 打回（为何不做） | N 备注（未来可选） |
|---|---|---|---|
| M1 错题本 | Anki per-item lapse 追踪；leech（高 lapse）上浮到"薄弱地图" | Anki 四态卡机（New/Learning/Review/Relearning）过重 | 可加"错因聚类" |
| M2 间隔重复 | FSRS"在忘记前复习"原则；Leitner 盒子 + SM-2 间隔倍数；per-item 难度 | FSRS 权重拟合优化器（需大量日志，过度工程） | 后续可接 ts-fsrs 做高级引擎，默认仍轻量 |
| M3 导出 | docx 出 Word（结构化可选中）；html2pdf.js 出 PDF（中文安全） | 裸 jsPDF 出中文（需嵌 TTF，体积大） | 若需可选中 PDF，后续嵌子集化 CJK 字体 |

---

## 五、未找到 / 取舍说明

- **FSRS 完整引擎未直接采用**：ts-fsrs 可用，但其价值在于用个人复习史拟合参数；我们起步数据为空，直接上 FSRS 收益为负，故采用其"记忆模型思想"而非其"拟合流程"。
- **多设备同步未做**：Anki 靠 AnkiWeb/自托管同步，与本项目"零云"铁律冲突，明确不做。
- **导出文本可选中 PDF 未优先**：html2pdf.js 像素化导致不可选中；但中文安全优先于可选中，故 PDF 走 html2pdf.js，Word 走 docx 补足"可选中"需求。
- **本地 OCR（M5）不在本轮**：本轮只做学习闭环（M1-M3），资料智能（M4-M6）留待下一轮。
