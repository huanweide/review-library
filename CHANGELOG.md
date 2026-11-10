# 更新日志

版本号遵循 MAJOR.MINOR.PATCH。唯一真源是根 `package.json` 的 `version`，由
`scripts/sync-versions.mjs` 机械同步到 `VERSION`、`core/index.js#CORE_VERSION`、
DSH 插件与 WorkBuddy 专家的 manifest，以及 README 顶部定位行；`scripts/check-versions.mjs`
挂在 `pretest` 上做漂移检测。发版 tag 必须与 `package.json` 严格一致（如 `v1.5.0`）。

## v1.5.0 — 2026-11-10（本地已就绪，待云端发布）

> **状态（如实）**：本地 8 处版本常量已统一升到 `1.5.0`，全量门禁全绿、改动已提交。
> 但**云端发布被 GitHub 账户侧拦截**：`git push ghssh main` 与 `git push --dry-run` 均返回
> `ERROR: You must verify your email address`，`gh` 的 token 也已失效，无其它可用推送通道。
> 这与代码 / SSH 密钥 / 仓库权限无关。待邮箱验证后补推 main + 打 `v1.5.0` tag 即可由 CI 发版。
> **云端最新仍是 `v1.4.0`；在补推成功前，本节不是「已发布」。**
> 阻塞详情与一键补推清单见 `PROCESS/research-competitor-e2e/release-prep-v150.md`。

**定位**：结合高 star 竞品「确实比我们合理」的能力，做 1 块优化 + 1 块美化。
基准与采纳门槛见 `PROCESS/research-competitor-e2e/visual-benchmark.md`、
`fusion-decisions.md`；上一轮横向对比的 star 真值与逐字符引文在 `best-practices.md`。

**先确认，再采纳**（不照单全收）：
- 采纳「引用锚定」：DeepTutor「cited page by page」、PageIndex「Page-level citations」、
  NotebookLM「exact quotes from your sources」是竞品共识；我方 `real-llm-v5.json` 两道样例
  `page` 全为 0、`quote` 由模型自报且 `measureQuality()` 只校验文件名 —— **差距属实**。
- 采纳「长书结构化」：PageIndex 实测「at 805 pages the document no longer fits in the context
  window at all」；我方 `raw.slice(0, 50000)` 从头砍、后半本静默丢失 —— **差距属实**。
- 否决：RAG 分块 / 逐页多次调用 / 先出大纲供审的两阶段 / 播客 / AI 教师 / 多用户协作 ——
  与「一次 API 整本整体分析」「本地单机」硬需求冲突，或属独立产品线。
- 缓做：F1「出题→作答→批改→错题→间隔复习闭环接进 core」是架构级差距，但涉及两套 store
  合并与已有书库迁移，按「不可逆动作先确认边界」铁律本轮不动，留下一轮。

**优化块 · 引用锚定 + 结构化语料**（仍是严格一次 API，零数据迁移）
- `core/extract.js`：PDF 由 `pdf-parse` 的 `pagerender` 逐页注入真实页码标记；
  `segmentText()` 把文本切为 `{anchor, page, text}`，锚点为 `【P.3】`（PDF 真页码）或
  `【块2】`（文本块坐标）。老缓存无页码标记时按块切，不重抽、不改落盘格式。
- `core/index.js`：`getBookText()` 输出带锚点语料；`core/analyze.js` 的 `composeCorpus()`
  保证任何调用方（含绕过 Core 的脚本/插件）都拿到带锚点的规范语料。
- 长书超预算时**按文件均分、跨文件均衡取样**，替掉从头截断；概览逐份资料如实显示
  「共多少字 / 取了多少字」，不再只给一个模糊的「已截断」。
- 提示词新增 `source.anchor` 契约：必须逐字抄语料里的现成锚点，引文必须是该锚点后的连续原文。
- 新增 `verifyQuotes()`：用**真正送进模型的语料**逐字校验引文，结果写回每题
  `quoteVerified` 与 `result.quoteAudit`；题目详情显示锚点与「已核对 / 未能在原文中定位」徽章。
  纯文本资料明确写「按锚点+引文直接定位」，不再套用 PDF 的「页图需视觉能力」措辞。

