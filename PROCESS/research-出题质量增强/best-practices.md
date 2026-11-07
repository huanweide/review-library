---
title: 复习资料图书馆 · 出题质量增强（去重 / 校验重试）阶段零基准
date: 2026-11-06
tags: [maxloop, 阶段零, 去重, 幻觉校验, CRITIC, RAGAS, v0.5]
source: 本轮四组 WebSearch 结果原文；上一轮 PROCESS/research-app-设置与分析/best-practices.md 锚点 25；本机 lib/study.js 与 test/study.test.js 实读
---

# 阶段零 · 外部学习对照表（v0.5）

> 本轮对象：用户「继续」。按判断优先推定为「沿 v0.4 分析出题主线，把上一轮明确打回的 KNOWN-LIMITATION 补上」。
> 模式：maxloop 模式A（产品深度迭代）。上一轮决策表第 101 行把「题目去重 / 幻觉重试」判为**打回 → KNOWN-LIMITATION**，README 第 143 行同列未做。本轮不新开方向，补这两项并做到产品级可验证。
> 硬约束：不真调外部 API、不写真密钥、不动数据模型、不放宽 CSP。云端链路一律用可注入的 mock 验证契约。

## 一、四组检索与逐字符证据锚点

### 第 1 组（同名干扰，诚实记录）
搜 `shoshinL/FLASH`，返回的全是**同名不同项目**：`KevinC2015/Flash`（推荐系统 SimHash）、FLASH 投机解码论文、FlashAttention 笔记。**没拿到上一轮锚点 25 那个仓库的一手实现**，不硬套。但捞到两条更贴本项目的证据：

| # | 逐字符原文锚点 | 出处 |
|---|---|---|
| 1 | "资产推荐用字符 bigram 相似度做本地匹配，不做语义检索——够用、零成本、可预测。" | `LIN-F1SH/dsh-prompt-lint` 插件说明 |
| 2 | "纯字符串相似度阈值定得很高(0.85)，因为「问题 1 / 问题 2」这种只差一个数字的标题会被误并。" | 同上 |
| 3 | "输出被截断时插件会明确报 TRUNCATED 并重试一次，而不是静默失败。" | 同上 |
| 4 | "预算检查在每次 Provider 外部派发前通过短事务原子预占，覆盖 Provider 内部重发和格式修复……只有计划内首次请求是正常额度，其余派发消耗单元及 generation 的额外额度。" | `CaiZongyuan/clinmesh` spec |

### 第 2 组（幻觉判定的行业基准）
| # | 逐字符原文锚点 | 出处 |
|---|---|---|
| 5 | "Faithfulness Score = Number of claims in the response supported by the retrieved context / Total number of claims in the response" | RAGAS 官方文档 Faithfulness |
| 6 | "A response is considered faithful if all its claims can be supported by the retrieved context." | 同上 |
| 7 | "Text-overlap scores like BLEU and ROUGE cannot judge RAG: they punish correct paraphrases and miss hallucinations." | DEV Community《Evaluating RAG With Ragas》 |
| 8 | "Sensible starting thresholds are faithfulness above 0.80, answer relevancy above 0.85" / "Low faithfulness scores tell you, and how to fix it: 1. Tighten your system prompt… 2. Lower the temperature" | 同上 |
| 9 | "It has 4,000+ GitHub stars and is backed by a Y Combinator company." | Invra 评测文（star 数唯一一手数字，其余仓库本轮未拿到 star 数据，不编） |

