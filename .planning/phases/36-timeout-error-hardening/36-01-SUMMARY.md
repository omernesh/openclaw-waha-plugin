---
phase: 36-timeout-error-hardening
plan: 01
subsystem: api
tags: [fetch, timeout, abort-signal, rate-limiter, nominatim]

requires: []
provides:
  - AbortSignal.timeout on all bare fetch() calls in monitor.ts and media.ts
  - RateLimiter maxQueue overflow protection
  - Nominatim geocode rate limiting (1 req/sec)
affects: [monitor, media, rate-limiter]

tech-stack:
  added: []
  patterns: [AbortSignal.timeout on all outbound HTTP calls, maxQueue queue bounding]

key-files:
  created: [src/rate-limiter.test.ts]
  modified: [src/rate-limiter.ts, src/monitor.ts, src/media.ts]

key-decisions:
  - "30s timeout for WAHA API calls, 60s for vision/upload/generate, 5s for polling/nominatim"
  - "maxQueue throws Error (not rejects silently) when queue is full"
  - "nominatimLimiter is module-level singleton with 1100ms delay"

patterns-established:
  - "AbortSignal.timeout pattern: add signal to fetch options with comment noting the requirement ID"

requirements-completed: [EH-01, EH-02, EH-03, EH-04, API-03]

review_status: skipped

duration: 4min
completed: 2026-03-25
---

# Phase 36 Plan 01: Timeout & Error Hardening Summary

**AbortSignal.timeout on all 9 bare fetch() calls + RateLimiter maxQueue overflow protection + Nominatim 1-req/sec rate limiting**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-25T02:44:09Z
- **Completed:** 2026-03-25T02:48:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- All 9 bare fetch() calls in monitor.ts (3) and media.ts (6) now have explicit AbortSignal.timeout
- RateLimiter supports maxQueue parameter with queue overflow rejection
- Nominatim geocode calls rate-limited to 1 req/sec via dedicated RateLimiter instance
- 4 new unit tests for maxQueue behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Add maxQueue to RateLimiter + AbortSignal.timeout to all bare fetch() calls** - `f8066ff` (feat)
2. **Task 2: Add unit tests for RateLimiter maxQueue** - `000f7b2` (test)

## Files Created/Modified
- `src/rate-limiter.ts` - Added maxQueue constructor parameter with overflow rejection in acquire()
- `src/monitor.ts` - Added AbortSignal.timeout(30_000) to 3 fetch calls (fetchBotJids, sessions, follow/unfollow)
- `src/media.ts` - Added AbortSignal.timeout to 6 fetch calls (30s download, 60s vision/upload/generate, 5s polling/nominatim) + nominatimLimiter
- `src/rate-limiter.test.ts` - 4 tests for maxQueue: default unbounded, rejection, exact boundary, drain-and-requeue

## Decisions Made
- 30s timeout for WAHA API calls (consistent with http-client.ts callWahaApi)
- 60s timeout for vision analysis, video upload, and content generation (these operations are inherently slow)
- 5s timeout for Gemini status polling and Nominatim geocode (fast lookups, fail fast)
- nominatimLimiter uses 1100ms delay (slightly over 1s) to safely respect Nominatim's 1-req/sec policy

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test assertions for async throw**
- **Found during:** Task 2
- **Issue:** acquire() is async, so throw becomes rejected promise; synchronous `expect().toThrow()` doesn't catch it
- **Fix:** Changed to `await expect().rejects.toThrow()` pattern
- **Files modified:** src/rate-limiter.test.ts
- **Verification:** All 4 tests pass

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor test assertion fix. No scope creep.

## Issues Encountered
None

## Review Findings
Review skipped (workflow.mandatory_review is disabled).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All outbound HTTP calls now have explicit timeouts
- RateLimiter queue is bounded, preventing memory growth under load

## Self-Check: PASSED

All 4 files verified present. Both commits (f8066ff, 000f7b2) verified in git log.

---
*Phase: 36-timeout-error-hardening*
*Completed: 2026-03-25*
