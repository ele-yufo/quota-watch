# quota-watch

> AI subscription quota monitoring — track usage, predict exhaustion, get alerts.

## Features
- **8 Providers**: Claude Code, Codex, GLM-CN, OpenCode Go, Kimi, Antigravity, GitHub Copilot, Gemini CLI
- **Near-realtime polling**: ~10s when usage is moving, 60s when idle (per-provider floors protect heavy upstreams)
- **Native integrations**: every provider is a direct HTTP client — no shelling out to community CLIs
- **Unified window model**: every quota window carries a `kind` (session/day/week/month) — fixed display order everywhere
- **5 web themes**: Magazine (default), Terminal, OLED, Swiss, Blueprint — switch live, persisted per browser
- **Daemon HTTP API**: one machine-readable surface for web, menu bar, and the iOS app (LAN or public)
- **iOS app**: SwiftUI, QR-code pairing, haptics, connects over LAN or public network
- **macOS menu bar**: per-provider progress bars in a popover, worst-quota % in the bar
- **Multi-channel alerts**: macOS notifications + Discord webhooks
- **Local-first & private**: SQLite persistence, credentials never leave the machine, no cloud dependency

## Quick start (from source)
```bash
pnpm install
pnpm build

# 1. connect providers — either interactively:
node packages/cli/dist/index.js config add claude
#    ...or via the web setup page (recommended, supports credential auto-detect):
cd packages/web && npx next start -p 3000   # open http://localhost:3000/setup

# 2. start the polling daemon (embedded API on 127.0.0.1:3737)
node packages/cli/dist/index.js daemon start

# 3. watch
open http://localhost:3000
```

## Commands
| Command | Description |
|---|---|
| `quota-watch status` | Quick quota overview |
| `quota-watch status --json` | Machine-readable output |
| `quota-watch dashboard` | Interactive TUI (press q to quit) |
| `quota-watch config list` | Show configured providers |
| `quota-watch config add <provider>` | Add a provider |
| `quota-watch config test <provider>` | Test connection |
| `quota-watch config remove <provider>` | Remove a provider |
| `quota-watch daemon start` | Start background polling + API (127.0.0.1:3737) |
| `quota-watch daemon start --lan` | Same, but bind 0.0.0.0 with token auth (for iOS) |
| `quota-watch daemon stop` | Stop background polling |
| `quota-watch daemon status` | Check daemon status |
| `quota-watch connect` | Show host/port/token for pairing the iOS app |

## Supported providers
| Provider | Windows | Credentials |
|---|---|---|
| Claude Code | 5h session, 7d weekly (+sonnet) | reuses `~/.claude/.credentials.json`, auto-refresh |
| Codex | 5h session, 7d weekly | reuses `~/.codex/auth.json`, auto-refresh |
| GLM-CN | 5h session, 7d weekly | Coding Plan API key |
| OpenCode Go | 5h session, 7d weekly, 1mo monthly | `workspaceId` + opencode.ai `auth` cookie (auto-imports from `@slkiser/opencode-quota` config if present) |
| Kimi | 5h session, 7d weekly | Kimi Code API key |
| Antigravity | 5h Gemini pool, 5h Claude+GPT pool | reuses `antigravity-usage` CLI token store (`antigravity-usage login` once), auto-refresh via Google OAuth |
| GitHub Copilot | monthly chat/completions/premium | GitHub token (P2) |
| Gemini CLI | daily per-model buckets | Google OAuth token (P2) |

OpenCode Go window semantics (server-defined, we just trust `resetInSec`):
5h is a true rolling window; **weekly resets Monday 00:00 UTC** (ISO-week boundary);
**monthly resets on your subscription's billing-cycle timestamp**, not the calendar month.

## Window kinds
Every `QuotaWindow` carries `kind: session | day | week | month | balance | unknown`
(`packages/core/src/windows.ts`). UIs sort by kind so every provider reads the same
left-to-right: session → day → week → month. Stored in `quota_snapshots.window_kind`
(DB migration v2 backfills legacy rows).

## Polling cadence
Defaults (override in `~/.quota-watch/config.json` → `poll`):

