# 高 star 同类项目 · 深度理解（2026-11-20 第二轮）

> 上一轮 `best-practices.md` 找到的最同构项目只有 398★。用户要求「继续搜高 star，详细资料与理解他们」。
> 本轮扩大到 star>1000 的真实同类，读了 README + 架构文档 + 核心源码/proto，**理解设计取舍而不是抄功能清单**。
> 所有结论带逐字符锚点；「可用」指仓库真实活跃、协议明确、文档/源码对得上，不等于我方已集成。

---

## 零、一句话理解四个项目

| 项目 | star | 一句话定位 | 它真正解决的问题 |
|---|---|---|---|
| `ankitects/anki` | 32931 | SRS 事实标准，Rust 内核 + proto 契约 | 「什么时候该复习哪张卡」的地基算法与跨端契约 |
| `mengxi-ream/read-frog` | 10499 | 浏览器 AI 翻译 + 闪卡，双 GPLv3/商业授权 | 「阅读中随手把生词变卡片」的零摩擦入口 |
| `st3v3nmw/obsidian-spaced-repetition` | 2621 | Obsidian 插件，笔记即卡片 | 「不建数据库，笔记原文就是卡片源」 |
| `beltromatti/get-it` | 1170 | PDF → 可视化 + 知识图谱 + 四轴掌握度 | 「我能不能答出没见过的问题」——从记忆测量升级为理解测量 |

---

## 一、ankitects/anki（32931★，AGPLv3，Rust）

### 它怎么想
Anki 不是「刷题工具」，是**排程内核**。这套项目把我方记忆的东西做成了正式契约（`proto/anki/` 25 个 proto 文件），且**每种能力一个 proto**：`scheduler.proto` / `image_occlusion.proto` / `cards.proto` / `notes.proto` / `media.proto` / `stats.proto`。
我方 `core/capabilities.js` 注释里写的「对齐 Anki `proto/anki` 的做法（后端方法定义只存在一份，GUI/CLI/Android 都从它派生）」——本轮核实了源头属实：`proto/anki/` 下确有 `backend.proto` 统一服务聚合，各端从同一份契约生成。

### 三个值得理解的机制

**1. 回答前预览四档结果**（`scheduler.proto` 逐字）：
```
message SchedulingStates {
  SchedulingState current = 1;
  SchedulingState again = 2;
  SchedulingState hard = 3;
  SchedulingState good = 4;
  SchedulingState easy = 5;
}
```
含义：不是答完才算状态，**在用户评分之前就能看到四个选择各自会导致什么排程**。这就是「把选择的代价摊开给人看」。
对照我方：上一轮刚做的「答案图延迟」是 retrieval-first 的第一步，但我方没有「四档结果预览」。这是**同理念更深一层**。

**2. 答题耗时入模**（`CardAnswer`）：
```
int64 card_id = 1;
SchedulingState current_state = 2;
SchedulingState new_state = 3;
Rating rating = 4;
int64 answered_at_millis = 5;
uint32 milliseconds_taken = 6;
```
耗时是记忆状态的输入信号，不只是统计展示。我方 `core/practice.js` 的 rating 只取 1-4，没有耗时。

**3. 图片本体与遮挡标注彻底分离**（`image_occlusion.proto` 逐字）：
```
message GetImageForOcclusionResponse { bytes data = 1; string name = 2; }
message ImageOcclusionShape { string shape = 1; repeated ImageOcclusionProperty properties = 2; }
message ImageOcclusion { repeated ImageOcclusionShape shapes = 1; uint32 ordinal = 2; }
message ImageOcclusionNote {
  bytes image_data = 1;
  repeated ImageOcclusion occlusions = 2;
  ...
}
```
图片是 `bytes` 原样传，遮挡区是独立的「形状+属性」列表。**这和我方 `core/images.js` 的决定完全一致**：图存原字节，视觉描述/题图配对是旁证，不改图。32931★ 的架构替我方这个取舍背书。

