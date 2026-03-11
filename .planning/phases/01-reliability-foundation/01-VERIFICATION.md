---
phase: 01-reliability-foundation
verified: 2026-03-11T03:25:00Z
status: passed
score: 11/11 must-haves verified
gaps:
  - truth: "Config values (timeoutMs, rateLimitCapacity, rateLimitRefillRate) are wired to http-client at runtime"
    status: resolved
    reason: "configureReliability() now called from channel.ts startAccount() with account config values"
---

# Phase 1: Reliability Foundation Verification Report

**Phase Goal:** Every outbound WAHA API call is protected by timeouts, rate limiting, retry with backoff, and structured error logging -- no call can hang forever, no error is silently swallowed, and caches cannot grow unbounded
**Verified:** 2026-03-11T03:25:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When a WAHA API call fails, the console contains a structured log with action name, chatId, HTTP status, and error message | VERIFIED | `http-client.ts:255-257` logs `[WAHA] ${contextLabel} failed: ${status} ${errorText}` via console.warn |
| 2 | When a WAHA API call takes longer than 30s, it is aborted with a TimeoutError | VERIFIED | `http-client.ts:208` uses `AbortSignal.timeout(timeout)` with default 30000ms |
| 3 | When a mutation endpoint (POST/PUT/DELETE) times out, the error message says "may have succeeded" and no retry occurs | VERIFIED | `http-client.ts:213-216` checks `isMutation` and includes "may have succeeded" in error message |
| 4 | When a read endpoint (GET) times out, it is safe to retry once | VERIFIED | `http-client.ts:218-220` throws without "may have succeeded", allowing caller retry |
| 5 | When requests exceed 20/s, excess requests are queued and drained at 15/s | VERIFIED | `http-client.ts:40-89` TokenBucket class with capacity=20, refillRate=15; `http-client.ts:168` acquires token before fetch |
| 6 | When skipRateLimit is true, the call bypasses the token bucket | VERIFIED | `http-client.ts:167` checks `!params.skipRateLimit` before acquiring token |
| 7 | When WAHA returns 429, the client retries with exponential backoff (1s/2s/4s) and jitter, max 3 retries | VERIFIED | `http-client.ts:226-249` handles 429 with `Math.pow(2, attempt) * 1000` base delay, 0.75-1.25 jitter, MAX_RETRIES=3 |
| 8 | When a 429 response includes Retry-After, that value is used as the minimum delay | VERIFIED | `http-client.ts:234-235` reads `retry-after` header and uses `Math.max(jitter, retryAfterSec * 1000)` |
| 9 | When one call gets 429, all pending calls pause (shared backoff state) | VERIFIED | `http-client.ts:127` module-level `backoffUntil`, set at line 242, checked at line 172 via `waitForBackoffClear()` |
| 10 | When a presence/typing/seen call fails, a console.warn log appears with context instead of silent swallowing | VERIFIED | Zero `.catch(() => {})` remain in presence.ts, inbound.ts, send.ts. 14 instances in presence.ts and 7 in inbound.ts all use `warnOnError(context)` |
| 11 | When a duplicate webhook event arrives (same eventType:messageId), it is filtered before processing | VERIFIED | `monitor.ts:2117` and `monitor.ts:2144` call `isDuplicate()` for message and reaction events. `dedup.ts` implements composite key with 200-entry sliding window and 5-min TTL |
| 12 | When the resolveTarget cache exceeds 1000 entries, the oldest entries are evicted (LRU) | VERIFIED | `send.ts:1465-1468` uses `LRUCache<string, unknown[]>({ max: 1000, ttl: 30_000 })` |
| 13 | When the resolveTarget cache entry is older than 30s, it is expired by lru-cache TTL | VERIFIED | `send.ts:1467` sets `ttl: 30_000` |
| 14 | No Map or array in the codebase grows unbounded across requests | VERIFIED | Memory audit documented in `http-client.ts:1-6`. All Maps are bounded: _resolveCache (LRU 1000), _dedupEntries (200+TTL), instance maps (by account count) |
| 15 | Config values (timeoutMs, rateLimitCapacity, rateLimitRefillRate) are wired to http-client at runtime | FAILED | `configureReliability()` exported from http-client.ts but never imported or called from channel.ts or any other runtime file. Config fields are dead. |

