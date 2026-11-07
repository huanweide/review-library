# 阶段零证据：复习「整理核心」100 分重做

> 目的：把"上传资料 → 考纲 → 出题 → 复习"的地基从"关键词片段"升级为"考纲级、图文内联、考试对齐"的整理系统。
> 约束：零云/零外链（运行期）；分析可接用户自填 API（含视觉模型）；纯本地引擎只做抽取与策展，不编造。

## 一、真实锚点（逐字符）

### A. MinerU（opendatalab/MinerU，~82.5k★，Apache-2.0 + 附加条款）
- "keeps layout, reading order, tables and equations instead of flattening them into a wall of text"
- "Smart Table Recognition & Structuring … Tables often contain the most valuable comparison data and are also the easiest content to damage during text conversion"
- "Image descriptions" / VLM backend "when complex visual understanding is required"
- RAG 设计第一原则："Preserve structure before choosing chunk boundaries … Preserve Markdown headings, tables, and image descriptions, then attach the section path as metadata" → `{source, section:"Chapter 3 / Retrieval Architecture", page, content_type}`
- "Make parsing observable"：记录 input hash、page count、backend、output length、table count、OCR pages、failure reason。
- **可借鉴**：① 保留结构（章节/标题）而非拍平 ② 图/表/公式都与原文位置绑定 ③ 解析可观测（哪些页没抽到文字/是扫描件）④ 视觉理解交给 VLM、文本抽取交给 layout。

### B. unpdf（unjs/unpdf，MIT，零依赖，3M 周下载）
- "extractImages(pdf, page, {format:'png'}) — PNG encoding needs no canvas and no native dependency"
- "extractTextItems … each item carries the string, the x and y position … font size … useful when plain text is not enough … e.g. to detect tables"
- "inspectPages … measure text and images per page" → 判断该页是文字页还是扫描件（决定要不要 OCR）。
- 约束：serverless 构建要求 Node 22+（官方 PDF.js 构建更挑）；本项目 Electron 31 内置 Node 20，故 **PDF 解析改放渲染进程用 pdfjs-dist（浏览器版），绕开 Node 版本坑**。

### C. OOXML 图片（Microsoft 官方 + 多源确认）
- PPTX 图片在压缩包 `ppt/media/`；DOCX 图片在 `word/media/`；slide 文本在 `ppt/slides/slideN.xml`。
- 结论：**PPTX/DOCX 图片零依赖抽取**（复用本项目 `lib/insight.unzip`），Node 20 即可。

## 二、本项目现状（失败映射）

| 用户失败项 | 现状证据 | 根因 |
|---|---|---|
| ① 看不过来/搞出很多资料 | `localAnalyze` 一上来 `slice(0, 8)` 倒 8 个知识点；`insight.generate` 又另生成一份"系统复习提纲.md" | 无策展、无优先级、重复产出 |
| ② 总结失败/不符考试 | `analyze` 产出扁平 points+questions，无章节层级、无"考什么/怎么考"；本地引擎"标题=片段首词、摘要=整段" | 没有考纲结构，靠关键词片段 |
| ③ 内容简单 | 本地引擎只出"挖空单选+解释题"；LLM 引擎深浅全看提示词，无强制深度 | 无深度约束、无题型驱动 |
| ④ 题型不对 | 4 种题型但本地几乎只产弱单选/解释；LLM 不知道真实考型 | 用户无法声明考型 |
| **致命：不支持看图** | `extractText` 对 `.pdf`/`.png`/`.jpg` 返回 null；PPT 只读 slide XML 文字，**所有图静默丢弃**；`llmAnalyze` 只发 `t.text` | 图片从未进入管线，比直接看 PPT 还瞎 |

## 三、R/C/N 决策（采纳/改造/打回）

- **采纳 MinerU "保留结构 + 图文位置绑定 + 可观测"**：改造为"考纲层级 + 关联原图 + 解析报告"。
- **采纳 unpdf 思路但换实现**：PDF 取图改渲染进程 pdfjs-dist（Node 20 兼容）；PPTX/DOCX 用现有 unzip 取 media。
- **采纳"用户自带考纲/题库优先"**：种子库已存在 `考纲.md`/`229考点索引.md`/`题库.json`，应解析为骨架与题库，而非从零生成浅大纲。
- **打回**：① 当前"系统复习提纲"重复产出（与考纲视图冲突）② 本地引擎"首词当标题"的伪知识点 ③ 任何只看文字、丢图的分析路径。

## 四、待验证/取舍
- PDF 在渲染进程用 pdfjs-dist 渲染每页为 PNG：需把"取图+取文"前置到 intake（入库即抽），并把图作为 material 的一等 asset 落盘。
- 视觉理解（看图出题）依赖用户 API 是否支持 vision；不支持时优雅降级为"图文内联展示 + 图文关联引用"，不阻断。
- 真实测试集：用 `library/books/b_afb672…`（含考纲/题库）与 `b_801c90…`（含示意图/扫描答案 PNG）作为"100 分"判定标准。
