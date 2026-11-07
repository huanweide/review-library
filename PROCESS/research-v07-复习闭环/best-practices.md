# 阶段零 · v0.7 复习闭环与数据完整性对照（2026-11-08 凌晨）

> maxloop 模式 A 阶段零产物。**所有基准逐字符来自真实命令 / 检索输出**，不引用二手转述冒充证据；查不到写「未找到」。
> 本轮主题不是「再加几个功能」，而是把 v0.6 库层已经做对的能力**接到用户手边**，并补掉会让数据无声消失的缺口。

## 一、逐字符证据锚点

### 1.1 真实 GitHub 仓库（`gh api repos/<owner>/<repo>` 匿名只读，2026-11-08 00:5x 实跑）

```
ankitects/anki                             32648★ | Anki is a smart spaced repetition flashcard program
open-spaced-repetition/fsrs4anki            4128★ | A modern Anki custom scheduling based on Free Spaced Repetition Scheduler algorithm
open-spaced-repetition/ts-fsrs               859★ | ts-fsrs is a versatile package written in TypeScript that supports ES modules, CommonJS, and UMD.
st3v3nmw/obsidian-spaced-repetition        2615★ | Fight the forgetting curve by reviewing flashcards & entire notes on Obsidian
logseq/logseq                              45508★ | A privacy-first, open-source platform for knowledge management and collaboration.
siyuan-note/siyuan                         47119★ | An open-source, privacy-first, self-hosted knowledge workspace where humans and AI agents work together
TriliumNext/Trilium                        38732★ | Build your personal knowledge base with Trilium Notes
nextapps-de/flexsearch                     13818★ | Next-generation full-text search library for Browser and Node.js
lucaong/minisearch                         6193★ | Tiny and powerful JavaScript full-text search engine for browser and Node
ankidroid/Anki-Android                     12186★ | AnkiDroid: Anki flashcards on Android. Your secret trick to achieve superhuman information retention.
```

补充元数据（同一命令，`.pushed_at` / `.license.spdx_id`）：

```
ankitects/anki                     pushed_at=2026-11-07T09:45:11Z license=NOASSERTION
open-spaced-repetition/ts-fsrs     pushed_at=2026-11-06T10:09:40Z license=MIT
st3v3nmw/obsidian-spaced-repetition pushed_at=2026-11-01T07:30:58Z license=MIT
nextapps-de/flexsearch             pushed_at=2026-06-28T18:05:03Z license=Apache-2.0
lucaong/minisearch                 pushed_at=2025-09-16T12:43:59Z license=MIT
```

### 1.2 Anki 官方手册逐字引用（docs.ankiweb.net/studying.html；filtered-decks.html / backups.html 用 curl 实取）

> "After clicking on a deck to study, you'll see a screen that shows you **how many cards are due today**. This is called the 'deck overview' screen ... To start a study session, click the **Study Now** button."

> "**Questions** When a card is shown, **only the question is shown at first**. After thinking about the answer, either click the **Show Answer** button, or press the Space. The answer will then be shown."

> "**Answer Buttons** After the answer is shown, ... select any of the following buttons. **Again** ... **Hard** ... **Good** ... **Easy** ... **Each answer button shows the next time a card will be reviewed again if you select that button.**"

> "**Due Counts** When only the question is shown, Anki shows three numbers ... These represent the new cards, cards in learning, and cards to review."

`filtered-decks.html` 页面目录逐字： Custom Study / Home Decks / Creating Manually / Order / Steps & Returning / **Due Reviews** / **Reviewing Ahead** / Rescheduling / **Catching Up**。
`backups.html` 正文逐字： "Anki will create **automatic backups of your card data**."

→ 基准归纳：**①首屏看得到今天到期多少；②先只给问题、揭示答案后才自评；③四档自评立刻重排下次复习时间；④备份是产品责任而非附加按钮**。

诚实边界：Anki 的学习是 **per-deck（当前牌组 + 子牌组）**，官方手册没有「跨所有牌组一次性复习」的直接实现；我们做「跨书今日复习」是对**多科目期末场景**的适配，不能冒充 Anki 原生行为，只借鉴 due 聚合与 Show Answer 流。

### 1.3 搜索索引基准（正反两面都要看，避免只抄一半）

正面（MiniSearch 6193★ / FlexSearch 13818★ 生态）：
> barz.app： "**Inverted index + decent ranking: not just includes(), but BM25 scoring with configurable fuzzy/prefix options**"；"build a MiniSearch index **lazily** (first modal open or first query), cache sections ... keep the index in module memory"；索引项带 `documentPath` "**used to link back to list cards**"。
> CSDN 原理文： "正排索引 ... 查询时需要遍历所有文档的内容进行匹配，效率是 O(N) ... 倒排索引 ... 避免了遍历所有文档"。

反面（同一检索结果，local-first 实测）：
> thedevs.link《Local-first search》： "on a better-than-average mobile phone ... **this indexing process was taking on the order of 9 seconds**"；"I offloaded this work to a Web Worker"；"Orama's data persistence plugin ... **restoring that still took on the order of seconds, and it also created a huge file on disk**"；最终改用 FlexSearch 的 IndexedDB 持久化索引。

