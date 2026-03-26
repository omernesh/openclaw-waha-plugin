# Phase 2: Resilience and Observability - Research

**Researched:** 2026-03-11
**Domain:** Session health monitoring, inbound message queuing, LLM-friendly error formatting
**Confidence:** HIGH

## Summary

Phase 2 adds three capabilities to the WAHA OpenClaw plugin: (1) periodic health pings to detect WAHA session disconnects, (2) a bounded two-queue system for inbound webhook messages with DM priority, and (3) a centralized error formatter that wraps all `handleAction` failures into LLM-readable messages with retry hints and alternative action suggestions.

All three features build on Phase 1 infrastructure. The health check uses `callWahaApi` from `http-client.ts` (already has timeout, logging, rate limiting). The inbound queue wraps the existing `handleWahaInbound` call in `monitor.ts` (currently a direct `await` at lines 2134 and 2185). The error formatter wraps `handleAction` in `channel.ts` (line 326) which already throws plain `Error` objects from individual action handlers.

**Primary recommendation:** Implement as three independent work streams -- health monitor (new module), inbound queue (new module consumed by monitor.ts), error formatter (wrapper in channel.ts) -- each with its own test file. Keep admin panel changes (health dot, queue tab) in the same plans as their backing logic to avoid orphaned UI.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Ping WAHA `/api/{session}/me` at configurable interval (default 60s via `healthCheckIntervalMs`)
- After 3 consecutive failed pings, log warning and show health warning in admin panel Status tab
- Warn only -- do NOT block outbound sends on health failure
- No auto-recovery -- do not attempt session restart
- Health check timer lives in `monitor.ts`
- Two separate queues: DM queue and group queue. DM queue drains first (priority)
- Queue sizes configurable via config (default 50 DM slots + 50 group slots)
- Drop oldest on overflow -- silent drop, no auto-reply. Increment overflow counter
- Serial processing -- one message at a time
- No "busy" auto-reply on overflow
- Structured plain text error format: "Failed to [action] [target]: [status] [error]. Try: [suggestion]."
- Include retry hints: rate limits and timeouts say "retry after Xs"; permanent errors say "do not retry"
- Include alternative action suggestions (e.g., contact not found -> suggest "search contacts")
- Centralized error wrapper around handleAction's try/catch
- Status tab: green/yellow/red dot per session. Green = healthy, yellow = 1-2 failed, red = 3+ failed
- New Queue tab: DM/group queue depth and overflow drop count
- Display only -- no reconnect button
- New `/api/admin/health` endpoint: JSON with session health status, consecutive failures, last ping time

### Claude's Discretion
- setInterval vs setTimeout chain for health check timer
- Queue data structure choice (array shift vs linked list)
- Error message suggestion mapping (which errors suggest which alternative actions)
- Admin panel UI styling for health indicators and queue tab
- Whether to add circuit breaker pattern deferred from Phase 1

