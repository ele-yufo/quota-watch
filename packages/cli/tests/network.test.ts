import { describe, it, expect } from 'vitest';
import { proxyEnvironment } from '../src/network.js';

describe('proxyEnvironment', () => {
  const system = '  HTTPSEnable : 1\n  HTTPSProxy : 127.0.0.1\n  HTTPSPort : 7890\n';
  it('uses an enabled system proxy without proxying loopback', () => {
    const env = proxyEnvironment({}, system);
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
    expect(env.no_proxy).toBe('localhost,127.0.0.1,::1');
    expect(proxyEnvironment({}, system.replace('Enable : 1', 'Enable : 0')).HTTPS_PROXY).toBeUndefined();
  });
  it('preserves explicit proxy and bypass settings', () => {
    const env = proxyEnvironment({ https_proxy: 'http://custom:8080', NO_PROXY: '.internal' }, system);
    expect(env.https_proxy).toBe('http://custom:8080');
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.no_proxy).toContain('.internal');
  });
});
