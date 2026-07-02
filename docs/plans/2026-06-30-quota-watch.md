# quota-watch Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** A local-first AI subscription quota monitoring tool that tracks usage across 8 providers, predicts exhaustion, and alerts via macOS notifications + Discord webhooks.

**Architecture:** Monorepo with three packages: `core` (types, persistence, scheduler, providers), `cli` (terminal commands), `web` (Next.js dashboard). macOS menu bar is a native Swift app that reads from the same SQLite DB. All data stays local.

**Tech Stack:** TypeScript, Node.js 20+, Next.js 14, SQLite (better-sqlite3), Swift (menu bar), Vitest, Commander.js

---

## Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Pure monitoring, no proxy | User explicitly chose this |
| Tech stack | TypeScript full stack | Single language, fast iteration |
| Persistence | SQLite via better-sqlite3 | Local-first, no server needed |
| Polling | Smart: 5min active / 30min idle / accelerate on alert risk | Balance freshness vs rate limits |
| Alerting | macOS Notification Center + Discord Webhook | User's requirement |
| Providers (P0) | Claude, Codex, GLM-CN, OpenCode Go, Kimi, Antigravity | User's subscriptions |
| Providers (P1) | GitHub Copilot, Gemini CLI | Installed on machine |
| Menu bar | Native Swift (SwiftUI) | Best UX, matches CodeBurn approach |
| Web | Next.js with API routes | SSR + API in one project |

---

## Project Structure

```
quota-watch/
├── package.json              # monorepo root (pnpm workspaces)
├── pnpm-workspace.yaml
├── packages/
│   ├── core/                 # shared types, persistence, scheduler, providers
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── types.ts              # unified Quota model
│   │   │   ├── db.ts                 # SQLite persistence layer
│   │   │   ├── scheduler.ts          # smart polling orchestrator
│   │   │   ├── predictor.ts          # consumption rate + exhaustion ETA
│   │   │   ├── alerter.ts            # alert rule engine
│   │   │   └── providers/
│   │   │       ├── index.ts          # provider registry
│   │   │       ├── types.ts          # Provider interface
│   │   │       ├── claude.ts         # Claude Code OAuth
│   │   │       ├── codex.ts          # OpenAI Codex
│   │   │       ├── glm-cn.ts         # 智谱清言
│   │   │       ├── opencode-go.ts    # OpenCode Go
│   │   │       ├── kimi.ts           # Kimi
│   │   │       ├── antigravity.ts    # Antigravity
│   │   │       ├── copilot.ts        # GitHub Copilot (P1)
│   │   │       └── gemini.ts         # Gemini CLI (P1)
│   │   └── tests/
│   ├── cli/                  # CLI commands
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts              # commander entry
│   │   │   ├── commands/
│   │   │   │   ├── status.ts         # quick status
│   │   │   │   ├── dashboard.ts      # TUI dashboard
│   │   │   │   ├── config.ts         # provider config
│   │   │   │   ├── serve.ts          # start web server
│   │   │   │   └── daemon.ts         # background polling daemon
│   │   │   └── render.ts             # terminal rendering helpers
│   │   └── tests/
│   └── web/                  # Next.js dashboard
│       ├── package.json
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx          # main dashboard
│       │   │   ├── api/
│       │   │   │   ├── quota/route.ts    # GET current quotas
│       │   │   │   ├── history/route.ts  # GET historical data
│       │   │   │   └── alert/route.ts    # GET/POST alert rules
│       │   │   └── layout.tsx
│       │   ├── components/
│       │   │   ├── QuotaCard.tsx
│       │   │   ├── QuotaBar.tsx
│       │   │   ├── TrendChart.tsx
│       │   │   ├── AlertPanel.tsx
│       │   │   └── ProviderGrid.tsx
│       │   └── lib/
│       │       └── db.ts             # server-side DB access
│       └── tests/
├── mac/                      # Swift menu bar app
│   ├── Package.swift
│   └── Sources/
│       └── QuotaWatchMenubar/
│           ├── QuotaWatchApp.swift
│           ├── MenuBarView.swift
│           ├── QuotaStore.swift       # reads SQLite
│           └── Notifier.swift         # macOS notifications
├── docs/
│   └── plans/
│       └── 2026-06-30-quota-watch.md  # this file
└── README.md
```

