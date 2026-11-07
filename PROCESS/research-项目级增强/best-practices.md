---
title: 复习资料图书馆 · 项目级增强阶段零基准（Office 预览 / exe 打包 / 本地提示词驱动参考资料）
date: 2026-11-05
tags: [maxloop, 阶段零, 外部基准, 融合决策, 零云端]
source: 2026-11-05 WebSearch 七组检索结果（逐字符锚点见下）；仓库地址逐条标注
---

# 阶段零 · 合格产品长什么样

> 本轮对象：用户指令「234同步制作 项目级」＝上一轮交付小结里列的选项 2（Office 内嵌预览）/ 3（Electron 打包 exe）/ 4（AI 按提示词生成参考资料）一起做，按项目级工程质量落地。
> 铁律延续：零云端、零外链、真落盘、软删可逆、交卷前零反馈（本系统不涉及答题，前四条适用）。

## 一、七组检索与真实仓库证据锚点

| # | 检索组 | 真实项目 / 来源 | 逐字符证据锚点 | star 量级 |
|---|---|---|---|---|
| 1 | docx/xlsx 前端解析 | `mwilliamson/mammoth.js` | "6,300+ stars and 670 forks under the permissive BSD-2-Clause license"；"a prebuilt mammoth.browser.js that works with CommonJS or as a global"；"**the library performs no sanitisation, so you must add your own protections for untrusted input**" | 6.3k |
| 2 | 同上 | `SheetJS/sheetjs`（Community Edition） | "Truly open source"；`XLSX.utils.sheet_to_html(wb.Sheets[name])`；"sheet_to_html returns a whole document" | 行业事实标准 |
| 3 | 转换服务（对照组） | `kkFileView` | "over 14.2k stars on GitHub"；"developed based on the Spring Boot framework"；"core relies on OpenOffice or LibreOffice for the format conversion" | 14.2k |
| 4 | XSS 清洗 | `cure53/DOMPurify` | "17.5k stars"；`const clean = DOMPurify.sanitize(dirty);`；"whatever you do to the markup after sanitization can undo it"；Apache-2.0 / MPL-2.0 | 17.5k |
| 5 | 离线文档管理系统形态 | `PHJ369906/Dochub` | "本地存储 — 数据保存在本地 SQLite,无需联网"；"多级分类 — 树形分类结构,支持无限层级"；"在线预览 — 内置 PDF.js 渲染…Word/Excel 转 HTML 预览"；"高级搜索 — 关键词 + 分类 + 标签 + 发布机关 + 时间范围组合筛选" | Tauri 2 + Vue 3 |
| 6 | 提示词管理 / 目录继承标签 | `AlaxWW/knbase`（AI-Paperless） | "**AI 提示词管理** 界面化配置和管理用于 LLM/VLM 的系统提示词和用户提示词模板"；"文件上传到特定节点后,标签会自动继承目录层级"；"混合检索引擎 融合关键词、语义、元数据过滤"；"数据不出站" | paperless-ngx 二次开发 |
| 7 | 离线本地索引 | `olivernn/lunr.js` | "Github 目前Github上star数6.6k"；"本地搜索索引将更快,没有网络开销,并且即使没有网络连接也将保持可用" | 6.6k |
| 8 | exe 打包 | `electron-userland/electron-builder` | "Windows: nsis … **portable (portable app without installation)**"；"portable — use when no installation at all is the goal. Single executable, runs from any location. No registry entries, no Start menu entries" | 官方 |
| 9 | 打包踩坑（中文实证） | CSDN 免安装 HTML 打包 EXE 全攻略 | "**files 数组里列出所有需要打包进去的资源文件, 一定要把 HTML 引用的 js/css/图片目录列全 ,漏一个就白屏**"；"productName 不要写中文太长的名字,否则生成的 exe 文件名可能在拷贝到某些旧系统时出现乱码" | — |
| 10 | 前端解析边界（中文实证） | CSDN MV3 Office 在线预览踩坑 | ".docx/.xlsx/.pptx 都是 OOXML 格式,**本质是一个 zip 压缩包**"；"文件本身不出浏览器"；"**解包 50MB 的 docx 时主线程会明显卡顿,建议放 Worker 里跑**"；"这个方案适合做『打不开时的兜底』,不适合当主打方案"；"还原度打折：Word 的分页、页眉页脚、复杂表格会丢；PPT 动画直接忽略" | — |
| 11 | XSS 实证（中文） | Vue3 预览 Office 注意事项 | "docx转出的HTML**可能包含样式和脚本片段**,直接绑定到v-html存在XSS风险。强烈建议使用DOMPurify等库先对HTML做一次清洗" | — |

