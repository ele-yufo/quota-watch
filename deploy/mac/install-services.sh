#!/usr/bin/env bash
#
# Install quota-watch background services as macOS launchd user agents so they
# start at login and restart on crash:
#
#   io.quotawatch.daemon  — polling daemon + HTTP API (:3737)   [always]
#   io.quotawatch.web     — Next.js dashboard (:3000)           [always]
#   io.quotawatch.frpc    — frp tunnel to your cloud server     [if frpc.toml]
#
# Idempotent: re-run any time (e.g. after adding ~/.quota-watch/frpc.toml).
#
#   NODE_BIN=/path/to/node ./install-services.sh    # override node (ABI must
#                                                     match better-sqlite3)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMPL_DIR="$REPO/deploy/mac"
LA_DIR="$HOME/Library/LaunchAgents"
DATA_DIR="$HOME/.quota-watch"
DOMAIN="gui/$(id -u)"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
FRPC_BIN="${FRPC_BIN:-$(command -v frpc || true)}"

WORKER="$REPO/packages/cli/dist/daemon-worker.js"
NEXT_BIN="$REPO/packages/web/node_modules/next/dist/bin/next"
WEB_DIR="$REPO/packages/web"

# ── preflight ────────────────────────────────────────────────────────────
[ -n "$NODE_BIN" ] || { echo "✗ node not found — set NODE_BIN=/path/to/node"; exit 1; }
[ -f "$WORKER" ]   || { echo "✗ daemon not built: $WORKER"; echo "  run: pnpm --filter @quota-watch/cli build"; exit 1; }
[ -f "$NEXT_BIN" ] || { echo "✗ next missing: $NEXT_BIN"; echo "  run: pnpm install && pnpm --filter @quota-watch/web build"; exit 1; }
if ! "$NODE_BIN" -e "require(require.resolve('better-sqlite3',{paths:['$REPO/packages/core']}))" 2>/dev/null; then
  echo "✗ $NODE_BIN cannot load better-sqlite3 (node ABI mismatch)."
  echo "  Use the node the module was built for: NODE_BIN=/path/to/node $0"
  exit 1
fi

mkdir -p "$LA_DIR" "$DATA_DIR"

# Fill a template's __PLACEHOLDERS__ and write the plist. Paths never contain
# '#', so it is a safe sed delimiter.
render() {
  sed -e "s#__NODE__#${NODE_BIN}#g" \
      -e "s#__FRPC__#${FRPC_BIN}#g" \
      -e "s#__WORKER__#${WORKER}#g" \
      -e "s#__NEXT_BIN__#${NEXT_BIN}#g" \
      -e "s#__WEB_DIR__#${WEB_DIR}#g" \
      -e "s#__DATA_DIR__#${DATA_DIR}#g" \
      "$1"
}

# Kill whatever currently LISTENs on a port (a manually-started service), so
# the launchd-managed instance can bind it. No-op if nothing is listening.
kill_port() {
  local port="$1" pids
  pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then echo "$pids" | xargs kill 2>/dev/null || true; sleep 1; fi
}

install_agent() {
  local label="$1" tmpl="$2"
  local plist="$LA_DIR/$label.plist"
  render "$tmpl" > "$plist"
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$plist"
  launchctl enable "$DOMAIN/$label"
  echo "✓ loaded $label"
}

echo "▸ repo:  $REPO"
echo "▸ node:  $NODE_BIN"

# ── daemon (:3737) ───────────────────────────────────────────────────────
launchctl bootout "$DOMAIN/io.quotawatch.daemon" 2>/dev/null || true
pkill -f 'dist/daemon-worker.js' 2>/dev/null || true
sleep 1
install_agent io.quotawatch.daemon "$TMPL_DIR/io.quotawatch.daemon.plist.tmpl"

# ── web (:3000) ──────────────────────────────────────────────────────────
launchctl bootout "$DOMAIN/io.quotawatch.web" 2>/dev/null || true
kill_port 3000
install_agent io.quotawatch.web "$TMPL_DIR/io.quotawatch.web.plist.tmpl"

# ── frpc (only if configured) ────────────────────────────────────────────
if [ -f "$DATA_DIR/frpc.toml" ]; then
  [ -n "$FRPC_BIN" ] || { echo "✗ frpc.toml present but frpc not installed (brew install frpc)"; exit 1; }
  install_agent io.quotawatch.frpc "$TMPL_DIR/io.quotawatch.frpc.plist.tmpl"
else
  echo "· skipping frpc — no $DATA_DIR/frpc.toml yet"
  echo "  (copy deploy/mac/frpc.toml.example there, fill it in, then re-run this)"
fi

# ── verify ───────────────────────────────────────────────────────────────
echo "▸ verifying…"
verify_http() {
  local url="$1" name="$2" i
  for i in $(seq 1 20); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then echo "✓ $name up ($url)"; return 0; fi
    sleep 0.5
  done
  echo "✗ $name not responding at $url — check logs under $DATA_DIR"; return 1
}
verify_http "http://127.0.0.1:3737/health" "daemon API" || true
verify_http "http://127.0.0.1:3000"        "web"        || true

echo
echo "Done. Manage with:"
echo "  launchctl kickstart -k $DOMAIN/io.quotawatch.daemon   # restart daemon"
echo "  launchctl bootout   $DOMAIN/io.quotawatch.web         # stop web"
echo "  logs: $DATA_DIR/{daemon,web,frpc}.log"