→ **结论：倒排索引不是无条件升级。** 索引重建 / 持久化有真实冷启动代价，本项目目前没有「书多到搜不动」的实测瓶颈证据，本轮按 N 关打回（见第三节），只把「命中结果可定位回原文」这个确定有价值的部分融合。

### 1.4 竞品能力基准（8 类）

| 编号 | 基准能力 | 证据锚点 |
|---|---|---|
| B1 | 首屏 due 聚合 + 一键开始今天复习 | Anki studying.html「how many cards are due today」/「Study Now」 |
| B2 | 先揭示再自评（问题 → Show Answer → 四档） | Anki studying.html Questions / Answer Buttons |
| B3 | 自评立刻影响下次到期时间 | Anki studying.html「Each answer button shows the next time...」 |
| B4 | 数据可携带且**完整**（含设置与学习反馈） | Anki backups.html、Mochi「imports and exports」（上一轮锚点） |
| B5 | 搜索命中能**跳回原文** | MiniSearch `documentPath` "used to link back to list cards" |
| B6 | 备份完整性可见（不静默丢数据） | Anki automatic backups 精神 + 本轮 critic 实测 65MB 静默跳过 |
| B7 | 本地服务最小暴露面 | local-first 工程惯例；本轮实测 `server.listen(PORT)` 未绑回环 |
| B8 | 升级不丢旧数据、不弄坏旧行为 | 上一轮经验报告 §一.2（3 条回归的真实教训） |

## 二、三项对照表：基准有什么 / 我们有什么 / 我们缺什么

| 基准 | v0.6 实际有什么（逐字符锚点） | 我们缺什么 |
|---|---|---|
| B1 | `study.summarizeMistakes` 全量算 due（`lib/study.js:794`）；但只有单书入口 `index.html:231` → `exam-ui.js:153` | 跨书 / 首屏 due 聚合；报告里 `extra-ui.js:153` 只是只读数字 |
| B2 | `lib/cloze.js` 挖空卡 + `extra-ui.js:196-203`「看答案 / 收起答案」 | 揭示后无四档自评；四档只在批改结果页 `extra-ui.js:207` |
| B3 | `study.applyRatings` + `store.recordGrade` 的 rerate 分支确实重排 dueAt | 只认 `examId`，独立卡无法调用 |
| B4 | 备份 `walk()` 递归覆盖 `books/<id>/study/`（含 exams / mistakes / analysis） | 反馈五问在 `localStorage`（`exam-ui.js:167-170`）、设置在 `rl-settings-v1`（`settings.js:9`），**都不在磁盘** |
| B5 | `lib/search.js:26` 返回了 `id` 与 `loc` | `extra-ui.js:111` 渲染时丢掉 `id`，`app.js:141` `openBook(id)` 不接定位参数 |
| B6 | 无 | `lib/backup.js:28` 超过 64MB 静默不 push、无 `skipped`；`exportAll` 返回无完整性字段 |
| B7 | `safeRel` / id 白名单 / 路径穿越防护确实到位 | `server.js:251` `server.listen(PORT)` 监听所有网卡；`/api/backup/import` 的 `mode` 无白名单（`server.js:153-155`） |
| B8 | `store.js:511-520` 跨进程锁 + 原子写覆盖 13 个写方法 | `lib/backup.js:82-108` 是**唯一漏网写路径**：裸 `rmSync` 删整库 + 3 处裸 `writeFileSync` |

> 两位只读 critic（用户视角 / 工程健壮性）各自实跑了探针，其中两条硬输出：
> `学习报告 今日到期=0 | 真实 due 队列=1` → `FAIL`（`analytics.js:64` 只取 lapse 前 12 个再算 dueCount）；
> `含 feedback 的服务端/落盘层：（无）` → `FAIL`。
> 另有 `65MB 资料被静默跳过`、`import mode:'merge' 后 index 与目录不一致` 的复现设计。

## 三、R/C/N 融合决策表（每项必答「不改会怎样 / 更轻的替代」）

