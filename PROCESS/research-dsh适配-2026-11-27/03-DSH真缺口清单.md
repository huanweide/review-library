# DSH 插件 · 本地真缺口清单（Chair 亲验）

> 亲验日期：2026-11-27/28 ｜ 方法：逐行读 `plugins/dsh-review-analysis/index.js` + `tools/check-dsh-adapt.mjs` + `core/capabilities.js`，
> 与 `workbench/src/` 实际目录比对。每条带文件:行号，不写「大概」「可能」。

## 一、缺口总表（7 条，全过 R/C/N）

| # | 缺口 | 锚点 | 类型 | 优先级 |
|---|---|---|---|---|
| G1 | tool 分派漏 cards / structure / snapshot 三个 action | `index.js:298` enum 15 个 vs `:326-432` 分派 12 个 + `:432` throw | 假能力（声明有、调用无） | P0 |
| G2 | APP_FILES 漏 5 个前端模块 | `index.js:76-83` 16 项 vs `workbench/src/` 实际 17 源 | 404 白屏 | P0 |
| G3 | 判别只测集合相等/老模块，不测逐 action 可分派与清单覆盖 | `tools/check-dsh-adapt.mjs:54` B4 只测 2 个老模块；`:117` 23/0 全绿 | 假绿 | P0 |
| G4 | APP_SHARED_MINDMAP 分支无 `startsWith` 路径校验 | `index.js:523` vs `:500-514` APP 资源分支有校验 | 安全洞 | P1 |
| G5 | resolveProjectRoot 失败诊断笼统 | `index.js:31-54` 四级静默跳过 + 一句笼统 throw | 可诊断性差 | P1 |
| G6 | kind / rating 参数无 enum | `index.js:305,307` 裸 string/integer 描述 | 模型猜值 | P1 |
| G7 | tool 描述无读写/破坏性提示 | `index.js:286-293` | 模型误判副作用 | P0（零成本） |

## 二、G1 逐字符证据（最关键）

**声明端**（`index.js:298`）：
```
action: { type: 'string', enum: ACTIONS, description: '要执行的动作（与统一核心能力清单同源）' },
```
`ACTIONS` 来自 `core/capabilities.js:61` `ACTIONS.splice(0, ACTIONS.length, ...CAPABILITIES.map(c => c.action))`，
共 15 个：`list/create/add/analyze/get/mark/compose/cards/structure/snapshot/practice/quiz/due/attempt/rate`。

**分派端**（`index.js:326-432`），`if (action === ...)` 出现的只有：
```
list / create / add / analyze / get / (practice|quiz|due|attempt|else→rate) / mark / compose
```
`cards`、`structure`、`snapshot` 三个**没有任何分支**，落到 `:432`：
```
throw new Error('不支持的 action：' + action + '（可用 ' + ACTIONS.join('/') + '）');
```

**结论**：模型看到 enum 里的 `cards`，调用后收到「不支持的 action：cards（可用 ...cards...）」——
错误信息自己打自己脸。这不是「功能没做」，是「声明与行为分叉」，比没做更坏。

**修复对照**：`core/app-host.js:267` 已有 `cards`（`data = core.listCards(id)`）、
`:274` 有 `structure`（`p.layer ? core.saveStructure(id, p.layer) : core.getStructure(id)`）、
`:282` 有 `snapshot`（`p.label || p.create ? core.saveSnapshot(id, p.label)`）。
DSH tool 只需照 app-host 的协议转换补三段，**不复制任何业务逻辑**——这正是插件文件头写的设计契约。

## 三、G2 逐字符证据

`index.js:76-83`：
```
const APP_FILES = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'icons/icon.svg',
  'src/main.js', 'src/host.js', 'src/state.js', 'src/router.js',
  'src/ui.js', 'src/views.js', 'src/shell.js', 'src/style.css',
  'src/bookspace.js', 'src/mindmap.js',
  // 2026-11-21 新增：少列一个模块，DSH 侧栏里的应用就是 404 白屏（不是降级，是缺文件）。
  'src/llm-config.js', 'src/overview.mjs',
];
```
`workbench/src/` 实际文件（17 个）：
```
bookspace.js exam-pack.mjs host.js llm-config.js main.js map-viewport.mjs
mindmap.js overview.mjs reader.mjs router.js shell.js state.js
structure-layer.mjs study-hint.mjs style.css ui.js views.js
```
漏的 5 个（v1.7.0–v1.8.0 陆续加的）：
`exam-pack.mjs`（考点包）、`map-viewport.mjs`（导图缩放）、`reader.mjs`（就地阅读器）、
`structure-layer.mjs`（用户结构层）、`study-hint.mjs`（做题思路）。

**影响**：HTTP 形态（5178）这些功能全在，`serveStatic` 从磁盘读真实文件；
DSH 形态因为 `kind:'exact'` 只注册清单里的路径，这 5 个文件请求全部 404 →
对应按钮点了没反应或白屏。v1.8.0 真机 14/14 是在 HTTP 跑的，没覆盖 DSH。

## 四、G3 逐字符证据

`tools/check-dsh-adapt.mjs` 当前 23 项：
- `[A]` baseline 旧版夹具（A0-A4）
- `[B]` 当前插件：B4 是 `'面板静态资源补上两个新模块'`，断言 `/src\/llm-config\.js/.test(SRC) && /src\/overview\.mjs/.test(SRC)`——只测 2026-11-21 那两个老模块
- `[C]` 可移植化四级解析
- `[D]` 环境变量别名
- `[E]` 真跑 Host 半边端点（settings/models）

**没有一条**测：15 个 action 是否每个都能在 DSH tool 里分派成功；APP_FILES 是否覆盖 `workbench/src/` 全部源文件。
所以 G1/G2 存在时 23/0 全绿——典型假绿。

## 五、修复顺序与依赖

1. 先补 G1（tool 分派）+ G2（APP_FILES）——真故障。
2. 再写 G3 判别（baseline 红、candidate 绿）——锁住不再漏。
3. 然后 G7（描述读写提示，零成本）。
4. 最后 P1：G4 路径校验、G5 诊断、G6 enum。
5. SW 版本随前端资源改动升（v37→v38）。
6. 三端一致性判别 `core-capability-sync` 不应因 DSH 改动变红——跑全门禁确认。
