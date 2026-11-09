---
title: 多形态同步与缺陷收尾 · 判别测试与 Oracle Gate 验收台账
date: 2026-11-09
tags: [maxloop, oracle-gate, discriminative-test, security, evidence]
source: C:\Users\Administrator\Desktop\rlbuild 本轮真实命令输出；两轮独立 reviewer 只读审查报告
---

# 判别测试与验收台账（2026-11-09 缺陷收尾轮）

> 本轮不是新增功能，是「修独立 reviewer 实证的缺陷 + 根治证据链造假」。
> 所有结论只认真实命令输出；未验证的一律进 KNOWN-LIMITATION，不冒充结论。

## 一、为什么会有这一轮

上一轮派出的独立 reviewer 在会话压缩中断前返回，反馈没进上下文。本轮重新取证：
以**全新上下文** reviewer 只读审查「所有版本同步」改动，实证 **8 条真缺陷（2 条 P0/P1）**，
结论「卡住本轮，先修再合」。主代理逐条复验，其中 P0 亲自在隔离临时目录复现：

```
删前 books 目录存在: true | dispatch(/books/.. DELETE) -> {"status":200,"data":{"ok":true}}
删后 books 目录存在: false
>>> P0 复现成立：一次 IPC 调用删穿书库
```

同时核实 reviewer 的「无基准」指控属实：`git show HEAD:server.js` 无 `/api/core`、
`git ls-tree -r HEAD` 无 `core/`，全是未提交新增；`core-http.test.js:2` 原注释
「验证…行为不变」没有对照物，属于结论跑在证据前面，已订正。

## 二、缺陷清单与修复（每条都有 baseline 红 → candidate 绿）

| 编号 | 级别 | 缺陷（逐字符证据） | 修复 |
|---|---|---|---|
| B | **P0** | `core/request.js:19` id 零校验 → `bookStore.js:42` `path.join` → `:182` `fs.rmSync(recursive)`；IPC 无 URL 规范化 | 双层：入口 `assertSafeId` 白名单 `^[A-Za-z0-9_-]{1,64}$` + 存储层 `resolveInside` 的 `path.resolve`/`startsWith` 边界；IPC 校验 method/path/body 形状 |
| D | **P1** | `core.html:7` `href="/css/core.css"`，`file://` 下 `new URL` 解析到 `file:///C:/css/core.css` → 404 → `.hidden` 失效、5 个面板全铺开 | 改相对路径 `css/core.css` |
| C | **P1** | `core-ui.js:266` `testConn` 裸 `fetch('/api/llm/test')`，Electron 无 HTTP server | 补 Electron 分支走 `window.api.llm.test(cfg)`，HTTP 兜底保留；并补 `window.api.llm` 存在性判断 |
| F | **P1** | `check-forms.mjs:12` 未安装时 `continue`，仍打印「✓ 形态一致且均指向唯一核心」且 exit 0 | 统计 skipped、输出「⚠ 未安装（一致性未验证）」、新增 `--require-installed`、挂进 `pretest` |
| G | **P1** | `core-unified-sync.test.js:101` 只查 `src="/js/`，漏 `href="/css/`，导致缺陷 D 假绿 | 断言改为「所有 `src`/`href` 不得为绝对路径」 |
| A | P2 | `core/request.js:44-46` 所有异常压成 400、无日志，`server.js` 的 DEBUG 日志永不触发 | `isInternal()` 区分业务 400 / 内部 500；内部异常 `console.error('[core request] ...')`，错误文本经 `scrub` |
| E | P2 | `server.js:78` 畸形 JSON 的 V8 SyntaxError 回显请求体原文（含 `sk-SECRETK`） | core 块单独 try/catch 回固定文案；大 catch 对 SyntaxError 固定文案、其余经 `llm.scrub` |
| H | P2 | `run-tests.js:16` 只收 `.test.js`，DSH 的 `unified.test.mjs`（21 项）从未进根 `npm test` | dirs 增加插件测试目录、收集 `.test.mjs`；新增 `--list` 供判别测试真跑收集逻辑 |

**第二轮复核再抓 3 条**（同一 reviewer 机制、全新上下文）：

| 编号 | 缺陷 | 修复 |
|---|---|---|
| B2-1 | `bookStore.setFileText/getFileText` 的 `fileId` 未校验，可写/读数据根目录外 `.txt`（主代理亲自复现 `PWNED.txt` 内容 `OWNED-BY-FILEID`）；非 P0 复活，当前入口不可达，但 `Core` 门面公开给 DSH/专家 | 新增 `resolveFileInside(dir, fileId, suffix)`，`addFile`/`setFileText`/`getFileText`/`getFileBuffer`/`removeFile` 全部收口 |
| B2-2 | `_e2e/core-ui-verify.js` 的 `__llmFetchCalls` 只初始化为 0、从不递增 →「未发裸 fetch」是恒真断言，旧版也能过 | 真 hook `window.fetch` 计数；加**反证**：移除 bridge 后必须计到 1 次，并把 `file://` fetch 失败显式断言为「印证旧版必挂」的预期证据，不静默过滤 |
| B2-3 | `core-hardening.test.js` 注释虚称「真跑收集逻辑」实为源码正则，`dirs` 定义未用 | 删无用变量、注释改为「源码声明 + 文件存在检查」，并真跑 `run-tests.js --list` 作为收集逻辑证据 |

## 三、判别测试输出（真实命令）

```
BASELINE v2（改动前）        : 通过 17 / 失败 23 / exit 1
CANDIDATE（第一轮修复后）     : 通过 40 / 失败 0  / exit 0
第二轮缺陷 baseline          : 通过 40 / 失败 3  / exit 1  （setFileText 越界写三条）
CANDIDATE（第二轮修复后）     : 通过 48 / 失败 0  / exit 0
```

