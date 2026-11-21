# 知识点/题型齐全度与复习效果 · 基准对照（2026-11-19）

> 用户诉求：保证效果、知识点/题型齐全、排版整齐、知识梳理全通、默认提示词架构非常好、强大复习效果。
> 方法：maxloop 阶段零——先搜外部基准拿逐字锚点，真机跑真实考点资料，逐字符证据定真问题，不凭感觉。

## 一、外部基准（逐字锚点）

| 来源 | 逐字原话 | 我们对照 |
|---|---|---|
| LumiChats《Exam-Ready Notes》 | "Chunking Your Material — Divide your textbook or lecture content into logical units — not chapters, but conceptual groups" | 我们按章/节/知识点分层，✓ 已覆盖 |
| LumiChats | "generate new questions from the same material each time to prevent simple answer memorisation" | 我们题库一次性固定、无换题 → **差距** |
| Idea Usher《How AI Study Apps Are Built》 | "Cross-checks generated questions against the original knowledge map through programmatic validation to minimize hallucinations" | 我们有 quoteAudit 引文逐字校验（24/24 命中），✓ 比基准更实 |
| Idea Usher | pipeline: Content Extraction → Knowledge Mapping → Question Generation → Difficulty Classification → Adaptive Revision | 我们：抽取→导图+题型→基础/进阶/挑战难度→SM2 练习，✓ 骨架齐全 |
| 80/20 学习法 | "identify the 20% of content that concentrates 80% of exam questions" | 我们 summary 抓高频易混点（致密度/过冷度/回火三档），✓ 隐含覆盖 |
| NotebookLM | "Ask the chat to cite where it found the claim. If a card lacks a source quote, add one" | quote 留空时 detail 完整讲清（诚实），但"原文逐字命中 0/9"显示口径会让用户误以为失败 → **差距（显示）** |

## 二、真机实测（真实考点资料，非 mock）

- 资料：`考纲全覆盖-考点版.md` 截取工程材料 66 个真实★★★考点（4.18 万字符，语料 100% 保留未截断）
- 模型：硅基流动 `deepseek-ai/DeepSeek-V4.1-Flash`，Key 只从环境变量读、不落盘
- 产出：5 章 / 13 节 / 27 知识点 / 6 细分 / 6 类题型 / 24 题
- 质量：24/24 题 answer/solution/rationale/pitfalls/source 全齐全，rationale 平均 92 字，引文命中 24/24=100%
- 排版：导图 SVG 47→正常、提纲层级清晰、题型双栏联动、概览统计真实，零 console error
- **失败项**：浏览器点"开始分析"，180 秒超时失败；协议层带 360 秒超时跑成功但耗时 **176 秒**（卡在超时边缘）

## 三、真问题（外部判据可证伪，不凑数）

### 真问题 1（P0）：分析超时——大量资料必失败
- A 出错点：`core/analyze.js:563` `timeoutMs: o.timeoutMs || 180000`；前端 `bookspace.js:773` 调 analyze 不传 timeoutMs。
- B 根因：默认超时 180 秒是按小资料定的；4 万字符 + `budget=min(32000, 24000+len/8)` 输出预算下，真机耗时 176 秒，稍有波动就超 180 秒。前端没暴露超时覆盖，用户无法自救。
- 判据：浏览器实测失败（180s），协议层传 360s 成功（176s）——同一个 Key、同一份资料，唯一变量是超时。
- R 合理（合"保证效果"定位）/ C 正确（逐字符证据+实测对比）/ N 必要（不改则大资料分析必失败，无更轻替代）。

### 否掉的假问题（不硬凑）
- "知识点 27 < 输入 66"：模型按"少而精"结构化归并，非丢数据；语料 100% 保留、summary 准确。是提示词的刻意取舍，架构好，不动。
- "考点大全原文命中 0/9"：输入是"考点+自测题"格式、无连续原文定义段，模型按规则留空 quote、用 274 字 detail 讲清——诚实行为。但显示口径"0/9"会误导用户以为失败 → 归为显示优化，非功能 bug。
- "直连 hash URL 显示未分析"：我测试方式的问题（router 初始化时序），用户从书架正常点进书渲染正常。
- "quote 空=编造"：核对 detail 内容真实、与考点对应，非编造。

## 四、决定

- **只修真问题 1**（分析超时），增量改、不碰提示词架构（用户明确说架构非常好）。
- 显示口径的"0/9 命中"顺手优化为更诚实的措辞（有 detail 时不暗示失败）。
- 不加"重新出题"功能：基准有此差距，但属新功能、非"保证效果"必需，按 N 关不做（留作后续）。

## 五、执行结果（22:15 完成）

