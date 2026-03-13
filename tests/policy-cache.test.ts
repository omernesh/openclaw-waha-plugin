/**
 * tests/policy-cache.test.ts — Tests for the PolicyCache LRU wrapper.
 * Added in Phase 6, Plan 02 (2026-03-14).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyCache } from "../src/policy-cache";
import type { ResolvedPolicy } from "../src/rules-types";

const makePolicy = (override: Partial<ResolvedPolicy> = {}): ResolvedPolicy => ({
  chat_type: "dm",
  target_id: "test-target",
  privacy_level: "low",
  tone: "neutral",
  forbidden_actions: [],
  forbidden_topics: [],
  ...override,
});

describe("PolicyCache", () => {
  let cache: PolicyCache;

  beforeEach(() => {
    cache = new PolicyCache({ max: 10, ttl: 60_000 });
  });

  it("returns undefined on miss (key not set)", () => {
    const result = cache.get("scope-1", 1000);
    expect(result).toBeUndefined();
  });

  it("returns cached value on hit (same scopeId and mtime)", () => {
    const policy = makePolicy({ target_id: "scope-1" });
    cache.set("scope-1", 1000, policy);
    const result = cache.get("scope-1", 1000);
    expect(result).toEqual(policy);
  });

  it("returns undefined when mtime differs (stale mtime = miss)", () => {
    const policy = makePolicy({ target_id: "scope-1" });
    cache.set("scope-1", 1000, policy);
    const result = cache.get("scope-1", 2000); // different mtime
    expect(result).toBeUndefined();
  });

  it("stores and retrieves multiple distinct scope entries", () => {
    const p1 = makePolicy({ target_id: "scope-a", tone: "warm" });
    const p2 = makePolicy({ target_id: "scope-b", tone: "professional" });
    cache.set("scope-a", 100, p1);
    cache.set("scope-b", 200, p2);

    expect(cache.get("scope-a", 100)).toEqual(p1);
    expect(cache.get("scope-b", 200)).toEqual(p2);
  });

  it("invalidate() removes all entries with matching scopeId prefix", () => {
    const p = makePolicy({ target_id: "scope-x" });
    cache.set("scope-x", 100, p);
    cache.set("scope-x", 200, p); // two entries for same scope
    cache.set("scope-y", 100, makePolicy({ target_id: "scope-y" }));

    cache.invalidate("scope-x");

    expect(cache.get("scope-x", 100)).toBeUndefined();
    expect(cache.get("scope-x", 200)).toBeUndefined();
    // scope-y should still exist
    expect(cache.get("scope-y", 100)).toBeDefined();
  });

  it("clear() removes all entries", () => {
    cache.set("scope-a", 100, makePolicy());
    cache.set("scope-b", 200, makePolicy());
    cache.clear();

    expect(cache.get("scope-a", 100)).toBeUndefined();
    expect(cache.get("scope-b", 200)).toBeUndefined();
  });

  it("respects max size (LRU eviction evicts oldest entry)", () => {
    // max = 3 for this test
    const smallCache = new PolicyCache({ max: 3 });
    const p = makePolicy();
    smallCache.set("s1", 1, p);
    smallCache.set("s2", 1, p);
    smallCache.set("s3", 1, p);
    // Adding 4th entry should evict oldest (s1)
    smallCache.set("s4", 1, p);

    expect(smallCache.get("s4", 1)).toBeDefined();
    // s1 should have been evicted (LRU)
    expect(smallCache.get("s1", 1)).toBeUndefined();
  });

  it("overwrites an existing entry when set with same key", () => {
    const p1 = makePolicy({ tone: "neutral" });
    const p2 = makePolicy({ tone: "warm" });
    cache.set("scope-z", 500, p1);
    cache.set("scope-z", 500, p2); // overwrite
    expect(cache.get("scope-z", 500)?.tone).toBe("warm");
  });
});
