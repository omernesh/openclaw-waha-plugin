// Memory audit (REL-11, 2026-03-11):
// All Maps bounded: _resolveCache (LRU max:1000, ttl:30s in send.ts),
// _dedupEntries (max:200 + 5min TTL in dedup.ts),
// _dmFilterInstance/_groupFilterInstance/_directoryInstances (by account count in inbound.ts/directory.ts),
// _regexCache (by config pattern count in dm-filter.ts),
// TokenBucket.queue (bounded by concurrency). No unbounded growth found.

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  HTTP CLIENT — DO NOT CHANGE                                        ║
// ║                                                                     ║
// ║  Central HTTP client for ALL WAHA API calls. Every outbound call    ║
// ║  flows through callWahaApi(). This is the single chokepoint where   ║
// ║  timeout, rate limiting, 429 retry, and structured logging compose. ║
// ║                                                                     ║
// ║  Extracted from send.ts in Phase 1, Plan 01 (2026-03-11).          ║
// ║  All 60+ functions in send.ts import callWahaApi from here.         ║
// ║                                                                     ║
// ║  DO NOT move callWahaApi back to send.ts.                           ║
// ║  DO NOT remove timeout, rate limiting, or retry logic.              ║
// ║  DO NOT change the function signature (callers depend on it).       ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ---------------------------------------------------------------------------
// Token Bucket Rate Limiter
// ---------------------------------------------------------------------------

/**
 * Token bucket rate limiter. Limits outbound requests to prevent flooding WAHA.
 * Default: 20 burst capacity, refilling at 15 tokens/sec.
 * Exported for testing and for Phase 4 per-session buckets.
 */
export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;

  constructor(capacity = 20, refillRate = 15) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRate;
    if (newTokens > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }

  private startDrain(): void {
    if (this.drainTimer !== null) return;
    const intervalMs = Math.ceil(1000 / this.refillRate);
    this.drainTimer = setInterval(() => {
      this.refill();
      while (this.queue.length > 0 && this.tokens >= 1) {
        this.tokens -= 1;
        const resolve = this.queue.shift()!;
        resolve();
      }
      if (this.queue.length === 0 && this.drainTimer !== null) {
        clearInterval(this.drainTimer);
        this.drainTimer = null;
      }
    }, intervalMs);
    // Unref the timer so it doesn't keep the process alive
    if (typeof this.drainTimer === "object" && this.drainTimer && "unref" in this.drainTimer) {
      (this.drainTimer as NodeJS.Timeout).unref();
    }
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.startDrain();
    });
  }
}

// ---------------------------------------------------------------------------
// Module-level shared state
// ---------------------------------------------------------------------------

/** Global token bucket for all WAHA API calls (20 burst, 15/sec sustained). */
let globalBucket = new TokenBucket(20, 15);

/** Default timeout for API calls (ms). Overridable via configureReliability(). */
let defaultTimeoutMs = 30_000;

/**
 * Configure reliability defaults from plugin config.
 * Call during plugin startup (channel.ts) with values from WahaAccountConfig.
 * Re-creates the global token bucket with new capacity/rate.
 *
 * Added in Phase 1, Plan 03 (2026-03-11). DO NOT REMOVE.
 */
export function configureReliability(opts: {
  timeoutMs?: number;
  capacity?: number;
  refillRate?: number;
}): void {
  if (opts.timeoutMs !== undefined) {
    defaultTimeoutMs = opts.timeoutMs;
  }
  if (opts.capacity !== undefined || opts.refillRate !== undefined) {
    const cap = opts.capacity ?? globalBucket["capacity"];
    const rate = opts.refillRate ?? globalBucket["refillRate"];
    globalBucket = new TokenBucket(cap, rate);
  }
}

/**
 * Shared backoff timestamp. When a 429 is received, all pending calls
 * wait until this time before proceeding.
 */
let backoffUntil = 0;

// ---------------------------------------------------------------------------
// callWahaApi — the core HTTP client with reliability features
// ---------------------------------------------------------------------------

export interface CallWahaApiParams {
  baseUrl: string;
  apiKey: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  /** Reliability metadata for structured logging. */
  context?: { action?: string; chatId?: string };
  /** If true, skip the token bucket rate limiter. */
  skipRateLimit?: boolean;
  /** Timeout in milliseconds. Default: 30000 (30s). */
  timeoutMs?: number;
}

