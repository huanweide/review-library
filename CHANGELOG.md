# 更新日志

版本号遵循 MAJOR.MINOR.PATCH。唯一真源是根 `package.json` 的 `version`，由
`scripts/sync-versions.mjs` 机械同步到 `VERSION`、`core/index.js#CORE_VERSION`、
DSH 插件与 WorkBuddy 专家的 manifest，以及 README 顶部定位行；`scripts/check-versions.mjs`
挂在 `pretest` 上做漂移检测。发版 tag 必须与 `package.json` 严格一致（如 `v1.5.0`）。

## v1.8.1 — 2026-11-28（发布）

DSH 适配轮。按 maxloop 铁律先做阶段零：真搜 9 个 GitHub 高 star 同类项目
（Cordis 10,064★ / Koishi 6,361★ / MCP servers 92,294★ / SiYuan 47,432★ / Anki 33,064★ /
Logseq 45,724★ / Obsidian releases 23,670★ / markmap 13,304★ / mind-elixir 3,211★），
逐字符锚定 star、README 原文、URL，万字拆解后过 R/C/N，只落地通过的改动。
拆解与对照见 `PROCESS/research-dsh适配-2026-11-27/`（00 索引 / 01 万字拆解 / 02 对照判据 / 03 真缺口清单）。

**修两个真故障**（都是「声明与行为分叉」，不是新功能）：
- **G1**：DSH tool 的 `action.enum` 从 v1.8.0 起声明支持 `cards`/`structure`/`snapshot`，
  但 `execute` 分派是手写的、漏接这三个——调用直接落到末尾 throw「不支持的 action：
  cards（可用 ...cards...）」，错误信息自己打自己脸。照 `core/app-host.js:264-284`
  补协议转换，业务逻辑全委托 Core。外部基准 Anki `.proto` 多端生成、MCP 同一 schema
  注册+parse，核心都是「声明与真实行为必须同一份东西」。
- **G2**：`APP_FILES` 停在 2026-11-21，漏列 5 个前端模块（study-hint / map-viewport /
  reader / structure-layer / exam-pack），DSH 侧栏对应功能全是 404，而 HTTP 形态好好的。
  v1.8.0 真机 14/14 只跑了 HTTP，没覆盖 DSH。外部基准 Koishi 用通配入口+目录解析，
  新增文件不改路由；我们逐文件写死清单，注释里自己警告过「漏一个就白屏」。

**判别升级**（旧版必红、改后必绿，实测 baseline 26/11 红 → 37/0 绿）：
- `check-dsh-adapt.mjs` 从 23 项扩到 38 项：真注册 tool 并逐个真调 15 个 action
  （只读真调、写 action 查分派分支，判别本身零副作用）、APP_FILES 逐文件比对
  `workbench/src/` 目录、rating/kind enum、读写属性描述、解析诊断、路径越界校验。
- 修一处判别设计错误：第一版对 `create` 真调、空 title fallback 成「未命名书」，
  跑两轮建了 4 本垃圾书。改为只读真调 + 写 action 源码断言，并加 F4 断言「判别不建书」。
- 修三处门禁假红：`check-card-practice` / `check-exam-pack` / `check-structure-layer`
  的 baseline 从 `git show HEAD:` 改为固定 commit `7876189`（v1.7.3）——
  HEAD 随发版前移，v1.8.0 提交后「旧版没有 X」集体假红。与 `check-dsh-adapt`
  固化夹具同一教训：baseline 必须是历史事实，不能跟随 HEAD。

其余改进：G7 tool 描述标读写/破坏性/费用属性；G6 `rating`(1-4)、`kind`(四种文档) 改 enum；
G5 `resolveProjectRoot` 四级解析失败给逐路径诊断；G4 共用导图模块补 `startsWith` 越界校验
（defense-in-depth，路径本就固定拼出，非修已发生事故）。SW v37→v38。

验证：run-tests 30/30；十三组判别全绿（4/23/7/38/3/24/30/18/14/17/55/9/22）；
版本 1.8.1 八处一致、形态 18/18、SW v38，五个新模块经 HTTP 全 200。

诚实边界：DSH 宿主环境未运行，宿主内点验仍卡环境；判别用 Node mock 真跑 Host 半边
38 项 + HTTP 形态真机验证，未在真实 DSH 侧栏里点验。否决项（通配入口改造 / Cordis replace
热替换 / required-optional 依赖 / capability 裁剪 / 非本机 Origin 403 / git-like 快照仓 /
加密 / 导图撤销 / 考点包回导）见 02 对照判据第三节，均有 R/C/N 理由，不为对齐而加。

## v1.8.0 — 2026-11-27（发布）

三类人群统一计划的**剩余四项全部实施**。命题不变：把「一本书的分析结果」升级成「一份可改、可做、可存、可带的考点资产」。

### 第 2 项 · 题卡结构化 + 进练习题库
- **先纠正上一轮的口径错误**：23 个卡片 JSON / 146 题其实**都有 `answer` 和 `solution`（4 步推导）**，我此前说「answer 零命中」是错的。真正缺的是 `options` / `rationale` / `pitfalls` 和「进练习题库」这条接线。
- `scripts/structure-cards.mjs`（dry-run 默认，`--write` 才落盘，幂等）：从原文确定性派生 `rationale` 144 题、`pitfalls` 15 题；**只从「选项：A…；B…；」严格抽到 1 题的 options**，其余绝不编选项；2 题答案明写「暂无定论/需复核」→ `excludedFromQuiz` 不进练习。
- `core/practice.js` 新增 `flattenCards/findCardQuestion`，`Core.getQuiz/getDue/submitAttempt` 合并卡片题——**156 题**（12 全局 + 124 讲次 + 20 作业），脱敏列表零答案泄露，与全局题共用一套 key / 判分 / SRS。
- 判分诚实分两条：1 道能自动判的自动判（`parseAnswer` 新增认「A（1,3,5）」中文括号格式）；其余走 Anki 正统的「自答 → 对照 → 四档自评 → SRS」，不是降级。
- 练习页加来源筛选（全部/作业/讲次/全局题）；作答页补题面与原图；订正区按「参考答案 / 分步解答 / 为什么这么想 / 最容易错 / 四档自评」五层摊开——早期把答案塞进 JSON 代码块不算反馈。

