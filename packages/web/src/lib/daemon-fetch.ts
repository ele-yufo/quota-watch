import https from 'node:https';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * fetch 到 daemon 的 HTTPS API。显式信任 ~/.quota-watch/certs/ca.crt——
 * 不依赖 NODE_EXTRA_CA_CERTS（launchd 部署有该 env，但手动
 * `next start` / `next dev` 没有，直接 fetch 自签 CA 会静默失败）。
 *
 * 缓存按 mtime 失效：daemon 证书轮换（删 certs 目录重启）后无需重启 web。
 */
let caCache: { mtimeMs: number; pem: Buffer } | undefined;

function daemonCa(): Buffer | undefined {
  const p = join(homedir(), '.quota-watch', 'certs', 'ca.crt');
  try {
    const { mtimeMs } = statSync(p);
    if (!caCache || caCache.mtimeMs !== mtimeMs) {
      caCache = { mtimeMs, pem: readFileSync(p) };
    }
    return caCache.pem;
  } catch {
    return undefined;
  }
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
        // Socket dying mid-body fires 'error'/'aborted', never 'end' — without
        // these the promise NEVER settles and the dashboard's poll mutex
        // (running.current) wedges, freezing the page until reload.
        res.on('error', () => resolve({ ok: false, status: 0, json: async () => null }));
        res.on('aborted', () => resolve({ ok: false, status: 0, json: async () => null }));
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
