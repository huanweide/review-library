---
title: 思维导图 v2 · 融合决策表（R/C/N + 根因段 B）
date: 2026-11-09
tags: [maxloop, R-C-N, 融合, 一次API, 题目下钻]
source: best-practices.md 对照表 + rlbuild 代码逐字符锚点 + 用户 2026-11-09 原话
---

# 融合决策表

用户原话（本轮唯一需求正本）：
1. 「思维导图 市面上最好的思维导图规划（目前基础上，集百家所长）」
2. 「题型分类也放思维导图我说过了，点击题型思维导图对应子题型能够看到所有题目，再点击内如果有图书原图+详细解答+思路」
3. 「一次api 完整版本的效果好 效果不好优化提示词语逻辑」

## 一、逐项决策（每项过 R/C/N + 根因段 B）

| # | 改动 | R 合理性 | C 正确性（外部锚点） | N 必要性 / 更轻替代 | 根因 A→B | 结论 |
|---|---|---|---|---|---|---|
| D1 | 新增**交互式 SVG 导图画布**，现有 `ul/li` 树降级为「大纲模式」，两者一键切换 | 与「整本书知识结构可视化」定位一致 | markmap「interactive SVG」；Xmind「大纲模式...在可视画布与文本大纲间一键切换」 | 不做则永远只是缩进列表，谈不上「市面上最好」；更轻替代「给现有树加连线」无法支持多布局 | A=`core-ui.js:182-190` `renderTree()` 只生成 `ul/li`；B=渲染层抽象选错（把树当导图），不是样式不够 | **合** |
| D2 | 3 种布局：右向树 / 双侧导图 / 组织图 | 大书需要不同阅读姿态 | Xmind「9 种结构」；markmap 4 布局（Classic/Two-sided/Org chart/Tree） | 9 种里 6 种与复习无关；3 种覆盖「深树/宽树/层级汇报」 | A=单一缩进方向；B=布局算法缺失 | **合（收敛到 3）** |
| D3 | 分支配色（按章分色，连线同色） | 大书视觉锚点 | markmap「branch colors」；Xmind「彩虹线」 | 成本极低；替代「统一灰」在 40+ 节点时找不着北 | A=SVG 无 `stroke` 分支色；B=无颜色编码维度 | **合** |
| D4 | 全文搜索 + 命中高亮 + 自动展开定位 | 大书刚需 | MindForge「搜索命中高亮并跳转到节点」（上轮锚点） | 无搜索时只能人肉滚；更轻替代「浏览器 Ctrl+F」搜不到折叠节点 | A=无搜索入口；B=折叠态下文本不可检索 | **合** |
| D5 | 单分支下钻 / 聚焦（双击节点只显示该子树） | 大书降噪 | Xmind「折叠与聚焦」「下钻」 | 已有展开/收起全部，缺「只看这一支」；替代「手动逐层折叠」操作成本高 | A=`expandAll/collapseAll` 全量操作；B=缺以节点为根的重渲染入口 | **合** |
| D6 | 键盘快捷键（`/` 搜索、`+/-` 缩放、`0` 复位、`Esc` 退出聚焦、方向键导航） | 桌面端效率 | Xmind「"/" 和 "*" 展开全部分支 / 收缩全部主题」「Enter 新增主题,按 Tab 缩进」 | 只做导航不做编辑，避免引入撤销栈/持久化 | A=所有交互仅鼠标；B=无键盘事件层 | **合（只读导航）** |
| D7 | 导出 Markdown / OPML / PNG | 可带走 | Xmind「PNG、SVG、PDF、Markdown、OPML」；markmap「HTML, SVG」 | 纯前端序列化，零后端；PDF/Word 需要额外依赖，不做 | A=仅 JSON+SVG；B=导出格式层未抽象 | **合（3 种）** |
| D8 | **题型树并入导图**为第二视图（根「题型分类」→ 7 类题型 → 子题型 → 题目） | 用户明确「题型分类也放思维导图我说过了」 | 用户原话（非外部基准，已标注） | 必须做；不做则需求 2 不成立 | A=`core.html` 题型在 `tab-questions` 独立 pane，与 `#tab-mindmap` 割裂；B=把题型当成「并列报表」而非「同一棵树的另一个投影」 | **合** |
| D9 | 数据契约扩展：`questionIndex[].items[].questions[]`，每题含 `stem/options/answer/solution[]/rationale/pitfalls/pointPath/source` | 支撑三级下钻 | 刷刷题「答案溯源/步骤拆解」；AIPT「来源引用:解析结果可回溯源文件页码」；万知「错误步骤定位 + 错因类型」 | 必须做；只加「题目名」无法给出详细解答与思路 | A=`core/analyze.js:43` item 只有 `{title,path}`；B=LLM 提示词与 validate 都把「题型索引」定义成考点方向而非题目实体 | **合** |
| D10 | Core 侧新增 `GET /books/:id/files/:fid/raw`（base64 + mime），题目详情显示图书原图 | 用户「如果有图书原图」 | AIPT「来源引用:解析结果可回溯源文件页码」；本机 `bookStore.getFileBuffer()` 已存在 | 必须做但**限定语义**：图片型资料显示真原图；PDF/Office 显示「文件名+页码+引文」文本定位，不谎称页图 | A=`core/request.js` 无 raw 路由（旧 `server.js:271` 的 asset 路由属于旧 store，不属 Core）；B=核心层缺「原始资料回读」能力 | **合（带诚实边界）** |
| D11 | 题目详情弹窗：原图 / 分步解答 / 解题思路 / 易错点 / 关联知识点 / 来源 | 用户「图书原图+详细解答+思路」 | 万知「【错误步骤定位】...【错因类型】...知识图谱上下游关联」；Mindko「分步推导讲解」(上轮锚点) | 必须做；替代「把答案塞 tooltip」放不下分步解答 | A=`renderQuestionIndex()` 只建 `qcard` 且 onclick 是跳导图；B=题型页被设计成跳转索引而非阅读容器 | **合** |
| D12 | 一次 API 提示词重写：显式数量区间 + 字段硬约束 + 单题 few-shot + 禁止占位 + 来源必须来自给定文件名清单 | 用户「一次api 完整版本的效果好 效果不好优化提示词语逻辑」 | ipipp「第二层恰好包含4个节点...把模型从开放作文模式拉回到结构化填空模式」；ttpho「single valid JSON object ONLY, no markdown fences」；CSDN「response_format json_object 显著降低格式错误率」 | 必须做；旧 prompt 是开放描述，一次吐 30 道题极易字段缺失/截断 | A=`core/analyze.js:23-46` SYSTEM_PROMPT 只描述 outline/questionIndex/summary，且 questionIndex 要求「考点/题目方向简述」；B=提示词把「完整题目」误设为「方向标签」，且无输出规模约束 | **合** |
| D13 | 新增 `measureQuality(result, files)` 可测效果指标 + 真模型跑一次验证，不达标则迭代提示词 | 用户「效果不好优化提示词语逻辑」 | 「JSON强调括号闭合与键名一致」；skill Oracle Gate (a)(d)(e) | 必须做；否则「效果好」是主观自评，违反外部判据铁律 | A=无任何质量度量；B=把模型输出质量当不可测的黑箱 | **合** |
| D14 | `response_format: { type: 'json_object' }` + `max_tokens` 自适应（题目详单需要更大预算） | 保证一次产出可解析 | CSDN「response_format ... 显著降低格式错误率」 | 必须做；8000 tokens 装不下 30 道带分步解答的题 | A=`core/analyze.js:231` 固定 `maxTokens: 8000`；B=输出预算与数据契约规模脱钩 | **合** |