**Score:** 14/15 truths verified (10/11 requirement-mapped truths pass -- the config wiring gap is a Plan 03 shortcoming)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/http-client.ts` | callWahaApi, TokenBucket, warnOnError, configureReliability | VERIFIED | 309 lines, all exports present, substantive implementation |
| `src/send.ts` | imports callWahaApi from http-client, LRUCache for resolveTarget | VERIFIED | Line 7: `import { callWahaApi, warnOnError } from "./http-client.js"`, Line 1465: LRUCache |
| `src/dedup.ts` | isDuplicate with composite key dedup | VERIFIED | 55 lines, composite key, bounded map, TTL pruning |
| `src/monitor.ts` | isDuplicate integrated for message and reaction events | VERIFIED | Lines 18, 2117, 2144 |
| `src/presence.ts` | All .catch(() => {}) replaced with warnOnError | VERIFIED | 14 warnOnError calls, zero silent catches |
| `src/inbound.ts` | .catch(() => {}) replaced with warnOnError | VERIFIED | 7 warnOnError calls, zero silent catches |
| `src/config-schema.ts` | timeoutMs, rateLimitCapacity, rateLimitRefillRate fields | VERIFIED | Lines 61-63, with Zod validation and defaults |
| `src/types.ts` | WahaAccountConfig extended with reliability fields | VERIFIED | Lines 72-74 |
| `vitest.config.ts` | Test framework configuration | VERIFIED | File exists |
| `tests/http-client.test.ts` | Unit tests for callWahaApi reliability features | VERIFIED | File exists (10727 bytes) |
| `tests/token-bucket.test.ts` | Unit tests for TokenBucket class | VERIFIED | File exists (1676 bytes) |
| `tests/dedup.test.ts` | Unit tests for webhook dedup | VERIFIED | File exists (2586 bytes) |
| `tests/lru-cache.test.ts` | Unit tests for LRU cache behavior | VERIFIED | File exists (2421 bytes) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/send.ts | src/http-client.ts | `import { callWahaApi, warnOnError }` | WIRED | Line 7 |
| src/http-client.ts | fetch() | `AbortSignal.timeout(timeout)` | WIRED | Line 208 |
| src/http-client.ts | TokenBucket | `await globalBucket.acquire()` | WIRED | Line 168 |
| src/presence.ts | src/http-client.ts | `import { warnOnError }` | WIRED | Line 2 |
| src/inbound.ts | src/http-client.ts | `import { warnOnError }` | WIRED | Line 26 |
| src/send.ts | lru-cache | `import { LRUCache }` | WIRED | Line 3, used at line 1465 |
| src/monitor.ts | src/dedup.ts | `import { isDuplicate }` | WIRED | Line 18, used at lines 2117, 2144 |
| src/channel.ts | src/http-client.ts | `configureReliability()` call at startup | NOT_WIRED | configureReliability is exported but never imported or called from channel.ts or any runtime code |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REL-01 | 01-01 | Structured error logging on all WAHA API calls | SATISFIED | http-client.ts:255-257 logs with context |
| REL-02 | 01-02 | All silent .catch(() => {}) replaced with warning logs | SATISFIED | Zero silent catches in presence.ts, inbound.ts, send.ts |
| REL-03 | 01-01 | 30s AbortController-based timeouts on all fetch() | SATISFIED | AbortSignal.timeout at http-client.ts:208 |
| REL-04 | 01-01 | Mutation timeouts return "may have succeeded" warnings | SATISFIED | http-client.ts:213-216 |
| REL-05 | 01-01 | Proactive token-bucket rate limiter (default ~20 req/s) | SATISFIED | TokenBucket(20, 15) at http-client.ts:96 |
| REL-06 | 01-01 | Fire-and-forget calls exempt from rate limiter | SATISFIED | skipRateLimit param at http-client.ts:143, checked at line 167 |
| REL-07 | 01-01 | Exponential backoff with jitter on 429 (1s/2s/4s, max 3) | SATISFIED | http-client.ts:226-249 |
| REL-08 | 01-01 | Read Retry-After header from 429 responses | SATISFIED | http-client.ts:234-235 |
| REL-09 | 01-02 | Webhook deduplication by composite key | SATISFIED | dedup.ts with composite key, integrated in monitor.ts |
| REL-10 | 01-02 | resolveTarget cache replaced with LRU (max 1000, 30s TTL) | SATISFIED | send.ts:1465-1468 LRUCache |
| REL-11 | 01-02 | Memory audit -- no unbounded growth | SATISFIED | Audit documented in http-client.ts:1-6 |

No orphaned requirements found -- all 11 REL-* requirements are claimed by plans and satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/http-client.ts | 108 | configureReliability() exported but never called | Warning | Config values are dead -- changing them in config has no effect |

### Human Verification Required

### 1. End-to-End Reliability in Production

**Test:** Send a message to Sammie, verify structured [WAHA] log entries appear in gateway logs
**Expected:** Gateway logs contain `[WAHA]` prefixed entries for any warnings/errors, no silent failures
**Why human:** Requires access to hpg6 and live WhatsApp interaction

### 2. Rate Limiter Under Load

**Test:** Send multiple rapid messages and observe queuing behavior
**Expected:** Messages are queued and processed without 429 errors from WAHA
**Why human:** Requires live WAHA API interaction, cannot simulate in unit tests

### Gaps Summary

One gap found: the `configureReliability()` function in `http-client.ts` is exported but **never called from any runtime code**. This means the config schema fields (`timeoutMs`, `rateLimitCapacity`, `rateLimitRefillRate`) added to `config-schema.ts` and `types.ts` are entirely dead -- users can set them in config but they have zero effect. The http-client always uses hardcoded defaults (30s timeout, 20 capacity, 15 refill rate).

This is a Plan 03 implementation gap. The plan said "This function can be called from channel.ts during plugin startup" but the summary says "deployed and verified" without actually adding the call. The hardcoded defaults are sensible and the system works, so this is a low-severity gap -- but it means the "configurable" claim is false.

All 11 REL-* requirements are substantively satisfied despite this gap -- the core reliability behaviors (timeout, rate limiting, retry, error logging, cache bounds, dedup) all work correctly with their hardcoded defaults.

---

_Verified: 2026-03-11T03:25:00Z_
_Verifier: Claude (gsd-verifier)_
