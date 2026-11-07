---
title: 本地优先学习工具·诚实降级与工程健壮性基准
date: 2026-11-07
tags: [maxloop, 阶段零, 外部学习, 融合决策]
source: 真实检索输出（见下方逐字符锚点），非记忆推测
---

# 阶段零：外部基准 → 我们缺什么

搜了 3 组（中文功能侧 / GitHub 同类实现 / 英文 best practice），命中真实项目与模式清单：
**Logseq 45,055★、SiYuan 46,511★、StudyForge、DeepStudent、Cortex、Graceful Degradation 模式库**。
基准有三类共通做法：① 降级必须让用户看见；② 状态/来源一律可追溯、不编造；③ 本机数据的回收/备份要有边界保护。
**我们缺 ①③（降级只写 console、回收站恢复会造幽灵书），②部分缺（M3 真实路径下 asset.ext 格式不匹配导致整条链死）**。
所以这轮改：5 条真缺陷（见计划文件）+ 融合「降级披露层」。不融合 FSRS/向量库/云同步/插件市场（必要性 N 不过）。

---

## 一、检索到的真实基准（逐字符锚点）

### A. 真实 GitHub 高 star 同类项目

| 项目 | star | 逐字符证据 |
|---|---|---|
| `logseq/logseq` | 45,055 | openalternative.co：「Logseq ... **45,055stars**」「Local-first, open-source knowledge management tool with bidirectional linking, outlines, flashcards, PDF annotations」 |
| `siyuan-note/siyuan` | 46,511 | 同上：「SiYuan ... **46,511stars**」「spaced repetition flashcards, a relational database, and end-to-end encrypted sync」 |
| Logseq/SiYuan 对照 | 45,225 / 46,749 | selfhostindex.com：「GitHub stars ★ **45,225** ★ **46,749**」；dexi.net：「(~**44,000 GitHub stars**)」 |
| `mateoosoriodelhonte/studyforge` | 未标星（README 全文可读） | 「**When it does not know something, it says so**: a concept you have answered twice is "Not enough data", not "mastered"」「a rate with no data renders as —, **never as 0%**」「every generated card **links back to the exact passage** it came from」「**every status label has a written definition, shown in the UI next to it**」 |
| `000haoji/deep-student` | 未标星（README 全文可读） | 「answers **cite the page, sentence or mind-map node** they came from」「Edits to notes and the Study Desktop **can be undone**」「Back up or migrate via **Settings → Data governance**」「if that password cannot be read, **export is refused rather than falling back** to a portable archive」 |
| `pndaman-cortex` | 50 | reporank.net：「**50 Stars**」「citation-grounded」「FSRS spaced repetition」「encrypted backups」 |

### B. 方法论（英文 best practice）

| 来源 | 逐字符锚点 |
|---|---|
| Agent Patterns Catalog · Graceful Degradation | 「If it **silently drops** the failing capability and ships whatever it can produce **without disclosure**, the user gets a worse answer than expected without knowing why and **loses trust**」「On failure, the agent must produce a **degraded response with disclosure** rather than a generic error」「**User-visible disclosure completeness** — share of degraded responses that carried the notice」 |
| comfyui-mcp · vision per model | 「A multimodal agent is only trustworthy if it **knows — and admits — what it can't see**」「never hand the model a sentence it can turn into a lie」「the failure mode is a **clear message, not a hallucinated description**」「a confident paragraph about a screenshot the model never opened is the **single fastest way to torch a user's trust**」 |
| Marius Manolachi · AI degradation | 「The disclosure threshold is **semantic: tell the user when the result's meaning changes**」「Show what did not happen」「**Keep the decision outside the model**」「emit mode, reason, capability, outcome, and recovery events」 |
| Shanti Infosoft · AI error UX | 「a shaky answer should **never wear the same face as a solid one**」「Show the source or **show the gap**」 |

### C. 中文功能侧（对照完整性）

- Logseq/SiYuan 共同基线：本地优先、块级引用、PDF 标注、内置间隔重复卡片（openalternative.co、dexi.net 逐字符）。
- StudyForge 明确把「不编造」做成产品契约：无数据不显示 0%、每个状态标签在 UI 上有文字定义。
- DeepStudent 明确把「可撤销」「数据治理」「拒绝静默降级到弱格式」做成一等公民。

---

## 二、对照表：基准有什么 / 我们有什么 / 缺什么

| # | 基准做法（来源） | 我们当前 | 缺什么 |
|---|---|---|---|
| 1 | 降级必须带用户可见披露（Graceful Degradation / Manolachi） | M3 降级只 `console.warn`，`note` 无降级字样，前端照常渲染缩略图 | **降级披露层**：结果体需带标志 + 前端可见提示（P1 缺陷 3） |
| 2 | 「不知道就明说」，无数据不显示成已完成（StudyForge） | 模型被要求读图却没拿到图，会编 `imageCaptions`/`assetRefs` 且被当真 | **降级时清掉图引用与图索引**，并在提示词里撤掉「读图」指令（P1 缺陷 3） |
| 3 | 答案必须回链原文出处（DeepStudent / StudyForge） | 有 `assetRefs`/`sourceFile` 回链设计，但真实 `ext` 不匹配导致图根本没进模型 | **格式归一**：`ext` 带点/不带点都要认（P1 缺陷 2） |
| 4 | 编辑可撤销、备份有边界保护（DeepStudent / Cortex） | 删资料→删书→恢复资料会造「幽灵书」，书永久卡回收站 | **回收站引用完整性**：恢复资料时若书已删，拒绝或连带恢复（P1 缺陷 1） |
| 5 | 状态标签在 UI 上有文字定义（StudyForge） | `lib/store.js` 读接口承诺 `caption` 但 `setAssetCaption` 未导出，写回必失败被吞 | **导出缺失方法**（P2 缺陷 4） |
| 6 | 服务对畸形输入不崩（通用健壮性） | `decodeURIComponent` 未捕获，一个 `/%ZZ` 让整个进程退出 | **静态服务异常兜底**（P2 缺陷 5） |
| 7 | FSRS-6 排程、向量检索、云同步、插件市场（StudyForge / DeepStudent / SiYuan） | 已有 Leitner 复习盒 + 薄弱地图，离线零外链定位 | **不融合**：见下 R/C/N 打回理由 |

