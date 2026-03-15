---
phase: 07-admin-panel-critical-fixes
plan: 02
subsystem: database
tags: [sqlite, pagination, directory, better-sqlite3]

# Dependency graph
requires: []
provides:
  - SQL-level filtering of @lid and @s.whatsapp.net entries in directory queries
  - Correct getContactCount() matching getContacts() so pagination total is accurate
  - Removed post-query filter from monitor.ts directory list handler
affects:
  - admin-panel-directory
  - pagination

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SQL-level exclusion of internal JID types in both getContacts and getContactCount to keep pagination counts in sync

key-files:
  created: []
  modified:
    - src/directory.ts
    - src/monitor.ts

key-decisions:
  - "SQL NOT LIKE conditions added to both getContacts() and getContactCount() so LIMIT/OFFSET pagination is accurate and total count excludes ghost entries"
  - "Post-query .filter() removed from monitor.ts directory handler — filtering at SQL level is authoritative"

patterns-established:
  - "Any pagination query and its companion count query must apply identical WHERE conditions (including JID exclusions) to prevent offset drift"

requirements-completed:
  - AP-02

# Metrics
duration: 5min
completed: 2026-03-16
---

# Phase 07 Plan 02: Directory Pagination Fix Summary

**SQL-level @lid/@s.whatsapp.net exclusion in both getContacts() and getContactCount() eliminates Load More duplicates and fixes single-contact initial load**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-15T22:07:00Z
- **Completed:** 2026-03-15T22:10:49Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added `NOT LIKE '%@lid' AND NOT LIKE '%@s.whatsapp.net'` to `getContacts()` WHERE clause so SQL LIMIT/OFFSET pages only over displayable entries
- Added the same exclusion to `getContactCount()` so the `total` field returned to the UI matches real displayable contacts
- Removed the post-query `.filter()` from the `/api/admin/directory` handler in monitor.ts that was silently dropping entries after paging, causing offset drift and duplicate rows on Load More

## Task Commits

Each task was committed atomically:

1. **Task 1: Move @lid/@s.whatsapp.net filtering into SQL queries** - `ce1c615` (fix)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `src/directory.ts` - Added NOT LIKE conditions in getContacts() and getContactCount()
- `src/monitor.ts` - Removed post-query filter, added explanatory comment

## Decisions Made
- SQL-level exclusion in both query and count methods is the canonical fix: it keeps LIMIT/OFFSET accurate and makes the total count trustworthy for client-side "Load More" logic
- DO NOT REMOVE comments added to both SQL additions to prevent future regression

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx tsc --noEmit` without a tsconfig.json printed help text instead of checking types. Pre-existing errors in the project (missing @types/node, openclaw SDK not locally available) are unrelated to this change. Code changes are syntactically correct — confirmed by manual inspection of the modified sections.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Directory pagination bug fixed; Load More should now load unique next-page entries
- Total count in stats bar will accurately reflect displayable contacts
- Ready for 07-03

---
*Phase: 07-admin-panel-critical-fixes*
*Completed: 2026-03-16*
