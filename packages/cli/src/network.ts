import { execFileSync } from 'node:child_process';
import * as http from 'node:http';

/** launchd does not inherit shell proxies; Node does not read macOS proxies. */
export function proxyEnvironment(env: NodeJS.ProcessEnv, systemProxy: string): NodeJS.ProcessEnv {
  const result = { ...env };
  if (!env.https_proxy && !env.HTTPS_PROXY && !env.http_proxy && !env.HTTP_PROXY) {
    const value = (key: string) => systemProxy.match(new RegExp(`^\\s*${key} : (.+)$`, 'm'))?.[1]?.trim();
    for (const protocol of ['HTTP', 'HTTPS']) {
      const host = value(`${protocol}Proxy`);
      const port = Number(value(`${protocol}Port`));
      if (value(`${protocol}Enable`) === '1' && host && Number.isInteger(port) && port > 0 && port <= 65535) {
        result[`${protocol}_PROXY`] = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
      }
    }
  }
  // Local daemon/CLI and local provider APIs must never go through a proxy.
  result.no_proxy = ['localhost', '127.0.0.1', '::1', env.no_proxy ?? env.NO_PROXY ?? ''].filter(Boolean).join(',');
  return result;
}

export function configureNetwork(): string {
  let systemProxy = '';
  if (process.platform === 'darwin') {
    systemProxy = execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 3000 });
  }
  const env = proxyEnvironment(process.env, systemProxy);
  if (!env.https_proxy && !env.HTTPS_PROXY && !env.http_proxy && !env.HTTP_PROXY) return 'direct';
  const configure = (http as typeof http & {
    setGlobalProxyFromEnv?: (env: NodeJS.ProcessEnv) => unknown;
  }).setGlobalProxyFromEnv;
  if (!configure) throw new Error('Proxy support requires Node 24.14+ or 25.4+');
  configure(env);
  return 'proxy enabled (environment or macOS system settings)';
}
