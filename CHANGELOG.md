# 更新日志

版本号遵循 MAJOR.MINOR.PATCH。唯一真源是根 `package.json` 的 `version`，由
`scripts/sync-versions.mjs` 机械同步到 `VERSION`、`core/index.js#CORE_VERSION`、
DSH 插件与 WorkBuddy 专家的 manifest，以及 README 顶部定位行；`scripts/check-versions.mjs`
挂在 `pretest` 上做漂移检测。发版 tag 必须与 `package.json` 严格一致（`v1.3.0`）。

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
