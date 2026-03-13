/**
 * policy-cache.ts — LRU cache wrapper for resolved policies.
 * Added in Phase 6, Plan 02 (2026-03-14).
 *
 * DO NOT CHANGE: Cache is keyed by `${scopeId}:${mtime}`.
 * A different mtime for the same scopeId is treated as a miss (stale).
 * invalidate(scopeId) removes ALL entries whose key starts with `${scopeId}:`.
 *
 * Defaults: max=500 entries, ttl=30_000ms (30 seconds).
 * The module-level singleton `policyCache` is the shared instance used by the resolver.
 */

import { LRUCache } from "lru-cache";
import type { ResolvedPolicy } from "./rules-types";

export interface PolicyCacheOptions {
  /** Maximum number of entries (default: 500) */
  max?: number;
  /** TTL in milliseconds (default: 30_000) */
  ttl?: number;
}

/**
 * LRU cache for resolved policies keyed by scope ID + file mtime.
 * Mtime-based invalidation: when the underlying YAML file changes, the mtime
 * changes and the old cached entry is naturally a miss on the next lookup.
 */
export class PolicyCache {
  private readonly lru: LRUCache<string, ResolvedPolicy>;

  constructor(options: PolicyCacheOptions = {}) {
    this.lru = new LRUCache<string, ResolvedPolicy>({
      max: options.max ?? 500,
      ttl: options.ttl ?? 30_000,
    });
  }

  /**
   * Returns the cached ResolvedPolicy for the given scope + mtime, or undefined on miss.
   * A different mtime is treated as a cache miss (stale).
   */
  get(scopeId: string, mtime: number): ResolvedPolicy | undefined {
    return this.lru.get(`${scopeId}:${mtime}`);
  }

  /**
   * Stores a resolved policy in the cache under the scope + mtime key.
   */
  set(scopeId: string, mtime: number, policy: ResolvedPolicy): void {
    this.lru.set(`${scopeId}:${mtime}`, policy);
  }

  /**
   * Removes all cache entries whose key starts with `${scopeId}:`.
   * Call this when a rule file for a scope is modified to force re-resolution.
   */
  invalidate(scopeId: string): void {
    const prefix = `${scopeId}:`;
    for (const key of this.lru.keys()) {
      if (key.startsWith(prefix)) {
        this.lru.delete(key);
      }
    }
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.lru.clear();
  }
}

/**
 * Module-level singleton used by the rules resolver.
 * DO NOT REMOVE: Shared across all resolver calls in the same process.
 */
export const policyCache = new PolicyCache();
