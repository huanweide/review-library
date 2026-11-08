# 1.0 研究基准：拖入 / 优雅前端 / DSH 插件与 skills 系统

> 阶段零外部学习（maxloop-overlord v4.3 强制）。本文件落盘「搜了什么 / 功能基准 / 我们缺什么」对照表，作为后续改动的事实源。凡改动须对照此表，避免闭门造车。

---

## 一、搜了什么（5 组查询）

1. **Electron 拖入 / 打开文件**：electronjs.org/docs/tutorial/native-file-drag-drop、dialog.showOpenDialog API。
2. **PKM 优雅前端基准**：Obsidian / Logseq / SiYuan（思源）的书架网格、拖入导入、进度引导、卡片式资料录入。
3. **Agent skills 架构白皮书**："Skills are all you need" 四层契约（manifest + 运行时边界 + 可复现测试）。
4. **知识图谱可视化**：D3.js 力导向图（d3-force / d3-zoom）+ 全展开静态图 JSON。
5. **真实 DSH 插件同项目理解样例**（本机已装 skill，逐字读源码）：`review-work` / `book-dissector` / `gh-project-optimizer`。

---

## 二、功能基准（1/2/3…）

### 基准 1 · 拖入与打开文件（Electron 官方）
- 用标准 Web Drag & Drop API 拖文件进应用：`ondragover` / `ondragleave` / `ondrop` + `e.dataTransfer.files`。
- "打开文件"用 `dialog.showOpenDialog({ properties: ['openFile','multiSelections'] })`，主进程 `ipcMain.handle` 包一层。
- **本项目已具备**：`app/main.js` 已有 `dialog:openFiles`；`book.js` 的 `layerItem` 已支持"拖到某层即上传"。**缺**：书架级拖入遮罩、全局 overlay、显式"打开文件"按钮、资料录入页整体优雅化。

### 基准 2 · PKM 优雅前端（Obsidian/Logseq/SiYuan）
- 本地优先 + 卡片网格书架 + 拖入即导入 + 进度/引导气泡。
- 思源：前后端分离（TS+Electron+Vue+CodeMirror），Markdown 为显示层，SQLite 管索引。
- **我们缺**：资料录入态的"空态引导 / 拖入高亮 / 分层可视化 / 进度感"，以及一致的设计 token（间距、圆角、阴影、配色）。

### 基准 3 · Agent skills 契约（白皮书）
- manifest：id / inputs(JSON Schema) / outputs / auth / cost。
- 运行时声明执行边界（是否网络 IO / 文件读写）；可复现测试。
- **我们缺**：把复习分析能力包装成统一契约的 skill。

### 基准 4 · 真实 DSH 插件"同项目理解"样例（本机已读）
- `gh-project-optimizer`：**读项目根 `GH_OPTIMIZER_STATE.json` + `OPTIMIZER_LOG.md` + `references/governance.md`**，按状态文件轮转仓库、驱动每轮 1-3 点 + 自检（lint/test/build）。这是最标准的"同项目理解"：skill 不只处理输入，还**读当前项目上下文与历史状态**来决策。
- `book-dissector`：CLI 形态，`--book <file> --template <x> --out <dir>`，五套模板 × map-reduce，产出 `lorebook.json` / `characters.md` 等结构化资产。
- `review-work`：固定输出模板（审查报告 markdown 表格：结论 / 问题清单 / 好的地方 / 优先修复 3 个），`auto-trigger` + `trigger-words` frontmatter。
- **结论**：DSH 插件 = `SKILL.md`(name/description/agent_created + trigger-words + when-to-use) + 脚本(driver) + 契约(api-contract) + references；"同项目理解"= 读项目本地状态文件；"一轮轮驱动"= think→invoke→observe 循环；"圆满格式"= 固定 Markdown 报告 + 结构化 JSON。

