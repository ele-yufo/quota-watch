import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseClaudeLine,
  parseCodexLine,
  readTail,
  collectJsonlFiles,
  estimateWindowTokens,
} from '../src/token-ledger.js';
import { QuotaDB } from '../src/db.js';

let dir: string;
let db: QuotaDB;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qw-ledger-'));
  db = new QuotaDB(join(dir, 'test.db'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const CLAUDE_USAGE = {
  input_tokens: 100,
  cache_creation_input_tokens: 20,
  cache_read_input_tokens: 500,
  output_tokens: 30,
};

function claudeLine(
  msgId: string,
  usage: Partial<typeof CLAUDE_USAGE> = CLAUDE_USAGE,
  ts = '2026-08-28T10:00:00Z',
) {
  return JSON.stringify({
    type: 'assistant',
    uuid: `uuid-${msgId}`,
    timestamp: ts,
    message: { id: msgId, model: 'k3-256k', usage },
  });
}

function codexLine(input: number, output: number, ts = '2026-08-28T10:00:00Z') {
  return JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
        last_token_usage: { input_tokens: input, output_tokens: output },
      },
    },
  });
}

describe('parseClaudeLine', () => {
  it('extracts usage incl. cache buckets, totals them, dedups by message id', () => {
    const e = parseClaudeLine(claudeLine('msg_1'), 'fallback:0');
    expect(e).toMatchObject({
      sourceId: 'claude:msg_1',
      model: 'k3-256k',
      inputTokens: 100,
      outputTokens: 30,
      cacheReadTokens: 500,
      cacheWriteTokens: 20,
      totalTokens: 650,
    });
  });

  it('falls back to the positional id when message.id is absent', () => {
    const line = JSON.stringify({
      timestamp: '2026-08-28T10:00:00Z',
      message: { usage: { input_tokens: 5, output_tokens: 5 } },
    });
    expect(parseClaudeLine(line, 'file:0:0')!.sourceId).toBe('file:0:0');
  });

  it('ignores non-usage lines, zero-usage lines and garbage', () => {
    expect(parseClaudeLine('{"type":"user","timestamp":"2026-08-28T10:00:00Z"}', 'x')).toBeNull();
    expect(parseClaudeLine(claudeLine('m', { input_tokens: 0, output_tokens: 0 }), 'x')).toBeNull();
    expect(parseClaudeLine('not json', 'x')).toBeNull();
  });
});

describe('parseCodexLine', () => {
  it('uses last_token_usage (the per-turn delta); cached is inside input', () => {
    const e = parseCodexLine(codexLine(1000, 50), 'file:0:0')!;
    expect(e.inputTokens).toBe(1000);
    expect(e.outputTokens).toBe(50);
    expect(e.totalTokens).toBe(1050);
    expect(e.cacheReadTokens).toBe(0);
  });

  it('ignores non-token_count events', () => {
    const line = JSON.stringify({ timestamp: '2026-08-28T10:00:00Z', type: 'event_msg', payload: { type: 'agent_message' } });
    expect(parseCodexLine(line, 'x')).toBeNull();
  });
});

describe('readTail', () => {
  it('reads appended bytes only and holds back a partial trailing line', () => {
    const f = join(dir, 'a.jsonl');
    writeFileSync(f, '{"a":1}\n{"b":2}\n');
    const first = readTail(f, 0);
    expect(first.lines).toHaveLength(2);
    expect(first.newOffset).toBe(statSync(f).size);

    appendFileSync(f, '{"c":3}'); // no trailing newline — mid-append
    const second = readTail(f, first.newOffset);
    expect(second.lines).toHaveLength(0);
    expect(second.newOffset).toBe(first.newOffset);

    appendFileSync(f, '\n');
    const third = readTail(f, second.newOffset);
    expect(third.lines).toEqual(['{"c":3}']);
  });

  it('restarts from 0 when the file shrank (rotation)', () => {
    const f = join(dir, 'b.jsonl');
    writeFileSync(f, 'short\n');
    expect(readTail(f, 9999).newOffset).toBe(6);
  });

  it('caps one pass at MAX_SCAN_CHUNK and resumes correctly across chunks', () => {
    // Use many large lines to exceed 8MB without one giant line.
    const f = join(dir, 'big.jsonl');
    const line = `{"pad":"${'x'.repeat(999_000)}"}\n`; // ~1MB per line
    for (let i = 0; i < 10; i++) appendFileSync(f, line);

    let offset = 0;
    let totalLines = 0;
    let passes = 0;
    while (true) {
      const { lines, newOffset } = readTail(f, offset);
      totalLines += lines.length;
      passes++;
      expect(newOffset).toBeGreaterThan(offset); // always makes progress
      offset = newOffset;
      if (offset >= statSync(f).size) break;
      expect(passes).toBeLessThan(20); // sanity
    }
    expect(totalLines).toBe(10);
    expect(passes).toBeGreaterThan(1); // actually chunked
  });
});

