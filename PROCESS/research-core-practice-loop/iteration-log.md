---
title: 学习闭环进统一核心 · Oracle Gate 与台账
date: 2026-11-11
tags: [maxloop, Oracle-Gate, 台账, 安全三段, 效率指数]
source: 本轮真跑输出（判别 baseline/candidate、npm test、三套 e2e、node --check、versions/forms 门禁）
---

# 本轮台账（2026-11-11 · maxloop 功能端）

## 一、真问题清单（带逐字符锚点）

| # | 真问题 | 外部可证伪判据 | 证据锚点 | 根因 A→B |
|---|---|---|---|---|
| P1 | 默认入口 `core.html` **只能看、不能练**：题目详情把答案直接摊开，无作答/判分/错题/复习 | 判别 J1–J4、J6–J8；e2e 真点击 | `core-ui.js:456` `$('#qdAnswer').textContent = q.answer`；`core/index.js:75` 门面止于 `getAnalysis`；`core/request.js:75-82` 无 practice 路由；`core/bookStore.js:9-13` 落盘结构无过程数据 | A=默认入口缺作答入口；B=**canonical core 只建模了「资料→分析」，缺「学习过程」这一层数据模型**（不是 UI 少按钮） |
| P2 | 真截图目视抓到**统计口径假数据**：显示「0 可练」却渲染着「第 1/4 题」 | e2e 新增断言：读 `.pstat` 首格 `.num` 必须等于 4 | 修复前真截图 `shots/practice-e2e/01-practice-correct.png`（第一次跑，统计为 0） | A=`renderPracticeStats` 用 `summary.total`；B=**后端 `summarize()` 的 total 是「已有练习记录的卡片数」，与「本轮可练题目数」是两个语义**，前端混用 |
| P3 | 我自己的初判错误：「加路由四形态自动生效」 | 独立 critic 给行号反证 | `plugins/dsh-review-analysis/index.js:181`、`plugins/review-analysis/bin/driver.js:58` 都 `new mod.Core()` 直接调门面，各维护 action 白名单，不经 dispatch | A=以为所有形态都走 HTTP 分派；B=**插件形态是「直接 require 唯一核心」，不是「HTTP 入口」**。已改 fusion-decisions 并收敛结论 |

> 独立 critic 为全新上下文只读诊断，报告结论已逐条核销；P3 是它纠正 Chair 的判断，按诚实边界保留。

## 二、修复动作（每条过 R/C/N + 根因）

| 改动 | R | C（外部锚点） | N（更轻替代被否） |
|---|---|---|---|
| 新增 `core/practice.js`（内容哈希身份 / 分题型判分 / 排程 / 错题 / 到期队列） | 补 B 层根因 | `analyze.js:86` answer 整句契约、`:345` id 每次重新编号 | 复用 `lib/store.js` → 绑死旧数据格式、四形态够不到 |
| `getQuiz` 返回**脱敏题目**，答案只在 `submitAttempt` 后下发 | 真 active recall | best-practices [B1][B3]、Engram 自动判分边界 | CSS 遮挡 → F12 就能看答案，假隐藏 |
| 选择题/判断题自动判，其余 5 类走四档自评 | 不冒充模型评分 | `analyze.js:18` 7 类题型、`lib/srs.js` 四档 | 拿 `lib/study.js:667` 字符串相等 → 整句答案必判错 |
| 新增独立 `practice.json` | 零迁移、完全可逆 | `bookStore.js` 新增 `_practiceFile` / `getPractice` / `savePractice` | 合并两套 store → 砸数据、不可逆 |
| `core/request.js` 增 5 条路由 + `core/index.js` 增 6 个门面方法 | canonical 单一真源 | `server.js:85`、`app/main.js:49` 共用 dispatch | server.js 另开 API → Electron 够不到 |
| `core.html` 增「练习」tab + 面板，`core-ui.js` 练习逻辑，`core.css` token 内样式 | 用户点得到 | 真浏览器 25/0 | 加按钮跳旧窗口 → 遮丑，两套 store 仍分裂 |
| 统计「本轮题数」改取列表长度 | 口径同源 | 修复前后真截图 + e2e 断言 | 改后端 total 语义 → 会污染 `summarize` 的其它消费方 |

## 三、Oracle Gate（五项，逐项真跑）

