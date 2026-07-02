#!/usr/bin/env bash
# Build QuotaWatch.app — a proper macOS menu-bar app bundle (with Info.plist /
# bundle id, so notifications + activation policy work). Running the bare
# `.build/.../QuotaWatchMenubar` executable crashes because it has no bundle.
#
#   ./build-app.sh          # build + assemble ./QuotaWatch.app
#   ./build-app.sh --run    # ...and launch it
set -eo pipefail
cd "$(dirname "$0")"

CONFIG=release
BIN_NAME=QuotaWatchMenubar
APP=QuotaWatch.app

echo "▸ swift build ($CONFIG)…"
swift build -c "$CONFIG"
BIN="$(swift build -c "$CONFIG" --show-bin-path)/$BIN_NAME"

echo "▸ assembling $APP…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$BIN_NAME"

# quoted heredoc — no shell expansion; values are fixed
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key><string>io.quotawatch.menubar</string>
	<key>CFBundleName</key><string>quota-watch</string>
	<key>CFBundleDisplayName</key><string>quota-watch</string>
	<key>CFBundleExecutable</key><string>QuotaWatchMenubar</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>0.1.0</string>
	<key>CFBundleVersion</key><string>1</string>
	<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
	<key>LSMinimumSystemVersion</key><string>14.0</string>
	<key>LSUIElement</key><true/>
	<key>NSHumanReadableCopyright</key><string>MIT</string>
</dict>
</plist>
PLIST
printf 'APPL????' > "$APP/Contents/PkgInfo"

# ad-hoc sign so notification/permission APIs bind to a stable identity
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

echo "✓ built $(pwd)/$APP"
if [ "${1:-}" = "--run" ]; then
  # Kill any running instance and WAIT for it to actually exit. `open` matches
  # by bundle id: if an old instance is still alive it just re-activates that
  # stale process instead of launching the binary we just built — so a plain
  # `sleep 1` silently ships the old code. Poll until the process is gone.
  pkill -f "$BIN_NAME" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f "$BIN_NAME" >/dev/null 2>&1 || break
    sleep 0.5
  done
  open "$APP"
  echo "✓ launched — look for the quota-watch item in your menu bar (top-right)"
fi
