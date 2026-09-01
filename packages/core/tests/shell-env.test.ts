import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShellEnvVar } from "../src/auth/shell-env.js";

describe("readShellEnvVar", () => {
  let dir: string;
  let realHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qw-shellenv-"));
    // Point the parser at a scratch HOME — readShellEnvVar joins
    // homedir() + .shell_env, and homedir() re-reads $HOME per call on POSIX.
    realHome = process.env.HOME;
    process.env.HOME = dir;
  });

  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (content: string) =>
    writeFileSync(join(dir, ".shell_env"), content);

  it("parses export and bare assignments, strips quotes", () => {
    write('export FOO_API_KEY="sk-quoted"\nBAR=\'bare\'\n');
    expect(readShellEnvVar("FOO_API_KEY")).toBe("sk-quoted");
    expect(readShellEnvVar("BAR")).toBe("bare");
  });

  it("returns the LAST assignment, matching shell semantics", () => {
    // Keys are commonly rotated by appending a new export — importing the
    // first match would silently store the revoked old key.
    write("export KEY=old-revoked\nexport KEY=new-current\n");
    expect(readShellEnvVar("KEY")).toBe("new-current");
  });

  it("a trailing empty assignment revokes the key (null, not the old value)", () => {
    write("export KEY=old-revoked\nKEY=\n");
    expect(readShellEnvVar("KEY")).toBeNull();
  });

  it("returns null when the file or variable is absent", () => {
    expect(readShellEnvVar("NOPE")).toBeNull();
    write("OTHER=1\n");
    expect(readShellEnvVar("NOPE")).toBeNull();
  });
});
