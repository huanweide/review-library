---
title: 单文件 portable exe · 六次失败记录与后续攻克
date: 2026-11-05
updated: 2026-11-06
tags: [maxloop, 逃逸阶梯, R4, KNOWN-LIMITATION, 打包, 已攻克]
source: 2026-11-05 本机六次 electron-builder 实跑日志（.cache/build3.log / build4.log / build5.log / C:\Temp\build6.log）；2026-11-06 纯英文路径实跑日志（C:\Temp\build-en.log / build-en2.log）与 _e2e/portable-check.js 真机验证输出
---

# 单文件 portable exe：R4 认输记录（已被后续攻克，见第七节）

## 结论先行

**本文前六节是 2026-11-05 的 R4 降级决策**：当时没做出来的是「一个 .exe 文件」，做出来了的是「免安装双击即用的桌面版目录」，且已通过真机 CDP 端到端验证（10/10）。两者对用户只差"要不要解压/复制一个文件夹"，功能完全等价。

> **状态更新（2026-11-06）**：下文「单文件 exe 未产出」的结论**已被推翻**。按第六节建议①（项目移到纯英文路径）+ 复用本地缓存 + 国内镜像，单文件 exe 已成功产出（69 MB），并通过真机验证 10/10。过程中还抓到并修掉一个会丢数据的真 bug。完整经过见第七节。前六节原文保留，作为失败证据链与决策依据，不删不改。

## 试过的路径（每条附失败证据）

| # | 打法 | 结果 | 逐字符失败证据 |
|---|---|---|---|
| 1 | 默认 `electron-builder --win portable` | 失败 | `open C:\Users\Administrator\AppData\Local\electron\Cache\133601107.zip.part7: Access is denied.`（系统缓存目录写权限） |
| 2 | `ELECTRON_CACHE` / `ELECTRON_BUILDER_CACHE` 挪到项目内 | 换了个坑 | 日志 `.cache/build3.log:7` `Get "https://github.com/.../winCodeSign-2.6.0.7z": dial tcp: lookup github.com: no such host` |
| 3 | `signAndEditExecutable:false` 去掉 rcedit | 再换坑 | 日志 `.cache/build4.log:8` `Get "https://github.com/.../nsis-3.0.4.1.7z": dial tcp: lookup github.com: no such host` |
| 4 | `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/...` | NSIS 下载成功，编译崩 | 日志 `.cache/build5.log`：路径乱码 `ϰͼ飮\.cache\eb\nsis\...` + `Internal compiler error #12345: error creating mmap the size of 88049176.` |
| 5 | 缓存/临时/输出全挪到 `C:\Temp` 纯英文路径 | 2 秒退，无新信息 | `C:\Temp\build6.log`：仅 `app-builder.exe process failed`，无具体错误 |
| 6 | 换 `--dir` 目标（不打 NSIS 安装器） | **成功** | `electron-builder --dir` 退出 0，产出 `dist/win-unpacked/ReviewLibrary.exe`（173 MB） |

## 根因（设计/环境层，不是配置写错）

两条硬约束叠一起：

1. **本机 `github.com` 无 DNS 解析**。electron-builder 的 NSIS / winCodeSign 二进制默认从 GitHub Releases 拉，必须靠国内镜像绕。
2. **项目路径含中文**（`复习资料图书馆`）。NSIS 编译器在 GBK 代码页下把路径读成乱码，做 88 MB 内存映射时直接崩。把缓存挪到 `C:\Temp` 也没解决，因为 `app-builder.exe` 自身仍从中文路径启动。

单文件 portable 目标内部强制依赖 NSIS，绕不开。`--dir` 目标不依赖 NSIS，所以能出。

## 当前最佳解（当时的状态）

`dist/win-unpacked/` 整个目录（260 MB，含 `ReviewLibrary.exe` 173 MB）＝免安装桌面版。双击 `启动桌面版.bat` 即运行。验证：

- `_e2e/electron-check.js` 用 CDP 远程调试连真 Electron，**10/10 通过**：页面标题、书架可见、`window.api` ipc 桥、`trash.list` / `insight.generate` 可用、本地 vendor 三库加载、CSP 限同源、真点「收录一本书」→ ipc 落盘 → 封面出现。
- asar 23 项全部核对在包内（vendor 三件套 / preview.js / preview-worker.js / insight.js / main.js / preload.js）。

## 过程中抓到并修掉的真 bug

`app/main.js` 原先把数据目录写成 `path.join(__dirname,'..','library')`。打包后 `__dirname` 落在只读 `app.asar` 内，`fs.mkdirSync` 必抛，桌面版一启动就崩。**只有真启动桌面版才会暴露**，server 模式与 e2e 都测不到。已修为：环境变量 `REVIEW_LIBRARY_ROOT` > 打包版 exe 同级 `library/` > 开发版项目内 `library/`。修后 `--dir` 重打包，CDP 复验 10/10 仍全绿。