### 第 1 项 · 用户结构层（可改可存可恢复）
- 新增 `workbench/src/structure-layer.mjs` 纯函数层：改名 / 换父 / 删除只写 `structure.json`，**analysis.json 一个字节都不动**；节点 id 稳定，题卡挂接与讲解定位不丢。
- 安全闸门：环检测（不能把父节点移到自己后代）、不存在 id 忽略、根不可删、脏字段归一化。
- 导图交互：右键改名、拖拽换父（落点高亮，超过 6px 才算拖，单击仍走展开/讲解）、「恢复模型结构」按钮（不可逆，先 confirm）。章聚焦和导出都吃叠加后的树，不会「全书改了名、点进去又变回去」。
- 三端注册：新增 `structure` action（capabilities / request / app-host），APP manifest 的 UI 元数据同步补齐。

### 第 4 项 · 考点包 + 两处静默失效
- `workbench/src/exam-pack.mjs`：一份 HTML 同时当考前打印件、可复用导出、人可读备份。内容＝用户结构 + 每点一句话考点 + 原题卡（答案/分步/为什么/易错）+ 原图；题图内嵌 base64（≤60 张），下载后脱离 app 仍可见；带 `@media print` 一键打印/另存 PDF。输入全部转义。
- `lib/backup.js` 白名单补 `visionModel` / `deepDive` / `tickEveryRounds`——此前备份恢复后这三个静默回默认，UI 却称「设置已还原」；apiKey 仍永不入包。
- `lib/search.js` 新增 `searchAllWithMeta`：先扫全量再截断，搜索页明确显示「还有 N 条未显示」；老接口 `searchAll` 仍返回数组，协议不变。

### 第 5 项 · 本机快照（保守版）
- `lib/snapshot.js`：改结构前自动在 `library/_snapshots/<bookId>/` 留一份（book/analysis/practice/structure/cards），保留最近 5 份；书内「快照」浮层可手动留档与恢复，恢复前 confirm。**只在本机，不联网不上传**。
- 时间戳到毫秒（秒级会让同秒两次快照互相覆盖）；正则兼容早期秒级目录。

### 验证与诚实边界
- 门禁 `run-tests` **30/30**；十三组判别全绿（新增 `check-card-practice` 23 / `check-structure-layer` 22 / `check-exam-pack` 24）；版本 8/8、形态 18/18；Edge headless 统一验收 **14/14**（156 题渲染、作业筛选、作答页题面与图、订正五层、右键改名刷新保留、恢复模型结构、考点包/快照入口、console 0 error）。
- 修了三处「判别假红」：旧断言写死 action 数量 13、APP manifest 缺两条 UI 元数据、快照恢复断言把「变更前快照」误当成「刚改的那版」——都按当前真实契约改，未放宽标准（回退会红）。
- **没做到**：①「可判分 ≥100」实测只有 1 道能从原文严格抽出选项，其余 143 走自评——不编选项；②导图只做改名/换父/恢复，未做新增节点与删除入口；③考点包是单向导出，无 HTML 回导（回退靠本机快照）；④快照不防硬盘物理损坏，不宣称「数据安全」；⑤ DSH 宿主内点验仍卡 DSH 未运行。SW v37。

## v1.7.3 — 2026-11-27（发布）

三类人群统一计划里的**第 3 项「作业入口接线」**落地。动手前先纠正上一轮的报告错误：真机走查当时没点进「题型」页签就断言"界面无作业入口"，是**假阳性**——5 份作业卡原本就在题型页最底部（3+3+2+7+7=22 题），可展开看题。真问题是埋得太深：27 个折叠组里混着 5 份作业，默认全收起，学生找不到。

- **书内新增「作业」独立页签**（`workbench/src/bookspace.js` 的 `TABS` + `renderAssignments()`）：只收 `kind=assignment` 的 5 份作业，默认全展开，点开就见题目原图。
- **复用而非重写**：`renderCardGroups(body, { onlyAssignment: true })` 加过滤参数，两处展示同一份 `S.cards`，不会一处改一处漏；作业页不调 `needAnalysis()`（题卡来自 cards action，与是否分析无关）。
- **不误导**：作业页提示写明「看思路 / 看答案，不判分。要判分和排程，需先把题卡结构化（补齐选项与答案）」——不做假的可做题入口。
- **未做**：计划里的「练习页按作业筛选」依赖第 2 项（147 题零 `options`，判不了分），单独加筛选没有意义，留到第 2 项一并做。
- SW v35 → v36。

验证：`run-tests` 30/30；十组判别全绿（`check-flow-fusion` 新增 G1–G5 作业页签契约，回退成"埋在题型页"会红）；版本 8/8、形态 18/18；Edge headless 真机 11/11（页签可见可点、恰好 5 份不含讲次、默认全展开、22 题真进 DOM、题型页 27 组未被改坏、URL 直达、console 0 error），截图 `assignment-tab.png`。

