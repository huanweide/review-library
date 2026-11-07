---
title: 复习资料图书馆 · 设置系统 / API 分析 / 出题闭环 阶段零基准
date: 2026-11-06
tags: [maxloop, 阶段零, 设置系统, LLM, 出题, ko-lesson, 零云端转向]
source: 用户提供的截图（小红书 `ko-lesson` 介绍）；本轮 WebFetch 拿到的 Liunian06/ko-lesson README.md 与 SKILL.md 原文；四组 WebSearch 结果
---

# 阶段零 · 外部学习对照表

> 本轮对象：用户指令「建立设置系统 真正做成 app网页端项目 的程度 api可填入 进行分析 得到结果 出题 有类似 @image 这个GitHub项目查询资料建立其中有用的学习起来」。
> 模式：maxloop 模式A（产品深度迭代）。按信息优先铁律，先查「合格的产品长什么样」，再动手。

## 一、真实项目与逐字符证据锚点

### 主锚点：`Liunian06/ko-lesson`（截图项目）

截图里 owner 初读成 `LiuAnde06`，直链返回 `Page not found · GitHub`。检索更正为 **`Liunian06/ko-lesson`**，raw 直链成功取回 README.md 与 SKILL.md 全文。微信实测文提到「431 个星」。仓库只有 3 个文件：`SKILL.md` / `LICENSE` / `README.md`，**无构建步骤**，本质是 Codex 技能规范，不是可运行的 Web App。

| # | 功能点 | 逐字符原文锚点 | 出处 |
|---|---|---|---|
| 1 | 项目定位 | "把课程材料变成可持续学习、可反馈、可复习、可沉淀的 Obsidian 学习系统。" | README 首行 |
| 2 | 不是摘要 | "它不是"总结一下课件"的提示词，而是一套课程学习资料生成规范。" | README |
| 3 | **来源优先**（本轮最值钱） | "来自课程材料的内容必须在 `来源依据` 中标明来源文件、来源位置和使用方式。AI 生成的类比、练习、应用场景和补充解释必须标注为 `AI补充`。" | SKILL.md「来源依据规则」 |
| 4 | 不伪装成原文 | "不要把 AI 补充解释伪装成材料原文。" / "如果材料没有覆盖某个内容，必须明确写明 `材料未直接覆盖，以下为 AI 补充解释`。" | SKILL.md |
| 5 | 材料边界清单 | "会先生成 `课程材料记录.md`，记录本次学习覆盖哪些文件、每个文件包含什么内容、在课程中承担什么作用，以及哪些内容明确不纳入本次学习。" | README |
| 6 | 学习路线重构 | "每个学习单元都标注难度、知识点、来源文件、前置要求和排序理由。" | README |
| 7 | **试卷不含答案** | "`期末考试.md` 只放题目和考试说明，不直接显示答案。" | SKILL.md「期末考试规则」 |
| 8 | 题型四类 | "单选题用于检查基础概念、关键定义和常见误区；多选题用于检查知识点之间的关系、条件边界和易混点；概念解释题用于检查用户能否用自己的话解释核心概念；case study 综合应用题用于检查真实场景中的分析、迁移和决策能力。" | SKILL.md |
| 9 | 不只考记忆 | "不要只考记忆题，必须包含实际应用和知识迁移题。" | SKILL.md |
| 10 | 详细答案六要素 | "- 标准答案：- 详细解析：- 常见错误：- 对应课程文件：- 对应知识点卡片：- 来源引用：" | SKILL.md 详细答案模板 |
| 11 | **只针对薄弱点出巩固卷** | "巩固卷必须只针对错误知识点、薄弱知识点和不确定知识点，不要机械重复整套期末考试。" | SKILL.md 批改闭环 |
| 12 | 批改三判定 | "对每道题判断正确、部分正确或错误。" / "每道题必须标注对应知识点和错因类型。" | SKILL.md |
| 13 | 掌握度六档 | "未接触 / 能听懂 / 能复述 / 能做题 / 能应用 / 能迁移" | SKILL.md |
| 14 | 错因类型八类 | "前置知识缺失 / 术语不理解 / 公式不会用 / 只会背不会解释 / 会看不会做 / 英文题干看不懂 / 概念混淆 / 应用场景不清楚" | SKILL.md |
| 15 | 反馈五问 | "我能复述的内容：我卡住的地方：当前难度评分，1 到 5：我希望下一步：这个知识点让我联想到的已学内容：" | README |
| 16 | 不加入无法验证的承诺 | "不要加入无法验证的生成承诺。" | README「开发」原则 3 |

