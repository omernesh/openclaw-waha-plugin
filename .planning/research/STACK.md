# Technology Stack: Reliability Hardening

**Project:** WAHA OpenClaw Plugin
**Researched:** 2026-03-11
**Scope:** Reliability patterns for an existing TypeScript/Node.js plugin making REST API calls

## Recommended Stack

This project already runs TypeScript on Node.js with `better-sqlite3` and `zod`. The reliability layer should add minimal dependencies -- prefer built-in Node.js APIs and single-purpose libraries over frameworks.

### Request Timeouts
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `AbortSignal.timeout()` | Built-in (Node 18+) | HTTP request timeouts | Zero dependencies. Native API. One-liner: `fetch(url, { signal: AbortSignal.timeout(30_000) })`. The existing `callWahaApi` function already uses native `fetch()`, so adding `signal` is a single-line change. No library needed. |

**Confidence:** HIGH -- built-in API, verified via MDN and Node.js docs.

**Implementation:** Add `signal: AbortSignal.timeout(timeoutMs)` to the existing `fetch()` call in `callWahaApi()` in `send.ts`. Catch `TimeoutError` (from `AbortSignal.timeout`) separately from `AbortError` (manual cancellation). Default 30s for standard calls, 60s for media uploads.

```typescript
// In callWahaApi:
const response = await fetch(url.toString(), {
  method,
  signal: AbortSignal.timeout(params.timeoutMs ?? 30_000),
  headers: { ... },
  ...(hasBody ? { body: JSON.stringify(params.body) } : {}),
});
```

### Rate Limiting (Outbound)
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Custom token bucket (~60 lines) | N/A | Proactive outbound rate limiting | The `limiter` npm package (v3.0.0) exists but is overkill for this use case. A token bucket is ~60 lines of TypeScript. The plugin has a single chokepoint (`callWahaApi`), so a module-level bucket with configurable tokens/interval is cleaner than pulling in a dependency. |

**Confidence:** HIGH -- token bucket is a well-understood algorithm with no edge cases at this scale.

**Why not `limiter` (npm)?** The package works but adds a dependency for something trivially implementable. The plugin already has minimal deps (only `better-sqlite3` and `zod`). A custom implementation allows: (a) integration with 429 backoff, (b) per-session buckets for multi-session support later, (c) zero dependency risk.

**Design:**
- Token bucket: 30 tokens, refill 10/second (configurable via plugin config)
- On 429 response: exponential backoff (1s, 2s, 4s, max 30s), drain bucket
- Proactive: callers `await bucket.consume(1)` before making requests
- Per-session buckets when multi-session lands (Phase 3)

### LRU Cache
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `lru-cache` | ^11.2.6 | Bounded cache with TTL and eviction | Industry standard (isaacs). 170M+ weekly downloads. Native TypeScript. Supports `max` (size cap), `ttl` (auto-expiry), and `dispose` (cleanup callbacks). The existing `resolveTarget` cache is a plain `Map` with manual TTL -- replacing it with `lru-cache` adds bounds and eliminates the memory leak. |

**Confidence:** HIGH -- verified via GitHub repo, npm registry, and jsDocs.io.

**Why `lru-cache` over alternatives:**
- `mnemonist` LRUCache: Faster for numeric keys, but `lru-cache` is faster for string keys (which JIDs are)
- `quick-lru`: Fewer features (no TTL, no dispose)
- Custom Map+TTL: Already tried (current code), proven to leak memory without bounds

**Configuration:**
```typescript
import { LRUCache } from 'lru-cache';

const resolveCache = new LRUCache<string, string>({
  max: 1000,       // bounded size -- prevents unbounded growth
  ttl: 30_000,     // 30s TTL -- matches current behavior
});
```

### Webhook Deduplication
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Custom sliding window with `Map` | N/A | Deduplicate webhooks by messageId | No library needed. A `Map<string, number>` (messageId -> timestamp) with periodic cleanup is ~40 lines. The existing code already filters `message` vs `message.any` events but doesn't deduplicate by messageId. A 60-second sliding window catches WAHA's duplicate deliveries. |

**Confidence:** HIGH -- standard pattern, well-documented across webhook best practices.

**Why not a library?** Webhook dedup is domain-specific (what constitutes the dedup key, window size, cleanup interval). A generic library adds abstraction without value. The implementation is:

```typescript
const seen = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;

function isDuplicate(messageId: string): boolean {
  const now = Date.now();
  if (seen.has(messageId)) return true;
  seen.set(messageId, now);
  // Periodic cleanup: every 100 inserts, purge expired
  if (seen.size % 100 === 0) {
    for (const [k, ts] of seen) {
      if (now - ts > DEDUP_WINDOW_MS) seen.delete(k);
    }
  }
  return false;
}
```

**Alternative:** Could use `lru-cache` with `max: 5000, ttl: 60_000` for automatic eviction. This avoids the manual cleanup loop and reuses an existing dependency. Recommended if `lru-cache` is already added for resolveTarget cache.

### Message Queue / Flood Protection
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `p-queue` | ^8.1.0 | Bounded async task queue with concurrency control | Sindre Sorhus. Promise-based. Concurrency limiting (process N messages at a time). Priority support (DMs over group messages). Pause/resume. The plugin needs to throttle inbound webhook processing to prevent overwhelming `handleAction`. `p-queue` is the standard solution. |

**Confidence:** MEDIUM -- `p-queue` is ESM-only. The project uses `"type": "module"` so this is fine, but verify import compatibility with the OpenClaw plugin loader.

