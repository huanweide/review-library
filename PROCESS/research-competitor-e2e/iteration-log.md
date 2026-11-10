---
title: maxloop 本轮台账 · 竞品优点融合（1 优化 + 1 美化）
date: 2026-11-10
tags: [maxloop, oracle-gate, R-C-N, 判别测试, 效率指数, 安全三段卡点]
source: 用户 2026-11-10「结合竞品百家所长 开始maxloop优化改进（确认竞品确定是合理的，比我们的合理就开始，然后做好1 美化1哟优化）」
---

# 本轮台账（2026-11-10）

基线：`git HEAD = 8a7077d`（v1.4.0 已发布）。本轮**不发版、不升版本号**。

## 一、阶段零 · 外部基准与采纳门槛

| 动作 | 证据 |
|---|---|
| 复核上一轮阶段零 | `best-practices.md`（24 个仓库 API star 真值、端到端四段逐字符引文）、`fusion-decisions.md`（F1–F8 R/C/N） |
| 补视觉基准（两组） | 英文 2026 dashboard best practice 5 篇 + 中文/开源 DESIGN.md 5 篇；落盘 `visual-benchmark.md`「基准 / 我们 / 缺什么」 |
| 确认「竞品确实比我们合理」 | v5 台账两道样例 `page: 0`、`quote` 模型自报；`core/analyze.js:129` 旧版 `raw.slice(0, 50000)`；对照 DeepTutor「cited page by page」、PageIndex「at 805 pages the document no longer fits in the context window at all」 |
| 否决项 | RAG 分块 / 逐页多次调用 / 两阶段先出大纲 / 播客 / AI 教师 / 多用户协作 —— 与「一次 API 整本整体分析」「本地单机」冲突 |
| 缓做项 | F1 闭环进 core（两套 store 合并需先定迁移边界，属不可逆动作） |

**检查点句式**（skill §一·五 要求）：搜了竞品端到端链路 + 视觉规范共 5 组，基准是
「解析即锚定引用 / 长书按结构处理 / 语义 token 双主题 / minimal chrome / 三态齐全」；
我们缺「页码锚定、引文校验、均衡覆盖、token 体系、深色、三态」，
所以这次加「引用锚定 + 结构化语料」这一块优化、和「token 双主题重写」这一块美化。

## 二、真问题 → 根因 A→B → 改动（R/C/N 全过）

| # | A 出错点 | B 根因（设计层） | 改动 | R / C / N |
|---|---|---|---|---|
| 1 | `core/extract.js` 抽 PDF 只给纯文本 | 解析层丢掉页码坐标，模型无从得知出处 | `pagerender` 逐页注入 `[[PAGE:N]]` + `segmentText()` 切锚点块 | R 服务「图书原图/来源」✅ / C pagerender 签名逐字符核实 `pdf-parse/lib/pdf-parse.js:3,58,86-93` ✅ / N 不锚定则引用永远靠自报 ✅ |
| 2 | `core/analyze.js:129` 从头截断 50000 字 | 语料是无结构字符串，无法按重要性取舍 | `parseCorpus()/composeCorpus()` 按文件均分、跨文件均衡覆盖 | R 保持一次 API ✅ / C baseline C3 实测第三文件全丢 ✅ / N 调大上限只把问题往后推 ✅ |
| 3 | `measureQuality` 只校验 `source.file` 在名单里 | 引文真伪没有程序判据 | `verifyQuotes()` 从送进模型的语料逐字校验，写回 `quoteVerified` / `quoteAudit` | R 竞品共识 ✅ / C 判别 D3 正负例 1/2 ✅ / N 不校验则「效果好」仍靠自评 ✅ |
| 4 | 直接调 `analyze()` 的脚本拿不到锚点 | 锚点只在 `Core.getBookText` 注入，层次放错 | `composeCorpus()` 未截断分支也输出规范化带锚点语料 | R 单一真源 ✅ / C v6 前发现并修 ✅ / N 否则提示词 anchor 约束成空话 ✅ |
| 5 | `mindmap-layout.js:199-233` SVG 硬编码白底黑字 | 渲染层颜色不归主题管 | `toSvg(opts)` + `svgTheme()` 从 CSS 变量注入 | R 深色必备 ✅ / C e2e 实测 `#ffffff → #171b24` ✅ / N 不改则深色一块白 ✅ |
| 6 | `core.css` 渐变顶栏 / 双层阴影 / 14px 圆角 / 只有浅色 | 颜色硬编码散落、无语义 token | 整份重写为 token + 深浅双主题 + minimal chrome + 三态 | R 视觉基准 8 条共识 ✅ / C `visual-benchmark.md` 逐行核销 ✅ / N 纯 CSS、零 DOM 契约变更 ✅ |