## v1.7.2 — 2026-11-27（发布）

补回「已配置零表单」——2026-11-24 重写 `openAnalyze()` 时漏接，11-27 验真发现并修正。

- **`openAnalyze()` 改为先 `readiness()`**：已就绪（`hasKey && model`）不弹任何表单，直接 `runAnalysis()`；缺配置才弹一次共用的 `credentialDialog()`，取消即退出。两条入口共用同一份分析体，不留第二份分叉。零表单路径的 cfg 只带地址/模型，密钥由服务端 `mergeCfg` 补——前端协议里没有密钥。
- **深挖开关挪到设置页**（`views.js#mountLlmSettings`）：原来只在被删掉的分析对话框里，不挪走这个能力就没入口了。保存时写 `deepDive` 到服务端，零表单分析从 `s.deepDive` 读。
- **删掉一段无效状态条**：曾在 `.bs-acts` 插 `.bs-analyzing` 进度条，但 `render()` 会 `railEl.innerHTML=''` 整段重建，刚插进去就被冲掉。真机探针确认它从来没出现在 DOM 里——这是「写了但没接线」的死代码，删掉，进度反馈统一走 toast（真机在场）。
- **SW v34 → v35**（前端改动必升版）。
- 三组判别同步到新契约：`check-compose-chain` T1 改认 `readiness()` + 零表单分支 + 共用对话框 + 共用的分析体（7/7）；`check-settings` E7/E8 改认缺配置复用共用对话框 + 设置页深挖开关（55/55）；`check-flow-fusion` 不变（25/25）。**没降标准**：T1b 断言「已配置分支不构造任何对话框」，回退成弹窗就红。
- **验证**：`run-tests` 30/30；十组判别全绿；版本 8/8、形态 18/18；Edge headless 真机 7/7（设置页深挖开关在场、已配置点分析不弹窗、analyze 请求真发出、协议不带密钥、toast 进度在场、console 0 error）。analyze 请求用 playwright route mock 拦掉，**没真烧模型**。

**账实闭环**：上一版留红的「已配置零表单体验欠账」本版修掉。仍留红的是 maxloop 报告文件缺失、阶段零对照物缺失、DSH 宿主未点验。

## v1.7.1 — 2026-11-27（发布）

v1.7.0 tag 之后的收尾 + maxloop 体验满分冲刺。这批工作 11-23 完成但一直没发版；
11-27 验真时发现三组判别脚本没跟上 11-24 的重构，已按当前真实契约重写并逐条留证据。

**五项收尾（2026-11-23）**：作业题卡 / 书院快照 / 占位词加固 / 真机复核 / 演示 GIF。

- **作业题进卡片**：新增 `scripts/build-assignment-cards.mjs`——5 份课后作业独立成卡 `cards/assignment-NNN.json`（lessonNo=100+seq，kind=assignment），复用讲卡三条硬规则 + 自检 + 违规重试；27 张作业页图已入库转录，语料直接对位（新增图才补跑视觉转录）。实生成 **22 题**（quote 回溯 18/22、自检零违规、needsReview 0）；`Core.listCards` 聚合扩展（lesson|assignment 双白名单 + kind 字段），`/api/core/books/:id/cards` 实测 22 节 / 147 题（125 讲卡 + 22 作业卡）。作业→讲次对位写进每卡 `lessonRef`（1次→第2讲；2次→第3、4讲；3次→第7讲；4次→第8-10讲；5次→第11-13讲），只写数据不驱动结构。core-cards 判别 11→14 条。
- **占位词回喂重跑**：`core/documents.js` compose 产出后 `placeholderHits>0` 时，同对话回喂违规条目重跑一次（其余页保持），取占位更少的版本；BAD 词表补「此处填/此处为」。现存 slides.json 实测 0 处占位（上轮 1 处已在重生成中消失）。
- **演示 GIF**：`scripts/gif-frames.mjs`（playwright-core + Edge headless 关键帧）+ ffmpeg palettegen 三条 → `docs/screenshots/gif-map-zoom.gif`（142KB）/ `gif-study-hint.gif`（189KB）/ `gif-reader.gif`（91KB）。
- **真机复核**：5178 真浏览器逐条点验六条新功能全过（缩放 transform 1→1.44、七步讲解、答案四层、选项判分 + 四档自评、思路点拨无泄漏且答案保持隐藏、阅读器浮层 + 改名）；`check-dsh-adapt` 23/23。DSH 宿主侧卡点：DSH 未运行（desktop 需图形交互），宿主内点验留待 DSH 开机后执行。
- **作业卡 preview 页**：`build-lesson-preview.mjs` 扩展 `--assignments`（作业标题/出处链接指作业题目PDF/页脚带对应讲次），实生成 5 页 `preview/assignment-NNN.html`（共 22 题，题图原字节，quote 已核标注）；抽查 assignment-104 题干含全方向与几何关系、解析 4 步带等号代入。
- 验证：`node scripts/run-tests.js` **30/30**（core-cards 新增 L12-L14）；书院侧 135 条 + 强度 14 条全绿（vendor 快照 v1.7.0 九文件）。

**maxloop 体验满分冲刺（2026-11-23 晚）**：真浏览器 13 页走查 console 0；双 critic（学生视角 + 视觉 25 条清单）独立评审；修 23 条（style.css 12 / views 13 / bookspace 12 / shell 3 / reader / mindmap PAD）；复用四维口径（视觉/美化/便利/复习效果）复评 9.5/9.5/9.5/9.5。走查截图 13 张留本地 `PROCESS/maxloop-体验满分/walk/`（过程证据，按规则不进公开仓库）。SW 从 v30 升到 v34（缓存清单未变，仅版本号随前端改动升级）。