### 辅锚点：设置系统 / 双引擎 / 密钥安全

| # | 项目 | 逐字符原文锚点 | star / 出处 |
|---|---|---|---|
| 17 | OpenAI-compatible 三字段契约 | "模型名称 / API 基础 URL / API 密钥"；"API 域名 / API 密钥 / 模型"；"API 地址 / API Key" | Open WebUI / ChatBox / LobeChat 配置文档（Yeapht/AIstudioProxyAPI `docs/client-examples.md`） |
| 18 | 自定义服务商 | "如果你的模型服务商没有列出的名字但它提供 OpenAI 兼容接口可以在"自定义 OpenAI 服务商"填两个信息 Base URL 和 API Key" | LobeChat 实践文 |
| 19 | keyVaults 结构 | `"keyVaults":{"openai":{"apiKey":"user-key","baseURL":"https://your-proxy.com/v1"}}` | LobeChat `settings-url-share.mdx` |
| 20 | 不把 key 放 URL | "LobeChat does not verify the correctness of the settings parameters in the URL, nor provide encryption or decryption methods. Please use with caution." | 同上 |
| 21 | 星标基准 | "Open WebUI 自部署 Web 146k / NextChat 88.5k / LobeHub 80.5k / Cherry Studio 48.8k / Chatbox 41.1k / LibreChat 40.9k" | UnifyLLM 2026-07-20 查询 |
| 22 | **双引擎真实先例** | "All processing can happen locally on your machine using Ollama, meaning your documents never leave your computer. You can also connect to OpenAI-compatible cloud APIs if you prefer." | `diomir0/idlearn` README |
| 23 | 设置页填 key | "Enter your OpenAI API key in Settings" | `shoshinL/FLASH` README |
| 24 | 生成后人工审阅 | "User Review: User generated cards to the user for final editing and accepting/rejecting cards to be saved." | `shoshinL/FLASH` |
| 25 | 题目去重 + 反幻觉重试 | "Deduplicates the questions from all of the questioning chunks"；"(Retries once if the answer was judged to be hallucinated.)" | `shoshinL/FLASH` |
| 26 | 前端动态配置 | "前端设置面板中也可以动态配置" | Open-NotebookLM README |
| 27 | 100% 本地路线 | "Privacy-First 100% Local… No API Calls: Zero data sent to external servers" | `varivashyap/Agentic-and-Generative-AI-Project` |
| 28 | **密钥不落盘** | "API keys stored in `sessionStorage`, never logged or sent to app server disk"；"No Logging Policy - NEVER log API keys to console or commit to repository" | OpenSpec `Security & Privacy Model` (deepwiki) |
| 29 | 测试连接 | "Before marking a key as valid, the system tests it against OpenRouter's `/api/models` endpoint" | OpenSpec `hooks/useSessionStorage.ts:186-209` |
| 30 | 明文存储危险 | "Never store plaintext OpenAI, Anthropic, or Gemini API keys in localStorage." | Aldian Fazrihady, Client-Side Web Crypto API |
| 31 | 主密码加密方案 | PBKDF2 100000 轮 + 随机 16 字节 salt + AES-GCM 256 位 + 12 字节 IV | 同上 |

## 二、功能基准（合格产品该有什么）

| 维度 | 基准 |
|---|---|
| 设置系统 | 引擎开关、baseURL、apiKey、model、温度/题量等参数、测试连接、保存/清空、状态反馈 |
| 分析 | **分析前先列材料边界**（纳入哪些文件、各自作用、明确排除哪些）→ 产出结构化结果（知识点/重点/难点/来源） |
| 来源纪律 | 每条结果与每道题标 `来源依据`（文件+位置+用法）或 `AI补充`；材料未覆盖必须写明 |
| 出题 | 单选 / 多选 / 概念解释 / 综合应用四类；不只考记忆；题目与答案分离 |
| 答题与批改 | 试卷不含答案 → 答题卡 → 详细答案（含解析、常见错误、来源引用）→ 批改三判定 + 错因类型 |
| 巩固闭环 | 只针对错题/薄弱点出下一套，循环到掌握度达标 |
| 反馈 | 五问反馈入口 + 掌握度六档 + 错因记录 |
| 密钥安全 | 不落盘、不进日志、不进文档、不发自家服务器、可测试连接、可一键清空 |
| 运行形态 | 本地/云端双引擎，不填 key 也能完整用 |

