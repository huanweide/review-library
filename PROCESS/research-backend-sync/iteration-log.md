---
title: 后端革命 · 端到端入口同步 · 迭代台账与交付小结
date: 2026-11-12
tags: [maxloop, 台账, Oracle-Gate, 判别测试, 交付小结]
source: best-practices.md / fusion-decisions.md / baseline-capability-sync.txt / candidate-capability-sync.txt / 全量门禁真跑输出
---

# 迭代台账（2026-11-12 · maxloop 模式A · 1 轮收敛）

## 一、真问题清单（逐字符证据锚点，不是「感觉不对」）

| # | 问题 | 证据锚点 | 根因层 |
|---|---|---|---|
| P0-1 | 两个插件入口完全没有「复习」能力 | 改动前 `plugins/review-analysis/bin/driver.js:93`「不支持的 action…（可用 list/create/add/analyze/get）」；`plugins/dsh-review-analysis/index.js:180` `enum: ['list','create','add','analyze','get']` | A 层 |
| P0-2 | 没有任何机制阻止下次再漏 | 全仓无「能力清单」概念；`core/request.js:6` 明写「DSH 插件 / 专家形态直接用 Core 类方法，不经此层」 | **B 层**：只把「路由语义」收成单一真源，没把「能力清单」收成单一真源 |
| P0-3 | 跨入口同源无从证明 | `test/core-unified-sync.test.js:85-118` 只测启动链路与路由契约，未跨三入口跑同一组用例 | A 层 |

核心能力本身不缺：`core/index.js:87-143` 五个 practice 门面方法、`core/request.js:87-101` 五条路由均已存在，HTTP / Electron 两形态可达。**缺的是入口适配层，不是后端重写。**

## 二、改了什么（可改文件集合内）

| 文件 | 动作 | 内容 |
|---|---|---|
| `core/capabilities.js` | 新建 | 10 个能力的单一真源：ACTIONS / CAPABILITIES（含门面方法名）/ has / byAction / isPractice / unsupported；写明「新增能力五步顺序」 |
| `plugins/review-analysis/bin/driver.js` | 改 | `--key/--given/--rating` 入参；`loadCore` 同载 capabilities；`caps.has()` 白名单；practice/quiz/due/attempt/rate 五分支直调 Core 门面 |
| `plugins/dsh-review-analysis/index.js` | 改 | `loadCapabilities(config)` 注册期加载；`enum: CAPS.ACTIONS`；description / key / given / rating / OUTPUT_SCHEMA.data；五分支直调 Core 门面 |
| `test/core-capability-sync.test.js` | 新建 | 15 条判据，跨 dispatch / CLI 真子进程 / DSH 真 ESM 插件三入口 |

**未改**：`core/request.js`、`core/index.js`、`core/practice.js`、`server.js`、`app/*`、`renderer/*`、任何已有书库数据、任何版本常量。零迁移、零新依赖、完全可逆（删新增文件即回原状）。

## 三、判别测试（baseline-fails / candidate-passes 成对）

| | 命令 | 输出 | 归档 |
|---|---|---|---|
| **旧版必红** | `node test/core-capability-sync.test.js`（改码前） | `通过 4 / 失败 11`，`exit 1`；失败含「不支持的 action：quiz」「不支持的 action：due」、三入口状态不同源 | `baseline-capability-sync.txt` |
| **新版必绿** | 同上（改码后） | `通过 15 / 失败 0`，`exit 0` | `candidate-capability-sync.txt` |

> 中途发现并修正测试自身缺陷：`viaCli('__probe_unsupported__')` 未传 args 导致 `args.key` 崩溃，会让 baseline 变成「因崩溃而红」的**假红**。修正后重跑，11 条失败全部由能力缺失引起，判别成立。
> 通过的 4 条（dispatch 提交判分、磁盘同源、J5 两条）是本就成立的回归守卫，恒绿符合判别测试设计。

## 四、Oracle Gate 五项

