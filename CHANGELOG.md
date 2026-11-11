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
- 新增 `verifyQuotes()`：用**真正送进模型的语料**校验引文，按「全串逐字 / 末尾 ≤6 字容错」
  两级判定并分别计数（`fullHit`）；只容忍模型省末尾几字，**不接受开头抄一段、后面自由发挥**。
  结果写回每题 `quoteVerified` 与 `result.quoteAudit`；题目详情显示锚点与
  「已核对 / 未能在原文中定位」徽章。纯文本资料明确写「按锚点+引文直接定位」，
  不再套用 PDF 的「页图需视觉能力」措辞。

**美化块 · 现代知识工作台规范**（不改任何 DOM id/class 契约）
- `renderer/css/core.css` 重写为语义 token 体系（surface 0–3 色阶 / 单一强调色 / 状态色只给状态 /
  圆角与间距节奏 / 统一缓动），新增 `prefers-color-scheme` 深浅双主题，CSS 首帧生效无白闪；
  去渐变顶栏、双层重阴影、14px 大圆角；补空状态三步引导、加载骨架、可恢复错误态。
- 导图 SVG 的背景 / 节点 / 文字色改由 `svgTheme()` 从 CSS 变量注入，深色模式不再是一块白；
  系统主题切换时自动重绘画布。尊重 `prefers-reduced-motion`。

**全端美化扩展**（续 · 2026-11-10）：把上面这套设计系统从默认窗口（core.html/core.css）覆盖到**全部端**——
旧版分层视图（index.html/style.css，承载 HTTP 端与「视图 → 旧版分层视图」入口）与桌面端共用同一份
`renderer/css/tokens.css` 单一真源（surface 色阶 / 语义强调色 / 状态色 / 圆角 / 缓动 / 深浅双主题）。
`style.css` 系统替换为 token 引用并补齐深色模式；9 处「白字落会翻转的 token 背景 / 状态色装饰边框」
改用 `--locate/--ok/--warn/--line` 等 token，避免深色对比度塌陷与边框不翻转。`app/main.js` 的
`openWindow` 引 `nativeTheme`，按系统深浅设窗口 `backgroundColor`，消除桌面深色用户启动白闪。
残余硬编码仅剩 `.cover` 白字（彩色封面，正确）与 `.demo-mode` 暗色提示条（固定暗色，正确），均非缺陷。

**验收（真跑，非自评）**
- 判别测试 `test/core-anchor-v3.test.js`：baseline（v1.4.0）`4 通过 / 13 失败 / exit 1`
  → candidate `32 / 0`；H 组用 pdf-parse 自带合法 5 页 PDF 夹具真解析（页序 1→5、15 个锚点块，
  并补 G2「老题目无 quote 时如实报未命中」防回归）。
- `npm test` 19/19、`test/core-mindmap-v2.test.js` 100/0、双形态真 Chromium e2e **139/0**
  （含新增 `index.html` 浅/深 × HTTP/file:// 四态验收）、`node --check` 73/73、
  版本 8 处 / 形态 18 处门禁、`npm ci --dry-run` 通过。
- 真模型 `DeepSeek-V4.1-Flash` 重跑 `real-llm-v6.json`：15 题 / 6 类 / 5 章，九项判据全绿，
  思路平均 149 字，**`source.anchor` 填写率 15/15、引文命中原文 15/15**，158.0s。
- 双形态各截浅色 / 深色 / 题目详情 / 锚点核对 4 张真图，目视核对无白块、无溢出、层级正确。

**KNOWN-LIMITATION（不夸大）**
- `verifyQuotes()` 只校验「引文（允许末尾 ≤6 字缺失）是否存在于送进模型的语料」，
  **不校验** anchor 是否为真实锚点、引文是否支撑该题、答案是否正确、`page` 是否对应真 PDF 页；
  命中率不能读作「答案都对」。全串逐字命中单独记为 `fullHit`，与容错命中分开看。
  发布前复核才发现旧实现「取前 40 字判命中」会把「开头抄原文 + 后段编造」标成 `exact-span`，
  已收紧判据并用 4 条判别测试锁住（I 组）。
- 真模型验证语料仍是硬编码 1659 字 + 虚构文件名，未跑真实 PDF/Word 抽取语料；
  v6 台账无上游 response id / usage 哈希，属脚本自报（但判据阈值与当前代码一致）。
- 深色模式跟随系统，**没有应用内手动切换开关**；深色详情弹窗未单独截图目视（同一套 token 覆盖）。
- 折叠分支搜不到、方向键只在命中间跳转、F1 闭环未统一、真 Electron GUI 未跑、PDF 页图不渲染，
  均为既有遗留，本轮未扩大也未修复。

**未发布批次补充（2026-11-11 续 · 端到端盘点后：修两处 P0 + 收口）**

