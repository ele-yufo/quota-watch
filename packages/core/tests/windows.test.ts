import { describe, it, expect } from 'vitest';
import {
  classifyWindowKind,
  compareWindowKind,
  sortWindowsByKind,
  windowKindLabel,
  WINDOW_KIND_ORDER,
  type WindowKind,
} from '../src/windows.js';

describe('classifyWindowKind', () => {
  it('classifies session-class names', () => {
    expect(classifyWindowKind('session (5h)')).toBe('session');
    expect(classifyWindowKind('Gemini (5h)')).toBe('session');
    expect(classifyWindowKind('Claude+GPT (5h)')).toBe('session');
    expect(classifyWindowKind('OpenCode Go 5h (5h)')).toBe('session');
  });

  it('classifies day-class names', () => {
    expect(classifyWindowKind('daily (24h)')).toBe('day');
    expect(classifyWindowKind('Free Tier (24h)')).toBe('day');
    expect(classifyWindowKind('Daily')).toBe('day');
  });

  it('classifies week-class names', () => {
    expect(classifyWindowKind('weekly (7d)')).toBe('week');
    expect(classifyWindowKind('weekly sonnet (7d)')).toBe('week');
    expect(classifyWindowKind('OpenCode Go Weekly (Weekly)')).toBe('week');
  });

  it('classifies month-class names', () => {
    expect(classifyWindowKind('monthly (1mo)')).toBe('month');
    expect(classifyWindowKind('OpenCode Go Monthly (Monthly)')).toBe('month');
    expect(classifyWindowKind('premium requests (30d)')).toBe('month');
  });

  it('classifies balance-class names', () => {
    expect(classifyWindowKind('balance')).toBe('balance');
    expect(classifyWindowKind('credits')).toBe('balance');
  });

  it('falls back to unknown', () => {
    expect(classifyWindowKind('mystery')).toBe('unknown');
    expect(classifyWindowKind('')).toBe('unknown');
  });

  it('prefers the shortest window when a name mentions several', () => {
    // "5h" beats "weekly" if both appear — session is the tighter constraint
    expect(classifyWindowKind('weekly 5h hybrid')).toBe('session');
  });
});

describe('ordering', () => {
  it('orders session < day < week < month < balance < unknown', () => {
    const kinds: WindowKind[] = ['unknown', 'balance', 'month', 'week', 'day', 'session'];
    const sorted = [...kinds].sort(compareWindowKind);
    expect(sorted).toEqual(['session', 'day', 'week', 'month', 'balance', 'unknown']);
  });

  it('WINDOW_KIND_ORDER covers every kind exactly once', () => {
    const kinds = Object.keys(WINDOW_KIND_ORDER).sort();
    expect(kinds).toEqual(['balance', 'day', 'month', 'session', 'unknown', 'week'].sort());
    const ranks = Object.values(WINDOW_KIND_ORDER);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('sortWindowsByKind sorts stable by kind then keeps original order', () => {
    const windows = [
      { name: 'monthly (1mo)', kind: 'month' as WindowKind },
      { name: 'weekly (7d)', kind: 'week' as WindowKind },
      { name: 'session (5h)', kind: 'session' as WindowKind },
      { name: 'weekly sonnet (7d)', kind: 'week' as WindowKind },
    ];
    const sorted = sortWindowsByKind(windows, (w) => w.kind);
    expect(sorted.map((w) => w.name)).toEqual([
      'session (5h)',
      'weekly (7d)',
      'weekly sonnet (7d)',
      'monthly (1mo)',
    ]);
  });

  it('sortWindowsByKind does not mutate the input', () => {
    const windows = [
      { name: 'weekly (7d)', kind: 'week' as WindowKind },
      { name: 'session (5h)', kind: 'session' as WindowKind },
    ];
    sortWindowsByKind(windows, (w) => w.kind);
    expect(windows[0]!.name).toBe('weekly (7d)');
  });
});

describe('windowKindLabel', () => {
  it('maps kinds to compact display labels', () => {
    expect(windowKindLabel('session')).toBe('5h');
    expect(windowKindLabel('day')).toBe('24h');
    expect(windowKindLabel('week')).toBe('7d');
    expect(windowKindLabel('month')).toBe('1mo');
    expect(windowKindLabel('balance')).toBe('bal');
    expect(windowKindLabel('unknown')).toBe('—');
  });
});
