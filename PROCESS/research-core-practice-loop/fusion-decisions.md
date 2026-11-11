---
title: 学习闭环进统一核心 · 融合决策与根因（R/C/N + A→B）
date: 2026-11-11
tags: [maxloop, R-C-N, 根因, 融合决策, F1]
source: best-practices.md 对照表 + 我方源码行号 + research-competitor-e2e/fusion-decisions.md 的 F1 决策
---

# 融合决策表（2026-11-11 · maxloop 功能端）

> 承接 `research-competitor-e2e/fusion-decisions.md` 的 **F1「闭环进 core」**（当时标「下一轮最高优先」，
> 因「两套 store 合并需先定迁移边界」未动）。本轮用**零迁移切法**解开这个死锁：
> 不合并 store、不迁移任何已有书库，在 core 书库目录内新增独立的学习过程数据层。

## 一、为什么 F1 之前卡住、这次为什么能动

| | 上一轮判断 | 本轮复核 |
|---|---|---|
| 阻塞理由 | 「两套 store 合并 + 已有书库迁移」属不可逆动作，须先定边界 | **这个假设是错的**：闭环不一定要「搬旧 store」。可以在 core 里**新建一套最小过程数据**，与旧 store 井水不犯河水 |
| 数据风险 | 高（改动 book.json 结构 / 迁移） | **零**：新增独立文件，已有 `book.json` / `analysis.json` / `files/` 一个字节都不改；老书读到新字段缺省即正常显示 |
| 可逆性 | 不可逆 | **完全可逆**：删掉新增文件即回到原状，无残留 |

**根因 A→B（沿用 F1 判定，本轮用代码坐实）**
- A 出错点：`renderer/js/core-ui.js:456` 把答案直接写进可见 DOM；`core/index.js:75` 门面止于 `getAnalysis`；`core/request.js:75-82` 无 practice 路由。
- B 设计层根因：**canonical `core/` 只建模了「资料 → 分析」这一半产品，缺「学习过程」这一层数据模型**，不是 UI 少个按钮、也不是旧 store 没搬过来。只修 A（加个按钮跳旧窗口）问题必然复发——默认入口依旧没有自己的过程数据。
- 自检句「只修 B 还会再出现吗」：把过程数据层补进 core、四形态经 canonical 路由访问，则默认入口与 DSH/专家形态同时具备闭环，不会复发。

## 二、逐项决策（R 合理性 / C 正确性 / N 必要性 + 更轻替代）

| # | 改动 | R | C（证据锚点） | N（必要性 / 更轻替代被否理由） | 结论 |
|---|---|---|---|---|---|
| P0-1 | 题目详情改为**答案默认隐藏、先作答后揭晓 + 即时判分** | 复习工具的核心价值是主动回忆，不是看答案 | best-practices [B1]「answer is hidden by default and grading happens after attempted retrieval」、[B2]「61% vs 40% retention at one week」、[B3]「It makes you answer before you flip」；反例 [D1] `core-ui.js:456` | 更轻替代「把答案折叠成 `<details>`」→ 仍无判分、无过程数据、无复习，兑不了闭环 → 否 | **合** |
| P0-2 | 新增 `core/practice.js`（纯逻辑）+ `practice.json`（每书一份），承载作答记录 / 判分 / per-item 排程 / 错题与到期队列 | 补 B 层根因；保持「所有形态只是入口」 | [D3][D4][D5]；`core/request.js:2-6` 注释「路由语义只存在一份」 | 更轻替代「复用 `lib/store.js`」→ 绑死旧数据格式、跨形态不可达、且等于把 F1 又绕回去 → 否 | **合** |
| P0-3 | `core/request.js` 增 practice 路由，`core/index.js` 增门面方法 | canonical 一处改动，HTTP / Electron 两形态同时生效；DSH / 专家经 Core 门面可达 | `server.js:85` 与 `app/main.js:49` 都调 `requestLib.dispatch(core, ...)`；`app/preload.js:74` `coreRequest` 直通 `core:request` | 更轻替代「在 server.js 另开 /api/practice」→ 破坏单一真源、Electron 形态够不到 → 否 | **合** |

