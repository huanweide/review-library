# 天道书院

**书馆分析能力 + 罗盘呈现格式 —— app 级备考应用**

不是静态网页。`npm start` 起自己的服务进程，监听固定端口，服务端持有数据真源并提供 API；浏览器只是 UI。

## 一句话说清它是什么

- **考点罗盘**给了格式基底：设计系统、零反馈状态机、统计可视化。
- **天道书阁**（复习资料图书馆 v1.6.1）给了**全部能力内核**：`core/extract.js`（PDF/PPT/Word/图片抽取）、`core/analyze.js`（官方提示词 + 一次分析出思维导图与题型）、`core/documents.js`（考点大全/考纲/幻灯片的官方提示词）、`core/practice.js`（从题索引出题 + SRS）、`core/capabilities.js`（12 action 单一真源）。
- **天道书院**不再自己造轮子：`lib/engine.js` 端到端复用书馆这 5 个模块，用 `adapter.js` 统一格式、`server.js` 提供端口。两个项目是"能力源 vs 呈现与编排"，不是两份代码。

## 收敛后的两个核心产物（不是一堆重复页签）

早先 11 个页签里，`考纲 / 考点大全 / 速通向 / 导图` 是同一棵分析树的四份投影、且考纲是空壳降级——这正是要消除的重复。现在收敛为：

| 产物 | 数据来自 | 说明 |
|---|---|---|
| **知识点大全**（知识点 + 题型整理） | 书馆 `analyze()` 的 tree + questionIndex | 大纲 / 树形双视图（树形是它的视图，不是独立产物）；出题从这里的题选题 |
| **考纲考点**（重点至上 + 解释 + 重点记忆） | 书馆 `documents.KINDS.syllabus.system` 官方提示词 + LLM 真生成 | 每点给重要性、必背解释、公式、自编例题（分步做法）、逐字原文核验 |

练习 / 模拟考 / 错题本 / 统计是这两个产物的**下游消费**，不再冒充第三、第四个"分析产物"。

**复用边界（诚实说明）**：书馆 `documents.compose()` 有个真 bug——`composeCorpus()` 返回对象却被当字符串拼进提示词，导致模型看不到正文。本引擎不改书馆文件（那边有门禁），而是直接用它的官方提示词正本 + 正确的 `.corpus` 字符串，校验仍走官方 `verifyQuotes`。这叫复用能力、修正接线，不是复制一份改坏。

## 启动

```bash
cd "C:/Users/Administrator/Desktop/agent program/天道书院"

npm start                       # 默认 127.0.0.1:4090
node server.js                  # 等价
node cli.js serve --port 8400   # 换端口
```

浏览器打开 `http://127.0.0.1:4090/`。

需要 Node >= 18。**零第三方依赖**——不用 `npm install`，没有 node_modules。

## 三条 app 级硬性区别

| | 静态网页 | 天道书院 |
|---|---|---|
| 服务进程 | 借 python 的 | 自己的 Node 进程 + 固定端口 |
| 数据真源 | 浏览器 localStorage | `books/<id>/data.json`（服务端落盘） |
| 程序入口 | 浏览器地址栏 | `server.js` / `cli.js` / `npm start` |

前端是"API 优先、静态回退"：通过端口访问走服务端真数据；直接双击 `index.html`（file://）自动回退到 `window.BOOKS`，仍能看——但进度只存本地浏览器。

## 让 LLM 分析资料（增量）

这才是主流程。app 内完成，不用跑脚本：

1. **设置页**填 OpenAI 兼容的 API 地址、模型名、API Key，点「测试连接」。密钥只存你本机浏览器，从不写进书文件、不落盘。
2. **资料页**拖入或点选新资料，可标 ★重点并写一句"为什么重要"，点「上传」。
3. 点「**开始分析（只分析新增）**」。

后台做的四件事（全部经 `lib/engine.js` 复用书馆）：

- **全格式抽取**：PDF/PPT/Word/TXT/MD/CSV 走书馆 `extract.js`（PDF 逐页打 `【P.N】` 锚点，PPTX/DOCX 走 unzip+XML）；图片标记为"需视觉模型"，不假装抽出了文本。
- **只分析新增**：`analyzed.json` 台账记已分析文件，只有新文件的语料进本轮。旧资料不重复送模型、不重复付费。
- **官方提示词正本**：知识点大全走书馆 `analyze.SYSTEM_PROMPT`，考纲走书馆 `documents.KINDS.syllabus.system`——逐字复用，不复制、不另造一套（有测试逐字断言）。
- **合并进各位置**：不是覆盖重建。旧题 id（Q-1..Q-N）与旧知识点编号保序（你的练习进度按 id 存，不丢），新题/新点续接；两个核心产物与练习自动同步新内容。

验证过：本轮演示里上传一份「树与二叉树」讲义，知识点 3→5、题 3→4（旧 Q1/Q2/Q3 全在）、新题 kp 指向新章、引文 1/1 命中、零 console 错误。

`tools/mock-llm.js` 是本地 mock 服务，只用于自测，不参与生产。

## 数据从哪来：命令行导入一本新书（无界面时的备用路径）

书馆的 `analysis.json` 是输入，适配器负责统一格式：

```bash
node cli.js import \
  "../复习资料图书馆/library/books/<书id>/analysis.json" \
  <新书id> "书名" "期末考试" \
  "books/<新书id>/files.json"
```