| 项 | 证据（2026-11-11 真跑输出） |
|---|---|
| (a) 目标命令真跑贴输出 | `npm test` **20/20 套件**；`_e2e/e2e.js` **195/0**；`_e2e/core-ui-verify.js` **139/0**；`_e2e/practice-e2e.js` **25/0**；`node --check` **85/85**；`versions:check` 8 处 `1.5.0`；`forms:check` 18 处一致 |
| (b) 改动文件语法/类型 | `core/practice.js` / `core/index.js` / `core/request.js` / `core/bookStore.js` / `renderer/js/core-ui.js` / `test/core-practice.test.js` / `_e2e/practice-e2e.js` 全部 `node --check` 通过；全量 85 文件 0 失败 |
| (c) 真实入口可达性 | 真 Chromium + 真 HTTP server + 本地 mock LLM 真发一次整体分析 → 真点「练习」tab → 选 B 判对 → 选 C 判错 → 今日复习 → 四档自评 → 开放题自评。**网络层硬验** `/practice/quiz` 响应体不含 `answer`/`solution`；DOM 层硬验提交前无答案文本 |
| (d) 修复前失败输出 | `baseline-practice.txt`：**28 条能力判据全红 / exit 1**（`Core.prototype.getQuiz 不存在`、`core/practice.js 未实现`、`no questions`…）。另 1 条绿是「server 就绪」环境前置检查，本就不该计分，已在测试里降级为不计分项，见第五节口径说明 |
| (e) 逐字符证据锚点 | `best-practices.md` 第二/三节（GitHub REST API star 真值 + 逐字引文）；`fusion-decisions.md` 第二节源码行号；本文件第一节锚点；三套 e2e 原始输出；`shots/practice-e2e/` 三张真截图 |

**判别测试红→绿成对**：`baseline-practice.txt`（改码前 `1 通过 / 28 失败 / exit 1`，其中 28 条能力判据全红）
→ 改码后 `28 通过 / 0 失败 / exit 0`。测试文件此后只把 J5c 环境前置项从计分改为不计分，
**未改动任何一条能力断言**；故 28 条能力判据的红→绿一一对应，不是换题凑绿。

**真实入口问题的额外证据**：修复前第一轮 `practice-e2e` 为 `21/1`，唯一红是 e2e 脚本自身
「以为未作答就有下一题按钮」的导航假设错（产品状态机是提交后才出下一题）。改的是脚本、不是产品，
复跑 `24/0`；随后目视真截图抓出 P2 口径假数据，修复并加断言锁住，终态 `25/0`。

## 四、安全三段卡点

1. **不可逆动作**：本轮**零迁移、零删除、零发布、零推送**。新增 `practice.json` 是纯附加文件，
   删掉即回到原状；判别 J7 真验「读练习状态不改 `book.json` 一个字节」。`git` 只做本地 commit，
   push 仍被 GitHub 账户邮箱验证拦截（已知人类动作，不重试、不绕）。
2. **凭据**：工作区全量扫描常见密钥前缀无真命中；既有测试固件里用于验证脱敏逻辑的
   **假密钥字面串**已排除（此处按「绝不落字面值」纪律不复写该串）。
   e2e 只用本地 mock LLM 与占位假 key，不烧真模型、不联网取数（GitHub API 查 star 除外）。
3. **既有契约**：不改任何 DOM id/class（`core-ui-verify` 139 / `e2e` 195 全绿为证）；
   不改 `book.json` / `analysis.json` 结构；不改 `index.html` 旧入口行为；不升版本号（仍 `1.5.0`）。
   新增路由挂 `/books/:id/practice/*`，key 只在 body 且经 `/^[a-f0-9]{16}$/` 白名单校验，
   挡住原型污染与任意路径；`core/request.js` 既有的 `assertSafeId` 对书 id 仍生效。

## 五、效率指数

- 产出级别：**100**（P1/P2 两个真问题均修复且验证过，既有 334 条断言零回归，无遗留红项；P3 为认知修正，已入档）
- 产出时间：**1 个主循环**（阶段零 → critic → 判别红 → 改码 → 真浏览器复检 → 交付）
- 效率指数：**100**

## 六、KNOWN-LIMITATION（不夸大）

1. **DSH 插件 / WorkBuddy 专家形态未暴露练习入口**：它们直接 `require` 主项目 `core/index.js`，
   门面方法已可达（实测 `Core.getQuiz`/`submitAttempt` 均为 function），但各自 action 白名单
   （`plugins/dsh-review-analysis/index.js:57`、`plugins/review-analysis/bin/driver.js:58`）
   未加 `practice` 动作。本轮范围只到「门面可达」，暴露入口属下一轮。
2. **开放题不自动判分**：7 类题型中仅选择题/判断题程序判分，其余 5 类按答案自评。
   这是数据契约下的诚实选择，不是能力缺失；不宣称「AI 批改」。
3. **排程是轻量三状态量模型**，复用 `lib/srs.js`，非官方 FSRS 17 权重 + ML 拟合。
   与本机既有研究结论一致（起步无复习日志，拟合收益为负）。
4. **真 Electron GUI 未跑**（本机 electron.exe 缺失）；双形态验收仍是 HTTP + `file://` 等价桥替身。
5. **真模型未重跑**：本轮不触碰提示词与分析链路，用 mock LLM 验证功能闭环；
   不宣称「真模型一次 API 效果」有新证据（沿用 v6 台账）。
