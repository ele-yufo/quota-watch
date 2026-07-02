import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadAppConfig,
  saveAppConfig,
  ensureApiToken,
  isLoopbackHost,
  DEFAULT_APP_CONFIG,
} from '../src/config.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qw-config-'));
  path = join(dir, 'config.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadAppConfig', () => {
  it('returns defaults when file is missing', () => {
    expect(loadAppConfig(path)).toEqual(DEFAULT_APP_CONFIG);
  });

  it('returns defaults when file is corrupt', () => {
    writeFileSync(path, '{not json');
    expect(loadAppConfig(path)).toEqual(DEFAULT_APP_CONFIG);
  });

  it('merges partial config over defaults', () => {
    writeFileSync(path, JSON.stringify({ poll: { fastMs: 5000 }, api: { host: '0.0.0.0' } }));
    const cfg = loadAppConfig(path);
    expect(cfg.poll.fastMs).toBe(5000);
    expect(cfg.poll.baseMs).toBe(DEFAULT_APP_CONFIG.poll.baseMs);
    expect(cfg.api.host).toBe('0.0.0.0');
    expect(cfg.api.port).toBe(DEFAULT_APP_CONFIG.api.port);
  });

  it('rejects non-positive interval values', () => {
    writeFileSync(path, JSON.stringify({ poll: { fastMs: -1, baseMs: 0 } }));
    const cfg = loadAppConfig(path);
    expect(cfg.poll.fastMs).toBe(DEFAULT_APP_CONFIG.poll.fastMs);
    expect(cfg.poll.baseMs).toBe(DEFAULT_APP_CONFIG.poll.baseMs);
  });
});

describe('saveAppConfig / roundtrip', () => {
  it('persists and reloads', () => {
    const cfg = { ...DEFAULT_APP_CONFIG, poll: { ...DEFAULT_APP_CONFIG.poll, fastMs: 7000 } };
    saveAppConfig(cfg, path);
    expect(loadAppConfig(path).poll.fastMs).toBe(7000);
  });
});

describe('ensureApiToken', () => {
  it('leaves loopback configs untouched', () => {
    const cfg = ensureApiToken(DEFAULT_APP_CONFIG, path);
    expect(cfg.api.token).toBeNull();
  });

  it('generates + persists a token for non-loopback hosts', () => {
    const lan = { ...DEFAULT_APP_CONFIG, api: { ...DEFAULT_APP_CONFIG.api, host: '0.0.0.0' } };
    const cfg = ensureApiToken(lan, path);
    expect(cfg.api.token).toMatch(/^[0-9a-f]{32}$/);
    const persisted = JSON.parse(readFileSync(path, 'utf-8'));
    expect(persisted.api.token).toBe(cfg.api.token);
  });

  it('keeps an existing token', () => {
    const lan = {
      ...DEFAULT_APP_CONFIG,
      api: { host: '0.0.0.0', port: 3737, token: 'abc123' },
    };
    expect(ensureApiToken(lan, path).api.token).toBe('abc123');
  });
});

describe('isLoopbackHost', () => {
  it('recognizes loopback forms', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });
});