## 二、明确不做（避免范围膨胀）

| 否决项 | 为什么（R/C/N 哪一关不过） |
|---|---|
| 节点增删改 / 拖拽 / 撤销重做 | R 不过：本产品是**分析结果阅读器**，不是导图编辑器；mind-elixir 那套需要持久化回写与冲突处理，会与「LLM 一次产出」的数据源冲突 |
| 时间轴 / 鱼骨图 / 矩阵 / 甘特 / 演说 / 协作 | R、N 不过：与「整本复习资料分析」无关；Xmind 的这 6 种结构服务于项目管理场景 |
| PDF 页图在 `file://` 下渲染 | C 不过：`pdfjs` 只有 `.mjs`，上轮实测 `type="module"` 在 `file://` 被 CORS 拦。本轮改为文本定位，不造假 |
| XMind/Mermaid/XLSX 导入导出 | N 不过：需要多套序列化器/依赖；JSON+MD+OPML+SVG+PNG 已覆盖「可带走」 |
| 拍照搜题 / 视频解析 / 组卷 / 错题本 | R 不过：独立产品线，不是导图内题目详情；但其**字段结构**已由 D9 采纳 |
| 视觉模型 OCR | 沿用 KNOWN-LIMITATION：当前 `NEEDS_VISION` 友好报错已够，本轮不引入多模态链路 |

## 三、改动白名单（限定范围，不碰既有安全加固）

