# Phase 1: Reliability Foundation - Research

**Researched:** 2026-03-11
**Domain:** HTTP client reliability (timeouts, rate limiting, retry, caching, deduplication)
**Confidence:** HIGH

## Summary

Phase 1 wraps all outbound WAHA API calls with reliability primitives by extracting `callWahaApi()` from `send.ts` into a new `src/http-client.ts` module. The extracted function becomes the composition point for timeouts (`AbortSignal.timeout`), rate limiting (token bucket), retry with exponential backoff (429 only), and structured error logging. The resolve target cache (`_resolveCache`) is replaced with `lru-cache` v11, and webhook deduplication is added to `monitor.ts`.

The codebase is well-suited for this work: `callWahaApi()` is the single chokepoint for all 103 call sites in `send.ts`. The function signature is clean (6 parameters, all in a single object). Node.js 22 provides native `AbortSignal.timeout()` support. The main risk is the brittle nature of `send.ts` with its DO NOT CHANGE markers -- extraction must preserve all existing behavior exactly.

**Primary recommendation:** Extract `callWahaApi` to `http-client.ts` with a re-export shim in `send.ts`, then layer timeout/rate-limit/retry/logging as middleware-style wrappers inside the extracted function. Touch `send.ts` minimally -- only the extraction cut and `.catch(() => {})` replacements.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Extract `callWahaApi()` from send.ts into new `src/http-client.ts` module
- Leave a thin re-export wrapper in send.ts so all 60+ downstream functions work with zero changes
- Use built-in `AbortSignal.timeout(30_000)` for request timeouts -- zero dependencies
- 30s default timeout, configurable via plugin config
- On timeout for mutation endpoints (send, edit, delete): return "may have succeeded" warning, do NOT retry
- On timeout for read endpoints (get, list, search): safe to retry once
- Replace ALL ~20 `.catch(() => {})` patterns with `console.warn` including: action name, chatId, HTTP status, error message
- Fire-and-forget calls (presence, typing, seen) get warning logs, not thrown errors
- Format: `[WAHA] ${action} ${chatId} failed: ${status} ${message}`
- Custom token bucket implementation (~60 lines) in `http-client.ts`
- Default: 20 tokens/sec capacity, refill at 15/sec
- Fire-and-forget calls (presence, typing) exempt from rate limiter
- Per-session bucket design (supports multi-session in Phase 4)
- Exponential backoff with jitter: 1s -> 2s -> 4s, max 3 retries, cap at 30s
- Read `Retry-After` header when present
- Shared backoff state -- one 429 pauses all pending calls
- Only retry on 429 status
- Composite dedup key: `${eventType}:${messageId}` -- NOT just messageId alone
- Sliding window Set of last 200 entries with 5-minute TTL
- Use `lru-cache` npm package v11.2.6 -- NOT custom implementation
- Replace unbounded `Map` in resolveTarget cache: max 1000 entries, 30s TTL

### Claude's Discretion
- Exact token bucket implementation details (sliding window vs fixed window)
- Error message formatting beyond the specified pattern
- Whether to add circuit breaker pattern (research suggested it, not required)
- Exact jitter algorithm for backoff
- Internal module organization within http-client.ts

