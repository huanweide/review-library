# test/fixtures —— 不可修改的历史快照

## dsh-index-legacy.js

- **来源**：commit `5a150cd`（`feat(reqs): 语义重点识别 + 全篇幅自动整理…`）的
  `plugins/dsh-review-analysis/index.js`，字节原样，未做任何改写。
- **用途**：`tools/check-dsh-adapt.mjs` 的 [A] 组 baseline。
  判别要有分辨力，就必须能证明「旧版确实没有这些能力」。
- **为什么不用 `git show HEAD:...`**：HEAD 会随提交前移。2026-11-22 把 DSH 适配提交进
  HEAD 之后，脚本取到的"旧版"其实就是新版，A1–A4 四条对照断言集体假红（实测踩到）。
  固化夹具后，baseline 是历史事实的拷贝，不受任何后续提交影响。
- **纪律**：这个文件**不要更新、不要格式化、不要补注释**。
  它一旦被改，[A] 组的证明力就没了。要换 baseline，请从 git 历史另取一个新文件并说明原因。