## 三、判别测试（baseline 必红 → candidate 必绿）

| 阶段 | 命令 | 输出 |
|---|---|---|
| baseline（v1.4.0） | `node test/core-anchor-v3.test.js` | **通过 4 / 失败 13 / exit 1**，无执行异常 |
| candidate（本轮） | 同上 | **通过 31 / 失败 0 / exit 0** |

逐项红项与旧代码逐字符证据见 `baseline-anchor-v3.txt`。

**反假绿**：全部断言真调函数、真起临时 Core 书库、真解析合法 5 页 PDF；
不查源码文本、不查按钮存在。H 组最初用「手搓 PDF」导致 `bad XRef entry`（默认解析也失败、
只走 native 兜底），差点误判成 pagerender 失效；改用 `pdf-parse` 自带合法夹具
`test/fixtures/anchor-5page.pdf` 后复验通过，教训已记入 baseline 证据文件。

## 四、Oracle Gate（五项，缺一不放行）

| 项 | 证据 |
|---|---|
| (a) 目标命令真跑并贴输出 | `npm test` 19/19；判别 v3 32/0、v2 100/0；双形态 e2e 121/0；真模型 v6 九项全绿 |
| (b) 改动文件 lint / 语法 | `node --check` 73/73（覆盖 core / lib / renderer/js / app / server / _e2e / test / scripts） |
| (c) 真实入口可达 | 双形态真 Chromium：HTTP 与 `file://` 各跑完整流程，实际点击三级下钻、导出、主题切换；`npm ci --dry-run` 通过；版本 8 处 / 形态 18 处门禁 |
| (d) 修复前失败输出 | baseline `4/13 exit 1`，13 个红项逐条列在 `baseline-anchor-v3.txt` |
| (e) 逐字符证据锚点 | 竞品引文见 `best-practices.md` 表格；旧版缺陷见 `git show HEAD:core/analyze.js:129`、`git show HEAD:core/extract.js:28-37`；pagerender 签名见 `node_modules/pdf-parse/lib/pdf-parse.js:3,58,86-93` |

## 五、真模型验证（A 级，用当前代码重跑）

`PROCESS/research-mindmap-v2/real-llm-v6.json`，`deepseek-ai/DeepSeek-V4.1-Flash`，158.0s：

- 15 题 / 6 类题型 / 5 章 12 节 27 知识点，九项判据全绿，思路平均 149 字；
- **`source.anchor` 填写率 15/15（100%）**、**引文命中原文 15/15（100%）**；
- `metrics.thresholds.maxQuestions = 60`，与当前 `DEFAULT_THRESHOLDS` 一致（无 v4 那次阈值漂移）；
- key 从环境变量读、不打印、不落盘；凭据扫描无命中。

**证据边界（不夸大）**：`verifyQuotes()` 只校验「引文是否逐字存在于送进模型的语料」，
不校验 anchor 是否为真实锚点、引文是否支撑该题、答案是否正确、`page` 是否对应真 PDF 页。
语料仍是硬编码 1659 字 + 虚构文件名；台账无上游 response id / usage 哈希，属脚本自报。
15/15 命中**不能**读作「答案都对」。

## 六、安全三段卡点

**① 会砸坏什么（不可逆 / 删改用户数据 / 对外发送）**
- 本轮**没有**不可逆动作：未发版、未打 tag、未 push、未删改任何已有书库文件。
  锚点只改变 `getBookText()` 的**拼装输出**与 `analyze()` 的**内存语料**，不重抽、不改写已落盘缓存。
- 既有不可逆接口（本轮未改）：`DELETE /books/:id` → `bookStore.js:211 fs.rmSync(recursive)` 递归删整书；
  `DELETE /books/:id/files/:fid` → `:180`；`/api/backup/import mode=replace` 整库覆盖。
- 对外发送：真模型验证脚本真调一次 SiliconFlow `/chat/completions`（硬编码语料、消耗额度），
  key 走 `SILICONFLOW_API_KEY` 环境变量；产品 `POST /books/:id/analyze` 会把全书文本发往用户配置的
  baseURL，本轮**新增外发内容仅为语料里的锚点标记**，不含新类别的用户数据。

