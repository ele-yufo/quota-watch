import type { ProviderAdapter } from './types.js';

/**
 * Central registry of provider adapters.
 * Adapters register themselves; consumers look them up by id.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  /** Register a provider adapter. Overwrites if id already exists. */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** Look up an adapter by id. Returns undefined if not found. */
  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  /** Return all registered adapter ids. */
  list(): string[] {
    return [...this.adapters.keys()];
  }

  /** Check whether an adapter with the given id is registered. */
  has(id: string): boolean {
    return this.adapters.has(id);
  }
}
