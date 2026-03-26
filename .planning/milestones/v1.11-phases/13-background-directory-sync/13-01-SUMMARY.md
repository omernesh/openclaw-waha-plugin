---
phase: 13-background-directory-sync
plan: "01"
subsystem: directory
tags: [sync, fts5, sqlite, background-job, contacts]
dependency_graph:
  requires: []
  provides:
    - src/sync.ts (background sync engine)
    - contacts_fts FTS5 index in SQLite
  affects:
    - src/directory.ts (FTS5 schema + search upgrade)
    - Any consumer of getContacts() with search param (now uses FTS5)
tech_stack:
  added:
    - FTS5 virtual table (SQLite built-in, no new deps)
    - src/sync.ts (new file)
  patterns:
    - setTimeout chain (from health.ts) for background loop
    - FTS5 content table with trigger-based index maintenance
    - Module-level Map for per-account state storage
key_files:
  created:
    - src/sync.ts
  modified:
    - src/directory.ts
decisions:
  - "FTS5 MATCH replaces LIKE for all search queries — indexed O(log n) vs O(n) table scan"
  - "triggerImmediateSync reads opts from syncOpts Map set at startDirectorySync call time — avoids closure or re-export hacks"
  - "newsletters fetched via getWahaChannels in sync.ts (not in monitor.ts refresh) — monitor.ts refresh gets newsletters through chats API; sync.ts adds explicit newsletter fetch for completeness"
  - "One-time FTS5 rebuild migration guards with row count comparison — safe on WAL mode"
metrics:
  duration: "~15 minutes"
  completed: "2026-03-17T02:43:46Z"
  tasks_completed: 2
  files_modified: 2
  files_created: 1
requirements:
  - SYNC-01
  - SYNC-02
  - SYNC-05
---

# Phase 13 Plan 01: Background Directory Sync Engine + FTS5 Search Summary

**One-liner:** FTS5-indexed SQLite contact search and setTimeout-chain background sync engine extracted from monitor.ts refresh handler.

## What Was Built

### Task 1: FTS5 Virtual Table + Indexed Search (directory.ts)

Added FTS5 full-text search support to `DirectoryDb`:

- **`contacts_fts` virtual table** — content table backed by `contacts`, enabling FTS5 MATCH queries with automatic rowid alignment
- **3 triggers** (`contacts_ai`, `contacts_ad`, `contacts_au`) — keep the FTS5 index in sync with INSERT/UPDATE/DELETE on the `contacts` table automatically
- **One-time rebuild migration** — detects existing databases where FTS index has fewer rows than contacts (triggers haven't run) and rebuilds the index
- **`_fts5Quote()` helper** — escapes user search input for safe FTS5 MATCH queries (prevents query injection)
- **`getContacts()` FTS5 branch** — when `search` param is present, uses FTS5 MATCH with JOIN instead of LIKE; returns early before the non-search path
- **`getContactCount()` FTS5 branch** — same pattern for accurate pagination counts; COUNT query with FTS5 MATCH JOIN

Search is now O(log n) via FTS5 index instead of O(n) full table scan with LIKE.

### Task 2: Background Sync Engine (sync.ts)

New file `src/sync.ts` implements the background sync loop:

- **`startDirectorySync(opts)`** — initializes SyncState, stores in module-level Maps, schedules first tick after 2s, returns mutable SyncState reference
- **`getSyncState(accountId)`** — returns live SyncState for status reporting from admin panel
- **`triggerImmediateSync(accountId)`** — cancels pending timer, triggers immediate cycle (no-op if already running)
- **`tick()`** — private, runs one cycle, updates SyncState on success/failure, schedules next timer (setTimeout chain)
- **`runSyncCycle()`** — the full data pipeline extracted verbatim from monitor.ts POST /api/admin/directory/refresh:
  - Phase "contacts": fetch chats + contacts + groups + LIDs via Promise.all with RateLimiter(3, 200)
  - Build lidToCus Map, normalize @s.whatsapp.net, merge @lid entries
  - bulkUpsertContacts, merge orphaned LID DB entries
  - Phase "newsletters": fetch via getWahaChannels, upsert @newsletter JIDs
  - Phase "names": resolve nameless contacts/newsletters in batches of 5 with 500ms inter-batch delay
- **`RateLimiter` class** — copied verbatim from monitor.ts (sync needs its own instance)

## Deviations from Plan

### Auto-fixed Issues

None.

### Minor Additions (within scope)

**Newsletter phase ordering in sync.ts** — The plan's task description listed the newsletter fetch as a separate phase ("Phase 2: Newsletters") with explicit `state.currentPhase = "newsletters"` transitions. The monitor.ts refresh handler doesn't call `getWahaChannels` (newsletters arrive via chats API), but the plan explicitly requested an explicit newsletter fetch. Implemented as specified: separate `getWahaChannels` call after contact/group sync, upserts `@newsletter` JIDs to contacts table.

**`syncOpts` Map pattern** — Plan mentioned `triggerImmediateSync` needs to reconstruct opts, but left the mechanism vague. Implemented with a dedicated `syncOpts` Map populated in `startDirectorySync` — same accountId key as syncStates. No circular dependencies, clean and self-contained.

## Self-Check

- `src/sync.ts` exists: YES
- `src/directory.ts` modified: YES
- `contacts_fts` virtual table in directory.ts: YES (verified via grep)
- 3 triggers (contacts_ai/ad/au) in directory.ts: YES
- FTS5 rebuild migration in directory.ts: YES
- `contacts_fts MATCH` in getContacts() and getContactCount(): YES (2 occurrences each)
- `_fts5Quote` method: YES
- sync.ts exports startDirectorySync, getSyncState, triggerImmediateSync: YES
- sync.ts exports SyncState, SyncOptions types: YES
- sync.ts contains RateLimiter class: YES
- sync.ts contains setTimeout chain (not setInterval): YES
- sync.ts contains unrefTimer helper: YES
- All 313 tests pass: YES

## Self-Check: PASSED
