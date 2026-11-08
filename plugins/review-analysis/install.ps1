# =====================================================================
# review-analysis · DSH 插件安装脚本（Windows / PowerShell）
# ---------------------------------------------------------------------
# 从 GitHub 拉取 review-analysis 插件并安装到 DSH 的「我的专家」目录。
# 优先用 git sparse-clone；git 不可用时提示手动下载 Release 包。
#
# 用法（PowerShell）：
#   .\install.ps1                 # 安装最新插件版本
#   .\install.ps1 v1.0.0          # 安装指定版本
#   .\install.ps1 main            # 安装开发版
#
# 可选环境变量：
#   $env:REVIEW_REPO / $env:REVIEW_REF / $env:WORKBUDDY_CONFIG_DIR / $env:REVIEW_PLUGIN_DIR
# =====================================================================
$ErrorActionPreference = "Stop"

$Ref = if ($args.Count -gt 0) { $args[0] } else { if ($env:REVIEW_REF) { $env:REVIEW_REF } else { "latest" } }
$Repo = if ($env:REVIEW_REPO) { $env:REVIEW_REPO } else { "huanweide/review-library" }
$Cfg  = if ($env:WORKBUDDY_CONFIG_DIR) { $env:WORKBUDDY_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".workbuddy" }
$Target = if ($env:REVIEW_PLUGIN_DIR) { $env:REVIEW_PLUGIN_DIR } else { Join-Path $Cfg "plugins/marketplaces/my-experts/plugins/review-analysis" }

$Work = Join-Path $env:TEMP ("ra-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Work -Force | Out-Null
try {
  Write-Host "==> 安装目录 : $Target"
  Write-Host "==> 仓库     : $Repo"
  Write-Host "==> 版本/ref : $Ref"

  if ($Ref -eq "latest") {
    $tags = (git ls-remote --tags "https://github.com/$Repo" 2>$null) -match 'review-analysis-v[0-9][0-9.]*$'
    $latest = ($tags | ForEach-Object { ($_ -split '\s+')[1] -replace '.*/','' } | Sort-Object { [version]($_ -replace 'review-analysis-v','') } | Select-Object -Last 1)
    if ($latest) { $Ref = "refs/tags/$latest"; Write-Host "==> 解析到最新插件版本: $latest" }
    else { Write-Host "==> 未找到 review-analysis-v* tag，回退到 main"; $Ref = "refs/heads/main" }
  }

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "✗ 未检测到 git。请手动下载插件包："
    Write-Host "    https://github.com/$Repo/releases  (下载 review-analysis-dsh-plugin-*.zip)"
    Write-Host "  解压到: $Target"
    exit 1
  }

  Write-Host "==> git sparse-clone 插件目录 (ref: $Ref)"
  git clone --filter=blob:none --sparse "https://github.com/$Repo" (Join-Path $Work "repo") | Out-Null
  git -C (Join-Path $Work "repo") sparse-checkout set "plugins/review-analysis" | Out-Null
  if ($Ref -ne "refs/heads/main") {
    git -C (Join-Path $Work "repo") fetch --depth 1 origin $Ref | Out-Null
    git -C (Join-Path $Work "repo") checkout FETCH_HEAD | Out-Null
  }

  $Src = Join-Path $Work "repo\plugins\review-analysis"
  if (-not (Test-Path $Src)) { Write-Host "✗ 在仓库 $Ref 中未找到 plugins/review-analysis"; exit 1 }

  if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
  Copy-Item $Src $Target -Recurse

  Write-Host "✅ 已安装 review-analysis 到: $Target"
  Write-Host "   重启 DSH 或在「我的专家」刷新即可看到「复习资料分析专家」。"
  Write-Host "   版本对应：插件版本号 = review-library 对应版本（如 v1.0.0 插件对应 review-library v1.0.0 引擎）。"
} finally {
  Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