`files.json` 可选，格式：

```json
{
  "files": [
    { "name": "讲义.txt", "file": "refs/讲义.txt", "type": "txt", "focus": true, "note": "为什么重要" }
  ]
}
```

`focus: true` 的资料，其下题目关联的知识点会被标成重点★。`note` 会显示在资料页。

也可以走 HTTP：`POST /api/books/import`，body 为 `{ analysis, meta, files, documents }`。

## API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/health` | 健康检查（app / version / uptime / port） |
| GET | `/api/books` | 书目，从 `data.json` 扫描派生（书单与数据不会漂移） |
| GET | `/api/books/:id` | 完整统一格式书数据 |
| POST | `/api/books/import` | 调适配器转换并落盘，返回统计 |

其他路径走静态托管，但有**白名单**：只放 `index.html`、`books/index.js`、`assets/**`、`books/<合法id>/book-data.js`、`books/<合法id>/refs/**`。`package.json` / `server.js` / `lib/` / `data.json` 一律 404——挡住 `../` 穿越与源码泄漏。

## 统一格式（适配器输出契约）

```js
{
  meta,                  // id/title/subject/source:'天道书阁'/focusNotes
  kaogang: [{ id:'1.1.1', text, sec, chKey, chLabel, hot, hasQuiz }],
  tiku:    [{ id:'Q-1', kp:'1.1', type, stem, options? }],        // 无答案，零反馈地基
  tikuAns: { 'Q-1': { ans, why, src, solution, rationale, pitfalls } },
  refs, digest, syllabus, mindmap,
  _trace:  { quoteAudit, byQuestion, byCode, quoteGranularity }   // 引用锚定不降级
}
```

诚实边界三条：
1. 题的 `pointId` 真实指向 section（不是 point），`kp` 就填 section 级编号，不编造精确到点。
2. 书馆答案是"答案+理由"长文本，不硬抽字母当 `correct`，全部走自评——宁可少判，不伪造判分信号。
3. 引文核验状态如实：命中标"✓原文已核"，未命中标"△未核"，不冒充。

## 测试

```bash
npm test
```

98 条，六套全绿：

- `test/adapter.test.js`（28）：真实 `analysis.json` 驱动，点数守恒 / 题答分离 / kp 层级 / 溯源不丢 / 幂等 / 细分子类与全题型不丢。
- `test/server.test.js`（14）：真服务进程 + API 落盘回读 + 路径穿越与源码泄漏拦截 + 测试后不留残书。
- `test/incremental.test.js`（21）：旧题 id 与旧编号保序 / 新内容进各视图 / 旧数据兼容 / 密钥脱敏。
- `test/e2e-llm.test.js`（10）：本地 mock LLM 走真 HTTP，上传→只分析新增→两产物生成→合并→引文核验→二次跳过→key 不落盘。
- `test/engine.test.js`（16）：书馆能力单一真源 / 目标选择白名单 / 全格式抽取 / PDF 页锚点 / 出题复用 practice / 绕过 documents bug / llm.chat 两处取 .text。
- `test/ui-contract.test.js`（9）：**提示词要求 ≠ 界面显示就是静默失效**——锁住 solution/pitfalls/difficulty 有渲染点、四处答案区统一收口、出题阶段绝不引用答案渲染。

## 提示词要什么，界面就必须显示什么

这是本项目最容易出问题的一环：模型按官方提示词给了细节，但界面只渲染其中两三个字段，用户看到的就是“解析很抽象”——数据在、界面无。

字段契约（左＝提示词强制要求，右＝消费位置）：

| 提示词字段 | 界面落点 |
|---|---|
| `answer` / `solution`（2-4 步） / `rationale`（≥2 句） / `pitfalls` / `difficulty` | 答案区：难度标签 → 参考答案 → **分步解法（有序列表）** → 解析 → **易错点** → 逐字原文 → 依据 |
| point 的 `title` / `desc` / `questionTypes` / `children`（细分子类） | 知识点大全：名称 + 说明分两行、全题型标签、细分子类列表 |
| `source.quote` + 程序核验结果 | 「✓ 原文已核」/「△ 原文未核」徽章（未命中如实标注，不冒充） |
| syllabus 的 `rank` / `why` / `must` / `formulas` / `importance` / `question.steps` | 考纲考点：排名 → 为什么重要 → 必背解释 → 公式 → 重点等级 → 自编例题 + 分步做法 |

四个答案区（练习结果 / 模拟考逐题解析 / 错题本展开 / 历史复盘）共用同一个 `answerDetailHTML()`，改一处不会漏三处。

## 目录

```
server.js           服务入口（原生 http）
cli.js              CLI：serve / list / import / build
lib/store.js        数据层：唯一真源读写 + 白名单 safepath
assets/js/adapter.js 统一格式适配器（浏览器/Node 双导出）
assets/js/api-client.js 前端数据入口（API 优先，静态回退）
assets/js/{core,ui,bookshelf}.js  罗盘格式基底
books/<id>/data.json        服务端真源
books/<id>/book-data.js     静态回退（由 data.json 生成，勿手改）
books/<id>/refs/            资料原文
```

## 与父项目的边界

不修改考点罗盘，不修改复习资料图书馆。本轮不物理合并两套代码（书馆有六入口与 24/24 门禁，罗盘是零依赖静态站），只在中间加适配层和服务层。详见 `00-融合决策表.md`。
