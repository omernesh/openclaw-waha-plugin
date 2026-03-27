---
phase: 56-adaptive-activity-patterns
plan: 02
subsystem: mimicry
tags: [activity-profiles, send-gate, mimicry-enforcer, vitest, tdd]

# Dependency graph
requires:
  - phase: 56-adaptive-activity-patterns plan 01
    provides: activity_profiles SQLite table, getActivityProfile() on DirectoryDb, startActivityScanner() export
  - phase: 54-send-pipeline-enforcement
    provides: enforceMimicry chokepoint, resolveGateConfig/checkTimeOfDay primitives
provides:
  - Per-chat activity profile lookup in enforceMimicry Step 2b (ADAPT-04)
  - Silent fallback to global/session gate config when no profile exists (ADAPT-05)
  - Manual sendGateOverride precedence over learned activity profile
  - startActivityScanner called automatically on account login in channel.ts
  - 4 new TDD tests covering ADAPT-04, ADAPT-05, manual override precedence, and error handling
affects:
  - 56-03 (admin UI observability for scanner state)
  - Any plan reading per-chat gate behavior

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Step 2b guard pattern: check activity profile only when targetGateOverride is null (manual always wins)
    - vi.mock with module-level fn references for per-test mock control in vitest
    - startActivityScanner wired after startDirectorySync using same abortSignal

key-files:
  created: []
  modified:
    - src/mimicry-enforcer.ts
    - src/channel.ts
    - src/send-pipeline.test.ts

key-decisions:
  - "Activity profile lookup happens in Step 2b, only when targetGateOverride from dmSettings is null — manual admin override always wins"
  - "getActivityProfile error is caught and swallowed (non-fatal) — falls back to global config"
  - "startActivityScanner receives session: account.accountId (same as accountId) matching ScannerOptions interface"
  - "vi.mock for directory.js uses module-level vi.fn() refs reset in beforeEach to allow per-test control without clearAllMocks breaking references"

patterns-established:
  - "Step guard pattern: `if (!targetGateOverride) { try { ... profile lookup ... } catch {} }` — precedence enforced structurally"
  - "TDD RED test design: global gate set to block at current time; profile set to allow; verify resolves vs throws"

requirements-completed: [ADAPT-04, ADAPT-05]

# Metrics
duration: 15min
completed: 2026-03-27
---

# Phase 56 Plan 02: Activity Profile Pipeline Wiring Summary

**Per-chat learned peak hours wired into enforceMimicry via Step 2b; scanner auto-starts on account login; 683 tests green**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-27T23:14:00Z
- **Completed:** 2026-03-27T23:29:00Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments
- Step 2b added to `enforceMimicry`: checks `dirDb.getActivityProfile(chatId)` and converts profile into `targetGateOverride` when no manual override exists
- Manual `sendGateOverride` from admin panel always takes precedence — profile lookup is gated behind `if (!targetGateOverride)`
- Both null profile and `getActivityProfile` throwing are handled silently, falling back to global/session gate config
- `startActivityScanner` imported and called in `channel.ts` after `startDirectorySync`, sharing the same `abortSignal`
- 4 new TDD tests added to `send-pipeline.test.ts` covering ADAPT-04, ADAPT-05, manual override precedence, and DB error handling

## Task Commits

Each task was committed atomically:

1. **TDD RED: Activity profile gate tests** - `96a648a` (test)
2. **TDD GREEN: Implement Step 2b + scanner startup** - `5166ac9` (feat)

## Files Created/Modified
- `src/mimicry-enforcer.ts` - Added Step 2b block: activity profile lookup when no manual override
- `src/channel.ts` - Added `startActivityScanner` import and call after `startDirectorySync`
- `src/send-pipeline.test.ts` - Added vi.mock for directory.js + 4 activity profile describe block tests

## Decisions Made
- Step 2b is structurally gated with `if (!targetGateOverride)` — no extra precedence logic needed, manual override wins by not entering the profile lookup block
- `session: account.accountId` passed to `startActivityScanner` (matches the field name used by the scanner internally)
- `vi.mock("./directory.js")` uses module-level `vi.fn()` references reset in `beforeEach` after `vi.clearAllMocks()` to maintain mock control per-test

## Deviations from Plan

**Deviation: TDD RED test design required correction**

The first RED test iteration used `sendGate: { startHour: 0, endHour: 24 }` which inadvertently allowed all hours regardless of profile, making the test pass without implementation. Corrected to use `startHour: 20, endHour: 23` (blocks at 14:00 UTC) paired with a profile `peakStartHour: 10, peakEndHour: 18` (allows 14:00). This correctly produced a failing RED state before implementation.

This is a test design correction, not a code deviation.

## Issues Encountered
- First RED test iteration passed prematurely due to cross-midnight gate semantics (endHour=24 > startHour=0 evaluated as always-open). Fixed by choosing a narrow global gate window that blocks at BASE_NOW.

## Next Phase Readiness
- Activity profiles now influence gate decisions automatically for every chat with a learned profile
- Scanner starts automatically on account login — no manual wiring needed
- Phase 56-03 (Admin UI observability) can expose `getScannerState()` for status display
- No blockers

---
*Phase: 56-adaptive-activity-patterns*
*Completed: 2026-03-27*