## 二、功能基准（合格产品该有什么）

来自 `Dochub` / `AI-Paperless` / `kkFileView` 三家交叉：

| 维度 | 基准 | 我们现状（2026-11-05 上轮交付时） |
|---|---|---|
| 存储 | 本地优先，数据不出站 | 已达成：Node fs 真落盘 `library/` |
| 分类 | 树形多级 + 标签 + 层 | 已达成：书 + 层（L1/L2/L3+），标签有字段但筛选弱 |
| 预览 | PDF / 图片 / 文本 / Word / Excel / PPT | **缺**：PDF、图片已有；Word/Excel/PPT 只有「下载后查看」兜底 |
| 搜索 | 关键词 + 分类 + 标签 + 时间组合筛选 | **缺**：只有单字段 `includes` 模糊搜 |
| 提示词 | 界面化配置提示词模板，驱动资料处理 | **缺**：`prompt` 只是存着的文本字段，不参与任何计算 |
| 来源标记 | 用户上传 / 系统生成两类可区分 | 半成：`source` 字段存在（`user`/`system`），但**前端无法产出 system 资料** |
| 分发 | 免安装单文件 exe，双击即用 | **缺**：只有 server 模式 + 未装依赖的 Electron 入口 |
| 删除 | 软删回收站可恢复 | 已达成（上一轮闭环补全） |

**结论（检查点句式，maxloop 阶段零硬要求）**：搜了 7 组真实仓库，功能基准是「本地优先存储 + 树形分类 + 全格式浏览器内预览 + 组合检索 + 提示词驱动处理 + 用户/系统双来源 + 免安装分发」；我们缺 **① Office 内嵌预览 ② 组合检索 ③ 提示词真正驱动处理 ④ system 来源产出 ⑤ exe 分发**；本轮按用户「234」指令加 ①④⑤，②③ 进 KNOWN-LIMITATION 不铺（守 R/C/N 的 N 关：能不加就不加）。

## 三、融合决策表（每项过 R/C/N + 逐字符锚点）

