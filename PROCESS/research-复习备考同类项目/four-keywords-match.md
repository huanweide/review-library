# 四关键词同类项目档案 · 备考 / 思维导图 / 知识点大全 / 资料整理（2026-11-20 第三轮）

> 用户指定四个关键词，要求按这四个词搜同类型。本轮按词分组，逐仓库核验 star/协议/更新，读 README 与架构文档。
> 关键发现：**四个词命中的项目形态完全不同**——「备考」多是内容仓库或低 star 工具；「思维导图」是高 star 引擎的天下；「知识点大全」几乎没有工具；「资料整理」是知识管理软件。我方是这四类的交叉点。

---

## 零、按词分组的命中实况

| 关键词 | 命中最强项目 | star | 形态 | 与我方同构度 |
|---|---|---|---|---|
| 备考 | `nishit546/OpenPrep-AI` | 20 | 备考试点分析+计划+SM2 | 中（功能同构，star 极低） |
| 备考 | `joeseesun/qiaomu-anything-to-notebooklm` | 6537 | 多源→导图/Quiz/PPT/播客 | **高**（一份资料→多产物） |
| 思维导图 | `siyuan-note/siyuan` | 47306 | 知识工作空间（块/导图/SRS/AI） | 高（平台级） |
| 思维导图 | `markmap/markmap` | 13274 | 纯文本→交互导图（SVG+Canvas 双渲染） | **很高**（导图引擎同构） |
| 思维导图 | `wanglin2/mind-map` | 13011 | 中文思维导图引擎 | 很高（中文布局） |
| 思维导图 | `SSShooter/mind-elixir-core` | 3204 | 框架无关导图内核 | 高（可嵌入） |
| 知识点大全 | `fausaitalk/System-Architecture` | 40 | 软考考点+真题内容仓库 | 低（是内容不是工具） |
| 知识点大全 | `Bopang459/11408` | 13 | 考研资料仓库 | 低 |
| 资料整理 | `coolgan/Obsidian-AI-Agent-workflow` | 34 | Obsidian+Agent 研究工作流 | 中 |
| 资料整理 | `tianma-if/edgeever` | 3457 | AI-native 笔记+导图+MCP | 中高 |

**诚实结论**：GitHub 上「备考 / 知识点大全」这两个中文词几乎没有高 star 工具项目——它们在中国是**内容仓库生态**（一堆 markdown/PDF 资料），不是软件生态。我方做的「把资料自动变成考点大全+导图」恰好填的是这个空。这不是我抄不到东西，是我方在做一件 GitHub 中文区少有人做成工具的事。

---

## 一、思维导图引擎（最值得学的一组）

### markmap（13274★，MIT）
README 逐字：`Headings and list items become branches you can fold, zoom and pan. Other text, such as paragraphs and code, stays with its branch as a note that opens in a popover.`
**最关键的架构判据**（逐字）：
> "**Large maps:** an SVG renderer for most maps and a canvas renderer for very large ones."

以及文档内配置：`<!-- markmap: fold -->` / frontmatter `foldLevel: 2` / `layout: two-sided`。
**理解**：大型导图不是靠「折叠」一个手段硬扛，而是**换渲染器**——SVG 适合交互，超大树换 Canvas 保性能。我方 229 点导图现在靠 `foldTree` 折叠 + 章 chips 聚焦，本质是单 SVG 渲染器 + 交互层补救。这是明确的架构差距，不是 bug。
**可直接抄的**：`foldLevel` 这类「在文档/数据里声明折叠层级」的判据——我方现在折叠状态只在前端 state，刷新即丢；若写进分析结果，用户下次进来就是上次展开的层次。

### wanglin2/mind-map（13011★，中文作者）
描述逐字：`SimpleMindMap（思绪思维导图）：一个强大的思维导图`。topics 含 `svg` / `xmind`。
**理解**：中文语境下 1.3 万 star 导图引擎，说明「中文导图」有真实需求。我方 `renderer/js/mindmap-layout.js` 是自研布局器，规模远小于它，但我方多一层「从分析 JSON 自动建树」，它多一层「手工编辑+多格式导入导出」。定位不同，不冲突。

### siyuan（47306★，AGPLv3，中文团队）
README 逐字定位：`privacy-first personal knowledge management system, supporting fine-grained block-level reference and Markdown WYSIWYG`。
四个和我方直接相关的架构判据：
1. **块级引用 + 双向链接**：`Block-level reference and two-way links`、`SQL query embed`、`Protocol siyuan://`。这正是我方上一轮做的「互相索引」（知识点↔题↔导图↔考点）的成熟形态——siyuan 把它做成了底层原语，我方是应用层的 jumpToMap/gotoDoc。
2. **百万字大文档**：`Million-word large document editing`。和我方 12 万字符语料上限对比，量级差一个数量级。它靠块存储+虚拟滚动，不靠一次性塞进模型。
3. **数据与程序分离**：FAQ 逐字 `assets` / `snippets` / `storage`（含 flashcards）/ `templates` / notebook 文件夹存 `.sy` JSON。**这和我方 `library/books/<id>/` 一 book 一目录同构**，但它把「卡片状态」独立到 `storage/`。
4. **独立 SRS 仓库**：生态表里 `riff` = Spaced repetition，单独一个 repo。判据：**复习调度是独立能力，不塞进笔记内核**。我方 `core/practice.js` + `lib/srs.js` 已经是独立模块，方向对。

### 对我方的意义
导图这块我方不缺引擎细节，缺的是**大树换渲染器**这个架构判断。siyuan 的块级双向链接是我方「互相索引」的升级方向，但那是平台级工程，不是本轮要动的。

