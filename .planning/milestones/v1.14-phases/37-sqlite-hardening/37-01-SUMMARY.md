---
phase: "37"
plan: "01"
subsystem: database, media
tags: [sqlite, wal, busy-timeout, temp-cleanup, hardening]
dependency_graph:
  requires: []
  provides: [MEM-03, DI-01, MEM-02]
  affects: [directory, analytics, monitor]
tech_stack:
  added: []
  patterns: [setTimeout-chain-with-unref, fire-and-forget-cleanup]
key_files:
  created: []
  modified:
    - src/directory.ts
    - src/analytics.ts
    - src/monitor.ts
decisions:
  - WAL checkpoint uses setTimeout chain with .unref() to avoid blocking process exit
  - Temp file sweep is fire-and-forget (non-blocking) with 10-min age cutoff
  - Added close() to AnalyticsDb for timer cleanup parity with DirectoryDb
metrics:
  duration: 2min
  completed: "2026-03-25T02:59:00Z"
---

# Phase 37 Plan 01: SQLite Hardening & Temp File Cleanup Summary

SQLite busy_timeout + periodic WAL checkpointing in both DBs, orphaned media temp file sweep on startup.

## What Was Done

### Task 1: SQLite busy_timeout + WAL checkpoint + temp file sweep (cacf4f7)

**MEM-03 -- busy_timeout:**
- Added `PRAGMA busy_timeout = 5000` after WAL mode in both `DirectoryDb` and `AnalyticsDb` constructors
- Prevents SQLITE_BUSY errors when concurrent access occurs

**DI-01 -- WAL checkpoint timer:**
- Added `_startWalCheckpoint()` method to both DB classes
- Runs `PRAGMA wal_checkpoint(PASSIVE)` every 30 minutes via setTimeout chain
- Timer uses `.unref()` so it does not prevent process exit
- Timer is cleared in `close()` method (added `close()` to AnalyticsDb)

**MEM-02 -- temp file cleanup:**
- Added `sweepOrphanedMediaFiles()` function in monitor.ts
- Runs at startup (fire-and-forget, non-blocking)
- Scans `/tmp/openclaw/` for `waha-media-*` files older than 10 minutes
- Deletes orphans and logs count of cleaned files

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | cacf4f7 | SQLite busy_timeout, WAL checkpoint timer, temp file cleanup |

## Verification

- TypeScript compiles clean (`npx tsc --noEmit` -- zero errors)

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None.
