# v1.5.0 发布准备与阻塞台账（2026-11-10）

> 本文件只记事实与可复现命令，不把「准备就绪」写成「已发布」。
> 正本仓库：`C:\Users\Administrator\Desktop\rlbuild`（单一发布正本 B）。

## 一、结论先行

**v1.5.0 的所有本地准备已完成且全量验收通过，但云端发布被 GitHub 账户侧拦截，尚未发布。**
云端最新 Release 仍是 `v1.4.0`；本地 main 领先远端若干 commit，`v1.5.0` tag 未打。

阻塞不是代码、不是 SSH 密钥、不是仓库权限，而是 **GitHub 账户邮箱未验证**。
GitHub 在 receive-pack 阶段直接拒绝任何 push，因此 `main` 补推与 `tag` 推送都做不了。

## 二、阻塞证据（本机实跑，逐条可复现）

| 检查 | 命令 | 实测结果 |
|---|---|---|
| 推送预演 | `git push --dry-run ghssh main` | `ERROR: You must verify your email address.` / `fatal: Could not read from remote repository.` / exit 128 |
| 真实推送 | `git push ghssh main` | 同上，exit 128 |
| 远端清单 | `git remote -v` | 仅 `ghssh`（`ghssh:huanweide/review-library.git`），无备用 HTTPS 远端 |
| CLI 令牌 | `gh auth status` | `The token in default is invalid.`，`gh` 无法代写 |
| 环境令牌 | `GH_TOKEN` / `GITHUB_TOKEN` | 均未设置 |
| 只读连通 | `git ls-remote ghssh HEAD` | 正常（说明 SSH 认证与网络没问题，拦截发生在写操作） |

补充：v1.4.0 发布时 push main / push tag 均成功；同日稍后推事后台账 commit `8a7077d`
时首次出现该报错，说明是账户状态在此期间变化，不是本机配置漂移。
本机 `git config user.email = 3232553244@qq.com`（非 `noreply` 地址）。

## 三、已完成的发布准备（全部可验）

- 根 `package.json` 升 `1.4.0 → 1.5.0`，`npm run versions:sync` 机械同步 8 处：
  `VERSION`、`README.md` 第 3 行、`package-lock.json`（2 处）、`package.json#build.buildVersion`、
  `core/index.js#CORE_VERSION`、两个 plugin manifest（含已安装副本）。
- `npm run versions:check` 8 处一致；`npm run forms:check` 形态门禁通过。
- CHANGELOG 由「未发布（next）」改为正式 `v1.5.0` 段，并**如实标注待发布与阻塞原因**。
- 全量门禁复跑（版本变更后必须重跑，不沿用上一轮数字）。
- 凭据扫描（全部改动 + 新增文件）无命中；`git status --short` 逐项核对无遗漏。
- 所有改动本地提交，工作区干净；**未 push、未打 tag、未创建 Release**。

## 四、唯一需要人做的一步（六维讲齐）

1. **做什么**：把 GitHub 账户邮箱标为 Verified（验证邮箱），让服务端放开写操作。
2. **在哪做**：浏览器登录 GitHub → 右上角头像 → **Settings** → 左侧 **Emails**；
   找到 `3232553244@qq.com`，若显示 *Unverified*，点 **Resend verification email**，
   去 QQ 邮箱点验证链接；或直接在 Add email address 处改用一个已验证邮箱。
3. **为什么**：GitHub 对未验证邮箱的账户拒绝所有 `git push`（含 tag），
   服务端直接返回 `ERROR: You must verify your email address`，本地任何配置都绕不过。
4. **效果 / 怎么算成功**：Emails 页面该地址旁显示 **Verified**；
   随后在终端跑 `git push --dry-run ghssh main` 不再报该错，而是列出待推 commit 或提示 up-to-date。
5. **为什么我不能做**：要 GitHub 登录态 + 收邮件点链接，两样我都没有；
   `gh` token 失效、无环境变量令牌、无其它远端，也不该替用户操作账号设置。
6. **验证完告诉我一声**，剩下全部由我执行（见第五节），你不用敲命令。

## 五、邮箱验证后的一键补推清单（我来跑）

```bash
# 1) 补推本地 main（含 v1.4.0 事后台账 + v1.5.0 全部改动）
git push ghssh main

# 2) 打附注 tag 并推送，触发 .github/workflows/release.yml
git tag -a v1.5.0 -m 'v1.5.0 引用锚定 + 结构化语料 + 双主题视觉'
git push ghssh v1.5.0

# 3) 确认远端 main 与 tag 同指同一 commit（防 tag 内版本漂移，v1.3.1 前车之鉴）
git ls-remote ghssh refs/heads/main 'refs/tags/v1.5.0*'

# 4) 等 CI（run 9 步），核验 Release 资产与自动更新元数据
gh run list --repo huanweide/review-library --limit 3
```

发布后必须核的 4 件（沿用 v1.4.0 已验证过的链路）：

- Release 5 个资产齐全：`Setup 1.5.0.exe` / `.blockmap` / portable.exe / `latest.yml` / DSH 插件 zip。
- `latest.yml` 原文 `version: 1.5.0`，`sha512` 与 `size` 与安装器一致 → 自动更新可用。
- 下载 CI 实产出的 DSH zip 解包核对顶层为 `dsh-review-analysis/`、含 `cordis.patch.yml`、无专家形态泄漏。
- `git show HEAD:core/index.js | grep CORE_VERSION` 与 `git show HEAD:VERSION` 均为 `1.5.0`。

## 六、不夸大声明

- 本节**不宣称 v1.5.0 已发布**；在第五节第 2 步成功前，云端只有 `v1.4.0`。
- 真模型 v6「anchor 15/15、引文 15/15」只证明引文逐字存在于送进模型的语料，
  **不证明**答案正确、引文支撑该题、anchor 合法或 page 对应真 PDF 页。
- 竞品证据均为官方 README / 产品页（B 级），未部署实测；本轮只采纳经实证「比我们合理」的两点。
- 独立评审：本轮先派窄范围 reviewer 补第三方视角；若仍未返回结论，沿用第九节
  「Chair 亲验放行、不宣称通过独立评审」的如实记录，不冒充。
