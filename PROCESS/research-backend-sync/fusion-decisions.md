---
title: 后端革命 · 端到端入口同步 · 融合决策与根因（R/C/N + A→B）
date: 2026-11-12
tags: [maxloop, R-C-N, 根因, 融合决策, 入口同步, 契约测试]
source: best-practices.md 对照表 ＋ 我方源码逐行核销 ＋ 计划追踪/对话计划-2026-11-10.md:69 与 :363 ＋ research-core-practice-loop/fusion-decisions.md:35-40
---

# 融合决策表（2026-11-12 · maxloop 模式A）

> 承接 F1 的两笔遗留：①11-10 把「闭环进 core」留到下一轮；②11-11 用零迁移做完闭环后，
> 明确记下「插件 action 白名单未暴露新入口，属另一轮范围」。本轮还的就是第 ② 笔。

## 一、根因 A→B（必答，只修 A 会复发）

- **A 出错点**：
  - `plugins/dsh-review-analysis/index.js:180` — `enum: ['list', 'create', 'add', 'analyze', 'get']`
  - `plugins/review-analysis/bin/driver.js:93` — `'不支持的 action：' + action + '（可用 list/create/add/analyze/get）'`
  - `core/request.js:6` 注释「DSH 插件 / 专家形态直接用 Core 类方法，不经此层」
- **B 设计层根因**：项目只把「路由语义」收成了单一真源（`core/request.js`），**没有把「能力清单」收成单一真源**。三个入口各自手写一份可调用动作的列表，核心新增能力时没有任何机制迫使入口跟上 → 必然漂移。不是「插件少写几个 case」，是**缺一层契约定义**。
- **自检句「只修 B 还会再出现吗」**：只补 5 个 action，下次核心再加方法仍会静默落后 → 必须同时补「能力清单单一真源 + 漂移守卫 + 跨入口契约测试」。只修 A 不算修好。

## 二、逐项决策（R 合理性 / C 正确性 / N 必要性 + 更轻替代被否理由）

