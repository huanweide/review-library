---
title: 思维导图 v2 · 一次 API 完整产出 · 验收与发版台账
date: 2026-11-10
tags: [maxloop, release, oracle-gate, mindmap-v2, one-shot-api, evidence, independent-review]
source: 本轮真实命令输出；两份全新上下文 reviewer 逐行读码结论；真模型 SiliconFlow / DeepSeek-V4.1-Flash v5 调用台账；GitHub Actions 与 Release 公开资产核验
---

# 思维导图 v2 验收台账（2026-11-10）

## 一、需求正本（用户原话，逐字）

1. 「思维导图 市面上最好的思维导图规划（目前基础上，集百家所长）」
2. 「题型分类也放思维导图我说过了，点击题型思维导图对应子题型能够看到所有题目，再点击内如果有图书原图+详细解答+思路，整体用maxloop」
3. 「一次api 完整版本的效果好 效果不好优化提示词语逻辑」

## 二、阶段零与融合（证据链起点）

- `best-practices.md`：4 组真实检索（Xmind / markmap / mind-elixir / 商业 AI 题库 / 一次 API 结构化输出），
  每条结论带逐字符锚点；第三节列「未找到」清单与 §3.7 中途外查（v1、v3 连续失败后强制触发）；
  第五节是发布后追加的事后订正（口径变化，历史原文不改）。
- `fusion-decisions.md`：D1–D14 逐项过 R/C/N + 根因 A→B，另列 6 项「明确不做」与改动白名单；
  第五节是评审订正（「决策要合」≠「已全部落地」）。
- 诚实边界：真 Electron GUI 未跑（`electron.exe` 缺失）；PDF 页图在 `file://` 下受 module CORS 限制，
  只保证「文件名 + 页码 + 引文」文本定位，不谎称显示页图。

## 三、Oracle Gate 五项证据（最终态）

| 项 | 证据 | 结果 |
|---|---|---|
| (a) 真跑 | `npm test` 全量套件 | **18/18 通过**；连跑 3 次均绿，零残留监听端口 |
| (b) lint | `node --check` 遍历 core / lib / renderer / app / test / _e2e / scripts | **72/72 通过** |
| (c) 真实入口可达 | `_e2e/core-ui-verify.js`，真 Chromium 跑 HTTP 与 `file://` 双形态，起本地 OpenAI 兼容 mock LLM，实际点击三级下钻 / 布局切换 / 搜索 / 聚焦 / 导出 / 原图回读 / 可见画布定位 | **103/0 通过**，零控制台错误；截图落 `_e2e/shots/core-ui-verify/` |
| (d) 修复前失败 | `test/core-mindmap-v2.test.js` baseline | **通过 8 / 失败 24 / exit 1** → candidate **100 / 0 / exit 0** |
| (e) 证据锚点 | 每条结论带 `文件:行号` 与真实命令输出 | 判别测试、e2e、真模型台账、两份独立评审四处交叉可查 |

**真浏览器替身边界**：`electron.exe` 缺失，Electron 形态用 `file://` + 注入等价 `window.api`
桥的真 Chromium 验证，能证明渲染层 / CSS 路径 / bridge 分派正确，**不能**证明真实 Electron
主进程打包、asar 内资源与自动更新链路。后者由 CI 打包 + 上一轮 v0.6→v0.8 实测覆盖。

**(c) 的假绿已修**：旧版 F2 只断言默认隐藏的 `#tree` 大纲 DOM 里有 `.highlight`。
现补两条可见层断言（大纲确为隐藏态、可见画布 `.locate` 恰好 1 个），双形态各 +2，99 → 103。

## 四、需求 3「效果好」的 9 项判据与真模型迭代

`measureQuality().checks` 实为 **9 项**：`jsonParsed / fieldCompleteRate / questionCount /
typeCoverage / pathHitRate / placeholderRate / sourceHitRate / answerRichRate / rationaleDepth`。
放行线见 `fusion-decisions.md` 第四节（表中 7 项 + 标题「6 项」是当时规划值，第五节已订正）。
真模型 `deepseek-ai/DeepSeek-V4.1-Flash`（SiliconFlow）单次调用，`corpusLen=1659`：

