---
title: v1.3.0 / v1.3.1 融合与发版验收台账
date: 2026-11-09
tags: [maxloop, release, fusion, oracle-gate, evidence]
source: 本轮真实命令输出；GitHub Actions REST API 与 Release 公开资产核验
---

# 融合 + 测试 + 发版 验收台账（2026-11-09）

## 一、融合决策与实际落地

方向：B=`C:\Users\Administrator\Desktop\rlbuild` 为发布正本与唯一真源（`Core` 类 +
`BookStore` + `core/request.js`），A=`agent program\复习资料图书馆` 只作能力资料来源。
**不复制 A 的 core、不覆盖 B 的题型分类、不删除 A**（外查基准② Strangler/ACL）。

| 项 | 能力 | 落点 | 证据 |
|---|---|---|---|
| F1 | 确定性节点 id + 按 path 精确反查 pointId（重名消歧） | `core/analyze.js` `assignIds/buildNodeIndex/resolvePointId` | 判别测试 10/10；两同名「顺序表」落到不同 id |
| F2 | 题型卡片点击 → 切回导图 + 高亮 + 展开祖先 | `core-ui.js` `locateNode`、CSS `.node.highlight` | e2e 实际点击：恰好 1 个节点高亮，id `n3_3` |
| F3 | 缩放 30–250% / 拖拽平移 / 复位 | `core.html` 工具栏与视口、`core.css` transform | e2e 实际点击 100%→115%，transform `scale(1.15)` |
| F4 | 导出分析 JSON / 矢量 SVG | `core-ui.js` `exportJson/exportSvg/buildTreeSvg` | e2e 捕获 blob：SVG 1821 字符含真实节点文字、JSON 可解析 |
| F5 | 纯图片 / 少文本带 `userCode` 明确报错 | `core/analyze.js` `MIN_TEXT`、`core/index.js` 传统计 | 判别：18 字 + 2 图 → `NEEDS_VISION`；正常文本不误杀 |
| F6 | 语料 50000 字上限 + truncated/sourceLen | `buildMessages` 与 `analyze` 返回值、概览警告 | 判别：240000 字 → 实送 50034，truncated=true |
| F7 | 导入失败逐文件持久上屏 | `core-ui.js` `addFiles` + `#importStatus` | e2e：`已导入 1/1 份资料` |
| F8 | 概览分题型统计与来源信息 | `validate` 的 `questionTypeCounts`、`renderSummary` | e2e：2 张 typecount 卡 + 全书字数 |

**明确不合 6 项**（见 `fusion-decisions.md` 第二节）：A 的 core 整体、A 的题型分类、
A 的前端抽取替换 B 的 Node 抽取、删除 A、本地 `--publish always`、A 的 e2e 整套搬运。

## 二、判别测试与 Oracle Gate

```
BASELINE（融合前）  : 通过 8 / 失败 23 / exit 1
CANDIDATE（融合后） : 通过 41 / 失败 0 / exit 0
```

- (a) 真跑：`npm test` **17/17**；连跑 2 次均 17/17、零残留测试端口；双形态 e2e **53/0**。
- (b) lint：`node --check` **19/19** 文件通过。
- (c) 真实入口可达：真 Chromium **HTTP 与 `file://` 双形态**，起本地 OpenAI 兼容 mock LLM，
  真发 HTTP → 真解析 → 真渲染，再**实际点击**放大/复位/导出 SVG/导出 JSON/题型卡片，
  断言 DOM 与 blob 内容；两张真截图人工验明非白屏；零控制台错误。
- (d) 修复前失败：baseline 输出已贴（23 项失败锁住 8 项能力缺失）。
- (e) 证据锚点：每条结论带文件:行号与真实命令输出。

**真浏览器抓到的 2 个真缺陷（已修并有断言锁定）**：
1. `FileList` 是活引用，调用方 `e.target.value=''` 会清空 → 状态显示「已导入 1/0」。修：进函数先 `Array.from` 快照并缓存 total。
2. 分析成功分支只弹 toast，状态条永久停在「正在把整本书交给大模型整体分析，请稍候…」，与「分析完成」自相矛盾。修：成功时更新为「分析完成：X 章 / Y 知识点 / Z 类题型」。

**融合引入的 2 个回归（已修）**：
1. F5 业务错误误用 `e.code`，与 `core/request.js` 的 `isInternal()` 冲突导致 500。修：改用 `userCode`，判别测试加防线断言。
2. `MIN_TEXT=80` 拦住了 41 字 / 17 字的测试夹具。修：夹具补到真实长度，**不降低阈值**。

## 三、发版过程（含一次失败与修复）

