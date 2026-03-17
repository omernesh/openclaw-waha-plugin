---
phase: 13-background-directory-sync
verified: 2026-03-17T05:30:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 13: Background Directory Sync Verification Report

**Phase Goal:** The directory is always locally cached — contacts, groups, and newsletters are pulled from WAHA into SQLite continuously so search is instant and name lookups work without hitting the live API
**Verified:** 2026-03-17
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                   | Status     | Evidence                                                                                    |
|----|-----------------------------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------|
| 1  | Background sync continuously pulls contacts, groups, and newsletters from WAHA into SQLite | VERIFIED | `src/sync.ts` implements full setTimeout-chain loop with `runSyncCycle()` covering all 3 entity types |
| 2  | Directory search returns instant results from local FTS5 index instead of WAHA API      | VERIFIED | `directory.ts` lines 281-297: `getContacts()` uses `contacts_fts MATCH` branch when search present |
| 3  | Search by contact name finds contacts stored in local database                          | VERIFIED | FTS5 index on `jid` and `display_name` columns; `_fts5Quote()` escaping; `getContactCount()` also uses FTS5 |
| 4  | Sync starts automatically on plugin init alongside health checks                        | VERIFIED | `channel.ts` line 902: `startDirectorySync()` called in `loginAccount` after `monitorWahaProvider` |
| 5  | Directory tab shows "Last synced" timestamp and "Syncing..." spinner during active sync | VERIFIED | `monitor.ts` line 880: `#syncStatusBar` element; `updateSyncStatus()` at line 2391 polls `/api/admin/sync/status` |
| 6  | Refresh button triggers an immediate sync cycle                                         | VERIFIED | `refreshDirectory()` at line 2422 POSTs to `/api/admin/directory/refresh`; handler calls `triggerImmediateSync()` |
| 7  | Contacts tab has pagination with page nav and page size selector matching Groups tab    | VERIFIED | `dirContactPage`, `dirContactPageSize`, `goContactPage()`, `loadContactsTable()`, generic `buildPageNav(goFn)` |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact              | Expected                                                                     | Status   | Details                                                                         |
|-----------------------|------------------------------------------------------------------------------|----------|---------------------------------------------------------------------------------|
| `src/sync.ts`         | Background sync engine with setTimeout chain, SyncState, exported functions  | VERIFIED | 503 lines; exports `startDirectorySync`, `getSyncState`, `triggerImmediateSync`, `SyncState`, `SyncOptions` |
| `src/directory.ts`    | FTS5 virtual table, 3 triggers, rebuild migration, FTS5-aware getContacts()  | VERIFIED | `contacts_fts` virtual table, triggers `contacts_ai/ad/au`, `_fts5Quote()`, FTS5 MATCH in both `getContacts()` and `getContactCount()` |
| `src/config-schema.ts`| `syncIntervalMinutes` config field with default 30                           | VERIFIED | Line 106: `syncIntervalMinutes: z.number().int().min(0).optional().default(30)` |
| `src/channel.ts`      | `startDirectorySync()` call in `loginAccount` alongside health checks        | VERIFIED | Line 902: `startDirectorySync({ accountId, config, intervalMs: syncIntervalMinutes * 60_000, abortSignal })` |
| `src/monitor.ts`      | Sync status API endpoint, sync status bar UI, contacts pagination, Refresh wired to triggerImmediateSync | VERIFIED | GET `/api/admin/sync/status` at line 4167; `#syncStatusBar` at line 880; `dirContactPage/PageSize`, `loadContactsTable()`, generic `buildPageNav(goFn)` |

### Key Link Verification