**美化块 · 现代知识工作台规范**（不改任何 DOM id/class 契约）
- `renderer/css/core.css` 重写为语义 token 体系（surface 0–3 色阶 / 单一强调色 / 状态色只给状态 /
  圆角与间距节奏 / 统一缓动），新增 `prefers-color-scheme` 深浅双主题，CSS 首帧生效无白闪；
  去渐变顶栏、双层重阴影、14px 大圆角；补空状态三步引导、加载骨架、可恢复错误态。
- 导图 SVG 的背景 / 节点 / 文字色改由 `svgTheme()` 从 CSS 变量注入，深色模式不再是一块白；
  系统主题切换时自动重绘画布。尊重 `prefers-reduced-motion`。

**验收（真跑，非自评）**
- 判别测试 `test/core-anchor-v3.test.js`：baseline（v1.4.0）`4 通过 / 13 失败 / exit 1`
  → candidate `32 / 0`；H 组用 pdf-parse 自带合法 5 页 PDF 夹具真解析（页序 1→5、15 个锚点块，
  并补 G2「老题目无 quote 时如实报未命中」防回归）。
- `npm test` 19/19、`test/core-mindmap-v2.test.js` 100/0、双形态真 Chromium e2e **121/0**、
  `node --check` 73/73、版本 8 处 / 形态 18 处门禁、`npm ci --dry-run` 通过。
- 真模型 `DeepSeek-V4.1-Flash` 重跑 `real-llm-v6.json`：15 题 / 6 类 / 5 章，九项判据全绿，
  思路平均 149 字，**`source.anchor` 填写率 15/15、引文命中原文 15/15**，158.0s。
- 双形态各截浅色 / 深色 / 题目详情 / 锚点核对 4 张真图，目视核对无白块、无溢出、层级正确。

**KNOWN-LIMITATION（不夸大）**
- `verifyQuotes()` 只校验「引文是否逐字存在于送进模型的语料」，**不校验** anchor 是否为真实锚点、
  引文是否支撑该题、答案是否正确、`page` 是否对应真 PDF 页；15/15 命中不能读作「答案都对」。
- 真模型验证语料仍是硬编码 1659 字 + 虚构文件名，未跑真实 PDF/Word 抽取语料；
  v6 台账无上游 response id / usage 哈希，属脚本自报（但判据阈值与当前代码一致）。
- 深色模式跟随系统，**没有应用内手动切换开关**；深色详情弹窗未单独截图目视（同一套 token 覆盖）。
- 折叠分支搜不到、方向键只在命中间跳转、F1 闭环未统一、真 Electron GUI 未跑、PDF 页图不渲染，
  均为既有遗留，本轮未扩大也未修复。

## v1.4.0 — 2026-11-10

**思维导图 v2 + 一次 API 完整产出**。本轮按 maxloop 阶段零外查（Xmind / markmap /
mind-elixir / 商业 AI 题库 / 一次 API 结构化输出共 4 组真实检索）建立外部基准，
逐项过 R/C/N 融合决策（见 `PROCESS/research-mindmap-v2/`）。

- **导图从缩进列表换成交互式 SVG 画布**：右向树 / 双侧导图 / 组织图 3 种布局，按章分支配色
  （连线同色），节点带题型徽章 / 题目数 / 原图角标；原 `ul/li` 树保留为「大纲模式」，一键切换。
- **大书导航**：全文搜索命中高亮（基于当前已展开的画布节点，折叠分支需先展开）、
  双击节点聚焦下钻（只看这一支）、键盘（`/` 搜索、`+/-` 缩放、`0` 复位、`Esc` 退出聚焦、
  方向键在搜索命中间跳转）。
- **导出**：新增 Markdown / OPML / PNG，保留 JSON 与矢量 SVG；均为纯前端序列化。
- **题型分类并入导图**（不再是独立 tab）：题型根 → 题型 → 子题型 → 题目，三级点击链路；
  点子题型列出该题型的**所有题目**，点题目打开详情弹窗。点题型卡片在**可见画布**上定位高亮。
- **题目详情**：题干 / 选项 / 答案（含理由，禁止只写字母）/ 分步解答 / 解题思路 /
  易错点 / 难度 / 关联知识点 / 来源。新增 `GET /books/:id/files/:fid/raw` 回读原始文件，
  图片型资料显示**真·图书原图**；PDF / Office 型资料诚实给「文件名 + 页码 + 引文」文本定位，
  不谎称能显示页图。旧分析数据无 `questions` 字段时降级为原有题型卡片，不崩。
