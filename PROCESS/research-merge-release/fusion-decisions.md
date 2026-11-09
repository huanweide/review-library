---
title: A→B 融合决策表（逐项 R/C/N + 根因段 B）
date: 2026-11-09
tags: [maxloop, fusion, rcn, root-cause]
source: 本轮 A/B 逐字符对照（best-practices.md 第二节）+ 三组外查基准
---

# 融合决策表

**融合方向（不可动摇）**：B=`C:\Users\Administrator\Desktop\rlbuild` 是发布正本，其 `Core` 类 / `BookStore` / `core/request.js` 是唯一真源；A=`agent program\复习资料图书馆` 只作为**能力资料来源**逐项适配，不复制 A 的 `core/`，不删除 A，不覆盖 B 已接 DSH/专家的题型分类。

**根因段 B（为什么会有两套）**：A 段 = 两个目录各自有一份 `core/`；B 段 = 上一轮把「发布正本」与「工作区开发副本」并行推进时，没有建立 **canonical → wrapper** 的依赖方向，两边各按自己理解长了能力。只把 A 文件复制过去而不改依赖方向，下次还会再长一套。所以本轮**只把能力适配进 B 的既有契约**，A 原地不动，并在决策表里写明「不合」项与理由。

---

## 一、融合项（全部过关）

| # | 能力 | R 合理性 | C 正确性（逐字符锚点） | N 必要性 / 更轻替代 | 根因段 B | 结论 |
|---|---|---|---|---|---|---|
| F1 | **确定性 id + 题型反查 pointId** | 题型索引要能定位导图节点，符合「题型分类索引 + 可层层展开导图」的核心定位 | A `core/analyze.js:100-118` `normalizeTree()` 分 `n{depth}_{counter}` 并建 `titleMap`；`:131-144` `resolveQuestionIndex()` 回填 `pointId`/`path`；B `core/analyze.js:66` `normalizeNode()` 给**每个**节点 `crypto.randomBytes(4)` id（每次分析都变，非确定性），`:101-106` questionIndex 只有 `title`/`path`、无 pointId | 不合则 F2 联动只能靠标题模糊匹配（A 自己都写了两级回退），大书重名即错。更轻替代「只按 path 找」经 A 实测不可靠 | A 段=索引项无稳定引用；B 段=分析产物把「索引项」与「树节点」只靠文本 path 关联，且 id 随机导致同书两次分析不能复现 | **合**（在 B 的 `validate()` 内换成确定性 id + 建 path→id 映射，输出多带 `pointId`，不改其它字段） |
| F2 | **题型点击定位高亮** | 外查基准①：`"Label search (Ctrl+F) with match highlighting and jump-to-hit"`（MindForge）；是导图标配 | A `renderer/js/core-ui.js:257-269` `locateNode()` 切 tab + `.highlight` + 展开祖先 + `scrollIntoView`；B `:191-203` `.qcard` 生成后无 onclick | 不合则题型索引只能看不能用，用户得手翻整棵大树。无更轻替代 | A 段=qcard 无点击；B 段=渲染层没把「索引→节点」当一条交互链路设计 | **合**（依赖 F1） |
| F3 | **缩放/平移/复位（0.3–2.5）** | 外查基准①：mindkeeper-map `"Pan & zoom — scroll-wheel zoom, drag-to-pan"`；MindForge `"Pan, zoom (10–300%)... fit-to-window"` | A `core-ui.js:229-234` `applyView/zoomBy/resetView`；`:385-390` mousedown/mousemove/wheel；B `core.html:81-87` 只有展开/收起两个按钮，`core.css` 无 transform 样式 | 不合则 400 节点的大导图无法浏览。更轻替代「只加按钮不拖拽」不满足基准 | A 段=无视口控制；B 段=DOM 树当静态列表渲染，没有「画布」抽象 | **合**（给 `#tree` 加视口包裹层 + transform） |
| F4 | **导出 SVG / JSON** | 外查基准①：mindkeeper-map `"exportPNG/exportSVG"` + `"JSON import/export"`；mindmap-viewer `"Export as SVG / PNG / JSON"` | A `core-ui.js:295-338` `exportJson/exportSvg/downloadBlob/buildTreeSvg`（左→右矢量树，非像素截图）；B 无导出 | 用户要「可分享的成果」，无导出就只能截图。无更轻替代 | A 段=无导出；B 段=结果只在内存 state 里，没有落地产物通道 | **合**（适配 B 的 state 结构，SVG 用 B 的 tree 字段） |
| F5 | **纯图片 / 少文本友好报错** | 用户明确要求「图片健壮性：不静默空分析」 | A `core/analyze.js:151-158` `MIN_TEXT=80` + `imageCount` → `'请先在设置中开启并验证「视觉模型」'`；B `core/analyze.js:134` 仅 `!fullText` 时报错 | 不合则「几张图 + 一页提纲」会静默产出空壳分析，用户以为是模型坏了。更轻替代：只在 `getBookText` 里判空 → 覆盖不了「有少量文本」 | A 段=阈值判断放在客户端抽取后；B 段=**没有把「可读文本量」当作分析前置条件**，只判「有无」 | **合**（B 的 `Core.analyze` 传 `imageCount`/`materialCount`，`analyzeLib.analyze` 判 `MIN_TEXT`） |
| F6 | **语料上限 + 截断标记** | 诚实标注边界，避免超大书静默超限 | A `core/analyze.js:9` `MAX_CORPUS=50000`、`:37-38` 截断、概览页 `:292` `⚠ 语料超过上限已截断`；B 无 | 不合则整本几百页直接塞进 8k token 上下文，模型丢尾部且无任何提示 | A 段=无上限；B 段=把「整本书」理解为「全部无损喂进去」，缺少容量契约 | **合**（`buildMessages` 截断 + 结果带 `truncated` + 概览页显示） |
| F7 | **抽取失败警告上屏** | 「失败可见」是本工作区既有结论（上一轮 e2e baseline 红→绿实证） | A `core-ui.js:126-139` 收集 `ex.note` 拼到 `importStatus`；B `:113-119` 失败时只 `toast()`，逐个文件不落状态 | 不合则多文件导入时用户不知道哪份没抽到文本。更轻替代：只 toast → 会被 2.2 秒后消失且多文件互相覆盖 | A 段=note 只进 console；B 段=错误通道没有持久化到界面状态 | **合**（B 的 addFiles 收集失败名，写 `importStatus`） |
| F8 | **概览分题型统计 + 语料信息** | 让「题型分类索引」在概览有量化呈现 | A `core-ui.js:277-293` `questionTypeCounts` 卡 + 语料字数/资料数/图片数；B `:205-210` 只有 5 个总数卡 | 不合则概览看不出哪种题型最多。属增强而非阻塞，但成本近零且复用 F1/F6 已有数据 | A 段=统计维度少；B 段=stats 只存结构计数，未存题型分布 | **合**（B 的 `validate()` 补 `questionTypeCounts`，概览页加卡） |

