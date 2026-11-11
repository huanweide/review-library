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
