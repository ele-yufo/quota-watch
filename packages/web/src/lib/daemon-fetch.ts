import https from 'node:https';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * fetch 到 daemon 的 HTTPS API。显式信任 ~/.quota-watch/certs/ca.crt——
 * 不依赖 NODE_EXTRA_CA_CERTS（launchd 部署有该 env，但手动
 * `next start` / `next dev` 没有，直接 fetch 自签 CA 会静默失败）。
 */
let caCache: Buffer | undefined;

function daemonCa(): Buffer | undefined {
  if (caCache) return caCache;
  try {
    caCache = readFileSync(join(homedir(), '.quota-watch', 'certs', 'ca.crt'));
  } catch {
    return undefined;
  }
  return caCache;
}

export function fetchDaemon(
  port: number,
  path: string,
  init?: { method?: string; token?: string | null; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; json(): Promise<Record<string, unknown> | null> }> {
  return new Promise((resolve) => {
    const ca = daemonCa();
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: init?.method ?? 'GET',
        ca,
        headers: init?.token ? { Authorization: `Bearer ${init.token}` } : undefined,
        timeout: init?.timeoutMs ?? 2000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode ?? 0,
            json: async () => {
              try {
                return body ? JSON.parse(body) : null;
              } catch {
                return null;
              }
            },
          }),
        );
      },
    );
    req.on('error', () => resolve({ ok: false, status: 0, json: async () => null }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, json: async () => null });
    });
    req.end();
  });
}