describe('collectJsonlFiles', () => {
  it('finds nested jsonl, skips other extensions', () => {
    writeFileSync(join(dir, 'top.jsonl'), '');
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'nested.jsonl'), '');
    writeFileSync(join(sub, 'notes.txt'), '');
    expect(collectJsonlFiles(dir).sort()).toEqual([join(sub, 'nested.jsonl'), join(dir, 'top.jsonl')].sort());
  });
});

describe('token ledger in db + estimateWindowTokens', () => {
  it('insertTokenEvent is idempotent by source_id and aggregates over spans', () => {
    const base = {
      provider: 'claude',
      timestamp: new Date(Date.now() - 3600_000).toISOString(), // 1h ago
      model: 'k3-256k',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 1000,
      cacheWriteTokens: 0,
      totalTokens: 1150,
    };
    expect(db.insertTokenEvent({ ...base, sourceId: 'claude:m1' })).toBe(true);
    expect(db.insertTokenEvent({ ...base, sourceId: 'claude:m1' })).toBe(false); // dup
    expect(db.insertTokenEvent({ ...base, sourceId: 'claude:m2', timestamp: new Date().toISOString() })).toBe(true);

    const day = db.tokenUsageSince('claude', new Date(Date.now() - 24 * 3600_000).toISOString());
    expect(day.events).toBe(2);
    expect(day.totalTokens).toBe(2300);

    const old = db.tokenUsageSince('claude', new Date(Date.now() - 30 * 60_000).toISOString());
    expect(old.events).toBe(1); // only the fresh one inside 30min
  });

  it('estimates budget from used% and counted tokens', () => {
    const now = new Date();
    const ts1 = new Date(now.getTime() - 2 * 3600_000).toISOString();
    const ts2 = new Date(now.getTime() - 3600_000).toISOString();
    db.insertTokenEvent({
      sourceId: 'claude:e1', provider: 'claude', timestamp: ts1, model: null,
      inputTokens: 300_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 400_000,
    });
    db.insertTokenEvent({
      sourceId: 'claude:e2', provider: 'claude', timestamp: ts2, model: null,
      inputTokens: 300_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 400_000,
    });

    const est = estimateWindowTokens(db, 'claude', {
      kind: 'session', name: 'session (5h)', usedPct: 40, remainingPct: 60,
    }, now);
    expect(est).not.toBeNull();
    expect(est!.consumedTokens).toBe(800_000);
    expect(est!.estimatedBudgetTokens).toBe(2_000_000); // 800k / 40%
    expect(est!.estimatedRemainingTokens).toBe(1_200_000);
    expect(est!.burnRatePerHour).toBe(800_000); // 800k over 1h span
  });

  it('clamps the span to the active window when resetAt is known', () => {
    const now = new Date();
    // Active session window started 1h ago (resets in 4h). A rolling 5h
    // lookback would also count the 3h-old event — the clamp must not.
    db.insertTokenEvent({
      sourceId: 'claude:old', provider: 'claude',
      timestamp: new Date(now.getTime() - 3 * 3600_000).toISOString(), model: null,
      inputTokens: 900_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 900_000,
    });
    db.insertTokenEvent({
      sourceId: 'claude:new', provider: 'claude',
      timestamp: new Date(now.getTime() - 30 * 60_000).toISOString(), model: null,
      inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100_000,
    });

    const resetAt = new Date(now.getTime() + 4 * 3600_000).toISOString();
    const est = estimateWindowTokens(db, 'claude', {
      kind: 'session', name: 's', usedPct: 50, remainingPct: 50, resetAt,
    }, now);
    expect(est!.consumedTokens).toBe(100_000); // only the event inside the active window

    // unknown kind still returns null
    expect(estimateWindowTokens(db, 'claude', {
      kind: 'month', name: 'm', usedPct: 50, remainingPct: 50,
    }, now)).toBeNull();
  });

  it('returns null without events, and null budget when usage ≈ 0', () => {
    expect(estimateWindowTokens(db, 'claude', { kind: 'session', name: 's', usedPct: 50, remainingPct: 50 })).toBeNull();

    db.insertTokenEvent({
      sourceId: 'claude:z', provider: 'claude', timestamp: new Date().toISOString(), model: null,
      inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 20,
    });
    const est = estimateWindowTokens(db, 'claude', { kind: 'session', name: 's', usedPct: 0.1, remainingPct: 99.9 });
    expect(est!.consumedTokens).toBe(20);
    expect(est!.estimatedBudgetTokens).toBeNull();
  });
});