> **独立 critic 复核纠正（2026-11-11，如实记录）**：初稿写「四形态自动生效」是**错的**。
> `plugins/dsh-review-analysis/index.js:181` 与 `plugins/review-analysis/bin/driver.js:58` 都是
> `new mod.Core(...)` 直接调门面方法，且各自维护 action 白名单（如 DSH `index.js:57` 的
> `const actions = [...]`），**根本不经过 `core/request.js` 的 dispatch**。故本轮结论收敛为：
> 逻辑必须挂在 `core/index.js` 门面（保证 DSH/专家能调到），路由只服务 HTTP/Electron 两形态；
> 是否在插件 action 白名单里**暴露**新入口，属另一轮范围（见第六节 KNOWN-LIMITATION）。
| G2 | 排程复用本机既有 Leitner 盒子 + lapse/leech，**不引入 ts-fsrs 依赖** | 零云零依赖，与上一轮地基一致 | 本机 `research-学习闭环/best-practices.md:80-82`；`lib/srs.js` 为无 store 依赖纯函数 | 上 FSRS 需成百上千条复习日志拟合权重，起步为空收益为负 → 否 | **合** |
| G4 | 题目身份用**内容稳定哈希**（题面+答案），重新分析后旧历史不静默错位 | 与 repeater 的 Blake3 身份同思路 | best-practices [C2]「modifying the text produces a new hash and resets that card's performance history」 | 用题目 id → 重新分析换 id，历史错位或丢失；内容哈希更轻且正确 | **合（小）** |
| G5 | 10 种题型自动判分 | **R 不过**：分析结果只有选择/判断/开放三类 | [C3] 是 Engram（45★、2026-10 新建）的形态，非本产品数据契约 | 为不存在的题型写判分器＝堆功能 | **否** |
| G6 | 多设备同步 / 账号 / 云 | **R 不过**：本地离线零云 | — | — | **否** |
| G7 | 番茄钟 / 成就徽章 / 热力图 | **R、N 不过**：与主线无关，能不加就不加 | [A2] 有，但属独立产品线 | — | **否** |
| G8 | 手动深浅主题开关 | **不属于功能端**，上轮已列边界 | CHANGELOG KNOWN-LIMITATION | 不混进本轮范围 | **否（本轮）** |

## 三、范围收敛（本轮明确不做）

1. **不合并 `lib/store.js` 与 `core/bookStore.js`**，不迁移、不改任何已有书库数据结构。
2. **不改 `index.html` 旧入口的任何行为**，旧闭环原样保留。
3. **不改任何既有 DOM id / class 契约**（`core-ui-verify.js` 139 断言、`e2e.js` 195 断言全部依赖它们）。答案区仍保留 `#qdAnswer` 且仍填充答案文本，只是**视觉默认遮罩**、作答后揭晓——保证 `textContent` 断言不假绿也不假红。
4. 不升版本号、不发版、不推（云端仍卡 GitHub 账户邮箱验证）。
5. 不引入任何 npm 依赖、不调真实大模型（本轮全链路用已有 mock 验证手段）。

## 四、可证伪判据（先写在这里，改码前必须先红）

| 判据 | 旧代码上必须失败的表现 | 改好后必须通过的表现 |
|---|---|---|
| J1 答案默认隐藏 | `#qdAnswer` 的 computed 遮罩为 0 / 无遮罩，直接可见 | 未作答时遮罩生效且不可选中，提交后揭晓 |
| J2 提交答案有判分 | 无提交入口 / 提交无任何返回 | 提交返回 `verdict`，并把记录写进 `practice.json`，可回读 |
| J3 答错进错题 + 排程 | `practice.json` 不存在 | 答错后错题数 +1、`dueAt` 按盒子间隔排到未来；四档自评改变 `dueAt` |
| J4 今日到期队列 | 无该路由 | 到期题可捞回，未到期不出现（用可控 `now` 判别，不靠真实时间） |
| J5 canonical 四形态可达 | `core/request.js` 对 practice 路径返回 404 | dispatch 直调 + HTTP + Electron 桥三条路径都能拿到同一份数据 |

> J1–J5 必须以「旧版 FAIL 输出 + 新版 PASS 输出」两份证据成对出现，缺一不算修好。

## 五、效率指数（已填）

产出级别 **100** / 轮数 **1** / 效率指数 **100** —— 详见 `iteration-log.md` 第三、五节。

## 六、执行状态（2026-11-11 收尾）

| 决策项 | 结论 | 执行 |
|---|---|---|
| F1 闭环进 core（零迁移切法） | 合 | **已执行**：`core/practice.js` + `practice.json` + 门面 6 方法 + 5 条路由 + `core.html` 练习 tab |
| P0-1 答案默认隐藏、先答后揭 + 判分 | 合 | **已执行**：练习列表不下发答案（网络层硬验），提交后才第一次返回答案与解析 |
| G2 复用本机轻量排程 | 合 | **已执行**：`require('../lib/srs')`，零新依赖 |
| G4 内容哈希身份 | 合（小） | **已执行**：`questionKey()` sha256 前 16 位，判别 J6 锁住 |
| G5 10 种题型自动判分 | 否 | 维持否决：仅选择/判断自动判，其余走四档自评（不假判） |
| G6/G7/G8 | 否 | 维持否决 |

**新增真问题 P2**（真截图目视抓到，非计划内）：统计条「0 可练」却渲染第 1/4 题，
根因是前端把后端 `summary.total`（已练卡片数）当成「本轮可练题目数」。已改为取列表长度，
并在 e2e 加精确断言锁住。详见 `iteration-log.md` 第一节。

**判据 J1 的实现落点修正（如实）**：初稿写「旧题目详情弹窗改为答案默认隐藏」，
实现时改为**新增「练习」tab 承载先答后揭**，旧弹窗保持「看解析」原样。
理由：旧弹窗是 139 条 e2e 断言的 DOM 契约，改造它会制造回归；而真隐藏的硬要求是
「答案不下发到前端」，与哪个弹窗无关。这个切法更轻（N 关），且 e2e 已用网络层响应体硬验。