**11-27 发版前验真（不是新功能，是账实对齐）**：
- 修 `workbench/sw.js`：11-23 的批处理把中文注释写成 UTF-8 被当 GBK 的乱码并带 BOM。从 git HEAD 取回原文、`sed` 只替换 `CACHE` 版本号到 v34，字节级复验无 BOM、无乱码。
- 三组判别按 11-24 的真实契约重写（**不是降标准**，逐条给代码依据）：
  - `check-compose-chain` T1 原测 `askDocCredential/readiness/credentialDialog` 三个已随 `openAnalyze()` 重写消失的函数名 → 改测 `loadSettings()` + `credentialFields(s)` + `s.hasKey` + 缺配置才拦；T2 原正则只认纯数字 → 兼容 `(kind === 'review-guide' ? 32000 : 16000)`，取最小值断言仍 ≥16000。
  - `check-flow-fusion` E1-E3 原测「analyze 后自动 compose digest+syllabus」——`bookspace.js:1638` 有 11-24 明确注释「分析后不再自动补整理文档」，原 digest/syllabus 收敛为「复习总纲」走 `build-review-guide.mjs` → 改为反向断言（回退自动 compose 会红）+ 构建脚本指引 + `cachedOnly: true` 探测。
  - `check-settings` E8 原只认 `await readiness()` → 改认服务端预填 + `s.hasKey`，旧文案不得复活。
- 书院 `vendor/tiandao-core` 因导图 `PAD 28→44` 漂移 1 文件，`sync-core.js` 重新同步到 9 文件、源版本 1.7.0、`--check` 与源一致；书院七套件全绿。

**确认的体验欠账（不掩盖）**：11-21 定的「已配置零表单」在 11-24 重写后变成「每次弹预填表单、密钥不用重填」——表单现在承担选模型与递进深挖开关，功能可用但严格说不是零表单；要恢复另开任务。DSH 宿主内点验仍卡在 DSH 未运行（desktop 需图形交互），书馆形态已逐条点过。

## v1.7.0 — 2026-11-23（发布）

七条体验升级，全部先做「地基核对 + 提示词查重」再动手——已有教学深度不重写，只修前端渲染与交互。

- **①导图无界草图**：新增 `workbench/src/map-viewport.mjs`（滚轮以光标为锚缩放、拖拽平移、＋/－/适应、视口状态按书持久化）；`mindmap.js` 加 `.mm-viewport` 层 + 节点淡入动画，点击命中不受 transform 影响。
- **②节点讲解分层**：`desc` 三层递进（是什么/怎么考/易错）用 `splitDesc()` 拆开各归各位；七步面板空态从 5 处降到 1 处（仅确实无题时诚实说明）。
- **③④⑤题型页可学**：选项改可点按钮 + 提交判分；答案按「答案/分步解答/为什么这么想/最容易错」分层；新增 `study-hint.mjs` 的**思路点拨**——只给定位/题型通用法/定义反刍/相近概念，绝不吐答案（21 项判别锁死）。
- **⑥就地阅读器**：点左栏资料直接预览原字节（PDF/图片/txt 原生，其它给下载兜底）；浮层内改名复用 `mark` action，`setFileMeta` 加 `name` 分支（只改展示名，不动磁盘物理文件）。`/api/app/file` 补 docx/xlsx/pptx MIME + inline。
- **⑦配图要准 + 考点重要幻灯片**：移除三处「双字重合猜图」（曾把 SOLIDWORKS 界面配给静力学题），只认 analysis 的 `imageIds`；图意词补齐「受力图/画…图」并重跑确定性配图（Q11 受力图题补图成功，5/14）；幻灯片更名「考点重要幻灯片」，提示词要求重要页优先收录 + 按考点顺序，UI 加「重点优先/知识顺序」切换 + 页码跳转 + 重点页高亮。
- 修复：`source.loc` 永远 undefined → 改读 `anchor`；`check-settings` SW 版本断言从硬编码改为下限（避免每次升版假红）；`test/core-practice.test.js` 收尾由硬 `process.exit()` 改为 `process.exitCode` + 5 秒兜底——Windows + Node v24 下进程碰过 `fetch` 后硬退会在 libuv 收尾抛 `!(handle->flags & UV_HANDLE_CLOSING)`（exit 3221226505），**28 条断言全绿却被判套件失败**，属于环境噪声被记成红灯。
- 验证：`npm test` **30/30**（新增 study-hint 21 项、map-viewport 13 项）；十组判别全绿（配置 55）；真浏览器逐条验收，控制台 0 error；SW v30；真截图 `screenshots-check/t7-*.png`。
- **诚实边界**：docx/xlsx 靠浏览器原生 preview，无法预览时明确给「下载查看」；整页扫描图里含多张子图时无法切分（图与题同页即算配准）。
- **幻灯片真机验证**：按新提示词生成 19 页 / 116 条要点 / 91 处重点标记，页面顺序按「第1章静力学公理→第2章受力分析→3.1汇交力系→3.2力偶系→第4章平面任意力系」展开，符合「按考点顺序」；UI 19 页跳转 chips + 重点优先切换（切换后仍保留全部 19 页）；模型输出含 1 处占位词，UI 已诚实警告未掩盖。

## v1.6.5 — 2026-11-22（未发布）

理论力学全书拆解落地，以及一条被反复踩到的契约断链的根治。