| # | 改动 | R | C（逐字符证据锚点） | N（必要性 / 更轻替代被否理由） | 结论 |
|---|---|---|---|---|---|
| **S1** | 新增 `core/capabilities.js`：一份机器可读的能力清单（name → 门面方法 → 所需入参），作为所有入口的唯一真源 | 对齐 Anki `proto/anki`「后端方法定义只存在一份」；补 B 层根因 | `docs/architecture.md`「Anki uses Protocol Buffers to define backend methods」；AnkiDroid「bulk of its code is automatically generated from the service definitions」；我方 `plugins/dsh.../index.js:180` 与 `driver.js:93` 两份手写清单实证漂移 | 更轻替代「只在文档里写一份清单」→ 无机器校验，等于没修 → 否；「从 `core/index.js` 反射方法名自动生成」→ 会把内部辅助方法一起暴露，需再加黑名单，更脆 → 否 | **合** |
| **S2** | `plugins/review-analysis/bin/driver.js` 补齐 practice 五个 action（quiz / due / attempt / rate / practice），全部直调 Core 门面，**不复制任何业务逻辑** | 保持「所有形态只是入口」 | `driver.js:41` `new mod.Core(dataRoot)`；`core/index.js:87,99,104,121,135` 五个门面方法已存在 | 更轻替代「让 CLI 改走 HTTP」→ 引入常驻服务，破坏离线 CLI 形态 → 否 | **合** |
| **S3** | `plugins/dsh-review-analysis/index.js` 同步 enum、description、execute 分支、OUTPUT_SCHEMA | 与 S2 同；DSH 是另一类入口，不能只修一半 | `index.js:180` enum 5 项；`index.js:67-70` `new mod.Core(...)`；`index.js:275` 之后 else 抛「不支持的 action」 | 更轻替代「DSH 不管」→ 端到端同步缺一环，本轮目标不成立 → 否 | **合** |
| **S4** | 新增 `test/core-capability-sync.test.js`：同一临时书库，分别经 **dispatch / CLI / DSH** 三入口跑同一组 practice 用例，断言数据同源 + 能力集合一致 + 漂移守卫 | arc42「Every driven port has two implementations … passing one shared contract-test suite」；把「同步」变成可证伪判据 | arc42 Verification 段；`test/core-unified-sync.test.js:85-118` 现有测试只测启动链路与路由，未跨三入口；`core/index.js:80-84` 明确「答案未脱敏」，故契约测试不得声称「答案未到达客户端」 | 更轻替代「只跑单测看新 action 返回 200」→ 无法证明三入口同源，属自判 → 否 | **合** |
| **S5** | 沿用 `assertSafeId` / `practiceLib` 入参白名单，插件新增分支不裸传 | 零信任入参，与 canonical 同安全级别 | `core/request.js:36-37`；`core/index.js:125-126` `findQuestion` 对 key 做校验并明确报错 | 更轻替代「信任插件调用方」→ DSH 参数来自外部 tool schema，不可信 → 否 | **合** |
| **X1** | 合并 `lib/store.js` 与 `core/bookStore.js`、迁移已有书库 | **R 不过**：本轮对象是入口同步，不是数据层重写 | `对话计划-2026-11-10.md:363`「不合并 store、不迁移数据」；`research-core-practice-loop/fusion-decisions.md:50` | **N 不过**：会砸已有书库（不可逆），且 F1 已用零迁移解开，非改不可的前提不存在 | **否** |
| **X2** | 云同步 / 多设备 / 账号 / CRDT | **R 不过**：违反零云端铁律 | `对话计划-2026-11-07.md:123`「明确不做（打了回的）：云端同步 / 多端（跟零云端冲突）」；`research-core-practice-loop/fusion-decisions.md:44` G6 | — | **否** |
| **X3** | 引入 RxDB / Automerge / protobuf 代码生成 | **N 不过**：新依赖 + 构建链，单机单用户零收益 | best-practices.md 第七节 | 更轻替代 = S1 的纯 JS manifest，已足够 | **否** |
| **X4** | 后端独立常驻进程 / 改 `file://` 形态 | **R、N 不过**：破坏现有双形态，属重写 | `test/core-unified-sync.test.js:110-114` 对 `file://` 相对路径有硬断言 | — | **否** |
| **X5** | 顺手改前端练习 tab / 美化 | **N 不过**：与入口同步无关，能不加就不加 | — | 上轮已验收通过 | **否** |

## 三、可证伪判据（改码前必须先红，两份输出成对才算数）

| 判据 | 旧代码上必须失败 | 改好后必须成立 |
|---|---|---|
| **J1** 能力清单漂移守卫 | DSH enum ∪ driver 可用 action ≠ canonical 能力集合，断言红 | 三处集合完全一致 |
| **J2** CLI 跑闭环 | `--action quiz` 报「不支持的 action」并 exit 1 | 返回题目列表（不含答案下发声明），exit 0 |
| **J3** DSH 跑闭环 | `action:'due'` 返回 `{ok:false, error:'不支持的 action'}` | 返回 dueCount 与题目列表，ok:true |
| **J4** 三入口数据同源 | 无法经由 CLI/DSH 提交作答 | dispatch / CLI / DSH 依次 submitAttempt + rateCard 后，**同一份 `practice.json`** 回读出三条一致记录，且 `getPractice` 在三个入口返回同值 |
| **J5** 不复制业务逻辑 | 无此断言 | 两个插件源码中不出现 `practiceLib.attempt` / `practiceLib.rate` / `fs.writeFile` 等实现痕迹，只出现 `core.<门面方法>` |

> baseline FAIL 输出归档 `baseline-capability-sync.txt`，candidate PASS 输出归档 `candidate-capability-sync.txt`。

## 四、范围收敛（本轮明确不做）

1. 不合并 store、不迁移、不改任何已有书库数据；`practice.json` 之外不新增持久化文件。
2. 不改 `core/request.js` 现有路由语义、不改 `server.js` / `app/main.js` / `renderer/*`。
3. 不改既有 DOM 契约、不改提示词、不改密钥存储行为。
4. 不升版本号、不发版、不推送、不打 tag（上一轮 BC 授权暂缓执行，理由见计划公示第六节）。
5. 不引入任何 npm 依赖、不调真实大模型。
6. 不谎称「答案未到达客户端」——`core/index.js:80-84` 已明确只是练习视图内不渲染。