**4. FSRS 参数是可训练、可模拟、可评估的**（`scheduler.proto`）：
`ComputeFsrsParams` / `SimulateFsrsReview` / `ComputeOptimalRetention` / `EvaluateParams`（返回 `log_loss` / `rmse_bins`）。
我方 `lib/srs.js` 头部已诚实写明「不是官方 FSRS 的 17 权重公式，也没有 ML 权重拟合」。Anki 证明确实存在完整闭环，但我方上一轮 R/C/N 已判定「换 ts-fsrs 打回」——本轮更确认这是**已知差距而非不知道**。

### 为什么不能直接抄
AGPLv3（强传染）+ Rust 内核 + 25 个 proto 的工程量。可抄的只有**架构判据**，不是代码。

---

## 二、mengxi-ream/read-frog（10499★，GPLv3 + 商业双授权，TypeScript/WXT）

### 它怎么想
Read Frog 是**「在学习发生的那一刻顺手存下来」**。README 逐字："save the words you meet and review them as flashcards on an FSRS schedule"、"Content you discover while reading becomes study material without interrupting your flow."
它不要求你先整理知识库——这正好对应用户此前明确说过的「自由＝知道此刻能做什么，不是让玩家写设定」。

### 三个值得理解的机制

**1. 出处必须在「发生的瞬间」抓取**（`src/utils/note-origin.ts` 逐字注释）：
> "The page a selection was made on, read when the selection is made: a save can finish later in the background, where `location` is no longer the page."

而且出处**按来源种类分字段**：
- `getWebPageNoteOrigin` → `{ kind: "webpage", url, title }`
- `getEbookNoteOrigin` → `{ kind: "ebook", ebookId, cfi }`
- `getVideoNoteOrigin` → `{ kind: "video", url, seconds }`

**理解**：事后补出处会失真——后台保存时上下文已经变了。我方上一轮做图片→题配对时靠「抽取时记 caption/context/page」，同理念；但我方没有把「抓取时机」写成硬规则。这条值得固化为判据。

**2. 自定义 AI Action = 用户自己定义提示词 + 结构化字段**（`src/utils/custom-action-prompt.ts`）：
`replaceSelectionToolbarCustomActionPromptTokens` 支持 6 种占位符：`selection` / `paragraphs` / `targetLanguage` / `webTitle` / `webUrl` / `webContent`。
输出契约逐字：
```
## Structured Output Contract
Return exactly one JSON object and nothing else.
### Hard Requirements
1. Include every required key exactly once.
2. Do not add any extra keys.
...
6. If a value is unknown, use null.
```
外加 `CUSTOM_ACTION_CONTEXT_CHAR_LIMIT = 2000` 的上下文硬截断。
**理解**：跟我方 `core/analyze.js` 的「单行紧凑 JSON、字段名固定、禁止额外键」是同一套契约工程，但它把**字段定义权交给用户**。我方目前是写死的七类题型契约。

**3. 规则配置与代码版本解耦**（`AGENTS.md` 逐字）：
> "If a rule depends on code in the same PR, set `\"minExtensionVersion\"` on it to the version that code will ship in... Older versions keep their bundled copy of the rule, or skip a new one. A rule using a field that older versions don't know is skipped by them automatically."

**理解**：规则可热更新（约六小时内推送到已安装扩展），代码仍随 release 走；旧版遇到不认识的字段自动跳过。这直接命中我方反复踩的「改了前端但 SW 缓存没升 → 用户看到旧版」坑——根源是**配置和代码用同一个版本号**。这是本轮最有工程价值的借鉴。

### 为什么不能直接抄
GPLv3 + 商业双授权、浏览器扩展形态、核心是语言学习（翻译/TTS/字幕）不是考点复习。可借鉴的是**出处抓取时机**、**版本解耦**、**结构化契约模板**三个判据。

---

## 三、st3v3nmw/obsidian-spaced-repetition（2621★，MIT，TypeScript）

### 它怎么想
**零卡片数据库**。README 逐字列举卡片语法：
- 单行 `Question::Answer` / 双向 `Question:::Answer`
- 多行 `Question\n?\nAnswer` / 双向 `??`
- 完形 `==highlight==`、`**bolded text**`、`{{text in curly braces}}`
- 卡片上下文 "automatic titles based on headings"：`Note title > Heading 1 > Subheading`
- 牌组靠标签 `#flashcards/YOUR_SUB_DECK_NAME` 或文件夹层级

