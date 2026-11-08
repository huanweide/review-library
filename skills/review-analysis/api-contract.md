# review-analysis · API 契约（api-contract）

> 「skills 做成 api 管控」：把 review-library 的能力收敛成统一契约。所有能力经本地引擎（`lib/*`）提供，由 `driver.js` 调度；不联网、不调模型。契约以 OpenAPI 风格的 JSON Schema 描述输入/输出，供任意 agent 按 schema 调用。

## 元信息

| 项 | 值 |
| --- | --- |
| skill | review-analysis |
| 形态 | DSH skill（侧边栏专家 + agent 可调用） |
| 运行时 | Node.js（CommonJS），离线 |
| 依赖 | 仅项目内 `lib/*` |
| 鉴权 | 无（本地文件，零凭据） |
| 计费 | 无（本地运算，无 token 消耗） |
| 数据边界 | 只读 `<project>/library/`，写 `<project>/review-analysis-out/` 与状态文件 |

## 能力清单（统一入口：`driver.js`）

### 1. analyze（一轮轮驱动离线分析）

- 输入（CLI / schema）
  ```json
  {
    "type": "object",
    "properties": {
      "project":  { "type": "string", "description": "review-library 根目录，含 library/" },
      "library":  { "type": "string", "description": "可选，直接指定 library 目录" },
      "book":     { "type": "string", "description": "可选，限定单本书 id 或标题" },
      "rounds":   { "type": "integer", "minimum": 1, "default": 3, "description": "本轮回转窗口：处理几本书" },
      "out":      { "type": "string", "description": "输出目录，默认 <project>/review-analysis-out" }
    },
    "required": ["project"]
  }
  ```
- 输出
  - `report.md`（Markdown 报告）
  - `mindmap.full.json`（全展开图：`nodes` / `edges` / `fullExpanded:true`）
- 副作用：写 `REVIEW_ANALYSIS_STATE.json`（轮转进度）

### 2. materials.add（资料入库，书内拖入/打开文件走这条）

- 路径：`POST /api/books/:id/materials`（server.js）或 `store.addMaterials(bookId, layer, items, meta)`（lib）
- 输入
  ```json
  {
    "layer": { "type": "integer", "minimum": 1, "description": "层号，1=核心提纲层" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "data": { "type": "string", "description": "base64 文件内容" },
          "extractedText": { "type": "string", "description": "PDF 抽出的文字（可选）" },
          "assets": { "type": "array", "description": "PDF 逐页图（可选）" }
        },
        "required": ["name", "data"]
      }
    },
    "prompt": { "type": "string" },
    "tags":   { "type": "array", "items": { "type": "string" } }
  }
  ```
- 输出：`{ ok: true, count: N }`

### 3. study.analyze（分析一本书，出题前一步）

- 路径：`POST /api/study/analyze`
- 输入：`{ bookId, opts:{selectedIds,pointCount,...}, cfg:{engine,baseURL,model,apiKey} }`
- 输出：`{ analysis:{ points:[{id,title,summary,layer}], questions:[...], weakPointIds:[...] } }`
- 备注：本地引擎（`engine=local`）完全离线；云端引擎需用户提供 API（凭据不入本契约）。

### 4. exam.generate（从分析/题库出卷）

- 路径：`POST /api/study/exam` 或 `POST /api/study/syllabusExam`
- 输入：`{ bookId, analysis, questionCount }` 或 `{ bookId, opts }`
- 输出：`{ exam:{ id, questions:[{id,stem,options,answer,explanation,pointIds}] } }`

### 5. weak.report（薄弱地图，闭环复习）

- 路径：`GET /api/study/mistakes/:bookId` 与 `GET /api/review/queue`
- 输入：bookId
- 输出：`{ points:[{pointId,title,errorCount,due,leech}] }`（leech=反复错，优先复习）

### 6. mindmap（思维导图，本 skill 的「全展开」产物来源）

- 路径：`mindmap.buildRuleMaps(outline, bankQs)`（lib，离线）
- 输入：`outline`（来自 `syllabus.buildBookOutline`）、`bankQs`（来自 `syllabus.getBankQuestions`）
- 输出：`[{ centerTitle, centerSummary, nodes:[{title,summary,layer,related,children}] }]`
- 本 skill 把多本书的 maps 聚合为 `mindmap.full.json`（全展开）。

## 契约纪律

- **所有能力默认离线**：`engine=local` 走 `lib/*`，不触发任何网络。
- **零凭据外泄**：云端能力所需 API 密钥由用户会话/环境变量提供，绝不写进 skill、日志或报告。
- **结构化输出优先**：能出 JSON（mindmap.full.json）就出 JSON，人读部分用 Markdown（report.md）；两者同源派生，不重复造数据。
- **可复现**：同样的 library/ 跑两次，产物结构一致（规则版确定性）。