- `core/analyze.js`（提示词 / validate / quality / maxTokens）
- `core/request.js`（仅追加 raw 路由，不改既有分支与 `assertSafeId` 判据）
- `renderer/core.html`、`renderer/css/core.css`、`renderer/js/core-ui.js`
- 新增 `test/core-mindmap-v2.test.js`、`_e2e/real-llm-check.js`
- 扩展 `_e2e/core-ui-verify.js`、`PROCESS/research-mindmap-v2/`、`计划追踪`、`今日日志`
- **不碰**：`core/bookStore.js`、`core/index.js` 的存储/安全逻辑；`app/*`、`server.js` 的既有路由；`scripts/*` 门禁；`.github/workflows/*`

## 四、效果判据（需求 3 的「好」定义，可测、非主观）

真模型一次调用后 `measureQuality()` 输出 6 项指标，**放行线**：

| 指标 | 放行线 | 为什么 |
|---|---|---|
| JSON 可解析 | 必须 | 一次 API 的最低要求 |
| 必需字段完整率（每题 stem/answer/solution/rationale 非空） | ≥ 90% | 用户要「详细解答+思路」，缺字段即无效 |
| 题目总数 | ≥ 8 且 ≤ 60 | 太少没覆盖，太多会截断 |
| 题型覆盖 | ≥ 3 类 | 不能只出一种题型 |
| `pointPath` 反查树节点命中率 | ≥ 70% | 题型必须能指回导图知识点 |
| 占位符率（「略」「待补充」「xxx」「示例题目」） | = 0 | 造假内容不可接受 |
| `source.file` 能匹配真实导入文件名 | ≥ 60% | 「图书原图/来源」要可回溯 |

不达标 → 按 D12 迭代提示词（加约束/few-shot/字段强调），重跑一次并落对比台账；连续 2 次不达标走 skill §3.7 外查，不闷头改第三版。

---

## 五、发布前独立评审订正（2026-11-10 · 历史决策原文不改，只追加）

两份全新上下文 reviewer 逐行读码后的订正。上面 D1–D14 与第四节的**决策原文保留**，
本节只记「实际落地范围」与「口径纠正」，避免把「决策要合」误读成「已全部落地」。

| 项 | 订正内容 | 依据 |
|---|---|---|
| D4 | 「自动展开定位」**未完整落地**。搜索基于当前已展开的画布节点（`core-ui.js` 的 `doSearch` 传入 `view.layoutData.nodes`，已被 `pruned()` 折叠过），折叠分支里的节点搜不到；已展开节点的命中高亮与 `nextHit` 跳转是真的。折叠态全文检索记为 KNOWN-LIMITATION，不谎称已做 | 独立评审逐行读码；`mindmap-layout.js` 的 `searchNodes` 本身支持任意节点数组，缺的是传入全量树 |
| D6 | 「方向键导航」名不副实：方向键只在**搜索命中间**跳转，不做节点间上下左右导航。其余键盘项（`/` `+/-` `0` `Esc`）按原决策落地 | `core-ui.js` `nextHit()` |
| 第四节 | 放行线表 7 项 + 标题「6 项指标」是**当时规划值**；实现后 `measureQuality().checks` 实为 **9 项**（补 `jsonParsed` / `answerRichRate` / `rationaleDepth`）。全仓统一按 9 项表述 | `core/analyze.js` `measureQuality()`；判别测试 D5 组断言 `Object.keys(checks).length === 9` |
| 第四节 | 「题目总数 ≤ 60」是**判据兜底上限**（防灌水 / 防截断），与提示词「8-24 道期望产出区间」语义不同，**刻意不相等**。评审曾按「口径漂移」要求统一到 24，那会让「25 道全合格题目被判整体失败」，属过拟合，已否决；`Q_RANGE` 只驱动提示词 | `core/analyze.js` `Q_RANGE` 与 `DEFAULT_THRESHOLDS.maxQuestions` 注释；D5 组 25 题判别样例 |
| D12 / D14 | `response_format: json_object` 不是所有中转都支持。正常路径仍严格一次调用；仅在上游回 400/404/415/422 且本次带了字段时，异常路径去掉字段重试一次；401/403 不重试 | `lib/llm.js` `chat()`；D5 组 mock server 断言「2 次调用」与「401 不重试」 |

`measureQuality()` 是**开发期效果度量**（真模型提示词迭代用），不在生产链路自动判定或自动重试——
生产自动重试会破坏用户「一次 API」硬需求。写进 KNOWN-LIMITATION，不把「效果可测」误读成「系统自动判」。
