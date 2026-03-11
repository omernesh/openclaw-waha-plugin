# Project Research Summary

**Project:** WAHA OpenClaw Plugin -- Reliability Hardening & Multi-Session
**Domain:** Production WhatsApp bot plugin reliability, resilience, and multi-session orchestration
**Researched:** 2026-03-11
**Confidence:** HIGH

## Executive Summary

The WAHA OpenClaw Plugin is a production WhatsApp integration (v1.10.4) with ~87% WAHA API coverage and a working feature set. However, the codebase has zero reliability infrastructure: no request timeouts, no rate limiting, no cache bounds, no structured error logging, and silent error swallowing across ~20 call sites. The single outbound chokepoint (`callWahaApi` in send.ts) has none of the standard protections that production HTTP clients require. This is the highest-priority gap -- every outbound call can hang forever, and WhatsApp account bans from unthrottled sends are a real risk.

The recommended approach is a bottom-up reliability-first strategy. Extract `callWahaApi` into a new `http-client.ts` module that composes timeout, rate limiting, retry with backoff, circuit breaking, and structured logging. This single extraction point means all 60+ WAHA API functions in send.ts get reliability for free with zero signature changes. Follow this with cache bounding (LRU), webhook deduplication, and session health monitoring. Only after reliability is solid should multi-session support (session registry, trigger words, cross-session routing) be attempted -- it requires reworking a safety guardrail (`assertAllowedSession`) that has already been accidentally broken once in the project's history.

Key risks are: (1) AbortController timeouts aborting during response body reads, causing false failures on mutations that already succeeded server-side; (2) rate limiter starving user-facing operations because fire-and-forget presence calls drain the token budget; (3) session guardrail regression during multi-session -- the bot impersonating the human user. All three have concrete prevention strategies documented in the research.

## Key Findings

### Recommended Stack

The project should add only 1-2 new dependencies. Almost everything is built with Node.js built-ins or custom code (~100 lines each). See [STACK.md](STACK.md) for full details.

**Core technologies:**
- **AbortSignal.timeout()** (built-in): Request timeouts -- zero dependencies, one-line change in `callWahaApi`
- **Custom token bucket** (~60 lines): Outbound rate limiting -- single chokepoint, allows per-session buckets later
- **lru-cache v11** (npm, isaacs): Bounded cache with TTL and eviction -- replaces unbounded `Map` in resolveTarget
- **p-queue v8** (npm, sindresorhus): Inbound message queue with concurrency and priority -- handles webhook flood protection
- **Custom sliding window** (~40 lines): Webhook deduplication by `eventType:messageId` composite key
- **setInterval + WAHA health endpoint** (built-in): Session health monitoring -- poll every 30s, escalate on consecutive failures
- **SQLite** (existing `better-sqlite3`): Session registry storage -- no new dependency

**Total new packages: 1 required (lru-cache), 1 optional (p-queue).**

### Expected Features

See [FEATURES.md](FEATURES.md) for the full landscape and dependency graph.

**Must have (table stakes -- system breaks without these):**
- Request timeouts on all WAHA API calls
- Structured error logging (replace ~20 `.catch(() => {})` sites)
- Webhook deduplication by messageId
- Cache bounds (LRU with max size)
- Outbound rate limiter (token bucket)
- 429 backoff with jitter

**Should have (differentiators):**
- Session health monitoring with admin panel integration
- Inbound message queue with DM priority over group messages
- Better error messages with actionable context for the LLM
- Multi-session registry with role-based permissions
- Trigger word activation for group chats
- URL preview sends, mute/unmute, mentions detection

**Defer (v2+ or indefinitely):**
- Cross-session message routing (high complexity, dangerous without guardrails)
- Group events (join/leave) -- NOWEB webhook support unverified
- Scheduled/delayed messages -- WAHA does not support
- Global message persistence -- not the plugin's job
- Auto-reconnect with QR re-scan -- requires human intervention

### Architecture Approach

The central insight is that `callWahaApi()` is the single chokepoint for all outbound WAHA traffic. Extracting it into a dedicated `http-client.ts` module that composes all reliability concerns means every API function gets protection automatically with zero signature changes. See [ARCHITECTURE.md](ARCHITECTURE.md) for component designs and data flows.

**Major components:**
1. **http-client.ts** (NEW) -- timeout, rate limit, retry, circuit breaker, structured logging for all WAHA calls
2. **lru-cache replacement** -- swap unbounded `Map` in send.ts for `lru-cache` with max 1000 entries + 30s TTL
3. **session-registry.ts** (NEW, Phase 4) -- multi-session lifecycle, health monitoring, role-based access control
4. **trigger-words.ts** (NEW, Phase 4) -- trigger-word matching and activation for group chat routing