## 五、借鉴来源标注（skill 3.7 要求）

| 抄了什么 | 来自谁 | 改了什么 | 怎么验 |
|---|---|---|---|
| 「后端方法定义只存在一份」 | Anki `proto/anki` / AnkiDroid 代码生成 | 不用 protobuf，降级为纯 JS `core/capabilities.js` | J1 集合一致 |
| 「多入口共用一份契约测试」 | arc42 hexagonal Verification | 不搞双层 port 实现，直接三入口同跑一组用例 | J4 同源 |
| 「入口只做协议转换」 | Cockburn ports & adapters | 插件直调 Core 门面，不新增 transport | J5 无业务逻辑 |

## 六、执行状态

| 决策项 | 结论 | 执行 |
|---|---|---|
| S1 canonical 能力清单 | 合 | **已执行**：`core/capabilities.js`（ACTIONS / CAPABILITIES / has / isPractice / unsupported）；driver 与 DSH 运行时 require 同一份，不再各自手写 |
| S2 driver 补 5 个 action | 合 | **已执行**：`--key/--given/--rating` 入参 + practice/quiz/due/attempt/rate 五分支，全部直调 Core 门面 |
| S3 DSH 同步 enum/分支/schema | 合 | **已执行**：`enum: CAPS.ACTIONS`、description、key/given/rating 参数、OUTPUT_SCHEMA 加 `data`、五分支 |
| S4 跨三入口契约测试 + 漂移守卫 | 合 | **已执行**：`test/core-capability-sync.test.js`，baseline `11 红 / 4 绿 / exit 1` → candidate `15/0 / exit 0`，两份输出已归档 |
| S5 入参沿用白名单 | 合 | **已执行**：CLI/DSH 只做参数校验与协议转换，key 合法性由 `practiceLib.findQuestion` 兜底，rating 1-4 入口硬校验 |
| X1–X5 | 否 | 维持否决 |

**效率指数**：产出级别 100（J1–J5 全绿且判别成立）/ 轮数 1 / 效率指数 100。

## 七、KNOWN-LIMITATION（不藏在正文里）

- 能力清单是**手工维护**的纯 JS 表，不是 Anki 那种由 IDL 自动生成；核心新增方法时靠 J1 守卫在 CI 报错提醒人来补，不自动长出入口代码。
- 契约测试覆盖 dispatch / CLI / DSH 三入口，**不覆盖 `file://` 直开渲染进程的真实 GUI 交互**（属既有 e2e 范围）；本轮不改那部分。
- `lib/store.js`（legacy）与 `core/bookStore.js` 仍是两套数据层，本轮刻意不合并；旧窗口行为不变。
- 专家形态（driver）与 DSH 插件的 `--action` / `action` 参数名不同，能力名统一但参数面不统一，属历史契约，本轮不动。
- **本机已安装的两个 wrapper 仍是旧版**（`~/.dsh/local-plugins/dsh-review-analysis/index.js` 与 `~/.workbuddy/plugins/marketplaces/my-experts/plugins/review-analysis/bin/driver.js`，实测 practice 命中 0）。`scripts/check-forms.mjs` 在改码前后均报 **9 处既有漂移**，说明两边长期不一致。要让真实形态生效须跑 `npm run forms:sync`，但会覆盖工作区外 9 个文件（可能含手工改动），属需斯瑞拍板的动作，本轮**未执行**。同步后还需确认插件的 `projectRoot` 指向含 `core/capabilities.js` 的主项目根，否则注册期会大声失败。
- 全量门禁 `20/23 套件通过`：通过的较改动前 +1（正是本轮新套件），3 个失败套件为既有环境缺件（`node_modules/pdf-parse/test/data/01-valid.pdf` 缺失、`_backup/2026-11-08-forms` 旧版备份缺失、真实 PDF 渲染 H1–H5），与本轮改动无关。
- 本轮**未跑真浏览器 GUI e2e**：改动只落在 core 新增文件与两个插件 wrapper，不触碰 `renderer/*` / DOM 契约；入口可达性已用真子进程 CLI + 真 ESM 插件加载 + 真 dispatch 三条路径验证，不是靠单测自判。
