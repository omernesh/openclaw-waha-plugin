---
phase: 02-resilience-and-observability
plan: 01
subsystem: reliability
tags: [health-check, error-formatting, session-monitoring, llm-errors]

# Dependency graph
requires:
  - phase: 01-reliability-foundation
    provides: callWahaApi HTTP client with timeout, rate limiting, and retry
provides:
  - Session health monitor (src/health.ts) with setTimeout chain pattern
  - Centralized error formatter (src/error-formatter.ts) for LLM-friendly messages
  - Config schema fields for healthCheckIntervalMs, dmQueueSize, groupQueueSize
affects: [02-resilience-and-observability, admin-panel, inbound-queue]

# Tech tracking
tech-stack:
  added: []
  patterns: [setTimeout-chain health ping, error-to-suggestion mapping, outer try/catch action wrapper]

key-files:
  created:
    - src/health.ts
    - src/error-formatter.ts
    - tests/health.test.ts
    - tests/error-formatter.test.ts
  modified:
    - src/config-schema.ts
    - src/types.ts
    - src/channel.ts

key-decisions:
  - "setTimeout chain (not setInterval) for health pings to prevent pile-up on slow responses"
  - "Module-level Map for per-session health state, accessible via getHealthState()"
  - "Error patterns matched against raw message before stripping [WAHA] prefix"

patterns-established:
  - "Health ping pattern: setTimeout chain with .unref(), abort check before scheduling"
  - "Error formatter pattern: console.warn original, return clean LLM message with suggestion"
  - "Action wrapper pattern: outer try/catch in handleAction returns isError: true"

requirements-completed: [RES-01, RES-02, RES-05]

# Metrics
duration: 4min
completed: 2026-03-11
---

# Phase 2 Plan 01: Health Monitor & Error Formatter Summary

**Session health monitor with setTimeout-chain pinging and centralized error formatter mapping action failures to LLM-friendly suggestions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-11T14:32:18Z
- **Completed:** 2026-03-11T14:36:18Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Health monitor pings /api/{session}/me with skipRateLimit and 10s timeout, transitions through healthy/degraded/unhealthy states
- Error formatter maps 7 error categories (rate limit, timeout, not-found, auth, session health, missing fields, unknown) to actionable LLM suggestions
- handleAction wrapped with outer try/catch so all action errors return formatted guidance instead of raw stack traces
- Config schema extended with healthCheckIntervalMs (60s default), dmQueueSize (50), groupQueueSize (50) for Plan 02

## Task Commits

Each task was committed atomically:

1. **Task 1: Create error formatter and health monitor modules with TDD** - `556ae7d` (feat)
2. **Task 2: Add Phase 2 config fields and wire error formatter into handleAction** - `7405f26` (feat)

## Files Created/Modified
- `src/error-formatter.ts` - Centralized action error to LLM message mapper with pattern/suggestion pairs
- `src/health.ts` - Session health monitor with setTimeout chain, HealthState interface, getHealthState()
- `tests/error-formatter.test.ts` - 9 test cases covering all error categories and output format
- `tests/health.test.ts` - 7 test cases covering ping path, states, abort cleanup
- `src/config-schema.ts` - Added healthCheckIntervalMs, dmQueueSize, groupQueueSize fields
- `src/types.ts` - Added corresponding optional fields to WahaAccountConfig type
- `src/channel.ts` - Imported formatActionError, wrapped handleAction with outer try/catch

## Decisions Made
- Used setTimeout chain (not setInterval) for health pings -- prevents pile-up when pings are slow
- Module-level Map for per-session health state -- allows admin panel to query via getHealthState()
- Error patterns matched against raw message before stripping [WAHA] prefix -- ensures patterns like "429" are caught even in prefixed messages
- initialDelayMs parameter on startHealthCheck for testability (default 5s production, short for tests)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Health test timing required adjustment: first two tests needed explicit initialDelayMs (default 5s too long for test timeout), and "1 failure" test needed longer interval to prevent multiple pings before abort

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Health monitor ready to be wired into startAccount in Plan 02 or 03
- Error formatter active on all handleAction calls immediately
- Config fields ready for inbound queue sizing (Plan 02)
- All 47 tests pass (16 new + 31 existing)

---
*Phase: 02-resilience-and-observability*
*Completed: 2026-03-11*
