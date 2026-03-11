---
phase: 01-reliability-foundation
plan: 01
subsystem: api
tags: [fetch, timeout, rate-limiting, retry, backoff, token-bucket, vitest]

requires: []
provides:
  - "callWahaApi with 30s timeout, token bucket rate limiter, 429 exponential backoff"
  - "warnOnError helper for structured error logging"
  - "TokenBucket class for rate limiting"
  - "vitest test infrastructure"
affects: [01-reliability-foundation, 02-inbound-hardening, 04-multi-session]

tech-stack:
  added: [lru-cache, vitest]
  patterns: [extract-and-compose, token-bucket-rate-limiter, abort-signal-timeout]

key-files:
  created:
    - src/http-client.ts
    - vitest.config.ts
    - tests/http-client.test.ts
    - tests/token-bucket.test.ts
  modified:
    - src/send.ts
    - package.json

key-decisions:
  - "Used AbortSignal.timeout() for request timeouts instead of AbortController with manual setTimeout"
  - "Custom TokenBucket implementation (~60 lines) instead of external library for minimal dependencies"
  - "Module-level shared backoff state for 429 responses so all concurrent calls pause together"
  - "Mutation timeouts warn 'may have succeeded' to prevent unsafe retries"

patterns-established:
  - "All WAHA API calls flow through callWahaApi in http-client.ts"
  - "warnOnError(context) replaces .catch(() => {}) patterns"
  - "TDD with vitest: tests in tests/ directory, vi.useFakeTimers for async timing"

requirements-completed: [REL-01, REL-03, REL-04, REL-05, REL-06, REL-07, REL-08]

duration: 8min
completed: 2026-03-11
---

# Phase 1 Plan 01: HTTP Client Extraction Summary

**callWahaApi extracted to http-client.ts with 30s AbortSignal.timeout, token bucket rate limiter (20 burst/15 per sec), exponential 429 backoff with jitter and Retry-After, and structured error logging**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-11T00:53:02Z
- **Completed:** 2026-03-11T01:00:49Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 6

## Accomplishments
- Extracted callWahaApi from send.ts to new src/http-client.ts with zero signature changes to 103 call sites
- Added 30s request timeout via AbortSignal.timeout, with mutation-safe error messages
- Token bucket rate limiter (20 burst capacity, 15/sec refill) with queue drain
- 429 exponential backoff (1s/2s/4s base, +/-25% jitter, Retry-After header support, max 3 retries)
- Shared backoff state so all concurrent calls pause when any gets 429
- 18 unit tests covering all reliability features via vitest

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Failing tests** - `605dc81` (test)
2. **Task 1 GREEN: Implementation** - `39a7952` (feat)

## Files Created/Modified
- `src/http-client.ts` - New module: callWahaApi, TokenBucket, warnOnError, shared backoff state
- `src/send.ts` - Removed callWahaApi function body, added import from http-client.ts
- `vitest.config.ts` - Test framework configuration
- `tests/http-client.test.ts` - 15 tests for callWahaApi reliability features
- `tests/token-bucket.test.ts` - 3 tests for TokenBucket class
- `package.json` - Added lru-cache, vitest, test script

## Decisions Made
- Used AbortSignal.timeout() instead of manual AbortController + setTimeout -- cleaner API, native browser/Node support
- Custom TokenBucket (~60 lines) instead of external library -- fewer dependencies, simpler to customize for Phase 4 per-session buckets
- Module-level shared backoff state -- when one call gets 429, all pending calls pause (prevents cascade of 429s)
- Mutation timeouts include "may have succeeded" warning -- prevents unsafe retries of POST/PUT/DELETE that may have completed server-side
- Exported _resetForTesting() for test isolation of shared backoff state

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed timeout test approach for AbortSignal.timeout compatibility**
- **Found during:** Task 1 GREEN (test execution)
- **Issue:** AbortSignal.timeout() creates internal timers not controlled by vi.useFakeTimers(). Mock fetch with never-resolving promise was not being aborted.
- **Fix:** Made mock fetch listen to the AbortSignal's abort event, and used real timers with 50ms timeout for timeout tests
- **Files modified:** tests/http-client.test.ts
- **Verification:** All 18 tests pass
- **Committed in:** 39a7952

**2. [Rule 1 - Bug] Fixed unhandled rejection in 429 exhaustion test**
- **Found during:** Task 1 GREEN (test execution)
- **Issue:** Fake timers caused timing mismatch where 429 rejection was detected as "unhandled" by vitest before the test's expect could catch it
- **Fix:** Switched 429 exhaustion test to use real timers with real backoff delays (runs in ~6.5s)
- **Files modified:** tests/http-client.test.ts
- **Verification:** All 18 tests pass, 0 unhandled errors
- **Committed in:** 39a7952

---

**Total deviations:** 2 auto-fixed (2 bugs in test approach)
**Impact on plan:** Both fixes were test infrastructure issues, not code logic changes. No scope creep.

## Issues Encountered
None beyond the test timing issues documented in deviations.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- http-client.ts is the single chokepoint for all WAHA API calls -- Plan 02 (cache bounds) and Plan 03 (silent error replacement) can build on this
- warnOnError helper ready for Plan 02 to replace .catch(() => {}) patterns across send.ts
- TokenBucket exported and ready for Phase 4 per-session rate limiting

## Self-Check: PASSED

All 5 created files verified present. Both commit hashes (605dc81, 39a7952) verified in git log.

---
*Phase: 01-reliability-foundation*
*Completed: 2026-03-11*
