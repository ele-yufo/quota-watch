#!/usr/bin/env bash
# 一键编译并安装 quota-watch 到已连接的 iPhone。
#
#   ios/run-on-device.sh
#
# 前置：Xcode 已登录你的 Apple 账号；ios/Local.xcconfig 已配置
# DEVELOPMENT_TEAM（没有就复制 Local.xcconfig.example 填入）。
# 安装后签名有效期约 1 年（付费账号）——app 提示"不可用"时重跑本脚本即可。
set -euo pipefail

# 默认用 xcode-select 指向的 Xcode；要换别的 Xcode 用环境变量覆盖：
#   DEVELOPER_DIR=/path/to/Xcode.app/Contents/Developer ios/run-on-device.sh
export DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}"

cd "$(dirname "$0")"

# ── Team ID：从 Local.xcconfig 读（不入库），缺失时给出指引 ──────────────
XCCONFIG="${XCCONFIG:-./Local.xcconfig}"
if [ ! -f "$XCCONFIG" ]; then
  echo "✗ 缺少 $XCCONFIG —— 先复制模板并填入你的 Team ID："
  echo "    cp ios/Local.xcconfig.example ios/Local.xcconfig"
  echo "    # 编辑填入 DEVELOPMENT_TEAM（如 Z66XF42B32）"
  exit 1
fi
TEAM=$(grep -E '^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=' "$XCCONFIG" | head -1 | sed -E 's/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*//; s/[[:space:]]+$//')
if [ -z "$TEAM" ] || [ "$TEAM" = "YOUR_TEAM_ID_HERE" ]; then
  echo "✗ $XCCONFIG 里 DEVELOPMENT_TEAM 未填写 —— 打开文件填上你的 Team ID"
  exit 1
fi
echo "▸ Team: $TEAM  (DEVELOPER_DIR: $DEVELOPER_DIR)"

# ── 设备：优先用 devicectl 的可用设备，xctrace 拿 UDID ──────────────────
xcodegen generate --spec project.yml

DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/available/ && /iPhone|iPad/ {print $3; exit}')
if [ -z "${DEVICE:-}" ]; then
  echo "✗ 没检测到已连接的 iPhone/iPad —— 先插上并解锁设备"
  exit 1
fi
UDID=$(xcrun xctrace list devices 2>/dev/null | grep -iv simulator | grep -iE "iphone|ipad" | grep -oE '[0-9A-Fa-f-]{20,}' | head -1)
if [ -z "${UDID:-}" ]; then
  echo "✗ 拿不到设备 UDID（$DEVICE）—— 试试用 Xcode 打开项目安装"
  exit 1
fi
echo "▸ Device: $DEVICE ($UDID)"

# ── 构建 + 安装 ─────────────────────────────────────────────────────────
DD=/tmp/qw-dd-dev
xcodebuild -project QuotaWatch.xcodeproj -scheme QuotaWatch \
  -destination "id=$UDID" -configuration Debug -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic -derivedDataPath "$DD" build

xcrun devicectl device install app --device "$DEVICE" \
  "$DD/Build/Products/Debug-iphoneos/QuotaWatch.app"

echo
echo "✓ 已安装到设备"
echo "  签名有效期约 1 年（付费账号）。之后 app 若提示“应用不可用”，"
echo "  插上 iPhone 重跑本脚本即可重新签名安装。"