### Deferred Ideas (OUT OF SCOPE)
- Circuit breaker pattern -- consider in Phase 2 if needed
- Per-session rate limit buckets -- design for it now, implement in Phase 4
- Admin panel rate limit metrics -- Phase 2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REL-01 | Structured error logging with action name, chatId, error context | Enhance `callWahaApi` error path with structured log format; add `context` param to callWahaApi for action/chatId metadata |
| REL-02 | Replace silent `.catch(() => {})` with warning logs | 28 instances identified across send.ts (3), presence.ts (14), inbound.ts (7), monitor.ts (4); presence/typing/seen get `console.warn`, media cleanup stays silent |
| REL-03 | 30s AbortController-based timeouts on all fetch() calls | `AbortSignal.timeout(30_000)` in http-client.ts `fetch()` call; Node 22 native support confirmed |
| REL-04 | Mutation timeout returns "may have succeeded" warning | Detect method (POST/PUT/DELETE) as mutation; on TimeoutError for mutations, throw descriptive error without retry |
| REL-05 | Token-bucket rate limiter on outbound calls | Custom token bucket in http-client.ts; 20 tokens/sec, refill 15/sec; queue excess requests |
| REL-06 | Fire-and-forget calls exempt from rate limiter | Add `priority` or `skipRateLimit` option to callWahaApi params; presence/typing/seen paths pass this flag |
| REL-07 | Exponential backoff with jitter on 429 | Retry loop in http-client.ts: 1s, 2s, 4s base delays + random jitter; max 3 retries |
| REL-08 | Read Retry-After header from 429 responses | Parse `Retry-After` header (seconds or HTTP-date); use as minimum delay floor |
| REL-09 | Webhook dedup by composite key | Add dedup Set in monitor.ts webhook handler; key = `${event}:${messageId}`; 200-entry sliding window, 5-min TTL |
| REL-10 | LRU cache for resolveTarget | Replace `_resolveCache = new Map()` with `new LRUCache({ max: 1000, ttl: 30_000 })`; add `lru-cache` to package.json |
| REL-11 | Memory audit for unbounded growth | Audit all `new Map()` instances; verify `_dmFilterInstance`, `_groupFilterInstance`, `_directoryInstances` are bounded by account count (safe); verify no event listener leaks |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| lru-cache | 11.2.6 | Bounded cache with TTL and LRU eviction | isaacs (npm creator), 170M+ weekly downloads, TypeScript native, ESM+CJS dual |
| Node.js built-in | 22.x | AbortSignal.timeout, fetch, AbortController | Zero dependencies, native performance, stable API |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | - | Token bucket and dedup are simple enough for inline implementation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| lru-cache | Custom Map+TTL | Locked decision: lru-cache handles edge cases (dispose callbacks, TTL autopurge) that custom code misses |
| Custom token bucket | p-queue / bottleneck | Locked decision: custom is ~60 lines, avoids ESM compatibility risk with OpenClaw plugin loader |
| AbortSignal.timeout | node-fetch + AbortController manual | AbortSignal.timeout is one line vs 10+ lines of manual timer management |

**Installation:**
```bash
npm install lru-cache@11.2.6
```

## Architecture Patterns

### New Module: `src/http-client.ts`

```
src/
├── http-client.ts   # NEW: callWahaApi + timeout + rate limiter + retry + logging
├── send.ts          # MODIFIED: remove callWahaApi body, re-export from http-client
├── inbound.ts       # UNCHANGED (presence .catch replacements are in presence.ts)
├── monitor.ts       # MODIFIED: add webhook dedup check
├── presence.ts      # MODIFIED: .catch(() => {}) -> .catch(warnLog)
└── (all others)     # UNCHANGED
```

### Pattern 1: Middleware Composition in callWahaApi

**What:** Layer reliability features as sequential steps inside callWahaApi rather than wrapping it externally.
**When to use:** When a single function is the chokepoint for all API calls.
**Example:**

```typescript
// src/http-client.ts
import { LRUCache } from 'lru-cache';

interface CallWahaApiParams {
  baseUrl: string;
  apiKey: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  // NEW: reliability metadata
  context?: { action?: string; chatId?: string };
  skipRateLimit?: boolean;
  timeoutMs?: number;
}

export async function callWahaApi(params: CallWahaApiParams) {
  const method = params.method ?? "POST";
  const isMutation = method !== "GET";
  const timeoutMs = params.timeoutMs ?? 30_000;

  // 1. Rate limit (unless exempt)
  if (!params.skipRateLimit) {
    await acquireToken(/* session bucket */);
  }

  // 2. Check shared backoff state (429 cooldown)
  await waitForBackoffClear();

  // 3. Fetch with timeout
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: { /* ... */ },
      body: /* ... */,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      const msg = isMutation
        ? `WAHA ${method} ${params.path} timed out after ${timeoutMs}ms — operation may have succeeded`
        : `WAHA ${method} ${params.path} timed out after ${timeoutMs}ms`;
      console.warn(`[WAHA] ${params.context?.action ?? method} ${params.context?.chatId ?? ""} timeout: ${msg}`);
      throw new Error(msg);
    }
    throw err;
  }

  // 4. Handle 429 with retry
  if (response.status === 429) {
    return await retryWith429Backoff(params, response);
  }

  // 5. Handle other errors with structured logging
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const msg = `WAHA ${method} ${params.path} failed: ${response.status} ${errorText}`;
    console.warn(`[WAHA] ${params.context?.action ?? method} ${params.context?.chatId ?? ""} failed: ${response.status} ${errorText}`);
    throw new Error(msg);
  }

  // 6. Parse response
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return await response.json();
  return await response.text();
}
```

