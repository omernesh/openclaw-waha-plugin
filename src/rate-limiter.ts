// ── RateLimiter ──────────────────────────────────────────────────────
// Shared rate limiter for WAHA API calls. DO NOT CHANGE.
// Extracted from monitor.ts/sync.ts (Phase review, 2026-03-17).

/**
 * Simple rate limiter — limits concurrent requests and enforces minimum delay between requests.
 */
export class RateLimiter {
  private queue: Array<() => void> = [];
  private activeCount = 0;
  private lastRequestTime = 0;

  constructor(
    private maxConcurrent: number,
    private delayMs: number,
  ) {}

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs - elapsed));
      }
      this.lastRequestTime = Date.now();
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.activeCount++;
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < this.delayMs) {
          setTimeout(() => {
            this.lastRequestTime = Date.now();
            resolve();
          }, this.delayMs - elapsed);
        } else {
          this.lastRequestTime = Date.now();
          resolve();
        }
      });
    });
  }

  release(): void {
    this.activeCount--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