## 三、页面结构基准（合格 Web App 该分几页）

书架 → 书内资料 → **设置（全局）** → **分析工作台**（选材料 / 看边界 / 跑分析） → **结果页**（知识点 + 来源标注） → **练习页**（试卷 / 答题卡 / 批改 / 巩固卷） → 统计/回收站。

我们现在有：书架、书内资料、预览、回收站、组合检索、统计雏形。**缺：设置、分析工作台、结果页、练习页**。

## 四、我们缺什么（对照结论）

| 缺 | 现有 | 本轮动作 |
|---|---|---|
| ① 设置系统 + API 三字段 | 无 | 加全局设置页 + `sessionStorage` 密钥 + 测试连接 |
| ② 双引擎 | 只有本地 `insight.js` 规则抽取 | 抽象统一引擎接口，加 LLM 引擎走本地代理 |
| ③ 材料边界清单 | 有层级/组合检索，但无「本次分析纳入/排除」清单 | 分析工作台先出边界清单，用户勾选才跑 |
| ④ 来源依据 / AI补充 双标 | 系统提纲只有 `derivedFrom` 回链 | 升级为结果级与题目级强制字段，UI 显式分色 |
| ⑤ 出题 + 批改 + 巩固卷 | 无（考点罗盘有零反馈但不在此项目） | 加试卷/答题卡/详细答案/批改/巩固卷闭环 |
| ⑥ 密钥安全 | 无 key 概念 | sessionStorage + 不落盘 + 不进日志 + 可清空 |

## 五、R/C/N 融合决策表

| 候选 | R（合定位吗） | C（有逐字符证据吗） | N（非加不可吗 / 更轻替代） | 结论 |
|---|---|---|---|---|
| 来源依据 / AI补充 强制双标 | 与「不造假」铁律同源 | 锚点 3/4 | 不加盖会分不清原文与模型编造，无更轻替代 | **采纳** |
| 分析前材料边界清单 | 与「成百上千资料」直接相关 | 锚点 5 | 防漏关键文件，且让用户自己划范围 | **采纳** |
| 试卷与答案分离 | 与考点罗盘「交卷前零反馈」同构 | 锚点 7 | 不分离就退化成看答案 | **采纳** |
| 批改后只针对薄弱点出巩固卷 | 复习闭环核心 | 锚点 11/12 | 机械重复整套无价值 | **采纳** |
| 四类题型 + 不只考记忆 | 出题质量下限 | 锚点 8/9 | 只出单选题太弱 | **采纳** |
| 掌握度六档 + 错因八类 | 结果页状态字段 | 锚点 13/14 | 两个枚举即可，不引复杂模型 | **采纳（精简为字段）** |
| 反馈五问 | 轻量，一个表单 | 锚点 15 | 不是必须，但成本极低、直接支撑巩固 | **采纳** |
| 生成后人工审阅再保存 | 防 AI 编内容进库 | 锚点 24 | 与双标互补，必要 | **采纳** |
| 题目去重 / 幻觉重试 | 质量增强 | 锚点 25 | 第一轮可不做，先用提示词约束 | **打回 → KNOWN-LIMITATION** |
| OpenAI-compatible 三字段契约 | 覆盖绝大多数服务商 | 锚点 17/18/19 | 最小可用配置 | **采纳** |
| 双引擎（本地 / 云端） | 保住零云端默认 + 满足用户新指令 | 锚点 22/27 | 单云端会毁掉原有能力 | **采纳** |
| key 存 sessionStorage + 测试连接 | 本地单机场景够用 | 锚点 28/29 | 不落盘即不泄漏到文件 | **采纳** |
| PBKDF2+AES-GCM 主密码加密 | 更安全 | 锚点 31 | 零基础用户每次要输主密码，负担大；sessionStorage 已把窗口缩到单标签页 | **打回 → KNOWN-LIMITATION** |
| Obsidian 双链 / 媒体库 / 知识点 md 卡片 | 与本项目「数据库 + 网页」形态冲突 | — | 我们是结构化记录，不是 md 文件库 | **打回** |
| 逐课反馈 / 全量生成 / 一课一知识点 / 故事模式 | 网页端一次性分析出题，不是逐课 md 生成 | — | 范围膨胀 | **打回** |
| 截图逐字翻译 / OCR | 需视觉模型，撞零依赖 | — | 无真实输入链路 | **打回（标未找到可行轻量方案）** |
| 把 key 放进 URL 分享设置 | 直接违反凭据铁律 | 锚点 20 明确警告 | 禁止 | **打回（红线）** |