### Pattern 2: Re-export Shim in send.ts

**What:** Keep `callWahaApi` importable from send.ts for backward compatibility.
**When to use:** When extracting a function used extensively within the same module.

```typescript
// At top of send.ts, replacing the old function body:
export { callWahaApi } from "./http-client.js";
// Or if callWahaApi is not currently exported (it's not — it's module-private):
import { callWahaApi } from "./http-client.js";
// All 103 call sites in send.ts continue to work unchanged.
```

### Pattern 3: Fire-and-Forget Warning Log

**What:** Replace `.catch(() => {})` with a warning log helper.
**When to use:** For presence, typing, seen calls that should not throw but should log.

```typescript
// In http-client.ts or a shared util:
export function warnOnError(context: string) {
  return (err: unknown) => {
    console.warn(`[WAHA] ${context}: ${err instanceof Error ? err.message : String(err)}`);
  };
}

// Usage in presence.ts (replacing .catch(() => {})):
await sendWahaPresence({ cfg, chatId, typing: false, accountId })
  .catch(warnOnError(`presence stop-typing ${chatId}`));
```

### Pattern 4: Token Bucket Rate Limiter

**What:** Simple token bucket with async queue for excess requests.
**When to use:** Proactive rate limiting before hitting API limits.

```typescript
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];

  constructor(
    private capacity: number = 20,
    private refillRate: number = 15, // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Queue and wait
    return new Promise((resolve) => {
      this.queue.push(resolve);
      setTimeout(() => this.drain(), 1000 / this.refillRate);
    });
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  private drain() {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()!();
    }
  }
}
```

### Pattern 5: 429 Backoff with Shared State

**What:** Exponential backoff that pauses all pending requests on 429.
**When to use:** As safety net when proactive rate limiting is insufficient.

```typescript
let backoffUntil = 0; // shared across all calls

async function waitForBackoffClear(): Promise<void> {
  const remaining = backoffUntil - Date.now();
  if (remaining > 0) {
    await new Promise(r => setTimeout(r, remaining));
  }
}

async function retryWith429Backoff(
  params: CallWahaApiParams,
  initialResponse: Response,
  attempt = 0,
): Promise<unknown> {
  if (attempt >= 3) {
    throw new Error(`WAHA ${params.path} rate limited after 3 retries`);
  }

  // Read Retry-After header
  const retryAfter = initialResponse.headers.get("retry-after");
  let delayMs: number;
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    delayMs = isNaN(seconds) ? (1000 * Math.pow(2, attempt)) : seconds * 1000;
  } else {
    delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
  }
  // Add jitter: +/- 25%
  delayMs += delayMs * (Math.random() * 0.5 - 0.25);
  delayMs = Math.min(delayMs, 30_000); // cap at 30s

  // Set shared backoff state
  backoffUntil = Date.now() + delayMs;

  await new Promise(r => setTimeout(r, delayMs));

  // Retry the request
  return callWahaApi({ ...params, _retryAttempt: attempt + 1 });
}
```

### Pattern 6: Webhook Deduplication

**What:** Sliding window dedup with composite key in webhook handler.
**When to use:** Before processing any inbound webhook event.

```typescript
// In monitor.ts
const DEDUP_MAX = 200;
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

const _dedupEntries = new Map<string, number>(); // key -> timestamp

function isDuplicate(eventType: string, messageId: string): boolean {
  if (!messageId) return false;
  const key = `${eventType}:${messageId}`;

  // Prune expired entries periodically
  if (_dedupEntries.size > DEDUP_MAX) {
    const now = Date.now();
    for (const [k, ts] of _dedupEntries) {
      if (now - ts > DEDUP_TTL_MS) _dedupEntries.delete(k);
    }
  }

  if (_dedupEntries.has(key)) return true;
  _dedupEntries.set(key, Date.now());
  return false;
}
```

