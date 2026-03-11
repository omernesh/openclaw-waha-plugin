# Architecture Patterns

**Domain:** Reliability hardening, multi-session support, and trigger-word activation for an existing TypeScript WhatsApp plugin
**Researched:** 2026-03-11

## Current Architecture (As-Is)

```
                    OpenClaw Gateway (READ-ONLY)
                           |
                    wahaPlugin (channel.ts)
                    - listActions(), handleAction()
                    - autoResolveTarget (name->JID)
                           |
          +----------------+----------------+
          |                |                |
     send.ts          inbound.ts       monitor.ts
     (outbound)       (webhook rx)     (HTTP server)
     ~1600 lines      - deliverWahaReply  - webhook listener
     - callWahaApi()  - DM/group filter   - admin panel
     - 60+ functions  - media preprocess  - directory refresh
     - resolveTarget  - presence ctrl     - RateLimiter (local)
          |                |                |
          +-------+--------+--------+------+
                  |                  |
            accounts.ts        directory.ts
            (session resolve)  (SQLite store)
```

### Key Observations

1. **`callWahaApi()` is the single chokepoint** -- every outbound WAHA call flows through this one function in send.ts (line 37-70). No timeout, no retry, no rate limiting, no structured error logging.

2. **RateLimiter already exists in monitor.ts** but is scoped only to directory refresh operations. It is a simple concurrency+delay limiter, not a token bucket.

3. **The resolve cache (`_resolveCache`) is unbounded** -- a `Map<string, {data, ts}>` with 30s TTL but no max size. Grows forever in long-running processes.

4. **Session resolution is already multi-account** -- `accounts.ts` supports multiple configured accounts with `listWahaAccountIds()`, `resolveWahaAccount()`. But `assertAllowedSession()` in send.ts hardcodes a logan-only guardrail.

5. **No error logging** -- `callWahaApi()` throws on non-2xx but callers often `.catch(() => {})` (e.g., presence calls in inbound.ts line 93).

## Recommended Architecture (To-Be)

### New Module: `src/http-client.ts`

Extract `callWahaApi()` from send.ts into a dedicated HTTP client module that composes reliability concerns. This is the **single most impactful change** -- every WAHA call automatically gets timeout, retry, rate limiting, circuit breaking, and structured logging.

```
src/http-client.ts
  |
  +-- WahaHttpClient class
       |
       +-- timeout (AbortController, 30s default)
       +-- rate limiter (token bucket, proactive)
       +-- retry with backoff (429 + transient errors)
       +-- circuit breaker (fail-fast on persistent failures)
       +-- structured error logging (every call logged)
       +-- request/response metrics (for admin panel)
```

**Why a new module instead of inline in send.ts:**
- send.ts is already 1600+ lines -- adding 200+ lines of reliability code makes it unmanageable
- The HTTP client is a cross-cutting concern used by send.ts, monitor.ts (directory refresh), and future modules
- Testable in isolation without importing 60+ WAHA API functions
- The existing `callWahaApi()` signature stays the same -- send.ts just imports from the new module instead of defining it locally

### Component Design