**全书分析（图片型书）**
- 旧结果用 `Qwen/Qwen3-30B-A3B-Instruct-2507` 在旧语料阈值下跑出 2 章 / 3 点 / 0 题的空壳。换 `deepseek-ai/DeepSeek-V4.1-Flash` 重跑：4 章 / 15 节 / 39 点 / 5 类 14 题，质量门禁 `passed=true`，引文 14/14 全命中，185,977 字符语料零截断。
- 图题断链：`buildMessages` 的图清单只看 vision 描述，图片型书只做转录时提示词会强制模型填 `imageIds=[]`。改为也收集语料 `（图id=xxx）`，真无图时才要求空。
- 二次重跑遇 900s 服务端超时（不写盘、无数据损失）。新增 `scripts/attach-source-images.mjs`：按题目 `source.file + source.page` 精确匹配同源页图，只补「题干含图意词 且 imageIds 为空 且同页唯一图」的题，不做相似度猜图。4/4 命中，浏览器实测桁架题配图正确并带出处。

**`cards` action 四处断点补齐**
- `Core.listCards()` 生产端缺失、`capabilities.js` 的 `ACTIONS` 与 `CAPABILITIES` 双份手抄导致新能力被自己的 `has()` 拒绝、app-host switch 与 UI 元数据缺项、`request.js` 缺路由——逐一补齐。`ACTIONS` 改为从 `CAPABILITIES` 派生，根治「加一处漏一处」。
- 新增判别 `test/core-cards.test.js`（11 项，含 app-host 真分发）与 `test/analyze-imageid-prompt.test.js`（6 项）。

**过时断言修正（不是降标准）**
- `app-unified`：12 个 action → 13；`core-http`：「空 cfg 必须 400」与「环境变量密钥自动补齐」冲突，改为「有 key 出真结果 / 无 key 才 400」；`check-overview`：硬编码已移走的概率统计书 → 内存夹具。

**题卡批建**
- 17 讲 / 125 题，预览页 16 份。`build-lesson-preview.mjs` 修补零 bug（`--lesson 1` 原去找 `lesson-1.json`，实际是 `lesson-01.json`）。

**验证**：`npm test` 28/28；十组 check 全绿；5178 / 4090 均 200；真浏览器导图 / 概览 / 题型 / 题图截图均无 console error。

## v1.6.4 — 2026-11-21（未发布）

maxloop 第二轮：**把「看得见但读不了」的两处修掉**。阶段零外查与逐字符证据见 `PROCESS/research-概览与导图可读性/best-practices.md`。

**导图节点（`renderer/js/mindmap-layout.js`）**
- 新增 `wrapLabel()`：按中文语义断点（，、：（与和）换行，最多三行；`NODE_W=224 / NODE_H=58` 与字号层级都不变，格子坐标不受影响。原先 `short()` 会把 `(1) 正态分布曲线的两个主要参数` 吞成 `(1) 正态分布曲线的两个…`。
- 节点里不再画 11px 灰色描述（「有信息但看不清」的假完整）；完整标题 + 描述仍在既有 tooltip 里，点节点仍可到右栏讲解面板读。基准：markmap 13,277★ `stays with its branch as a note that opens in a popover`、jsMind `view.node_overflow: wrap`。

**概览页（新增 `workbench/src/overview.mjs`）**
- 模型没写 `summary` 时不再显示「（模型没有给摘要）」：`deriveOverview()` 从 `tree` / `questionIndex` / `stats` 派生 4–6 条要点（章数、真实章节名、知识点数、两个样例、题数与题型分布），并明确写出「按目录如实整理的结构（不是模型原文）」。模型给了摘要就优先用原文；没有知识结构就直说没有。
- 老书 `questionIndex` 的题挂在 `points[]` 而不是 `items[]`，两种键名都认，避免把 14 道题数成 0；`stats.points` 只当加速路径，实际节点数优先。

**验证**
- `tools/check-overview.mjs`：基线 **7 通过 / 5 失败** → 改后 **18 / 0**（旧红新绿，且清掉了「全局数 tspan 得假红」的测试 bug）。
- 真浏览器（playwright-cli）实测：节点省略号 **0** 个、11px 描述 **0** 个、概览 6 条要点 + 诚实说明；控制台 0 error / 0 warning。基线/修复后真截图留 `screenshots-check/baseline-ux-*.png` 与 `final-ux-*.png`。
- 门禁 `npm test` 24/25（同一 Node24/Windows undici 噪声）；其余八组判别脚本全绿；SW 升 v27（新模块进缓存清单）。

**DSH 全版本适配特化（同日追加）**
- `plugins/dsh-review-analysis/index.js` 新增 `resolveProjectRoot()`：config > `DSH_REVIEW_PROJECT_ROOT` > 安装戳记 `project-root.json` > 从插件位置相对推导。`cordis.patch.yml` 不再写作者本机绝对路径，`__AUTO__` 让仓库 clone 后即可用；`npm run forms:sync` 在本机安装目录写戳记。
- Host 半边补 `/review-analysis/api/settings`、`/settings/test`、`/models` 三个端点，并让 action 入口用 `core/settings.js` 补 cfg；DSH 面板里的 workbench 与 HTTP 形态同语义。静态托管清单补 `src/llm-config.js` 与 `src/overview.mjs`、`.mjs` MIME（漏列就是面板 404）。
- `core/settings.js` 增加 `DSH_LLM_*` / `REVIEW_LLM_*` 环境变量别名——同一把 key 不用在三个宿主里起三个名字。
- 新增 `tools/check-dsh-adapt.mjs`：**22 项全绿**（baseline 取 git HEAD 旧版必红，含真跑 Host 路由、真拉模型清单）；插件自带 21/21、形态漂移 18/18、版本一致 8/8。
- README 重做首屏（徽章 / 三张真截图 / 60 秒上手 / DSH 适配矩阵），给 GitHub 访客一条能立刻看懂的入口；调试截图与归档加入 `.gitignore`，正式截图放 `docs/screenshots/`。

