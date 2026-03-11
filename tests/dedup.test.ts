import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isDuplicate, _resetDedupForTesting, _getDedupSizeForTesting } from "../src/dedup.js";

describe("isDuplicate (webhook deduplication)", () => {
  beforeEach(() => {
    _resetDedupForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false for first occurrence of eventType:messageId", () => {
    expect(isDuplicate("message", "msg-001")).toBe(false);
  });

  it("returns true for second occurrence of same eventType:messageId", () => {
    isDuplicate("message", "msg-001");
    expect(isDuplicate("message", "msg-001")).toBe(true);
  });

  it("returns false for same messageId with different eventType (composite key)", () => {
    isDuplicate("message", "msg-001");
    // Same messageId but different eventType should NOT be a duplicate
    expect(isDuplicate("message.any", "msg-001")).toBe(false);
  });

  it("returns false for entries older than 5 minutes (TTL expiry)", () => {
    isDuplicate("message", "msg-001");
    expect(isDuplicate("message", "msg-001")).toBe(true);

    // Advance 5 minutes + 1ms
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Fill past DEDUP_MAX to trigger pruning
    for (let i = 0; i < 201; i++) {
      isDuplicate("message", `filler-${i}`);
    }

    // Original entry should have been pruned
    expect(isDuplicate("message", "msg-001")).toBe(false);
  });

  it("prunes entries when size exceeds 200", () => {
    // Set time far in the past for first batch
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    // Fill with 201 entries (all with old timestamps)
    for (let i = 0; i < 201; i++) {
      isDuplicate("message", `old-${i}`);
    }
    expect(_getDedupSizeForTesting()).toBe(201);

    // Advance past TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Next call triggers pruning (size > DEDUP_MAX)
    isDuplicate("message", "new-entry");

    // All old entries should be pruned, only "new-entry" remains
    expect(_getDedupSizeForTesting()).toBe(1);
  });

  it("returns false when messageId is empty string", () => {
    expect(isDuplicate("message", "")).toBe(false);
    // Calling again with empty should still be false (not tracked)
    expect(isDuplicate("message", "")).toBe(false);
  });

  it("returns false when messageId is undefined", () => {
    expect(isDuplicate("message", undefined)).toBe(false);
    expect(isDuplicate("message", undefined)).toBe(false);
  });
});