| 改动 | R 合理性 | C 正确性（证据） | N 必要性 | 结论 |
|---|---|---|---|---|
| docx → mammoth.browser.js 转语义 HTML | 与「浏览器内看资料」一致 | "prebuilt mammoth.browser.js" 真实存在；BSD-2-Clause | 用户明确要选项 2 | **采纳** |
| 转出 HTML 必须经 DOMPurify.sanitize 后再入 DOM | 用户上传的是不可信文件，零云端系统不能留 XSS 口子 | "the library performs no sanitisation" + "直接绑定到v-html存在XSS风险" 双锚点 | 非加不可，不加是安全缺陷 | **采纳（强制）** |
| xlsx → SheetJS `sheet_to_html` → 清洗 | 同上 | `XLSX.utils.sheet_to_html` 真实 API | 同上 | **采纳** |
| pptx 前端渲染 | 一致性 | **未找到**可锚定的真实高 star 纯前端 pptx 渲染仓库；两条实证只提 "pptxjs 处理 PPT" 但未给仓库/版本/star | 不做不阻塞主链路 | **打回 → KNOWN-LIMITATION**（保留下载兜底 + 抽文本预览降级） |
| kkFileView 式 LibreOffice 服务端转换 | 撞零云端/零服务依赖 | "Spring Boot framework" + "LibreOffice"；需要额外部署 | 为一个预览引整套服务，过度 | **打回** |
| 大文件丢 Worker 解包 | 用户会传 50MB+ 复习 PPT/PDF | "解包 50MB 的 docx 时主线程会明显卡顿,建议放 Worker 里跑" | 不加工整页卡死 | **采纳（性能闸门）** |
| 云端大模型按提示词生成参考资料 | **直接撞零云端铁律** | 无本地替代证据 | 用户第一轮就钉死零云端 | **打回** |
| 本地大模型（权重入包） | 零云端但 exe 体积膨胀到 GB 级，零基础用户装不动 | 无检索证据支持轻量可行 | 与「双击即用」冲突 | **打回** |
| **本地提示词驱动抽取式生成**（融合替代） | 保留「提示词驱动处理 + system 来源」的产品价值，不破任何铁律 | `AI-Paperless` "AI 提示词管理" + "标签会自动继承目录层级"（结构可本地化）；`lunr.js` "没有网络开销…即使没有网络连接也将保持可用"（本地打分可行） | 用户明确要选项 4，又必须守零云端 → 唯一自洽解 | **采纳** |
| electron-builder `portable` target | 免安装双击即用，与 server 模式互补 | "Single executable, runs from any location. No registry entries" | 用户明确要选项 3 | **采纳** |
| `files` 白名单显式列全 renderer/vendor | 漏一个就白屏 | "漏一个就白屏" 逐字符锚点 | 非加不可 | **采纳（强制）** |
| `artifactName` 用英文短名 | 中文长名在旧系统可能乱码 | "productName 不要写中文太长的名字…可能出现乱码" | 一次性配置成本为零 | **采纳** |
| playwright-core 从 dependencies 移 devDependencies | 测试库不该进生产包 | 现状 package.json 第 15-17 行实证 | 打包体积 + 依赖分层，项目级必清 | **采纳** |
| 组合检索（多条件） / 树形无限层级 | 产品升级价值有，但本轮未点名 | Dochub 锚点 | 与 234 无关，铺开=范围膨胀 | **打回 → KNOWN-LIMITATION** |

## 四、本轮方案清单（融合后）

1. **依赖分层**：`playwright-core` 移 `devDependencies`；新增 `electron-builder` 到 `devDependencies`。
2. **本地 vendor**（运行时零外链）：`mammoth.browser.js`、`xlsx.full.min.js`、`purify.min.js` 落 `renderer/vendor/`，用 `<script src>` 本地引入，不发任何 CDN 请求。
3. **预览分发**：`.docx` → mammoth → DOMPurify → `iframe srcdoc`；`.xlsx/.xls/.csv` → SheetJS `sheet_to_html` → DOMPurify → `iframe srcdoc`；`.pptx/.ppt` → 抽 zip 内文本做纯文本预览（不伪造还原度），保留下载；`.doc` 老格式明确提示另存为 `.docx`。大文件（>8MB）解包放 Worker。
4. **本地系统参考资料生成**：`lib/insight.js` 纯 Node——按书的「层」权重（L1 > L2 > L3）+ 提示词关键词命中打分，从已落盘资料抽文本，产出一份 markdown 复习提纲，作为 `source:'system'` 资料落到 L1，卡片上标「系统/AI」，并回链来源文件名。全本地、零网络、零模型。
5. **exe**：`build.win.target=portable`、`arch=x64`、`files` 白名单含 `renderer/vendor/**`、英文 `artifactName`。
6. **测试**：单测加「生成资料落库 + source 标 + 回链」；e2e 真点 docx/xlsx 预览、真点生成按钮、断言零外链请求、零 JS 报错。

## 五、未找到清单（诚实边界，不编）

