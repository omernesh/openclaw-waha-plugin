# Phase 1: Reliability Foundation - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract `callWahaApi()` into a new `http-client.ts` module that composes timeout, rate limiting, retry with backoff, and structured logging. Replace unbounded caches with LRU. Add webhook deduplication by messageId. All 60+ WAHA API functions in send.ts get reliability for free with zero signature changes.

Requirements: REL-01 through REL-11

</domain>

<decisions>
## Implementation Decisions

### HTTP Client Extraction
- Extract `callWahaApi()` from send.ts into new `src/http-client.ts` module
- Leave a thin re-export wrapper in send.ts so all 60+ downstream functions work with zero changes
- The extracted function is the single chokepoint — all reliability features compose here
- DO NOT rewrite send.ts — extract, don't rewrite (code is brittle with DO NOT CHANGE markers)

### Request Timeouts (REL-03, REL-04)
- Use built-in `AbortSignal.timeout(30_000)` — zero dependencies, one-line addition
- 30s default timeout, configurable via plugin config
- On timeout for mutation endpoints (send, edit, delete): return "may have succeeded" warning, do NOT retry
- On timeout for read endpoints (get, list, search): safe to retry once
- Handle `TimeoutError` distinctly from `AbortError` in error logging

### Structured Error Logging (REL-01, REL-02)
- Replace ALL ~20 `.catch(() => {})` patterns with `console.warn` including: action name, chatId, HTTP status, error message
- Fire-and-forget calls (presence, typing, seen) get warning logs, not thrown errors
- Format: `[WAHA] ${action} ${chatId} failed: ${status} ${message}`
- Media preprocessing failures must be surfaced, not silently dropped

### Outbound Rate Limiter (REL-05, REL-06)
- Custom token bucket implementation (~60 lines) in `http-client.ts`
- Default: 20 tokens/sec capacity, refill at 15/sec (WAHA is localhost, generous limit)
- Fire-and-forget calls (presence, typing) exempt from rate limiter — they must not starve user-facing sends
- Queue excess requests and drain at allowed rate
- Per-session bucket design (supports multi-session in Phase 4)
- Configurable via plugin config

### 429 Backoff (REL-07, REL-08)
- Exponential backoff with jitter: 1s → 2s → 4s, max 3 retries, cap at 30s
- Read `Retry-After` header when present
- Shared backoff state — one 429 pauses all pending calls (prevents thundering herd)
- Only retry on 429 status. All other HTTP errors: log and surface to caller, no retry
- This is a SAFETY NET — the proactive rate limiter should prevent most 429s

### Webhook Deduplication (REL-09)
- Composite dedup key: `${eventType}:${messageId}` — NOT just messageId alone
- Keep existing `message` vs `message.any` event-type filter as PRIMARY guard
- Dedup is SECONDARY safety net for duplicate deliveries of the same event
- Sliding window Set of last 200 entries with 5-minute TTL
- In-memory is fine — restarts safely clear the window (no persistence needed)

### LRU Cache (REL-10)
- Use `lru-cache` npm package v11.2.6 (isaacs, 170M+ weekly downloads) — NOT custom implementation
- Replace unbounded `Map` in resolveTarget cache: max 1000 entries, 30s TTL
- Add as new dependency in package.json
- Swap is straightforward: `new Map()` → `new LRUCache({ max: 1000, ttl: 30_000 })`

### Memory Audit (REL-11)
- Verify no other unbounded Maps or arrays accumulate across requests
- Check event listener cleanup in webhook handler
- Verify config cache doesn't grow unbounded
- Document findings in commit message

### Claude's Discretion
- Exact token bucket implementation details (sliding window vs fixed window)
- Error message formatting beyond the specified pattern
- Whether to add circuit breaker pattern (research suggested it, not required)
- Exact jitter algorithm for backoff
- Internal module organization within http-client.ts

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `callWahaApi()` in send.ts: Single function for ALL outbound WAHA HTTP calls — the extraction target
- `getCachedConfig()` in send.ts: Config caching pattern that must be preserved
- `_resolveCache` Map in send.ts: The unbounded cache to replace with LRU

### Established Patterns
- All WAHA API calls go through `callWahaApi()` — single chokepoint makes extraction clean
- Fire-and-forget presence calls use `.catch(() => {})` — ~20 instances to replace
- `toArr()` helper converts WAHA dict responses to arrays
- Config is cached via `getCachedConfig()` for use in outbound context

### Integration Points
- `send.ts` imports `callWahaApi` — after extraction, import from `http-client.ts` instead
- `inbound.ts` webhook handler — add dedup check before processing
- `monitor.ts` HTTP server — no changes needed
- `channel.ts` action dispatch — no changes needed (calls send.ts functions)
- `package.json` — add `lru-cache` dependency

### Critical Constraints
- send.ts has many DO NOT CHANGE markers — read ALL comments before modifying
- `assertAllowedSession()` guardrail must NOT be touched in this phase
- vCard interception stays in `deliverWahaReply` (inbound.ts) — DO NOT MOVE
- Deploy to BOTH hpg6 locations after changes

</code_context>

<specifics>
## Specific Ideas

- Research confirmed `callWahaApi` is the single chokepoint — extracting it gives all functions reliability for free
- `lru-cache` over custom implementation — handles edge cases (TTL autopurge, dispose callbacks) that a 30-line custom version would miss
- Rate limiter must be per-session ready (even though Phase 1 is single-session) to avoid rework in Phase 4
- AbortController pitfall: timeout during response body read can cause false failures on mutations that already succeeded server-side — must handle this case

</specifics>

<deferred>
## Deferred Ideas

- Circuit breaker pattern — research suggested it but not required for Phase 1. Consider in Phase 2 if needed.
- Per-session rate limit buckets — design for it now, implement in Phase 4 (multi-session)
- Admin panel rate limit metrics — Phase 2 (resilience & observability)

</deferred>

---

*Phase: 01-reliability-foundation*
*Context gathered: 2026-03-11*
