# =====================================================================
# review-analysis - DSH plugin installer (Windows / PowerShell)
# ---------------------------------------------------------------------
# Pulls review-analysis from GitHub and installs it into DSH "My Experts".
# Uses git sparse-clone first; if git is missing, points to the Release zip.
# After install it auto-registers with DSH (marketplace.json + experts.json)
# so it shows up in the sidebar immediately after restart/refresh.
#
# Usage (PowerShell):
#   .\install.ps1                 # install latest plugin version
#   .\install.ps1 v1.0.0          # install a version (v1.0.0 / 1.0.0 -> review-analysis-v1.0.0)
#   .\install.ps1 review-analysis-v1.0.0   # specify plugin tag directly
#   .\install.ps1 main            # install dev build (main HEAD)
#
# Env (optional):
#   $env:REVIEW_REPO / $env:REVIEW_REF / $env:WORKBUDDY_CONFIG_DIR
#   $env:REVIEW_PLUGIN_DIR / $env:REVIEW_NO_REGISTER
# =====================================================================
$ErrorActionPreference = "Stop"

$Ref = if ($args.Count -gt 0) { $args[0] } else { if ($env:REVIEW_REF) { $env:REVIEW_REF } else { "latest" } }
$Repo = if ($env:REVIEW_REPO) { $env:REVIEW_REPO } else { "huanweide/review-library" }
$Cfg  = if ($env:WORKBUDDY_CONFIG_DIR) { $env:WORKBUDDY_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".workbuddy" }
$Target = if ($env:REVIEW_PLUGIN_DIR) { $env:REVIEW_PLUGIN_DIR } else { Join-Path $Cfg "plugins/marketplaces/my-experts/plugins/review-analysis" }
$NoRegister = if ($env:REVIEW_NO_REGISTER -eq "1") { $true } else { $false }

$Work = Join-Path $env:TEMP ("ra-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Work -Force | Out-Null
try {
  Write-Host "==> Target    : $Target"
  Write-Host "==> Repo      : $Repo"
  Write-Host "==> Ref/Ver   : $Ref"

  if ($Ref -eq "latest") {
    $tags = (git ls-remote --tags "https://github.com/$Repo" 2>$null) -match 'review-analysis-v[0-9][0-9.]*$'
    $latest = ($tags | ForEach-Object { ($_ -split '\s+')[1] -replace '.*/','' } | Sort-Object { [version]($_ -replace 'review-analysis-v','') } | Select-Object -Last 1)
    if ($latest) { $Ref = "refs/tags/$latest"; Write-Host "==> Latest plugin tag: $latest" }
    else { Write-Host "==> No review-analysis-v* tag found, fallback to main"; $Ref = "refs/heads/main" }
  }

  # version mapping: v1.0.0 / 1.0.0 -> review-analysis-v1.0.0
  if ($Ref -ne "latest" -and $Ref -ne "main" -and $Ref -notmatch '^refs/' -and $Ref -notmatch '^review-analysis-v') {
    $Ver = if ($Ref -match '^v') { $Ref } else { "v$Ref" }
    $Candidate = "review-analysis-$Ver"
    $hasTag = (git ls-remote --tags "https://github.com/$Repo" 2>$null) -match [regex]::Escape("refs/tags/$Candidate")
    if ($hasTag) { $Ref = "refs/tags/$Candidate"; Write-Host "==> Version mapped: $Ver -> plugin tag $Candidate" }
    else { Write-Host "✗ Plugin tag not found: $Candidate (use 'latest' or 'main', or check GitHub Releases)"; exit 1 }
  }

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "✗ git not found. Download the plugin zip manually:"
    Write-Host "    https://github.com/$Repo/releases  (review-analysis-dsh-plugin-*.zip)"
    Write-Host "  Extract to: $Target"
    exit 1
  }

  Write-Host "==> git sparse-clone plugin dir (ref: $Ref)"
  $RepoSSH = "git@github.com:$Repo.git"
  try {
    git clone --filter=blob:none --sparse "https://github.com/$Repo" (Join-Path $Work "repo") | Out-Null
  } catch {
    Write-Host "==> HTTPS clone failed, fallback to SSH"
    Remove-Item (Join-Path $Work "repo") -Recurse -Force -ErrorAction SilentlyContinue
    try {
      git clone --filter=blob:none --sparse $RepoSSH (Join-Path $Work "repo") | Out-Null
    } catch {
      Write-Host "✗ clone failed via both HTTPS and SSH; check network"; exit 1
    }
  }
  git -C (Join-Path $Work "repo") sparse-checkout set "plugins/review-analysis" | Out-Null
  if ($Ref -ne "refs/heads/main") {
    git -C (Join-Path $Work "repo") fetch --depth 1 origin $Ref | Out-Null
    git -C (Join-Path $Work "repo") checkout FETCH_HEAD | Out-Null
  }

  $Src = Join-Path $Work "repo\plugins\review-analysis"
  if (-not (Test-Path $Src)) { Write-Host "✗ plugins/review-analysis not found in $Ref (this tag may not contain the plugin)"; exit 1 }

  if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
  Copy-Item $Src $Target -Recurse

  Write-Host "✅ Installed review-analysis to: $Target"

  # auto-register with DSH (marketplace.json + experts.json), idempotent
  if (-not $NoRegister) {
    try {
      $name = (Split-Path $Target -Leaf)
      $mp = Join-Path $Cfg "plugins/marketplaces/my-experts/.codebuddy-plugin/marketplace.json"
      $mpObj = if (Test-Path $mp) { Get-Content $mp -Raw | ConvertFrom-Json } else { @{name="my-experts";description="my-experts marketplace (auto-generated)";plugins=@()} }
      $exists = $false
      foreach ($p in $mpObj.plugins) { if ($p.name -eq $name) { $exists = $true } }
      if (-not $exists) { $mpObj.plugins += @{name=$name; path="plugins/$name"; enabled=$true} }
      [System.IO.File]::WriteAllText($mp, ($mpObj | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
      $custom = Join-Path $Cfg "experts/custom"
      if (Test-Path $custom) {
        $uid = (Get-ChildItem $custom -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).Name
        if ($uid) {
          $ex = Join-Path $custom "$uid/experts.json"
          $exArr = if (Test-Path $ex) { @(Get-Content $ex -Raw | ConvertFrom-Json) } else { @() }
          if ($exArr -notcontains $name) { $exArr += $name; [System.IO.File]::WriteAllText($ex, ($exArr | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false)) }
        }
      }
      Write-Host "✅ Auto-registered with DSH (marketplace.json + experts.json); restart/refresh to see '复习资料分析专家'."
    } catch {
      Write-Host "⚠ Auto-register failed ($($_)); restart DSH to auto-scan, or add manually in 'My Experts'."
    }
  }

  Write-Host "    Version mapping: plugin version == review-library version (e.g. v1.0.0 plugin == review-library v1.0.0 engine)."
} finally {
  Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