| 项 | 证据 |
|---|---|
| (a) 目标命令真跑并贴输出 | `candidate-capability-sync.txt` 15/0；`baseline-capability-sync.txt` 11 红；全量 `20/23 套件通过` |
| (b) 改动文件语法检查 | `node --check` 对 `core/capabilities.js`、`plugins/review-analysis/bin/driver.js`、`test/core-capability-sync.test.js` 全 OK；DSH 经真 ESM `import()` 加载并注册 tool 成功 |
| (c) **真实入口可达性** | 不是单测自判：CLI 起真子进程（`spawnSync`）、DSH 真加载 ESM 并捕获 `ctx.tools.register` 的 tool、dispatch 真调 `core/request.js`；三入口依次 submitAttempt + rateCard 后回读同一份 `practice.json` |
| (d) 修复前失败输出 | baseline 逐条列出「不支持的 action：quiz / due / attempt / rate」与 DSH `{ok:false,...}` |
| (e) 逐字符证据锚点 | 见第一节行号、best-practices.md 的 Anki 官方引文与 GitHub API star 真值、本文所有输出文件名 |

## 五、全量门禁

| 项 | 结果 |
|---|---|
| 新增契约测试 | 15/0 |
| 全量单测 / 判别套件 | `20/23 通过`（改动前 `19/22`，**通过 +1 = 新套件，失败集合不变**） |
| 版本一致性 | `✓ 1.5.1（核查 8 处）`，本轮不升版本 |
| 语法检查 | 3 个改动文件全 OK |
| 凭据扫描 | 仅命中环境变量名 `REVIEW_LLM_API_KEY`（误报，非真实密钥）；无 key/token/密码字面值 |
| `check-forms.mjs` | 改前改后均 **9 处既有漂移**，未新增；未擅自同步 |
| 真浏览器 GUI e2e | 未跑（本轮不触碰前端/DOM，理由见 KNOWN-LIMITATION） |

## 六、体系化交付小结（说人话）

**真问题是什么**：五种打开方式里，只有网页和桌面软件能「练」，命令行、DSH 插件、专家工具还停在只看分析。病根不是少写几个按钮——项目只规定了「网址怎么对应功能」，没规定「一共有哪些功能」，于是三张手写清单越走越散。

**怎么修的**：把「一共有哪些能力」收成核心里的一份清单（`core/capabilities.js`），两个插件运行时读它，不再自己抄一份；给两个插件补齐练习/到期/交卷/自评等五个动作，全部只做参数转换、逻辑仍由唯一核心执行；再加一份跨三入口的契约测试，同一组用例在三条路上各跑一遍，谁漏接立刻红。

**怎么证的**：改之前先跑出 11 条失败（旧版明确报「不支持的 action」），改完 15 条全绿；三入口交的卷落进同一份 `practice.json`，是同一份数据不是各存各的。全量套件通过数 +1、失败集合没变。

**现在状态**：仓库源码侧已闭环，本地提交完成，未推送、未打 tag。

## 七、KNOWN-LIMITATION（不藏在正文）

1. **本机已安装的 DSH / 专家 wrapper 仍是旧版**（实测 practice 命中 0）。要真实生效须跑 `npm run forms:sync`，但会覆盖工作区外 9 个文件，且 `check-forms` 显示两边本就长期不一致（可能含手工改动）→ 需斯瑞拍板，本轮未执行。同步后 `projectRoot` 必须指向含 `core/capabilities.js` 的主项目根。
2. **能力清单是手工维护的纯 JS 表**，不是 Anki 那种 IDL 自动生成；核心加新方法时靠 J1 守卫在 CI 报错提醒补，不会自动长出入口代码。
3. 3 个既有失败套件属环境缺件：`pdf-parse` 测试 PDF 缺失、`_backup/2026-11-08-forms` 旧版备份缺失、真实 PDF 渲染 H1–H5；与本轮改动无关，未修（超出本轮范围）。
4. 契约测试覆盖 dispatch / CLI / DSH，**不覆盖 `file://` 渲染进程真实 GUI 交互**（属既有 e2e 范围）；本轮未触碰前端。
5. `lib/store.js`（legacy）与 `core/bookStore.js` 仍是两套数据层，刻意不合并；旧窗口行为不变。
6. 专家形态 `--action` 与 DSH `action` 参数名不同，能力名统一但参数面不统一，属历史契约，本轮不动。
