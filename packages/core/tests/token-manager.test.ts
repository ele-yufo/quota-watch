import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCredentials } from '../src/auth/token-manager.js';
import type { ProviderConfig } from '../src/types.js';

const { mockHome } = vi.hoisted(() => ({ mockHome: { current: '' } }));

// shell-env.ts resolves ~/.shell_env via os.homedir() — point it at a fixture
// dir so tests never touch the real file.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => mockHome.current };
});

function makeConfig(provider: string, apiKey: string): ProviderConfig {
  return {
    id: `${provider}-main`,
    provider,
    displayName: provider,
    credentials: { apiKey },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('resolveCredentials — ~/.shell_env override', () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'qw-token-manager-'));
    mockHome.current = home;
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('prefers the live env value over the DB-stored key', () => {
    writeFileSync(join(home, '.shell_env'), 'export DEEPSEEK_API_KEY=sk-env-rotated\n');
    const resolved = resolveCredentials(makeConfig('deepseek', 'sk-db-stale'));
    expect(resolved.credentials.apiKey).toBe('sk-env-rotated');
  });

  it('falls back to the DB key when the variable is absent', () => {
    writeFileSync(join(home, '.shell_env'), 'export OPENROUTER_API_KEY=sk-or\n');
    const resolved = resolveCredentials(makeConfig('deepseek', 'sk-db-stale'));
    expect(resolved.credentials.apiKey).toBe('sk-db-stale');
  });

  it('falls back to the DB key when ~/.shell_env is missing', () => {
    rmSync(join(home, '.shell_env'), { force: true });
    const resolved = resolveCredentials(makeConfig('orcarouter', 'sk-orca-db'));
    expect(resolved.credentials.apiKey).toBe('sk-orca-db');
  });

  it('leaves providers without an envVar untouched', () => {
    writeFileSync(join(home, '.shell_env'), 'export KIMI_API_KEY=should-not-win\n');
    const resolved = resolveCredentials(makeConfig('aihubmix', 'fd-manage-key'));
    expect(resolved.credentials.apiKey).toBe('fd-manage-key');
  });
});
