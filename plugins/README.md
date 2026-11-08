# 插件与版本索引（review-analysis 系列）

本目录下的所有东西，**共用同一套离线分析引擎**，只是打包成不同的宿主形态。
本文是「版本与索引」的唯一权威说明，避免再出现多份各漂各的实现。

---

## 一句话结论

> **引擎只有一份**：`dsh-review-analysis/engine/`（6 个零依赖核心模块 + `analyze.js` 编排器）。
> 其余形态（WorkBuddy 专家、CLI 驱动）的引擎代码，一律由 `scripts/sync-engine.mjs`
> 从这份真源同步，**禁止手工改被同步的文件**。

---

## 形态地图

| 形态 | 目录 | 宿主引擎 | 安装位置 | 入口 |
| --- | --- | --- | --- | --- |
| **DeepSeek Harness 插件** | `dsh-review-analysis/` | 真 DeepSeek Harness（Cordis，`~/.dsh`） | `~/.dsh/local-plugins/dsh-review-analysis/` | 工具 `review_analysis` |
| **WorkBuddy / CodeBuddy 专家** | `review-analysis/` | WorkBuddy/CodeBuddy（`~/.workbuddy`） | `~/.workbuddy/plugins/marketplaces/my-experts/plugins/review-analysis/` | agent `review-analysis` + `bin/driver.js` |

> ⚠️ 命名澄清：早期把 WorkBuddy 专家 README 里的宿主写成「DSH 侧边栏专家」，
> 那是指 WorkBuddy 的「专家」槽位，**不是**真 DeepSeek Harness。真 DeepSeek Harness
> 读 `~/.dsh`；WorkBuddy/CodeBuddy 读 `~/.workbuddy`，两者是不同引擎。
> 本仓库里**唯一**面向真 DeepSeek Harness 的形态是 `dsh-review-analysis/`。

两者产出完全一致：同一份资料库 → 同样 418 节点 / 941 边（示例库实测）、
同样的 `report.md` / `mindmap.full.json` / `book-reports.json`。

---

## 引擎单一真源规则

- **真源目录**：`dsh-review-analysis/engine/`
  - `lib/`：`store` / `srs` / `insight` / `syllabus` / `mindmap` / `llm`（零依赖，仅 Node 内置）
  - `analyze.js`：权威编排器 + 报告渲染（DSH 与专家版共用，**同一份**）
- **被同步的文件**（改了真源后跑 `node scripts/sync-engine.mjs` 即全量同步）：
  - `lib/` 6 个核心模块
  - `analyze.js` 编排器
  - `review-analysis/bin/driver.js`（薄 CLI 壳，只解析参数后调 `analyze.js`）
- **不被同步**（各自维护，仍随插件分发）：
  - DSH 专属 `dsh-review-analysis/index.js`（工具注册壳）—— 其它形态不需要
  - 9 个辅助模块 `analytics` / `backup` / `cloze` / `env-config` / `graph` / `media` / `review` / `search` / `study`
    —— 它们**不参与**离线分析（其中 `env-config` / `study` 含联网路径），只服务于 review-library 桌面主程序的其它功能

### 为什么能「放一起」而不用把 DSH 拆成独立仓库

DSH 插件是**自带 `package.json`（`dsh.bundle`）的自包含子目录**，安装时只认这个子目录，
与仓库根是不是 Electron 应用（根 `package.json` 含 `main: app/main.js`）无关。
所以全部形态放在同一个 `review-library` 仓库里，**DSH 仍能独立安装**——无需单独拆仓。

---

## 安装方式

### A. 真 DeepSeek Harness 插件（`dsh-review-analysis/`）

```bash
# 方式 1：本地路径（桌面应用自动扫描 local-plugins，推荐）
cp -r dsh-review-analysis ~/.dsh/local-plugins/dsh-review-analysis
# 方式 2：dsh CLI 子目录安装（非 desktop profile 可用）
dsh plugin add ./dsh-review-analysis
```

装好后重启 DeepSeek Harness 桌面应用，工具列表出现 `review_analysis`。

### B. WorkBuddy / CodeBuddy 专家（`review-analysis/`）

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

1. 只改真源：`dsh-review-analysis/engine/lib/*.js` 或 `dsh-review-analysis/engine/analyze.js`。
2. 跑 `node scripts/sync-engine.mjs`，把改动同步到专家版源码、本机专家实例、本机 DSH 实例。
3. 若动了 DSH 专属的 `index.js`（工具注册/参数），手动把 `dsh-review-analysis/` 重新拷到
   `~/.dsh/local-plugins/dsh-review-analysis/`。
4. 提交时，真源 + 被同步副本一起提交（保证仓库内版本一致）。

---

## 版本索引

- 引擎版本 = git 提交哈希 / tag。所有形态在**同一提交**内必然一致（因为同步脚本在同一仓库内复制）。
- 想确认本机各形态是否落后：比对各自 `lib/` 与 `dsh-review-analysis/engine/lib/` 的文件内容即可。
- 发布：统一推到 `huanweide/review-library`（`ghssh`）。DSH 不支持 `dsh plugin add github:` 直装，
  因其 bundle 在子目录而非仓库根；走「克隆 + 本地路径」或「拷到 local-plugins」。

## 许可证

MIT
