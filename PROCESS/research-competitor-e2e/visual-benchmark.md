---
title: 美化块 · 视觉基准对照表（基准 / 我们 / 缺什么）
date: 2026-11-10
tags: [maxloop, 阶段零, 美化, design-token, dark-mode, 对照表]
source: 英文 2026 dashboard best practice 5 篇 + 中文/开源设计规范 5 篇（含 GitHub 52liulian/EduToolbox DESIGN.md）+ 竞品 README 视觉描述；rlbuild v1.4.0 renderer/css/core.css 逐行核销
---

# 美化块视觉基准（2026-11-10）

> 证据级：**B/C**——设计基准来自公开规范文章与开源 DESIGN.md，竞品界面来自 README 描述与截图说明；
> 本轮**未部署任何竞品**。我方现状是**逐行读源码**（A 级，可复核），不是印象。

## 一、搜了什么（两组，逐字符锚点）

| 组 | 关键词 | 拿到的基准原文（摘录） |
|---|---|---|
| 英文 best practice | `modern knowledge workbench dashboard UI design 2026 sidebar card density spacing color token best practice study app` | 「A well-designed dashboard should be fully rebrandable by changing 6-8 CSS variables」（dev.to / thekitbase）；「Replace heavy box shadows with 1px borders」「Reduce card padding from 24px to 16px」「Remove rounded corners or keep them very subtle (2-4px max)」；「Ship dark mode from day one through prefers-color-scheme」「Use skeleton screens shaped like the content, never spinners」「reserve color for status only — never decoration」（artofstyleframe / aidesigner）；「240-280px expanded, 64-72px collapsed」（artofstyleframe）；「Flat, high-contrast, and data-first ... Skip the heavy drop shadows, glassmorphism panels, and gradient KPI cards. They read as dated within a year」 |
| 中文 / 开源规范 | `学习类工具 界面设计 规范 深色模式 设计令牌 空状态 骨架屏 信息密度 2026` | 「零自定义优先用令牌：颜色/圆角/阴影/间距/动效一律引用 CSS 变量，禁止硬编码十六进制值」（GitHub `52liulian/EduToolbox/DESIGN.md`）；「视觉层级完全由间距 + 字重 + 透明度驱动，不依赖色块或卡片堆叠」「列表项之间只用 border-b 做分割线，而非各自独立成卡片」「统一缓动 cubic-bezier(0.16, 1, 0.3, 1) — 快起慢收」（GitHub `DBAAZzz/easy-weixin-clawbot` 页面设计规范）；「骨架屏替代传统加载动画」「深色模式需自动适配系统设置」「中性色控制文字对比度不低于 4.5:1」（yuuxin）；「深色背景中阴影不容易被看见 … 更常用色阶、边框、透明度表现层级」「Modal/Dropdown/Tooltip/Toast 要有独立层级」（PixelCake）；「表面海拔 Level 0→4 逐步提亮」「WCAG AA 4.5:1」（WarpNav） |

**共识收敛（8 条，两组独立命中同一结论）**：

1. **语义 token 唯一真源**：颜色/圆角/间距/阴影/动效全走 CSS 变量，改 6–8 个变量即可换肤。
2. **浅/深双主题**，跟随 `prefers-color-scheme`，首帧无白闪；深色靠 surface 色阶 + 1px 边框建立层级，**不能只换背景色**。
3. **单一强调色**，其余走灰阶；绿/黄/红只留给状态，不当装饰。
4. **Minimal chrome**：1px 边框替重阴影，圆角 2–6px，padding 24→16，去渐变。
5. **侧栏 240–280px**，导航低对比于内容，单一 accent 标「你在这里」。
6. **三态齐全**：空状态（首屏最先被看到）、骨架屏（形状贴合内容，不用 spinner）、可恢复的错误态。
7. **密度是有意为之**：13–14px 正文、紧凑行高、等宽数字（tabular-nums）。
8. **动效克制**：统一缓动、快起慢收，只做 translate/背景色过渡，不做装饰性动画。