### Deferred Ideas (OUT OF SCOPE)
- Circuit breaker pattern -- evaluate but do not implement unless trivially simple
- WhatsApp notification on session disconnect -- Phase 4 multi-session feature
- Queue metrics over time (history/graphs) -- simple counters sufficient
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RES-01 | Session health check pings WAHA `/api/{session}/me` every 60s | Health monitor module using `callWahaApi` with `skipRateLimit: true`. setTimeout chain recommended for drift avoidance. |
| RES-02 | Log warning after 3 consecutive health check failures, surface in admin panel Status tab | Module-level health state object (consecutiveFailures, lastSuccessAt, status enum). Admin panel reads via new `/api/admin/health` endpoint. |
| RES-03 | Inbound message queue with bounded size (100 messages), drop oldest on overflow | Two-queue class (DM + group, 50 each). Array-based with `shift()` for drop-oldest. Wraps `handleWahaInbound` call sites in monitor.ts. |
| RES-04 | DM messages get priority over group messages in inbound queue | Queue processor always drains DM queue first before taking from group queue. `isWhatsAppGroupJid()` already available for classification. |
| RES-05 | All action handler errors return LLM-friendly messages with action name, target, and suggested fix | Centralized `formatActionError()` wrapper in channel.ts around the handleAction try/catch. Maps error patterns to suggestions via lookup table. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `setTimeout` | N/A | Health check timer | No external dependency needed for periodic pings |
| `isWhatsAppGroupJid` | from openclaw/plugin-sdk | DM vs group classification | Already imported in inbound.ts, reliable JID detection |
| `callWahaApi` | from http-client.ts | Health ping HTTP calls | Existing chokepoint with timeout, logging, structured errors |
| `zod` | ^4.3.6 | Config schema for new fields | Already used for all config validation |
| `vitest` | ^4.0.18 | Unit tests | Already configured, 4 test files exist |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lru-cache` | ^11.2.6 | Already in deps | Not needed for Phase 2 (no new caching) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain array queue | p-queue (npm) | p-queue is ESM-only, unverified with OpenClaw plugin loader (STATE.md blocker). Array is simpler, 100 items max -- no performance concern. Use plain array. |
| setTimeout chain | setInterval | setInterval can drift and stack if pings take longer than interval. setTimeout chain is self-correcting. Use setTimeout chain. |
| Custom error mapper | Error subclasses | Subclasses add complexity. Simple string pattern matching on error messages is sufficient for the ~10 known error types. Use pattern matching. |

**Installation:**
```bash
# No new dependencies needed -- all built on existing stack
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  health.ts          # NEW — Session health monitor (ping logic, state tracking)
  inbound-queue.ts   # NEW — Bounded two-queue with DM priority
  error-formatter.ts # NEW — Centralized action error → LLM message mapper
  monitor.ts         # MODIFIED — Start health timer, add /api/admin/health, add Queue tab, wire queue
  channel.ts         # MODIFIED — Wrap handleAction with error formatter
  config-schema.ts   # MODIFIED — Add healthCheckIntervalMs, dmQueueSize, groupQueueSize
  http-client.ts     # READ ONLY — callWahaApi used by health pings
  inbound.ts         # UNCHANGED — handleWahaInbound stays as-is, queue wraps its callers
```

### Pattern 1: Health Monitor (setTimeout Chain)
**What:** A self-correcting health check loop using `setTimeout` that schedules the next ping only after the current one completes.
**When to use:** For periodic tasks where drift and stacking must be avoided.
**Example:**
```typescript
// src/health.ts
export interface HealthState {
  status: "healthy" | "degraded" | "unhealthy";
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastCheckAt: number | null;
}

export function startHealthCheck(opts: {
  baseUrl: string;
  apiKey: string;
  session: string;
  intervalMs: number;
  onStateChange: (state: HealthState) => void;
  abortSignal?: AbortSignal;
}): HealthState {
  const state: HealthState = {
    status: "healthy",
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastCheckAt: null,
  };

  async function tick() {
    if (opts.abortSignal?.aborted) return;
    state.lastCheckAt = Date.now();
    try {
      await callWahaApi({
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        path: `/api/${encodeURIComponent(opts.session)}/me`,
        method: "GET",
        skipRateLimit: true,  // Health checks bypass rate limiter
        timeoutMs: 10_000,    // Shorter timeout for pings
        context: { action: "healthCheck" },
      });
      state.consecutiveFailures = 0;
      state.lastSuccessAt = Date.now();
      state.status = "healthy";
    } catch {
      state.consecutiveFailures++;
      if (state.consecutiveFailures >= 3) {
        state.status = "unhealthy";
        console.warn(`[WAHA] Session ${opts.session} unhealthy: ${state.consecutiveFailures} consecutive ping failures`);
      } else {
        state.status = "degraded";
      }
    }
    opts.onStateChange(state);
    // Schedule next tick AFTER completion (self-correcting)
    if (!opts.abortSignal?.aborted) {
      const timer = setTimeout(tick, opts.intervalMs);
      if (typeof timer === "object" && timer && "unref" in timer) {
        (timer as NodeJS.Timeout).unref();
      }
    }
  }

  // First tick after a short delay to not block startup
  const startTimer = setTimeout(tick, 5000);
  if (typeof startTimer === "object" && startTimer && "unref" in startTimer) {
    (startTimer as NodeJS.Timeout).unref();
  }

  return state;
}
```

### Pattern 2: Bounded Two-Queue with DM Priority
**What:** Two fixed-size arrays (DM and group) with drop-oldest overflow and serial drain that always processes DMs first.
**When to use:** When you need priority processing without complex priority queue data structures.
**Example:**
```typescript
// src/inbound-queue.ts
export interface QueueStats {
  dmDepth: number;
  groupDepth: number;
  dmOverflowDrops: number;
  groupOverflowDrops: number;
  totalProcessed: number;
}

