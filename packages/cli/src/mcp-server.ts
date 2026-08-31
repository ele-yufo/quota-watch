/**
 * mcp-server.ts — `quota-watch mcp`: MCP server over stdio for agent harnesses.
 *
 * Lets a main agent (Claude Code, Codex, …) read quota state and burn
 * predictions before dispatching work: "which channel has headroom for this ticket?" is
 * the motivating question — see recommend_channel.
 *
 * Data comes straight from the daemon's SQLite DB, NOT the HTTPS API: the MCP server must still answer when the
 * daemon is down — staleness is signalled via snapshot timestamps, and the
 * caller can decide. WAL makes concurrent daemon/CLI/MCP access safe.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  QuotaDB,
  predictConsumption,
} from '@quota-watch/core';

const JSON_CONTENT = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

interface WindowView {
  windowName: string;
  windowKind: string;
  used: number;
  total: number;
  unit: string;
  remainingPct: number;
  resetAt: string | null;
  asOf: string;
  prediction: {
    ratePerHour: number;
    exhaustionAt: string | null;
    hoursRemaining: number;
    willExhaustBeforeReset: boolean;
  } | null;
}

function windowView(
  db: QuotaDB,
  providerId: string,
  w: {
    windowName: string;
    windowKind: string;
    used: number;
    total: number;
    unit: string;
    remainingPct: number;
    resetAt: string | null;
    timestamp: string;
  },
): WindowView {
  let prediction: WindowView['prediction'] = null;
  if (w.total > 0 && w.unit === 'percent') {
    const history = db.getSnapshots(
      providerId,
      w.windowName,
      new Date(Date.now() - 6 * 3600_000).toISOString(),
    );
    if (history.length >= 2) {
      const p = predictConsumption(history, w.used, w.total, w.resetAt);
      prediction = {
        ratePerHour: Math.round(p.ratePerHour * 100) / 100,
        exhaustionAt: p.exhaustionAt,
        hoursRemaining: Number.isFinite(p.hoursRemaining)
          ? Math.round(p.hoursRemaining * 10) / 10
          : Infinity,
        willExhaustBeforeReset: p.willExhaustBeforeReset,
      };
    }
  }
  return { ...w, asOf: w.timestamp, prediction };
}

export function createMcpServer(db: QuotaDB): McpServer {
  const server = new McpServer({
    name: 'quota-watch',
    version: '0.1.0',
  });

  server.registerTool(
    'get_quota_overview',
    {
      description:
        'All configured AI channels with current quota windows, remaining %, reset times, ' +
        'and burn predictions. `asOf` is when the daemon last polled that window — check it ' +
        'before trusting the numbers.',
      inputSchema: {},
    },
    async () => {
      const providers = db.listProviders().filter((p) => p.enabled);
      const snapshots = db.getLatestSnapshots();
      const out = providers.map((p) => ({
        providerId: p.id,
        displayName: p.displayName,
        providerType: p.provider,
        lastPoll: db.getPollState(p.id),
        windows: snapshots
          .filter((s) => s.providerId === p.id)
          .map((w) => windowView(db, p.id, w)),
      }));
      return JSON_CONTENT(out);
    },
  );

  server.registerTool(
    'recommend_channel',
    {
      description:
        'Rank channels by dispatch headroom for a new task. Score = session-window ' +
        'remaining% (window reset imminent penalized), tie-broken by weekly remaining%. ' +
        'Channels with no data or expired auth are excluded. Returns the ranking with ' +
        'reasons — the final call stays with you.',
      inputSchema: {
        min_remaining_pct: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('drop channels below this session remaining% (default 10)'),
        prefer: z
          .string()
          .optional()
          .describe('substring matched against provider id/type, e.g. "claude" — preferred channels rank first when they clear the floor'),
      },
    },
    async ({ min_remaining_pct, prefer }) => {
      const floor = min_remaining_pct ?? 10;
      const providers = db.listProviders().filter((p) => p.enabled);
      const snapshots = db.getLatestSnapshots();

      const ranked = providers.map((p) => {
        const windows = snapshots.filter((s) => s.providerId === p.id);
        const session = windows.find((w) => w.windowKind === 'session');
        const week = windows.find((w) => w.windowKind === 'week');
        const anchor = session ?? week ?? null;

        const reasons: string[] = [];
        let score: number | null = null;
        // Freshness comes from provider_poll_state (every poll attempt), NOT
        // the snapshot timestamp — snapshots are change-only, so a quiet
        // channel's value timestamp can be hours old while polling is fine.
        const poll = db.getPollState(p.id);
        const pollAgeMs = poll ? Date.now() - new Date(poll.lastPollAt).getTime() : Infinity;
        if (!anchor) {
          reasons.push('no quota data yet (等待采集)');
        } else if (pollAgeMs > 10 * 60_000) {
          reasons.push(
            poll
              ? `daemon hasn't polled since ${poll.lastPollAt} — data untrustworthy`
              : 'never polled — daemon may be down',
          );
        } else if (poll?.lastStatus === 'error') {
          reasons.push(`last poll failed: ${poll.lastError ?? 'unknown'}`);
        } else {
          score = anchor.remainingPct;
          reasons.push(
            `${anchor.windowName} ${anchor.remainingPct.toFixed(0)}% remaining`,
          );
          if (anchor.resetAt) {
            const msLeft = new Date(anchor.resetAt).getTime() - Date.now();
            if (msLeft > 0 && msLeft < 3600_000) {
              score -= 10; // resetting within the hour — headroom replenishes soon
              reasons.push('resets within 1h (headroom replenishes soon)');
            }
          }
          if (week && session && week.remainingPct < session.remainingPct) {
            score -= (session.remainingPct - week.remainingPct) / 10;
            reasons.push(`weekly tighter at ${week.remainingPct.toFixed(0)}%`);
          }
          if (prefer && (p.id.includes(prefer) || p.provider.includes(prefer))) {
            score += 5;
            reasons.push(`matches prefer="${prefer}"`);
          }
          if (anchor.remainingPct < floor) {
            score = null;
            reasons.push(`below floor (${floor}%) — excluded`);
          }
        }

        return {
          providerId: p.id,
          displayName: p.displayName,
          providerType: p.provider,
          score,
          reasons,
        };
      });

      ranked.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
      return JSON_CONTENT({
        floor,
        recommendation: ranked.find((r) => r.score !== null)?.providerId ?? null,
        ranking: ranked,
      });
    },
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const db = new QuotaDB(); // default ~/.quota-watch/data.db

  const server = createMcpServer(db);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