- **订正上一轮不实宣称（不造假）**：上段写「先答后揭是真的……答案只在提交判分后的响应里
  第一次到达……不是 CSS 遮挡，是数据层真隐藏」。经端到端复盘，该措辞**不成立**：
  `/books/:id/analysis`（`core/request.js:80`）原样下发完整 `analysis.json`（含全部
  `answer`/`solution`/`rationale`），`core-ui.js:107` 打开书即取进 `state.analysis`，
  `:558`「导出 JSON」直接 `JSON.stringify(state.analysis)` 一键下载，`:461` 题目详情明文显示。
  唯一标记探针实测：`/practice/quiz` 确不含答案字段、`/analysis` 含 answer 与 solution。
  准确说法是「**练习视图内不渲染答案**」，不是「答案未到达客户端」。
  已订正 `core/index.js:79-84` 注释、`core.html` 注释与 `#practiceHint` 用户可见文案、
  README / `API配置.md` 的密钥段落。**不脱敏 `/analysis`**：导图 / 题目详情 / 5 种导出都依赖完整
  analysis，且本地离线工具的用户本来就能直读 `library/books/*/analysis.json`，脱敏属过度设计。
- **P0-1 修「混放书库误列误删」**：两套书库共用 `books/` 且元数据都叫 `book.json`，
  `core/bookStore.js` 原先只判文件存在，导致旧版书被默认窗口列成 0 资料空壳、
  `deleteBook` 的 `rmSync` 会真删掉旧书资料并在 legacy `index.json` 留幽灵项。
  新增只读格式判别 `_readCoreBook()`（`createBook` 恒写 `files: []`，legacy 无此字段），
  覆盖 `getBook` / `listBooks` / `deleteBook`，`_saveBook` 兜住按 id 的写路径；
  **零迁移、不改任何已有数据**。判别测试 J1a–J1d 旧版全红 → 全绿，含真实 `lib/store.js` 建的老书。
- **P0-2 修「重分析后统计条留假数据」**：题目身份是 stem/options/answer 的内容哈希，重分析换题后
  旧卡 key 失配但不删；`summarize/dueKeys` 全量累计旧卡，`getDue` 列表却按新 key 过滤，
  实测出现「今日到期 1」却列不出题。`practice.js` 的 `dueKeys/summarize` 增**可选**第三参
  `validKeys`，`Core.getQuiz/getDue` 传当前分析结果的 key 集合，统计与列表同源；
  旧卡保留为历史不删（零迁移），不参与当前统计。不传第三参时行为完全不变（向后兼容）。
  **未改 `questionKey` 哈希算法**——改了会让所有已落盘练习记录失效，属破坏用户数据。
- **交付链加固**：`启动桌面版.bat` 增版本核对（读 `VERSION` vs `dist/latest.yml`），
  不一致时醒目提示「当前安装包 0.7.0 / 源码 1.5.0，看不到练习等新功能」并给重建命令，
  不再静默启动旧版（替身真跑输出 `WANT=1.5.0 GOT=0.7.0 MISMATCH_DETECTED`，不阻断启动）；
  `.github/workflows/release.yml` 补 `Test gate`（`npm test` + `check-versions`）与
  `Credential scan` 两步，结束「推 tag 就打包、CI 零复核」。
- **文档订正**：README 三处 + `API配置.md` 一处原写「密钥只进 sessionStorage / 关掉即失效」，
  但默认窗口 `core.html` 实际存 `localStorage`（`core-ui.js:56` `core_llm_cfg`，含 apiKey）。
  已按入口分别写明，并补「默认窗口配置不属于整库备份范围，换机需重填」。
  **本轮不改密钥存储行为**（不碰登录态 / 安全语义，列为下一轮候选）。
- **验收（真跑，非自评）**：新判别 `baseline 0 通过 / 8 失败 / exit 1` →
  `candidate 8 通过 / 0 失败 / exit 0`（8 条回归守卫两版恒绿）；`npm test` **21/21 套件**、
  `_e2e/e2e.js` **195/0**、`_e2e/core-ui-verify.js` **139/0**、`_e2e/practice-e2e.js` **25/0**、
  `node --check` **86/86**、版本 8 处 / 形态 18 处、凭据扫描无真命中、
  `release.yml` YAML 解析通过（10 步含 2 步门禁）。
- **KNOWN-LIMITATION**：`_e2e/` 仍不在 `npm test` 内，三套真浏览器 e2e 需 playwright-core 的
  chromium 二进制，全新 CI 机器没有，故**未写进 CI 冒充门禁**，仍由本机 Oracle Gate 手动跑；
  `dist/` 未重建（本机 `electron.exe` 缺失，留给发布环节）；默认窗口密钥仍存 localStorage；
  重分析后旧卡留作历史不自动清理；DSH / 专家 action 白名单未暴露 practice（上轮已记录待办）；
  未升版本号、未发版、未推（仍卡 GitHub 账户邮箱验证）。