### Anti-Patterns to Avoid

- **Wrapping callWahaApi externally:** Do NOT create a `reliableCallWahaApi` wrapper that callers must opt into. The reliability must be inside `callWahaApi` itself so all 60+ functions get it for free.
- **Retrying mutations on timeout:** A POST that timed out may have succeeded server-side. Retrying could send duplicate messages. Always warn "may have succeeded" instead.
- **Retrying non-429 errors:** The gateway handles upstream retries. Double-retry at the plugin level creates retry storms. Only 429 gets plugin-level retry.
- **Per-message-ID-only dedup:** Different event types (message, message.reaction, poll.vote) can share the same messageId. Must use composite key.
- **Blocking presence calls on rate limiter:** Presence/typing are visual polish, not functional. They must not consume tokens that user-facing sends need.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LRU cache | Custom Map with eviction | `lru-cache` v11.2.6 | Handles TTL autopurge, dispose callbacks, size-based eviction, tested edge cases |
| Fetch timeout | Manual AbortController + setTimeout | `AbortSignal.timeout(30_000)` | One line, auto-cleanup, no timer leak risk |

**Key insight:** Token bucket (~60 lines) and dedup (~20 lines) are simple enough to hand-roll. LRU cache and timeout are not -- they have subtle edge cases (timer cleanup, entry disposal) where libraries prevent bugs.

## Common Pitfalls

### Pitfall 1: Mutation Timeout False Failure
**What goes wrong:** A POST to /api/sendText times out at 30s, but the message was actually sent. If you retry, the user gets a duplicate message.
**Why it happens:** Network timeout != server failure. The server may have processed the request but the response was slow.
**How to avoid:** Never retry POST/PUT/DELETE on timeout. Return a descriptive error: "operation may have succeeded -- check before retrying."
**Warning signs:** Duplicate messages appearing in WhatsApp chats.

### Pitfall 2: AbortSignal.timeout During Response Body Read
**What goes wrong:** The request succeeds (status 200) but `response.json()` or `response.text()` takes too long and the AbortSignal fires, making a successful call look like a failure.
**Why it happens:** `AbortSignal.timeout` covers the entire fetch lifecycle including body consumption.
**How to avoid:** The 30s timeout is generous for localhost WAHA calls. If this becomes an issue, read the response status before consuming the body and consider it a success if status is ok, even if body read fails.
**Warning signs:** Timeout errors on calls that actually succeeded (check WAHA logs).

### Pitfall 3: Token Bucket Starvation Under Burst
**What goes wrong:** A burst of 50 messages queues 30 requests. The queue drains at 15/sec, so the last message waits 2 seconds. Meanwhile, a time-sensitive DM is stuck behind group messages.
**Why it happens:** FIFO queue doesn't distinguish between message types.
**How to avoid:** Fire-and-forget calls (presence, typing) skip the rate limiter entirely via `skipRateLimit: true`. User-facing sends always get priority because presence calls don't compete.
**Warning signs:** Delayed message delivery during high-volume group activity.

### Pitfall 4: Shared Backoff Thundering Herd
**What goes wrong:** After a 429, all queued requests wait for the backoff period, then all fire simultaneously, causing another 429.
**Why it happens:** All requests resume at exactly the same time.
**How to avoid:** Jitter on the backoff delay (+/- 25%). The proactive rate limiter should prevent most 429s anyway -- the backoff is a safety net.
**Warning signs:** Repeated 429 sequences in logs.

### Pitfall 5: Dedup Over-Filtering
**What goes wrong:** Using messageId alone as dedup key causes poll.vote events to be filtered because they share the poll message's ID.
**Why it happens:** Different event types reference the same messageId.
**How to avoid:** Composite key: `${eventType}:${messageId}`. The existing `message` vs `message.any` filter remains the primary guard.
**Warning signs:** Missing poll votes or reactions in the system.

