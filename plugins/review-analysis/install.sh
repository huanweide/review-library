#!/usr/bin/env bash
# =====================================================================
# review-analysis · DSH 插件安装脚本（Unix / macOS / Git Bash）
# ---------------------------------------------------------------------
# 从 GitHub 拉取 review-analysis 插件并安装到 DSH 的「我的专家」目录。
# 优先用 git sparse-clone（保结构、省带宽）；git 不可用时提示手动下载。
#
# 用法：
#   ./install.sh                 # 安装最新插件版本（自动取最新 review-analysis-v* tag）
#   ./install.sh v1.0.0          # 安装指定版本（版本号与 review-library 对应）
#   ./install.sh main            # 安装开发版（main 分支 HEAD）
#
# 环境变量（可选）：
#   REVIEW_REPO        仓库，默认 huanweide/review-library
#   REVIEW_REF         等同第一个参数
#   WORKBUDDY_CONFIG_DIR  DSH 配置根，默认 $HOME/.workbuddy
#   REVIEW_PLUGIN_DIR  自定义安装目录（覆盖默认推导）
# =====================================================================
set -euo pipefail

REF="${1:-${REVIEW_REF:-latest}}"
REPO="${REVIEW_REPO:-huanweide/review-library}"
CFG="${WORKBUDDY_CONFIG_DIR:-$HOME/.workbuddy}"
PLUGIN_DIR="${REVIEW_PLUGIN_DIR:-$CFG/plugins/marketplaces/my-experts/plugins/review-analysis}"

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

echo "==> 安装目录 : $PLUGIN_DIR"
echo "==> 仓库     : $REPO"
echo "==> 版本/ref : $REF"

# latest => 解析最新的 review-analysis-v* tag
if [ "$REF" = "latest" ]; then
  LATEST_TAG="$(git ls-remote --tags "https://github.com/$REPO" 2>/dev/null \
    | grep -o 'review-analysis-v[0-9][0-9.]*$' | sort -V | tail -1)"
  if [ -n "$LATEST_TAG" ]; then
    REF="refs/tags/$LATEST_TAG"
    echo "==> 解析到最新插件版本: $LATEST_TAG"
  else
    echo "==> 未找到 review-analysis-v* tag，回退到 main"
    REF="refs/heads/main"
  fi
fi

if ! command -v git >/dev/null 2>&1; then
  echo "✗ 未检测到 git。请手动下载插件包："
  echo "    https://github.com/$REPO/releases  (下载 review-analysis-dsh-plugin-*.zip)"
  echo "  解压到: $PLUGIN_DIR"
  exit 1
fi

echo "==> git sparse-clone 插件目录 (ref: $REF)"
git clone --filter=blob:none --sparse "https://github.com/$REPO" "$WORK_DIR/repo" >/dev/null 2>&1
git -C "$WORK_DIR/repo" sparse-checkout set "plugins/review-analysis" >/dev/null 2>&1

if [[ "$REF" == refs/tags/* ]]; then
  git -C "$WORK_DIR/repo" fetch --depth 1 origin "$REF" >/dev/null 2>&1
  git -C "$WORK_DIR/repo" checkout FETCH_HEAD >/dev/null 2>&1
elif [ "$REF" != "refs/heads/main" ]; then
  git -C "$WORK_DIR/repo" fetch --depth 1 origin "$REF" >/dev/null 2>&1
  git -C "$WORK_DIR/repo" checkout FETCH_HEAD >/dev/null 2>&1
fi

SRC="$WORK_DIR/repo/plugins/review-analysis"
if [ ! -d "$SRC" ]; then
  echo "✗ 在仓库 $REF 中未找到 plugins/review-analysis"
  exit 1
fi

mkdir -p "$(dirname "$PLUGIN_DIR")"
rm -rf "$PLUGIN_DIR"
cp -r "$SRC" "$PLUGIN_DIR"

echo "✅ 已安装 review-analysis 到: $PLUGIN_DIR"
echo "   重启 DSH 或在「我的专家」刷新即可看到「复习资料分析专家」。"
echo "   版本对应：插件版本号 = review-library 对应版本（如 v1.0.0 插件对应 review-library v1.0.0 引擎）。"
