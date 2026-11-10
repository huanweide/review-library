---
title: 思维导图 v2 · 阶段零外部基准对照表
date: 2026-11-09
tags: [maxloop, 阶段零, 思维导图, 题型下钻, 一次API]
source: 本轮 4 组 WebSearch 真实检索输出 + 本地 rlbuild 代码逐字符锚点
---

# 阶段零：外部基准 vs 我们（2026-11-09）

## 一、搜了什么（4 组，逐字符证据锚点）

| # | 查询组 | 真实来源 | 逐字符锚点 |
|---|---|---|---|
| 1 | 中文功能侧 · 商业导图完整形态 | Xmind 官网 / App Store 说明 / Xmind 用户指南大綱 | 「9 种结构 —— 思维导图、逻辑图、树形图、组织结构图、时间轴、鱼骨图、树型表格、矩阵图、网格，在一张画布上自由混排」；「大纲模式 / 演说模式 / ZEN 模式」；「折叠与聚焦」「下钻」，「选中主题后, 双击鼠标左键 或 单击空格键, 进入编辑状态」；「"/" 和 "*" 选中主题后点击, 展开全部分支 / 收缩全部主题」；「导出 微软办公套件 Word Excel PPT PDF文件 图片文件 SVG文件 ...」；「联系线」「外框」「概要」「标签」「标记」「优先级」 |
| 2 | GitHub 开源实现选型 | SlideMind 技术调研（`github.com/lq920320/slide-mind`）/ markmap 官网镜像 / GeekChamp 对比 | 「mind-elixir MIT ✅ 活跃(v5) 无(framework-agnostic) ✅ 完整交互编辑 简洁 JSON 树 ... 事件总线完善」；「markmap MIT 活跃 无 ❌ 只读渲染(Markdown → 导图)」；「simple-mind-map ... ✅ 功能最全 ... ⚠️官方声明「低维护状态」,客户端闭源」；markmap「Customization JSON options include branch colors, node width, initial expansion level, zoom, and panning settings」；SimpleMindMap「Exports to XMind, Mermaid, XLSX, and FreeMind」「Presentation mode」 |
| 3 | 中文功能侧 · AI 题目详情形态 | 刷刷题 / Mindko / AIPT 题库 / 万知AI 测评 | 「答案溯源:关联权威资料库」「步骤拆解:可视化逻辑链条」「错题归因:AI诊断薄弱环节」；AIPT「来源引用:解析结果可回溯源文件页码,修改痕迹一键定位」「每道题附带文字+视频双解析,错误选项给出易错点提示」；万知「【错误步骤定位】...【错因类型】...对应知识点...知识图谱中的上下游关联」；Mindko「上传PDF、PPT课件...一键生成完整学习套件...结构化笔记、记忆闪卡、思维导图、模拟测验」 |
| 4 | 英文/中文 best practice · 一次 API 结构化输出 | ipipp 思维导图 Prompt / 51CTO / CSDN / ttpho | 「第二层恰好包含4个节点」「最多展开到第三层」「把模型从开放作文模式拉回到结构化填空模式」；「层级不超过 4 级」「每个节点的标题尽量简短(2-8 个字)」；「response_format={"type": "json_object"} ... 显著降低格式错误率」；「The output MUST be a single, valid JSON object ONLY. Do not include any text, explanations, or markdown fences」；「Markdown强调层级缩进,JSON强调括号闭合与键名一致」 |

**检查点句式（skill 硬性）**：搜了 4 组，功能基准是 ① **多结构布局 + 大纲/导图双模式 + 折叠聚焦下钻 + 标记/联系线 + 多格式导出 + 键盘快捷键**；② **纯 JSON 树 + 事件驱动 + 交互式 SVG 画布（非缩进列表）**；③ **题目详情 = 题干 + 原图/来源页码 + 分步解答 + 思路 + 错因/易错点 + 关联知识点**；④ **一次 API 输出单个严格 JSON、显式层级/数量约束、禁止解释文字与代码围栏**。对照我们：`core.html` 的 `#tree` 是 **`ul/li` 缩进列表**（零连线、零布局），题型在**独立 tab** 且每项只有 `{title,path,pointId}`，**题目/解答/思路/原图全缺**，一次 API 只产出大纲+考点方向。**我们缺 ①②③④ 全部主体**，所以这轮不是加按钮，是换渲染层 + 扩数据契约 + 重写提示词。

