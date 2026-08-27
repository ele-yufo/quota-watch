import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureTlsConfig, readCaPem } from '../src/certs.js';

function tmpCertsDir(): string {
  return join(mkdtempSync(join(tmpdir(), 'qw-certs-')), 'certs');
}

describe('ensureTlsConfig', () => {
  it('generates CA + server key/cert on first run', () => {
    const dir = tmpCertsDir();
    const tls = ensureTlsConfig(dir);
    expect(existsSync(join(dir, 'ca.crt'))).toBe(true);
    expect(existsSync(join(dir, 'ca.key'))).toBe(true);
    expect(existsSync(join(dir, 'server.crt'))).toBe(true);
    expect(existsSync(join(dir, 'server.key'))).toBe(true);
    // PEM headers present
    expect(readFileSync(tls.caPath, 'utf-8')).toContain('BEGIN CERTIFICATE');
    expect(readFileSync(tls.keyPath, 'utf-8')).toContain('BEGIN EC PRIVATE KEY');
    rmSync(dir, { recursive: true, force: true });
  });

  it('fingerprint is a stable 64-char hex SHA-256', () => {
    const dir = tmpCertsDir();
    const first = ensureTlsConfig(dir);
    const second = ensureTlsConfig(dir); // must NOT regenerate
    expect(first.caFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(second.caFingerprint).toBe(first.caFingerprint);
    rmSync(dir, { recursive: true, force: true });
  });

  it('readCaPem returns the PEM text', () => {
    const dir = tmpCertsDir();
    const tls = ensureTlsConfig(dir);
    expect(readCaPem(tls.caPath)).toContain('BEGIN CERTIFICATE');
    rmSync(dir, { recursive: true, force: true });
  });

  it('CA carries basicConstraints=CA:TRUE (Node trust-anchor requirement)', () => {
    const dir = tmpCertsDir();
    const tls = ensureTlsConfig(dir);
    const text = execFileSync('/usr/bin/openssl', ['x509', '-in', tls.caPath, '-noout', '-text'], {
      encoding: 'utf-8',
    });
    expect(text).toContain('CA:TRUE');
    expect(text).toContain('Certificate Sign'); // keyUsage=keyCertSign 的文本显示
    rmSync(dir, { recursive: true, force: true });
  });
});