- **一次 API 重写**：正常路径只调用一次 `chat`，输出单个严格 JSON；题目数显式区间、单题 few-shot、
  禁占位、`source.file` 必须来自注入的真实文件名清单。新增 `response_format: json_object`、
  `finish_reason === 'length'` 显式抛错（不把半截 JSON 当成功）、输出预算按实测长度加 headroom。
- **效果可测**：新增 `measureQuality()` 的 **9 项判据**（JSON 可解析 / 字段完整率 / 题数 /
  题型覆盖 / `pointPath` 反查命中率 / 占位符率 / 来源命中率 / 答案含理由率 / 思路字数）。
  这是**开发期效果度量**，不在生产链路自动判定或自动重试（自动重试会破坏「一次 API」）。
  真模型 `DeepSeek-V4.1-Flash`（siliconflow）用当前代码一次调用实测 **21 题 / 7 类题型 /
  9 项全绿**，思路平均 88 字，耗时 149.5s（`real-llm-v5.json`）。v1→v4 是提示词迭代史，
  **v5 才是本版验收证据**——不拿旧阈值下的结果冒充新代码的结论。

**发布前独立复核清掉的缺陷**（两份全新上下文 reviewer 逐行读码 + 自审）：
- 版本同步闭环缺两环：`check-versions.mjs` 检查 README 第 3 行而 `sync-versions.mjs` 不写它；
  `package-lock.json` 顶层 / 根包版本也从未同步。现两者都由脚本机械传播（写入后 `JSON.parse`
  复核，只改前两处 version，依赖包版本不动）；`plugins/README.md` 不再写死当前版本号。
- `core/analyze.js` 题目数口径打架（同段「2-4 道」与「1-3 道」；提示词 8-20）。现由
  `Q_RANGE={min:8,max:24}` 单一常量驱动提示词；**判据 `maxQuestions=60` 保持不变**——它是
  防灌水 / 防截断的兜底上限，与提示词的「期望产出区间」语义不同。评审曾建议把两者统一到 24，
  那会让「25 道全合格题目」被判整体失败（过拟合单次实测），已否决并加 25 题判别样例锁住。
- `lib/llm.js` 无条件要求 `response_format: json_object`，不兼容的中转必 400。现正常路径仍严格
  一次调用，仅在上游回 400/404/415/422 且本次带了字段时异常降级重试一次，401/403 不重试；
  超时提示改用真实 `timeoutMs`，删掉「不支持该参数的服务可自行忽略」的误导注释。
- `renderer/js/core-ui.js`：老分析数据题型组缺 `items` 会抛 TypeError；子题型无 `questions` 时
  点卡片只高亮、不打开面板（像死按钮）。两处补兜底，`openQitem` 已有「暂无题目」文案。
- `_e2e/core-ui-verify.js`：F2 高亮断言只查默认隐藏的 `#tree` 大纲 DOM，是假绿。现补
  「大纲确为隐藏态 + 可见画布上 `.locate` 恰好 1 个」两条断言，双形态各 +2。
- `.github/workflows/release.yml` 的 `review-analysis-dsh-plugin-*.zip` 此前打包
  `plugins/review-analysis/`（WorkBuddy 专家形态），与文件名和 `plugins/README.md` 形态地图
  不符——下载者拿到的是专家包而非真 DSH 插件（读 `~/.dsh`）。现改指 `plugins/dsh-review-analysis/`。

**验收**：`npm test` 18/18 套件；v2 判别测试 baseline `8/24 exit 1` → `100/0`（新增 10 条回归
防线：兼容降级 / 401 不重试 / 25 题不过拟合 / 老数据 / lock 同步 / 超时文案）；双形态真
Chromium `103/0`，零控制台错误；`node --check` 72/72；`versions:check` 8 处、
`forms:check` 18 处、`npm ci --dry-run` 通过；真模型 v5 九项全绿；全仓凭据扫描无命中。

**已知边界**（诚实标注，不含糊）：
- `response_format` 主流服务支持（OpenAI / DeepSeek / SiliconFlow / vLLM / Ollama）；个别老旧
  第三方中转不支持，此时走异常降级重试一次。设置里「测试连接」不发该参数，探测不出此兼容问题。
