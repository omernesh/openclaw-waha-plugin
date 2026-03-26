---
phase: 31-test-coverage-sprint
plan: 01
subsystem: testing
tags: [vitest, better-sqlite3, sqlite, unit-tests, shutup, directory]

requires: []
provides:
  - DirectoryDb CRUD test suite (46 tests, in-memory SQLite)
  - Shutup interactive flow test suite (29 tests, mocked dependencies)
affects: []

tech-stack:
  added: []
  patterns:
    - "In-memory SQLite via better-sqlite3 :memory: path for isolated DirectoryDb tests"
    - "vi.mock hoisting pattern for ESM module mocks in shutup tests"
    - "mockImplementation restoration in beforeEach after vi.clearAllMocks()"

key-files:
  created:
    - src/directory.test.ts
    - src/shutup.test.ts
  modified: []

key-decisions:
  - "better-sqlite3 rebuild required (NODE_MODULE_VERSION 127 vs 141) — auto-fixed Rule 3"
  - "shutup tests use vi.mock with manual mock DB object (not getDirectoryDb singleton) for isolation"
  - "DirectoryDb tests use real :memory: SQLite — no mocking at the DB layer"

patterns-established:
  - "DirectoryDb test pattern: new DirectoryDb(':memory:') in beforeEach, db.close() in afterEach"
  - "Shutup mock pattern: declare vi.mock stubs before import, re-apply implementations in beforeEach after vi.clearAllMocks()"

requirements-completed:
  - TST-03
  - TST-04

duration: 7min
completed: 2026-03-20
---

# Phase 31 Plan 01: directory.ts and shutup.ts Unit Tests Summary

**75-test unit coverage for DirectoryDb (46 tests, real in-memory SQLite) and shutup.ts interactive flow (29 tests, mocked deps)**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-20T06:25:24Z
- **Completed:** 2026-03-20T06:32:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- 46 DirectoryDb CRUD tests across contacts, dm_settings, allow_list, group_participants, group_filter_overrides, lid_mapping, muted_groups, pending_selections, and singleton
- 29 shutup.ts tests covering SHUTUP_RE regex, checkPendingSelection, clearPendingSelection, checkShutupAuthorization, handleShutupCommand (group + DM), and handleSelectionResponse
- Both files pass at 75/75 with `npx vitest run`

## Task Commits

Each task was committed atomically:

1. **Task 1: directory.ts CRUD test suite** - `f669ee5` (test)
2. **Task 2: shutup.ts interactive flow test suite** - `77eea37` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/directory.test.ts` - DirectoryDb unit tests, 46 cases, real :memory: SQLite
- `src/shutup.test.ts` - Shutup command flow tests, 29 cases, vi.mock dependencies

## Decisions Made
- Used real `better-sqlite3` in-memory SQLite for directory tests — gives higher confidence than mocking the DB layer
- Shutup mock DB object re-applies `mockImplementation` in `beforeEach` after `vi.clearAllMocks()` — prevents stale mock state leaking between tests

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] better-sqlite3 NODE_MODULE_VERSION mismatch**
- **Found during:** Task 1 (first test run)
- **Issue:** Module compiled against Node 127, current runtime is 141 — all tests failed immediately
- **Fix:** `npm rebuild better-sqlite3`
- **Files modified:** node_modules/better-sqlite3/build/Release/better_sqlite3.node (binary)
- **Verification:** All 46 directory tests passed after rebuild
- **Committed in:** f669ee5 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Single rebuild, no code changes needed. No scope creep.

## Issues Encountered
None beyond the native module rebuild above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 31-02 and 31-03 can proceed independently (they cover different modules)
- better-sqlite3 rebuild is a one-time fix; future test runs will work without it

---
*Phase: 31-test-coverage-sprint*
*Completed: 2026-03-20*
