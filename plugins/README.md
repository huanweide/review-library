# 插件与版本索引（review-analysis 系列）

本目录下的所有东西，**共用同一套离线分析引擎**，只是打包成不同的宿主形态。
本文是「版本与索引」的唯一权威说明，避免再出现多份各漂各的实现。

---

## 一句话结论

> **引擎唯一真源 = DSH 插件仓库的 `engine/`**（6 个零依赖核心模块 + `analyze.js` 编排器）。
> DSH 插件是**独立仓库** `huanweide/dsh-review-analysis`；本仓库（review-library）只放
> **WorkBuddy / CodeBuddy 专家形态**，并**索引** DSH 仓库。
> 专家形态的引擎，由 `scripts/sync-engine.mjs` 从 DSH 仓库同步，**禁止手工改被同步的文件**。

---

## 形态地图

| 形态 | 仓库 / 目录 | 宿主引擎 | 安装位置 | 入口 |
| --- | --- | --- | --- | --- |
| **DeepSeek Harness 插件（canonical）** | **独立仓库** `huanweide/dsh-review-analysis` | 真 DeepSeek Harness（Cordis，`~/.dsh`） | `~/.dsh/local-plugins/dsh-review-analysis/` | 工具 `review_analysis` |
| **WorkBuddy / CodeBuddy 专家** | 本仓库 `plugins/review-analysis/` | WorkBuddy/CodeBuddy（`~/.workbuddy`） | `~/.workbuddy/plugins/marketplaces/my-experts/plugins/review-analysis/` | agent `review-analysis` + `bin/driver.js` |

> ⚠️ 命名澄清：WorkBuddy 专家 README 里写的「DSH 侧边栏专家」是指 WorkBuddy 的「专家」槽位，
> **不是**真 DeepSeek Harness。真 DeepSeek Harness 读 `~/.dsh`；WorkBuddy/CodeBuddy 读 `~/.workbuddy`，两者不同引擎。

两者产出完全一致：同一份资料库 → 同样 418 节点 / 941 边（示例库实测）、
同样的 `report.md` / `mindmap.full.json` / `book-reports.json`。

---

## 为什么 DSH 单独成仓（不放在 review-library 里）

