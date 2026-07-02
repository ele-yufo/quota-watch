# Privacy Policy — quota·watch

_Last updated: 2026-07_

quota·watch is a local-first tool for monitoring your own AI subscription
quotas. It is designed so your data stays on your own devices.

## What we collect

**Nothing.** quota·watch has no servers, no accounts, no analytics, and no
telemetry. We do not collect, transmit, sell, or share any personal data.

## Where your data lives

- **Provider credentials** (API keys, OAuth tokens, or session cookies you
  connect) are stored **only on your own machine** — on the desktop in
  `~/.quota-watch/data.db` (readable only by your user account), and on iOS in
  the system Keychain / app storage. They are used **only** to call each
  provider's own quota API and are never sent anywhere else.
- **Quota snapshots** (usage percentages, reset times) are stored locally in
  SQLite and served over your own local network to your own devices.

## The iOS app

- **Local Network / arbitrary hosts**: the app connects to a quota-watch daemon
  running on a computer **you** control — over your local network, or over a
  tunnel/host **you** configure. It does not connect to any service operated by
  us.
- **Camera**: used solely to scan the pairing QR code you generate on your own
  machine (`quota-watch connect --qr`). No images are stored or transmitted.
- **Demo mode** uses built-in sample data and makes no network connections.

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