---

## 三、融合决策表（每项过 R / C / N + 根因段 B）

| 融合项 | R 合理性 | C 正确性（锚点） | N 必要性 | 结论 |
|---|---|---|---|---|
| **F1 降级披露层**：结果体加 `visionDegraded`，前端显示「本次未读图」 | 与项目「不造假/大白话」铁律一致 | Graceful Degradation「degraded response with disclosure」、Manolachi「tell the user when the result's meaning changes」 | 不改＝用户被误导且模型编图说明当真，直接违反 L0 不造假 | **采纳** |
| **F2 降级时撤销读图指令 + 清空图引用** | 与「没真正拿到图片就是完全失败」判据一致 | comfyui-mcp「never hand the model a sentence it can turn into a lie」 | 不改＝降级 pass 仍命令模型读图，必然产出伪造 caption | **采纳** |
| **F3 严格化视觉不支持判定** | 与降级语义一致 | 现正则含裸 `400`/`bad request`，任意 400 都会误降级 | 不改＝合法 400（如超长/参数错）被吞掉，掩盖真错误 | **采纳**（收窄为明确的 vision/image/multimodal 语义） |
| **F4 回收站恢复的引用完整性** | 与「真落盘、可恢复」定位一致 | DeepStudent「export is refused rather than falling back」体现边界保护 | 不改＝不可逆数据丢失（幽灵书），最高优先级 | **采纳** |
| **F5 格式归一 `ext`** | 与 M3 设计契约一致 | `store.js:135` 落 `.png`，`study.js:413` 白名单 `png` — 逐字符不匹配 | 不改＝真实 PPTX 一张图都进不了模型，M3 全死 | **采纳** |
| **F6 导出 `setAssetCaption`** | 与自身读接口契约一致 | `store.js:400` 无该方法名 | 不改＝整段写回是死代码、异常被吞 | **采纳** |
| **F7 静态服务异常兜底** | 与「四种运行方式都可用」一致 | `server.js:176` 无 try/catch | 不改＝单请求打死整个服务 | **采纳** |
| G1 引 FSRS-6 替换 Leitner 复习盒 | 与学习闭环相关 | StudyForge「FSRS-6 spaced-repetition」 | **打回**：现有复习盒已 e2e 验证；换算法要重做排程数据迁移，收益不明、风险大 | 不融合 |
| G2 引 SQLite / 向量检索 | 与「成百上千本书」相关 | SiYuan「SQLite-backed ... stays fast」 | **打回**：当前 JSON 落盘单进程无并发写，且引依赖破坏「零新依赖、离线」 | 不融合 |
| G3 云同步 / 插件市场 / Agent 工具链 | 与竞品完整形态相关 | DeepStudent「13 model providers」「56 built-in skills」 | **打回**：与「零外链、离线优先、本地为次」定位正面冲突 | 不融合 |

---

## 四、根因段 B（A 出错点 ≠ B 根因，两者同修）

| 缺陷 | A 出错点 | B 根因（设计/约定层） | 只修 B 还会再犯吗 |
|---|---|---|---|
| 1 幽灵书 | `store.js:263-289` 恢复资料时无条件重建已删书目录 | **恢复操作缺少「父实体是否还活着」的前置校验**；回收站项与书生命周期未绑定 | 会；任何跨实体恢复都会再踩 → 在 `restoreMaterial` 统一加父书存在性判定 |
| 2 ext 不匹配 | `study.js:413` 白名单不带点 | **落盘格式与消费格式没有共用同一个归一函数**，两边各写各的 | 会；新增图片类型还会错 → 抽 `isVisionImageExt()` 单点归一 |
| 3 降级造假 | `study.js:451` userText 循环外构造 | **降级只当成「少发图块」，没当成「换一套提示词语义 + 换一套结果契约」** | 会；任何能力降级都会留旧指令 → 按 pass 构造文本 + 结果体带披露标志 |
| 4 未导出 | `store.js:400` 导出清单漏 | **新增方法没有「定义即导出」的约束**，且调用方空 catch 掩盖 | 会；加导出 + 判别测试锁住 |
| 5 进程崩 | `server.js:176` 无 catch | **HTTP 入口层把「请求级错误」当「进程级错误」处理** | 会；任何解析异常都会崩 → 在 createServer 回调统一兜底 |

---

## 五、未找到 / 明确排除（诚实边界）

- 未找到可证伪的目录穿越：`store.js:12` `ID_RE` + `safeId` 覆盖所有拼路径入口（critic 逐项核对）。
- 未找到 CSP 外链绕过、密钥 scrub 漏出、HTTP/Electron API 契约缺失（critic 逐项核对，均给出「找不到」）。
- 单进程下读-改-写丢数据不可证伪（全同步、无 await），不列为缺陷。
- 本项目是**离线、无 AI 也能完整用**的工具，跟依赖 13 家模型供应商的竞品形态不同；竞品的 Agent/云能力只作对照，不作目标。
- 检索到的 star 数为 2026-11-07 当日快照，不同聚合站有 ±500 差异，只用于确认「真实高 star 项目」这一事实，不用于排名结论。
