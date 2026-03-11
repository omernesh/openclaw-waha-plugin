import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenBucket } from "../src/http-client.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acquire() resolves immediately when tokens available", async () => {
    const bucket = new TokenBucket(5, 5);
    // Should resolve without needing to advance time
    const p = bucket.acquire();
    await expect(p).resolves.toBeUndefined();
  });

  it("acquire() queues when no tokens available, resolves after refill", async () => {
    const bucket = new TokenBucket(1, 1); // 1 token capacity, 1/sec refill
    // First acquire uses the token
    await bucket.acquire();
    // Second acquire should queue
    let resolved = false;
    const p = bucket.acquire().then(() => { resolved = true; });
    // Not resolved yet
    expect(resolved).toBe(false);
    // Advance time enough for 1 token to refill (1 second)
    await vi.advanceTimersByTimeAsync(1100);
    await p;
    expect(resolved).toBe(true);
  });

  it("respects capacity and refillRate configuration", async () => {
    const bucket = new TokenBucket(3, 10); // 3 capacity, 10/sec refill
    // Drain all 3 tokens
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    // 4th should queue
    let resolved = false;
    const p = bucket.acquire().then(() => { resolved = true; });
    expect(resolved).toBe(false);
    // At 10/sec, one token every 100ms
    await vi.advanceTimersByTimeAsync(150);
    await p;
    expect(resolved).toBe(true);
  });
});