| 版 | 现象 | 根因 | 改动 |
|---|---|---|---|
| v1 | 吐出两个连写 JSON，22569 字符 | 提示词无「只能一个 JSON 对象」硬约束 | `extractJson` 改括号配平，只取第一个完整对象 |
| v2 | 结构达标但答案只写字母、思路 17 字 | 结构指标抓不到内容质量 | 新增 `answerRichRate` / `rationaleDepth` 判据 + 提示词强调 |
| v3 | 34337 字符 `Unterminated string` | 缩进 JSON 浪费 27–34% token，被 `max_tokens` 截断 | §3.7 外查：单行紧凑 JSON、`finish_reason=length` 显式抛错、预算加 headroom |
| v4 | 24 题 / 6 类 / 9 项全绿 | — | 思路平均 110 字（旧提示词 8-20、判据 60 下的**历史迭代证据**） |
| **v5** | **21 题 / 7 类 / 9 项全绿** | — | **本版验收证据**：用当前代码（提示词 8-24 / 判据 60 / 兼容降级）真跑 149.5s，思路平均 88 字，字段完整率 / path 命中率 / 来源命中率 / 答案含理由率均 1.0 |

**为什么不拿 v4 冒充**：v4 是在旧提示词与不同代码状态下跑的；判据改过之后，
旧台账不能当新代码的验收证据。v5 台账的 `thresholds` 与代码 `DEFAULT_THRESHOLDS`
逐项一致（`maxQuestions=60`），证据链闭合。`real-llm-v5.json` 只存指标与题目摘要，
已扫描确认无 key / token。

**v5 能证明**：当前代码 + SiliconFlow + 这本书，一次调用能产出完整可解析的题目实体且内容达标。
**不能证明**：换模型 / 换中转 / 换学科 / 超长语料同样稳定；mock LLM 的 e2e 只证明前端链路，
不证明模型质量，也测不出上游是否接受 `response_format`。

## 五、两份独立评审的结论与裁决

派了两份全新上下文 reviewer（只读，不改文件 / 不 git / 不发布）。

**共识（两份都实证）**：需求 2 完全达成——题型树真在同一张 SVG 画布、三级点击端到端可达、
raw 路由四层防护（`assertSafeId` → 已登记 fileId → 目录内枚举前缀匹配 → `resolveInside`）
无路径穿越 / 任意文件读取；PDF 诚实只给文本定位；老数据不崩；无密钥硬编码、无 XSS、
无新增写删越权；版本五件套同步、check 8 处一致。

**分歧：`response_format` 兼容性**
- 评审 B（快速收敛）判 KNOWN-LIMITATION：降级重试会破坏「一次 API」硬需求，且是上游能力约束。
- 评审 A（详细）判 P0 条件性：非 SiliconFlow 的 provider 必 400，只验过一家，发布即坏。

**裁决（第一性原理，不盲从）**：要修，但用不破坏硬需求的方式。评审 B 的论证只说明
「不能无条件重试」，推不出「不能异常降级」。实现：正常路径严格一次；仅在上游回
400/404/415/422 且本次确实带字段时，异常路径去掉字段重试一次；401/403 不重试。
判别测试用 mock server 锁定「恰好 2 次调用，首次带 / 重试不带」与「401 只 1 次」。

**我自查发现、评审未看穿的一处语义**：上一轮把判据上限从 60 拟合到单次实测的 24，
造成「25 道全合格题目被判整体失败」；且 v4 台账是旧阈值下跑的，却写进了 CHANGELOG 当
本版证据 = 证据失真。根因是把两个不同语义的数强行统一：提示词「8-24 道」是**期望产出区间**
（引导模型），判据「≤60」是**防灌水 / 防截断兜底**（质量仪表），本就不该相等。
修法：`Q_RANGE` 只驱动提示词，`DEFAULT_THRESHOLDS.maxQuestions` 恢复 60，
加 25 题判别样例锁住，并重跑真模型 v5 闭环。

## 六、发布前清掉的缺陷（评审 + 自审）