**理解**：它把「卡片」定义成**笔记文本里的一种写法**，不是一条数据库记录。好处是卡片天然跟着笔记走、可 diff、可 git、可搜索，不需要导入导出。

**和我方的关系**：我方 `questionIndex` 是 analysis.json 里的独立对象，图/文/题分散在 `analysis.json` / `images.json` / `documents/`。这个插件证明「让资料本体携带结构」是可行的另一条路。但我方已经选择了「结构化状态树 + 抽取索引」路线（229 点全收需要模型重编骨架），**不宜中途换架构**。

### 值得理解的取舍
它同时支持 FSRS 和 SM-2，并明确提供 "cram" 模式——`Select a deck to cram`：所有卡都可复习，**算法完全忽略**（README 逐字 "the algorithm is fully ignored"）。
**理解**：承认「临考突击」和「长期记忆」是两种需求，不拿 SRS 教条绑架用户。这呼应中文侧「考搭子」的定位，但我方当前没有 cram 模式。

### 为什么不能直接抄
强绑定 Obsidian 生态。可借鉴的只有**零数据库语法**与**cram 与 SRS 分流**两个判据。

---

## 四、beltromatti/get-it（1170★，Apache-2.0，Next16/Electron/TS）

### 它怎么想
它直接把我方熟悉的东西重新定位了。README 逐字：
> "Flashcard ratings measure recall in the moment. Mind maps measure how much you drew. Summaries measure how patient the AI was. None of them answer the only question that matters on exam day: *Would I survive a question I have not seen before?*"

这是对用户「复习效果」最锋利的一句拆解。它的答案是**四轴掌握度**，不是做题正确率。

### 五个值得理解的机制

**1. 四轴评分 + 单调不减**（technical-writeup.md 逐字）：
| 轴 | 测什么 | 最强信号 |
|---|---|---|
| memory | 随时间Recall | 闪卡评分、定义题正确率、chat 中的回忆引用 |
| comprehension | 用自己的话理解 | chat 中的原创比喻、Feynman 通俗解释、排除干扰项 |
| structure | 概念间连接 | 跨概念多步推理、先决条件引用、兄弟概念辨析 |
| application | 迁移到新情境 | 原创例子、边界情况、新题解答 |

"monotone non-decreasing" 并且运行时用 `clampMonotone` 强制——**"The student can only progress, never regress."** 提示词要求 + 代码 clamp 双保险（agent 不听话也不能抹掉旧证据）。
**理解**：把「评估」当成仪器而不是游戏分数。我方 `core/practice.js` 有 mastery 相关状态，但没有四轴、没有单调钳制。

**2. 无模型质量闸门**（README + writeup 逐字）：
"a fast, model-free quality gate first confirms the PDF is a digital, text-based document under 150 pages; a scanned, image-dominant, or text-sparse file is rejected up front with a clear message instead of silently feeding empty text to the agents."
**理解**：「reads text, not pictures」——不假装能处理扫描件。我方 `core/analyze.js` 已有类似判据：`MIN_TEXT=80`，低于阈值且无图时报 `NEEDS_VISION` / `TOO_LITTLE_TEXT`。同理念，我方已做。

**3. 四种工具产生四种证据，落一份 append-only journal**（writeup 逐字）：
"Every chat message, every card rating, every quiz answer, every Feynman turn lands here with a UTC timestamp. It is the file the evaluator reads... and by design the only thing the system needs to remember about a study session."
且**向后兼容加载**：`loadWorkContext` 回填新增数组和新字段，"so journals written before v1.2.0 evaluate and resume without a migration step"。
**理解**：这是「事件链 + 版本演进零迁移」，和我方 P7/P8 的 append-only 事件链判据同源。

**4. 测验防模型位置偏置**（writeup 逐字）：
"The server **shuffles the options** at generation time with `crypto.randomInt`-driven Fisher–Yates so the agent's positional bias (the model tends to put the right answer at index 0) does not leak to the UI."
**理解**：模型默认把正确答案放第 0 项，直接暴露答案。我方 `normalizeQuestion` 原样保留模型给的 options 顺序，**没有 shuffle**。这是可以直接抄的小改动。

