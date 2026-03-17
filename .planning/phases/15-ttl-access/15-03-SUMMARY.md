---
phase: 15-ttl-access
plan: 03
subsystem: database
tags: [sqlite, ttl, sync, config, allow-list, inbound-filter]

# Dependency graph
requires:
  - phase: 15-01
    provides: allow_list table with expires_at column, cleanupExpiredAllowList(), getExpiredCount()
  - phase: 15-02
    provides: PUT /ttl endpoint, TTL UI dropdown in admin panel
provides:
  - DirectoryDb.getExpiredJids() — returns all JIDs with expires_at <= now
  - syncExpiredToConfig() — removes expired JIDs from openclaw.json allowFrom array
  - sync cycle runs TTL-03 config removal before TTL-02 24h SQLite cleanup
affects: [inbound-filter, sync-engine, ttl-enforcement]

# Tech tracking
tech-stack:
  added: [node:fs readFileSync/writeFileSync, node:path join, node:os homedir]
  patterns: [TTL enforcement chain: SQLite expiry -> config file sync -> inbound filter blocks]

key-files:
  created: []
  modified:
    - src/directory.ts
    - src/sync.ts

key-decisions:
  - "TTL-03 config sync runs before TTL-02 24h cleanup — expired JIDs must be in SQLite when syncExpiredToConfig reads them"
  - "syncExpiredToConfig is idempotent — if JID not in allowFrom, splice is skipped, no error"
  - "File I/O errors in syncExpiredToConfig are caught and logged but do not abort the sync cycle"

patterns-established:
  - "TTL enforcement chain: SQLite expires_at -> getExpiredJids() -> syncExpiredToConfig() -> inbound config-based filter blocks"
  - "Config sync before cleanup: always read expired JIDs from SQLite before 24h cleanup deletes them"

requirements-completed: [TTL-03]

# Metrics
duration: 6min
completed: 2026-03-17
---

# Phase 15 Plan 03: TTL Config Sync Summary

**Expired allow_list JIDs are now removed from openclaw.json allowFrom on each sync cycle, completing the TTL enforcement chain so inbound.ts actually blocks expired contacts**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-17T14:00:41Z
- **Completed:** 2026-03-17T14:06:39Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added `getExpiredJids()` to `DirectoryDb` — queries `expires_at <= now` and returns JID strings
- Added `syncExpiredToConfig()` to `sync.ts` — reads openclaw.json, filters expired JIDs from `waha.allowFrom`, writes back atomically
- Expanded `runSyncCycle` TTL block: TTL-03 config removal runs BEFORE TTL-02 24h SQLite cleanup so expired rows are present when config sync reads them
- Added `node:fs`, `node:path`, `node:os` imports to sync.ts for file I/O

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getExpiredJids + syncExpiredToConfig** - `959103a` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/directory.ts` — added `getExpiredJids()` method with TTL-03 DO NOT REMOVE comment
- `src/sync.ts` — added `syncExpiredToConfig()` helper and expanded runSyncCycle TTL block; added node: imports

## Decisions Made
- TTL-03 config sync must run BEFORE TTL-02 24h cleanup — if cleanup ran first, recently-expired rows (< 24h) would be deleted before config sync could read their JIDs
- `syncExpiredToConfig` is self-contained: uses same config path logic as monitor.ts (`OPENCLAW_CONFIG_PATH` env or `~/.openclaw/openclaw.json`)
- Errors in config sync are caught/logged but non-fatal — sync cycle continues even if config file is unreadable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Project has no `tsconfig.json` (TypeScript shipped as source, not compiled). TypeScript type-check via `npx tsc --noEmit` was unavailable. Verified correctness via manual acceptance criteria checks (grep pattern matching) instead.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TTL enforcement chain is complete: SQLite records expiry, admin panel shows "Expired", sync cycle removes from config, inbound filter blocks
- Phase 15 (TTL Access) all 3 plans complete
- Ready for next phase

---
*Phase: 15-ttl-access*
*Completed: 2026-03-17*
