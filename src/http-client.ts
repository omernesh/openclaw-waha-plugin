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
const MAX_QUEUE_SIZE = 1000;

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

  getCapacity(): number { return this.capacity; }
  getRefillRate(): number { return this.refillRate; }

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
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      throw new Error("[WAHA] Rate limit queue full, rejecting request");
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.startDrain();
    });
  }
}

// ---------------------------------------------------------------------------
// MutationDedup — duplicate mutation suppression
// ---------------------------------------------------------------------------

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  MutationDedup — DO NOT CHANGE                                      ║
// ║                                                                     ║
// ║  Prevents duplicate WhatsApp sends when the gateway retries after   ║
// ║  a WAHA API timeout. When a POST times out (after 30s), the         ║
// ║  message likely DID send but WAHA couldn't confirm. The gateway     ║
// ║  then retries the action, causing the plugin to re-send the same    ║
// ║  message 2-3 times.                                                 ║
// ║                                                                     ║
// ║  Fix: after a timeout on a mutation (POST/PUT/DELETE), mark the     ║
// ║  mutation key as pending. If the same mutation is attempted again   ║
// ║  within the TTL window, throw immediately with a clear error.       ║
// ║                                                                     ║
// ║  Added: quick task 1, 2026-03-15                                    ║
// ║                                                                     ║
// ║  DO NOT remove this class.                                          ║
// ║  DO NOT disable the dedup check in callWahaApi.                     ║
// ║  DO NOT reduce the TTL below the gateway retry window.              ║
// ╚══════════════════════════════════════════════════════════════════════╝

const DEDUP_TTL_MS = 60_000; // 1 minute — covers gateway retry window
const DEDUP_MAX_ENTRIES = 500;
const DJB2_SEED = 5381;

class MutationDedup {
  private readonly pending = new Map<string, number>();

  /**
   * Build a stable dedup key for a mutation request.
   * Returns null for GET requests (not mutations, never deduplicated).
   */
  buildKey(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: Record<string, unknown>): string | null {
    if (method === "GET") return null;
    const effectiveBody = method !== "DELETE" ? body : undefined;
    const bodyHash = this.hashBody(effectiveBody);
    return `${method}:${path}:${bodyHash}`;
  }

  /**
   * Returns true if the key is currently pending (timed-out mutation within TTL).
   * Also opportunistically prunes expired entries.
   */
  isPending(key: string): boolean {
    this.pruneExpired();
    const ts = this.pending.get(key);
    if (ts === undefined) return false;
    return Date.now() - ts < DEDUP_TTL_MS;
  }

  /**
   * Mark a mutation key as pending after a timeout.
   * Enforces max-entry bound by pruning expired entries first, then oldest if still over limit.
   */
  markPending(key: string): void {
    this.pruneExpired();
    // If still at max after pruning expired, remove oldest entry
    if (this.pending.size >= DEDUP_MAX_ENTRIES) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    this.pending.set(key, Date.now());
  }

  /** Clear all entries. Used by _resetForTesting(). */
  clear(): void {
    this.pending.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    for (const [key, ts] of this.pending) {
      if (now - ts >= DEDUP_TTL_MS) toDelete.push(key);
    }
    for (const key of toDelete) this.pending.delete(key);
  }

  /**
   * Stable hash of request body. Sorts keys for determinism.
   * Simple djb2-like string hash — no crypto needed.
   */
  private hashBody(body?: Record<string, unknown>): string {
    if (!body) return "empty";
    // Recursive replacer: sorts keys at every level of nesting.
    // A string-array replacer only filters top-level keys and strips nested
    // objects entirely, causing different nested bodies to hash identically.
    const sortedReplacer = (_key: string, value: unknown): unknown => {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        return Object.fromEntries(
          Object.keys(obj).sort().map((k) => [k, obj[k]])
        );
      }
      return value;
    };
    let stable: string;
    try {
      stable = JSON.stringify(body, sortedReplacer);
    } catch {
      log.warn("MutationDedup: could not hash body (circular reference or non-serializable value) — dedup skipped for this call");
      return "unstable";
    }
    let h = DJB2_SEED;
    for (let i = 0; i < stable.length; i++) {
      h = ((h << 5) + h) ^ stable.charCodeAt(i);
      h = h & h; // h & h coerces to 32-bit signed int (equivalent to h | 0)
    }
    return `${(h >>> 0).toString(16)}_${stable.length}`;
  }
}

/** Module-level singleton. Cleared by _resetForTesting(). */
const mutationDedup = new MutationDedup();

