# 阶段零 · 考纲思维导图 — 真实竞品锚点与对照表

> 研究对象：考纲思维导图模块（v0.8）。中心辐射结构（中间概念→四周延伸）+ 无限嵌套（点远端节点→详细解释+子类型+例题）+ 题型分类面板（单题进右侧"题目分类"）+ 跨知识点双链关联（已存在不写、新类型追加）。数据来源：用户考纲.md + 题库.json。

## 一、真实锚点（逐字符可复核）

### 锚点 1：markmap（markmap.js.org / github.com/markmap/markmap，开源）
- 架构：markmap-lib 用 remark 把 Markdown 标题/列表解析成树 → markmap-view 用 **D3 radial-tree** 渲染成可交互 SVG（pan / zoom / collapse-expand）。
- 关键能力：`#`=根，`##`=`#` 的子分支，列表项=叶；节点支持富文本（代码/链接/图片/数学）；大图折叠默认、可配初始深度。
- **它缺什么（我们的差异点）**：① 只做"渲染已有 markdown 层级"，不提供"点开节点弹出详细解释/子类型/例题"的**数据模型与交互**；② 没有"题型分类面板"；③ 没有"跨节点双向链接索引"（它靠 markdown 链接，不是结构化 related）；④ 不解决"每章多个中心（晶体一张、石墨一张）"——它只有单一根。
- **可借鉴**：radial-tree 的"中心辐射 + 折叠"视觉范式；我们照此做 SVG 中心辐射，但节点点击触发侧栏（而非仅折叠）。

### 锚点 2：Obsidian 双链 / 用户知识库机制（用户自述 + 通用 PKM 范式）
- 机制：双向链接（[[note]] 互相索引）；"已存在不写、新类型追加进子类型架构"= 增量合并（dedup by title/id + append-only 子类型）。
- **借鉴**：`related` 字段做双向索引；`merge` 时按节点 title 归一去重，只追加新子类型/例题/关联，绝不覆盖既有 summary。

### 锚点 3：本项目既有地基（非外部，但必用）
- `lib/syllabus.js`：`buildBookOutline()` 已产出 `{chapters:[{title, sections:[{id,title,points:[{id,text,types,key,pageRef,questions:[{id,type,stem,answer,explanation,pointIds}],questionCount,images}]}]}]` + 题库挂题。这是思维导图的**骨架源**。
- `lib/graph.js`：`buildGraph()` 的 co-question 边（同题考到的两知识点强关联）可直接转为思维导图节点的 `related` 弱/强关联。
- `lib/llm.js`：`chat(cfg, messages)` OpenAI-compatible，用于"完全自行生成"节点 summary/子类型/例题/关联（无 cfg 则走规则版）。

## 二、基准 vs 我们（缺什么）

| 能力 | markmap | Obsidian 双链 | 我们现状(v0.7) | v0.8 要做 |
|---|---|---|---|---|
| 中心辐射可视化 | ✅ radial | — | ❌ 仅树形 syllabus-ui | ✅ SVG 中心辐射（多中心=每节一张） |
| 点开节点看详情/子类型/例题 | ❌ 仅折叠 | — | ❌ | ✅ 侧栏 + 无限嵌套 children |
| 题型分类面板（单题进右侧） | ❌ | — | ❌ | ✅ questionTypes 分组 + single 标记 |
| 跨节点双链索引 | ❌（靠md链接） | ✅ | ❌ | ✅ related 双向 + 点击跳转 |
| 每章多中心 | ❌ 单根 | — | — | ✅ 每 section 一张中心图 |
| LLM 自行生成子结构 | ❌ | — | — | ✅ cfg 驱动，无则规则版 |
| 沉淀/去重/增量合并 | ❌ | ✅ | — | ✅ merge 按 title 去重+追加 |

## 三、决定（R/C/N 预收口）
- **R**：与"项目级离线复习系统"定位一致——把考纲从"线性树"升级为"可探索知识网络"，直接服务于"顺着知识点捋""多科目期末"场景。
- **C**：骨架来自用户已有考纲.md（权威），题型来自题库.json（权威），LLM 仅在无结构处补 summary/子类型（标注来源）；不凭空造关系。
- **N**：非做不可——当前 syllabus 是死树，用户要的是"中心辐射+无限嵌套+题型分类+关联"，这是新交互范式，不是装饰。
- **根因 B**：既有 syllabus 只有"章节→小节→知识点"两层线性结构，且无"节点详情/子类型/关联"数据位；graph 只有扁平关系图。缺一个"中心辐射 + 节点富详情 + 双链"的数据层与视图层。

## 四、未找到 / 待定
- "题型分类只有1题直接放右侧"——无现成开源范式，按用户描述自定义（single 标记 + 右侧面板）。
- 双链 UI 跳转——无现成轻量库适配 Electron 本地，自绘。
