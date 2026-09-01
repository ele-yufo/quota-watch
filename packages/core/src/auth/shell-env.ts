/**
 * shell-env.ts — read a single variable out of ~/.shell_env.
 *
 * The daemon and web server run under launchd and never see the user's shell
 * environment. PAYG API keys that already live in ~/.shell_env are imported
 * once at setup time (web POST /api/providers autoImport) and stored in the
 * DB — the runtime never re-reads this file.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Parse `export NAME=value` / `NAME=value` from ~/.shell_env. null if absent.
 *  When a variable is assigned multiple times the LAST one wins — same as the
 *  shell — because updated keys are typically appended, not edited in place. */
export function readShellEnvVar(name: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(homedir(), ".shell_env"), "utf-8");
  } catch {
    return null;
  }
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`, "gm");
  let raw: string | null = null;
  for (const m of text.matchAll(re)) raw = m[1]!;
  if (raw === null) return null;
  let v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v || null;
}