**Key architectural constraint:** send.ts is 1600+ lines with many DO NOT CHANGE markers. The migration strategy is "extract, don't rewrite" -- move `callWahaApi` out, leave a thin wrapper in place, zero changes to the 60+ downstream functions.

### Critical Pitfalls

See [PITFALLS.md](PITFALLS.md) for all 12 pitfalls with detailed prevention strategies.

1. **AbortController aborting during response body read** -- Use generous 30s timeout. Never retry mutations on timeout; return "may have succeeded" warning. Handle `TimeoutError` distinctly from `AbortError`.
2. **Rate limiter starving user-facing operations** -- Exempt or deprioritize fire-and-forget calls (presence, typing). Set rate limit generously (30-50 req/s) since WAHA is localhost. Use priority lanes.
3. **Session guardrail regression** -- Replace hardcoded check with config-driven allowlist but keep default-deny. Sessions not explicitly listed as `bot` CANNOT send. Add integration test verifying human-listener sessions throw on all send functions.
4. **Webhook dedup over-filtering** -- Use composite dedup key `${eventType}:${messageId}`, not just messageId. Keep existing event-type filter as primary guard; dedup is secondary safety net.
5. **429 backoff thundering herd** -- Add jitter to backoff delays. Use shared backoff state so one 429 pauses all pending calls. Read `Retry-After` header. Cap at 3 retries / 30s max.

## Implications for Roadmap

### Phase 1: Reliability Foundation
**Rationale:** Every other feature depends on reliable WAHA API communication. Without timeouts and rate limiting, the system can hang indefinitely or get the WhatsApp account banned. This is the highest-risk gap.
**Delivers:** Production-grade HTTP client, bounded caches, webhook deduplication, structured error logging.
**Addresses:** Request timeouts, error logging, webhook dedup, cache bounds, rate limiter, 429 backoff (all table stakes from FEATURES.md).
**Avoids:** Pitfalls 1 (timeout body read), 2 (rate limiter starvation), 4 (dedup over-filtering), 5 (stale LRU entries), 8 (silent error swallowing), 12 (backoff thundering herd).
**Stack:** AbortSignal.timeout (built-in), custom token bucket, lru-cache (npm), custom dedup sliding window.
**Estimated effort:** 1-2 days. Low risk -- well-understood patterns, single file extraction.

### Phase 2: Resilience & Observability
**Rationale:** With the HTTP client reliable, add monitoring and load handling. Session health monitoring detects silent disconnects. Message queue prevents webhook floods from overwhelming the handler.
**Delivers:** Session health monitoring with admin panel integration, inbound message queue with DM priority, better error messages for LLM context.
**Addresses:** Session health monitoring, inbound message queue, better error messages (differentiators from FEATURES.md).
**Avoids:** Pitfall 8 (presence errors hiding real issues -- escalation after consecutive failures).
**Stack:** setInterval + WAHA health endpoint, p-queue (npm).
**Estimated effort:** 1-2 days. Low-medium risk -- health check is straightforward, queue needs load testing.

### Phase 3: Quick-Win Features
**Rationale:** Low-effort features that fill basic gaps. All use existing WAHA endpoints that just need wiring. No architectural changes required.
**Delivers:** URL preview sends, mute/unmute chat, mentions detection, multi-recipient send.
**Addresses:** URL preview, mute/unmute, mentions detection, multi-recipient send (differentiators from FEATURES.md).
**Stack:** No new dependencies. All WAHA API wiring.
**Estimated effort:** 2-3 days. Low risk -- mostly straightforward endpoint integration.

### Phase 4: Multi-Session & Trigger Words
**Rationale:** High-complexity phase that reworks the session guardrail. Must come last because it requires all reliability infrastructure to be in place first. The guardrail has been accidentally broken before -- this phase needs careful implementation with integration tests.
**Delivers:** Multi-session registry with roles, trigger word activation for group chats, admin panel session management.
**Addresses:** Multi-session registry, trigger word activation (differentiators from FEATURES.md).
**Avoids:** Pitfalls 3 (session guardrail regression), 6 (trigger word false positives), 7 (cross-session routing loops), 9 (config PUT replacing fields), 10 (memory leaks from event listeners), 11 (SQLite write contention).
**Stack:** SQLite (existing), custom session-registry.ts, custom trigger-words.ts.
**Estimated effort:** 4-6 days. HIGH risk -- reworks safety guardrail, cross-session security implications.