**放弃报告**：自检 #8「实心块溢出画布」在真截图与 viewBox/rect 边界实测中**未复现**，本轮不改布局，保留为历史观察。KNOWN-LIMITATION：老版 renderer 入口仍是 `(无概览)` 空文案；极端无标点超长标题仍会在最后一行出现省略号（tooltip 保留全文）；DSH 宿主 GUI 未由脚本重启，端点以真跑 Host 路由验证，面板实显待本机亲验。

## v1.6.3 — 2026-11-21（未发布）

模型配置从「每次粘密钥」改成「一次配好、全应用共用」。用户原话：**「就用环境变量的硅基流动（可保存住，可找模型，可设置）保存了使用」**。

**配置层（新增 `core/settings.js`）**

- 密钥只有一处权威位置：服务端。解析顺序 **本次请求显式传的 > `library/settings.json` > 环境变量 `SILICONFLOW_API_KEY`**；来源随结果回传（`file`/`env`/`input`），界面能说清「现在用的是哪一份」。
- 对外只给掩码（`sk-…qkoj`）：`publicInfo()` 结构性不返回原文，前端拿不到、也不需要。
- 落盘 `library/settings.json`（`library/` 已在 .gitignore），临时文件 + rename 原子写，尽力 0600；空串＝沿用、`clearKey`＝删除并回落环境变量；只写白名单字段。
- 环境变量读不到时退到 **Windows 用户级注册表**：从资源管理器或快捷方式启动的 node 才有用户环境变量，从某些 shell 拉起时没有——这条兜底让「用环境变量」在任何启动方式下都成立。
- 「找模型」：`GET /models` 归一后按 `chat / vision / other` 分类（embed / rerank / TTS / OCR 不算对话模型，`Qwen3-VL-Embedding` 这类名字带 VL 的也不许当视觉模型）。

**接线（`server.js` / `core/app-host.js` / `core/request.js`）**

- 新增 `GET|POST /api/settings`、`POST /api/settings/test`、`GET|POST /api/models`；配置不是「书库能力」，故意不进 `capabilities.js`，五种形态的能力清单仍是 12 项。
- `/api/app/action`、`/api/core/*`、`/api/study/analyze`、`/api/mindmap/:id` 一律在入口补齐 `cfg`：前端可以只传地址与模型，甚至什么都不传。
- 成功的分析/整理之后 `settings.remember()` 顺手记住这次用的地址与模型（含当场粘的密钥）——「粘一次就够」是这套东西存在的全部理由。
- **修坑**：打开「考点大全 / 考纲」页签时原来会静默发起一次 1–3 分钟的模型调用（`composeDocument` 没缓存就直接生成）。新增 `cachedOnly` 契约：只查缓存，没有就返回 `null`，绝不因为「看了一眼」而花钱。

**前端（新增 `workbench/src/llm-config.js`，SW 升 v26）**

- 三处入口（设置页 / 分析对话框 / 生成文档对话框）共用同一组控件与同一个对话框，不各写一份表单。
- 已配置时**默认零表单**：点「生成考点大全」直接跑，弹窗不出现；只有真的缺配置才问一次，问完存下来。
- 设置页新增「模型与密钥」卡（地址 / 密钥 / 对话模型 / 视觉模型 + 找模型 + 保存 + 测试连接 + 清掉已存密钥）；分析对话框改为预填 + 掩码回显。
- 顺手清掉若干浏览器噪声：密码框归入 form、取消按钮 `type=button`、密钥框 `autocomplete=off`。

**验证**

- 新增 `tools/check-settings.mjs`：**52 项判别全绿**（不泄漏 / 优先级 / 持久化 / 分类 / 接线 / SW / 降级七组）。
- `tools/check-compose-chain.mjs` 按新契约重写（旧的「必须每次弹框要 key」是被用户否掉的旧行为）。
- 门禁 `npm test` 24/25（唯一红仍是 Node24/Windows 下 undici 退出断言，断言本身 28/28 全过）；其余七组判别脚本全绿。
- 真机：`GET /api/settings` 回 `keySource=env / sk-…qkoj`；`/api/models` 回 92 个模型（56 对话 / 5 看图）；`POST /api/settings/test` 真发一次最小对话 **ok**；浏览器里点「找模型」→ 选中即填入；点「生成考点大全」**不弹窗**直接产出 4 章 43 条并落盘。

## v1.6.2 — 2026-11-17（未发布）

把导图视觉与「天道书院」定稿统一（基准：天道书院 `PROCESS/research-导图视觉美化/best-practices.md`），并修掉「点击后变透明」。

**导图视觉（`renderer/js/mindmap-layout.js`）**

- 配色：7 色高饱和 → **低饱和六色**（`#4E8098/#C17450/#5C8D6B/#7C6A9C/#A6803E/#A85F6E`）；根节点改中性墨色 `#263746`，与彩色主干拉开主次。
- 字号层级：原来全部 12px → **root 20 / 章 16 / 节 14 / 点及以下 13**，说明行 11px（`typeFs` 导出可测）。
- 节点：`NODE_W 176→224`、`NODE_H 34→58`、`GAP_X 62→56`、`GAP_Y 14→18`，卡片能放「标题 + 一行说明」；层级样式 root/章实心、其余白卡片 + **左侧 4px 色条**。
- 连线：主干（连到章）2.4px、其余 1.6px，层次感来自线宽。
- 文字宽度估算按中文 1.0 字宽（`×0.95`）而非 0.62，修掉说明文字溢出卡片。