**未发布批次补充（2026-11-11 · maxloop 功能端：学习闭环进统一核心）**

- **真问题**：默认入口 `core.html` 此前只能「看分析结果」——`core-ui.js:456` 把答案直接摊开，
  `core/index.js` 门面止于 `getAnalysis`、`core/request.js` 无练习路由、`core/bookStore.js` 落盘结构
  无「学习过程」这一层。F1「闭环进 core」自 11-10 起标为最高优先却因「两套 store 合并会砸数据」搁置；
  本轮复核发现该前提可绕开：**不合并、不迁移，只新增独立 `practice.json`**，风险从高降到零。
- **实现**：新增 `core/practice.js`（内容哈希题目身份 / 分题型判分 / 排程 / 错题 / 到期队列），
  `core/bookStore.js` 增 `practice.json` 读写，`core/index.js` 增 6 个门面方法（DSH/专家可达），
  `core/request.js` 增 5 条 `/books/:id/practice/*` 路由（HTTP/Electron 共用 dispatch 自动生效），
  `core.html` 增「✍ 练习」tab + 面板、`core-ui.js` 练习逻辑、`core.css` token 内样式。
- **先答后揭是真的**：练习列表接口**不下发** `answer`/`solution`/`rationale`，
  答案只在提交判分后的响应里第一次到达；e2e 用网络响应体做硬证据，不是 CSS 遮挡。
- **判分诚实边界**：`core/analyze.js:86` 强制答案写成「B. 8 个 —— 理由」整句，
  故按题型分路——选择题/判断题解析出选项字母自动判，其余 5 类**不冒充机器评分**，
  揭晓答案后由用户四档自评（Anki 本质）。排程复用既有 `lib/srs.js`，零新依赖。
- **零迁移**：`book.json` / `analysis.json` 结构一个字节不改，老书缺 `practice.json` 即空状态；
  判别测试 J7 真验「读练习状态不改 book.json」。
- **真截图目视抓到并修掉 1 个口径假数据**：统计条曾显示「0 可练」却渲染第 1/4 题
  （前端误把后端「已练卡片数」当「本轮可练题目数」）；已改为列表长度并加 e2e 精确断言锁住。
- **验收（真跑，非自评）**：判别测试改码前 `28 条能力判据全红 / exit 1`
  → 改码后 `28/0 / exit 0`；`npm test` **20/20 套件**、`_e2e/e2e.js` **195/0**、
  `_e2e/core-ui-verify.js` **139/0**、新增 `_e2e/practice-e2e.js` **25/0**（真 Chromium + 本地 mock LLM
  真发一次整体分析 + 真点完整闭环）、`node --check` **85/85**、版本 8 处 / 形态 18 处门禁、
  凭据扫描无真命中；浅/深真截图 3 张目视通过。
- **研究/台账**：`PROCESS/research-core-practice-loop/`（best-practices 三组外查 + GitHub API star 真值 /
  fusion-decisions R/C/N + 根因 A→B / iteration-log Oracle Gate 五项 + 安全三段 + 效率指数 100 /
  baseline-practice.txt）。
- **KNOWN-LIMITATION**：DSH 插件与 WorkBuddy 专家形态仅「Core 门面可达」，
  action 白名单未暴露 `practice` 入口（下一轮）；开放题不自动判分；排程为轻量三状态量模型非官方 FSRS；
  真 Electron GUI 未跑、真模型未重跑（本轮不碰提示词）；答案勘误会令该题复习史归零。

**未发布批次补充（2026-11-10 续 · 全链路测试 + 前端微调）**
- 修复 `_e2e/e2e.js`：原把 `core.html` 的思维导图断言（`#pane-mindmap/#mm-canvas/#mm-detail` 等）错放进 `index.html` 传统入口测试，而该入口书内 tabs 无 mindmap 子页，导致点击超时崩溃；已移走错配块、保留文字输入回归检查、新增架构守卫断言。重跑 `node _e2e/e2e.js` → **195 通过 / 0 失败**（此前仅约 70+ 检查点后崩溃）。
- 确认默认入口 `core.html` 全链路已由 `_e2e/core-ui-verify.js`（本地 mock LLM 真发 HTTP→真解析→真渲染，覆盖 HTTP + Electron/file:// 双形态）完整覆盖，重跑 → **139 通过 / 0 失败**；本轮未另建 core-e2e.js，复用现有覆盖。
- 前端微调（token 系统内、不改 DOM 契约）：`.mm-hint` 颜色提至 `--ink-soft` 提升可读性；`.qd-body` 底部 padding 增至 `--space-5` 避免题目详情末行贴脚。
- 全量门禁复跑全绿：`npm test` 19/19 套件、`node --check`、凭据扫描无真密钥。
- 注意：本地无任何 LLM API key，`core.html` 的「大模型整体分析」真实链路仍需走 mock LLM（core-ui-verify 已如此），真烧需配置 key。

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
