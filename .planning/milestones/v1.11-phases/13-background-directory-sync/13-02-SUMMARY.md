---
phase: 13-background-directory-sync
plan: 02
subsystem: ui
tags: [admin-panel, sync, pagination, monitor.ts, config-schema, channel.ts]

# Dependency graph
requires:
  - phase: 13-01
    provides: sync.ts with startDirectorySync, getSyncState, triggerImmediateSync exports
provides:
  - syncIntervalMinutes config field (default 30, 0=disable) in config-schema.ts
  - Background sync auto-started in loginAccount alongside health checks
  - GET /api/admin/sync/status API endpoint returning SyncState JSON
  - POST /api/admin/directory/refresh replaced with thin triggerImmediateSync call
  - Directory tab sync status bar showing "Last synced: Xm ago" / "Syncing..." spinner
  - Contacts tab paginated renderer matching Groups tab (page nav + page size selector)
  - Generic buildPageNav() accepting goFn parameter for reuse across tabs
affects: [admin-panel-users, directory-tab, contacts-tab, sync-visibility]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sync status polling: updateSyncStatus() called on tab switch and after Refresh, polls /api/admin/sync/status"
    - "Generic pagination: buildPageNav(currentPage, totalPages, goFn) reused for groups and contacts tabs"
    - "Paginated contacts: loadContactsTable() mirrors loadGroupsTable() pattern, replaces infinite-scroll for contacts"

key-files:
  created: []
  modified:
    - src/config-schema.ts
    - src/channel.ts
    - src/monitor.ts

key-decisions:
  - "Refresh button redirected to triggerImmediateSync: inline 200-line refresh handler replaced with 3-line thin trigger, pipeline lives in sync.ts only"
  - "Contacts tab uses pagination (not infinite-scroll): matches groups tab UX, more predictable for large contact lists"
  - "buildPageNav generalized with goFn: single function handles both groups and contacts pagination without code duplication"

patterns-established:
  - "Sync status bar pattern: #syncStatusBar element polled via updateSyncStatus() on tab switch"
  - "Paginated tab renderer: loadContactsTable() / loadGroupsTable() pattern for paginated admin tab content"

requirements-completed:
  - SYNC-03
  - SYNC-04

# Metrics
duration: 25min
completed: 2026-03-17
---

# Phase 13 Plan 02: Wire & UI Summary

**Background sync wired to plugin lifecycle, admin panel shows live sync status and paginated contacts with same UX as groups tab**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-17T04:45:00Z
- **Completed:** 2026-03-17T05:10:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Sync engine auto-starts on login alongside health checks (configurable via syncIntervalMinutes, default 30)
- GET /api/admin/sync/status endpoint returns live SyncState JSON
- POST /api/admin/directory/refresh now triggers sync instead of running 200 lines of inline code
- Directory tab shows sync status bar: "Last synced: Xm ago" when idle, "Syncing contacts..." during active sync
- Contacts tab paginated with page nav, page size selector (10/25/50/100), matching Groups tab exactly
- buildPageNav() made generic (goFn param) — shared by both groups and contacts pagination

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire sync engine, add API endpoint, replace inline refresh** - `a9857c4` (feat)
2. **Task 2: Add sync status bar, contacts pagination, generic buildPageNav** - `933d8af` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/config-schema.ts` - Added syncIntervalMinutes field (int >= 0, default 30)
- `src/channel.ts` - Added startDirectorySync() call in loginAccount after monitorWahaProvider
- `src/monitor.ts` - Added sync imports, GET /api/admin/sync/status, replaced refresh handler, sync status bar HTML/JS, loadContactsTable(), goContactPage(), generic buildPageNav(), removed stale send.ts imports

## Decisions Made
- **Inline refresh handler removed**: The 200-line inline refresh handler in monitor.ts was fully replaced by a 3-line `triggerImmediateSync()` call. The full sync pipeline now lives only in sync.ts, avoiding duplication.
- **Contacts tab paginated vs infinite-scroll**: Changed from infinite-scroll to pagination matching Groups tab. Provides predictable navigation for large contact lists.
- **buildPageNav generalized**: Rather than creating a separate buildContactPageNav(), added optional `goFn` parameter. All existing calls updated to pass 'goGroupPage'.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed orphaned old inline refresh code**
- **Found during:** Task 1 (after inserting new sync endpoint + replacing refresh handler)
- **Issue:** The new handler was inserted at the correct location but the old code body (200 lines) became orphaned unreachable code after the `return;` statement
- **Fix:** Removed the entire orphaned old code block
- **Files modified:** src/monitor.ts
- **Verification:** Tests pass (313/313), code no longer present
- **Committed in:** a9857c4 (Task 1 commit)

**2. [Rule 1 - Bug] Cleaned up unused send.ts imports in monitor.ts**
- **Found during:** Task 1 cleanup
- **Issue:** getWahaChats, getWahaContacts, getWahaGroups, getWahaAllLids, getWahaNewsletter, toArr, getWahaContact were all unused after inline refresh removal
- **Fix:** Removed unused imports, kept only getWahaGroupParticipants which is still used
- **Files modified:** src/monitor.ts
- **Verification:** Tests pass (313/313)
- **Committed in:** 933d8af (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (Rule 1 — both code quality issues from the handler replacement)
**Impact on plan:** Both auto-fixes necessary for correctness and clean code. No scope creep.

## Issues Encountered
- No tsconfig.json in project (openclaw handles TS compilation at runtime). Used `npx vitest run` for type verification instead of `npx tsc --noEmit`. All 313 tests passed.

## Next Phase Readiness
- Sync engine is running automatically, admin panel shows status
- Ready for Phase 13 Plan 03 (if any) or Phase 14
- Background sync populates directory without manual Refresh

---
*Phase: 13-background-directory-sync*
*Completed: 2026-03-17*