---

## Unified Quota Model

This is the most critical design decision. Every provider maps to this:

```typescript
// packages/core/src/types.ts

interface QuotaWindow {
  name: string;              // e.g. "session (5h)", "weekly (7d)", "balance"
  used: number;              // absolute units (tokens, credits, percentage, USD)
  total: number;             // total allocation
  unit: string;              // "tokens" | "credits" | "percent" | "usd" | "requests"
  remaining: number;         // total - used
  remainingPct: number;      // 0-100
  resetAt: string | null;    // ISO 8601 or null if unknown
  unlimited: boolean;        // true if no cap
}

interface ProviderQuota {
  provider: string;          // "claude" | "codex" | "glm-cn" | ...
  account: string;           // account identifier (email, org, alias)
  plan: string;              // "Max" | "Business" | "Coding Plan" | ...
  status: "ok" | "error" | "not_configured" | "auth_expired";
  windows: QuotaWindow[];    // 0-N quota windows
  fetchedAt: string;         // ISO 8601 of when this was fetched
  error?: string;            // error message if status is "error"
}

interface AlertRule {
  id: string;
  provider: string;
  windowName: string;        // match against QuotaWindow.name
  thresholdPct: number;      // 0-100, alert when remainingPct < this
  channels: ("macos_notification" | "discord_webhook")[];
  cooldownMs: number;        // don't re-alert within this window
  enabled: boolean;
}

interface UsageSnapshot {
  timestamp: string;         // ISO 8601
  provider: string;
  account: string;
  windowName: string;
  used: number;
  total: number;
  unit: string;
}
```

---

## Provider Interface

```typescript
// packages/core/src/providers/types.ts

interface ProviderConfig {
  id: string;                // unique instance id
  provider: string;          // "claude", "codex", etc.
  displayName: string;       // human-readable label
  credentials: Record<string, string>;  // token, apiKey, etc.
}

interface ProviderAdapter {
  readonly id: string;       // "claude", "codex", etc.
  readonly displayName: string;

  /**
   * Fetch current quota from the provider's API.
   * Must handle its own errors gracefully — never throw to caller.
   */
  fetchQuota(config: ProviderConfig): Promise<ProviderQuota>;

  /**
   * Validate that credentials are still valid.
   * Returns true if usable, false if expired/invalid.
   */
  validateCredentials?(config: ProviderConfig): Promise<boolean>;
}
```

---

## Implementation Tasks

### Phase 1: Foundation (Tasks 1-8)

### Task 1: Monorepo Scaffold

**Objective:** Set up pnpm workspaces, TypeScript config, and build tooling.

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `.gitignore`