**交互修复（`renderer/css/core.css` + `renderer/js/core-ui.js`）**

- **「点击后变透明」**：搜索未命中 `dim` 的 `opacity .28` 太透 → 提到 **.52** 且 hover 恢复 1；点节点时主动清除 `dim`。
- **选中态补样式**：原来 `.mm-node.selected` 只有 class 没有样式 → 深色粗描边（`#263746` 2.6px）+ 阴影，**不改变填充色**，文字始终清晰。
- 画布 `max-height` 62vh → **78vh**，图更占视野。

**验证**：`node scripts/run-tests.js` 24/24 套件通过；`test/core-mindmap-v2.test.js` 100 项通过；版本同步 1.6.2（8 处一致）。

## v1.6.1 — 2026-11-14（已发布）

对应两条核心要求补齐「语义重点识别」与「全篇幅自动整理」。

**语义重点（不手动分层）**

- 资料一键标 ★ 重点 + ✎ 一句话说明为什么重要（`mark` action，写入 `book.files` 元数据）；应用里点星标即时生效。
- 分析与整理时把清单注入提示词（【用户重点★】+ 用户说明），模型按说明决定侧重——分层靠语义，不靠手动整理层级。

**全篇幅自动整理（`compose` action，两份文档）**

- **考点大全（digest）**：囊括全部考点的知识点汇总；每个考点带 `quote` 逐字原文引用，程序逐字校验命中才标「原文已核」，未命中如实标注；禁「（略）/待补充/同上」等占位。
- **考纲（syllabus）**：按考试重要性从高到低排章（`rank` + `why`），出题与知识点混杂——每章给必背要点、公式清单、自编例题与分步做法；不含「可放弃」内容，越靠前越重要。
- 文档独立落盘 `documents/<kind>.json`；已生成即返回缓存，`refresh: true` 强制重生成；统计条数、命中率、占位词告警。
- 书内新增「考点大全」「考纲」两个页签，列表无上限：有多少条渲染多少条，不折叠、不省略。

**图片直显**

- 新增 `GET /api/app/file?bookId=&fileId=` 原图回读（白名单校验，只回读已登记文件）；资料列表对图片资料直接显示缩略图。

**修复**

- 模型返回对象型字段统一 JSON 字符串化（不再显示 `[object Object]`）。
- user 语料尾部指令移除，避免被模型当成正文内容。

**验收**：全链路自测 **14/14**（本地 mock 模型走真实管线：建书 → 导入含图片 → 标重点 → 整体分析 → 两份文档生成与落盘 → 路由 → 缓存命中 → 穿越拦截）；真浏览器走查 **11/11**（★ / 说明编辑 / 缩略图 / 两页签渲染 / 交互，零 JS 报错零 4xx）；`npm test` **24/24**、一体契约 **25/25**、check-versions 8 处、check-forms 18 处。

## v1.6.0 — 2026-11-14（已发布）

> 版本说明：`v1.5.2` 是上一轮已发出的 tag（指向 `1e472b1`：能力清单单一真源 + 三入口端到端同步、全链路静态实验站、天道书阁更名）。本轮三个功能提交统一收在 `v1.6.0`，不再把大功能挂在旧版本名下。

**统一应用 workbench**：项目从「单文件页面 + portal 套 iframe」升级成多文件应用工程（`workbench/`：`host/state/router/ui/views/shell` 各司其职，`index.html` 只做挂载点），默认首页指向它，可安装为 PWA。

- **一个东西、五种形态**：`core/app-host.js` 一次实现 manifest/state/invoke；`core/capabilities.js` 一次定义 10 个 action；内置浏览器（`/api/app/*`）、Electron（`ipcMain workbench:*`）、DSH 插件（`/review-analysis/api/app/*`）、Skills/CLI、HTTP 全部读同一份 core。前端 13 个视图运行时从后端清单拉，不在前端写第二份。
- **DSH 插件新增「应用」页签**：侧栏「复习分析」→ 面板分「应用 / 状态」两页；应用页内嵌的就是 `workbench/` 同一份工程（`/review-analysis/app/index.html?base=/review-analysis/api/app`），静态资源逐文件 `exact` 托管，思维导图布局复用 `renderer/js/mindmap-layout.js` 唯一源码。
- **书详情**：真 SVG 思维导图（右向/双侧/组织三种布局）、题型索引；题目页选项可点、就地判分、四档自评写回 SRS；练习页真统计与卡片列表。
- **示例书**：`数据结构示例书（内置演示 · 可删）` 走 `create → addFile → analyze` 真管线生成（模型用本地 mock），不是手写 JSON；旧版 `lib/store.js` 的书按红线不合并、不迁移。

**书内工作区（打开一本书之后）**：`workbench/src/bookspace.js` 把「书详情」换成三栏学习空间。

- 左栏：书信息 + 拖拽/点击导入 + 资料存放结构（可折叠、整栏可收拉）+ 题型分类树；进入时隐藏全局侧栏（沉浸），离开自动恢复。
- 中间四页签：思维导图（复用 `mindmap-layout.js`，节点可点）｜提纲讲解（章→节→知识点，标出每层题数）｜题型（按类展开全部题目，可就地看答案/分步解答/思路/易错）｜概览。
- 右侧六步逐步讲解：定位 → 是什么 → 常考 → 真题 → 答案思路 → 易错，可「继续 →」或「一次看完」；本节点没直接挂题时回退到最近有题的分支并**注明是哪一层**，不冒充本节真题。
- 导入走 `POST /api/app/action {action:'add'}` 真落盘；分析弹窗填地址/模型/密钥（密钥只在本次请求内存里，不落盘），显示已耗时。
- 协议只加字段、不加 action：`list` 返回每本书 `files`、`get` 返回 `book` 元数据，五形态契约不变。
- 启动台新增「继续」最近的书；书架卡片显示「已分析 / N 份资料」，点「打开」直接进工作区。