DSH 的社区插件广场（[dsh-plugin.org](https://dsh-plugin.org) / 内置 `dsh plugin market`）**自动收录**的规则是：

1. 仓库**公开**；
2. 仓库 GitHub Topics 含 **`dsh-plugin`**；
3. **仓库根** `package.json` 声明 `dsh.bundle`（即 bundle 在仓库根，不是子目录）；
4. README 含安装命令（`dsh plugin --profile web add ...`）；
5. 插件导出 `apply(ctx)`。

扫描器只读**仓库根** `package.json`。而 review-library 的根是 **Electron 桌面应用**
（`package.json` 含 `main: app/main.js`），不能把 `dsh.bundle` 加在根上（会被当成插件去安装整个桌面程序）。
所以 **DSH 必须独立成仓**，让 bundle 在仓库根——这也正是本系列能被广场发现、支持
`dsh plugin --profile web add github:huanweide/dsh-review-analysis` 直装的前提。

> `dsh-` 前缀是 DSH 生态的强约定（本机装的 dsh-file-mount / dsh-memory-evolve / dsh-think-zh 都带），
> 本插件名 `dsh-review-analysis` 已符合；但光有前缀 + topic + README **不够**，必须有根 `package.json` 的 `dsh.bundle`。

---

## 引擎单一真源规则

- **真源仓库**：`huanweide/dsh-review-analysis` → 其 `engine/`
  - `lib/`：`store` / `srs` / `insight` / `syllabus` / `mindmap` / `llm`（零依赖，仅 Node 内置）
  - `analyze.js`：权威编排器 + 报告渲染（DSH 与专家版共用，**同一份**）
- **本仓库内的镜像**：`plugins/dsh-review-analysis/engine/`
  - 这是 DSH 仓库引擎的一份**在库镜像**，作为 `sync-engine.mjs` 的默认同步源（离线可用），
    同时是 DSH 仓库上线前的 GitHub 安全备份。**DSH 独立仓库上线后，此镜像会被删除**，
    同步源改为 `DSH_ENGINE_SRC` 指向的独立仓库（见下）。
- **被同步的文件**（改了真源后跑 `node scripts/sync-engine.mjs` 即全量同步）：
  - `lib/` 6 个核心模块
  - `analyze.js` 编排器
  - `review-analysis/bin/driver.js`（薄 CLI 壳，只解析参数后调 `analyze.js`）
- **不被同步**（各自维护，仍随形态分发）：
  - DSH 专属 `index.js`（工具注册壳）—— 其它形态不需要
  - 9 个辅助模块 `analytics` / `backup` / `cloze` / `env-config` / `graph` / `media` / `review` / `search` / `study`
    —— 它们**不参与**离线分析（其中 `env-config` / `study` 含联网路径），只服务于 review-library 桌面主程序的其它功能

### 同步源切换（DSH 独立仓库上线后）

`scripts/sync-engine.mjs` 默认从本仓库镜像 `plugins/dsh-review-analysis/engine/` 取真源；
DSH 独立仓库上线后，设置环境变量指向它即可，无需改代码：

```bash
# 指向已克隆到本地的 DSH 独立仓库
set DSH_ENGINE_SRC=C:/Users/Administrator/Desktop/dsh-review-analysis/engine
# 或在 PowerShell：
$env:DSH_ENGINE_SRC = "C:/Users/Administrator/Desktop/dsh-review-analysis/engine"
node scripts/sync-engine.mjs
```

---

## 安装方式

### A. 真 DeepSeek Harness 插件（`huanweide/dsh-review-analysis`，独立仓库）

```bash
# 方式 1：从 GitHub 直装（广场收录后最方便）
dsh plugin --profile web add github:huanweide/dsh-review-analysis
dsh plugin --profile desktop add github:huanweide/dsh-review-analysis

# 方式 2：本地拷贝到自动扫描目录（离线）
git clone https://github.com/huanweide/dsh-review-analysis.git
cp -r dsh-review-analysis ~/.dsh/local-plugins/dsh-review-analysis
```

装好后**重启** DeepSeek Harness，工具列表出现 `review_analysis`。
（详见该仓库 README；该仓库已满足 dsh-plugin.org 收录要求，加好 `dsh-plugin` topic + 设为公开即可被广场索引。）

### B. WorkBuddy / CodeBuddy 专家（`review-analysis/`，本仓库）

```bash
# 源码拷到本机专家槽位
cp -r review-analysis ~/.workbuddy/plugins/marketplaces/my-experts/plugins/review-analysis
```

重开 WorkBuddy 后，侧边栏「我的专家」出现「复习资料分析专家」。
也可在对话里直接让专家跑；或手动：

```bash
node "<专家目录>/bin/driver.js" --project "<review-library 根>" --library "<library 目录>" --out "<输出>"
```

---

## 改引擎后怎么做（防漂移）

1. 只改真源：DSH 仓库的 `engine/lib/*.js` 或 `engine/analyze.js`（在 `huanweide/dsh-review-analysis`）。
2. 跑 `node scripts/sync-engine.mjs`（或设 `DSH_ENGINE_SRC` 指向独立仓库），把改动同步到专家版源码、本机专家实例、本机 DSH 实例。
3. 若动了 DSH 专属的 `index.js`（工具注册/参数），手动把 DSH 仓库重新拷到 `~/.dsh/local-plugins/dsh-review-analysis/`。
4. 提交时，真源（DSH 仓库）与被同步副本（本仓库专家源码）各自提交，保证版本一致。

---

## 版本索引

- **DSH 插件版本**：以 `huanweide/dsh-review-analysis` 仓库的提交 / tag 为准（独立追踪）。
- **本仓库专家版本**：以 `huanweide/review-library` 的提交为准；其引擎由同步脚本对齐到 DSH 仓库版本。
- 想确认本机各形态是否落后：比对各自 `lib/` 与 DSH 仓库（或本仓库镜像）`engine/lib/` 的文件内容即可。
- 发布：DSH 推 `huanweide/dsh-review-analysis`；专家推 `huanweide/review-library`（`ghssh`）。

## 许可证

MIT
