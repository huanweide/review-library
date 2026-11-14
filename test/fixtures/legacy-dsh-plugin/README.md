# dsh-review-analysis

**DeepSeek Harness（Cordis 引擎）插件**：离线复习资料分析引擎。

读取一个「复习资料库」目录，为其中的每一本书生成：

- **考纲大纲**（章节 → 节 → 知识点 的树状结构）
- **规则版思维导图**（全展开：中心节点 + 知识点节点 + 关联节点，以及它们之间的 `contains` / `related` 边）
- **Markdown 总报告**（`report.md`）

全程 **纯本地运行、零外部依赖、不联网、不调用模型**。引擎本体随插件一起打包（`engine/`，CommonJS，仅依赖 Node 内置模块 `fs/path/crypto/zlib/http/https/url`），安装即用。

---

## 安装（DeepSeek Harness 桌面版 / CLI）

本插件遵循 DeepSeek Harness 官方插件规范：插件 = Cordis 插件打包成 npm bundle，
通过 `dsh.bundle.patch`（`cordis.patch.yml`）插进 Loader entries。

### 方式一：本地路径安装（推荐，无需发版）

```bash
# 桌面版 profile（DeepSeek Harness 桌面应用使用的 profile）
dsh plugin --profile desktop add /绝对路径/rlbuild/plugins/dsh-review-analysis

# 通用默认 profile
dsh plugin add /绝对路径/rlbuild/plugins/dsh-review-analysis
```

安装后重启（或重载）DeepSeek Harness，即可在工具列表看到 `review_analysis`。

### 方式二：从 GitHub 仓库安装

```bash
# 克隆到本地后走方式一（本仓库根目录是 Electron 桌面应用，不能在其中加 dsh 字段，
# 因此插件放在子目录 plugins/dsh-review-analysis）
git clone https://github.com/<你的用户名>/review-library.git
dsh plugin --profile desktop add ./review-library/plugins/dsh-review-analysis
```

> 若希望支持 `dsh plugin add github:owner/repo` 直装，需在 GitHub 仓库根 `package.json`
> 声明有效的 dsh bundle 并为仓库打上 `dsh-plugin` topic。本仓库根是 Electron 应用，
> 不适合直接加 dsh 字段，故默认走「子目录 + 本地路径」安装。

### 卸载

```bash
dsh plugin --profile desktop remove dsh-review-analysis
```

---

## 工具用法（在 DeepSeek Harness 中调用）

工具名：**`review_analysis`**

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `library` | 是 | 复习资料库根目录（绝对路径），含各书子目录，每本含 `book.json` 与 `materials.json` |
| `out` | 否 | 输出目录；缺省为 `<library>/../review-analysis-out` |
| `book` | 否 | 只分析指定书名或 book id；缺省分析全部 |

产出文件（写入 `out` 目录）：

- `report.md` —— 人类可读总报告（书目总览 + 逐书全展开大纲 + 思维导图摘要）
- `mindmap.full.json` —— 全展开思维导图（节点 + 边，按 id 去重，可续做累积）
- `book-reports.json` —— 每书结构化缓存（供续做累积，不推翻重来）

每次调用若 `out` 下已有上述文件，会按节点/边 id 去重合并，适合多轮增量分析。

---

## 目录结构

```
plugins/dsh-review-analysis/
├── package.json          # dsh.bundle.patch + type:module + peerDependencies + keywords: dsh-plugin
├── cordis.patch.yml      # 把插件插进 Cordis Loader entries
├── index.js              # ESM 入口：export const name / inject=['tools'] / apply(ctx)
│                         #   用 ctx.effect(() => ctx.tools.register(defineTool({...})), id)
├── engine/
│   ├── package.json      # {"type":"commonjs"} —— 让引擎以 CommonJS 运行
│   ├── analyze.js        # 编排层：读库→大纲→规则思维导图→聚合去重→落盘→返回摘要
│   └── lib/              # 零依赖离线引擎（仅 Node 内置模块）
│       ├── store.js      # 资料库读写
│       ├── srs.js        # 间隔重复调度（引擎数据基础）
│       ├── insight.js    # 解压/文本抽取（zlib）
│       ├── syllabus.js   # 考纲大纲构建 + 题库抽取
│       ├── mindmap.js    # 规则版思维导图构建（buildRuleMaps）
│       └── llm.js        # OpenAI 兼容转发（内置 http/https；本插件离线流程不触发）
├── LICENSE
└── README.md
```

---

## 校验

```bash
# 引擎单元校验（纯本地，不依赖 DSH 运行时）
node --test engine/test/
```

---

## 许可证

MIT
