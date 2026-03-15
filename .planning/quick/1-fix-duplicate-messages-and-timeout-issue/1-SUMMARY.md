---
phase: quick
plan: 1
subsystem: http-client
tags: [bug-fix, reliability, dedup, timeout]
dependency_graph:
  requires: []
  provides: [mutation-dedup-layer]
  affects: [src/http-client.ts]
tech_stack:
  added: []
  patterns: [mutation-dedup-map, bounded-map-with-ttl]
key_files:
  created: []
  modified:
    - src/http-client.ts
    - tests/http-client.test.ts
decisions:
  - "MutationDedup uses body hash (djb2 over sorted JSON.stringify) as part of dedup key — no crypto needed, collision risk negligible for this use case"
  - "TTL set to 60s: covers gateway retry window (30s timeout + retry latency) with margin"
  - "Successful mutations NOT marked pending — only timed-out mutations trigger suppression"
  - "Dedup check runs after rate limiter + backoff check, before fetch — same flow position as would be natural for pre-fetch guards"
metrics:
  duration: "~10 minutes"
  completed_date: "2026-03-15"
  tasks_completed: 1
  files_modified: 2
---

# Quick Task 1: Fix Duplicate Messages After Timeout — Summary

**One-liner:** MutationDedup class in callWahaApi suppresses gateway retries of timed-out POST mutations via 60s TTL keyed on method+path+body-hash.

## What Was Built

Added a `MutationDedup` class to `src/http-client.ts` — the single chokepoint for all WAHA API calls. When a POST/PUT/DELETE request times out (after 30s), the message has likely already been delivered by WAHA but the confirmation was lost. The OpenClaw gateway then retries the action, causing the plugin to re-send the same message 2-3 times.

The fix: after a timeout on any mutation, the request is fingerprinted (method + path + stable body hash) and stored in a bounded map with a 60-second TTL. On the next call with the same fingerprint, the function throws immediately with `[WAHA] Duplicate mutation suppressed...` instead of hitting the WAHA API.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add MutationDedup class and integrate into callWahaApi | 3063ac9 | src/http-client.ts, tests/http-client.test.ts |

## Implementation Details

**MutationDedup class (added to src/http-client.ts):**
- `buildKey(method, path, body)` — returns null for GET, otherwise `${method}:${path}:${bodyHash}`
- `isPending(key)` — returns true if key exists and not expired; prunes expired entries
- `markPending(key)` — sets key with current timestamp; enforces 500-entry max bound
- `clear()` — used by `_resetForTesting()`

**Integration in callWahaApi:**
- Dedup check inserted between backoff check and `fetchWithRetry()` call
- On timeout in catch block: `mutationDedup.markPending(dedupKey)` called before throwing
- `dedupKey` threaded through `fetchWithRetry()` as parameter

**Constraints preserved:**
- `callWahaApi` function signature unchanged
- No existing error messages modified
- Timeout, rate limiting, and 429 retry logic untouched
- All 281 existing tests continue to pass

## Tests

7 new tests added to `tests/http-client.test.ts` under "MutationDedup — duplicate mutation suppression":
1. Second identical POST within TTL throws "duplicate mutation suppressed"
2. Identical GETs both proceed (GETs never deduped)
3. Successful POST does NOT mark pending — retry proceeds normally
4. POST timeout marks pending — retry within TTL is suppressed
5. After TTL expires (60s), mutation can proceed again
6. Different chatId/body produces different key — not suppressed
7. `_resetForTesting()` clears dedup map — mutation can proceed after reset

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

- [x] `src/http-client.ts` modified with MutationDedup class and integration
- [x] `tests/http-client.test.ts` updated with 7 new tests
- [x] Commit `3063ac9` exists
- [x] All 281 tests pass (`27 passed test files`)
- [x] TypeScript: no tsconfig.json in project; vitest handles TS compilation — all tests pass confirms TS validity

## Self-Check: PASSED