### Phase Ordering Rationale

- **Phase 1 before everything:** Timeouts and rate limiting are prerequisites for all other work. The rate limiter must exist before health checks (which make API calls) and message queues (which trigger API calls).
- **Phase 2 depends on Phase 1:** Health monitoring uses `http-client.ts` for pings. Message queue routes through the rate-limited HTTP client.
- **Phase 3 is independent:** Quick-win features can be built any time after Phase 1 (they benefit from the reliable HTTP client). Placed here for pacing -- low-risk work between the reliability foundation and high-risk multi-session.
- **Phase 4 last:** Multi-session is the highest-complexity, highest-risk work. It must not be attempted until the reliability infrastructure is battle-tested in production.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (Multi-Session):** Complex guardrail rework with security implications. Needs detailed design review of `assertAllowedSession` replacement logic, cross-session message routing safety, and OpenClaw gateway's plugin loading model for multi-session webhooks.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Reliability):** All patterns (timeout, token bucket, LRU, dedup) are thoroughly documented with concrete implementations in the research files.
- **Phase 2 (Resilience):** Health polling and async queues are well-established patterns. `p-queue` API is well-documented.
- **Phase 3 (Quick Wins):** Pure WAHA API wiring -- endpoints are documented and similar to existing implementations.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Built-in APIs (AbortSignal) verified via MDN. lru-cache and p-queue are industry-standard packages with massive adoption. Custom implementations (token bucket, dedup) are well-understood algorithms. |
| Features | HIGH | Table stakes identified from codebase gap analysis. Differentiators validated against WAHA API capabilities. Anti-features clearly justified. |
| Architecture | HIGH | Based on direct codebase analysis. The `callWahaApi` chokepoint pattern is verified. Migration strategy (extract, don't rewrite) minimizes risk to brittle code. |
| Pitfalls | HIGH | 8 of 12 pitfalls derived from actual codebase patterns and project history (LESSONS_LEARNED.md). Remaining 4 from established distributed systems patterns. |

**Overall confidence:** HIGH

### Gaps to Address

- **p-queue ESM compatibility:** The project uses `"type": "module"` so ESM-only `p-queue` should work, but verify import compatibility with the OpenClaw plugin loader before committing to it. If it fails, fall back to a custom bounded queue.
- **WAHA NOWEB group events:** Whether WAHA's NOWEB engine delivers `group.join`/`group.leave` webhook events is unverified. Do not build group event features without testing actual webhook delivery first. Flagged for research if/when Phase 3 includes this.
- **OpenClaw gateway multi-session webhook routing:** The gateway's plugin loading model may constrain how multiple sessions share a single webhook endpoint. Needs verification during Phase 4 planning -- specifically, does the gateway call the plugin's inbound handler once per session or once per webhook?
- **lru-cache vs custom LRU:** STACK.md recommends `lru-cache` (npm) while ARCHITECTURE.md includes a custom ~30-line LRU implementation. Recommendation: use `lru-cache` (npm) -- it handles edge cases (TTL autopurge, dispose callbacks) that the custom version does not.

## Sources

### Primary (HIGH confidence)
- [AbortSignal.timeout() - MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- [lru-cache v11 - npm/GitHub](https://github.com/isaacs/node-lru-cache)
- [p-queue v8 - GitHub](https://github.com/sindresorhus/p-queue)
- [WAHA Send Messages docs](https://waha.devlike.pro/docs/how-to/send-messages/)
- [WAHA Sessions API docs](https://waha.devlike.pro/docs/how-to/sessions/)
- [Hookdeck webhook idempotency guide](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency)
- Codebase analysis: channel.ts, send.ts, inbound.ts, monitor.ts, accounts.ts, directory.ts

### Secondary (MEDIUM confidence)
- [WAHA Scaling - 500+ Sessions](https://dev.to/waha/waha-scaling-how-to-handle-500-whatsapp-sessions-3fie)
- [WhatsApp API rate limits](https://www.wati.io/en/blog/whatsapp-business-api/whatsapp-api-rate-limits/)
- [CodeWords group activation patterns](https://docs.codewords.ai/more-features/whatsapp-automations/for-whatsapp-groups)
- [Token bucket algorithm guides](https://hackernoon.com/the-token-bucket-algorithm-for-api-rate-limiting-in-nodejs-a-simple-guide)

### Tertiary (LOW confidence)
- [wa-multi-session](https://github.com/mimamch/wa-multi-session) -- multi-session WhatsApp patterns, needs validation against WAHA's specific model

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes*
