import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../src/providers/registry.js';
import type { ProviderAdapter } from '../src/providers/types.js';
import type { ProviderConfig, ProviderQuota } from '../src/types.js';

function makeMockAdapter(id: string, displayName = id): ProviderAdapter {
  return {
    id,
    displayName,
    async fetchQuota(_config: ProviderConfig): Promise<ProviderQuota> {
      return {
        provider: id,
        account: 'test',
        plan: 'free',
        status: 'ok',
        windows: [],
        fetchedAt: new Date().toISOString(),
      };
    },
  };
}

describe('ProviderRegistry', () => {
  it('registers and retrieves an adapter by id', () => {
    const registry = new ProviderRegistry();
    const adapter = makeMockAdapter('openai', 'OpenAI');

    registry.register(adapter);

    expect(registry.get('openai')).toBe(adapter);
    expect(registry.has('openai')).toBe(true);
  });

  it('list() returns all registered ids', () => {
    const registry = new ProviderRegistry();
    registry.register(makeMockAdapter('openai'));
    registry.register(makeMockAdapter('anthropic'));

    const ids = registry.list();
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
    expect(ids).toHaveLength(2);
  });

  it('get() returns undefined for unknown id', () => {
    const registry = new ProviderRegistry();

    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('has() returns false for unknown id', () => {
    const registry = new ProviderRegistry();

    expect(registry.has('nonexistent')).toBe(false);
  });
});
