---
phase: 04-multi-session
plan: 03
subsystem: api
tags: [lru-cache, multi-session, routing, whatsapp, waha]

# Dependency graph
requires:
  - phase: 04-multi-session/04-01
    provides: "ResolvedWahaAccount with role/subRole, listEnabledWahaAccounts"
provides:
  - "resolveSessionForTarget function with LRU membership cache in src/accounts.ts"
  - "readMessages utility action in src/channel.ts (lean format for LLM)"
  - "Cross-session routing wired into handleAction for group sends"
  - "Unit tests: session-router.test.ts (9 tests), read-messages.test.ts (7 tests)"
affects: [04-multi-session, channel-actions, group-messaging]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency-injected membership check (checkMembership param) for testability without WAHA mock"
    - "LRU membership cache at module level: 500 entries, 5-min TTL (prevents API storms)"
    - "Cross-session routing: bot-first, human-fallback, listener-excluded"
    - "Lean message format for LLM: {from, text, timestamp} strips WAHA metadata noise"

key-files:
  created:
    - "tests/session-router.test.ts"
    - "tests/read-messages.test.ts"
  modified:
    - "src/accounts.ts"
    - "src/channel.ts"

key-decisions:
  - "Dependency injection for checkMembership: caller passes membership check fn, enabling unit tests without mocking WAHA API"
  - "Cross-session routing is best-effort for send/reply: falls through silently on routing failure, WAHA errors naturally if session not in group"
  - "readMessages uses p.limit != null guard (not || fallback) to correctly handle limit=0 as minimum-1 case"
  - "checkGroupMembership uses getWahaGroupParticipants success/failure as proxy for membership (API returns 403/404 if not a member)"

patterns-established:
  - "Session routing: resolveSessionForTarget(cfg, targetChatId, checkMembership) — reusable for any future action needing cross-session dispatch"
  - "LRU cache for expensive API lookups: module-level cache with clearCache export for test teardown"

requirements-completed:
  - MSESS-08
  - MSESS-09
  - MSESS-10

# Metrics
duration: 7min
completed: 2026-03-13
---

# Phase 4 Plan 03: Cross-Session Routing and readMessages Summary

**Bot-first group session routing with LRU membership cache and lean readMessages action for LLM context fetching**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-13T21:01:39Z
- **Completed:** 2026-03-13T21:08:11Z
- **Tasks:** 2
- **Files modified:** 4 (src/accounts.ts, src/channel.ts, tests/session-router.test.ts, tests/read-messages.test.ts)

## Accomplishments
- `resolveSessionForTarget` in accounts.ts: bot-first, human-fallback group routing; listener sessions excluded; DM targets always use bot session; LRU cache (500 entries, 5-min TTL)
- `readMessages` utility action: lean format `{from, text, timestamp}`, default 10 messages, max 50, min 1; registered in UTILITY_ACTIONS
- Cross-session routing wired into `handleAction` for `send`/`reply` on group targets (best-effort, non-breaking fallback)
- 16 new unit tests across 2 files, 137 total tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement resolveSessionForTarget with LRU membership cache** - `45199c8` (feat)
2. **Task 2: Add readMessages utility action and wire cross-session routing into handleAction** - `f6d2f73` (feat)

**Plan metadata:** (docs commit to follow)

_Note: TDD tasks — RED tests written first, then GREEN implementation_

## Files Created/Modified
- `src/accounts.ts` - Added `resolveSessionForTarget`, `clearMembershipCache`, `membershipCache` (LRU)
- `src/channel.ts` - Added `readMessages` handler, wired cross-session routing into send/reply, added `checkGroupMembership` helper
- `tests/session-router.test.ts` - 9 unit tests for resolveSessionForTarget (bot-first, fallback, listener exclusion, DM, errors, caching)
- `tests/read-messages.test.ts` - 7 unit tests for readMessages (lean format, limit bounds, registration in UTILITY_ACTIONS)

## Decisions Made
- **Dependency injection for checkMembership**: avoids needing to mock WAHA API in unit tests; caller provides the membership probe
- **Best-effort cross-session routing**: routing errors are swallowed in handleAction (falls through to default account); if WAHA rejects the send, the error surfaces naturally from WAHA
- **`p.limit != null` guard** instead of `|| 10`: prevents `limit=0` from being treated as "no limit" (properly enforces min=1)
- **checkGroupMembership via getWahaGroupParticipants**: a successful participants fetch (even empty array) proves the session has group visibility; 403/404 = not a member

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed limit=0 handling in readMessages**
- **Found during:** Task 2 (readMessages GREEN phase — test for minimum limit=1 failed)
- **Issue:** `Number(0) || 10` evaluates to 10 (JS falsy), so `limit=0` was treated as no-limit and defaulted to 10
- **Fix:** Changed to `p.limit != null ? Number(p.limit) : 10` so explicit zero is passed through and then clamped to min=1 by `Math.max(..., 1)`
- **Files modified:** src/channel.ts
- **Verification:** `enforces minimum limit of 1` test passes
- **Committed in:** f6d2f73 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Minor correctness fix in limit handling. No scope creep.

## Issues Encountered
- `vi.hoisted()` required for mock functions in read-messages.test.ts (Vitest hoists `vi.mock()` factories above imports, so module-level `const mockFn = vi.fn()` can't be referenced inside the factory). Fixed by using `vi.hoisted()` idiom consistent with other test files.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Cross-session routing and readMessages complete; ready for Phase 4 plan 04 (if planned)
- `resolveSessionForTarget` is the authoritative session picker for all future multi-session actions
- No blockers

---
*Phase: 04-multi-session*
*Completed: 2026-03-13*