**本轮修复**

- **默认首页 404**：`server.js` 原先把 `/` 直接吐 `workbench/index.html` 内容，相对路径被解析成 `/src/...` 而全部 404（页面只剩「正在启动应用…」）。改为 `302 → /workbench/`，由目录 URL 承载相对路径。
- **DSH 插件 Host 半边 failed**：`cordis.patch.yml` 的 `projectRoot` 仍指向旧目录 `Desktop/rlbuild`（无 `workbench/`，核心已迁走），报「找不到统一核心能力清单」。改为本仓库绝对路径即可；改完用 `plugin_manager` 对 `include:review-analysis` 关→开一次热重载，不必重启整个应用。
- **`el()` 不摊平嵌套数组**：讲解面板整块打不开（`appendChild` 收到非 Node）；改为递归摊平。
- **Service Worker 缓存优先**：改完 JS 刷新仍跑旧代码，容易误判「修了没生效」；改为网络优先、缓存兜底（缓存名 v3）。
- **文件选择框被重渲染替换**：选文件瞬间丢掉文件，导入变 0 份；改为整个工作区单例隐藏 input。
- **叶子知识点永远「暂无真题」**：题目的 `pointPath` 不含书根，整条路径比对永不命中；改为去掉书根后的祖先链前缀匹配，回退时注明题来自哪一层。

**验收**：`npm test` 24/24 全绿（含 `test/app-unified.test.js` 25 条一体形态判据）、`check-versions` 8 处、`check-forms` 18 处一致；真浏览器（Edge 1440×900）逐项走查四页签 / 导入 / 分析弹窗 / 资料栏收拉 / 逐步讲解，控制台 **0 错误**，截图见 `PROCESS/workbench-verify/49-55`；DSH 真实窗口截图见 `PROCESS/workbench-verify/run-20261114-1130/`。

## v1.5.1 — 2026-11-11（已发布，安全补丁）

安全补丁：默认窗口 `core.html` 的 API 密钥不再驻留 `localStorage`。

- **真问题**：`renderer/js/core-ui.js` 的 `saveCfg` 把含 `apiKey` 的 `core_llm_cfg` 整体写
  `localStorage`（密钥长期驻留，共享电脑有风险）；旧版 `index.html` 的 `settings.js` 早就是
  `sessionStorage` 分层且被 e2e 守护。两形态不一致。
- **修复（限定 core-ui.js）**：`loadCfg/saveCfg` 剥离 `apiKey`（只存 baseURL/model 到
  `core_llm_cfg`）；新增 `core_llm_key`→`sessionStorage` + `getKey/setKey/fullCfg()`；
  `#saveSettings` 把密钥单独存 `sessionStorage`、`fillSettings` 从 `sessionStorage` 回填、
  `analyze` 改用 `fullCfg()` 合并会话密钥；零迁移，旧数据读取时忽略 `apiKey`。
- **判别与门禁**：`_e2e/core-key-split.e2e.js` baseline 2/4 → candidate 4/0；`npm test` 21/21、
  `core-ui-verify.js` 139/0（双形态不退化）、`node --check`、凭据扫描无真命中、版本 8 处一致。
- 文档：README / API配置 / CHANGELOG 同步订正为「两入口均已凭据分层」。

## v1.5.0 — 2026-11-10（已发布）

> **状态（已闭环）**：`huanweide` 账号邮箱在网页侧验证后（账号级，对所有仓库生效），
> `git push ghssh main` 与 `git tag -a v1.5.0` 均已成功上云，CI 自动构建并公开发布。
> 命令行无头 msedge 复核资产 5 项齐全（Setup / portable / `.blockmap` / DSH 插件 zip / `latest.yml`）。
> 阻塞详情见 `PROCESS/research-competitor-e2e/release-prep-v150.md`。

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

## 未发布批次（2026-11-11 · ① core 形态密钥分层）

- **① core.html 默认窗口密钥改 sessionStorage 分层**：原 `renderer/js/core-ui.js` 把含 apiKey 的 `core_llm_cfg` 整体写 `localStorage`（密钥长期驻留，README/CHANGELOG 曾明文），现对齐 `index.html` 的 `settings.js` 凭据分层——`loadCfg/saveCfg` 剥离 apiKey（只存 baseURL/model 到 `core_llm_cfg`），新增 `core_llm_key`→sessionStorage，`analyze` 发送处改用 `fullCfg()` 合并会话密钥（否则分析丢密钥）；`fillSettings` 从 sessionStorage 回填；零迁移，旧 `core_llm_cfg` 含 apiKey 的旧数据读取时忽略。
- **判别**：独立 e2e `_e2e/core-key-split.e2e.js` baseline `2/4 exit 1`（localStorage 含 apiKey / sessionStorage 无）→ candidate `4/0`，两条回归守卫（baseURL/model 保留、重开弹窗回填）两版恒绿。
- **门禁**：`npm test` 21/21、`core-ui-verify.js` 139/0（双形态不退化）、`node --check`、`core-key-split` 4/0、凭据扫描无真命中。
- **未升版本号 / 未发版**：改动要生效需重建 dist 或发 v1.5.1（CI 构建）；本机 `dist/` 仍是 0.7.0，待发布环节。