### 基准 5 · 侧边栏适配（Expert 形态）
- 本机 `expert.json`：Expert = 侧边栏"专家"入口，元数据 `name/profession/defaultInitPrompt/pluginName/industryId`；底层是一个 plugin 文件夹（含 `mcp.json` + `skills/`）。
- **我们缺**：把复习分析做成"可在侧边栏打开使用"的 Expert 形态（或等价的可交互面板）。

---

## 三、我们缺什么 → 这次加什么（对照表）

| # | 基准有什么 | 我们现在有什么 | 缺什么 | 这次加 |
|---|-----------|---------------|--------|--------|
| A | 拖到书内某层即上传（基准1） | `book.js` 已支持书内层拖入 | 书架级拖入遮罩、全局 overlay、"打开文件"按钮、空态引导 | 全局拖入 overlay + 书架拖入区 + 打开文件选择器 + 优雅空态 |
| B | PKM 卡片网格 + 拖入高亮（基准2） | 基础 book-grid / material-grid | 设计 token 统一、拖入高亮、分层可视化、进度感 | `css/style.css` 优雅化 + overlay 动画 |
| C | skills 统一契约（基准3） | 无 | 把能力包装成契约化 skill | `skills/review-analysis/api-contract.md` |
| D | 同项目理解（基准4·gh-project-optimizer） | 无 | driver 不读项目 library/ 与状态 | `driver.js` 读 `library/` + `REVIEW_ANALYSIS_STATE.json` 轮转 |
| E | 一轮轮驱动（基准4 + maxloop） | maxloop 已用于本项目迭代 | skill 内部未固化循环协议 | SKILL.md 写"一轮轮驱动"轮次协议 |
| F | 圆满输出（基准4·review-work） | 前端 SVG 局部图 | 全展开思维导图 JSON + Markdown 报告产物 | `driver.js` 产 `report.md` + `mindmap.full.json` |
| G | 侧边栏适配 Expert（基准5） | 无 | 不能在侧边栏"打开使用" | `expert-manifest.json` 侧边栏元数据 |
| H | 视觉一次性自检（用户要求"检测-实验运行一次"） | v0.9.0 有 `probeVision` 但未在启动时跑 | 首次配置后未自动自检 | `App.init` 中若 llm 引擎已填且未自检过 → 跑一次 `probeVision` 显状态条 |

---

## 四、结论（句式锚点）

搜了 Electron 拖入、PKM 优雅前端、skills 白皮书、D3 全展开、以及本机 3 个真实 DSH 插件（review-work / book-dissector / gh-project-optimizer），功能基准是 1 拖入打开文件 API、2 PKM 卡片网格优雅度、3 skills 统一契约、4 同项目理解+一轮轮驱动+固定输出、5 侧边栏 Expert 形态；我们缺 A 书架级拖入与优雅化、C/D/E/F skill 契约与同项目理解驱动、G 侧边栏形态、H 视觉一次性自检，所以这次加：全局拖入 overlay + 打开文件按钮 + 优雅前端、DSH `review-analysis` skill（api-contract + driver 读 library/ 状态轮转 + 产 report.md 与 mindmap.full.json）+ expert-manifest 侧边栏适配、以及启动自检。

---

## 五、关键证据锚点（逐字符引用，防幻觉）

- Electron 拖入：`ondragover`→`preventDefault`→`ondrop`→`e.dataTransfer.files`（`book.js` 行 104-113 已用此模式）。
- `app/main.js` 行 131-134 已有 `ipcMain.handle('dialog:openFiles', ...)`；`preload.js` 行 73 已暴露 `dialog.openFiles`。
- `lib/` 为 CommonJS：`store`/`study`/`mindmap`/`graph`/`syllabus` 均可 `require` 离线调用（server.js 行 7-18 实测 require 链）。
- gh-project-optimizer 同项目理解：读 `GH_OPTIMIZER_STATE.json` + `OPTIMIZER_LOG.md` + `references/governance.md`，§4 "每轮 1-3 点随即自检"。
- Expert 元数据字段：`name/profession/defaultInitPrompt/pluginName/industryId/source`（本机 `expert.json` 实测）。