export class InboundQueue {
  private dmQueue: QueueItem[] = [];
  private groupQueue: QueueItem[] = [];
  private processing = false;
  private stats: QueueStats = { dmDepth: 0, groupDepth: 0, dmOverflowDrops: 0, groupOverflowDrops: 0, totalProcessed: 0 };

  constructor(
    private dmCapacity: number,
    private groupCapacity: number,
    private processor: (item: QueueItem) => Promise<void>,
  ) {}

  enqueue(item: QueueItem, isGroup: boolean): void {
    const queue = isGroup ? this.groupQueue : this.dmQueue;
    const capacity = isGroup ? this.groupCapacity : this.dmCapacity;
    if (queue.length >= capacity) {
      queue.shift(); // Drop oldest
      if (isGroup) this.stats.groupOverflowDrops++;
      else this.stats.dmOverflowDrops++;
    }
    queue.push(item);
    this.updateDepths();
    this.drain(); // Fire-and-forget
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.dmQueue.length > 0 || this.groupQueue.length > 0) {
        // DM priority: always drain DM queue first
        const item = this.dmQueue.length > 0
          ? this.dmQueue.shift()!
          : this.groupQueue.shift()!;
        this.updateDepths();
        try {
          await this.processor(item);
        } catch (err) {
          console.error(`[WAHA] Queue processor error: ${String(err)}`);
        }
        this.stats.totalProcessed++;
      }
    } finally {
      this.processing = false;
    }
  }
}
```

### Pattern 3: Centralized Error Formatter
**What:** A wrapper function that catches errors from `handleAction`, classifies them by pattern matching, and returns structured LLM-friendly error messages.
**When to use:** When multiple action handlers throw raw errors that need consistent formatting for an AI consumer.
**Example:**
```typescript
// src/error-formatter.ts
interface ActionErrorContext {
  action: string;
  target?: string;
}

const ERROR_SUGGESTIONS: Array<{
  pattern: RegExp;
  suggestion: (ctx: ActionErrorContext) => string;
}> = [
  { pattern: /429|rate limit/i, suggestion: () => "Rate limited. Retry after 5s." },
  { pattern: /timed out/i, suggestion: () => "Request timed out. Try again." },
  { pattern: /not found|no matches/i, suggestion: (ctx) => `Target not found. Use "search" action to verify "${ctx.target}" exists.` },
  { pattern: /requires.*chatId|requires a target/i, suggestion: () => "Missing target. Specify a JID, phone number, or contact name." },
  { pattern: /requires.*messageId/i, suggestion: () => "Missing messageId. Use the full message ID from a webhook event." },
  { pattern: /401|unauthorized|forbidden/i, suggestion: () => "Authentication failed. Do not retry -- check API key config." },
  { pattern: /session.*unhealthy|session.*disconnect/i, suggestion: () => "WhatsApp session is disconnected. Do not retry until reconnected." },
];