**Steps:**
1. Create root package.json with pnpm workspaces
2. Create pnpm-workspace.yaml pointing to packages/*
3. Create shared tsconfig.base.json
4. Create each package with proper dependencies
5. Run `pnpm install`
6. Verify `pnpm -r build` works (with empty src)

**Commit:** `feat: scaffold monorepo with pnpm workspaces`

---

### Task 2: Unified Types

**Objective:** Define the core data model that all providers and consumers share.

**Files:**
- Create: `packages/core/src/types.ts`

**Steps:**
1. Write QuotaWindow, ProviderQuota, AlertRule, UsageSnapshot interfaces
2. Write provider credential types
3. Write test: verify type compatibility with sample data from 9Router's claude.js output
4. Commit: `feat(core): define unified quota data model`

---

### Task 3: SQLite Schema + Persistence

**Objective:** Create the database layer for storing quota snapshots, alert history, and provider configs.

**Files:**
- Create: `packages/core/src/db.ts`
- Create: `packages/core/tests/db.test.ts`

**Schema:**
```sql
-- Provider configurations (credentials stored here)
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  credentials TEXT NOT NULL,  -- JSON, encrypted at rest
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Quota snapshots (append-only time series)
CREATE TABLE quota_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  window_name TEXT NOT NULL,
  used REAL NOT NULL,
  total REAL NOT NULL,
  unit TEXT NOT NULL,
  remaining_pct REAL NOT NULL,
  reset_at TEXT,
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

-- Alert rules
CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  window_name TEXT NOT NULL,
  threshold_pct REAL NOT NULL,
  channels TEXT NOT NULL,  -- JSON array
  cooldown_ms INTEGER NOT NULL DEFAULT 3600000,
  enabled INTEGER DEFAULT 1,
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

-- Alert history (dedup + cooldown tracking)
CREATE TABLE alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  window_name TEXT NOT NULL,
  remaining_pct REAL NOT NULL,
  message TEXT NOT NULL,
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
);

CREATE INDEX idx_snapshots_ts ON quota_snapshots(timestamp);
CREATE INDEX idx_snapshots_provider ON quota_snapshots(provider_id, window_name, timestamp);
CREATE INDEX idx_alerts_rule ON alert_history(rule_id, fired_at);
```

**Steps:**
1. Write tests for CRUD operations on each table
2. Implement Database class with better-sqlite3
3. Implement upsert provider, insert snapshot, query history
4. Implement alert cooldown check (last alert within cooldown window)
5. Commit: `feat(core): SQLite persistence layer`

---

### Task 4: Provider Registry

**Objective:** Create the plugin registry that discovers and manages provider adapters.

**Files:**
- Create: `packages/core/src/providers/types.ts`
- Create: `packages/core/src/providers/index.ts`
- Create: `packages/core/tests/registry.test.ts`

**Steps:**
1. Write ProviderAdapter interface
2. Write ProviderRegistry class with register/get/list methods
3. Write test: register mock provider, fetch quota
4. Commit: `feat(core): provider adapter registry`

---

### Task 5: Claude Provider

**Objective:** Implement Claude Code quota fetching (OAuth usage API).

**Files:**
- Create: `packages/core/src/providers/claude.ts`
- Create: `packages/core/tests/providers/claude.test.ts`

**Reference:** 9Router's `open-sse/services/usage/claude.js` — OAuth endpoint with 429 cooldown + legacy fallback.

**Key details:**
- OAuth endpoint: `GET https://api.anthropic.com/api/oauth/usage`
- Headers: `anthropic-beta: oauth-2025-04-20`
- Returns: `five_hour.utilization`, `seven_day.utilization`, `seven_day_sonnet`, etc.
- utilization = % USED (87 means 87% used, 13% remaining)
- 429 cooldown: 3 minutes per token

**Improvement over 9Router:**
- Exponential backoff instead of fixed 3min cooldown
- Persist cooldown state in SQLite (survives restart)
- Support multiple accounts

**Steps:**
1. Write test with mock Anthropic API responses
2. Implement OAuth usage fetch with proper error handling
3. Implement legacy fallback path
4. Map to unified QuotaWindow model
5. Commit: `feat(core): Claude Code quota provider`

---

### Task 6: Codex Provider

**Objective:** Implement OpenAI Codex quota fetching.

**Files:**
- Create: `packages/core/src/providers/codex.ts`
- Create: `packages/core/tests/providers/codex.test.ts`

**Reference:** 9Router's `open-sse/services/usage/codex.js` — session + weekly windows, review rate limits, reset credits.

**Key details:**
- Endpoint: `GET chatgpt.com/backend-api/wham/usage` (Bearer token from `~/.codex/auth.json`)
- Returns: `rate_limit.primary_window`, `rate_limit.secondary_window`
- Also: `code_review_rate_limit`, `rate_limit_reset_credits`

**Steps:**
1. Write test with mock OpenAI API responses
2. Implement usage fetch from auth.json credentials
3. Parse primary (5h) + secondary (7d) + review windows
4. Map to unified model
5. Commit: `feat(core): Codex quota provider`

---

### Task 7: GLM-CN Provider

**Objective:** Implement 智谱清言 Coding Plan quota fetching.

**Files:**
- Create: `packages/core/src/providers/glm-cn.ts`
- Create: `packages/core/tests/providers/glm-cn.test.ts`

**Reference:** 9Router's `open-sse/services/usage/misc.js` — GLM quota API with region-aware endpoints.

**Key details:**
- China endpoint from registry: `glm-cn.js` usage URL
- Auth: Bearer API key
- Returns: `data.limits[]` with `type: "TOKENS_LIMIT"`, `percentage`, `nextResetTime`

**Steps:**
1. Write test with mock GLM API responses
2. Implement quota fetch with region detection
3. Map percentage-based limits to unified model
4. Commit: `feat(core): GLM-CN quota provider`

---

### Task 8: OpenCode Go + Kimi + Antigravity Providers

**Objective:** Implement remaining P0 providers.

**Files:**
- Create: `packages/core/src/providers/opencode-go.ts`
- Create: `packages/core/src/providers/kimi.ts`
- Create: `packages/core/src/providers/antigravity.ts`
- Create: `packages/core/tests/providers/opencode-go.test.ts`
- Create: `packages/core/tests/providers/kimi.test.ts`
- Create: `packages/core/tests/providers/antigravity.test.ts`

**Reference:** 9Router's `google.js` (Antigravity), registry files for endpoints.

**Steps:**
1. Research each provider's quota API (from 9Router registry + docs)
2. Implement each adapter following the same pattern
3. Map to unified model
4. Commit: `feat(core): OpenCode Go, Kimi, Antigravity providers`

---

### Phase 2: Intelligence (Tasks 9-12)

### Task 9: Consumption Rate Predictor

**Objective:** Calculate consumption rate and predict exhaustion time.

**Files:**
- Create: `packages/core/src/predictor.ts`
- Create: `packages/core/tests/predictor.test.ts`

**Logic:**
```typescript
interface Prediction {
  ratePerHour: number;         // units consumed per hour
  exhaustionAt: string | null; // ISO 8601, null if rate=0 or unlimited
  hoursRemaining: number;      // hours until exhaustion at current rate
  willExhaustBeforeReset: boolean;
  pace: number;                // % of window elapsed vs % consumed (like aiquota)
}
```

- Read last N snapshots from SQLite (default: 7 days)
- Calculate linear regression on used vs time
- Project forward to exhaustion
- Compare with resetAt to predict "will you run out before reset"
- Pace metric: if 30% of window elapsed but only 10% consumed → pace=33% (underusing)

**Steps:**
1. Write test with synthetic time series data
2. Implement rate calculation
3. Implement exhaustion prediction
4. Implement pace metric
5. Commit: `feat(core): consumption rate predictor`

---

### Task 10: Smart Scheduler

**Objective:** Orchestrate polling with adaptive frequency.

**Files:**
- Create: `packages/core/src/scheduler.ts`
- Create: `packages/core/tests/scheduler.test.ts`

**Logic:**
- Base interval: 15 minutes
- Active mode (5min): when a provider returned non-zero usage change since last poll
- Idle mode (30min): when no usage change for 3 consecutive polls
- Alert-accelerate: when a quota window is below alert threshold, poll every 2 minutes
- Per-provider intervals (each provider has independent schedule)
- Persist scheduler state in SQLite

**Steps:**
1. Write test with mock time advancement
2. Implement adaptive interval calculator
3. Implement scheduler loop with graceful shutdown
4. Commit: `feat(core): smart polling scheduler`

---

### Task 11: Alert Engine

**Objective:** Evaluate alert rules and fire notifications.

**Files:**
- Create: `packages/core/src/alerter.ts`
- Create: `packages/core/tests/alerter.test.ts`

**Logic:**
- After each poll, evaluate all enabled alert rules
- Check: `window.remainingPct < rule.thresholdPct`
- Check cooldown: don't re-fire if last alert for this rule was within `cooldownMs`
- Dispatch to channels: macOS notification, Discord webhook
- Record in alert_history table

**Steps:**
1. Write test with mock notification channels
2. Implement rule evaluation
3. Implement cooldown check
4. Implement Discord webhook sender (HTTP POST to webhook URL)
5. Implement macOS notification sender (osascript or node-notifier)
6. Commit: `feat(core): alert rule engine`

---

### Task 12: P1 Providers (Copilot + Gemini)

**Objective:** Add GitHub Copilot and Gemini CLI providers.

**Files:**
- Create: `packages/core/src/providers/copilot.ts`
- Create: `packages/core/src/providers/gemini.ts`

**Reference:** 9Router's `github.js` and `google.js`.

**Steps:**
1. Implement Copilot (quota_snapshots API)
2. Implement Gemini (Cloud Code Assist quota API)
3. Tests
4. Commit: `feat(core): Copilot + Gemini CLI providers`

---

### Phase 3: CLI (Tasks 13-16)

### Task 13: CLI Entry + Status Command

**Objective:** Create CLI framework and quick status command.

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/status.ts`
- Create: `packages/cli/src/render.ts`

**Commands:**
```bash
quota-watch status              # one-line per provider
quota-watch status --json       # machine-readable
quota-watch status claude       # single provider
```

**Steps:**
1. Set up Commander.js with global options
2. Implement status command reading from SQLite
3. Render colored output (similar to aiquota's style)
4. Commit: `feat(cli): status command`

---

### Task 14: CLI Config Command

**Objective:** Manage provider credentials interactively.

**Files:**
- Create: `packages/cli/src/commands/config.ts`

**Commands:**
```bash
quota-watch config add claude    # interactive OAuth or API key setup
quota-watch config list          # show configured providers
quota-watch config remove claude # remove a provider
quota-watch config test claude   # test connection
```

**Steps:**
1. Implement interactive prompts (inquirer.js or prompts)
2. Implement credential storage (encrypt at rest)
3. Implement connection test
4. Commit: `feat(cli): config command`

---

### Task 15: CLI Dashboard (TUI)

**Objective:** Interactive terminal dashboard with real-time updates.

**Files:**
- Create: `packages/cli/src/commands/dashboard.ts`

**Features:**
- Provider grid with colored bars
- Pace indicators (🔵🟢🟡🔴)
- Exhaustion ETA
- Auto-refresh every 30s
- Arrow keys to switch between providers

**Steps:**
1. Implement TUI with ink (React for CLI) or blessed
2. Render quota bars with pace indicators
3. Implement auto-refresh from SQLite
4. Commit: `feat(cli): interactive TUI dashboard`

---

### Task 16: CLI Daemon + Serve

**Objective:** Background polling daemon and web server launcher.

**Files:**
- Create: `packages/cli/src/commands/daemon.ts`
- Create: `packages/cli/src/commands/serve.ts`

**Commands:**
```bash
quota-watch daemon start        # start background polling
quota-watch daemon stop         # stop
quota-watch daemon status       # check if running
quota-watch serve               # start web dashboard on :3737
quota-watch serve --port 8080   # custom port
```

**Steps:**
1. Implement daemon with PID file
2. Implement serve command (spawn Next.js)
3. Commit: `feat(cli): daemon + web server launcher`

---

### Phase 4: Web Dashboard (Tasks 17-20)

### Task 17: Next.js Scaffold + Quota API

**Objective:** Set up Next.js app with API routes for quota data.

**Files:**
- Create: `packages/web/` (Next.js app)
- Create: `packages/web/src/app/api/quota/route.ts`
- Create: `packages/web/src/app/api/history/route.ts`

**Steps:**
1. Create Next.js app with App Router
2. Implement API route: GET /api/quota (current state from SQLite)
3. Implement API route: GET /api/history?provider=claude&days=7
4. Commit: `feat(web): Next.js scaffold + quota API routes`

---

### Task 18: Dashboard Page

**Objective:** Main dashboard UI showing all providers.

**Files:**
- Create: `packages/web/src/app/page.tsx`
- Create: `packages/web/src/components/QuotaCard.tsx`
- Create: `packages/web/src/components/QuotaBar.tsx`
- Create: `packages/web/src/components/ProviderGrid.tsx`

**Design:**
- Card per provider with colored progress bars
- Pace indicators matching CLI style
- Exhaustion ETA displayed prominently
- Responsive grid layout

**Steps:**
1. Implement QuotaBar component (progress bar + pace color)
2. Implement QuotaCard (provider name, plan, windows)
3. Implement ProviderGrid (grid of cards)
4. Implement main page with auto-refresh (SWR or polling)
5. Commit: `feat(web): main dashboard page`

---

### Task 19: Trend Chart + Alert Panel

**Objective:** Historical trend visualization and alert rule management.

**Files:**
- Create: `packages/web/src/components/TrendChart.tsx`
- Create: `packages/web/src/components/AlertPanel.tsx`
- Create: `packages/web/src/app/api/alert/route.ts`

**Steps:**
1. Implement trend chart (recharts or chart.js) showing usage over time
2. Implement alert rule CRUD UI
3. Implement alert history display
4. Commit: `feat(web): trend charts + alert management`

---

### Task 20: Discord Webhook Integration

**Objective:** Send alert notifications to Discord via webhook.

**Files:**
- Create: `packages/core/src/notifiers/discord.ts`
- Create: `packages/core/tests/notifiers/discord.test.ts`

**Format:**
```json
{
  "embeds": [{
    "title": "⚠️ Quota Alert: Claude Max",
    "description": "Session (5h) at 12% remaining",
    "color": 16711680,
    "fields": [
      {"name": "Used", "value": "88%", "inline": true},
      {"name": "Resets in", "value": "2h 15m", "inline": true},
      {"name": "Rate", "value": "~18%/hour", "inline": true}
    ],
    "footer": {"text": "quota-watch"}
  }]
}
```

**Steps:**
1. Implement Discord webhook sender with embed formatting
2. Implement rate limiting (don't spam)
3. Test with real webhook
4. Commit: `feat: Discord webhook alerting`

---

### Phase 5: macOS Menu Bar (Tasks 21-23)

### Task 21: Swift Menu Bar App Scaffold

**Objective:** Create native macOS menu bar app that reads SQLite.

**Files:**
- Create: `mac/Package.swift`
- Create: `mac/Sources/QuotaWatchMenubar/QuotaWatchApp.swift`
- Create: `mac/Sources/QuotaWatchMenubar/QuotaStore.swift`

**Steps:**
1. Create SwiftUI menu bar app
2. Implement SQLite reader (reads same DB as CLI/Web)
3. Display quota summary in menu bar
4. Commit: `feat(mac): menu bar app scaffold`

---

### Task 22: Menu Bar Quota Display

**Objective:** Show per-provider quota with colored indicators.

**Files:**
- Create: `mac/Sources/QuotaWatchMenubar/MenuBarView.swift`

**Steps:**
1. Implement popover with provider list
2. Color-coded progress bars (green/yellow/red)
3. Exhaustion ETA display
4. Auto-refresh every 30s
5. Commit: `feat(mac): quota display in menu bar`

---

### Task 23: macOS Notifications

**Objective:** Send native macOS notifications for alerts.

**Files:**
- Create: `mac/Sources/QuotaWatchMenubar/Notifier.swift`

**Steps:**
1. Implement UNUserNotificationCenter integration
2. Monitor SQLite alert_history table for new entries
3. Display notification with provider name, quota level, ETA
4. Commit: `feat(mac): native macOS notifications`

---

### Phase 6: Polish (Tasks 24-26)

### Task 24: README + Documentation

**Objective:** Write comprehensive README with install instructions, screenshots, and provider setup guides.

**Files:**
- Create: `README.md`
- Create: `docs/providers/*.md` (per-provider setup guide)

**Steps:**
1. Write README with feature overview, install, quick start
2. Write per-provider credential setup guide
3. Add screenshots
4. Commit: `docs: README + provider guides`

---

### Task 25: npm Package Publishing

**Objective:** Make the CLI installable via npx.

**Files:**
- Modify: `packages/cli/package.json` (add bin field)

**Steps:**
1. Add bin entry: `"quota-watch": "./dist/index.js"`
2. Test: `npx quota-watch status`
3. Commit: `chore: npm package setup`

---

### Task 26: Homebrew Formula

**Objective:** Make installable via brew.

**Steps:**
1. Create tap repo or formula
2. Test: `brew install quota-watch`
3. Commit: `chore: homebrew formula`

---

## Verification

After all tasks, verify:
1. `quota-watch status` shows all 6 P0 providers with real data
2. Web dashboard at localhost:3737 shows same data
3. macOS menu bar shows quota with colors
4. Discord webhook fires when quota drops below threshold
5. Predictor shows accurate exhaustion ETA
6. Scheduler adapts frequency based on usage patterns