## 二、基准有什么 / 我们有什么 / 缺什么

| 能力 | 外部基准（锚点来源） | 当前 rlbuild v1.3.1 | 差距 |
|---|---|---|---|
| 渲染形态 | markmap「interactive SVG」/ mind-elixir「简洁 JSON 树 + 画布」 | `#tree` 为 `ul/li` DOM 树，`buildTreeSvg()` **只在导出时**画 SVG | **缺交互式 SVG 画布**；现有 DOM 树降级为「大纲模式」 |
| 多布局 | Xmind「9 种结构」/ markmap 4 布局（Classic/Two-sided/Org chart/Tree） | 单一「左→右缩进」 | **缺 ≥3 种布局**（右向树 / 双侧 / 组织图） |
| 大纲双模式 | Xmind「大纲模式 ... 按 Enter 新增主题,按 Tab 缩进」 | 只有树，无大纲切换 | **缺导图↔大纲切换**（复用现有 DOM 树，零成本） |
| 折叠/聚焦/下钻 | Xmind「折叠与聚焦」「下钻」/ markmap「initial expansion level」 | 展开全部/收起全部（`- [x]` 上轮） | **缺单分支下钻 + 聚焦（只看这一支）** |
| 搜索定位 | MindForge「搜索命中高亮并跳转到节点」(上轮锚点) | 无 | **缺全文搜索 + 命中高亮定位**；对大书刚需 |
| 节点编辑/键盘 | mind-elixir「完整交互编辑」「事件总线完善」/ Xmind「双击/空格编辑 //* 展开」 | 只读 | 本轮**只做键盘导航 + 折叠快捷键**，不做节点编辑（见决策表 D-否-1） |
| 节点标记 | Xmind「标签」「标记」「优先级」「联系线」「外框」 | `point` 有 `questionTypes` 徽章 | **缺题型徽章进画布 + 题目数角标 + 原图角标** |
| 导出 | Xmind「PNG、SVG、PDF、Markdown、OPML、Word」/ markmap「HTML, SVG」 | JSON + SVG | **缺 Markdown / OPML / PNG**（低成本，纯前端） |
| 主题/配色 | markmap「branch colors」/ Xmind「彩虹线」 | 单色 | **缺分支配色**（按章分色，SVG 连线同色） |
| 题型在导图里 | 用户原话「题型分类也放思维导图我说过了」 | 题型在独立 tab，与导图割裂 | **必须合**：题型树作为导图第二视图/第二根分支 |
| 三级下钻 | 用户原话「点击题型...对应子题型能够看到所有题目，再点击内如果有图书原图+详细解答+思路」 | `items` 只是「考点方向简述」，无题目 | **缺题目实体**：题干/选项/答案/分步解答/解题思路/易错点/关联知识点/原图引用 |
| 图书原图 | AIPT「来源引用:解析结果可回溯源文件页码」 | `/api/core/*` **无原始文件读取路由**；旧 index.html 有 `/api/books/:id/materials/:mid/asset/:aid` 但不属 Core | **缺 Core 侧 raw 路由** + 题目→文件/页码的引用契约 |
| 一次 API 完整产出 | 「single, valid JSON object ONLY」「结构化填空」「数量区间约束」 | 单次 `chat` 但只要求 outline + questionIndex + summary | **缺完整题目契约**；风险：`max_tokens` 截断导致 JSON 半截 |
| 效果判据 | 「JSON 强调括号闭合与键名一致」 | 无真模型效果度量 | **缺可测指标**：字段完整率 / 引用可解析率 / path 命中率 / 占位符率 |

## 三、「未找到」清单（诚实边界）