### 第 3 组（去重的分层实现）
| # | 逐字符原文锚点 | 出处 |
|---|---|---|
| 10 | "Detect - Finds exact duplicates (SHA256 fingerprinting) and near-duplicates (MinHash + LSH)" / "Candidates are verified with exact Jaccard similarity" | `dtubb/DejaText` README |
| 11 | "The text is preserved - you can review before removing." / "Changing one word in a 25-word paragraph gives ~85% similarity." | 同上 |
| 12 | "normalizes input (lowercasing, stripping punctuation, removing stop words, collapsing whitespace), fingerprints normalized text with SHA-256 for O(1) exact-match detection stored in a Map, and computes fuzzy similarity using overlapping character bigrams/trigrams with a Jaccard index" | LobeHub `sufficientdaikon/archon-content-deduplication` |
| 13 | "configurable thresholds (default 0.8, strict 0.9, lenient 0.6)" / "optimizes cost by running cheap fingerprint checks before expensive similarity scoring" / "preserves originals while selecting which items to keep" | 同上 |
| 14 | "Don't compare raw text — always normalize first" / "Don't hardcode the similarity threshold" / "**Don't silently remove content — return both items in a duplicate pair**" | 同上 Rules 段 |
| 15 | "Setting the similarity threshold too high (e.g., 0.95) leaves near-duplicates in your dataset… Setting it too low removes legitimately distinct texts" / "The dangerous mistake is not testing the threshold against a small sample first" | The Neural Base `text-dedup` 教程 |
| 16 | "shingle-based hashing is fast but misses semantic duplicates (\"cat\" vs \"feline\")" | 同上 |

### 第 4 组（重试闭环的理论与实现）
| # | 逐字符原文锚点 | 出处 |
|---|---|---|
| 17 | "a critic model checks whether the generated answer is actually grounded in the retrieved documents. If it isn't, the pipeline reformulates the query and retries — up to a configurable retry limit — before falling back gracefully." | `ayush-s-tomar/self-healing-rag` README |
| 18 | "**Graceful fallback — after the retry budget is exhausted, the app returns an honest fallback answer instead of guessing**" / "**Transparent reasoning** — the self-healing trace panel shows every retrieval, critique, and retry step live, not just the final answer." | 同上 |
| 19 | "self-correction *without* external feedback yields only modest gains or *degrades* performance" / "the grounding tool, not introspection, is what makes self-correction work" | CRITIC (Gou et al., ICLR 2024, arXiv:2305.11738) |
| 20 | "asking a model to review its own answer without any external feedback did not reliably help and could lower accuracy, because the model changed correct answers as readily as wrong ones" | Huang et al., ICLR 2024《LLMs Cannot Self-Correct Reasoning Yet》 |
| 21 | "**The controller: code, not a prompt** — The most important architectural decision is that the loop is controlled by ordinary code, not by the model deciding whether it is done. The controller below keeps the best draft seen so far, stops on success, stagnation, repetition or budget, and **never returns a draft that scored worse than an earlier one**." | Belgavi.AI Lab《Agent Reflection Architecture》 |
| 22 | "Executable check … **High: facts about the draft, not opinions**" / "Open self-critique … **Low: frequent false alarms and sycophantic edits**" / "Return the stop reason with the result." | 同上（信号源可靠性排序表） |
| 23 | "Deduplicates the questions from all of the questioning chunks" / "(Retries once if the answer was judged to be hallucinated.)" | 上一轮锚点 25，`shoshinL/FLASH` README（二手引用，本轮未取到一手，沿用并标注） |

## 二、功能基准（合格的质量增强该有什么）

| 维度 | 基准 |
|---|---|
| 去重分层 | 归一化 → 精确指纹 O(n) → 字符 bigram + Jaccard 近似 → 可配阈值 → **返回重复对、不静默删** |
| 去重边界 | 阈值不能硬编码；必须先在小样本上验证；词法去重抓不到语义改写需显式标注 |
| 幻觉校验 | **必须是外部/可执行判据**，不能让生成模型自评；结构化结果（合格/不合格 + 证据） |
| 重试控制 | 由**代码**控制循环；固定预算（本轮 1 次）；保留最佳草稿；返回停止原因 |
| 失败处理 | 预算耗尽**诚实降级或显式标注**，不许猜、不许静默放行、不许伪造成功 |
| 可观测 | 每次校验/重试/去重的**结果对用户可见**（trace 面板 / 质量报告），不是黑盒 |
| 成本意识 | 云端重试消耗用户额外额度，必须计次、可关、默认有限 |

## 三、我们缺什么（对照结论，逐项对 `lib/study.js` 实读）