- **纯前端 pptx 渲染的真实高 star 仓库**：七组检索只出现 "pptxjs 处理 PPT" 的提法，无仓库地址 / star / 版本 / API 文档可锚定 → 标未找到，本轮不做 pptx 高保真渲染。
- ~~Windows 上 electron-builder 首次打包的实际耗时与产物体积~~ **已实测回填**：`--dir` 目标 7 秒、退出 0，产出 `dist/win-unpacked/ReviewLibrary.exe` 173 MB（整目录 260 MB）；`--win portable` 六次全败，见 `放弃报告-单文件exe.md`。Electron 版本 31.7.7 / electron-builder 24.13.3。**2026-11-06 再回填**：把项目复制到纯英文路径 `C:\Temp\review-library` + 复用本地缓存 + 国内镜像后，`--win portable` 一次成功，产出 69 MB 单文件 exe，见该报告第七节。原「六次全败」结论只对中文路径 + 需联网下载二进制的条件成立。
- ~~mammoth / SheetJS / DOMPurify 是否需打包进 exe~~ **已实测回填**：`files` 白名单显式列 `renderer/**/*` 后，asar 共 23 项，三库 + preview.js + preview-worker.js + insight.js + main.js + preload.js 全部在包内；桌面版 CDP 验证 `window.DOMPurify / mammoth / XLSX` 三者均真加载（10/10）。
- **LibreOffice 转换在本机的可用性**：未查，因为方案已打回。
- **真启动桌面版才暴露的 bug**（本轮新增实测）：`app/main.js` 原数据目录落在只读 `app.asar` 内，`fs.mkdirSync` 抛错导致主进程秒退。server 模式与浏览器 e2e 都测不到，只有 CDP 真启动才暴露。已修为 exe 同级 `library/`，修后复验 10/10。
- **环境干扰（非产品 bug）**：WorkBuddy 沙箱注入 `ELECTRON_RUN_AS_NODE=1`，任何 Electron 被当纯 Node 跑、`--` 参数全报 `bad option`。验证脚本 spawn 时删除该变量即可；用户本机双击不受影响。

## 六、KNOWN-LIMITATION（本轮显式交接）

- pptx/ppt 不做版式还原，只做文本抽取预览 + 下载兜底；Word 分页/页眉页脚/复杂表格会丢（mammoth 语义转换的固有限制）。
- 「系统参考资料」是**本地规则抽取**，不是大模型生成。它按层权重 + 关键词命中产出提纲，不产生新知识点。要真·AI 生成必须破零云端或引入本地模型，两者本轮都打回。
- 组合检索（多条件筛选）、树形无限层级分类：本轮不做。
- exe 若因本机缺 Electron 二进制 / 网络受限打不出来，按 maxloop R4 出放弃报告，标 KNOWN-LIMITATION，不影响 server 模式与 e2e 全绿。

## 七、后续状态回填（2026-11-06，用户指令「都试试」）

上文第六节的三条 KNOWN-LIMITATION 中有两条已被推进，按「错误不删」保留原文，状态在此更正：

| 原条目 | 现状 | 证据 |
|---|---|---|
| 组合检索（多条件筛选）本轮不做 | **已做**：来源 / 标签 / 时间 / 类型 与关键词、层筛选六维 AND，命中计数 + 清空 | `_e2e/e2e.js` 新增 9 项断言，58/58 全绿；`_e2e/shots/` 有真截图 |
| exe 打不出来，标 KNOWN-LIMITATION | **已产出**：纯英文路径 + 本地缓存 + 国内镜像，`--win portable` 一次成功，69 MB | `C:\Temp\build-en.log` / `build-en2.log`；`放弃报告-单文件exe.md` 第七节 |
| 树形无限层级分类 | **仍未做**，维持限制 | 当前仍是「书 → 固定层号 → 资料」三层 |

新增实测结论（只有真跑才拿得到）：**单文件 portable exe 的数据落点是独立于免安装目录版的坑**。portable 自解压到系统临时目录运行，`app.getPath('exe')` 指向临时目录，数据会跟着落进临时目录、关掉即丢。必须用 electron-builder 注入的 `PORTABLE_EXECUTABLE_DIR` 作落点。`_e2e/portable-check.js` 故意不设 `REVIEW_LIBRARY_ROOT` 做取证：修复前 8/9（落点项失败），修复后 10/10。这是第三个「只有真启动才暴露」的 bug，前两个见第五节。

真实资料种子 `scripts/seed-library.js` 也把「成百上千份资料」从口号变成可验事实：两本真书、12 份工作区已有资料按层落盘，`_e2e/seed-check.js` 8/8 验真（含考纲 md 内容真读回）。