| 编号 | 融合项 | R 合理性 | C 正确性（锚点） | N 必要性（不改会怎样 / 更轻替代） | 结论 |
|---|---|---|---|---|---|
| F1 | 反馈五问落盘 `study/feedback.json` + 读回 + 进备份 | 与「数据全在本机」定位一致 | critic 实测 `rl-feedback-` 全项目仅 `exam-ui.js:167` 一处写侧 | 换设备走整库恢复后全丢、且 UI 承诺「记录掌握程度」却永不回显；更轻替代（留在 localStorage）已被证明是缺口本身 | **融合** |
| F2 | 设置（**脱敏**）进备份 | 与 B4 一致 | `settings.js:9` `CFG_KEY`；密钥在 `sessionStorage`，不进备份 | 恢复后引擎 / 地址 / 模型 / 出题参数全回默认；更轻替代（让用户手动重填）等于把备份做成半成品。**apiKey 绝不进备份** | **融合** |
| F3 | 大文件不再静默跳过 + `skipped[]` 完整性字段 + UI 显式告警 + 回收站缺失文件不消耗项 | 诚实降级原则（上一轮已立） | `backup.js:28`、`store.js:323-337` | 用户以为「已导出」实则资料丢失且不可恢复；更轻替代（只加提示不收录）仍会丢数据 | **融合** |
| F4 | 导入走跨进程锁 + 原子写 + `mode` 白名单 + replace 清空 `.trash` + 服务绑回环 | 与 store 既有写入范式一致 | `store.js:60-81,511-520` vs `backup.js:82-108` | 双进程共库时 import 可删掉刚建的书 / 写半截 index；局域网任意 POST 可整库覆盖；更轻替代（前端只传 replace）挡不住直接调 API | **融合** |
| F5 | 报告 `dueCount` 改用全量 `study.isDue` 口径 | 同一软件两处数字必须一致 | `analytics.js:64,74` vs `study.js:794` | 学生看「今日到期 0」以为不用复习，实际漏到期项；更轻替代（改文案）是掩盖 | **融合** |
| F6 | 搜索命中项带 `data-id`，`App.openBook(id, opts)` 定位到资料 / 预览 | 与 README「点结果直接进书」承诺一致 | `search.js:26` 已返回 id；`extra-ui.js:111` 丢弃 | 搜到一句话却要自己翻几百份资料；更轻替代（只切 tab）已证明不够 | **融合** |
| F7 | 跨书「今日复习」视图 + due 队列聚合 | B1 的多科目适配 | Anki studying.html due 数字 + Study Now | 多本书必须逐本深入「练习」页；更轻替代（每本加按钮）仍是碎片 | **融合** |
| F8 | 独立闪卡流：先揭示 → 四档自评 → 回写 SRS（不依赖 examId） | B2/B3 逐字锚点 | Anki Questions / Answer Buttons | 主动回忆闭环断在最后一环；更轻替代（只加按钮不排程）等于没闭环 | **融合** |
| F9 | `npm test` 跑全量判别套件 + e2e 覆盖备份 / 复习 / 定位真实入口 | 与「绿了才算数」一致 | `package.json:12` 只跑 `store.test.js`；`_e2e/e2e.js:686` 备份只查 DOM | 上面 8 项全在自动化盲区；更轻替代（手工跑）不可持续 | **融合** |
| G1 | 倒排索引 / MiniSearch | 合理 | 正面有 BM25 锚点，**反面有 9 秒冷启动实测** | 无本机瓶颈实测数据；引入索引会带来重建与失效维护成本 → 先做基准测量，本轮不加 | **打回**（KNOWN-LIMITATION） |
| G2 | 考试日期驱动排程 | 合理 | RemNote 基准（上一轮） | 与既有 due 队列语义重叠，新增两套排程会让「今日到期」再打架 | **打回**（沿用上轮 R/C/N） |
| G3 | PDF 批注高亮 | 合理 | RemNote PDF reader | 要重写预览渲染层，偏离「资料 → 出题 → 复习」主链路 | **打回** |
| G4 | FSRS ML 权重拟合 | 合理 | fsrs4anki README「optimizer uses machine learning to learn your memory patterns」 | 单机新用户没有成规模复习历史可拟合，抄了就是假装 | **打回** |
| G5 | 云同步 / Obsidian md 双链 | 与零云端定位冲突 | — | 破坏差异化；双链还要换落盘格式 | **打回** |

## 四、未找到清单（诚实边界）

- 未找到 HTTP 与 Electron IPC 之间的功能性路由缺边（两个 critic 逐条核对结论一致）。
- 未找到「老版本数据缺新字段必然抛错」的锚点（store.js 兜底较全）。
- 未找到可越界写入的路径穿越（`safeRel` + id 正则 + extra/trashFiles 校验到位）；**请求体校验与绑定地址是另一回事，不混为一谈**。
- 未找到 Anki 官方「跨全部牌组一次性复习」的直接实现；F7 是我们对多科目场景的自定义适配，文档不冒充官方行为。
- 未找到 MiniSearch / FlexSearch 在本项目数据量下的中文分词与冷启动实测数据（本机未跑基准），故 G1 只标「未验证」，不假装测过。

## 五、检查点（信息优先铁律要求出现）

> 搜了 Anki 官方手册 / 5 个真实高 star 仓库 / local-first 搜索正反两面资料，功能基准是「首屏 due 聚合、先揭示再自评、自评即重排、备份完整且可见、命中可跳回原文、本地服务最小暴露面、升级不丢数据」；我们缺「反馈与设置落盘、大文件不静默丢、导入加锁与校验、dueCount 口径统一、命中定位、跨书复习入口、独立闪卡自评、全量测试基建」，所以这次加 F1–F9 共 9 项；倒排索引等 5 项按 R/C/N 打回。
