---
phase: 15-ttl-access
plan: 01
subsystem: database
tags: [sqlite, ttl, allow_list, directory, sync]

# Dependency graph
requires:
  - phase: 13-background-directory-sync
    provides: sync.ts runSyncCycle, getDirectoryDb
  - phase: 12-ui-bug-sprint
    provides: setContactAllowDm, allow_list pattern
provides:
  - expires_at column on allow_list with migration-safe ALTER TABLE
  - TTL-aware isContactAllowedDm and getAllowedDmJids queries
  - setContactAllowDm with optional expiresAt parameter
  - getContactTtl, cleanupExpiredAllowList, getExpiredCount methods
  - PUT /api/admin/directory/:jid/ttl endpoint
  - GET /api/admin/directory returns expiresAt and expired per contact
  - Periodic expired row cleanup in sync cycle
affects:
  - 16-pairing-mode (uses expiresAt param when granting temporary access)
  - 15-02 (frontend TTL badge rendering uses expiresAt/expired from GET directory)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TTL-at-SQL-level: all allow_list read queries include (expires_at IS NULL OR expires_at > strftime('%s','now')) to transparently block expired entries without touching inbound.ts"
    - "Cleanup-in-sync: periodic expired-row cleanup (>24h grace period) runs at end of each sync cycle, not at query time"

key-files:
  created: []
  modified:
    - src/directory.ts
    - src/sync.ts
    - src/monitor.ts

key-decisions:
  - "TTL stored as Unix seconds (not ms) — matches strftime('%s','now') SQLite function directly"
  - "24h grace period before deletion: keeps recently-expired rows visible in admin panel for operator feedback"
  - "getContactTtl returns null for non-existent allow_list rows (not found vs. found-but-no-TTL distinction)"
  - "PUT /ttl returns 404 if contact not in allow_list — cannot set TTL on non-existent entry"

patterns-established:
  - "TTL-at-SQL: expires_at IS NULL OR expires_at > strftime('%s','now') pattern for allow_list reads"
  - "Migration-safe ALTER TABLE: try/catch ignoring 'duplicate column' error, re-throw all others"

requirements-completed: [TTL-02, TTL-03]

# Metrics
duration: 15min
completed: 2026-03-17
---

# Phase 15 Plan 01: TTL-Aware Allow List Data Layer Summary

**expires_at column added to allow_list with TTL-filtered SQL queries, cleanup in sync cycle, and PUT /api/admin/directory/:jid/ttl API endpoint**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-17T13:15:00Z
- **Completed:** 2026-03-17T13:30:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `expires_at INTEGER DEFAULT NULL` to allow_list via migration-safe ALTER TABLE
- All allow_list read queries (isContactAllowedDm, getAllowedDmJids) now filter expired entries at SQL level — inbound.ts untouched
- setContactAllowDm accepts optional `expiresAt?: number | null` parameter (Unix seconds)
- Added getContactTtl, cleanupExpiredAllowList, getExpiredCount methods to DirectoryDb
- PUT /api/admin/directory/:jid/ttl endpoint sets or clears TTL on existing allow_list entries
- GET /api/admin/directory now returns `expiresAt` and `expired` fields per contact for frontend badge rendering
- Sync cycle calls cleanupExpiredAllowList at end of each cycle with 24h grace period

## Task Commits

Each task was committed atomically:

1. **Task 1: Add expires_at column and TTL-aware queries to directory.ts** - `a8fd344` (feat)
2. **Task 2: Add sync cleanup and TTL API endpoint** - `1582c92` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/directory.ts` - Migration + updated setContactAllowDm, isContactAllowedDm, getAllowedDmJids + new getContactTtl, cleanupExpiredAllowList, getExpiredCount
- `src/sync.ts` - cleanupExpiredAllowList call at end of runSyncCycle
- `src/monitor.ts` - PUT /api/admin/directory/:jid/ttl endpoint + expiresAt/expired in GET directory response

## Decisions Made
- TTL stored as Unix seconds to match `strftime('%s','now')` SQLite function (no conversion needed at query time)
- 24h grace period before deletion: recently-expired rows stay visible in admin panel so operators can see who recently had access
- PUT /ttl returns 404 if contact is not in allow_list — prevents silently creating entries with just a TTL
- getContactTtl returns `null` for contacts not in allow_list (distinct from "in list but no TTL")

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The project has no tsconfig.json so `npx tsc --noEmit` is not functional — verified correctness by reading modified sections carefully and checking grep acceptance criteria.

## Next Phase Readiness
- Foundation complete: TTL data layer ready for Phase 16 pairing mode to call `setContactAllowDm(jid, true, expiresAt)`
- Frontend can now render TTL badges using `expiresAt`/`expired` fields from GET /api/admin/directory (Plan 15-02)
- PUT /api/admin/directory/:jid/ttl endpoint ready for admin panel TTL controls (Plan 15-02)

---
*Phase: 15-ttl-access*
*Completed: 2026-03-17*