## 二、明确「不合」项（同样要过闸，防止无脑搬）

| # | 候选 | 判定 | 理由（R/C/N 哪一关没过） | 证据锚点 |
|---|---|---|---|---|
| X1 | 把 A 的 `core/` 整体复制进 B | **不合** | **R 不过**：违反外查结构基准② `"duplicate concepts (the same idea represented separately with no coordination)"`；会形成第二真源，DSH/专家不知道接哪份 | B `core/index.js:2-4` `"对外单一入口，桌面端 / DSH 插件都只接这一层"` |
| X2 | 用 A 的题型分类覆盖 B | **不合** | **C/N 不过**：两套分类名不同，B 的已写进提示词、DSH/专家契约与已落盘分析产物；覆盖会让旧分析结果题型全部失配 | A `:12` `单选题/多选题/.../论述题` vs B `:12` `选择题/名词解释/.../综合应用题` |
| X3 | 用 A 的前端抽取（mammoth/pdfjs/xlsx）替换 B 的 Node 抽取 | **不合** | **C 不过**：B 的 `pdf-parse` 能在 Node 侧真抽 PDF，A 只标记 `needsClientText`；且上一轮已实测 `file://` 下 `type="module"` 的 pdf-extract 被 CORS 拦（`window.PdfExtract===false`），换过去会让桌面端 PDF 抽取退化 | B `core/extract.js:6-8`；`PROCESS/research-form-sync/discriminative-test.md` KNOWN-LIMITATION 2 |
| X4 | 删除 A 副本 | **不合** | **N/R 不过**：外查基准② `"删除旧项目是迁移完成后的结果不是迁移开始时的动作"`；A 还有 14 套件与两个形态 e2e，是回退与对照资产 | Strangler / pgsm.cn 逐字符锚点 |
| X5 | 本地 `npm run release`（`--publish always`） | **不合** | **C/N 不过**：外查基准③ `"Local packaging never uploads anything (--publish never)"`；且本机 `electron.exe` 缺失，本地打包必失败。改走 tag → 云端 `release.yml` 的 `--publish never` + 三件套上传 | `package.json:22`；`.github/workflows/release.yml:49-51` |
| X6 | 把 A 的 e2e/判别测试整套搬进 B | **不合** | **N 不过**：B 已有 16 套件 + 双形态 e2e + 48 项判别，且契约不同（A 用 `/api/core` + `window.API`，B 用 `Core` 类 + `window.api.coreRequest`）；整套搬会因契约不符大面积假红 | `test/core-hardening.test.js` / `_e2e/core-ui-verify.js` |

## 三、改动文件集合（范围收敛，白名单）

只允许改 B 的这些文件：

- `core/analyze.js`（F1/F5/F6/F8）
- `core/index.js`（F5 传统计信息）
- `renderer/core.html`（F3/F4 工具栏与视口）
- `renderer/css/core.css`（F2/F3 高亮与 transform 样式）
- `renderer/js/core-ui.js`（F2/F3/F4/F7/F8）
- `test/core-fusion.test.js`（新增判别测试）
- `_e2e/core-ui-verify.js`（新增融合能力的双形态断言）
- `package.json` / `VERSION` / `README.md` / `CHANGELOG.md`（发版五件套，由 sync-versions 同步其余 manifest）

**不碰**：`core/request.js`、`core/bookStore.js`、`app/main.js`、`server.js`（安全加固成果，上一轮已验收）、`plugins/`（契约已定）、`lib/`、A 副本任何文件。

## 四、验收判据（Oracle Gate 预置）

- (a) 真跑：`npm test` 全套件 ≥17/17；判别测试 baseline 红 → candidate 绿；双形态 e2e ≥ 融合增强后条数。
- (b) lint：所有改动文件 `node --check` 通过。
- (c) 真实入口可达：真 Chromium 分别以 HTTP 与 `file://` 打开 `core.html`，实际点击「放大」「导出 SVG」「题型卡片」并断言 DOM/下载行为，非白屏、零控制台错误。
- (d) 修复前失败：融合前跑 `test/core-fusion.test.js` 必须红（锁住 8 项能力缺失）。
- (e) 证据锚点：每条结论带文件:行号 + 真实命令输出。
