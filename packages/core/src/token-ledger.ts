/**
 * token-ledger.ts — absolute token consumption from CLI session logs.
 *
 * The quota windows providers report are percentages of an unpublished
 * budget; this module adds the missing absolute numbers by reading the
 * session files the CLIs already write to disk (the same approach as
 * codeburn, but incremental and into our own DB):
 *
 *   claude → ~/.claude/projects/**\/*.jsonl
 *     assistant lines carry message.usage {input, cache_creation,
 *     cache_read, output}; dedup by message id (a message can be rewritten
 *     mid-stream) with a file:offset fallback.
 *   codex  → ~/.codex/sessions/**\/rollout-*.jsonl
 *     token_count events carry last_token_usage (the per-turn delta, so no
 *     subtraction needed); dedup by file:offset.
 *
 * Both files are append-only → per-file byte offsets in ingest_state make
 * scans cheap; source_id UNIQUE covers crashes between insert and bookmark.
 *
 * Window budget estimation: the provider's own used% anchors the absolute
 * scale — estBudget = tokensConsumedInWindow / usedFraction. That is an
 * ESTIMATE (cache tokens likely don't count 1:1 against the real budget),
 * good enough for "大概还剩多少 token" and burn-rate pacing.
 */
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { QuotaDB } from './db.js';

export interface TokenEvent {
  sourceId: string;
  provider: string;
  timestamp: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

// ── Line parsers (pure, unit-tested) ────────────────────────────────────

/** Claude Code jsonl assistant line → event fields, or null if not billable. */
export function parseClaudeLine(
  line: string,
  fallbackSourceId: string,
): Omit<TokenEvent, 'provider'> | null {
  let d: unknown;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof d !== 'object' || d === null) return null;
  const rec = d as Record<string, unknown>;
  const message = rec.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage || typeof rec.timestamp !== 'string') return null;

  const num = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0);
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const cacheWrite = num(usage.cache_creation_input_tokens);
  const total = input + output + cacheRead + cacheWrite;
  if (total === 0) return null;

  // dedup on message id when present (a message can be rewritten mid-stream);
  // the positional fallback covers lines without one
  const msgId = message?.id;
  const sourceId = typeof msgId === 'string' && msgId ? `claude:${msgId}` : fallbackSourceId;

  return {
    sourceId,
    timestamp: rec.timestamp,
    model: typeof message?.model === 'string' ? message.model : null,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: total,
  };
}

/** Codex rollout jsonl token_count event → event fields (uses the per-turn delta). */
export function parseCodexLine(
  line: string,
  sourceId: string,
): Omit<TokenEvent, 'provider'> | null {
  let d: unknown;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof d !== 'object' || d === null) return null;
  const rec = d as Record<string, unknown>;
  if (rec.type !== 'event_msg' || typeof rec.timestamp !== 'string') return null;
  const payload = rec.payload as Record<string, unknown> | undefined;
  if (payload?.type !== 'token_count') return null;
  const info = payload.info as Record<string, unknown> | undefined;
  // Only the per-turn delta is usable. Falling back to total_token_usage (the
  // CUMULATIVE counter) would record the running total as a fresh delta on
  // every event — usage grows quadratically instead of linearly.
  const last = info?.last_token_usage as Record<string, unknown> | undefined;
  if (!last) return null;

  const num = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0);
  const input = num(last.input_tokens);
  const output = num(last.output_tokens);
  // cached_input_tokens is already inside input_tokens (OpenAI semantics)
  const total = input + output;
  if (total === 0) return null;

  return {
    sourceId,
    timestamp: rec.timestamp,
    model: null, // token_count events carry no model; session_meta has it but isn't worth the join
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: total,
  };
}

// ── File discovery ──────────────────────────────────────────────────────

/** Recursively collect *.jsonl under dir (depth-capped, symlink-free). */
export function collectJsonlFiles(dir: string, maxDepth = 5): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(d, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p, depth + 1);
        else if (name.endsWith('.jsonl') && st.isFile()) out.push(p);
      } catch {
        // vanished mid-scan — skip
      }
    }
  };
  walk(dir, 0);
  return out;
}

export function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

export function codexSessionsDir(): string {
  return join(homedir(), '.codex', 'sessions');
}

// ── Incremental scan ────────────────────────────────────────────────────

/** Per-file per-pass byte cap — see readTail. */
const MAX_SCAN_CHUNK = 8 * 1024 * 1024;

export interface ScanResult {
  filesSeen: number;
  eventsAdded: number;
  bytesRead: number;
}