### Pitfall 6: send.ts DO NOT CHANGE Markers
**What goes wrong:** Modifying code near a DO NOT CHANGE marker breaks a previously fixed bug.
**Why it happens:** The markers protect hard-won fixes. The code is brittle.
**How to avoid:** Read ALL comments before modifying any code in send.ts. The extraction should be surgical: cut `callWahaApi` body, paste into http-client.ts, leave re-import in place.
**Warning signs:** Regression in media sending, session guardrail, or target resolution.

### Pitfall 7: lru-cache Import Style
**What goes wrong:** Using `import LRUCache from 'lru-cache'` (default import) fails.
**Why it happens:** lru-cache v11 exports only named exports.
**How to avoid:** Use `import { LRUCache } from 'lru-cache'`.
**Warning signs:** TypeScript compilation error or runtime "is not a constructor" error.

## Code Examples

### LRU Cache Replacement for resolveTarget

```typescript
// Source: lru-cache npm docs + existing _resolveCache in send.ts
import { LRUCache } from 'lru-cache';

const _resolveCache = new LRUCache<string, { data: unknown[]; ts: number }>({
  max: 1000,
  ttl: 30_000, // 30 seconds, matches existing RESOLVE_CACHE_TTL_MS
});

// Existing getCachedOrFetch stays almost identical:
function getCachedOrFetch(key: string, fetcher: () => Promise<unknown>): Promise<unknown[]> {
  const cached = _resolveCache.get(key);
  if (cached) {
    return Promise.resolve(cached.data);
  }
  return fetcher().then((raw) => {
    const arr = toArr(raw);
    _resolveCache.set(key, { data: arr, ts: Date.now() });
    return arr;
  });
}
// Note: TTL is now handled by lru-cache, so the manual ts check can be removed.
// Simplified version:
function getCachedOrFetch(key: string, fetcher: () => Promise<unknown>): Promise<unknown[]> {
  const cached = _resolveCache.get(key);
  if (cached) return Promise.resolve(cached);
  return fetcher().then((raw) => {
    const arr = toArr(raw);
    _resolveCache.set(key, arr);
    return arr;
  });
}
// Cache type simplifies to: LRUCache<string, unknown[]>
```

### AbortSignal.timeout Usage

```typescript
// Source: MDN AbortSignal.timeout docs, verified on Node 22
const response = await fetch(url.toString(), {
  method,
  headers: { /* ... */ },
  body: /* ... */,
  signal: AbortSignal.timeout(timeoutMs),
});
// Catch: err.name === "TimeoutError" (DOMException)
```

### Structured Error Log Format