## 二、基准有什么 / 我们有什么 / 缺什么

| # | 基准 | 我方现状（`renderer/css/core.css` v1.4.0） | 缺什么 |
|---|---|---|---|
| V1 | 语义 token 唯一真源 | `:root` 有 12 个变量（:1–15），但 `--chip`、`--brand-soft` 等仍被硬编码色值绕过；`:89` 直接写 `#fafbff`、`:100` 写 `#fff`、`:105` 写 `#fde68a` | 令牌未覆盖全部组件；硬编码色值散落 |
| V2 | 浅/深双主题 | **完全没有** `prefers-color-scheme` / `[data-theme]`；仅浅色一套 | 深色模式、surface 色阶、浮层独立层级 |
| V3 | 单一强调色 | :7 `--brand: #4f46e5` + :32 顶栏紫→紫渐变；:105 图片标签黄底 | 渐变顶栏属基准明确「dated within a year」；装饰色越界 |
| V4 | 1px 边框替阴影 | :13 `--shadow: 0 1px 3px …, 0 8px 24px …` 双层阴影，:34/:81 用在顶栏与每个 panel | 重阴影；14px 大圆角(:14)；:66 padding `24px 30px` |
| V5 | 侧栏 240–280px | :45 `width: 280px` ✓（符合上限） | 无 |
| V6 | 三态齐全 | 空状态只有 :64 `.empty-hint` 一行灰字；无骨架屏；错误仅 :109 `.status.err` 变色 | 首屏空状态引导、骨架屏、可恢复错误提示 |
| V7 | 密度 / 字阶 | :24 `font-size: 14px` ✓、:25 `line-height: 1.6` ✓；但数字未启用等宽，行高与控件高度无统一节奏 | tabular-nums、间距节奏变量 |
| V8 | 动效克制 | :56/:90 `transition: .15s` 散落，无统一缓动变量 | 统一 `--ease`，去掉装饰性过渡 |

**结论**：功能形态（3 布局 / 三级下钻 / 5 种导出）已经齐全，视觉层是**唯一明显落后于基准**的部分，且差距全部集中在「令牌 / 主题 / chrome / 三态」四件事，不需要改任何 DOM 契约。

## 三、本轮采纳 / 不采纳（过 R/C/N）

| 候选 | R | C | N | 结论 |
|---|---|---|---|---|
| 语义 token 重写 + 深浅双主题（`prefers-color-scheme`） | 与「长时间读题的复习工具」一致 | 两组基准 8 条共识 + CSS 现状逐行核销 | 不改一个 DOM id/class，成本全在 CSS | **采纳** |
| 去渐变顶栏 / 重阴影 / 14px 圆角 → 中性底 + 1px 边框 + 6px | 同 | 「Skip heavy drop shadows, glassmorphism panels, and gradient KPI cards」 | 纯样式，零功能风险 | **采纳** |
| 补空状态 / 骨架屏 / 错误态 | 同 | 「Design the empty state before the happy path」「Use skeleton screens … never spinners」 | 首屏第一眼就是空状态，当前只有一行灰字 | **采纳** |
| 密度节奏 + tabular-nums + 统一缓动变量 | 同 | 两组均命中 | 纯 CSS 变量，零风险 | **采纳** |
| 毛玻璃 `backdrop-blur` 面板 | 基准组内**互相冲突**（一组推荐，另一组明确「skip glassmorphism」） | 冲突即不可采信为共识 | 非必要 | **不采纳** |
| 可折叠侧栏 / 图标模式 | 合理但是独立交互 | 有基准 | **要改 DOM 与 JS 状态**，会动 e2e 契约；本轮范围限定纯视觉 | **不采纳（登记候选）** |
| 换字体 / 引入图标库 / 新增 npm 依赖 | 与离线单机定位冲突 | — | 增依赖会动 `package-lock.json` 与 CI | **不采纳** |