**② 证据可信度（真跑 / 替身 / 自评）**
- **A 级真跑**：判别 32/0（含真 PDF 解析）、双形态 e2e 121/0、真模型 v6、8 张真截图目视、
  npm test 19/19、node --check 73/73、npm ci dry-run。
- **mock / 替身**：e2e 用本地 OpenAI 兼容 mock LLM 与固定 `ANALYSIS_PAYLOAD`，
  证明「前端三级下钻 / 引文徽章正负例 / 主题与 SVG 换色 / 导出链路」在给定结构数据下真能跑通，
  **不能证明**真模型质量、答案对错、其它 provider 兼容性。
- **B/C 级**：竞品全部只读官方 README / 产品页，未部署、未上传真实资料、未跑一次完整生成；
  视觉基准来自公开规范文章，未做 A/B 用户测试。
- **真 Electron GUI 未跑**（本机 electron.exe 缺失），以 `file://` + 等价 `window.api` 桥的真 Chromium 替身验收。

**③ 发布风险与最小必补动作**
本轮明确不发版，云端最新仍是 v1.4.0，因此**无对外发布风险**。
将来要发：① 升 `1.5.0` 并跑 `versions:sync`（8 处）+ `versions:check`；
② 复跑本台账第四节的 Oracle Gate；③ 打 tag 后核 GitHub Actions 9 步与 Release 5 资产 + `latest.yml`；
④ 上一轮遗留的 GitHub 账户「You must verify your email address」会拦 push，需先在网页端验证邮箱；
⑤ 本轮新增 `test/fixtures/anchor-5page.pdf`（80 KB 二进制）要确认进提交，避免打包缺夹具。

## 七、效率指数（skill §四口径）

- 产出级别：**100**（baseline 13 个红项全部转绿、视觉对照表 8 条采纳项全部落地并验证，无遗留红项）；
- 产出时间：**1 个主循环**（一次收敛；中途 1 次测试夹具诊断修正，未触发 2-3-4 逃逸）；
- 效率指数：**100 / 1 = 100**。

## 八、交付小结（体系化，说人话）

**真问题**：竞品把引用锚定放在解析层，我们把页码交给模型自报；长书从头砍掉后半本；
界面是渐变紫顶栏 + 重阴影 + 只有浅色，深色下 SVG 还会是一块白。

**怎么修的**：PDF 逐页打真页码、文本按块打坐标 → 语料按文件均衡覆盖 → 提示词要求逐字抄锚点 →
程序拿引文回原文校验 → 详情显示锚点与核对徽章；CSS 全量 token 化并加深浅双主题，SVG 颜色跟着主题走。

**怎么证的**：旧代码 13 红 → 新代码 32 绿；真模型 v6 的 15/15 锚点与引文；
双形态浏览器 121 条断言 + 8 张浅/深真截图；19/19 套件、73/73 语法、版本/形态门禁。

**现在状态（2026-11-10 收尾）**：改动已本地提交（`aae9212` → `bf870d0` → `1f15b2b`），工作区干净；
随后升 `1.5.0` 并机械同步 8 处版本常量，CHANGELOG 转为正式 `v1.5.0` 段。
**云端发布被 GitHub 账户邮箱未验证拦截，主 tag 未打、Release 未生成**——
不是代码问题，详见 `release-prep-v150.md`。

**KNOWN-LIMITATION**：引文校验只证存在性不证相关性/正确性；深色无应用内开关；
深色详情弹窗未单独截图；真 Electron GUI 未跑；F1 闭环仍未统一（需先定迁移边界）；
折叠分支搜不到、方向键只在命中间跳转、PDF 页图不渲染等既有遗留未动。

## 九、独立评审状态与通道降级（如实记录，不冒充）

本轮按 maxloop §四派了**全新上下文**的独立 reviewer（`review-worker`，限 15 轮、只读、
只收目标+diff），要求回答 5 问 + 安全三段卡点。两次发消息催收敛（第二次要求
「下一轮直接输出、禁止再调工具」），子代理**始终未返回结论**。

按 SKILL §3.5「通道降级与故障自愈」，降级为 **Chair 亲验**，已覆盖：