| # | 缺陷 | 证据 | 修法与防线 |
|---|---|---|---|
| 1 | 版本同步闭环缺两环 | `check-versions.mjs:56-59` 检查 README 第 3 行，`sync-versions.mjs` 却不写；`package-lock.json` 顶层/根包仍 1.3.1 | sync 补 README 与 lock（写后 `JSON.parse` 复核，只改前两处 version）；`plugins/README.md` 不再写死当前版本。判别 D5 锁 lock 一致性，`npm ci --dry-run` 通过 |
| 2 | 题目数口径打架 + 判据过拟合 | 同段「2-4 道」与「1-3 道」；提示词 8-20；判据一度被拟合到 24 | `Q_RANGE={8,24}` 只驱动提示词，判据上限保持 60 并写清语义；25 题判别样例 |
| 3 | 非兼容中转必 400 | `lib/llm.js` 对非 2xx 直接 reject，无重试；`testConnection` 探测请求不带该参数 | 异常降级重试一次，401/403 不重试；删误导注释；超时文案改真实 `timeoutMs`。mock server 两条判别 |
| 4 | 老分析数据两处坏体验 | `core-ui.js` `q.items.length` 无兜底会抛 TypeError；`if (cnt)` 使无题子题型点了不开发面板 | 补 `|| []`，无条件 `openQitem`（内含「暂无题目」文案）；源码级判别 |
| 5 | e2e 假绿 | F2 只断言隐藏 `#tree` 的 `.highlight` | 补可见画布 `.locate` 断言 + 大纲隐藏态断言，103/0 |
| 6 | CI 的 DSH zip 装错形态 | `release.yml` 打包 `plugins/review-analysis/`（WorkBuddy 专家），产物命名 `...-dsh-plugin-*.zip` | 改指 `plugins/dsh-review-analysis/`（真 DSH，读 `~/.dsh`）；目录清单核对含 `index.js` / `client.js` / `cordis.patch.yml` |

第 6 项上一轮用户曾选「本轮不改，记为遗留项」（当时为避免影响 v1.3.1 紧急重发）。
本轮是正常新版本发布，且该错误会让 DSH 用户下到专家包，故清掉；如需保留旧行为可单独回退这一行。

## 七、版本与门禁（发版前最终态）

```
根 package.json 1.4.0 → versions:sync 同步 VERSION / buildVersion / CORE_VERSION /
                        README 定位行 / lock 2 处 / 2 个源码 manifest / 2 个已安装副本
versions:check   ✓ 版本一致：1.4.0（核查 8 处）
forms:check      ✓ 形态一致且均指向唯一核心（核查 18 处）
npm ci --dry-run ✓ 通过（v1.3.1 曾栽在 lock 上，本轮已闭环）
npm test         18/18 套件
判别测试         100/0（baseline 8/24 exit 1；新增 10 条回归防线）
双形态 e2e       103/0，零控制台错误
node --check     72/72
真模型 v5        21 题 / 7 类 / 9 项全绿，149.5s
凭据扫描         全量 diff + v5 台账均无 key / token 命中
残留监听端口     无（仅 TIME_WAIT）
真实 library     未被 e2e 污染（隔离根）
```

## 八、安全三段卡点（发布前必答）

**① 会砸坏什么（不可逆动作清单）**
- `release.yml` 的 `softprops/action-gh-release@v2` 配 `draft:false / prerelease:false`：
  推 `v*` 即**直接生成正式 Release** 并上传 zip、NSIS、portable、`latest.yml`，对外可见；
  删 tag 抹不掉已发出的资产。本轮只推一个 `v1.4.0` 主 tag，不推专家 tag。
- `Compress-Archive -Force` 覆盖同名 zip；CI 的 `npm ci` 清空重装 `node_modules`（云端，不碰本机）。
- `bookStore.deleteBook` 是 `fs.rmSync(recursive, force)` 删整本书含 `analysis.json`，无回收站；
  唯一防线是 UI 的 confirm。本轮改动**未触碰**任何写 / 删路径。
- 密钥：`lib/llm.js` 的 apiKey 只进 Authorization 头、`scrub()` 抹错误回显；全仓 diff 与 v5 台账
  扫描无硬编码 key。陌生配置（`.mcp.json` / `bypassPermissions` 等）本轮未读，未核验。
- 授权三问：本机单机书库、无登录态 / 多用户会话；raw 只读已登记文件；`server.js` 监听地址与
  鉴权本轮未核验。

**② 证据可信度**
- 两份评审结论均为**静态读码**（未跑测试 / 未启应用 / 未调真模型），「不会运行时崩溃」是
  代码路径推断；本轮已用判别测试与双形态 e2e 把关键推断转成实测。
- mock LLM e2e **能证明**：`validate()` 字段兜底、`extractJson` 括号配平、点击链路可达、
  DOM 与 blob 内容；**不能证明**：真模型稳定产出合规 JSON、上游接受 `response_format`。
- 真模型 v5 **能证明**：当前代码 + SiliconFlow + 这本书一次调用达标；**不能证明**换环境稳定。
- 兼容降级由 mock server 判别测试证明（400 场景恰好 2 次调用），**未**在真实不兼容中转上实测。
- 本地未复现 CI 的 `Compress-Archive` 解包核对：`.NET` 编译（`Add-Type`）被安全策略拦，
  改为 DSH 目录清单核对 + 云端 CI 实跑验证，不谎称已解包验过。