- 搜索基于当前已展开的画布节点，折叠分支里的节点搜不到；方向键只在搜索命中间跳转，不做节点导航。
- `measureQuality()` 不接生产链路，不会自动判定或自动重试（避免破坏「一次 API」）。
- 专家形态 tag（`review-analysis-v*`）复用同一条插件打包步骤，改后同样产出 DSH 目录的 zip；
  **本轮只发 `v1.4.0` 主 tag，不发专家 tag**，按 tag 前缀分支打包记为遗留。
- 本机 `electron.exe` 缺失，真 Electron GUI 未跑，以 `file://` + 等价 `window.api` 桥的真
  Chromium 替身验收；自动更新链路靠 CI 产物 + 上一轮 v0.6→v0.8 实机实测，本轮未再真机升级。
- PDF 页图在 `file://` 下受 module CORS 限制不渲染，PDF / Office 只给「文件名 + 页码 + 引文」。
- 真模型效果只在 1 本书 / 1 个模型上验证；换模型 / 换学科 / 超长语料的稳定性未验证。
- 本地未复现 CI 的 `Compress-Archive` 解包核对（.NET 编译被安全策略拦），改由 DSH 目录清单
  （`index.js` / `client.js` / `cordis.patch.yml` / `package.json` 等）+ 云端 CI 实跑验证。

## v1.3.1 — 2026-11-09

**修复发布阻塞**：`package-lock.json` 未包含 `pdf-parse@1.1.1`（以及它间接依赖的
`debug` / `node-ensure`），云端 `release.yml` 的 `npm ci` 报
`EUSAGE ... Missing: pdf-parse@1.1.1 from lock file` 而在第 5 步失败，
v1.3.0 未产出 Release。本地用 `npm install --package-lock-only` 重建 lock，
`npm ci --dry-run` 由 `exit 1` 转 `exit 0`。按发版纪律不改已推送 tag，
以 patch 版本 1.3.1 重新发版。

代码功能与 v1.3.0 相同，无新增特性。

## v1.3.0 — 2026-11-09

**融合双实现的能力**：把工作区开发副本里已验证的能力，逐项适配进发布正本的
`Core` 类契约（不复制第二套 core、不覆盖既有题型分类、旧副本保留作回退）。

- 思维导图：新增缩放（30%–250%）、鼠标拖拽平移、复位视图。
- 导出：新增导出分析 JSON 与矢量 SVG 思维导图（非像素截图）。
- 题型索引：点击题型卡片自动切回导图并高亮对应知识点，展开祖先节点。
- 分析数据：节点 id 改为确定性（同书两次分析一致）；题型项新增 `pointId`，
  按完整路径精确反查，同名知识点可消歧。
- 健壮性：纯图片书 / 可读文本过少时带 `userCode` 明确报错，不再静默产出空壳分析；
  全书语料超过 50000 字时截断并标记 `truncated` / `sourceLen`，概览页显式警告。
- 导入：逐文件失败累积并持久显示在界面；修正 `FileList` 活引用导致的「已导入 1/0」分母错误。
- 概览：新增分题型统计卡、模型 / 全书字数 / 资料数 / 图片数信息；分析完成后状态条
  由「正在分析…」更新为「分析完成：X 章 / Y 知识点 / Z 类题型」。
- 工程：新增 `test/core-fusion.test.js`（41 项运行时判别测试）与双形态真浏览器
  融合验收 `_e2e/core-ui-verify.js`（53 项，实际点击缩放 / 导出 / 联动）。

**验收**：`npm test` 17/17 套件；融合判别 baseline `8/23 exit 1` → candidate `41/0`；
双形态真浏览器 53/0（HTTP 与 `file://`，零控制台错误）；`node --check` 19/19；
版本门禁 8 处、形态门禁 18 处一致。

## v1.2.0 — 2026-11-08

统一核心（`Core` 类 + `BookStore` + `core/request.js` 单一真源）；
DSH 插件与 WorkBuddy 专家改为复用同一核心；版本与形态漂移门禁；
修复 11 条独立复核缺陷（路径穿越、默认窗口 CSS、IPC 校验、错误分类与日志、
畸形 JSON 密钥回显、门禁假绿、DSH 测试入主套件等）。

## v1.0.0 — 2026-11-08

首次发布统一项目形态。更早的 v0.5–v0.9 为分层架构时期，见 README 历史章节。