```typescript
// src/http-client.ts

interface WahaHttpClientOptions {
  /** Max concurrent requests to WAHA. Default: 10 */
  maxConcurrent: number;
  /** Requests per second limit. Default: 20 */
  requestsPerSecond: number;
  /** Request timeout in ms. Default: 30_000 */
  timeoutMs: number;
  /** Max retries for transient errors. Default: 3 */
  maxRetries: number;
  /** Circuit breaker: failures before opening. Default: 5 */
  circuitBreakerThreshold: number;
  /** Circuit breaker: reset time in ms. Default: 60_000 */
  circuitBreakerResetMs: number;
  /** Optional logger (structured) */
  logger?: StructuredLogger;
}

class WahaHttpClient {
  // Replaces the bare callWahaApi() function
  async call(params: CallWahaApiParams): Promise<unknown> {
    // 1. Check circuit breaker (fail-fast)
    // 2. Acquire rate limiter token
    // 3. Set AbortController timeout
    // 4. Execute fetch
    // 5. On 429: exponential backoff + retry
    // 6. On transient error (5xx, network): retry with backoff
    // 7. On success: reset circuit breaker, log, return
    // 8. On persistent failure: trip circuit breaker, log, throw
  }
}
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `http-client.ts` (NEW) | Timeout, rate limit, retry, circuit breaker, logging for all WAHA API calls | send.ts, monitor.ts |
| `send.ts` (MODIFIED) | WAHA API function signatures, request building, response parsing. Delegates HTTP to http-client. | http-client.ts, accounts.ts |
| `channel.ts` (UNCHANGED) | Action routing, target resolution. No reliability concerns. | send.ts |
| `inbound.ts` (MINOR CHANGE) | Webhook handling. Remove `.catch(() => {})` patterns, use structured logger. | send.ts, directory.ts |
| `monitor.ts` (MODIFIED) | Admin panel gains health/metrics display. Remove local RateLimiter class (replaced by http-client). | http-client.ts, directory.ts |
| `session-registry.ts` (NEW) | Multi-session lifecycle: registry, health monitoring, role-based access. | accounts.ts, http-client.ts |
| `trigger-words.ts` (NEW) | Trigger-word matching and activation logic for multi-session. | inbound.ts, session-registry.ts |
| `lru-cache.ts` (NEW) | Bounded LRU cache replacing unbounded Maps. | send.ts (resolveCache), channel.ts |
| `accounts.ts` (MODIFIED) | Session resolution. `assertAllowedSession()` becomes configurable via session-registry. | session-registry.ts |
| `directory.ts` (UNCHANGED) | SQLite store. No reliability changes needed. | - |

### Data Flow

#### Outbound (action -> WAHA API)

```
Gateway -> channel.ts handleAction()
  -> autoResolveTarget() [uses LRU cache]
  -> send.ts function (e.g., sendWahaText)
    -> http-client.ts WahaHttpClient.call()
      -> [rate limiter] -> [timeout] -> fetch() -> [retry on 429/5xx]
      -> structured log (success or failure)
    <- response or enriched error
  <- action result to gateway
```

#### Inbound (webhook -> gateway)

```
WAHA -> monitor.ts webhook listener
  -> inbound.ts handleWahaInbound()
    -> trigger-words.ts: check if message activates a session
    -> session-registry.ts: resolve which session handles this message
    -> DM/group filter (existing)
    -> deliverWahaReply() [outbound through http-client]
  -> gateway processes message
```

#### Multi-Session Activation

```
Inbound message arrives
  -> trigger-words.ts checks message body against configured patterns
     e.g., "Hey Sammie" matches session "logan" trigger word "sammie"
     e.g., "@bot" matches session "helper" trigger word "bot"
  -> If match: route to matched session's handleInbound
  -> If no match: route to default session (current behavior)
  -> Session registry tracks which sessions are active/healthy
```

## Detailed Component Designs

### 1. `src/http-client.ts` -- Reliability Wrapper

This is the core reliability module. All reliability patterns compose here.

```typescript
// Token bucket rate limiter (proactive, not reactive)
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,     // max burst
    private refillRate: number,   // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    // Wait for next token
    const waitMs = (1 / this.refillRate) * 1000;
    await new Promise(r => setTimeout(r, waitMs));
    this.refill();
    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// Circuit breaker (fail-fast when WAHA is down)
class CircuitBreaker {
  private failures = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private openedAt = 0;

  constructor(
    private threshold: number,
    private resetMs: number,
  ) {}