6. **题目身份是整题内容哈希**：题面或选项或答案**任一改动**都会换 key、旧复习史不再跟随。
   与 repeater 的「内容即身份」一致，但答案勘误也会让该题复习史归零，属已知取舍。
7. **baseline 口径**：归档 baseline 由「改码前代码 + 判别测试初版」跑出，含 1 条
   「server 就绪」环境前置绿项；终版测试把该项降级为不计分，故 candidate 为 28/0。
   能力判据 28 条在两版中完全一致，红→绿一一对应。
8. **云端仍未发布**：本地领先 `origin/main` 9 个 commit，卡在 GitHub 账户邮箱验证；
   v1.5.0 待发布批次已包含本轮改动，但未推、未发版。

---

## 续轮（2026-11-11 14:3x）：端到端盘点后的「修真缺陷 + 收口」轮

**阶段零（信息优先）**：本轮是同一 maxloop 的**修复类连续轮**，不新增产品能力。基准沿用本会话
已外查并落盘的 `best-practices.md`（Anki/FSRS/ts-fsrs/repeater/Engram 五仓 API 验真 + 六环
功能基准）；放行判据不来自模型自评，来自 6 次真跑探针的可证伪输出（见下「证据锚点」）。
按 SKILL 0.4「发现真问题 → 轮次修复 → 测试 → 交付真结果」，不重搜、不扩大范围。

**公示即授权，自行执行，不打断用户**（用户「继续」+ 前轮「自己尝试 不要问我」）。

### R/C/N + 根因 A/B（每条改动必过）

| # | 改动 | R 必要性（非改不可吗） | C 正确性（外部锚点） | N 最小性 / 更轻替代为何不够 |
|---|---|---|---|---|
| G1 | `core/bookStore.js` 增加 core 格式判别：`createBook` 恒写 `files: []`（:88），legacy `book.json` 无此字段（lib/store.js:110-121）。`getBook` 对非 core 返回 null、`listBooks` 过滤、`deleteBook` 拒绝、 `_saveBook` 兜底写路径 | **会删用户数据**：实测混放目录里 `deleteBook(legacyId)` 后旧书目录与真实 PDF 均不存在，legacy `index.json` 留幽灵项；且点开老书 `core-ui.js:102 "+ b.files.length +"` 抛 TypeError | 真跑探针输出「core.listBooks() 含旧版书 / 删除后目录与 a.pdf 均不存在」；`core/bookStore.js:105` `.filter(d => fs.existsSync(this._bookFile(d)))` | 只加只读判别，不改任何已有数据、不迁移、不改 schema。更轻替代「UI 标灰旧版书」挡不住 DSH/专家直接调门面删除，且挡不住幽灵索引 → 否 |
| G2 | 统计与列表同源：`practiceLib.dueKeys/summarize` 增**可选**第三参 `validKeys`；`Core.getQuiz/getDue` 传入当前 analysis 的题目 key 集合 | **统计条显示假数据**：实测重分析后 `getDue(now+30d)` 返回 `dueCount=1` 而 `questions.length=0`；与上一轮修的「0 可练 / 第 1/4 题」同源 | 真跑探针输出 + `practice.js:262 Object.values(s.cards)` / `:251 Object.keys(s.cards)` 全量累计；`core/index.js:105 .filter(q => set.has(q.key))` 只过滤列表 | 第三参可选，不传时旧行为完全不变（保 28 条判别 + 139/0）。**不改 `questionKey` 哈希算法**——改了会让所有已落盘练习记录 key 失效（破坏用户数据），答案勘误归零留作 KNOWN-LIMITATION。更轻替代「重分析弹确认」只让用户选丢或不丢，没碰根因 → 否 |
| G3 | 订正「数据层真隐藏」宣称（`core/index.js:80`、`core.html:135-137`、CHANGELOG、台账） | **不造假铁律**：`/analysis`（request.js:80）原样返回全部答案，`core-ui.js:107` 开书即取、`:558` 导出 JSON 一键下载、`:461` 详情明文 | 唯一标记探针：quiz 无 answer 字段、analysis 含 answer+solution | 只改措辞为「练习视图内隐藏」，**不脱敏 `/analysis`**——本地离线文件本就明文，脱敏会砸 139 条断言与详情/导出，是过度设计 |
| G4 | 交付链：`.bat` 版本校验 + `release.yml` 加测试门禁 | 可预先准备却没做：双击静默开 0.7.0；CI 零门禁，tag 落漂移 commit 照发 | `dist/latest.yml version: 0.7.0`、`启动桌面版.bat:7` 只判存在；release.yml 无 npm test | 只加校验与门禁，不重建 dist（electron.exe 本机缺失，构建留待发布环节） |
| G5 | README 当前口吻的密钥段落按默认入口实情订正 | 公开承诺「只进 sessionStorage」与 `core-ui.js:56` localStorage 明文不符 | 逐行锚点 | 只订正文档，**不改密钥存储行为**（本轮不碰登录态/安全语义，列为下一轮候选） |