```typescript
// Format: [WAHA] {action} {chatId} failed: {status} {message}
// Examples:
// [WAHA] sendText 972544329000@c.us failed: 500 Internal Server Error
// [WAHA] sendText 972544329000@c.us timeout: timed out after 30000ms -- operation may have succeeded
// [WAHA] presence 120363421825201386@g.us failed: 404 Session not found
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual AbortController + setTimeout | `AbortSignal.timeout(ms)` | Node 18+ (2022) | One-line timeout, no timer leak |
| `node-fetch` | Global `fetch` | Node 18+ (2022) | Zero dependency for HTTP |
| Custom LRU with Map | `lru-cache` v11 | 2024 | TypeScript native, ESM+CJS |
| `AbortSignal.any()` for combining | Node 20+ | 2023 | Combine timeout + manual abort |

**Deprecated/outdated:**
- `@types/lru-cache`: Not needed since v8 -- types are built in
- `node-fetch`: Not needed since Node 18 -- global fetch is available
- Manual `setTimeout` + `AbortController.abort()`: Use `AbortSignal.timeout()` instead

## Open Questions

1. **Token bucket drain mechanism timing**
   - What we know: `setTimeout` in the drain callback works for simple cases
   - What's unclear: Under sustained high load, many pending setTimeout callbacks could accumulate
   - Recommendation: Use a single recurring drain interval (e.g., every 67ms = 15/sec) instead of per-request timeouts. This is Claude's discretion.

2. **Config schema extension for reliability settings**
   - What we know: Config schema is in `config-schema.ts` using Zod
   - What's unclear: Whether to add `timeoutMs`, `rateLimitCapacity`, `rateLimitRefillRate` to the plugin config schema now or later
   - Recommendation: Add to config schema in this phase so values are configurable. Default values match the locked decisions (30s timeout, 20 capacity, 15 refill).

3. **Error classification for structured logging**
   - What we know: Need to distinguish timeout, 429, other HTTP errors, and network errors
   - What's unclear: Whether to use error codes or just string patterns
   - Recommendation: Use descriptive string messages (as decided). Error codes are over-engineering for a plugin.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected -- needs setup in Wave 0 |
| Config file | none -- see Wave 0 |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REL-01 | Structured error logging on API failure | unit | `npx vitest run tests/http-client.test.ts -t "error logging"` | No -- Wave 0 |
| REL-02 | Silent catch replacement with warning | unit | `npx vitest run tests/http-client.test.ts -t "warn on error"` | No -- Wave 0 |
| REL-03 | 30s timeout on fetch calls | unit | `npx vitest run tests/http-client.test.ts -t "timeout"` | No -- Wave 0 |
| REL-04 | Mutation timeout returns warning | unit | `npx vitest run tests/http-client.test.ts -t "mutation timeout"` | No -- Wave 0 |
| REL-05 | Token bucket rate limiting | unit | `npx vitest run tests/token-bucket.test.ts` | No -- Wave 0 |
| REL-06 | Fire-and-forget exempt from rate limit | unit | `npx vitest run tests/http-client.test.ts -t "skipRateLimit"` | No -- Wave 0 |
| REL-07 | Exponential backoff on 429 | unit | `npx vitest run tests/http-client.test.ts -t "429 backoff"` | No -- Wave 0 |
| REL-08 | Retry-After header parsing | unit | `npx vitest run tests/http-client.test.ts -t "retry-after"` | No -- Wave 0 |
| REL-09 | Webhook deduplication | unit | `npx vitest run tests/dedup.test.ts` | No -- Wave 0 |
| REL-10 | LRU cache for resolveTarget | unit | `npx vitest run tests/lru-cache.test.ts` | No -- Wave 0 |
| REL-11 | Memory audit | manual-only | Code review -- verify no unbounded Maps | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Install vitest: `npm install -D vitest`
- [ ] Create `vitest.config.ts` with TypeScript support
- [ ] `tests/http-client.test.ts` -- covers REL-01 through REL-08
- [ ] `tests/token-bucket.test.ts` -- covers REL-05
- [ ] `tests/dedup.test.ts` -- covers REL-09
- [ ] `tests/lru-cache.test.ts` -- covers REL-10

**Note:** The project has no existing test infrastructure. All test files must be created from scratch. The project uses TypeScript with ESM (`"type": "module"` in package.json). Vitest is recommended over Jest because it has native ESM and TypeScript support without additional configuration.

## Sources

### Primary (HIGH confidence)
- Node.js 22 docs -- `AbortSignal.timeout()` native support confirmed via `node --version` (v22.15.0)
- [lru-cache npm](https://www.npmjs.com/package/lru-cache) -- v11.2.6 confirmed via `npm view`, ESM+CJS, TypeScript built-in
- [lru-cache GitHub](https://github.com/isaacs/node-lru-cache) -- constructor options (max, ttl, maxSize), named export only
- Codebase analysis -- `callWahaApi` has 103 usages in send.ts, all through single function

### Secondary (MEDIUM confidence)
- [MDN AbortSignal.timeout](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static) -- error handling patterns (TimeoutError name check)
- [MDN AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) -- AbortSignal.any() for combining signals

### Tertiary (LOW confidence)
- Token bucket algorithm -- based on well-known pattern, implementation details are Claude's discretion

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- lru-cache version confirmed, Node.js APIs verified on target runtime
- Architecture: HIGH -- single chokepoint extraction is straightforward, codebase analyzed thoroughly
- Pitfalls: HIGH -- based on direct codebase analysis (DO NOT CHANGE markers found, .catch patterns counted)
- Validation: MEDIUM -- vitest recommendation based on ESM compatibility needs, no existing test infra to validate against

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable domain, 30 days)
