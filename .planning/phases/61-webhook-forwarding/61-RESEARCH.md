# Phase 61: Webhook Forwarding - Research

**Researched:** 2026-03-28
**Domain:** Outbound webhook delivery — HMAC signing, retry with exponential backoff, circuit breaker, config persistence
**Confidence:** HIGH

## Summary

Phase 61 adds operator-facing webhook forwarding: every inbound WhatsApp message that passes through `handleWahaInbound` is also POSTed to a configured callback URL with an `X-Chatlytics-Signature` header (HMAC-SHA256 of the raw body using the operator's API key). Delivery failures get exponential backoff retries (1s/2s/4s) and a circuit breaker to prevent queue saturation when the endpoint is persistently down.

The existing codebase already has all the primitives needed. `signature.ts` shows the HMAC pattern (SHA-512 inbound verification — we mirror it for outbound SHA-256). `http-client.ts` shows the token-bucket + retry pattern. `inbound.ts` / `monitor.ts` shows where to hook in. No new npm dependencies are required. Everything is node:crypto + native fetch (Node 18+).

The primary integration point is `handleWahaInbound` in `inbound.ts`. After the agent runtime delivers the message, the webhook forwarder fires asynchronously (fire-and-forget from the inbound path) so it never blocks message delivery. The retry engine and circuit breaker live in a new `src/webhook-forwarder.ts` module.

**Primary recommendation:** New `src/webhook-forwarder.ts` module with `forwardWebhook()` async function. Called as fire-and-forget from `handleWahaInbound`. Config stored under `channels.waha.webhookSubscriptions[]` in the existing config schema. No external queue library — in-memory retry with `setTimeout` chain is sufficient for 3 attempts with known delays.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None explicitly locked. All implementation choices are Claude's discretion.

### Claude's Discretion
- Queue implementation (in-memory vs SQLite-backed)
- Circuit breaker thresholds
- Dead letter storage
- Retry timing parameters

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOOK-01 | Inbound messages forwarded to registered callback URLs | Call `forwardWebhook()` from `handleWahaInbound` after message preprocessing; config provides target URLs |
| HOOK-02 | HMAC-SHA256 signatures on webhook payloads (`X-Chatlytics-Signature` header) | `node:crypto` `createHmac('sha256', secret).update(body).digest('hex')` — pattern already in `signature.ts` |
| HOOK-03 | Exponential backoff retry (3 attempts: 1s/2s/4s) with circuit breaker | In-memory retry loop with `setTimeout`; circuit breaker state (open/closed/half-open) stored per subscription URL in module-level Map |
| HOOK-04 | Webhook subscription stored in config (URL, event filters) | Extend `WahaAccountSchemaBase` with `webhookSubscriptions` array; persist via existing `writeConfig`/`modifyConfig` pattern |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:crypto` | built-in | HMAC-SHA256 signature generation | Already used in `signature.ts` and `api-v1-auth.ts` |
| `node:http` / `fetch` | built-in (Node 18+) | HTTP POST to callback URL | Already used throughout codebase |
| `zod` | already installed | Schema validation for new config fields | Already used in `config-schema.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `better-sqlite3` | already installed | Dead letter log persistence | Only if dead letter persistence is needed (in-memory log acceptable for v1) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory retry + setTimeout | `p-retry` npm package | p-retry adds a dependency; setTimeout chain is 15 lines and zero deps — prefer in-memory |
| In-memory circuit breaker | `opossum` npm package | opossum is 60KB+ — not needed; a simple counter + timestamp per URL is sufficient |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── webhook-forwarder.ts   # NEW: forwardWebhook(), circuit breaker, retry engine
├── inbound.ts             # MODIFY: call forwardWebhook() after handleWahaInbound delivers
├── config-schema.ts       # MODIFY: add webhookSubscriptions[] to WahaAccountSchemaBase
├── monitor.ts             # MODIFY: add GET/POST /api/admin/webhook-subscriptions routes
└── webhook-forwarder.test.ts  # NEW: unit tests for forwarder, retry, circuit breaker
```

### Pattern 1: Fire-and-Forget from inbound.ts
**What:** After `handleWahaInbound` delivers the message to the LLM, call `forwardWebhook()` without awaiting it. Never let delivery failure propagate to the inbound path.
**When to use:** Always — webhook forwarding must not slow down or break message delivery.
**Example:**
```typescript
// In handleWahaInbound, after delivery (near bottom of function)
// DO NOT await — must not block or throw on inbound path
void forwardWebhook({ account, config, message: rawMessage, rawPayload }).catch((err) => {
  log.warn("webhook forward fire-and-forget error", { error: String(err) });
});
```

### Pattern 2: HMAC-SHA256 Signature Generation
**What:** Sign the raw JSON body with the operator's API key (or a dedicated `webhookSecret`) using HMAC-SHA256. Send as `X-Chatlytics-Signature: sha256=<hex>`.
**When to use:** On every outbound webhook POST.
**Example:**
```typescript
// Source: node:crypto (built-in)
import { createHmac } from "node:crypto";

function signWebhookBody(body: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${sig}`;
}
```

Note: The existing `signature.ts` uses SHA-512 for WAHA inbound verification (WAHA's own format). The outbound signature for operators uses SHA-256 (industry standard, same as GitHub webhooks). These are different concerns.

### Pattern 3: Exponential Backoff Retry
**What:** Attempt delivery, wait 1s on failure, try again, wait 2s, try again, wait 4s. After 3 failures, dead-letter.
**When to use:** On any non-2xx response or network error.
**Example:**
```typescript
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

async function deliverWithRetry(url: string, body: string, headers: Record<string, string>): Promise<"delivered" | "dead-lettered"> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { method: "POST", body, headers }, 5_000);
      if (res.ok) return "delivered";
      if (res.status < 500) return "dead-lettered"; // 4xx = client error, no retry
    } catch (err) {
      // network error or timeout — retry
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return "dead-lettered";
}
```

### Pattern 4: Circuit Breaker (per-URL)
**What:** Track consecutive timeouts per destination URL. After 3 consecutive timeouts, open the circuit (no more delivery attempts) until the half-open probe succeeds.
**When to use:** Timeout detection (AbortController with 5s timeout). Not triggered by 5xx errors — those retry. Only triggered by timeout/no-response.
**Example:**
```typescript
// Success criteria: < 2 seconds per HOOK-01 requirement
// Circuit breaker: 3 consecutive timeouts → open

interface CircuitState {
  consecutiveTimeouts: number;
  openedAt: number | null; // null = closed
  halfOpenAt: number | null; // probe scheduled
}

const circuitMap = new Map<string, CircuitState>();

function isCircuitOpen(url: string): boolean {
  const s = circuitMap.get(url);
  if (!s || s.openedAt === null) return false;
  // Half-open after 60 seconds — allow one probe
  if (Date.now() - s.openedAt > 60_000) return false; // probe
  return true;
}
```

### Anti-Patterns to Avoid
- **Awaiting forwardWebhook in the inbound path:** This is the worst mistake — a slow callback URL would delay every inbound message. Always fire-and-forget.
- **Using the WAHA API key (X-Api-Key) as the HMAC secret:** The operator's Chatlytics API key (`publicApiKey`) is the right secret for signing. Do not expose internal WAHA credentials.
- **Retrying 4xx responses:** 4xx means the operator's endpoint rejected the payload (bad format, auth error etc.). Retrying is wasteful — dead-letter immediately.
- **Global circuit breaker:** The circuit must be per-URL so one bad endpoint doesn't block forwarding to other healthy endpoints.
- **Blocking the retry loop:** Use `setTimeout` + `Promise` wrapping, not synchronous sleep. Node.js event loop must remain unblocked.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timeout on fetch | Manual timer cleanup | `AbortController` + `signal` in fetch options | Built-in, works in Node 18+ |
| HMAC signing | Custom hash concat | `node:crypto` `createHmac` | Timing-safe, correct encoding |
| Config persistence | Custom file write | Existing `modifyConfig()` from `config-io.ts` | Already handles mutex, atomic rename, backup |

**Key insight:** All infrastructure (HTTP, crypto, config persistence, logging) already exists in this codebase. The webhook forwarder is pure orchestration logic on top of existing primitives.

## Common Pitfalls

### Pitfall 1: Blocking inbound delivery
**What goes wrong:** `await forwardWebhook(...)` in the inbound path causes all message delivery to wait on the callback URL's response time.
**Why it happens:** Natural instinct to await async calls.
**How to avoid:** Always `void forwardWebhook(...).catch(...)` — fire-and-forget pattern.
**Warning signs:** Inbound messages taking longer than usual; gateway timeout logs.

### Pitfall 2: Config schema rejection on startup
**What goes wrong:** Adding `webhookSubscriptions` to `WahaAccountSchemaBase` with `.strict()` fails to parse existing configs that don't have the new field.
**Why it happens:** Zod `.strict()` is already in use — adding required fields breaks existing configs.
**How to avoid:** New fields MUST use `.optional().default([])` — this is explicitly called out in STATE.md accumulated decisions.
**Warning signs:** "validation_failed" errors in gateway logs on startup after deploy.

### Pitfall 3: HMAC secret exposure
**What goes wrong:** Using `webhookHmacKey` (the WAHA inbound HMAC) or `apiKey` (WAHA API key) as the outbound signature secret.
**Why it happens:** Config already has HMAC-related fields.
**How to avoid:** Use `publicApiKey` (the Chatlytics operator key) as the signing secret for outbound webhooks. If operator wants a separate `webhookSecret`, add it to the config schema explicitly. Keep WAHA credentials internal.
**Warning signs:** Operators unable to verify signatures because they received the wrong key.

### Pitfall 4: Circuit breaker never closing
**What goes wrong:** Circuit stays open forever because no half-open probe logic exists.
**Why it happens:** Only opening logic is implemented, closing is forgotten.
**How to avoid:** Implement half-open probe: after `openedAt + 60s`, allow one delivery attempt. On success, close circuit; on failure, reset `openedAt`.
**Warning signs:** After a temporary outage, webhook delivery never resumes.

### Pitfall 5: Retry consuming the inbound queue
**What goes wrong:** Retry `setTimeout` chains accumulate in memory if many destinations are failing simultaneously.
**Why it happens:** Each retry fires async work that stays in flight.
**How to avoid:** Cap in-flight retries per-URL (simple counter). Default: max 3 concurrent retry chains per URL. Excess arrivals are dead-lettered immediately when circuit is open.

### Pitfall 6: Wrong placement in handleWahaInbound
**What goes wrong:** Calling `forwardWebhook` before the message passes all the inbound filters (DM policy, allow-list, dedup). Sends filtered/duplicate messages to the callback.
**Why it happens:** Wanting to forward "all WAHA events" not just "delivered messages".
**How to avoid:** Per HOOK-01 requirement ("inbound messages forwarded"), fire only after the message would have been delivered — near the bottom of `handleWahaInbound`, after policy checks. For now forward all messages that reach delivery (OpenClaw runtime route), matching what the agent sees.

## Code Examples

Verified patterns from project codebase:

### HMAC-SHA256 Outbound Signing
```typescript
// Source: node:crypto built-in, mirrors signature.ts pattern
import { createHmac } from "node:crypto";

export function signWebhookPayload(bodyStr: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(bodyStr).digest("hex");
}
```

### Fetch with AbortController Timeout
```typescript
// Source: node:fetch (Node 18+) with AbortController — same pattern as http-client.ts timeout
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

### Config Schema Extension (must be optional+default per STATE.md)
```typescript
// Source: config-schema.ts pattern — all new fields use .optional().default()
webhookSubscriptions: z.array(z.object({
  url: z.string().url(),
  events: z.array(z.string()).optional().default(["message"]),
  enabled: z.boolean().optional().default(true),
})).optional().default([]),
```

### modifyConfig for Subscription Updates
```typescript
// Source: config-io.ts modifyConfig — already handles mutex + atomic rename
import { modifyConfig } from "./config-io.js";

await modifyConfig(configPath, (cfg) => {
  const waha = cfg.channels?.waha ?? {};
  waha.webhookSubscriptions = [...(waha.webhookSubscriptions ?? []), newSub];
  return { ...cfg, channels: { ...cfg.channels, waha } };
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom HMAC lib | `node:crypto` createHmac | Node 12+ | No dependency needed |
| Callback-based retry | Promise + setTimeout | Node 8+ | Cleaner async flow |
| Global circuit breaker | Per-URL circuit breaker | Industry standard | Isolates endpoint failures |

## Open Questions

1. **Dead letter storage: in-memory vs SQLite**
   - What we know: STATE.md notes "reject-not-queue as default" for quiet hours; no SQLite dead letter exists yet
   - What's unclear: Should failed webhooks persist across restarts?
   - Recommendation: For v1, log dead letters to the structured logger only (no SQLite). Can be upgraded in a later phase. This matches the "reject-not-queue" philosophy and avoids queue complexity.

2. **Event filtering (HOOK-04 mentions "event filters")**
   - What we know: WAHA sends many event types (message, message.any, session.status, etc.). Monitor.ts already filters to `message` events.
   - What's unclear: Should operators receive only `message` events, or also session status events?
   - Recommendation: Start with `message` events only (what the agent sees). Add `events` array to config for future extensibility, defaulting to `["message"]`.

3. **Which messages to forward: pre-filter or post-filter?**
   - What we know: The success criteria says "sending a WhatsApp message to the connected account causes an HTTP POST" — this suggests all inbound messages regardless of policy.
   - Recommendation: Forward from the webhook handler in `monitor.ts` BEFORE `handleWahaInbound` (before DM/group filtering), so operators see every raw inbound message. This is more useful for operators building their own routing. Use `rawPayload` from the WAHA event.

4. **HMAC secret: reuse `publicApiKey` or add dedicated `webhookSecret`?**
   - What we know: `publicApiKey` is already in config for REST API auth.
   - Recommendation: Reuse `publicApiKey` as the HMAC signing secret (simpler, one less config field). Operators already have this key. Add a separate `webhookSecret` only if operators request it.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — pure in-process TypeScript, uses only node built-ins already present in the runtime).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (already installed) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run src/webhook-forwarder.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOOK-01 | `forwardWebhook()` POSTs to configured URL when called | unit | `npx vitest run src/webhook-forwarder.test.ts` | ❌ Wave 0 |
| HOOK-02 | `X-Chatlytics-Signature: sha256=<hex>` header present and verifiable | unit | `npx vitest run src/webhook-forwarder.test.ts` | ❌ Wave 0 |
| HOOK-03 | 5xx triggers 3 retries at 1s/2s/4s; circuit opens after 3 timeouts | unit | `npx vitest run src/webhook-forwarder.test.ts` | ❌ Wave 0 |
| HOOK-04 | `webhookSubscriptions` persisted to config via `modifyConfig` | unit | `npx vitest run src/webhook-forwarder.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/webhook-forwarder.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/webhook-forwarder.test.ts` — covers HOOK-01 through HOOK-04 with mocked fetch

## Sources

### Primary (HIGH confidence)
- Project source: `src/signature.ts` — HMAC pattern, timing-safe compare
- Project source: `src/http-client.ts` — timeout + retry pattern with AbortController
- Project source: `src/config-schema.ts` — Zod `.optional().default()` requirement (confirmed from `.strict()` usage and STATE.md directive)
- Project source: `src/monitor.ts` — webhook ingest path, `handleWahaInbound` call site at line 442
- Project source: `src/config-io.ts` (via imports in monitor.ts) — `modifyConfig` atomic write pattern

### Secondary (MEDIUM confidence)
- Node.js 18+ built-in `fetch` + `AbortController` — standard cross-platform approach
- GitHub webhooks signature format `sha256=<hex>` — widely understood by operators

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all primitives already in project
- Architecture: HIGH — integration points confirmed via source inspection
- Pitfalls: HIGH — derived from existing DO NOT CHANGE comments and STATE.md decisions

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable domain — node:crypto API does not change)
