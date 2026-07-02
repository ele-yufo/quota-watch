<div align="center">

# quota·watch

**Local-first quota monitoring for your AI coding subscriptions.**

See how much of each plan you've burned — and how long until it resets — across
Claude Code, Codex, GLM, OpenCode Go, Kimi, Antigravity and more.
On your desktop, in your menu bar, and on your iPhone.
No cloud, no telemetry — your tokens never leave your machine.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-Web%20·%20iOS%20·%20macOS%20·%20CLI-lightgrey)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)

<img src="docs/screenshots/web-terminal.png" width="820" alt="quota-watch web dashboard — terminal theme" />

</div>

---

## Why

If you juggle several AI coding subscriptions, you know the moment: mid-flow, a
plan silently caps out and everything stalls. **quota-watch** polls each
provider's real quota API in near-realtime, normalizes them into one model, and
shows you — everywhere you look — exactly how much is left and when it resets.

## Highlights

- 🛰 **8 providers, natively integrated** — Claude Code, Codex, GLM, OpenCode Go, Kimi, Antigravity, GitHub Copilot, Gemini CLI. Direct HTTP clients; no shelling out to community tools.
- ⚡ **Near-realtime** — ~10 s when usage is moving, backing off when idle. GLM tips over its cap and you see it in seconds, not half an hour.
- 🧭 **One unified model** — every quota window carries a *kind* (session · day · week · month), so `5h`, `7d` and `1mo` always read the same order across every surface.
- 🎨 **Five web dashboards, five layouts** — not recolours. Each theme is its own composition, visualization and motion (see below).
- 📱 **iOS app** — a dark instrument UI with real provider logos and ring gauges; connects to your Mac over the LAN or a tunnel, pairs by QR.
- 🖥 **macOS menu bar** — the worst window's % in the bar, a per-provider popover on click.
- 🔒 **Local-first & private** — SQLite on your machine; credentials are used only to call each provider's own API and are never uploaded anywhere.

## The web dashboard — one product, five personalities

Every theme is a *different dashboard*, not a swapped palette. Switch live from the
control dock (top-right, always in the same place).

<table>
  <tr>
    <td width="50%"><b>Magazine</b> — editorial broadsheet<br/><img src="docs/screenshots/web-magazine.png" alt="Magazine theme" /></td>
    <td width="50%"><b>Terminal</b> — btop-style CLI, ASCII gauges, CRT scanlines<br/><img src="docs/screenshots/web-terminal.png" alt="Terminal theme" /></td>
  </tr>
  <tr>
    <td width="50%"><b>OLED</b> — pure black, giant figures<br/><img src="docs/screenshots/web-oled.png" alt="OLED theme" /></td>
    <td width="50%"><b>Swiss</b> — International Typographic grid<br/><img src="docs/screenshots/web-swiss.png" alt="Swiss theme" /></td>
  </tr>
  <tr>
    <td colspan="2"><b>Blueprint</b> — a technical drawing sheet with SVG gauge instruments<br/><img src="docs/screenshots/web-blueprint.png" width="60%" alt="Blueprint theme" /></td>
  </tr>
</table>

## The iOS app

<img src="docs/screenshots/ios-main.png" width="300" align="right" alt="quota-watch iOS app" />

- **Ring-gauge dials** per window, coloured by headroom, with brand logos for every provider.
- **QR pairing** — run `quota-watch connect --qr` on the Mac and scan; host / port / token fill in automatically.
- **LAN or public** — connects over your local network or a tunnel (Tailscale / Cloudflare); it warns before sending a token in the clear to a public host.
- **Dismissible alerts, haptics, live refresh** — the critical-window banner clears with a tap and only returns when something *new* goes critical.

SwiftUI, iOS 18+. See [`ios/README.md`](ios/README.md) to build it.

<br clear="all" />

## Quick start

```bash
pnpm install
pnpm build

# 1. connect providers (web setup page — supports credential auto-detect):
cd packages/web && npx next start -p 3000   # open http://localhost:3000/setup
#    ...or from the CLI:
node packages/cli/dist/index.js config add claude

# 2. start the polling daemon (embedded API on 127.0.0.1:3737)
node packages/cli/dist/index.js daemon start

# 3. watch
open http://localhost:3000
```

## Commands

| Command | Description |
|---|---|
| `quota-watch status [--json]` | Quick quota overview |
| `quota-watch dashboard` | Interactive TUI |
| `quota-watch config add/list/test/remove <provider>` | Manage providers |
| `quota-watch daemon start [--lan]` | Background polling + API (`--lan` binds `0.0.0.0` with token auth, for iOS) |
| `quota-watch connect [--qr] [--host <addr>]` | Pair the iOS app (QR / manual; `--host` for a public address) |

## Supported providers

| Provider | Windows | Credentials |
|---|---|---|
| Claude Code | 5h session, 7d weekly (+sonnet) | reuses `~/.claude/.credentials.json`, auto-refresh |
| Codex | 5h session, 7d weekly | reuses `~/.codex/auth.json`, auto-refresh |
| GLM-CN | 5h session, 7d weekly | Coding Plan API key |
| OpenCode Go | 5h session, 7d weekly, 1mo monthly | opencode.ai `auth` cookie + workspace id |
| Kimi | 5h session, 7d weekly | Kimi Code API key |
| Antigravity | 5h Gemini pool, 5h Claude+GPT pool | reuses the `antigravity-usage` CLI token store |
| GitHub Copilot | monthly allowances | GitHub token (P2) |
| Gemini CLI | daily per-model buckets | Google OAuth token (P2) |

OpenCode Go window semantics (server-defined): 5h is a true rolling window;
**weekly resets Monday 00:00 UTC**; **monthly resets on your billing-cycle
timestamp**, not the calendar month.

## Architecture

```
quota-watch/
├── packages/core/    unified quota model (window kinds) + providers + scheduler
│                     + alerter + daemon HTTP API + CLI-credential reuse/refresh
├── packages/cli/     status · config · dashboard · daemon · connect (QR pairing)
├── packages/web/     Next.js dashboard — 5 per-theme layouts, :3000
├── ios/              SwiftUI app — connects to the daemon over LAN / tunnel
└── mac/              macOS menu bar (reads the same SQLite)
```

The daemon is the hub: it polls providers, persists snapshots to SQLite, and serves
one HTTP API (`/health`, `/quota`, `/poll`). Web, menu bar and iOS are all views of it.

## Configuration

`~/.quota-watch/config.json` (created on demand):

```json
{
  "poll": { "fastMs": 10000, "baseMs": 15000, "idleMs": 60000 },
  "api":  { "host": "127.0.0.1", "port": 3737, "token": null }
}
```

The daemon API needs no auth for loopback clients; non-loopback (LAN/public) clients
must send `Authorization: Bearer <api.token>`, auto-generated by `daemon start --lan`.

## Privacy

- **Claude / Codex / Antigravity** reuse the tokens their official CLIs already
  stored on disk — nothing to paste, refreshed in place.
- Credentials you provide (GLM / Kimi / OpenCode Go) are written only to
  `~/.quota-watch/data.db` (mode 600).
- Credentials stay local, are used only to call each provider's own quota API,
  and are never uploaded. The web UI only ever receives credential field *names*.

## License

[MIT](LICENSE)