| Tier | Interval | When |
|---|---|---|
| fast | 10s | usage changed since last poll, or a window is under an alert threshold |
| base | 15s | steady state |
| idle | 60s | 3+ consecutive unchanged polls |

Providers may declare `minPollIntervalMs` floors (OpenCode Go / Antigravity: 30s —
dashboard scrape / Google-internal API politeness). The web dashboard re-reads every 10s
and has a manual "↻ refresh" that forces an immediate poll through the daemon.

## Daemon API
The daemon embeds an HTTP API (default `127.0.0.1:3737`, configurable in
`~/.quota-watch/config.json` → `api`):

| Endpoint | Description |
|---|---|
| `GET /health` | daemon liveness, per-provider poll intervals |
| `GET /quota` | latest snapshot per provider×window, kind-sorted |
| `POST /poll[?provider=id]` | force an immediate poll |

Loopback requests need no auth. Non-loopback requests require
`Authorization: Bearer <api.token>` — the token is auto-generated when you run
`quota-watch daemon start --lan`.

## Configuration file
`~/.quota-watch/config.json` (created on demand, all fields optional):
```json
{
  "poll": { "fastMs": 10000, "baseMs": 15000, "idleMs": 60000 },
  "api": { "host": "127.0.0.1", "port": 3737, "token": null }
}
```

## Web dashboard
```bash
cd packages/web && npx next start -p 3000   # or `next dev` while developing
```
Open http://localhost:3000 — provider rows show up to 3 windows inline
(session/weekly/monthly), daemon status, manual refresh, an at-risk strip, and a
theme switcher (Magazine / Terminal / OLED / Swiss / Blueprint, top right).
First-run onboarding lives at `/setup`: a privacy/credentials disclosure,
per-provider "how it's sourced" hints, and credential auto-detect for Claude /
Codex / Antigravity / OpenCode Go.

## iOS app
```bash
# on the Mac
quota-watch daemon start --lan
quota-watch connect --qr     # prints a QR encoding host/port/token
# for public access: quota-watch connect --qr --host <public-ip-or-domain>

# then: generate + open the Xcode project (see ios/README.md), run on your iPhone,
# tap "扫码配对" to scan the QR (or enter host/port/token manually)
```
SwiftUI, iOS 17+. Reads `GET /quota` over the LAN or a public host and
auto-refreshes every 10s. Polished with haptics, numeric-roll transitions, and a
skeleton loading state. Public (non-RFC1918) hosts get a cleartext-token warning
recommending a tunnel (Tailscale / Cloudflare Tunnel) over a raw port-forward.
See `docs/ios/swiftui-polish-playbook.md` for the SwiftUI practices used.

## macOS menu bar
```bash
cd mac && swift build && .build/debug/QuotaWatchMenubar
```
The bar shows the worst window's used % (coloured by severity); the popover
groups windows per provider with kind badges, progress bars, reset countdowns,
and Refresh / Open web buttons.

## Privacy & credentials
- **Claude / Codex / Antigravity** reuse the tokens their official CLIs already
  stored on disk — nothing to paste, auto-refreshed in place.
- **GLM / Kimi / OpenCode Go** credentials you provide are written only to
  `~/.quota-watch/data.db` (mode 600).
- Credentials stay local, are used only to call each provider's own quota API,
  and are never uploaded anywhere. The web UI only ever receives credential
  field *names*, never values.

## Alerting
Configure alert rules in the web dashboard (click a provider row → alert rules), or
directly in `~/.quota-watch/data.db`. Channels: macOS native notifications, Discord
webhooks (`DISCORD_WEBHOOK_URL` env var for the daemon).

## Architecture
```
quota-watch/
├── packages/core/    types + windows(kind) + providers + scheduler + alerter
│                     + config + api-server (daemon HTTP API) + auth (CLI token reuse/refresh)
├── packages/cli/     CLI (status, config, dashboard, daemon, connect)
├── packages/web/     Web dashboard (Next.js, :3000)
├── ios/              iOS app (SwiftUI, connects to daemon API over LAN)
└── mac/              macOS menu bar (Swift, reads the same SQLite)
```

## License
MIT
