# Phase 13: Background Directory Sync - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement continuous background WAHA-to-SQLite directory synchronization so contacts, groups, and newsletters are always locally cached. Directory search queries local DB (FTS5 full-text search) instead of WAHA API. Contacts tab gets pagination matching Groups tab. Sync status indicator in Directory tab shows last sync time and active sync progress.

</domain>

<decisions>
## Implementation Decisions

### Sync Engine Design
- Configurable sync interval, default 30 minutes — balances freshness vs WAHA rate pressure
- New `src/sync.ts` file — follows health.ts setTimeout chain pattern, prevents monitor.ts/directory.ts from growing further
- Full re-pull every interval (WAHA has no `updatedAfter` parameter) — reuse existing directory refresh logic from monitor.ts but extract to sync.ts
- SQLite writes use same WAL-mode connection as DirectoryDb — WAL allows concurrent readers. Sync batches writes in transactions (100 contacts per batch) to minimize lock time

### Directory Search & Pagination
- Contacts tab pagination matches Groups tab exactly: same `dirContactPage`/`dirContactPageSize` variables, same page nav, same page size selector (10/25/50/100)
- FTS5 full-text search on display_name + jid columns — instant, no WAHA API calls. Create a virtual FTS5 table mirroring the contacts table for search queries
- Sync status indicator as a small status bar at top of Directory tab: "Last synced: 5m ago" + "Syncing..." spinner during active sync

### Sync Startup & Lifecycle
- Sync starts on plugin init (alongside health checks) — first sync runs immediately, then repeats on interval
- Existing "Refresh" button in Directory tab triggers immediate sync (resets the timer) — no separate button needed
- Sync scope per cycle: contacts → groups → newsletters in sequence within one cycle, using existing RateLimiter for WAHA API calls

### Claude's Discretion
- FTS5 table creation and trigger design for keeping FTS index in sync with contacts table
- Exact batch size tuning for SQLite transaction batches
- Error handling and retry strategy within sync cycles
- Sync progress reporting granularity (per-entity-type vs overall percentage)
- Whether to expose sync interval as admin panel config or config.json only

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `health.ts` — setTimeout chain pattern with abort signal, state tracking, `.unref()` timers
- `DirectoryDb.bulkUpsertContacts()` — batch insert/update contacts
- `DirectoryDb.bulkUpsertGroupParticipants()` — batch insert/update group members
- `DirectoryDb.getOrphanedLidEntries()` + `mergeContacts()` — @lid ghost entry cleanup
- `RateLimiter(concurrency, delayMs)` — built into monitor.ts for WAHA API rate limiting
- `toArr()` from send.ts — normalizes WAHA dict responses to arrays
- `getWahaChats()`, `getWahaContacts()`, `getWahaGroups()`, `getWahaAllLids()`, `getWahaChannels()` — WAHA API listing functions
- `wrapRefreshButton()` from Phase 12 — spinner + timestamp on refresh buttons

### Established Patterns
- Directory refresh flow in monitor.ts:4030+ — fetch chats/contacts/groups/lids → build lidToCus map → merge → filter → bulkUpsert → merge orphans
- Groups pagination: `dirGroupPage`/`dirGroupPageSize` with `buildPageNav()` and `goGroupPage()`
- Health state object: `{status, consecutiveFailures, lastSuccessAt, lastCheckAt}`
- setTimeout chain: schedule next tick only after current completes (prevents pile-up)

### Integration Points
- Plugin init (index.ts or channel.ts) — start sync alongside health checks
- `POST /api/admin/directory/refresh` — trigger immediate sync instead of inline refresh
- Directory tab UI — add sync status bar, switch contacts to paginated table
- `GET /api/admin/directory` — search queries now hit FTS5 instead of basic LIKE

</code_context>

<specifics>
## Specific Ideas

- Extract the directory refresh logic from monitor.ts POST handler into sync.ts as a reusable function
- FTS5 virtual table: `CREATE VIRTUAL TABLE contacts_fts USING fts5(jid, display_name, content=contacts, content_rowid=rowid)`
- Sync state exposed via `GET /api/admin/sync/status` endpoint for the UI status bar
- Sync interval configurable via `syncIntervalMinutes` in plugin config (config-schema.ts)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