- Oracle Gate 五项（第四节），含 baseline 红、改动文件语法、双形态真实入口可达、逐字符证据锚点；
- 全量门禁：npm test 19/19、判别 32/0 + 100/0、e2e 121/0、node --check 73/73、
  版本 8 处 / 形态 18 处、npm ci dry-run；
- 8 张真截图目视（浅 / 深 / 详情 / 徽章），非代码推断；
- 老数据零迁移实证（G1/G2 + `verifyQuotes(老格式)` 返回 `reason: no-quote`、`anchor: undefined`）；
- 凭据扫描、暂存区逐项核对、commit 内版本常量复核。

**证据边界**：Chair 亲验能证明「代码真跑通、需求真落地、无凭据泄漏」，
**不能替代**第三方独立视角发现盲区。本轮**不宣称「已通过独立评审」**；
若评审结论后续返回且发现 P0/P1，走单独 fix commit 并回写本节，不静默吞掉。

**补充（10:44）**：评审子代理最终以 `completed` 结束（耗时 37m36s），但主会话只收到
框架完成通知，**没有收到结论正文**；随后尝试继续追问时团队上下文已释放
（`SendMessage` 返回 `Not in a team`），结论正文无法取回。本节判定维持不变：
仍按 Chair 亲验放行，不宣称通过独立评审，也不把「评审已完成」写成「评审通过」。
若日后从会话归档取回正文并发现 P0/P1，走单独 fix commit 回写本节。

## 十、发布前第二次独立复核：正文仍未送达，Chair 增强复核抓到并修掉 2 处缺陷

**评审通道**：另派窄范围 reviewer（最多 5 轮，只查 P0 / 一次 API 硬需求 / 证据边界 + 安全三段），
6m37s 后框架只返回 `completed` 通知，`TaskOutput` 全快照为空；追问时团队上下文已释放
（`SendMessage` → `Not in a team`）。**连续两轮评审正文未送达**，判定维持
「Chair 亲验放行、不宣称通过独立评审」，不把「完成」写成「通过」。

**Chair 增强复核（真命令，不靠读码印象）**：
- `composeCorpus()` 未截断分支：两文件正文、三个锚点、两个文件头全在，`coverage` 与语料一致 → 无 P0。
- `analyze()` 里 `await chatFn(` 实为 **1 处** → 一次 API 硬需求未破；无第二套 core、无数据格式迁移。
- 老数据（无 `anchor`/`quoteVerified`）走 `verifyQuotes` 返回 `reason: no-quote`、`anchor: undefined`、
  `quoteVerified: undefined`；前端 `core-ui.js:478-479` 仅 `=== true` / `=== false` 才渲染徽章 → **不谎称已核对**。
- v6 台账 `metrics.thresholds` 与 `DEFAULT_THRESHOLDS` 逐字段一致（9 项全等），无 v4 那次阈值漂移。
- CSS 层级：`.modal` 40 / `.side-panel` 45 / `#questionModal` 55 / `.toast` 60 / `.hidden` `display:none!important`
  全在，e2e 已有 `elementFromPoint` 断言 → 旧弹窗遮挡 bug 未回归。

**抓到并修掉 2 处真缺陷**：
1. **引文判据夸大（证据级）**：旧 `verifyQuotes()` 取引文前 40 字做包含判定。真构造样例
   「前 40 字抄原文 + 后段编造」实测 `found=true` 且 `reason=exact-span`，但整段根本不在语料里
   —— 前缀命中被标成逐字核对。改为「全串逐字 / 末尾 ≤6 字容错」两级，新增 `fullHit` 单独计数，
   `reason` 细分为 `exact-span` / `suffix-tolerance` / `no-quote` / `not-in-corpus`；
   只容忍模型省末尾几字，不接受开头抄一段后面自由发挥。
2. **虚构文件名（一致性）**：`composeCorpus()` 截断分支无条件写 `【文件：（未标注文件）】`，
   与未截断分支不一致，且该名字不在注入模型的真实文件名清单里，会误导 `source.file`。
   改为与未截断分支同一契约：无文件名就不写文件头。

**回归防线**：`test/core-anchor-v3.test.js` 新增 I 组 4 条（攻击样例不得命中 / 真逐字判
`exact-span` / 省末尾仍容忍 / 无文件名截断不造头），判别 `32/0 → 36/0`，v2 判别 100/0、
双形态 e2e 121/0 无回归。