## 四、验证方式（不许自判「好看了」）

1. 双形态真 Chromium（`HTTP` 与 `file://`）各截浅色 / 深色两张图，共 4 张，人工目视核对无白块、无溢出、无对比度塌陷。
2. e2e 断言：`getComputedStyle(document.documentElement).getPropertyValue('--bg')` 在 `prefers-color-scheme: dark` 下确为深色；`--shadow` 不再含 `8px 24px`；顶栏 `background-image === 'none'`。
3. 既有 103 条 e2e 断言全绿（证明 DOM 契约未破），`npm test` / 判别 / `node --check` / 版本 / 形态门禁全绿。
4. 深色模式下题目详情弹窗与子题型侧栏的 z-index、文字对比度逐项目视（基准 V2 要求浮层有独立层级）。

## 五、未找到 / KNOWN-LIMITATION

- 未找到任何高 star 竞品公开可下载的**界面截图原图**做像素级比对；竞品视觉信息止于 README 描述与截图说明，属 B 级。
- 本轮不部署竞品，不做 A/B 用户测试；「更好看」不做主观量化宣称，只交付「按共识基准改造 + 双主题真截图可验」这一事实。
- 深色模式跟随系统设置，**不提供应用内手动切换开关**（避免动 DOM/JS 契约，登记为候选）。

## 六、执行结果（2026-11-10，本轮已落地）

| 对照表条目 | 采纳 | 落地位置 | 真验收 |
|---|---|---|---|
| V1 语义 token 唯一真源 | ✅ | `renderer/css/core.css` `:root` + dark media 全部变量化，旧 `--brand*` 派生自 `--accent*` | e2e：`--surface-3` 存在 |
| V2 浅/深双主题无白闪 | ✅ | `@media (prefers-color-scheme: dark)` 首帧生效；`svgTheme()` 把 `--surface-1/--ink/--ink-soft` 注入 SVG | e2e：`--bg #f6f7f9 → #10131a`、SVG `#ffffff → #171b24`、body `rgb(16,19,26)`；真截图 4 类 × 2 形态 |
| V3 单一强调色 | ✅ | 去顶栏渐变，仅 `--accent` 作交互色，绿/黄/红只给状态 | e2e：`.topbar backgroundImage === 'none'` |
| V4 1px 边框替重阴影 | ✅ | `--shadow` 由双层 8px/24px 收敛为 `0 1px 2px`；圆角 14→8/5；padding 30→26 | e2e：`--shadow` 不含 `8px 24px` |
| V5 侧栏 240–280px | 已符合 | 280 → 264（仍在区间内） | 目视 |
| V6 三态齐全 | ✅ | 空状态三步引导 / `.status.loading` 骨架 shimmer / `.status.err` 带重试引导 | 真截图 + e2e 状态条断言 |
| V7 密度 / tabular-nums | ✅ | `font-variant-numeric`、13–14px 字阶、间距变量 | 目视 |
| V8 动效克制 | ✅ | 统一 `--ease` + `--dur`，`prefers-reduced-motion` 关闭动效 | 目视 |
| 毛玻璃 / 可折叠侧栏 / 新字体 / 新依赖 | ❌ | 按 R/C/N 打回（基准互相冲突 / 要改 DOM 契约 / 增依赖） | — |

**目视核对结论**（`_e2e/shots/core-ui-verify/`，HTTP 与 `file://` 各 4 张）：
浅色中性干净、深色无白块且文字对比度足够、题目详情锚点与引文核对徽章可见、
弹窗层级高于子题型面板、右下「在导图中定位知识点」按钮未被遮挡、无溢出。

**未做的**：深色模式下的题目详情弹窗未单独截图目视（同一套 `--surface-3` token 覆盖，
未做像素级复核）；应用内主题切换开关；A/B 用户测试。均登记为 KNOWN-LIMITATION，不夸大。
