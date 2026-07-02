/**
 * windows.ts — quota window taxonomy.
 *
 * Every quota window has a `kind` that says what time-class it belongs to.
 * Kind drives cross-provider display order (session first, month last) so
 * every UI reads the same left-to-right; before this, the web UI guessed
 * with regexes on display names.
 *
 * Providers set `kind` explicitly when building windows. For legacy DB rows
 * written before the column existed, `classifyWindowKind` infers it from the
 * display name.
 */

export type WindowKind = 'session' | 'day' | 'week' | 'month' | 'balance' | 'unknown';

/** Display rank: tighter window first. */
export const WINDOW_KIND_ORDER: Record<WindowKind, number> = {
  session: 0,
  day: 1,
  week: 2,
  month: 3,
  balance: 4,
  unknown: 5,
};

/** Compact label for chips / column headers. */
const KIND_LABEL: Record<WindowKind, string> = {
  session: '5h',
  day: '24h',
  week: '7d',
  month: '1mo',
  balance: 'bal',
  unknown: '—',
};

export function windowKindLabel(kind: WindowKind): string {
  return KIND_LABEL[kind];
}

export function compareWindowKind(a: WindowKind, b: WindowKind): number {
  return WINDOW_KIND_ORDER[a] - WINDOW_KIND_ORDER[b];
}

/** Sort a copy of `windows` by kind rank; ties keep input order (stable). */
export function sortWindowsByKind<T>(windows: readonly T[], kindOf: (w: T) => WindowKind): T[] {
  return [...windows].sort((a, b) => compareWindowKind(kindOf(a), kindOf(b)));
}

// Ordered tightest-first so a name mentioning several classes ("weekly 5h
// hybrid") resolves to the tighter constraint.
const CLASSIFIERS: Array<{ kind: WindowKind; pattern: RegExp }> = [
  { kind: 'session', pattern: /session|5\s*h/i },
  { kind: 'day', pattern: /daily|24\s*h|\bday\b/i },
  { kind: 'week', pattern: /week|7\s*d/i },
  { kind: 'month', pattern: /month|1\s*mo|30\s*d/i },
  { kind: 'balance', pattern: /balance|credit/i },
];

/** Infer a window's kind from its display name (legacy rows / unknown sources). */
export function classifyWindowKind(name: string): WindowKind {
  for (const { kind, pattern } of CLASSIFIERS) {
    if (pattern.test(name)) return kind;
  }
  return 'unknown';
}