**证据链闭环**：判据变了，v6 的「引文 15/15」属旧判据结果，不能冒充当前代码证据
（v4→v5 的教训）。用当前代码重跑真模型 v7，结果见 `PROCESS/research-mindmap-v2/real-llm-v7.json`。

## 十一、全端美化扩展（maxloop 续轮 · 2026-11-10）

**触发**：用户「继续 maxloop 优化全端美化」。上一轮美化只动了默认窗口 `core.html/core.css`，
而 HTTP 端与「视图 → 旧版分层视图」入口用的是另一套 `index.html/style.css`
（旧样式、无深色），桌面深色用户启动还有白闪。目标是把同一套设计系统覆盖到**全部端**。

**根因 A→B → 改动（R/C/N 全过）**

| # | A 缺口 | B 根因 | 改动 | R / C / N |
|---|---|---|---|---|
| 1 | `style.css` 旧样式硬编码散色、无深色 | 缺少单一 token 真源，两套样式各写一套 | 抽 `tokens.css` 单一真源（surface 0–3 / 语义强调色 / 状态色 / 圆角 / 缓动 / 深浅双主题），`core.css` 与 `style.css` 共 `@import` | R 双端一致 ✅ / C e2e 双形态 token 翻转实测 ✅ / N 不抽则改一处漏一处 ✅ |
| 2 | `style.css` 白字落会翻转的 token 背景、状态色装饰边框深色不翻转 | 浅色白字假设在深色 token 背景上失效；边框色不随主题翻转 | 9 处状态色装饰边框改用 `--locate/--ok/--warn/--line` 等 token；白字落 token 背景改 `var(--bg)` | R 深色可读 ✅ / C e2e 深色 computed 真翻转 ✅ / N 否则深色一坨白字 / 边框刺眼 ✅ |
| 3 | 桌面深色用户启动先白闪 | `openWindow` 未设 `backgroundColor`，窗口 chrome 在 CSS 首帧前是白 | `app/main.js` 引 `nativeTheme`，`backgroundColor` 按 `shouldUseDarkColors` 设 `#10131a`/`#f6f7f9` | R 无白闪 ✅ / C 判别测试新增强背景色断言 ✅ / N 否则深色体验断裂 ✅ |

**Oracle Gate（续轮五项）**

| 项 | 证据 |
|---|---|
| (a) 目标命令真跑 | `npm test` 19/19；双形态真 Chromium e2e **139/0**（新增 `index.html` 浅/深 × HTTP/file:// 四态验收）；`node --check app/main.js` OK |
| (b) 改动文件语法 | `node --check app/main.js` 通过；`test/core-unified-sync.test.js` 增补 `nativeTheme` 桩 + 默认窗口 `backgroundColor` 断言，19/19 不回归 |
| (c) 真实入口可达 | `index.html` 在 HTTP 与 `file://` 下 stylesheet 挂载、`.hidden` 全 `none`（@import 链生效）、body 背景 `#f6f7f9 ↔ #10131a` 真翻转、顶栏 `#fff ↔ #171b24` 真翻转；4 张浅/深真截图目视无白块 |
| (d) 修复前失败输出 | `style.css` 原 13 处残余硬编码（含白字落 token 背景对比度塌陷、状态色边框深色不翻转）；`core-unified-sync.test.js` 因缺 `nativeTheme` 桩 `exit 1`（`TypeError: ...shouldUseDarkColors`） |
| (e) 逐字符证据锚点 | `tokens.css` 数值与旧 `core.css` 逐字一致（保 e2e 不漂移）；`main.js:openWindow` diff；e2e `legacy-*` 四张真截图 |

**残余硬编码审计（如实，非缺陷）**：`style.css` 仅剩 `.cover{color:#fff}`（彩色封面白字，正确）与
`.demo-mode{background:#1f2430;color:#fff}`（固定暗色演示提示条，正确）。`core.css` 残余 0。

**证据边界**：e2e 用 mock LLM + `file://` 等价桥替身，证「CSS / 主题双形态真生效」，不证真模型质量；
真 Electron GUI 仍未跑（本机 electron.exe 缺失），但 `nativeTheme` 行为已在判别测试桩中锁住。

**效率指数（续轮）**：产出级别 100（双端设计系统一致 + 深色无断裂 + 白闪消除，零遗留红项）；
产出时间 1 个主循环；效率指数 100。