  check(): void {
    if (this.state === "open") {
      if (Date.now() - this.openedAt > this.resetMs) {
        this.state = "half-open";
        return; // allow one probe request
      }
      throw new Error("WAHA circuit breaker OPEN -- API appears down, failing fast");
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  getState(): string { return this.state; }
}
```

**Migration path:** Replace `callWahaApi()` in send.ts with an import from http-client.ts. The function signature stays identical. send.ts callers need zero changes.

### 2. `src/lru-cache.ts` -- Bounded Cache

Replace unbounded `Map` instances with a size-limited LRU cache.

```typescript
class LruCache<K, V> {
  private map = new Map<K, { value: V; ts: number }>();

  constructor(
    private maxSize: number,
    private ttlMs: number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // Move to end (most recent)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.map.delete(key); // remove old position
    if (this.map.size >= this.maxSize) {
      // Evict oldest (first key)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, ts: Date.now() });
  }

  get size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}
```

**Usage:** Replace `_resolveCache` in send.ts (line 1490) and any other unbounded Maps. Max size 1000 entries is reasonable given the resolve cache stores group/contact lists.

### 3. `src/session-registry.ts` -- Multi-Session Support

```typescript
interface SessionConfig {
  accountId: string;
  session: string;           // WAHA session ID
  role: "bot" | "human";     // "human" sessions are read-only (no outbound)
  triggerWords: string[];     // words that activate this session
  isDefault: boolean;         // receives messages with no trigger match
  healthCheckIntervalMs: number;
}

interface SessionHealth {
  accountId: string;
  status: "connected" | "disconnected" | "unknown";
  lastPingAt: number | null;
  lastPongAt: number | null;
  consecutiveFailures: number;
}

class SessionRegistry {
  private sessions = new Map<string, SessionConfig>();
  private health = new Map<string, SessionHealth>();
  private timers = new Map<string, NodeJS.Timeout>();

  register(config: SessionConfig): void { ... }
  unregister(accountId: string): void { ... }

  // Called by trigger-words.ts to find which session handles a message
  resolveSession(triggerWord?: string): SessionConfig | null { ... }

  // Periodic health check via WAHA /api/sessions/{session} endpoint
  startHealthMonitoring(httpClient: WahaHttpClient): void { ... }
  stopHealthMonitoring(): void { ... }

  getHealth(accountId: string): SessionHealth { ... }
  getAllHealth(): SessionHealth[] { ... }
}
```

**Integration with existing code:**
- `accounts.ts` already supports multiple accounts. SessionRegistry adds lifecycle (health, activation) on top.
- `assertAllowedSession()` in send.ts currently hardcodes "logan only". With multi-session, this becomes `sessionRegistry.isAllowedToSend(session)` checking role !== "human".
- The existing `monitorWahaProvider()` in monitor.ts starts one webhook server. Multi-session does NOT need multiple servers -- WAHA can send webhooks for all sessions to the same endpoint. The webhook envelope already includes `session` field.

### 4. `src/trigger-words.ts` -- Trigger Word Activation

```typescript
interface TriggerMatch {
  sessionAccountId: string;
  matchedWord: string;
  confidence: number;  // 1.0 = exact, 0.8 = fuzzy
}

class TriggerWordMatcher {
  private patterns: Map<string, RegExp[]>; // accountId -> compiled patterns

  constructor(sessions: Array<{ accountId: string; triggerWords: string[] }>) {
    // Compile trigger words into case-insensitive word-boundary regexes
    // e.g., "sammie" -> /\bsammie\b/i
  }

  match(messageBody: string): TriggerMatch | null {
    // Check all session trigger words against message
    // Return highest confidence match, or null for default session
  }

  updatePatterns(sessions: Array<{ accountId: string; triggerWords: string[] }>): void {
    // Hot-update without restart (config change via admin panel)
  }
}
```

**Integration point:** Called in `inbound.ts` `handleWahaInbound()` BEFORE DM/group filter. The trigger word determines which session context processes the message. This is a thin layer -- the existing DM filter already does keyword matching, so trigger-words reuses that pattern.

**Data flow:**
```
Webhook arrives with session="3cf11776_logan"
  -> trigger-words.ts checks message body
  -> If "hey sammie": route to logan session (bot)
  -> If "hey helper": route to helper session (different bot)
  -> If no match: route to default session
  -> DM filter runs per-session (each session has own filter config)
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Retry Inside callWahaApi + Retry in Callers
**What:** Adding retry logic in http-client AND having callers also retry.
**Why bad:** Double retry = exponential explosion. 3 retries x 3 retries = 9 attempts.
**Instead:** Retry ONLY in http-client.ts. Callers get a single attempt from their perspective.

### Anti-Pattern 2: Global Singleton HttpClient
**What:** One shared client instance for all sessions.
**Why bad:** Circuit breaker trips for ALL sessions if one WAHA instance has issues.
**Instead:** One `WahaHttpClient` per WAHA base URL. If all sessions share one WAHA instance (current setup), one client is fine. If multi-WAHA deployments happen later, per-URL isolation.

### Anti-Pattern 3: Modifying send.ts Function Signatures
**What:** Changing the 60+ function signatures in send.ts to accept an httpClient parameter.
**Why bad:** Massive diff, high regression risk on brittle code with DO NOT CHANGE markers.
**Instead:** Module-level client instance in send.ts, initialized on first use. Functions call `getClient()` internally.

### Anti-Pattern 4: Separate Webhook Servers Per Session
**What:** Spinning up a new HTTP server for each WhatsApp session.
**Why bad:** Port conflicts, resource waste. WAHA webhook envelope already has `session` field.
**Instead:** Single webhook server, demux by `envelope.session` in the handler.

## Build Order (Dependencies)

The components have clear dependency order. Build bottom-up:

```
Phase 1: Foundation (no inter-dependencies)
  [1a] lru-cache.ts        -- standalone, no imports
  [1b] http-client.ts      -- standalone, only imports node:fetch

Phase 2: Integration (depends on Phase 1)
  [2a] send.ts refactor    -- swap callWahaApi() for http-client import
  [2b] send.ts cache       -- swap _resolveCache Map for LruCache
  [2c] monitor.ts cleanup  -- remove local RateLimiter, use http-client
  [2d] inbound.ts logging  -- remove .catch(() => {}), use structured errors

Phase 3: Multi-Session (depends on Phase 2)
  [3a] session-registry.ts -- depends on http-client (health checks)
  [3b] trigger-words.ts    -- standalone logic, integrated in inbound.ts
  [3c] accounts.ts update  -- assertAllowedSession becomes registry-aware
  [3d] admin panel updates -- session health tab, trigger word config

Phase 4: Polish (depends on Phase 3)
  [4a] metrics/stats       -- http-client emits counts for admin panel
  [4b] SKILL.md refresh    -- document new capabilities
```

**Critical dependency:** Phase 2a (send.ts swap) must happen before anything else uses http-client -- otherwise there are two HTTP paths and reliability is inconsistent.

**Parallelizable:** 1a and 1b can be built in parallel. 2a-2d can be done together in a single deployment. 3a and 3b are independent of each other.

## Migration Strategy for send.ts

The biggest risk is modifying send.ts (1600 lines, many DO NOT CHANGE markers). Strategy:

1. **Extract, don't rewrite.** Move `callWahaApi()` (lines 37-70) to http-client.ts. Leave a thin re-export in send.ts for backward compat.

2. **Module-level client instance:**
```typescript
// send.ts -- top of file
import { createWahaHttpClient } from "./http-client.js";

let _httpClient: WahaHttpClient | null = null;
function getHttpClient(): WahaHttpClient {
  if (!_httpClient) {
    _httpClient = createWahaHttpClient({ /* defaults */ });
  }
  return _httpClient;
}

// callWahaApi becomes a thin wrapper:
async function callWahaApi(params: CallWahaApiParams) {
  return getHttpClient().call(params);
}
```

3. **Zero changes to any function below callWahaApi.** The 60+ API functions all call `callWahaApi()` internally -- they get reliability for free.

4. **Backup before touching:** `cp src/send.ts src/send.ts.bak.v1.10.4`

## Configuration Schema Extension

```typescript
// Added to WahaChannelConfig in types.ts
type ReliabilityConfig = {
  http?: {
    timeoutMs?: number;          // default: 30000
    maxConcurrent?: number;      // default: 10
    requestsPerSecond?: number;  // default: 20
    maxRetries?: number;         // default: 3
    circuitBreakerThreshold?: number;  // default: 5
    circuitBreakerResetMs?: number;    // default: 60000
  };
  cache?: {
    maxSize?: number;            // default: 1000
    ttlMs?: number;              // default: 30000
  };
};

type SessionRegistryConfig = {
  sessions?: Record<string, {
    role?: "bot" | "human";
    triggerWords?: string[];
    isDefault?: boolean;
    healthCheckIntervalMs?: number;
  }>;
};
```

These nest under `channels.waha` in the OpenClaw config, following existing patterns.

## Scalability Considerations

| Concern | Current (1 session) | At 3 sessions | At 10 sessions |
|---------|---------------------|---------------|----------------|
| Rate limiting | None | Token bucket per WAHA instance | Same, shared bucket |
| Health checks | None | 1 ping/30s per session = 6/min | 20/min -- fine |
| Memory (caches) | Unbounded Maps | LRU 1000 entries x 3 = ~3K entries | LRU still bounded |
| Webhook throughput | Single handler | Same server, demux by session field | Same -- WAHA does multiplexing |
| SQLite directory | 1 DB | 1 DB per account (already supported by `getDirectoryDb(accountId)`) | Works, separate files |

## Sources

- Codebase analysis: channel.ts, send.ts, inbound.ts, monitor.ts, accounts.ts, directory.ts, types.ts
- CLAUDE.md project reference (verified architecture, constraints, critical rules)
- Existing RateLimiter pattern in monitor.ts (lines 38-93)
- Existing resolve cache pattern in send.ts (lines 1486-1500)
- Existing multi-account support in accounts.ts (full file)
- Token bucket and circuit breaker are well-established patterns (HIGH confidence -- standard distributed systems patterns, not library-specific)