- **未找到** markmap 支持「导出 PNG」的官方逐字符说明；只有 HTML/SVG 明确列出。PNG 由本项目自行用 canvas 光栅化 SVG 实现，不宣称来自竞品。
- **未找到** 任何开源实现把「题型分类索引」直接作为思维导图二级视图的现成方案；该形态来自用户原话，非外部基准。
- **未找到** 一次 API 同时产出「思维导图 + 每个题型的完整题目详情（含分步解答）」的公开 prompt 模板；本轮自行设计并用真模型验证，不冒充行业既有做法。
- **未找到** 本机可用 Electron GUI（`node_modules/electron/dist/electron.exe` 缺失）；真机验证沿用 KNOWN-LIMITATION，改用 `file://` + 注入等价 `window.api` 的真 Chromium 替身。
- **未验证**：PDF 页图在 `file://` 下能否渲染（`pdfjs` 为 `.mjs`，module 被 CORS 拦，上轮已实测）。本轮「图书原图」对图片型资料保证可用，对 PDF 型资料只保证「来源页码 + 引文」文本定位，不谎称能显示页图。

## 三·补 · §3.7 中途外查（真模型连续 2 次失败后强制触发）

【卡点】一次 API 连续两次失败：v1 吐出两个连写 JSON（22569 字符，第一个在 22368 处闭合）；v3 加 few-shot 后输出 34337 字符 `Unterminated string`，被 `max_tokens` 截断。
【外查】查了 2 类：① LLM JSON 截断 / `max_tokens` sizing ② few-shot 导致美化输出 / minified JSON。
【基准（逐字符）】
- 「`if finish_reason == "length": raise TruncatedOutputException`」「do not parse partial JSON—retry with higher cap」；「Size max_tokens from measured p95 completion length on golden evals, not guesses. For JSON, add ~20% headroom」。
- 「most LLMs pretty-print JSON output by default … 27-34% of output tokens being spaces and line breaks」「Adding one instruction to the system prompt asking for minified JSON made calls up to 30% faster … and up to 28% cheaper」。
- 「输出必须是一个 JSON 对象,可被 json.loads() 直接解析。禁止任何前言、解释、代码块围栏。首个非空字符必须是 {」；「规则定边界,样例定形状」。
【差距】我们缺 ① `lib/llm.js` 从不检查 `finish_reason`，把半截 JSON 当正常返回 ② 提示词没要求单行紧凑，few-shot 示例本身是缩进美化的 ③ 输出预算按语料长度猜（`12000 + len/10`），没有按实测 p95 加 headroom。
【决定】抄「finish_reason 检测 + 单行契约 + 按实测规模加预算」三条；改提示词 few-shot 为单行、加「首个非空字符必须是 {」；`max_tokens` 提到 24000 起步并按语料加 headroom；题目数收敛到 8-20 道压规模。验证方式：真模型 v4 一次 API 重跑，8 项指标全绿且 `finish_reason` 不再 length。

## 四、竞品取舍（为什么不全抄）

- Xmind 9 结构里，时间轴/鱼骨图/矩阵/甘特图/协作/演说模式与「复习资料整本分析」无关 → 不做（R/N 不过）。
- mind-elixir「节点编辑 + 撤销重做」需要持久化回写与冲突处理，本产品定位是**分析结果的可视化阅读**，不是编辑器 → 不做（R/N 不过）。
- simple-mind-map「XMind/Mermaid/XLSX 导出」依赖多套序列化器，本轮用 JSON/Markdown/OPML/SVG/PNG 已覆盖「可带走」需求 → 不做（N 不过）。
- 商业 AI 搜题平台的「拍照搜题 / 视频解析 / 题库组卷 / 错题本」是独立产品线，不是本轮的导图内题目详情 → 不做，但**采纳其字段结构**：分步解答、思路、易错点、来源页码、关联知识点。

---

## 五、事后订正（2026-11-10 · 历史研究原文不改）

§3.7 的「8 项指标」「题目数收敛到 8-20 道」是**当时的决策口径**，不是最终实现口径：

- 实现后 `measureQuality().checks` 实为 **9 项**判据（补 `jsonParsed` / `answerRichRate` / `rationaleDepth`）；
- 提示词期望产出区间由 8-20 调整为 **8-24**（真模型 v4 实测产 24 题，把提示词对齐到模型实际行为）；
- 放行判据 `maxQuestions` 保持 **60** 作兜底上限，不与提示词区间相等，理由见
  `fusion-decisions.md` 第五节（统一到 24 会让 25 道全合格题目被判整体失败）。

发布前用**当前代码**重跑真模型另落台账，不拿旧阈值下的 v4 结果冒充新代码的验收证据；
重跑结果与口径逐项对齐见 `release-ledger.md`。