另记一个环境坑（非产品 bug）：WorkBuddy 沙箱注入 `ELECTRON_RUN_AS_NODE=1`，会把任何 Electron 当纯 Node 跑、`--` 参数全被拒（`bad option`）。验证脚本 spawn 时已删除该变量；用户本机双击不受影响。

## 为什么不适合继续迭代（当时的判断）

单文件 exe 只是把 260 MB 目录压成一个自解压包，用户价值增量极小，但每次尝试都要重新下载/编译 NSIS、受中文路径与网络双重制约。按 maxloop 2-3-4 逃逸阶梯，同一项累计 6 次失败，到 R4 应认输移出清单、标 KNOWN-LIMITATION，把轮数留给有真实收益的改动。

## 建议人类下一步（想真要单文件 exe 时）

1. 把整个项目移到纯英文路径，例如 `C:\Dev\review-library`，再执行 `npm run dist`（中文路径问题消失）。
2. 或先手动把 `nsis-3.0.4.1` / `winCodeSign-2.6.0` 两个二进制解到 `ELECTRON_BUILDER_CACHE`，并设 `ELECTRON_BUILDER_BINARIES_MIRROR` 指向国内镜像。
3. 或直接接受 `--dir` 产物，用 7-Zip 自制 SFX 自解压包（不依赖 NSIS）。

## 七、后续攻克（2026-11-06）

用户指令「都试试」里包含「把项目挪到英文路径再试单文件 exe」。按建议①重开，条件已变：

- **做法**：把项目源码复制到 `C:\Temp\review-library`（纯英文路径），复用已下载完整的本地缓存（`C:\Temp\electron-cache` 的 Electron zip、`C:\Temp\eb-cache` 的 nsis / winCodeSign），设 `ELECTRON_BUILDER_BINARIES_MIRROR` 指向国内镜像，`TMP`/`TEMP` 也落纯英文路径。**全程不需要联网**。
- **结果**：`electron-builder --win portable` 退出 0，产出 `dist/ReviewLibrary-0.2.0-portable.exe`（69 MB）。日志 `C:\Temp\build-en.log` 末尾停在 `building target=portable ... archs=x64`，零错误行。
- **为什么这次成**：前六节的两条根因同时被绕开——中文路径消失（NSIS 不再做乱码路径的 mmap），二进制已缓存（不依赖 github DNS）。

### 真跑抓到的第三个真 bug：portable 数据会丢

写了 `_e2e/portable-check.js`，故意**不设** `REVIEW_LIBRARY_ROOT`，测单文件 exe 的自然数据落点。首轮结果 8 通过 / 1 失败：

```
✗ 数据落在 exe 同级 library（可备份、关掉不丢）
· 结论：portable 自解压路径 ≠ 用户放置 exe 的目录，数据落点错误
```

功能全通（页面、ipc 桥、vendor、CSP、真点收录书出封面），但真点收录的书**没落进 exe 同级 `library/`**。根因：portable exe 先自解压到系统临时目录再运行，`app.getPath('exe')` 指向临时解压目录，数据跟着落进临时目录，退出即可能被清理。这直接击穿"数据在你手里、可备份"的设计。server 模式、免安装目录版、浏览器 e2e 都测不到，只有真跑单文件版才现形。

**修法**：electron-builder 的 portable 启动器运行时注入 `PORTABLE_EXECUTABLE_DIR`，指向用户放置 exe 的目录，与自解压临时目录无关。`app/main.js` 把它设为最高优先落点（仅次于显式环境变量）；同时新增 `ipcMain.handle('app:dataDir')` + 安全桥 + 客户端对称接口，让落点不再黑盒。

**复验**：同步源码到英文路径重打包 → `portable-check.js` **10/10 全绿**，其中两条硬判据：

- `主进程报告的数据目录 = exe 同级 library` ✓
- `数据落在 exe 同级 library（可备份、关掉不丢）` ✓

免安装目录版也重新 `--dir` 打包同步修复，`electron-check.js` 10/10 仍全绿。

### 现状

- 已交付：单文件 exe（69 MB，双击即用，数据在 exe 同级 `library/`）、免安装目录版、server 模式。
- 单文件 exe 已拷回项目 `dist/ReviewLibrary-0.2.0-portable.exe`。
- 剩余约束：想**重新打包**必须在纯英文路径下做；日常使用不受影响，exe 放中文路径也能双击。
- 全套测试 135 项全绿（store 25 / insight 24 / e2e 58 / 真实资料 8 / 桌面版 10 / 单文件版 10）。

## 交接状态（更新后）

- 单文件 exe：**已产出并验证**，不再是 KNOWN-LIMITATION；限制只剩「打包需英文路径」。
- 前六节的六次失败证据、R4 决策依据、两个早期真 bug 全部保留，供后续复盘。