/**
 * Central HTTP client for all WAHA API calls.
 *
 * Layers (in order):
 * 1. Rate limit (token bucket) — unless skipRateLimit
 * 2. Shared backoff check — waits for any active 429 backoff
 * 3. Fetch with AbortSignal.timeout
 * 4. Timeout error handling — mutations get "may have succeeded" warning
 * 5. 429 handling — exponential backoff with jitter, max 3 retries
 * 6. Error logging — structured console.warn with context
 * 7. Response parsing — JSON or text
 */
export async function callWahaApi(params: CallWahaApiParams): Promise<any> {
  const method = params.method ?? "POST";
  const timeout = params.timeoutMs ?? defaultTimeoutMs;
  const ctx = params.context ?? {};
  const contextLabel = `${ctx.action ?? method} ${ctx.chatId ?? ""}`.trim();

  // 1. Rate limit
  if (!params.skipRateLimit) {
    await globalBucket.acquire();
  }

  // 2. Shared backoff check
  await waitForBackoffClear();

  // 3-7: Fetch with retry logic
  return fetchWithRetry(params, method, timeout, contextLabel, 0);
}

const MAX_RETRIES = 3;

async function fetchWithRetry(
  params: CallWahaApiParams,
  method: string,
  timeout: number,
  contextLabel: string,
  attempt: number,
): Promise<any> {
  // Build URL
  const url = new URL(params.path, params.baseUrl);
  if (params.query) {
    for (const [k, v] of Object.entries(params.query)) {
      url.searchParams.set(k, v);
    }
  }

  const hasBody = method !== "GET" && method !== "DELETE" && params.body;
  const isMutation = method !== "GET";

  let response: Response;
  try {
    // 3. Fetch with timeout
    response = await fetch(url.toString(), {
      method,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(params.apiKey ? { "x-api-key": params.apiKey } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(params.body) } : {}),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err: any) {
    // 4. Timeout error handling
    if (err?.name === "TimeoutError" || err?.name === "AbortError" || err?.message?.includes("abort")) {
      if (isMutation) {
        throw new Error(
          `[WAHA] ${contextLabel} timed out after ${timeout}ms — request may have succeeded (mutation: ${method} ${params.path})`
        );
      }
      throw new Error(
        `[WAHA] ${contextLabel} timed out after ${timeout}ms (${method} ${params.path})`
      );
    }
    throw err;
  }

  // 5. Handle 429 — retry with exponential backoff
  if (response.status === 429) {
    if (attempt >= MAX_RETRIES) {
      console.warn(`[WAHA] ${contextLabel} rate limited after ${MAX_RETRIES} retries`);
      throw new Error(
        `[WAHA] ${contextLabel} rate limited (429 Too Many Requests) after ${MAX_RETRIES} retries`
      );
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : 0;
    const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
    const jitter = baseDelay * (0.75 + Math.random() * 0.5); // +/-25%
    const delay = Math.max(jitter, retryAfterSec * 1000);
    const cappedDelay = Math.min(delay, 30_000);

    // Set shared backoff state so other calls wait
    backoffUntil = Date.now() + cappedDelay;

    console.warn(
      `[WAHA] ${contextLabel} got 429, retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(cappedDelay)}ms`
    );

    await sleep(cappedDelay);
    return fetchWithRetry(params, method, timeout, contextLabel, attempt + 1);
  }

  // 6. Error logging
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.warn(
      `[WAHA] ${contextLabel} failed: ${response.status} ${errorText}`
    );
    throw new Error(
      `WAHA ${method} ${params.path} failed: ${response.status} ${errorText}`
    );
  }

  // 7. Response parsing
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  return await response.text();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait until any shared 429 backoff period has elapsed. */
async function waitForBackoffClear(): Promise<void> {
  const remaining = backoffUntil - Date.now();
  if (remaining > 0) {
    await sleep(remaining);
  }
}

/** Promise-based sleep using setTimeout (works with fake timers). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns a catch handler that logs a warning with context.
 * Use to replace `.catch(() => {})` patterns throughout the codebase.
 *
 * Usage: somePromise.catch(warnOnError("presence update"))
 */
export function warnOnError(context: string): (err: Error) => void {
  return (err: Error) => {
    console.warn(`[WAHA] ${context}: ${err.message}`);
  };
}

/**
 * Reset module-level shared state. For testing only.
 * DO NOT call in production code.
 */
export function _resetForTesting(): void {
  backoffUntil = 0;
  defaultTimeoutMs = 30_000;
  globalBucket = new TokenBucket(20, 15);
}
