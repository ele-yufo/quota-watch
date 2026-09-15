/**
 * shell-env.ts — read a single variable out of ~/.shell_env.
 *
 * The daemon and web server run under launchd and never see the user's shell
 * environment. PAYG API keys that live in ~/.shell_env are imported into the
 * DB at setup time (web POST /api/providers autoImport); since 2026-09 the
 * daemon also RE-READS this file per poll for providers that declare an
 * `envVar` (see token-manager.resolveCredentials) so a rotated key takes
 * effect without re-importing — the DB copy is only a fallback.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Parse `export NAME=value` / `NAME=value` from ~/.shell_env. null if absent.
 *  When a variable is assigned multiple times the LAST one wins — same as the
 *  shell — because updated keys are typically appended, not edited in place.
 *  An unquoted trailing ` # comment` is stripped (shell semantics: `#` starts
 *  a comment only at word start, so `sk-key#1` keeps its hash). */
export function readShellEnvVar(name: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(homedir(), ".shell_env"), "utf-8");
  } catch {
    return null;
  }
  // [ \t] only — \s would let `=` span a newline and swallow the NEXT line
  // as the value (`KEY=\nexport OTHER=value` → "export OTHER=value").
  const re = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*(.*)$`, "gm");
  let raw: string | null = null;
  for (const m of text.matchAll(re)) raw = m[1]!;
  if (raw === null) return null;
  let v = raw.trim();
  // Quoted value: take the inside, ignore anything after the closing quote
  // (`"abc" # note` → `abc`). An unterminated quote falls through unchanged.
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.indexOf(q, 1);
    if (end !== -1) return v.slice(1, end) || null;
  }
  const hash = v.search(/\s#/);
  if (hash !== -1) v = v.slice(0, hash).trim();
  return v || null;
}
