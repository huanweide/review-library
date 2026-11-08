#!/usr/bin/env bash
# =====================================================================
# review-analysis · DSH 插件安装脚本（Unix / macOS / Git Bash）
# ---------------------------------------------------------------------
# 从 GitHub 拉取 review-analysis 插件并安装到 DSH 的「我的专家」目录。
# 优先用 git sparse-clone（保结构、省带宽）；git 不可用时提示手动下载。
# 安装后自动注册到 DSH（marketplace.json + experts.json），重启/刷新即见。
#
# 用法：
#   ./install.sh                 # 安装最新插件版本（自动取最新 review-analysis-v* tag）
#   ./install.sh v1.0.0          # 安装指定版本（v1.0.0 / 1.0.0 均映射到 review-analysis-v1.0.0）
#   ./install.sh review-analysis-v1.0.0   # 直接指定插件 tag
#   ./install.sh main            # 安装开发版（main 分支 HEAD）
#
# 环境变量（可选）：
#   REVIEW_REPO          仓库，默认 huanweide/review-library
#   REVIEW_REF           等同第一个参数
#   WORKBUDDY_CONFIG_DIR DSH 配置根，默认 $HOME/.workbuddy
#   REVIEW_PLUGIN_DIR   自定义安装目录（覆盖默认推导）
#   REVIEW_NO_REGISTER  设为 1 跳过自动注册
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

# 版本号映射：用户传 v1.0.0 / 1.0.0 -> review-analysis-v1.0.0
if [[ "$REF" != "latest" && "$REF" != "main" && "$REF" != refs/* && "$REF" != review-analysis-v* ]]; then
  VER="$REF"
  [[ "$VER" != v* ]] && VER="v$VER"
  CANDIDATE="review-analysis-$VER"
  if git ls-remote --tags "https://github.com/$REPO" 2>/dev/null | grep -q "refs/tags/$CANDIDATE\$"; then
    REF="refs/tags/$CANDIDATE"
    echo "==> 版本映射: $VER -> 插件 tag $CANDIDATE"
  else
    echo "✗ 未找到插件 tag: $CANDIDATE（用 'latest' 或 'main'，或去 GitHub Releases 查看可用版本）"
    exit 1
  fi
fi

if ! command -v git >/dev/null 2>&1; then
  echo "✗ 未检测到 git。请手动下载插件包："
  echo "    https://github.com/$REPO/releases  (下载 review-analysis-dsh-plugin-*.zip)"
  echo "  解压到: $PLUGIN_DIR"
  exit 1
fi

echo "==> git sparse-clone 插件目录 (ref: $REF)"
REPO_SSH="git@github.com:${REPO}.git"
git_clone() { git clone --filter=blob:none --sparse "$1" "$WORK_DIR/repo" >/dev/null 2>&1; }
if ! git_clone "https://github.com/$REPO"; then
  echo "==> HTTPS 克隆失败，回退到 SSH"
  rm -rf "$WORK_DIR/repo"
  if ! git_clone "$REPO_SSH"; then
    echo "✗ HTTPS 与 SSH 克隆均失败，请检查网络"; exit 1
  fi
fi
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
  echo "✗ 在仓库 $REF 中未找到 plugins/review-analysis（该 tag 可能不含插件目录）"
  exit 1
fi

mkdir -p "$(dirname "$PLUGIN_DIR")"
rm -rf "$PLUGIN_DIR"
cp -r "$SRC" "$PLUGIN_DIR"

echo "✅ 已安装 review-analysis 到: $PLUGIN_DIR"

# 自动注册到 DSH，确保侧边栏「我的专家」立即可见（幂等）
if [ "${REVIEW_NO_REGISTER:-0}" != "1" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$PLUGIN_DIR" "$CFG" <<'PY'
import json, sys, os
plugin_dir, cfg = sys.argv[1], sys.argv[2]
name = os.path.basename(plugin_dir.rstrip('/'))
mp = os.path.join(cfg, "plugins/marketplaces/my-experts/.codebuddy-plugin/marketplace.json")
try:
    d = json.load(open(mp, encoding='utf-8'))
except Exception:
    d = {"name":"my-experts","description":"my-experts marketplace (auto-generated)","plugins":[]}
plugs = d.setdefault("plugins", [])
if not any((p.get("name") if isinstance(p, dict) else p) == name for p in plugs):
    plugs.append({"name":name,"path":"plugins/"+name,"enabled":True})
json.dump(d, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
custom = os.path.join(cfg, "experts/custom")
if os.path.isdir(custom):
    uid = next((x for x in os.listdir(custom) if os.path.isdir(os.path.join(custom, x))), None)
    if uid:
        ex = os.path.join(custom, uid, "experts.json")
        try: e = json.load(open(ex, encoding='utf-8'))
        except Exception: e = []
        if name not in e: e.append(name)
        json.dump(e, open(ex,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print("✅ 已自动注册到 DSH（marketplace.json + experts.json），重启/刷新即可见「复习资料分析专家」")
PY
elif [ "${REVIEW_NO_REGISTER:-0}" != "1" ]; then
  echo "⚠ 未检测到 python3，跳过自动注册。请重启 DSH 自动扫描，或在「我的专家」手动添加。"
fi

echo "   版本对应：插件版本号 = review-library 对应版本（如 v1.0.0 插件对应 review-library v1.0.0 引擎）。"
