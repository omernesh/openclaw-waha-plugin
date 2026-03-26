---
phase: 01-reliability-foundation
plan: 02
subsystem: api
tags: [lru-cache, dedup, webhook, presence, error-handling, vitest]

requires:
  - phase: 01-reliability-foundation
    provides: "callWahaApi, warnOnError from http-client.ts"
provides:
  - "All silent .catch(() => {}) replaced with warnOnError for structured error logging"
  - "LRU-bounded resolveTarget cache (max 1000, TTL 30s)"
  - "Webhook deduplication by composite key (eventType:messageId)"
  - "Memory audit documenting all bounded Maps"
affects: [01-reliability-foundation, 02-inbound-hardening, 04-multi-session]

tech-stack:
  added: []
  patterns: [lru-cache-bounded-maps, composite-key-dedup, warn-on-error-pattern]

key-files:
  created:
    - src/dedup.ts
    - tests/dedup.test.ts
    - tests/lru-cache.test.ts
  modified:
    - src/send.ts
    - src/presence.ts
    - src/inbound.ts
    - src/monitor.ts
    - src/http-client.ts

key-decisions:
  - "Extracted isDuplicate into src/dedup.ts instead of embedding in monitor.ts for testability"
  - "Used composite key eventType:messageId for dedup (not messageId alone) to support different event types"
  - "Kept media cleanup .catch with warnOnError rather than silent -- media failures are worth logging"

patterns-established:
  - "warnOnError(context) on all fire-and-forget promise catches across presence, inbound, send"
  - "LRUCache for bounded in-memory caches instead of raw Map"
  - "Dedup with sliding window Map + TTL pruning for webhook idempotency"

requirements-completed: [REL-02, REL-09, REL-10, REL-11]

duration: 6min
completed: 2026-03-11
---

# Phase 1 Plan 02: Silent Error & Cache Bounds Summary

**Replaced 23 silent .catch(() => {}) patterns with warnOnError logging, swapped unbounded resolveTarget Map to LRU (max 1000, 30s TTL), added webhook dedup by composite eventType:messageId key, and audited all Maps as bounded**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-11T01:04:08Z
- **Completed:** 2026-03-11T01:10:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 8

## Accomplishments
- Eliminated all silent error swallowing across presence.ts (14 instances), inbound.ts (7 instances), and send.ts (2 instances) with contextual warning logs
- Replaced unbounded _resolveCache Map with LRUCache (max: 1000 entries, TTL: 30s) preventing memory leaks
- Added webhook deduplication in monitor.ts for message and message.reaction events with sliding window of 200 entries and 5-minute TTL
- Completed memory audit documenting all Maps as bounded across the codebase

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1: Replace silent .catch patterns, swap resolveTarget cache to LRU** - `9d06f80` (feat)
2. **Task 2: Add webhook deduplication and memory audit** - `77d2b44` (feat)

## Files Created/Modified
- `src/dedup.ts` - New module: isDuplicate() with composite key dedup, bounded Map with TTL pruning
- `src/presence.ts` - 14 .catch(() => {}) replaced with .catch(warnOnError(context))
- `src/inbound.ts` - 7 .catch(() => {}) replaced with .catch(warnOnError(context))
- `src/send.ts` - 2 .catch(() => {}) replaced, _resolveCache swapped from Map to LRUCache
- `src/monitor.ts` - isDuplicate() integrated for message and reaction webhook events
- `src/http-client.ts` - Memory audit comment block documenting all bounded Maps
- `tests/lru-cache.test.ts` - 6 tests for LRU cache behavior (get/set, eviction, TTL, overwrite)
- `tests/dedup.test.ts` - 7 tests for dedup behavior (first/second occurrence, composite key, TTL, pruning, edge cases)

## Decisions Made
- Extracted isDuplicate into src/dedup.ts instead of embedding in monitor.ts (2280 lines) -- better testability and separation of concerns
- Used composite key eventType:messageId for dedup -- same messageId with different eventType is not a duplicate
- Applied warnOnError to media cleanup .catch too -- media failures are worth logging even if non-actionable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All reliability fundamentals in place: timeouts, rate limiting, error logging, cache bounds, webhook dedup
- Plan 03 (if any remaining in phase) can build on these foundations
- Phase 2 (inbound hardening) can proceed -- dedup provides the safety net for duplicate webhook handling

## Self-Check: PASSED

All 8 files verified present. Both commit hashes (9d06f80, 77d2b44) verified in git log.

---
*Phase: 01-reliability-foundation*
*Completed: 2026-03-11*