**③ 发布风险与最小必补动作（已逐项核销）**
| 风险 | 处置 |
|---|---|
| R1 `npm ci` 与 lock 版本一致性 | 已同步 lock 2 处 + `npm ci --dry-run` 通过 |
| R2 老分析数据兼容 | 已补两处兜底 + 判别；真实 v1.3.1 `analysis.json` 样本未跑（记为遗留） |
| R3 第三方中转 400 | 已加异常降级 + 文档明示；真实不兼容中转未实测 |
| R4 正式 Release 不可逆 | 用户已授权发布；只推一个主 tag；发布后立即核验资产 |
| R5 CI 打包路径改后未实跑 | 目录清单已核；靠云端 CI 实跑 + Release 资产核验兜底 |

## 九、KNOWN-LIMITATION

- 真 Electron GUI 未跑；自动更新链路靠 CI 产物 + 上一轮 v0.6→v0.8 实机实测，本轮未再真机升级。
- PDF / Office 型资料只给「文件名 + 页码 + 引文」文本定位，不渲染页图（`pdfjs` 为 `.mjs`，
  在 `file://` 下 module 被 CORS 拦，上轮已实测）。
- `response_format` 主流服务支持；个别老旧中转不支持时走异常降级重试一次。「测试连接」
  不发该参数，探测不出此兼容问题；未在真实不兼容中转上实测。
- 搜索基于当前已展开的画布节点，折叠分支里的节点搜不到；方向键只在搜索命中间跳转，
  不做节点间上下左右导航（决策表 D4 / D6 的订正见 `fusion-decisions.md` 第五节）。
- `measureQuality()` 是开发期效果度量，不接生产链路，不会自动判定 / 自动重试（避免破坏「一次 API」）。
- 专家形态 tag（`review-analysis-v*`）复用同一条插件打包步骤，改后同样产出 DSH 目录的 zip；
  本轮只发 `v1.4.0` 主 tag。按 tag 前缀分支打包记为遗留。
- 真实 v1.3.1 落盘的 `analysis.json` 样本未做 `openBook → renderResult` 回放（只做了代码路径
  与判别测试）。PNG 导出只验 blob 生成、未解码像素；MD / OPML 导出不含完整题目详情；
  raw 路由无返回大小上限。均为体验 / 健壮性遗留，不阻塞本版。
- 真模型效果只在 1 本书 / 1 个模型上验证；换模型 / 换学科 / 超长语料稳定性未验证。

---

## 十、发版结果（2026-11-10 · 云端实测）

- commit `93e7e47` → push `ghssh/main`；annotated tag `v1.4.0`（`ec8c201`）→ push `ghssh/v1.4.0`。
- GitHub Actions `Build and Release` run `42784476164`：**9 步全 success**，
  08:40:30 → 08:42:04（1m34s）。`Install dependencies`（`npm ci`）通过，
  `Build (publish never)` 产出 NSIS + portable + `.blockmap` + `latest.yml`。
- Release `v1.4.0`：`draft=false`、`prerelease=false`，`published_at=2026-11-10T08:41:49Z`，
  5 个资产全部 `state=uploaded`：

| 资产 | 字节 |
|---|---|
| `ReviewLibrary-Setup-1.4.0.exe` | 84,628,161 |
| `ReviewLibrary-Setup-1.4.0.exe.blockmap` | 89,047 |
| `ReviewLibrary-1.4.0-portable.exe` | 84,400,077 |
| `latest.yml` | 354 |
| `review-analysis-dsh-plugin-v1.4.0.zip` | 58,421 |

- **自动更新元数据实测**：`latest.yml` 原文 `version: 1.4.0`、
  `path: ReviewLibrary-Setup-1.4.0.exe`、`size: 84628161` 与资产 size 一致，
  `sha512` 与安装器一致，`releaseDate` 正确。文件取自 Release 下载 URL，不是读本地 `dist`。
- **CI 实产物 DSH zip 解包核验**（本机 Python `zipfile`，非推断）：23 个条目，
  顶层为 `dsh-review-analysis/`，含 `index.js` / `client.js` / `cordis.patch.yml` /
  `package.json` / `locale/*.json`；**无**专家形态 `review-analysis.md`、
  **无** `plugins/review-analysis/` 内容。第六项修复在云端闭环。
  （zip 仍含 `engine/` 旧离线引擎目录，它在 `package.json#files` 之外、运行时不加载，
  属历史保留源码，见 `plugins/README.md` 废弃清单。）
- 证据来源如实标注：本地 `gh release view` 返回 401（token 权限不足），
  改用公开 GitHub REST API + Release 下载 URL 核验；`gh run view` 正常。