**5. 强制选择题 + Feynman 反过来让学生教**（README 逐字）：
- Quizzes: "one correct answer, three plausible distractors picked to expose the confusion a student would actually trip on"
- Feynman: "The agent plays a curious eight-year-old. *You* teach. The strongest comprehension signal."
**理解**：干扰项要针对真实混淆，不是随便凑三个；Feynman 是最强的 comprehension 证据源。我方有七类题型但没有「强制三干扰项」和「反向教学」。

**6. 失败不自动重试**（writeup 逐字）：
"No background job auto-retries on a model error." 曾有 `setTimeout` 自动恢复导致限流时 tight loop 反复弹横幅，改成「干净停下 + 手动重试」。
**理解**：这和我方上一轮「Node24 undici 退出断言试了两次无效就停手」是同一纪律的架构版——**失败两次不是加大努力，是信息不足**。

### 为什么不能直接抄
24 小时 hackathon 起家（commit `277ec43`），核心沙箱用 `new Function` 是明确的权衡（"defense against LLM mistakes, not against adversarial input"）。可借鉴判据：四轴评估、单调钳制、选项 shuffle、journal 零迁移、失败手动重试。

---

## 五、跨项目共识（四个独立项目都指向的同一件事）

1. **图片/媒体的原字节不能被改写**。Anki 用 `bytes data` + 独立 shape；我方用原字节 SHA 去重 + vision 旁证。两条独立路线收敛到同一结论。
2. **出处要在发生的瞬间抓，且分来源类型**。read-frog 明说后台保存时 location 已变；我方抽取时记 caption/context/page。
3. **LLM 输出必须走结构化契约 + 白名单**。read-frog 自定义字段契约、get-it 九个 prompt 各带 schema、Anki proto 契约；我方 analyze 单行 JSON + imageIds 白名单。
4. **「答题」和「理解」不是一回事**。get-it 说得最狠，Anki 用四档预览把代价摊开，read-frog 用随手存降低入口摩擦。我方刚做的「答案图延迟」是这条线上的一步。
5. **配置与代码必须解耦版本**。read-frog 的 `minExtensionVersion` 是唯一给出完整方案的；我方 SW 版本号手工升级目前仍是脆弱点。

---

## 六、本轮不融合什么（避免下一轮乱加）

按 maxloop R/C/N，本轮**只做理解与基准，不改产品代码**。即使下面几条看起来诱人，也没有当前验收标准支撑：

- 四轴掌握度 + evaluator agent：需要新 agent + journal 改造，用户当前三条验收标准没要求。
- 四档排程结果预览：需要改 `lib/srs.js` 契约，价值真实但属 P2。
- 选项 shuffle：**最轻的一条**（服务端一行 Fisher–Yates），但仍属「防偏置」增强，不是当前真问题，留 P2。
- 自定义 Action 字段：会改 analyze 契约，牵动三端能力清单，不划算。
- 零数据库卡片语法：与我方已定架构冲突，明确不选。
- cram 模式 / Feynman：新功能，用户没要，打回。

**已知差距清单**（知道但不修，避免下次当新问题重新发现）：FSRS 权重拟合未做（Anki 有）、答题耗时未入模（Anki 有）、四轴评分未做（get-it 有）、选项未 shuffle（get-it 有）、SW 配置与代码未版本解耦（read-frog 有方案）。

---

## 七、证据与边界

- 本轮**没有 clone 这四个高 star 仓库**，结论来自 GitHub API 读到的 README / AGENTS.md / technical-writeup.md / proto 源码，逐字符锚点已标在对应段落。
- 上一轮真 clone + 真跑的是 398★ 的 `universal-examprep-skill`（77 测试 OK），那是「可用性确认」的样本；本轮四个是**架构理解**的样本，两者取证等级不同，不混淆。
- read-frog 的 `docs/learning` 等官网文档未逐页读，「自定义 Action 的用户体验」理解基于 README 与源码函数名，未真机跑扩展。
- Anki  proto 只读了 `scheduler.proto` / `image_occlusion.proto`，未读完整 25 个文件；对其算法实现深度不下结论。
