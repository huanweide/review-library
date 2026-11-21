# workbench 整体优化 · 外部基准对照（2026-11-19）

> 阶段零产物。基准来源：WebSearch 逐字锚点（StudyStudio / AFFiNE / Siyuan），不是凭印象。
> 用途：回答"搜了什么、基准是什么、我们缺什么、所以这次改什么"。

## 一、搜了什么（三组查询）

1. `document knowledge workbench app features analysis mindmap outline quiz empty state onboarding best practice self-hosted`
2. 命中同类直接竞品 **StudyStudio**（本地 AI 学习工作台：思维导图+笔记+题库+读上下文 AI）+ **AFFiNE**（文档/白板/数据库一体）+ **Siyuan**（块编辑器+闪卡+SRS）。

## 二、功能基准（逐字锚点）

**StudyStudio**（jxxy.net/ai/articles/studystudio-local-ai-learning-workbench，原文摘录）：
> "学科空间按学科管理全部内容…思维导图支持节点编辑、拖拽连线、自动布局与批量操作，还能关联笔记和任务…题库覆盖单选、多选、填空、判断、简答与解答题，含解析与答题记录。AI 助手是差异化所在：多供应商多模型切换、流式对话、附件理解、工具调用…让它读着你当前打开的导图和笔记来生成新导图、拆解学习任务或补充练习题。"

**AFFiNE**（affine.pro，via watcha.cn）：
> "将文档编辑、无限画布、数据库和 AI 能力整合在同一个工作空间中…支持离线使用、本地数据存储、可选云端同步及自托管部署，并提供 AI 辅助写作、内容总结、思维导图和演示文稿生成等能力。"

**Siyuan**（siyuan-note/siyuan，via lambdabase）：
> "combines note-taking, outlining, and mind mapping in a block-based editor…a spaced repetition and flashcard system supports learning…self-host the entire infrastructure for complete data sovereignty."

## 三、基准 vs 我们 vs 缺什么

| 基准能力 | 我们 workbench 现状（实测） | 差距判定 |
|---|---|---|
| ① 知识空间组织 | 书架/书详情，13 导航视图来自 manifest，能力清单单一源 | ✅ 有，且比基准更"能力统一" |
| ② 思维导图编辑/布局/关联 | 三布局（右向/双侧/组织）+ 点节点看讲解；skill 已装 | ✅ 有（本项目强项） |
| ③ 笔记/Markdown | 资料可加说明/标重点，但不是编辑器 | ⚠️ 定位不同（我们是复习产出，不是笔记工具），不改 |
| ④ 题库多题型+解析+记录 | quiz/practice/due/attempt/rate 全链路 + SRS 四档自评 | ✅ 有，SRS 比基准还全 |
| ⑤ AI 读上下文生成 | 整体分析 → 导图/提纲/题型；考点大全/考纲/幻灯片生成按钮 | ✅ 有，但**未分析书的引导自相矛盾**（见真问题） |
| ⑥ 空状态引导 | 有引导卡，但混入"看错误详情" | ❌ **真缺陷**：正常空状态被当错误 |
| ⑦ 导入导出/本地优先 | PWA + SW 缓存壳 + 本地服务，数据落盘 | ✅ 有 |

**结论**：功能骨架齐全，不缺大功能。真差距是**状态语义混乱**（⑥）——把"未分析"当"错误"，是体验瑕疵不是功能缺失。按 N 关（必要性）不追着基准加新功能，只修这个真缺陷。

## 四、本次据此改什么

- 只改 ⑥：未分析 ≠ 错误，`S.err` 不承接 get 的"尚无分析结果"，空状态只给一条清晰引导。
- 不改 ③⑤⑦ 等定位差异项——基准是"完整形态"，不是"我们必须长成它"。

## 五、执行结果（21:35 完成）

- **真问题（1 条钉死）**：未分析书空状态混入「看错误详情」。A 出错点 `workbench/src/bookspace.js:178` 把 `get` 的 `error:'该书尚无分析结果，请先整体分析'` 存进 `S.err`，`:358` 据此渲染按钮 → 用户同时看到「先导入资料」和「看错误详情→请先整体分析」两条矛盾引导。B 根因：正常业务状态（未分析）与真异常（网络/故障）共用 S.err 通道，A≠B 同修。
- **R/C/N**：R 合"整体优化功能"定位 ✓；C 有逐字符锚点（get 返回文本 + 源码行号）✓；N 非改不可（误导新用户）、最小修法只动一处判别 ✓。
- **改动**：`bookspace.js` 加状态判别——`S.err = msg.includes('尚无分析结果') ? '' : msg`；真异常仍保留。`sw.js` CACHE v4→v5（否则 SW 缓存旧 js，改了用户看不到——静默失效坑）。
- **判别测试**：新增 `tools/check-empty-state.mjs`（UI 契约静态断言，不冒充能力测试）。baseline（归档版）0/3 FAIL 退出码1；candidate 3/3 PASS 退出码0。
- **Oracle Gate**：(a) 真浏览器清 SW 缓存重载 → 书"5"空状态 `hasErrBtn:false / hasImport:true / hasAnalyze:false` ✓；(b) node --check 语法 ✓；(c) 入口可达（真浏览器点开）✓；(d) baseline FAIL ✓；(e) 逐字符锚点齐 ✓。零 console error。
- **门禁**：图书馆 24/24 套件全过；双端口健康。
- **KNOWN-LIMITATION**：演示书资料清单仍混私人研究笔记（剧情推进Agent/情感提示词等），是内置演示数据，用户没要求清，未动。两套书库（workbench `/api/app` vs 全功能台 `/api/books`）是 README 明示的刻意双形态，非 bug。