**Why `p-queue` over alternatives:**
- `fastq` (v1.20.1, mcollina): Faster raw throughput, but callback-based API. The plugin is fully async/await.
- `BullMQ`: Requires Redis. Massive overkill for an in-process queue.
- Custom queue: Possible but priority support and backpressure are non-trivial to implement correctly.

**Caveat:** `p-queue` does not have a built-in `maxQueueSize`. To bound the queue, use `queue.onSizeLessThan(maxSize)` before adding, or check `queue.size` and reject/drop when full. This needs a thin wrapper.

**Configuration:**
```typescript
import PQueue from 'p-queue';

const inboundQueue = new PQueue({
  concurrency: 3,        // process 3 webhooks concurrently
  intervalCap: 10,       // max 10 per interval
  interval: 1000,        // 1-second interval
  throwOnTimeout: true,
  timeout: 60_000,       // kill stuck handlers after 60s
});
```

### Session Health Monitoring
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `setInterval` + WAHA `/api/sessions/{session}/me` | Built-in | Periodic health checks | No library needed. Ping the session endpoint every 30s. Track consecutive failures. Emit warning after 3 failures, attempt reconnect after 5. The WAHA API already has session status endpoints. |

**Confidence:** HIGH -- straightforward polling pattern using existing WAHA endpoints.

**Design:**
- Poll `/api/sessions/{session}/me` every 30 seconds
- Track state: `healthy | degraded | disconnected`
- After 3 consecutive failures: log warning, mark degraded
- After 5 consecutive failures: attempt session restart via WAHA API
- Expose health status via admin panel `/api/admin/sessions` (already exists)

### Multi-Session Management
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| SQLite (existing `better-sqlite3`) | ^11.10.0 | Session registry, roles, permissions | Already a dependency. Add a `sessions` table with columns: `session_id`, `role` (bot/human/monitor), `allowed_actions` (JSON), `trigger_word`, `active`. No new dependency needed. |

**Confidence:** MEDIUM -- the architecture is straightforward but the OpenClaw gateway's plugin loading model may constrain multi-session design. Need to verify how the gateway routes inbound webhooks to specific sessions.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Rate limiting | Custom token bucket | `limiter` v3.0.0 | Adds dependency for 60 lines of code; custom allows per-session buckets |
| Rate limiting | Custom token bucket | `bottleneck` | Heavier, Redis-oriented, not maintained since 2020 |
| LRU Cache | `lru-cache` v11 | `mnemonist` LRUMap | Faster for numeric keys only; less features (no TTL) |
| LRU Cache | `lru-cache` v11 | `quick-lru` | No TTL support, fewer features |
| LRU Cache | `lru-cache` v11 | Custom Map+TTL | Already tried, leaks memory without bounds |
| Queue | `p-queue` v8 | `fastq` v1.20 | Callback-based, awkward with async/await |
| Queue | `p-queue` v8 | `BullMQ` | Requires Redis, massive overkill |
| Queue | `p-queue` v8 | Custom | Priority + backpressure are non-trivial |
| Dedup | Custom Map / lru-cache | `ioredis` + Set | Requires Redis for a single-process plugin |
| Timeouts | `AbortSignal.timeout()` | `got` / `axios` | Would replace native `fetch`, unnecessary migration |
| Health | `setInterval` polling | `@uptime-robot/api` | External service, overkill for internal health |

## Installation

```bash
# New dependency (1 package)
npm install lru-cache

# New dependency (1 package) -- only if flood protection is Phase 1
npm install p-queue

# Dev dependencies -- none new needed
```

**Total new dependencies: 1-2 packages.** Everything else is built-in or custom code.

### Dependency Impact
| Current | After |
|---------|-------|
| `better-sqlite3`, `zod` | `better-sqlite3`, `zod`, `lru-cache`, `p-queue` (optional) |

## Summary: Build vs Buy

| Pattern | Approach | Rationale |
|---------|----------|-----------|
| Request timeouts | **Built-in** (`AbortSignal.timeout`) | Zero deps, one-line change |
| Rate limiting | **Build** (~60 lines) | Single chokepoint, per-session needs |
| LRU cache | **Buy** (`lru-cache`) | Battle-tested, complex eviction logic |
| Webhook dedup | **Build** (~40 lines) or reuse `lru-cache` | Domain-specific, trivial |
| Message queue | **Buy** (`p-queue`) | Priority + concurrency is non-trivial |
| Health monitoring | **Built-in** (`setInterval`) | Simple polling, no library needed |
| Session registry | **Reuse** (`better-sqlite3`) | Already a dependency |

## Sources

- [AbortSignal.timeout() - MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- [Managing Async Operations with AbortController - AppSignal](https://blog.appsignal.com/2025/02/12/managing-asynchronous-operations-in-nodejs-with-abortcontroller.html)
- [limiter - npm / GitHub](https://github.com/jhurliman/node-rate-limiter) -- v3.0.0, considered but not recommended
- [lru-cache - npm](https://www.npmjs.com/package/lru-cache) -- v11.2.6, isaacs
- [lru-cache - GitHub](https://github.com/isaacs/node-lru-cache)
- [p-queue - GitHub](https://github.com/sindresorhus/p-queue) -- v8.x, sindresorhus
- [fastq - GitHub](https://github.com/mcollina/fastq) -- v1.20.1, considered but not recommended
- [Webhook Deduplication Best Practices - Latenode](https://latenode.com/blog/webhook-deduplication-checklist-for-developers)
- [Token Bucket Algorithm - Medium](https://medium.com/@surajshende247/token-bucket-algorithm-rate-limiting-db4c69502283)