/** Read the tail of file `path` from byte `offset`; returns lines + new offset. */
export function readTail(
  path: string,
  offset: number,
): { lines: string[]; newOffset: number } {
  const size = statSync(path).size;
  // truncated/rotated file → restart from the top
  const start = offset > size ? 0 : offset;
  // Bound one pass: a first-time scan of a 100MB session log must not become
  // a 100MB Buffer + giant split() array. The offset persists, so the next
  // scans chew through the backlog in chunks.
  const len = Math.min(size - start, MAX_SCAN_CHUNK);
  if (len <= 0) return { lines: [], newOffset: start };

  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    const text = buf.toString('utf-8');
    const lines = text.split('\n');
    // A partial last line (writer mid-append OR chunk boundary) would fail
    // JSON.parse and be lost with a naive offset — walk the offset back.
    let newOffset = start + len;
    if (!text.endsWith('\n')) {
      const partial = lines.pop()!;
      newOffset -= Buffer.byteLength(partial);
    }
    return { lines: lines.filter((l) => l.length > 0), newOffset };
  } finally {
    closeSync(fd);
  }
}

/** Incrementally scan all known CLI session logs into the token ledger. */
export function scanSessionLogs(db: QuotaDB): ScanResult {
  const result: ScanResult = { filesSeen: 0, eventsAdded: 0, bytesRead: 0 };

  const sources: Array<{ provider: string; dir: string; parse: typeof parseClaudeLine }> = [
    { provider: 'claude', dir: claudeProjectsDir(), parse: parseClaudeLine },
    { provider: 'codex', dir: codexSessionsDir(), parse: parseCodexLine },
  ];

  for (const { provider, dir, parse } of sources) {
    if (!existsSync(dir)) continue;
    for (const file of collectJsonlFiles(dir)) {
      result.filesSeen++;
      const offset = db.getIngestOffset(file);
      let tail: ReturnType<typeof readTail>;
      try {
        tail = readTail(file, offset);
      } catch {
        continue; // unreadable mid-rotation — next scan retries
      }
      result.bytesRead += tail.newOffset - offset;

      for (let i = 0; i < tail.lines.length; i++) {
        const event = parse(tail.lines[i]!, `${file}:${offset}:${i}`);
        if (event && db.insertTokenEvent({ ...event, provider })) {
          result.eventsAdded++;
        }
      }
      db.setIngestOffset(file, tail.newOffset);
    }
  }
  return result;
}

// ── Aggregation + budget estimation ─────────────────────────────────────

/** Window durations we can anchor token sums to (rolling semantics). */
export const WINDOW_SECONDS: Record<string, number> = {
  session: 5 * 3600,
  day: 24 * 3600,
  week: 7 * 24 * 3600,
};

export interface WindowTokenEstimate {
  windowKind: string;
  windowName: string;
  usedPct: number;
  /** tokens we counted in the rolling window */
  consumedTokens: number;
  /** extrapolated absolute budget of the window; null when usedPct ≈ 0 */
  estimatedBudgetTokens: number | null;
  /** estimatedBudget × remaining fraction */
  estimatedRemainingTokens: number | null;
  /** tokens/hour over the events' actual time span; null with <2 events */
  burnRatePerHour: number | null;
}

/**
 * Estimate absolute budget/remaining for one percent window from counted
 * tokens. Returns null when there is no token data for the provider.
 */
export function estimateWindowTokens(
  db: QuotaDB,
  provider: string,
  window: { kind: string; name: string; usedPct: number; remainingPct: number; resetAt?: string | null },
  now: Date = new Date(),
): WindowTokenEstimate | null {
  const seconds = WINDOW_SECONDS[window.kind];
  if (!seconds) return null;

  // Anchor to the ACTIVE window when resetAt is known (start = reset − span):
  // a plain rolling lookback would count tokens the current window already
  // forgave (session window started 2h ago ≠ last 5h).
  let sinceMs = now.getTime() - seconds * 1000;
  if (window.resetAt) {
    const startMs = new Date(window.resetAt).getTime() - seconds * 1000;
    if (startMs > sinceMs) sinceMs = startMs;
  }
  const since = new Date(sinceMs).toISOString();
  const agg = db.tokenUsageSince(provider, since);
  if (agg.events === 0) return null;

  let burnRatePerHour: number | null = null;
  if (agg.events >= 2 && agg.firstTs && agg.lastTs && agg.lastTs > agg.firstTs) {
    const hours = (new Date(agg.lastTs).getTime() - new Date(agg.firstTs).getTime()) / 3_600_000;
    burnRatePerHour = agg.totalTokens / hours;
  }

  let estimatedBudgetTokens: number | null = null;
  let estimatedRemainingTokens: number | null = null;
  if (window.usedPct > 0.5) {
    // below 0.5% the extrapolation explodes — not meaningful
    estimatedBudgetTokens = Math.round(agg.totalTokens / (window.usedPct / 100));
    estimatedRemainingTokens = Math.round(estimatedBudgetTokens * (window.remainingPct / 100));
  }

  return {
    windowKind: window.kind,
    windowName: window.name,
    usedPct: window.usedPct,
    consumedTokens: agg.totalTokens,
    estimatedBudgetTokens,
    estimatedRemainingTokens,
    burnRatePerHour: burnRatePerHour === null ? null : Math.round(burnRatePerHour),
  };
}
