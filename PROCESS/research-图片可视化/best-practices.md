# 阶段零研究：PPTX 离线"看图"基准对照（M0/M3 部分）

> 目的：确认"离线、零云、零依赖"前提下，PPTX 资料让学生真正看到嵌入图片的标准做法；
> 据此定位本项目缺哪一块。证据均来自真实开源/标准资料，非凭空推断。

## 一、行业基准（功能清单 + 正确做法）

| 维度 | 基准（来自真实项目/标准） | 来源锚点 |
|---|---|---|
| PPTX 本质 | 是一个 ZIP 包；媒体在 `ppt/media/`，每张幻灯片用 `ppt/slides/_rels/slideN.xml.rels` 把 `rId` 映射到媒体部件 | GitHub `CasualOffice/slides` 的 `PPTX_PIPELINE.md`（ECMA-376 / ISO 29500 OOXML PresentationML） |
| 离线抽图标准做法 | 解压后遍历 `ppt/media/` 取图片字节；再用 `slideN.xml.rels` 的 `Target` 反查 basename → 归到对应幻灯片号 | 同上；另见 npm `document-media-extractor`（local-first，PowerPoint OOXML 走 `ppt/media/` + slide number + OOXML relationship，零上传） |
| 整页渲染（重） | 在浏览器把整张幻灯片还原版式（文字+图+形状），如 `PPTXjs`（jQuery 插件，`mediaProcess:true`）。代价：重依赖、等于重写渲染器 | `meshesha/PPTXjs`（gitcode 镜像）、多篇 CSDN 教程 |
| 现代解析库（重） | `@hokkyss/pptx-reader` 纯 TS、isomorphic、带媒体抽取与三层图层合成；但引入新依赖 | npm `@hokkyss/pptx-reader` |

## 二、我们有什么 / 缺什么

| 能力 | 现状 | 证据锚点 |
|---|---|---|
| 抽取 PPTX 嵌入媒体并按幻灯片归组 | ✅ 已实现并入库 | `lib/media.js` `extractOfficeMedia`（遍历 `ppt/media/` + `slideN.xml.rels` 映射 `slideOf[basename]=slideNo`）；`app/main.js:40` / `server.js:138` 入库 |
| 后端读取接口 | ✅ `readMaterial` 返回 assets 列表；`readAsset(id)` 返回单张字节；HTTP `/asset/:aid` 回原始字节（同源） | `lib/store.js:204-228`、`server.js:161-166` |
| 前端把嵌入图展示出来 | ❌ **缺失** | `renderer/js/preview.js:152-155` 的 PPTX 分支只抽文字（`pptxText`），自注"版式请用原始文件"；`assets` 从未被读取/渲染 |
| PDF 看图 | ✅ iframe 渲染原文件，图可见 | `preview.js:132` |
| DOCX 看图 | ✅ mammoth 内联图（base64） | `preview.js:39-42` |

## 三、缺的那一块（本次要补的）

**只补前端**：让 PPTX 预览按幻灯片分组展示"文字 + 该页嵌入图"，并提供一个点开看图的入口。
- 不引新依赖（不用 PPTXjs / pptx-reader / LibreOffice）。
- 复用已抽取的 `assets`（按 `slide` 归组），离线、同源、零外链。
- 完成态：上传带图的 PPTX → 预览出现 `<img>`（dataURL 或同源 `/asset/:aid`）且按页码分组；零外部域名请求、零未捕获 JS 报错。

## 四、未找到 / KNOWN-LIMITATION

- 未找到"无 LibreOffice、纯前端、把 PPTX 整页版式还原成图"的轻量可靠方案——结论：离线纯前端只能做到"按页展示嵌入图 + 文字"，做不到像素级还原整页版式；若要真·整页图需引入 LibreOffice（外部依赖，偏离离线优先）。本次按"视觉自动·轻量"路线，不引入。
- EMF/WMF 等矢量占位图：`media.js` 已按扩展名过滤（`isImageExt` 不含 wmf/emf），这部分不展示，符合 `document-media-extractor` 也跳过 wmf/emf 的做法。