## 六、关键架构推导：CSP 与 API 通道

现有顶层 CSP 是 `connect-src 'self'`，浏览器**直接** `fetch` 外部大模型地址会被硬拦。两条路：

- **A 放宽 CSP 加白名单**：等于把零外链铁律拆了，且用户填什么域名就得放行什么域名，无法预先约束 → **打回**。
- **B 走本地 server 代理**：前端只请求同源 `/api/llm/*`，由本地 Node 服务转发到用户填的 baseURL。key 只在请求内存的 `Authorization` 头里出现一次，不落盘、不写日志、不进任何文件。CSP 不动，零外链从浏览器视角仍然成立 → **采纳**。

Electron 模式没有 http server，需在主进程里用 `net`/`fetch` 做同样的转发，经 ipc 暴露，保持前端只调 `window.API`，不感知通道差异。

## 七、未找到清单（诚实边界）

- `ko-lesson` 的**准确 star 数**：直链 404 + 检索只给微信文的「431 个星」二手数字，未拿到 API 一手数据 → 标约 431，不写精确值。
- `ko-lesson` 是否有课程包结构校验脚本：README 路线图写「增加课程包结构校验脚本」，即**尚未实现**，无源码可锚定。
- 纯前端 pptx 版式还原仓库：上一轮已标未找到，本轮未重搜，沿用结论。
- 无需云端、又能在浏览器内跑的小模型出题方案：检索到的 100% 本地方案都要装 Ollama / 下 4GB 模型，与「双击即用」冲突 → 本轮不引入，本地引擎维持规则抽取。
- 用户所指 API 的**具体服务商**：用户只说「api 可填入」，未指定。按判断优先推定为 OpenAI-compatible 通用格式（baseURL + key + model），覆盖官方 / 国内聚合 / 本地 Ollama，设计上不做厂商绑定。

## 八、KNOWN-LIMITATION（本轮显式交接）

- 云端引擎调用会产生**用户自己的 API 费用**，且资料文本会发往用户填的那个地址。这是用户主动改约束的结果，设置页必须用大白话写明，不能默默发生。
- 本地引擎不产生新知识，只做规则抽取与模板出题，质量低于 LLM。
- 密钥存 `sessionStorage`：关标签页即失效，需要重填；共享电脑/恶意软件仍可能读到内存中的 key（无主密码加密）。
- 题目去重、幻觉重试、截图 OCR 本轮不做。

## 九、v0.5 回填（2026-11-06 晚，保留上方原判不删）

上一节第 4 条与本文件第五节决策表「题目去重 / 幻觉重试 → 打回 → KNOWN-LIMITATION」是 v0.4 当时的真实判断，**原文保留，不改写历史**。后续一轮「继续」把这两项转正，实现如下，供下一轮接手时对齐：

- 新阶段零基准：`PROCESS/research-出题质量增强/best-practices.md`（4 组检索、23 条逐字符锚点、R/C/N 决策表）。
- 去重：归一化 → SHA256 精确指纹 → 字符 bigram + Jaccard 近似 → 阈值可配（默认 0.82，设置页可调）→ 返回重复对、原件保留不静默删。依据 `DejaText` 与 LobeHub Content Deduplication。
- 幻觉校验：改为**本地可执行的结构化校验**（来源文件是否落在材料边界内、AI补充是否写明未覆盖、字段是否为空、知识点是否悬空、答案是否越界），**不让模型自评**。依据 CRITIC / Huang et al. ICLR 2024 与 Agent Reflection「controller 由代码写」。
- 重试：代码控制、预算固定 1 次、保留最佳草稿、返回停止原因、耗尽后诚实降级（剥除未核验来源 + 强制标 AI补充 + 显式告知），不猜、不静默放行。依据 `self-healing-rag` 与 `clinmesh` 额度纪律。
- 过程可见：结果页新增「生成质量报告」卡，展开可看每一步校验轨迹与被合并的题。依据 `self-healing-rag` 的 trace panel。
- **仍未做**：截图 OCR、RAGAS 式 LLM-as-judge 语义 Faithfulness、语义嵌入去重、主密码加密。理由见新文档未找到清单与 KNOWN-LIMITATION。
