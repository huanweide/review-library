---
title: 后端革命 · 端到端入口同步 · 高 star 项目功能基准对照
date: 2026-11-12
tags: [maxloop, 阶段零, 统一核心, 入口适配, 契约测试]
source: GitHub API 实时 star 真值（2026-11-12）＋ Anki 官方 docs/architecture.md ＋ AnkiDroid docs/ARCHITECTURE.md ＋ arc42 hexagonal-architecture ＋ 我方源码逐行核销
---

# 后端革命 · 端到端同步（阶段零外部学习）

> 本轮不选「重写后端 / 合并两套 store / 上云同步」这几条路，理由在第六节用 R/C/N 逐条否决。
> 阶段零只干一件事：搞清楚「一个核心 + 多个入口」这个东西，行业里完整形态长什么样。

## 零、对象定义（先把「后端革命」钉死）

「后端革命」不是现成文档标题（全工作区 md 检索 0 命中），是本次口头命名。按三条证据推定其指向：

| 证据 | 逐字符锚点 | 结论 |
|---|---|---|
| F1 被挂起 | `计划追踪/对话计划-2026-11-10.md:69`：「F1 闭环进 core… **本轮不动**：涉及两套 store 合并与已有书库迁移，按「不可逆动作先确认」铁律需先定迁移边界，列为下一轮」 | 有一笔明确的架构级欠账 |
| F1 已用零迁移解开 | `PROCESS/research-core-practice-loop/fusion-decisions.md:11-12`：「不合并 store、不迁移任何已有书库，在 core 书库目录内新增独立的学习过程数据层」 | 欠账主体已还，合并不是必需 |
| 剩余硬缺口 | `core/request.js:6`：「DSH 插件 / 专家形态直接用 Core 类方法，不经此层」；`fusion-decisions.md:35-40`：「各自维护 action 白名单… 是否在插件 action 白名单里暴露新入口，属另一轮范围」 | **核心能力齐了，入口适配层没同步** |

故本轮对象 = **入口适配层的端到端同步**，不是数据层重写。「同步」指「多个入口对同一核心能力的暴露保持一致」，不是「云端/多设备数据同步」（后者见第六节否决）。

## 一、检索组（三组，不搜用户原词）

1. **中文/功能侧**：本地优先 学习软件 数据层 单一真源 多端架构；复习软件 多入口 统一后端
2. **GitHub 开源实现**：Anki rslib / AnkiDroid backend / Joplin / Logseq / RxDB / Automerge
3. **英文 best practice**：hexagonal architecture ports adapters single source of truth；local-first sync engine contract test

> 按 skill 1.5，用户举例只是线索，搜的是「这个东西的完整形态」= 一个核心被多种交付形态复用时的标准结构。

## 二、真实高 star 项目（star 走 api.github.com 实测，2026-11-12，不采信聚合站二手数字）

| 项目 | star 真值 | 逐字符证据锚点 | 它怎么做 |
|---|---|---|---|
| **ankitects/anki** | **32752** | 官方 `docs/architecture.md`：「At the highest level, Anki is logically separated into two parts… The Python library (pylib) exports "backend" methods - opening collections, fetching and answering cards… It is used by Anki's GUI, and can also be included in command line programs to access Anki decks without the GUI.」「the majority of backend logic lives in a Rust library (rslib)」「Anki uses Protocol Buffers to define backend methods」 | 后端逻辑收在 rslib 一处；GUI、CLI、Android 都是入口，通过同一份 protobuf 定义的后端方法访问 |
| **anki-android-backend**（AnkiDroid 同源） | 未单列（Anki 生态） | `docs/ARCHITECTURE.md`：「rsdroid… The bulk of its code is automatically generated from the service definitions in anki/proto/anki」「Every method takes a request structure, and returns a response structure」 | **入口层从同一份服务定义生成**，不是各端手写一份映射 → 从机制上杜绝漂移 |
| **laurent22/joplin** | **57148** | 仓库描述（GitHub API）："Joplin - the privacy-focused note taking app with sync capabilities" | 本地优先 + 可选同步；多客户端共用同一份数据格式 |
| **logseq/logseq** | **45558** | 仓库描述（GitHub API）："A privacy-first, open-source platform for knowledge management" | 本地文件为真源，插件/多端只读同一份 |
| **pubkey/rxdb** | **23424** | 仓库描述："The local-first database that runs on every JS runtime and replicates" | 本地库 + 复制协议（本轮不采，见第六节） |
| **automerge/automerge** | **6728** | 仓库 README（第三方摘引同步快照 2026-11-02 标 6709★，API 实测 6728★） | CRDT 自动合并（本轮不采） |
| **ankitects/anki-connect** | N/A | GitHub API 返回无 stargazers_count | **未找到/不采信**，不写入结论 |

**方法论基准（非 star，是规范）**：arc42 `quality.arc42.org/approaches/hexagonal-architecture` 逐字符：
> "Verification: An architecture test in CI reports zero imports from the core into frameworks, adapters, or drivers. The core's unit-test suite runs without database, network, or container — seconds, not minutes. **Every driven port has two implementations — production adapter and in-memory fake — passing one shared contract-test suite.**"

以及 Cockburn 原始意图（Software Letters 逐字引）：
> "Allow an application to equally be driven by users, programs, automated test or batch scripts, and to be developed and tested in isolation from its eventual run-time devices and databases."

## 三、两份基准（skill 1.5 硬要求：功能清单 + 结构）

