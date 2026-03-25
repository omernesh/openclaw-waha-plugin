import { describe, it, expect } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter maxQueue", () => {
  it("maxQueue defaults to Infinity — unbounded queue works as before", async () => {
    const limiter = new RateLimiter(1, 0);
    // Acquire 1 slot (active)
    const first = limiter.acquire();
    await first;

    // Queue 10 more — should all succeed (no maxQueue limit)
    const queued: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      queued.push(limiter.acquire());
    }

    // Release slots one at a time, verify all resolve
    for (let i = 0; i < 10; i++) {
      limiter.release();
    }
    // Final release for the first acquire
    limiter.release();

    // All queued acquires should resolve without error
    await Promise.all(queued);
  });

  it("maxQueue rejects when queue is full", async () => {
    const limiter = new RateLimiter(1, 0, 2);
    // Acquire 1 slot (active)
    await limiter.acquire();

    // Queue 2 more (fills queue to maxQueue=2)
    const q1 = limiter.acquire();
    const q2 = limiter.acquire();

    // 4th acquire should reject — queue is full
    await expect(limiter.acquire()).rejects.toThrow("Rate limiter queue full (maxQueue=2)");

    // Cleanup: release all
    limiter.release();
    limiter.release();
    limiter.release();
    await Promise.all([q1, q2]);
  });

  it("maxQueue allows exactly maxQueue items in queue", async () => {
    const limiter = new RateLimiter(1, 0, 1);
    // Acquire 1 slot (active)
    await limiter.acquire();

    // Queue 1 more (fills queue to maxQueue=1) — should succeed
    const q1 = limiter.acquire();

    // 3rd acquire should reject — queue is full at 1
    await expect(limiter.acquire()).rejects.toThrow("Rate limiter queue full (maxQueue=1)");

    // Cleanup
    limiter.release();
    limiter.release();
    await q1;
  });

  it("release drains queue and allows new entries", async () => {
    const limiter = new RateLimiter(1, 0, 1);
    // Acquire 1 slot (active)
    await limiter.acquire();

    // Queue 1 (fills queue)
    const q1 = limiter.acquire();

    // Release — drains q1 from queue, making room
    limiter.release();
    await q1;

    // Now queue should have space again — this should succeed
    const q2 = limiter.acquire();

    // Cleanup
    limiter.release();
    limiter.release();
    await q2;
  });
});
