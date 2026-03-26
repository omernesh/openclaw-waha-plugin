---
phase: 53-mimicrygate-core
plan: "02"
subsystem: mimicry-gate
tags: [tdd, gate-enforcement, hourly-cap, timezone, sqlite, vitest]
dependency_graph:
  requires: [53-01]
  provides: [checkTimeOfDay, checkAndConsumeCap, getCapStatus]
  affects: [src/mimicry-gate.ts, src/mimicry-gate.test.ts]
tech_stack:
  added: []
  patterns: [injectable-clock, tdd-red-green, intl-datetimeformat, rolling-window]
key_files:
  created:
    - src/mimicry-gate.test.ts
  modified:
    - src/mimicry-gate.ts
decisions:
  - "Intl.DateTimeFormat with formatToParts for timezone-aware hour extraction (not getHours())"
  - "Cross-midnight window: endHour <= startHour means hour >= startHour OR hour < endHour"
  - "Blocked checkAndConsumeCap must not call recordSend or ensureFirstSendAt"
  - "getCapStatus is read-only — never calls recordSend"
  - "Fixed utcHour helper in tests: BASE_NOW is 12:00 UTC, not 13:00"
metrics:
  duration: "~6 minutes"
  completed: "2026-03-26"
  tasks_completed: 2
  files_changed: 2
requirements:
  - GATE-01
  - GATE-02
  - GATE-03
  - GATE-04
  - INFRA-04
  - CAP-01
  - CAP-02
  - CAP-03
  - CAP-04
---

# Phase 53 Plan 02: Gate Enforcement Functions Summary

One-liner: TDD implementation of checkTimeOfDay (cross-midnight timezone-aware), checkAndConsumeCap (atomic rolling-window counter), and getCapStatus (read-only snapshot) with 50 unit tests covering all edge cases.

## What Was Built

Extended `src/mimicry-gate.ts` with three enforcement functions and created comprehensive unit tests.

### Functions Added

**`checkTimeOfDay(config, now?)`** — GATE-01, GATE-03, GATE-04
- Private `extractHour()` uses `Intl.DateTimeFormat.formatToParts` for timezone accuracy
- Cross-midnight logic: `endHour <= startHour` triggers OR branch instead of AND
- endHour is exclusive (matches spec)
- Returns `{allowed: false, reason: "Outside send window (7:00-1:00 UTC)"}` when blocked

**`checkAndConsumeCap(session, limit, db, now?)`** — CAP-01, CAP-02, CAP-03
- Atomically checks count, then records if allowed
- Blocked path: returns `{allowed: false}` without calling `recordSend` or `ensureFirstSendAt`
- INFRA-04 warning comment present for bypassPolicy callers
- Rolling window via `countRecentSends(session, now)` which uses `now - 3_600_000`

**`getCapStatus(session, limit, db, now?)`** — read-only
- Never calls `recordSend` — pure snapshot
- `remaining = Math.max(0, limit - count)` (no negative values)
- Returns `windowStartMs = now - 3_600_000`

### Test File (`src/mimicry-gate.test.ts`)

50 tests across 6 describe blocks:
- `getMaturityPhase`: null, 3d, 7d boundary, 10d, 29d, 35d
- `resolveCapLimit`: defaults, global override, per-session, per-target (CAP-04), null passthrough
- `resolveGateConfig`: defaults, global, per-session, per-target (GATE-02), null passthrough
- `checkTimeOfDay`: disabled passthrough, cross-midnight (7am-1am), same-day (9am-5pm), boundaries, timezone (Asia/Jerusalem)
- `checkAndConsumeCap`: allow/block at limit, rolling window expiry, count preservation, firstSendAt baseline
- `getCapStatus`: zero count, read-only (no side effects), remaining clamped
- Config schema integration (INFRA-03): empty config valid, sendGate valid, hourlyCap valid

All timestamps are fixed constants — no `Date.now()` in tests. No `vi.useFakeTimers()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed utcHour helper formula in tests**
- **Found during:** GREEN phase, when 6 tests failed on boundary hour values
- **Issue:** Test comment said "BASE_NOW is hour 13 UTC" but `new Date(1736942400000)` is 12:00 UTC. The `utcHour(h)` formula used `-13*3600000` offset instead of `-12*3600000`, causing all hour tests to be 1 hour off.
- **Fix:** Changed constant comment and formula to use `-12 * 3_600_000`
- **Files modified:** `src/mimicry-gate.test.ts`

**2. [Rule 1 - Bug] Fixed impossible test assertion for blocked send + firstSendAt**
- **Found during:** GREEN phase
- **Issue:** Test "ensureFirstSendAt is NOT set on blocked send" called `db.recordSend()` 15 times to pre-populate count, but `MimicryDb.recordSend()` internally calls `ensureFirstSendAt` — so firstSendAt was always set after pre-population, making the null assertion impossible.
- **Fix:** Rewrote test to verify that a blocked `checkAndConsumeCap` does not *change* firstSendAt (idempotency of ON CONFLICT DO NOTHING), which is the meaningful invariant.
- **Files modified:** `src/mimicry-gate.test.ts`

## Commits

| Hash | Message |
|------|---------|
| 27944b0 | test(53-02): add failing tests for checkTimeOfDay, checkAndConsumeCap, getCapStatus |
| 4f8a5e6 | feat(53-02): implement checkTimeOfDay, checkAndConsumeCap, getCapStatus |

## Verification Results

```
npx vitest run src/mimicry-gate.test.ts
  Test Files  1 passed (1)
  Tests       50 passed (50)

npx vitest run (full suite)
  Test Files  45 passed (45)
  Tests       644 passed (644)   [was 594 before this plan]
```

```
grep "checkTimeOfDay\|checkAndConsumeCap\|getCapStatus" src/mimicry-gate.ts
-> 3 exported functions confirmed

grep "Intl.DateTimeFormat" src/mimicry-gate.ts
-> confirmed timezone-aware hour extraction
```

## Known Stubs

None. All functions are fully implemented with real logic.

## Self-Check: PASSED

- `src/mimicry-gate.ts` — exists and contains all 5 exports (checkTimeOfDay, checkAndConsumeCap, getCapStatus, resolveGateConfig, resolveCapLimit)
- `src/mimicry-gate.test.ts` — exists, 50 tests, 467+ lines
- Commits 27944b0 and 4f8a5e6 — verified in git log
- Full suite: 644 tests, no regressions