---

## 二、备考工具（功能同构但 star 低）

### OpenPrep-AI（20★，JavaScript）
描述逐字：`An advanced AI-powered exam preparation workspace to analyze lecture notes & PYQs, auto-schedule study plans, and master memory retention using spaced repetition`。
**理解**：「分析讲义+往年题 → 自动计划 → SM2 记忆」——这是我方 plus 计划功能的形态。20 star 说明这个组合在 GitHub 没跑出来，不能当成熟基准。

### qiaomu-anything-to-notebooklm（6537★，MIT，中国作者）
这是「备考」词里唯一高 star 工具。README 逐字定位：`多源内容智能处理器：任何内容 → 播客 / PPT / 思维导图 / Quiz`。
**三个值得理解的机制**：
1. **一份资料八种产物**：播客/PPT/思维导图/Quiz/视频/报告/信息图/闪卡。和我方「一份资料→导图/提纲/题型/考点大全/考纲/幻灯片」几乎同一产品思路，且它也用 Notebase（NotebookLM）做中转。
2. **三轮递进深度分析**（README 逐字表格）：第一轮概览 4 问 → 第二轮深挖 5 问 → 第三轮反刍 3 问；"NotebookLM 在同一会话中保持上下文，后轮问题自动受益于前轮回答，形成真正的递进式深度分析"。
   **理解**：我方分析是一次性单轮 JSON，所有产物一步到位；它是**多轮递进，每一轮建立在前一轮理解上**。这可能就是「知识点为什么齐全」的答案——不是一次塞更多，是分三轮问。
3. **15+ 种输入源 + 6 层级联获取策略**：代理→站点 UA→通用绕过→存档→缓存→本地工具。失败才降级下一层，不是一次失败就放弃。
   **理解**：我方资料导入只支持本地文件，没有 URL/微信/视频字幕源。这是产品边界差异，不是缺陷。

### 对我方的意义
「三轮递进分析」是最值得记的一条：如果用户后续抱怨「知识点还是不够细/不串联」，方向不是加大单轮 token 上限，而是**改成多轮递进**。但当前 229 点全收已过验收，不重构。

---

## 三、知识点大全（内容仓库生态，非工具）

命中的全是资料仓库：`fausaitalk/System-Architecture`（40★，软考系统架构师考点+真题）、`Bopang459/11408`（13★，考研数一英一408）、`SnowWolf68/408`（3★）、两个 C 语言题库仓库（0★）。
`1wri/C` 的 description 逐字列了 15 份资料：「C语言常考知识点大总结[14页] / 知识点总结[11页] / 课件[629张] / 学习笔记[110页] / 题库1-10…」。
**理解**：中文「知识点大全」的真实形态就是**一堆 PDF/Markdown 文件躺在仓库里**。我方 `library/books/<id>/` 的资料层跟它一样，多了上面那层 LLM 分析。**用户在 GitHub 找「知识点大全」时找到的是资料堆，在我方产品里找到的是结构化五切面**——这是我方差异点，不是缺失。

---

## 四、资料整理（知识管理软件）

### edgeever（3457★，TypeScript）
描述逐字：`AI-native note-taking app & Evernote/Obsidian alternative. Instant all-platform sync, rich notes (tables, mind maps, diagrams, posters), web clipper & MCP. 100% free on Cloudflare or Docker.`
**理解**：把导图/MCP/web clipper 塞进笔记软件，本地优先。和我方差异：它是通用笔记，我方是备考专用。

### Obsidian-AI-Agent-workflow（34★）
描述逐字：`以 Obsidian 为知识库核心、以 Claude/Codex/Gemini 等 AI Agent 为分析引擎的研究工作流，适合需要大量阅读文献/资料、整理学习笔记、复现模型/实证的学生党、研究者`。
**理解**：低 star 但定位与我方「资料→AI 分析→笔记」最接近的工作流文档。可当用法参考，不是代码基准。

---

## 五、本轮与前三轮的合并结论

1. **我方在 GitHub 的真实同类分布**：导图引擎（高 star，成熟）、知识管理（高 star，平台级）、备考工具（低 star，多是课程项目）、知识点大全（无工具，纯内容仓库）。我方处在四者交叉，没有单一「完全同类」可以对标——这就是为什么前三轮每轮只能借一两个判据。
2. **最值得记的三条新判据**：
   - markmap：大树换渲染器（SVG→Canvas），不是靠折叠硬扛。
   - siyuan：块级双向链接 + 数据/程序分离 + SRS 独立仓库。
   - qiaomu：多轮递进分析（概览→深挖→反刍）可能比加大单轮 token 更能出齐全知识点。
3. **本轮不改产品代码**。229 点全收已过验收，导图折叠已可用；上述三条是「下次遇到相关问题时先查这里」的已知方向，不是现在要补的洞。

---

## 六、证据边界
- 本轮四个关键词均用 GitHub 仓库搜索 API + 逐仓库读 README/描述核验，未 clone 任何仓库；star/协议/更新时间来自 API 返回值。
- 「知识点大全」关键词中文搜索命中 5 个仓库全部 ≤40 star，判定为内容仓库生态——这是搜索结果事实，不是主观判断。
- qiaomu 的付费墙绕过涉及第三方站点，本文只记录其「6 层级联降级」架构思想，不采用、不实现、不推荐。
- 上一轮四个高 star 项目（Anki/read-frog/Obsidian SR/get-it）的深读仍在 `high-star-deep-dive.md`，本文件只补充四关键词命中的新项目，不重复。