### 基准 A · 功能清单（「一个核心 + 多入口」该有什么）

1. **单一真源核心**：业务/数据逻辑只存在一处（Anki rslib），入口不含业务规则。
2. **统一契约定义**：所有入口能调什么，由一份机器可读的能力/服务清单定义（Anki proto/anki）。
3. **入口适配层**：GUI / HTTP / CLI / 插件 各自只做协议转换，不复制映射。
4. **契约测试**：同一组用例跑在**每一个入口**上，结果必须同源（arc42 shared contract-test suite）。
5. **漂移守卫**：CI 里有断言检查「入口暴露的能力集合 = 核心能力集合」，新增能力漏接即红。
6. **依赖方向守卫**：核心不 import 任何适配器/框架（arc42 architecture test）。
7. **零信任入参**：入口层校验 id/参数（Anki 亦对 backend 方法做请求结构校验）。

### 基准 B · 结构（分几层）

```
[交付形态层]  HTTP server.js / Electron main.js / CLI driver / DSH tool / 专家形态
      ↓ 只做协议转换
[入口适配层]  core/request.js dispatch  ·  各入口的 action 白名单
      ↓ 全部指向同一处
[能力清单层]  canonical capability manifest（本轮新增，单一真源）
      ↓
[核心层]      core/index.js 门面（Core 类方法）
      ↓
[数据层]      core/bookStore.js（含 practice.json）  │  lib/store.js（legacy，本轮不合并）
```

## 四、对照表：基准 / 我们 / 缺什么（我方逐字符锚点）

| # | 基准 | 我们有什么 | 缺什么（真问题） |
|---|---|---|---|
| 1 | 单一真源核心 | `core/index.js:87-143` 五个 practice 门面方法；`core/practice.js` 纯逻辑 | — 已有 |
| 2 | 统一契约定义 | `core/request.js:87-101` 5 条 practice 路由，且注释写明「canonical 一处定义」 | **只覆盖 HTTP/Electron；CLI/DSH 没有对应定义，能力清单散在两处手写白名单** |
| 3 | 入口适配层 | `server.js:85`、`app/main.js:49` 都走 `requestLib.dispatch`；两个插件 `new mod.Core()` 直调门面（设计如此） | `plugins/dsh-review-analysis/index.js:180` `enum: ['list','create','add','analyze','get']`；`plugins/review-analysis/bin/driver.js:93`「可用 list/create/add/analyze/get」→ **practice 五个能力一个都没暴露** |
| 4 | 契约测试 | `test/core-unified-sync.test.js` 测「桌面端/服务端启动链路 + 路由契约」；`test/core-practice.test.js` 测核心闭环 | **没有任何测试跨「dispatch / CLI / DSH」三入口跑同一组用例**，也没有断言三入口数据同源 |
| 5 | 漂移守卫 | 无 | **无**：下次核心加新方法，插件白名单照样静默落后（这正是 F1 遗留的形态） |
| 6 | 依赖方向守卫 | `core/request.js` 不依赖 server/electron；插件直调 Core 类 | 部分有，无 CI 断言 |
| 7 | 零信任入参 | `core/request.js:36-37` `assertSafeId`；`body` 交 `practiceLib` 白名单校验 | 插件新增 action 必须沿用同等校验，不能裸传 |

## 五、未找到清单（诚实边界）

- 未找到「复习类软件把插件 action 白名单与核心能力清单自动生成」的现成开源实现；Anki 用 protobuf 代码生成，本项目无该设施，本轮用**轻量 manifest + 契约测试**替代，不引入构建链。
- 未找到适合本项目的零依赖 CRDT / 复制引擎的必要性证据；Joplin/Logseq/RxDB/Automerge 的同步能力均以「多设备」为前提，与本产品零云端铁律冲突。
- `ankitects/anki-connect` star 数 API 未返回，不引用。
- 第三方站点 Automerge star 快照（6709）与 GitHub API 实测（6728）不一致，采用 API 值并标注差异。

## 六、检查点句式（skill 1.5 硬要求，无此句本轮交付无效）

> **搜了** Anki/AnkiDroid 架构文档、Joplin/Logseq/RxDB/Automerge 五个高 star 项目与 arc42 hexagonal 规范，**功能基准是** ①单一真源核心 ②统一契约定义 ③入口适配层 ④跨入口共享契约测试 ⑤漂移守卫 ⑥依赖方向守卫 ⑦零信任入参；**我们有** ①②④的一部分、⑥⑦；**缺** ②的插件侧、④的跨入口部分、⑤；**所以这次加** ⑤（canonical 能力清单 + 漂移守卫）、②的插件侧（补齐 practice action）、④（跨三入口共享契约测试）。

## 七、明确不采纳（R/C/N 详见 fusion-decisions.md）

| 候选 | 否决理由（一句话） |
|---|---|
| 合并 `lib/store.js` 与 `core/bookStore.js` / 迁移书库 | 会砸已有书库数据，不可逆；11-10、11-11 两次明确否决；F1 已用零迁移解开，非必要 |
| 云端 / 多设备同步、账号 | 违反零云端铁律，`对话计划-2026-11-07.md:123` 明确打回 |
| 引入 RxDB / Automerge / protobuf 代码生成 | 需新依赖与构建链，单机单用户无收益，N 关不过 |
| 把「后端」改成独立常驻服务进程 | 破坏 `file://` + Electron IPC 双形态现状，属重写，非必要 |
