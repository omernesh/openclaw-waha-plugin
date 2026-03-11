import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LRUCache } from "lru-cache";

describe("LRU Cache for resolveTarget", () => {
  let cache: LRUCache<string, unknown[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new LRUCache<string, unknown[]>({
      max: 1000,
      ttl: 30_000, // 30 seconds, same as resolveTarget config
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should get/set entries", () => {
    const data = [{ id: "a" }, { id: "b" }];
    cache.set("groups", data);
    expect(cache.get("groups")).toEqual(data);
  });

  it("should return undefined for missing keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("should evict oldest entry when max 1000 exceeded", () => {
    // Fill cache to max
    for (let i = 0; i < 1000; i++) {
      cache.set(`key-${i}`, [{ id: i }]);
    }
    expect(cache.size).toBe(1000);

    // Add one more -- should evict the oldest (key-0)
    cache.set("key-1000", [{ id: 1000 }]);
    expect(cache.size).toBe(1000);
    expect(cache.get("key-0")).toBeUndefined();
    expect(cache.get("key-1000")).toEqual([{ id: 1000 }]);
  });

  it("should expire entries after 30s TTL", () => {
    // lru-cache uses performance.now() or Date.now() internally for TTL.
    // We test TTL by creating a cache with a very short TTL and using real timers.
    vi.useRealTimers();
    const shortCache = new LRUCache<string, unknown[]>({
      max: 1000,
      ttl: 50, // 50ms TTL for fast test
    });
    shortCache.set("groups", [{ id: "g1" }]);
    expect(shortCache.get("groups")).toEqual([{ id: "g1" }]);

    // Wait past TTL
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(shortCache.get("groups")).toBeUndefined();
        resolve();
      }, 100);
    });
  });

  it("should overwrite existing entries", () => {
    cache.set("contacts", [{ id: "c1" }]);
    cache.set("contacts", [{ id: "c2" }]);
    expect(cache.get("contacts")).toEqual([{ id: "c2" }]);
  });

  it("should store arrays directly (no wrapper object)", () => {
    const arr = [{ id: "1" }, { id: "2" }, { id: "3" }];
    cache.set("channels", arr);
    const retrieved = cache.get("channels");
    expect(Array.isArray(retrieved)).toBe(true);
    expect(retrieved).toEqual(arr);
  });
});