**根因 A≠B，两处同修**：
- G1：A=`listBooks` 只判 `book.json` 存在 + 硬删；B=两套 schema 共用一个 `books/` 目录却无格式判别契约 → 修判别契约，不是只补 UI。
- G2：A=统计全量累计旧卡；B=统计与列表两个数据源 + key 依赖非确定的模型答案文本 → 修「同源」，不修哈希（会破坏数据）。

**可证伪判据（新判别测试，旧代码必红）**：J1 混放目录 `listBooks` 不含 legacy / `getBook(legacy)===null` /
`deleteBook(legacy)` 拒绝且资料仍在 / core 书不受影响；J2 重分析后 `dueCount===questions.length`、
`summary.total` 不残留旧卡 / 未重分析时统计正常 / `dueKeys(state,now)` 不传第三参行为不变。

**边界（本轮明确不做）**：不升版本号、不发版、不推（仍卡邮箱验证）；不合并两套 store、不迁移
任何已有书库数据；不改 DOM id/class 契约；不改提示词与分析链路；不改密钥存储；不重建 dist；
不接 DSH/专家 action 白名单（已记录待办）。

---

## 续轮 Oracle Gate（2026-11-11 14:3x，五项全填）

| 项 | 证据 |
|---|---|
| (a) 目标命令真跑贴输出 | `npm test` 21/21 套件；`e2e.js` **195/0**；`core-ui-verify.js` **139/0**（HTTP + file:// 双形态）；`practice-e2e.js` **25/0**；`core-gap-fixes.test.js` **8/0**；`versions:check` 8 处、`forms:check` 18 处 |
| (b) 改动文件语法 | `node --check` 全量 **86/86 bad=0**；`core/index.js` / `core/practice.js` / `core/bookStore.js` / 新判别测试逐个通过；`release.yml` 经 js-yaml 解析 **YAML OK / 10 steps / 含 Test gate + Credential scan** |
| (c) 真实入口可达性 | 三套真 Chromium e2e 全绿（195 + 139 + 25 断言），新增 tab 与 `#practiceHint` 文案未破坏既有契约；bat 版本解析用等价替身真跑 `WANT=1.5.0 GOT=0.7.0 MISMATCH_DETECTED`（不启动 GUI、临时探针已删） |
| (d) 修复前失败输出 | `baseline-gap-fixes.txt`：**能力判据 0 通过 / 8 失败 / exit 1**（J1a 列出两个 id 证明旧书被误列；J1d 旧书资料被删；J2a `dueCount=1 questions=0`）。8 条回归守卫两版恒绿，不计入红→绿判据 |
| (e) 逐字符证据锚点 | 计划表 G1–G5 每条带 `文件:行号`；`core/bookStore.js:105` 原 `.filter(d => fs.existsSync(this._bookFile(d)))`、`core/practice.js:262` 原 `Object.values(s.cards)`、`core/index.js:105` 原 `.filter(q => set.has(q.key))`；6 次真跑探针输出见今日日志 |

**效率指数**：产出级别 A（2 个 P0 + 宣称订正 + 交付链加固）/ 轮数 1 / **效率指数 100**
（无返工、无假绿、无范围膨胀；baseline 一次成红、candidate 一次成绿）。

**安全三段卡点**：
1. **不砸坏**：只读格式判别、不迁移不删任何已有书库数据；重分析旧卡保留为历史；
   bat 只警告不阻断启动；不升版本号、不发版、不推。
2. **不泄密**：凭据扫描工作区全量无真命中；CI 新增 Credential scan 步骤；
   文档订正不含任何真实密钥字面值。
3. **不造假**：主动订正上一轮「数据层真隐藏」不实宣称（历史原文保留、追加订正段，不悄悄改写）；
   e2e 因 CI 缺 chromium 二进制**不写进 CI 冒充门禁**，如实列 KNOWN-LIMITATION；
   `dist/` 未重建也如实写明，不拿 0.7.0 冒充 1.5.0 交付物。

**本轮 KNOWN-LIMITATION**：`_e2e/` 仍不在 `npm test`；CI 门禁只覆盖无浏览器依赖的检查；
`dist/` 仍是 0.7.0；默认窗口密钥仍存 localStorage（行为未改，只订正文档）；
重分析旧卡不自动清理；DSH/专家 action 白名单未暴露 practice；
真 Electron GUI 未跑、真模型未重跑；云端仍未发布（卡 GitHub 邮箱验证）。