| 缺 | 现状（实读行号） | 本轮动作 |
|---|---|---|
| ① 题目去重 | `normalizeLLM` 171-184 行只做字段裁剪，`localAnalyze` 87-126 行按片段生成，**两处都无去重** | 加 `dedupeQuestions`，两引擎出口统一调用 |
| ② 生成结果校验 | `llmAnalyze` 210-214 行只做 JSON 解析 + 规范化，**不校验来源声明是否与材料边界一致** | 加 `validateGeneration` 本地可执行校验 |
| ③ 有限重试 | 206-209 行只调一次 `llm.chat`，无重试、无降级 | 加代码控制的重试循环，预算 1 次，保留最佳草稿 |
| ④ 质量过程可见 | 结果只有 `note` 文本，前端 `study-ui.js` 94 行只显示 `a.note` | 后端吐 `quality` 结构，前端渲染质量报告卡 |
| ⑤ 重试可注入测试 | `llm.chat` 是硬引用，测试无法构造「第一次坏、第二次好」 | `analyze` 支持 `opts._chat` 注入（仅测试/内部用，不暴露到 HTTP 参数） |

**阶段零检查点**：搜了 4 组真实项目、23 条逐字符锚点，功能基准是「分层去重 + 可执行校验 + 代码控制的有限重试 + 诚实降级 + 过程可见 + 成本计次」；我们现在有材料边界、来源双标、试卷脱敏、批改巩固，**缺 ①②③④⑤，本轮全加**。上一轮打回的两项由此转正，Obsidian 体系 / 树形分类 / 主密码加密仍不打回本轮。

## 四、R/C/N 融合决策表

| 候选 | R（合定位吗） | C（逐字符证据） | N（非加不可吗 / 更轻替代） | 结论 |
|---|---|---|---|---|
| 归一化 + SHA256 精确指纹 | 纯本地零依赖，合零云端 | 锚点 10/12 | 精确重复是硬缺陷，O(n) 极轻，无更轻替代 | **采纳** |
| 字符 bigram + Jaccard 近似去重 | 与「零成本可预测」同调 | 锚点 1/12/13 | 只做精确指纹会漏改标点的近重复 | **采纳** |
| 阈值可配（默认 0.82 / 严格 0.9） | 不硬编码 | 锚点 13/14/15 | 硬编码必踩「太高留重复、太低误删」 | **采纳** |
| 返回重复对、保留原件 | 与「不造假」同源 | 锚点 11/14 | 静默删题用户永远不知道少了什么 | **采纳（硬红线）** |
| **本地可执行校验器**（代码，非模型自评） | 与 maxloop Oracle Gate 同源 | 锚点 19/20/21/22 | 让模型自评幻觉＝最低可靠信号，CRITIC 明确证伪 | **采纳（本轮最关键）** |
| 重试预算固定 1 次 | 云端花钱，必须封顶 | 锚点 4/17/23 | 无限重试烧钱且违反 clinmesh 额度纪律 | **采纳** |
| 保留最佳草稿 + 返回停止原因 | 防「越改越差」 | 锚点 21/22 | 不保留就可能返回更差版本 | **采纳** |
| 预算耗尽诚实降级 / 显式标注 | 与「不造假」同源 | 锚点 18 | 静默放行等于把幻觉端给用户 | **采纳（硬红线）** |
| 质量报告对用户可见 | 直接对上「app 网页端程度」 | 锚点 18 | 黑盒改进用户无法验证，等于没做 | **采纳** |
| RAGAS 式 LLM-as-judge Faithfulness | 语义判定更强 | 锚点 5-9 | 要额外模型调用（用户多花钱）且需依赖，与零依赖冲突；本地结构化校验已覆盖本项目可判的失效面 | **打回 → KNOWN-LIMITATION** |
| 语义嵌入去重（SBERT / sentence-transformers） | 能抓 "cat vs feline" | 锚点 16 | 要下模型、装依赖，撞「双击即用」；显式标注词法去重的边界即可 | **打回 → KNOWN-LIMITATION** |
| Self-Refine 多轮自我改写 | 文献有 +20 收益 | 锚点 19/20 | 无外部反馈的自我纠错在事实任务上会变差，与 Oracle Gate 直接冲突 | **打回（红线）** |
| 放宽 CSP 让前端直连模型做校验 | — | 锚点 19 | 校验恰恰不该再引入一个模型调用，且会拆掉零外链 | **打回（红线）** |

## 五、关键推导：为什么校验器是代码，不是再问一次模型

两条路摆出来，先证伪一条：