export function formatActionError(err: unknown, ctx: ActionErrorContext): string {
  const rawMsg = err instanceof Error ? err.message : String(err);
  // Find matching suggestion
  const match = ERROR_SUGGESTIONS.find(s => s.pattern.test(rawMsg));
  const suggestion = match ? match.suggestion(ctx) : "Unexpected error. Try again or use a different approach.";
  // Strip [WAHA] prefix and internal details for LLM consumption
  const cleanMsg = rawMsg.replace(/^\[WAHA\]\s*/, "").replace(/\s*\(.*?\)\s*$/, "");
  return `Failed to ${ctx.action}${ctx.target ? ` ${ctx.target}` : ""}: ${cleanMsg}. Try: ${suggestion}`;
}
```

### Anti-Patterns to Avoid
- **Blocking sends on health failure:** WAHA often still sends even when `/me` fails. Never gate outbound on health status.
- **Auto-replying on queue overflow:** Sending "I'm busy" messages during overload creates more webhook events, worsening the flood.
- **Shared mutable state across awaits without locking:** The drain loop must use a `processing` flag to prevent concurrent drain execution.
- **Raw stack traces to LLM:** The LLM (Sammie) passes these to users. Always return natural language, not Error objects or stack traces.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JID type detection | Custom regex for @g.us/@c.us | `isWhatsAppGroupJid()` from plugin-sdk | Already imported, handles edge cases |
| HTTP calls to WAHA | Raw fetch for health pings | `callWahaApi` from http-client.ts | Gets timeout, logging, structured errors for free |
| Config validation | Manual type checks on new fields | Zod schema extension in config-schema.ts | Consistent with all existing config fields |
| Timer cleanup | Manual tracking of setTimeout IDs | AbortSignal pattern (already in monitorWahaProvider) | Cancellation propagates cleanly on shutdown |

**Key insight:** Phase 1 built the infrastructure layer (http-client.ts, dedup.ts, LRU cache). Phase 2 should compose on top of it, not duplicate any reliability logic.

## Common Pitfalls

### Pitfall 1: Health Check Timer Leaking on Plugin Shutdown
**What goes wrong:** The setTimeout chain keeps running after the gateway stops the plugin, causing "cannot read property of undefined" errors.
**Why it happens:** `monitorWahaProvider` receives an `abortSignal` but the health timer doesn't check it.
**How to avoid:** Pass the same `abortSignal` to the health check starter. Check `signal.aborted` before scheduling the next tick. Also `.unref()` all timers so they don't keep the process alive.
**Warning signs:** Errors in logs after gateway restart, or gateway hanging on shutdown.

### Pitfall 2: Queue Drain Running Concurrently
**What goes wrong:** Two drain loops process messages simultaneously, causing race conditions in the OpenClaw gateway (which expects serial inbound processing).
**Why it happens:** Each `enqueue()` call triggers `drain()`. If the first drain is still awaiting `handleWahaInbound`, the second enqueue triggers another drain.
**How to avoid:** Use a `processing` boolean flag. If `drain()` is called while `processing === true`, return immediately. The active drain loop will pick up the newly enqueued item.
**Warning signs:** Duplicate messages or out-of-order processing.

### Pitfall 3: Health Ping Consuming Rate Limit Tokens
**What goes wrong:** Health check pings (every 60s) consume tokens from the global rate limiter, reducing capacity for actual API calls.
**Why it happens:** `callWahaApi` applies rate limiting by default.
**How to avoid:** Pass `skipRateLimit: true` to `callWahaApi` for health check calls. One GET request every 60s is negligible load.
**Warning signs:** Increased 429s or slower API calls after enabling health checks.

### Pitfall 4: Queue Not Processing Webhook Response Timing
**What goes wrong:** The webhook handler currently returns HTTP 200 after `handleWahaInbound` completes. With a queue, the handler returns 200 immediately on enqueue, but if it returns 500 on queue full, WAHA might retry and create a flood.
**Why it happens:** Changing from sync processing to async queue changes the HTTP response contract.
**How to avoid:** Always return HTTP 200 to the webhook, even when dropping messages. WAHA retries on non-200, which would worsen a flood. Track drops in stats counters instead.
**Warning signs:** WAHA retry storms, exponentially growing webhook load.

### Pitfall 5: Error Formatter Swallowing Context
**What goes wrong:** The error formatter strips too much detail, making debugging impossible.
**Why it happens:** Overzealous cleanup of error messages for LLM consumption.
**How to avoid:** Log the full original error with `console.warn` BEFORE formatting. The formatted message goes to the LLM; the raw error goes to logs for human debugging.
**Warning signs:** LLM-friendly errors appear in chat but no corresponding detail in `journalctl` logs.

## Code Examples

### Webhook Handler Queue Integration (monitor.ts modification)
```typescript
// BEFORE (current, line ~2134 in monitor.ts):
await handleWahaInbound({ message, rawPayload: payload.payload, ... });
writeJsonResponse(res, 200, { status: "ok" });

