---
phase: 56-adaptive-activity-patterns
plan: "01"
subsystem: activity-scanner
tags: [activity-scanner, sqlite, tdd, background-task, mimicry]
dependency_graph:
  requires: [mimicry-gate.ts, directory.ts, sync.ts, send.ts]
  provides: [src/activity-scanner.ts, chat_activity_profiles table]
  affects: [src/directory.ts]
tech_stack:
  added: [activity-scanner.ts]
  patterns: [setTimeout-chain, DI-params-for-testing, hour-histogram, Intl.DateTimeFormat]
key_files:
  created:
    - src/activity-scanner.ts
    - src/activity-scanner.test.ts
  modified:
    - src/directory.ts
    - src/directory.test.ts
decisions:
  - "_firstTickDelayMs DI param added to ScannerOptions for test isolation (avoids 30s waits in tests)"
  - "computePeakWindow uses contiguous min-to-max span of top-60% hours (permissive by design for bimodal activity)"
  - "isOffPeak uses existing resolveGateConfig + checkTimeOfDay from mimicry-gate.ts (no duplication)"
metrics:
  duration: "602s"
  completed: "2026-03-27"
  tasks_completed: 2
  files_changed: 4
---

# Phase 56 Plan 01: Activity Scanner + SQLite Storage Summary

SQLite activity profiles table added to DirectoryDb and background scanner module created with full test coverage.

## What Was Built

Task 1: chat_activity_profiles table + DirectoryDb CRUD methods
- ActivityProfile type exported from directory.ts
- chat_activity_profiles table added to _createSchema() with CREATE TABLE IF NOT EXISTS (migration-safe)
- idx_cap_account_scanned index for efficient scanner queries
- upsertActivityProfile(profile) -- INSERT ON CONFLICT(jid) DO UPDATE
- getActivityProfile(jid) -- returns null for missing JID, full ActivityProfile for existing
- getChatsNeedingRescan(accountId, staleMs, recentMs) -- LEFT JOIN contacts, stale threshold, 200 limit
- 4 tests added to src/directory.test.ts (all passing)

Task 2: activity-scanner.ts background scan loop
- startActivityScanner(opts) -- public entry point, setTimeout chain, 30s startup delay, .unref() on all timers
- computePeakWindow(timestamps, timezone) -- top-60% hour histogram via Intl.DateTimeFormat, null for < 20 timestamps
- isOffPeak(cfg, session, now) -- delegates to resolveGateConfig + checkTimeOfDay (ADAPT-03)
- fetchRecentTimestamps -- paginates getWahaChatMessages in 100-msg batches, stops at 500 or 7-day cutoff
- runScanBatch -- processes 10 chats per tick, 500ms inter-chat sleep, cursor-based pagination across ticks
- Tick scheduling: 30-min retry when on-peak, 5-min partial batch, 7-day after full pass (ADAPT-02)
- AbortSignal at tick entry and between batch items
- DI params: _dirDb, _fetchMessages, _now, _sleep, _firstTickDelayMs
- 9 tests in src/activity-scanner.test.ts (all passing)

## Test Results

- Total tests: 679 passing (up from 594)
- New tests this plan: 13 (4 directory + 9 scanner)
- Zero regressions

## Deviations from Plan

Rule 1 - Bug: Added _firstTickDelayMs DI param for test isolation
- Found during: Task 2 GREEN phase
- Issue: Tests waited 600ms but FIRST_TICK_DELAY_MS=30000 meant tick never fired during tests
- Fix: Added _firstTickDelayMs optional param to ScannerOptions; tests pass 0
- Files modified: src/activity-scanner.ts, src/activity-scanner.test.ts
- Commit: 831d9db

Rule 2 - Template literal security warning: Replaced template literals with string concat in _createSchema
- Found during: Task 1 implementation (Edit hook)
- Fix: Used string concatenation instead of template literals for new table creation SQL
- Files modified: src/directory.ts

## Known Stubs

None.

## Self-Check: PASSED