`test/core-hardening.test.js` 全部用**运行时证据**，不用纯文本正则充当证据：
真 `Core` 实例 + 每 PoC 独立临时目录（防级联污染）、`new URL` 真解析 file:// 资源、
vm 真执行 `testConn` 抓 fetch、真起 server 发畸形 JSON、真起子进程跑门禁、真跑 `--list` 收集逻辑。

## 四、Oracle Gate 五项

| 项 | 证据 |
|---|---|
| (a) 真跑 | `npm test` **连跑 3 次均 16/16**；`core-hardening` 48/0；`_e2e/core-ui-verify.js` 21/0；DSH `unified.test.mjs` 在主链路真执行（`--list` + npm test 输出双重佐证） |
| (b) lint | `node --check` **24/24 文件**通过 |
| (c) 真实入口可达 | 真 Chromium **HTTP 与 file:// 双形态**：`.hidden` 全部 `display:none`（CSS 真加载）、stylesheet 挂载、设置弹窗由 hidden 变 flex、建书→导入可达、`testConn` Electron 走 ipc 且 0 次裸 fetch、控制台错误 0；两张真截图人工验明非白屏 |
| (d) 修复前失败 | 两轮 baseline 分别 `17/23 exit 1`、`40/3 exit 1`，且 P0 与越界写均由主代理独立复现 |
| (e) 证据锚点 | 每条缺陷带 `文件:行号 + 逐字符证据`；两轮 reviewer 报告均以只读方式实证 |

版本门禁 `✓ 1.2.0（核查 8 处）`；形态门禁 `✓ 18 处`（`--require-installed` 严格模式 exit 0）。
真 `library` 无 `index.json`（未被测试污染）；所有测试用系统临时目录且自清。

## 五、效率指数

外部判据（独立 reviewer）实证的真缺陷共 **11 条**（8 + 3），本轮全部解决并外部判据验证。
但过程返工 2 次：① 判别测试夹具自身吞失败输出、畸形 JSON 载荷不足（baseline 假红）；
② 嵌套调用全套件造成递归与端口抢占；③ `| head -N` 截断输出导致 SIGPIPE 留下 4 个孤儿 server，
使 `npm test` 一度假失败 14/16（已逐个核实 PID 归属后清理，并改 `taskkill /T /F` 根治）。
按「产出级别 ÷ 产出轮数」计，本轮 **11 ÷ 3 ≈ 37**，明显低于上一轮虚高的 100；
不粉饰，相关系数如实记录。

## 六、KNOWN-LIMITATION（不藏）

1. **真 Electron GUI 未跑**：本机 `node_modules/electron/dist/electron.exe` 缺失（包安装损坏）。
   Electron 侧结论来自 ① Chromium `file://` 真浏览器 + 注入等价 `window.api` 的替身
   ② stub electron 真执行 `app/main.js` 的运行时测试（上一轮）。**不冒充真机**；
   窗口实显、菜单实点、`npm start` 需斯瑞本机亲验。
2. **PDF 在 `file://` 下抽不了**：Chromium 实测 `type="module"` 的 `pdf-extract.js` 被 CORS 拦，
   `window.PdfExtract === false`（上一轮已实测）；vendor 只有 `.mjs` 无 UMD。
   本轮未改这一块，沿用上一轮「失败可见」的处理。
3. **大 catch 的 scrub 拿不到 cfg**：`server.js` 大 catch 只能做 `sk-` 正则兜底，
   `scrub(text, cfg)` 的精确替换不生效。当前无可到达的泄漏路径（core 块畸形 JSON 已单独拦截，
   llm/study/mindmap 抛错在上游已 scrub 或本来就是固定中文文案），但属纵深缺口，未在本轮扩张修复面。
4. **既有测试的进程清理**：`maxloop-v06.test.js` / `maxloop-regression.test.js` 等既有 e2e
   仍用 `child.kill('SIGKILL')`，Windows 下若被 SIGPIPE 打断可能留孤儿。本轮只加固了自己改动的 3 个脚本
   （`core-hardening.test.js` / `core-http.test.js` / `_e2e/core-ui-verify.js`），其余未动，按范围收敛。
   **排查方式**：`netstat -ano | findstr ":5191 :5193 :5197 :5299 :5421 :5422"`，
   确认 PID 的命令行是 `rlbuild\server.js` 且父进程已退出后再结束。
5. **localStorage 跨形态不互通**：Electron 是 `file://` origin、HTTP 是 `http://127.0.0.1` origin，
   一个形态填的 API 配置另一个形态读不到。属单机离线设计，非砸坏。
6. 沿用上一轮：真 LLM 联调需填 key；工作区开发副本 A 的 `core/` 是另一套实现，
   **本轮有意未合并**，等斯瑞拍板合并方向；多窗口自动更新仍靠单一 `mainWin`；防白闪未做。

## 七、纪律与边界

- 改动只在 `rlbuild/`（发布正本）+ `计划追踪/` + 今日日志；**不碰工作区副本 A 的 `core/`**。
- git HEAD `9fb96f1`，**未提交、未推送**；旧 `engine/`、`analyze.js`、`lib/` 副本保留标废弃，不删除。
- 密钥不落盘：只走工具参数或环境变量 `DSH_LLM_*` / `REVIEW_LLM_*`；测试夹具里的 `sk-FAKEKEY` /
  `sk-SECRETKEY` 是假串。
- 未重启 DSH / Electron 宿主应用，未抢占斯瑞正在做的事。