// ---------------------------------------------------------------------------
// Module-level shared state
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000; // Maximum retry backoff cap (separate from request timeout)
const DEFAULT_BUCKET_CAPACITY = 20;
const DEFAULT_BUCKET_REFILL_RATE = 15;
const MAX_RETRIES = 3;

/** Global token bucket for all WAHA API calls (20 burst, 15/sec sustained). */
let globalBucket = new TokenBucket(DEFAULT_BUCKET_CAPACITY, DEFAULT_BUCKET_REFILL_RATE);

/** Default timeout for API calls (ms). Overridable via configureReliability(). */
let defaultTimeoutMs = DEFAULT_TIMEOUT_MS;

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
    const cap = opts.capacity ?? globalBucket.getCapacity();
    const rate = opts.refillRate ?? globalBucket.getRefillRate();
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
 * 6. Error logging — structured log.warn with context
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

  // 2b. Mutation dedup check — suppress retries of timed-out mutations
  // DO NOT REMOVE: prevents duplicate sends when gateway retries after timeout
  let dedupKey: string | null = null;
  try {
    dedupKey = mutationDedup.buildKey(method, params.path, params.body);
  } catch {
    log.warn("MutationDedup: buildKey failed — dedup skipped", { method, path: params.path });
  }
  if (dedupKey !== null && mutationDedup.isPending(dedupKey)) {
    const warnMsg = `Duplicate mutation suppressed (original timed out, may have already succeeded): ${method} ${params.path}`;
    try { log.warn(warnMsg, { method, path: params.path }); } catch { /* logging must not prevent throw */ }
    throw new Error(warnMsg);
  }

  // 3-7: Fetch with retry logic
  return fetchWithRetry(params, method, timeout, contextLabel, dedupKey, 0);
}

async function fetchWithRetry(
  params: CallWahaApiParams,
  method: "GET" | "POST" | "PUT" | "DELETE",
  timeout: number,
  contextLabel: string,
  dedupKey: string | null,
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
  } catch (err: unknown) {
    // 4. Timeout error handling
    const errName = err instanceof Error ? err.name : String(err);
    if (errName === "TimeoutError" || errName === "AbortError") {
      if (isMutation) {
        // DO NOT REMOVE: mark mutation as pending so gateway retries are suppressed
        if (dedupKey !== null) {
          mutationDedup.markPending(dedupKey);
        }
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
      log.warn("rate limited after max retries", { context: contextLabel, retries: MAX_RETRIES });
      throw new Error(
        `[WAHA] ${contextLabel} rate limited (429 Too Many Requests) after ${MAX_RETRIES} retries`
      );
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : 0;
    const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
    const jitter = baseDelay * (0.75 + Math.random() * 0.5); // +/-25%
    const delay = Math.max(jitter, retryAfterSec * 1000);
    const cappedDelay = Math.min(delay, MAX_BACKOFF_MS);

    // Set shared backoff state so other calls wait
    backoffUntil = Date.now() + cappedDelay;

    log.warn("got 429, retrying", { context: contextLabel, retry: attempt + 1, maxRetries: MAX_RETRIES, delayMs: Math.round(cappedDelay) });

    await sleep(cappedDelay);
    return fetchWithRetry(params, method, timeout, contextLabel, dedupKey, attempt + 1);
  }

  // 6. Error logging
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    log.warn("API call failed", { context: contextLabel, status: response.status, error: errorText });
    throw new Error(
      `WAHA ${method} ${params.path} failed: ${response.status} ${errorText}`
    );
  }

  // 7. Response parsing
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch (parseErr) {
      throw new Error(`[WAHA] Failed to parse JSON from ${method} ${params.path}: ${String(parseErr)}`);
    }
  }
  try {
    return await response.text();
  } catch (textErr) {
    throw new Error(`[WAHA] Failed to read text response from ${method} ${params.path}: ${String(textErr)}`);
  }
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
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns a catch handler that logs a warning with context.
 * Use to replace `.catch(() => {})` patterns throughout the codebase.
 *
 * Usage: somePromise.catch(warnOnError("presence update"))
 */
export function warnOnError(context: string, extra?: string): (err: unknown) => void {
  return (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(context, { detail: extra ?? undefined, error: msg });
  };
}

/**
 * Reset module-level shared state. For testing only.
 * DO NOT call in production code.
 */
export function _resetForTesting(): void {
  backoffUntil = 0;
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS;
  globalBucket = new TokenBucket(DEFAULT_BUCKET_CAPACITY, DEFAULT_BUCKET_REFILL_RATE);
  mutationDedup.clear();
}
