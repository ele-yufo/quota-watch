#!/usr/bin/env bash
#
# Remove the quota-watch launchd user agents (daemon, web, frpc). Stops the
# running services and deletes the plists so they no longer start at login.
# Leaves ~/.quota-watch (data.db, config.json, frpc.toml, logs) untouched.
set -euo pipefail

LA_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

for label in io.quotawatch.frpc io.quotawatch.web io.quotawatch.daemon; do
  if launchctl bootout "$DOMAIN/$label" 2>/dev/null; then
    echo "✓ stopped $label"
  else
    echo "· $label not loaded"
  fi
  rm -f "$LA_DIR/$label.plist" && echo "  removed $LA_DIR/$label.plist" || true
done

echo "Done. Data in ~/.quota-watch was left in place."