| From                  | To                          | Via                                              | Status   | Details                                                                                |
|-----------------------|-----------------------------|--------------------------------------------------|----------|----------------------------------------------------------------------------------------|
| `src/sync.ts`         | `src/directory.ts`          | `bulkUpsertContacts()` and `getContacts()`       | WIRED    | `runSyncCycle()` calls `db.bulkUpsertContacts()`, `db.getOrphanedLidEntries()`, `db.mergeContacts()`, `db.getContacts()`, `db.upsertContact()` |
| `src/sync.ts`         | `src/send.ts`               | `getWahaChats/Contacts/Groups/AllLids/Channels`  | WIRED    | Lines 13-17: all 7 send.ts functions imported; all called in `runSyncCycle()` with rate limiting |
| `src/directory.ts`    | `contacts_fts` virtual table| FTS5 MATCH query in `getContacts()` when search present | WIRED | `contacts_fts MATCH` present at lines 297, 415; early-return branch before LIKE path |
| `src/channel.ts`      | `src/sync.ts`               | import and call `startDirectorySync()`           | WIRED    | Line 25: import; line 902: call with all required opts |
| `src/monitor.ts`      | `src/sync.ts`               | `getSyncState` for status endpoint, `triggerImmediateSync` for Refresh | WIRED | Line 22: import both; line 4168: `getSyncState()` in API handler; line 4179: `triggerImmediateSync()` in refresh handler |
| `src/monitor.ts` (UI) | `/api/admin/sync/status`    | `fetch` in `updateSyncStatus()`                  | WIRED    | Line 2393: `fetch('/api/admin/sync/status')` inside `updateSyncStatus()` |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                          | Status    | Evidence                                                                                                     |
|-------------|-------------|--------------------------------------------------------------------------------------|-----------|--------------------------------------------------------------------------------------------------------------|
| SYNC-01     | 13-01       | Background WAHA→SQLite sync continuously pulls contacts/groups/newsletters with rate limiting | SATISFIED | `sync.ts` `runSyncCycle()` uses `RateLimiter(3, 200)` with `Promise.all` for bulk fetch; started in `channel.ts` on login |
| SYNC-02     | 13-01       | Directory search queries local SQLite DB, not WAHA API — instant results              | SATISFIED | `directory.ts` `getContacts()` FTS5 MATCH branch returns early; no WAHA API call in search path             |
| SYNC-03     | 13-02       | Sync status indicator shows "Last synced" timestamp and sync progress in Directory tab | SATISFIED | `#syncStatusBar`, `updateSyncStatus()`, `/api/admin/sync/status` endpoint all present and wired; called on tab switch |
| SYNC-04     | 13-02       | Contacts tab has pagination matching Groups tab pattern                               | SATISFIED | `dirContactPage/PageSize`, `goContactPage()`, `loadContactsTable()` with `buildPageNav(dirContactPage, totalPages, 'goContactPage')` |
| SYNC-05     | 13-01       | Directory search finds contacts by name from locally synced data                     | SATISFIED | FTS5 index on `display_name` column; sync populates `display_name` via `bulkUpsertContacts` and per-contact name resolution |

No orphaned requirements — all 5 SYNC IDs appear in PLAN frontmatter and are satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODO, FIXME, stub returns, or placeholder patterns found in the 4 modified files or `sync.ts`.

### Additional Observations

**Old inline refresh code removal:** The original 200-line inline refresh handler in `monitor.ts` was fully removed and replaced with a 3-line `triggerImmediateSync()` call. Verified by grepping for `getWahaChats|getWahaContacts|bulkUpsertContacts` in `monitor.ts` — no matches. Single source of truth for the sync pipeline is now `sync.ts`.

**Compilation:** `npx vitest run` passes 313/313 tests (project has no `tsconfig.json`; vitest handles TS compilation at runtime).

**syncOpts Map pattern:** `triggerImmediateSync()` retrieves stored opts from the `syncOpts` Map, allowing immediate cycle re-use of the same `config` and `abortSignal` without re-export hacks.

**FTS5 rebuild migration:** One-time migration guards with row count comparison (`ftsCount < contactsCount`) — safe on WAL mode for existing databases that predate the FTS5 schema.

### Human Verification Required

| # | Test | Expected | Why Human |
|---|------|----------|-----------|
| 1 | Deploy and observe gateway logs after startup | `[waha] sync: cycle complete for ... — N contacts, M groups, ...` log line appears within ~35 seconds of gateway start | Can't verify runtime execution programmatically — needs live gateway |
| 2 | Open admin panel Directory tab | Sync status bar shows "Syncing..." then "Last synced: just now (N items)" | Visual rendering and real-time status update requires browser |
| 3 | Click "Refresh All" button in Directory tab | Toast "Sync triggered" appears, status bar shows "Syncing..." spinner for several seconds, then updates to new "Last synced" time | Requires live browser interaction and real WAHA API responses |
| 4 | Search for a contact by name in Directory tab | Results appear instantly (no WAHA API delay), matching FTS5 indexed names | FTS5 correctness needs a populated database with real contact names |
| 5 | Navigate Contacts tab pages | Page nav and page size selector (10/25/50/100) work correctly, matching Groups tab behavior | Requires browser interaction with real contact data |

### Gaps Summary

No gaps found. All must-haves from both plans (13-01 and 13-02) are verified against the actual codebase.

---

_Verified: 2026-03-17_
_Verifier: Claude (gsd-verifier)_