// AFTER (with queue):
const isGroup = isWhatsAppGroupJid(message.chatId);
inboundQueue.enqueue(
  { message, rawPayload: payload.payload, account, config: opts.config, runtime, statusSink: opts.statusSink },
  isGroup
);
// Always 200 — even if dropped. WAHA retries on non-200 which worsens floods.
writeJsonResponse(res, 200, { status: "queued" });
```

### Config Schema Extension (config-schema.ts)
```typescript
// Add to WahaAccountSchemaBase .object({...}):
healthCheckIntervalMs: z.number().int().positive().optional().default(60_000),
dmQueueSize: z.number().int().positive().optional().default(50),
groupQueueSize: z.number().int().positive().optional().default(50),
```

### Admin Health Endpoint (monitor.ts)
```typescript
// GET /api/admin/health
if (req.url === "/api/admin/health" && req.method === "GET") {
  const state = getHealthState(); // Import from health.ts
  writeJsonResponse(res, 200, {
    session: account.config.session ?? "unknown",
    status: state.status,
    consecutiveFailures: state.consecutiveFailures,
    lastSuccessAt: state.lastSuccessAt,
    lastCheckAt: state.lastCheckAt,
  });
  return;
}
```

### handleAction Error Wrapper (channel.ts)
```typescript
// Wrap the existing handleAction body:
handleAction: async ({ action, params, cfg, accountId, toolContext }) => {
  const target = resolveChatIdSafe(params, toolContext); // extract without throwing
  try {
    // ... existing action dispatch logic (unchanged) ...
  } catch (err) {
    // Log full error for debugging
    console.warn(`[WAHA] handleAction ${action} failed:`, err);
    // Return LLM-friendly formatted error
    const formatted = formatActionError(err, { action, target });
    return {
      content: [{ type: "text" as const, text: formatted }],
      isError: true,
    };
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Silent `.catch(() => {})` | `warnOnError()` logging | Phase 1 (2026-03-11) | All errors now visible in logs |
| No rate limiting | Token bucket + 429 backoff | Phase 1 (2026-03-11) | Outbound calls throttled properly |
| No timeouts | AbortSignal.timeout 30s | Phase 1 (2026-03-11) | Hung requests now fail fast |
| Direct `await handleWahaInbound` | Will become queue-based | Phase 2 (this phase) | Flood protection + DM priority |
| Raw `throw new Error(...)` to LLM | Will become formatted errors | Phase 2 (this phase) | Actionable error messages for Sammie |

## Open Questions

1. **Circuit Breaker (deferred from Phase 1)**
   - What we know: CONTEXT.md lists it as "Claude's Discretion" to evaluate
   - What's unclear: Whether the health check + error formatter already provide enough protection
   - Recommendation: Do NOT add circuit breaker in Phase 2. Health check provides awareness, error formatter provides actionable feedback. Circuit breaker (blocking sends when unhealthy) was explicitly rejected in decisions ("Warn only -- do NOT block outbound sends"). Defer to Phase 4 if needed.

2. **Queue Item Type Definition**
   - What we know: `handleWahaInbound` takes a specific params object with message, rawPayload, account, config, runtime, statusSink
   - What's unclear: Whether to define QueueItem as this full params object or a lighter wrapper
   - Recommendation: Use the full params object as QueueItem. It's already constructed at each call site. No benefit to stripping fields.

3. **Admin Panel Tab vs Dashboard Integration**
   - What we know: CONTEXT.md says "New Queue tab" for queue stats
   - What's unclear: Whether health status belongs on Dashboard or Status tab
   - Recommendation: Health status goes on existing Dashboard (green/yellow/red dot near session badge). Queue gets its own new tab. This keeps the dashboard as the at-a-glance view.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts (exists, minimal config) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RES-01 | Health ping calls `/api/{session}/me` every intervalMs | unit | `npx vitest run tests/health.test.ts -t "pings" --reporter=verbose` | Wave 0 |
| RES-01 | Health ping uses skipRateLimit, short timeout | unit | `npx vitest run tests/health.test.ts -t "skipRateLimit" --reporter=verbose` | Wave 0 |
| RES-02 | 3 consecutive failures sets status to "unhealthy" | unit | `npx vitest run tests/health.test.ts -t "unhealthy" --reporter=verbose` | Wave 0 |
| RES-02 | Success after failures resets to "healthy" | unit | `npx vitest run tests/health.test.ts -t "resets" --reporter=verbose` | Wave 0 |
| RES-03 | Queue drops oldest when at capacity | unit | `npx vitest run tests/inbound-queue.test.ts -t "overflow" --reporter=verbose` | Wave 0 |
| RES-03 | Overflow increments drop counter | unit | `npx vitest run tests/inbound-queue.test.ts -t "counter" --reporter=verbose` | Wave 0 |
| RES-04 | DM messages processed before group messages | unit | `npx vitest run tests/inbound-queue.test.ts -t "priority" --reporter=verbose` | Wave 0 |
| RES-05 | Rate limit errors get retry suggestion | unit | `npx vitest run tests/error-formatter.test.ts -t "rate limit" --reporter=verbose` | Wave 0 |
| RES-05 | Timeout errors get retry suggestion | unit | `npx vitest run tests/error-formatter.test.ts -t "timeout" --reporter=verbose` | Wave 0 |
| RES-05 | Not-found errors suggest search action | unit | `npx vitest run tests/error-formatter.test.ts -t "not found" --reporter=verbose` | Wave 0 |
| RES-05 | Auth errors say "do not retry" | unit | `npx vitest run tests/error-formatter.test.ts -t "auth" --reporter=verbose` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/health.test.ts` -- covers RES-01, RES-02
- [ ] `tests/inbound-queue.test.ts` -- covers RES-03, RES-04
- [ ] `tests/error-formatter.test.ts` -- covers RES-05

*(Existing test files: token-bucket.test.ts, http-client.test.ts, lru-cache.test.ts, dedup.test.ts -- these do not need modification)*

## Sources

### Primary (HIGH confidence)
- Direct source code analysis of `src/monitor.ts`, `src/channel.ts`, `src/inbound.ts`, `src/http-client.ts`, `src/config-schema.ts`
- CONTEXT.md user decisions (locked implementation approach)
- REQUIREMENTS.md requirement definitions (RES-01 through RES-05)
- STATE.md Phase 1 completion status and accumulated decisions

### Secondary (MEDIUM confidence)
- Node.js setTimeout vs setInterval behavior (well-established Node.js patterns)
- Array.shift() performance for small arrays (< 100 items -- O(n) but negligible at this scale)

### Tertiary (LOW confidence)
- None -- all findings based on direct code analysis and locked user decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing infrastructure
- Architecture: HIGH -- three isolated modules with clear integration points, patterns verified against existing code
- Pitfalls: HIGH -- based on direct analysis of current webhook handler, timer patterns, and error flow

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable -- no external dependency changes expected)