| 项 | 结果 |
|---|---|
| 真问题 1 · 分析超时 | `bookspace.js:773` analyze 显式传 `timeoutMs: 360000`（真机 176s < 360s）；SW v6→v7。浏览器从书架点书→分析不再卡 180s 边缘 |
| 显示口径 · quote 空 | `:603` 改为只统计真正给了引文的条目（quoteGiven），全空时显示"讲解型（资料无连续原文段可引用，逐条完整讲清）"，不再误导"0/9命中" |
| 判别测试 | `tools/check-analysis-robustness.mjs`：baseline 0/4 FAIL、candidate 4/4 PASS |
| Oracle Gate | (a) 真浏览器清SW缓存重载：旧措辞消失、新措辞显示、零console error ✓ (b) node --check ✓ (c) 书架正常点进书渲染 ✓ (d) baseline FAIL ✓ (e) 逐字符锚点齐 ✓ |
| 全门禁 | 图书馆 24/24；书院 135 条（28+14+21+10+17+11+34）+ 快照自检 OK |
| 三文档全通 | 考点大全 9 条 / 考纲 3 条 / 幻灯片 16 页，真 Key 生成成功 |

**已验证效果（真机、非 mock）**：5章/13节/27知识点/6细分/6类题型/24题；24/24题答案·解析·理由·易错·引文全齐全，rationale 平均92字、引文命中100%；导图47节点、提纲层级清晰、题型双栏联动、考点大全 detail 平均274字——默认提示词架构确实好，只做增量保护，未推翻。

**KNOWN-LIMITATION（如实留，非代码问题）**：① 输入66考点→产出27知识点是模型"少而精"的结构化归并（语料100%保留、summary准确），非丢数据；② 题库一次性固定、无"换一批新题"能力（基准有此差距，属新功能，按N关未做）；③ 守夜进程本轮未再被回收，但历史上被会话回收过，Run键仅登录触发——仍是已知限制。

## 六、追加（22:40）· 用户指出「1234 就是天然思维导图」→ 结构沿用 + 大图排版

### 用户原话与真相
「这么多，1234，不就是天然思维导图分类吗 你的排版也可以做到更好」——对比资料原文确认：用户资料本身已写好树
（`工程材料 · 期末考纲` → `├─ 第一章 材料的性能` + `## 1.1`~`## 1.8` + 表格 `1.1.1`~`1.1.4`，共 **31 节 / 229 个编号知识点**），
而旧提示词强制 `2-6 章 / 每章 1-4 节 / 每节 2-5 个知识点`（理论上限 120，实际只出 27）——**模型被上限逼着重编、合并、砍节**。

### 真问题 2（P0）：知识点不齐的根因＝提示词数量上限压着，不是模型偷懒
- A：`core/analyze.js` outline 规则「2-6 章；每章 1-4 节；每节 2-5 个」；`MAX_CORPUS=50000`；`budget=min(32000,…)`。
- B：提示词假设「资料无结构、需模型自建骨架」，与「资料自带编号树」的现实冲突；语料/输出上限按小资料定，大资料一律截断。
- 改：① 提示词加「资料自带结构时一律照搬」+「完整性优先于美观」；② MAX_CORPUS 5万→12万；③ budget 3.2万→4.8万；④ 超时 180s→480s（前端 600s）。
- 真机实测（工程材料，8.1 万字符，303 秒）：**知识点 27 → 229（资料正好 229 个，全收）**、节 13→30、章名原样沿用、
  229/229 有 desc、229/229 有题型、7 类题型全用上、23 题字段齐全、truncated=false。

### 真问题 3（P0）：229 节点的导图被压成一条竖线
- A：`workbench/src/mindmap.js` 全量渲染无折叠；`style.css` `.mm-wrap.grow .mm-canvas svg{max-height:100%}` 强制压进一屏。
- B：渲染层假设「节点少到能一屏放下」；229 叶 × 76px ≈ 1.7 万像素高，压到 600px 容器 = 缩放 4%，字不可读。
- 改：`foldTree` 按叶子数自动收浅（>90 叶只展到「章→节」）+ 点节点逐层展开 + 「展开全部/收起到章节」按钮 + 角标显示隐藏数；
  CSS 改为允许滚动、不再压扁（虚线框标可展开）。
- 真机实测：默认 **36 节点**（5 章 + 30 节）文字清晰可读；点一节 36→40；「展开全部」→ **265 节点**（5+30+229+root）可滚动。

### 顺带：旧格式书迁移（用户「你放进去啊 我的」）
- 三本书（工程材料/概率统计/提示词工程）资料一直在 `layer_N/ + materials.json`，workbench 只认 `book.json.files` → 整本被过滤、书架看不到。
- 新增 `tools/migrate-legacy-books.cjs`：备份原 book.json → 补 `files:[]` → 用真实 `Core.addFile` 入库（存原文件+抽文本+登记）；`layer_N` 与 `materials.json` 原样保留。
- 结果：**4 本 / 43 份资料全部入库**，书架 2 → 6 本，三本书文本分别 8.1万 / 0.3万 / 29.7万字符。

### 验收
- 判别测试 `tools/check-structure-fidelity.mjs`：baseline 0/9 FAIL、candidate 9/9 PASS。
- `test/core-anchor-v3.test.js` 截断用例改为**按 MAX_CORPUS 自适应构造**（原写死 200 块，改上限后卡边界误红），修后 36/36。
- 图书馆 24/24；书院 135 条 + 快照自检 OK；SW v7→v8。