### v1.3.0（失败，已保留 tag，不删不改）
- commit `26d3d2b` → push `ghssh/main` → tag `v1.3.0`。
- 云端 `Build and Release` 在**第 5 步 `Install dependencies`** 失败，后续打包/上传全 skipped，无 Release。
- 根因：`package-lock.json` 从未更新，缺 `pdf-parse@1.1.1`（及 debug / node-ensure），
  `npm ci` 报 `EUSAGE ... Missing: pdf-parse@1.1.1 from lock file`。
  本地一直复用已装好的 `node_modules`，故 `npm test` 全绿也发现不了。
  匿名拉日志 403（`Must have admin rights`），按本机经验卡改用**本地复现**定位。
- 修：`npm install --package-lock-only --ignore-scripts` 重建 lock；
  `npm ci --dry-run` 由 `exit 1` → `exit 0`。

### v1.3.1（成功发布）
- 版本五件套升 1.3.1（package.json / VERSION / CORE_VERSION / README / CHANGELOG），
  package-lock 根版本同步；CHANGELOG 新增条目说明修复。
- 判别测试 `baseline` 锚定固定提交 `9fb96f1`，不再依赖会前移的 `git HEAD`
  （否则一 commit 就假失败，发版时实测踩到）。
- commit `edb8de4` → push main → tag `v1.3.1`（peeled 指向 `edb8de4`，与本地 HEAD 一致）。
- 云端 run `42577492011`：**9 个步骤全 success**（Install deps / Build publish never /
  Package plugin zip / Publish plugin / Publish desktop）。
- Release `v1.3.1`：`draft:false`、`prerelease:false`、`published 2026-11-09T07:10:51Z`。
  资产 5 件：`ReviewLibrary-Setup-1.3.1.exe` 80.7 MB、
  `ReviewLibrary-1.3.1-portable.exe` 80.5 MB、
  `ReviewLibrary-Setup-1.3.1.exe.blockmap` 0.1 MB、
  `latest.yml`、`review-analysis-dsh-plugin-v1.3.1.zip` 0.5 MB。
- `latest.yml` 实测内容：`version: 1.3.1`（与 tag 一致）、`url: ReviewLibrary-Setup-1.3.1.exe`、
  `sha512` 88 字符、`size: 84616836`（80.7 MB，与资产一致）、`releaseDate` 齐全。
  **自动更新链路可用**。

## 四、KNOWN-LIMITATION（不藏）

1. **tag 内版本常量漂移**：`v1.3.1` 指向的 commit `edb8de4` 里，
   `core/index.js#CORE_VERSION`、DSH `package.json`、专家 `plugin.json` 仍是 `1.3.0`
   （`sync-versions` 在工作区补写到 1.3.1，但 add 时漏了这 3 个文件）。
   这 3 个常量只影响运行时显示，不参与 `npm ci` / `electron-builder`；云端构建已成功、Release 已发布。
   **按斯瑞决定**：本轮不改写已推 tag、不中断 CI；工作区保留 1.3.1 版本不提交，
   下次发版随版本升级一并修正。本地 `check-versions` 当前为绿（读工作区），
   但 git 树内不一致，属已知残留。
2. **CI 打包路径名实不符**：`.github/workflows/release.yml:58` 把 `plugins/review-analysis`
   （专家形态）压缩成名为 `review-analysis-dsh-plugin-*.zip` 的附件，
   而本轮重做的是 `plugins/dsh-review-analysis`（DSH 插件）。按斯瑞决定本轮不改 CI，
   建议下次发版把 Compress-Archive 路径改为 `plugins/dsh-review-analysis` 或两者各打一个 zip。
3. **Deploy Pages 预览站** 的 Actions 历次均为 failure（既有问题，非本轮引入），未处理。
4. **真 Electron GUI 未跑**：本机 `electron.exe` 缺失，用 `file://` + 注入等价 `window.api` 的
   Chromium 替身验证，不冒充真机；窗口实显与菜单实点需本机 `npm start` 亲验。
5. **PDF 在 `file://` 下抽不了**：`type="module"` 的 pdf-extract 被 CORS 拦（上一轮实测），
   沿用"失败可见"处理，本轮未改。
6. **A 副本保留**：两套实现并存，A 原地不动留作回退与对照；后续若要彻底收敛须单独决策。
7. 沿用上一轮：真 LLM 联调需填 key；localStorage 跨形态不互通；大 catch 的 scrub 拿不到 cfg。

## 五、纪律

- 发布前扫暂存区：48 个文件，无 `init.yaml` / `_backup/` / `dist/` / `library/`，无真实凭据。
- `.gitignore` 新增忽略 `init.yaml`、`_backup/`；commit 消息走临时文件 `-F`（避免 PowerShell BOM）。
- commit / push 由斯瑞在两次 AskUserQuestion 中明确点头；SSH 别名 `ghssh`，未用其它远端。
- 本地不 `--publish always`、不覆盖 `dist/` 旧产物、不删已推 tag。