- **路 A：让模型自检「你刚才有没有编造」**。CRITIC 与 Huang et al. 的结论一致——没有外部反馈时，模型改对答案和改错答案一样勤快，自我纠错在事实上不可靠甚至倒退（锚点 19/20）。Agent Reflection 把「开放自评」列为**最低**可靠信号（锚点 22）。且每多一次调用都让用户多付一次钱。**打回**。
- **路 B：本地代码核验结构化事实**。我们的结果里有一批**机器可判**的硬字段：`origin=source` 的题必须带 `source.file`，且这个文件必须在本次材料边界 `included` 里；题干/答案不能为空；选项题的答案必须落在选项内；`origin=ai` 的题必须写明「材料未直接覆盖」。这些不是「意见」，是**关于草稿本身的事实**（锚点 22 的 High 档）。校验器输出结构化问题清单，控制器据此决定接受/重试/降级。**采纳**。

**诚实边界**：这是「结构性 groundedness」，不是 RAGAS 那种语义 Faithfulness。它抓不到「模型把原文改写成一个似是而非的错误结论」。这条限制必须写进 KNOWN-LIMITATION，不许把本地校验说成能测出所有幻觉。

## 六、未找到清单（诚实边界）

- `shoshinL/FLASH` 的去重与重试**一手源码细节**：本轮检索被同名项目淹没，未取到；沿用上一轮锚点 25 的二手引用并标注。
- 除 RAGAS「4,000+ stars」外，`DejaText` / `self-healing-rag` / `clinmesh` / `dsh-prompt-lint` 的 star 数：本轮检索结果未给出，不编数字。
- 中文题干的最优 Jaccard 阈值：没有找到公开实测基准。本轮取 0.82（介于 LobeHub 默认 0.8 与 `dsh-prompt-lint` 0.85 之间），**必须用判别测试在本项目样本上验一遍**，不宣称最优。
- 无需联网、能在浏览器内跑的语义嵌入去重方案：沿用上一轮结论，与「双击即用」冲突，未引入。

## 七、KNOWN-LIMITATION（本轮显式交接）

- 词法去重抓不到语义改写（"cat" vs "feline"），阈值是经验值不是最优值。
- 本地校验只判结构事实，判不出「改写后的错误结论」；真正的语义 Faithfulness 需 LLM-as-judge，会额外花钱，未做。
- 云端重试固定最多 1 次，用完即降级/标注，不会无限自我修正。
- 本轮所有云端链路验证用可注入 mock，**未真发任何外部请求、未使用真实密钥**。

## 八、实测回填（本轮收尾，2026-11-06）

- 中文题干阈值 0.82：判别测试用「完全相同 / 归一化后多一字 / 完全不同」三档样本，验过能区分精确指纹层与近似 Jaccard 层，且阈值调到 0.99 时近重复不再被合并。未做大规模最优阈值搜索，仍标经验值。
- **判别测试 baseline-fails 有效**：未改的 `lib/study.js` 上跑新测试为 35 通过 / 6 失败，改后 54 通过 / 0 失败。失败项全是新质量断言，旧功能没被误伤。
- e2e 91 → 103（新增阈值可配 5 条、质量报告 8 条，并补一张滚动到出题参数区的真截图，避免只靠 DOM 断言当视觉证据）。全套 234 项全绿、零未捕获 JS 报错、零外部域名请求。
- 两种 exe 在纯英文路径重打包：asar 28 条目含全部新文件，产物时间戳晚于源码；桌面版 CDP 10/10、单文件版 CDP 10/10。
- 三通道 server / Electron / api-client **零改动**：`Object.assign({}, opts, { cfg })` 整对象透传，新增的 `dedupeThreshold` 自动到达后端。这验证了「改动封在业务层」的边界判断。
- 真跑暴露并修掉两个缺陷，都写进今日记忆：① 本地引擎没有重试概念却报「首次生成即通过校验」（改为显式传 `local_no_retry`）；② 质量卡「得分 —」占位符（`qualityOf` 漏传 `score`）。前者由 e2e 断言逼出，后者由结果页截图逼出。
- 未做且仍列 KNOWN-LIMITATION：语义嵌入去重、LLM-as-judge 语义 Faithfulness、Self-Refine 多轮自我改写、截图 OCR、树形无限层级分类。
