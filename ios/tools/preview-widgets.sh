#!/usr/bin/env bash
# Offline widget layout check — renders the real widget views at exact widget
# sizes with the real brand fonts + a red bounds border, so clipping/overflow is
# visible without a device. RUN THIS before shipping any widget layout change.
#
#   ios/tools/preview-widgets.sh   # writes + opens /tmp/qw-widget-{medium,small}.png
set -euo pipefail
cd "$(dirname "$0")/.."   # → ios/

SDK="$(xcrun --sdk macosx --show-sdk-path)"
export QW_FONTS_DIR="$PWD/QuotaWatch/Fonts"
OUT=/tmp/qw-widget-preview
mkdir -p "$OUT"

swiftc -sdk "$SDK" -target arm64-apple-macos14.0 \
  QuotaWatch/Theme.swift QuotaWatch/Models.swift QuotaWatch/Formatting.swift \
  QuotaWatch/ProviderStyle.swift QuotaWatch/DemoData.swift QuotaWatch/SharedStore.swift \
  QuotaWatch/APIClient.swift \
  QuotaWatchWidgets/QuotaTimeline.swift QuotaWatchWidgets/SelectProviderIntent.swift \
  QuotaWatchWidgets/QuotaWidgetViews.swift \
  tools/preview-widget.swift \
  -framework SwiftUI -framework WidgetKit -framework AppIntents -framework CoreText \
  -o "$OUT/preview-widget"

"$OUT/preview-widget"
echo "▸ inspect the red border — any content touching/crossing it is clipped on device"
open /tmp/qw-widget-medium.png /tmp/qw-widget-small.png 2>/dev/null || true
