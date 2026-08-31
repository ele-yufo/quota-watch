# Privacy Policy — quota·watch

_Last updated: 2026-09_

quota·watch is a local-first tool for monitoring your own AI subscription
quotas. It is designed so your data stays on your own machines.

## What we collect

**Nothing.** quota·watch has no servers, no accounts, no analytics, and no
telemetry. We do not collect, transmit, sell, or share any personal data.

## Where your data lives

- **Provider credentials** (API keys, OAuth tokens, or session cookies you
  connect) are stored **only on your own machine** in
  `~/.quota-watch/data.db` (readable only by your user account). They are used
  **only** to call each provider's own quota API and are never sent anywhere
  else.
- **Quota snapshots** (usage percentages, reset times) are stored locally in
  SQLite and served by the local daemon to the web dashboard and to MCP
  clients you configure. If you set up a public tunnel yourself, access is
  still gated by the daemon's Bearer token.

## Third parties

quota·watch talks directly to the quota APIs of the providers **you** choose to
connect (e.g. Anthropic, OpenAI, Zhipu, Moonshot, Google). Those requests go
from your machine to the provider; they are subject to that provider's own
privacy policy. quota·watch is not affiliated with, endorsed by, or operated by
any of these providers.

## Changes

If this policy changes, the updated version will be published in this
repository.

## Contact

Questions: open an issue at
<https://github.com/ele-yufo/quota-watch/issues>.
