# Phase 13: Background Directory Sync - Research

**Researched:** 2026-03-17
**Domain:** SQLite FTS5, Node.js background task patterns, WAHA API bulk endpoints
**Confidence:** HIGH

## Summary

This phase adds a background sync engine (`src/sync.ts`) that periodically pulls contacts, groups, and newsletters from WAHA into the local SQLite directory, then enables FTS5 full-text search over that data. The contacts tab also gets pagination to match the groups tab pattern. The highest-risk item is SQLite write concurrency between the background sync loop and the live webhook handler — WAL mode allows concurrent readers, but writes still serialize. A page-sized batch (100 rows) and explicit transaction wrapping is required from the start.

The existing `health.ts` setTimeout-chain pattern is the confirmed template for the sync loop. The existing `POST /api/admin/directory/refresh` handler (monitor.ts:4031) contains the full refresh logic that will be extracted to `sync.ts`. FTS5 external content tables with three triggers (INSERT/UPDATE/DELETE) are the correct SQLite approach for keeping a search index in sync with the `contacts` table without duplicating storage.

**Primary recommendation:** Extract the refresh logic from monitor.ts into `sync.ts`, wire it on a setTimeout chain with AbortSignal (exact same pattern as `health.ts`), add FTS5 virtual table and triggers in `directory.ts`, and update `getContacts()` to branch on FTS5 for search queries.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Configurable sync interval, default 30 minutes
- New `src/sync.ts` file — follows health.ts setTimeout chain pattern, prevents monitor.ts/directory.ts from growing further
- Full re-pull every interval (WAHA has no `updatedAfter` parameter) — reuse existing directory refresh logic from monitor.ts but extract to sync.ts
- SQLite writes use same WAL-mode connection as DirectoryDb — WAL allows concurrent readers. Sync batches writes in transactions (100 contacts per batch) to minimize lock time
- Contacts tab pagination matches Groups tab exactly: same `dirContactPage`/`dirContactPageSize` variables, same page nav, same page size selector (10/25/50/100)
- FTS5 full-text search on display_name + jid columns — instant, no WAHA API calls. Create a virtual FTS5 table mirroring the contacts table for search queries
- Sync status indicator as a small status bar at top of Directory tab: "Last synced: 5m ago" + "Syncing..." spinner during active sync
- Sync starts on plugin init (alongside health checks) — first sync runs immediately, then repeats on interval
- Existing "Refresh" button in Directory tab triggers immediate sync (resets the timer) — no separate button needed
- Sync scope per cycle: contacts then groups then newsletters in sequence within one cycle, using existing RateLimiter for WAHA API calls

### Claude's Discretion
- FTS5 table creation and trigger design for keeping FTS index in sync with contacts table
- Exact batch size tuning for SQLite transaction batches
- Error handling and retry strategy within sync cycles
- Sync progress reporting granularity (per-entity-type vs overall percentage)
- Whether to expose sync interval as admin panel config or config.json only

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SYNC-01 | Background WAHA-to-SQLite sync continuously pulls contacts/groups/newsletters with rate limiting | setTimeout chain (health.ts pattern) + extracted refresh logic from monitor.ts:4031. RateLimiter(3, 200) already in use in refresh handler. |
| SYNC-02 | Directory search queries local SQLite DB, not WAHA API — instant results | FTS5 external content table on `contacts`. `getContacts()` branches on search param: FTS5 MATCH replaces LIKE fallback. |
| SYNC-03 | Sync status indicator shows "Last synced" timestamp and sync progress in Directory tab | `GET /api/admin/sync/status` endpoint exposes SyncState. UI polls or refreshes status bar. |
| SYNC-04 | Contacts tab has pagination matching Groups tab pattern | Existing `dirGroupPage`/`buildPageNav()` pattern to replicate for contacts. `getContacts()` already has limit/offset support. |
| SYNC-05 | Directory search finds contacts by name from locally synced data | FTS5 MATCH on `contacts_fts(display_name, jid)` replaces the slow WAHA API lookup. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | (already installed) | SQLite driver — FTS5 DDL, triggers, transactions | Project already uses it; synchronous API avoids event-loop complexity; full FTS5 support confirmed |
| Node.js `AbortController` / `AbortSignal` | built-in (Node 15+) | Graceful shutdown of sync loop | Same API used in health.ts; no extra dependency |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| RateLimiter (local class in monitor.ts) | — | Throttle WAHA API calls during sync | Already used in directory refresh; copy or export from monitor.ts |
| `callWahaApi` from `http-client.ts` | — | All WAHA HTTP calls (timeout, retry, rate limit) | All WAHA calls must go through this |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FTS5 external content + triggers | FTS5 contentless or full copy | External content avoids data duplication; triggers keep index in sync automatically |
| setTimeout chain | setInterval | setInterval causes pile-up if a sync cycle takes longer than the interval; setTimeout chain is self-scheduling |

**Installation:** No new packages. FTS5 is bundled in SQLite and available in better-sqlite3 without any extra configuration.

**Version note:** The FTS5 RETURNING-clause bug (better-sqlite3 issue #654) was fixed in SQLite 3.36.0 / better-sqlite3 7.4.6. Since `bulkUpsertContacts` uses `ON CONFLICT ... DO UPDATE` (not RETURNING), this bug does not affect us.

## Architecture Patterns

### Recommended Project Structure
```
src/
  sync.ts          - NEW: background sync engine, SyncState, startDirectorySync()
  health.ts        - EXISTING: setTimeout chain template to copy
  directory.ts     - MODIFIED: add FTS5 schema and migration, fts5-aware getContacts()
  monitor.ts       - MODIFIED: extract refresh logic, wire Refresh button to sync, add sync status bar UI
  config-schema.ts - MODIFIED: add syncIntervalMinutes field
  channel.ts       - MODIFIED: call startDirectorySync() at init
```

### Pattern 1: setTimeout Chain (copy from health.ts)
**What:** Schedule the next tick only after the current async operation completes. Use `.unref()` so the timer does not prevent process exit.
**When to use:** Any periodic background work where overlapping cycles would be harmful.

```typescript
// Source: src/health.ts (project file — verified working pattern)
export function startDirectorySync(opts: SyncOptions): SyncState {
  const state: SyncState = {
    status: "idle",
    lastSyncAt: null,
    lastSyncDuration: null,
    itemsSynced: 0,
    lastError: null,
  };
  // First sync: short delay so startup is not blocked
  const initial = setTimeout(() => tick(opts, state), 2_000);
  if (typeof initial === "object" && initial && "unref" in initial) {
    (initial as NodeJS.Timeout).unref();
  }
  return state;
}

async function tick(opts: SyncOptions, state: SyncState): Promise<void> {
  if (opts.abortSignal.aborted) return;
  const start = Date.now();
  state.status = "running";
  try {
    const result = await runSyncCycle(opts);
    state.status = "idle";
    state.lastSyncAt = Date.now();
    state.lastSyncDuration = Date.now() - start;
    state.itemsSynced = result.total;
    state.lastError = null;
  } catch (err) {
    state.status = "error";
    state.lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[waha] sync cycle failed: ${state.lastError}`);
  }
  // Schedule next AFTER current completes (setTimeout chain, not setInterval)
  if (!opts.abortSignal.aborted) {
    const next = setTimeout(() => tick(opts, state), opts.intervalMs);
    if (typeof next === "object" && next && "unref" in next) {
      (next as NodeJS.Timeout).unref();
    }
  }
}
```

### Pattern 2: FTS5 External Content Table + Triggers
**What:** A virtual FTS5 table that mirrors `contacts.jid` and `contacts.display_name`. Three SQL triggers keep the FTS index in sync with every INSERT/UPDATE/DELETE on `contacts`.
**When to use:** Full-text search over a table maintained by other code (upserts, merges). Avoids duplicating rows.

**Schema (add to `DirectoryDb._createSchema()`):**
```sql
-- Source: https://www.sqlite.org/fts5.html (official docs, external content tables section)
CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts
  USING fts5(jid, display_name, content='contacts', content_rowid='rowid');

-- After insert: add to index
CREATE TRIGGER IF NOT EXISTS contacts_ai AFTER INSERT ON contacts BEGIN
  INSERT INTO contacts_fts(rowid, jid, display_name)
    VALUES (new.rowid, new.jid, new.display_name);
END;

-- After delete: remove from index using OLD values
CREATE TRIGGER IF NOT EXISTS contacts_ad AFTER DELETE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, jid, display_name)
    VALUES ('delete', old.rowid, old.jid, old.display_name);
END;

-- After update: delete OLD entry first, then insert NEW (order is critical)
CREATE TRIGGER IF NOT EXISTS contacts_au AFTER UPDATE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, jid, display_name)
    VALUES ('delete', old.rowid, old.jid, old.display_name);
  INSERT INTO contacts_fts(rowid, jid, display_name)
    VALUES (new.rowid, new.jid, new.display_name);
END;
```

**Migration (one-time population of existing rows):**
```sql
-- Run ONCE after creating the FTS5 table on a DB that already has contacts
-- Source: https://www.sqlite.org/fts5.html (rebuilding section)
INSERT INTO contacts_fts(contacts_fts) VALUES('rebuild');
```

**Querying FTS5 in `getContacts()`:**
```typescript
// FTS5 MATCH query — replaces LIKE when search param is present
function fts5Quote(term: string): string {
  // Wrap in double-quotes, escape internal double-quotes
  // Prevents FTS5 query injection from special chars (AND, OR, NOT, *, etc.)
  return '"' + term.replace(/"/g, '""') + '"';
}

const ftsQuery = search.trim().split(/\s+/).map(fts5Quote).join(' ');
const sql = `
  SELECT c.jid, c.display_name, c.first_seen_at, c.last_message_at, c.message_count, c.is_group,
         d.mode, d.mention_only, d.custom_keywords, d.can_initiate, d.can_initiate_override
  FROM contacts_fts
  JOIN contacts c ON contacts_fts.rowid = c.rowid
  LEFT JOIN dm_settings d ON c.jid = d.jid
  WHERE contacts_fts MATCH ?
    AND c.jid NOT LIKE '%@lid'
    AND c.jid NOT LIKE '%@s.whatsapp.net'
  ORDER BY rank
  LIMIT ? OFFSET ?
`;
```

### Pattern 3: SyncState Object (mirrors HealthState)
```typescript
export interface SyncState {
  status: "idle" | "running" | "error";
  lastSyncAt: number | null;       // epoch ms of last completed sync
  lastSyncDuration: number | null; // ms the last cycle took
  itemsSynced: number;             // contacts + groups + newsletters in last cycle
  lastError: string | null;
}
```

### Pattern 4: Contacts Pagination (copy from Groups tab)
**Variable names to use:** `dirContactPage`, `dirContactPageSize`, `buildContactPageNav()`, `goContactPage()`.
**Note:** `getContacts()` already accepts `limit` and `offset`. `getContactCount()` already accepts `search` and `type`. No new DB methods needed — only new UI code in monitor.ts.

### Anti-Patterns to Avoid
- **setInterval for sync loop:** Causes cycle pile-up if WAHA is slow. Always use setTimeout chain.
- **FTS5 rebuild on every startup:** `INSERT INTO contacts_fts(contacts_fts) VALUES('rebuild')` is O(n). Run it only once during schema migration, not on every startup.
- **Syncing participants during every cycle:** Participants are lazy-loaded by design. Adding participant sync to the background cycle would cause massive WAHA API traffic.
- **LIKE '%term%' for search after FTS5 is available:** Requires full table scan. Once FTS5 is set up, use MATCH for search queries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FTS index management | Manual LIKE search | FTS5 virtual table + triggers | LIKE does full table scan; FTS5 is indexed; triggers handle all mutations automatically |
| Rate limiting during sync | Custom sleep loops | RateLimiter class (already in monitor.ts) | Already proven in existing refresh handler |
| HTTP timeouts | Manual Promise.race | callWahaApi with timeoutMs | http-client.ts already implements AbortController timeout |
| Background loop shutdown | Custom SIGTERM handler | AbortSignal passed from channel.ts | Consistent with health.ts shutdown model |

**Key insight:** The entire sync data pipeline already exists in `POST /api/admin/directory/refresh` (monitor.ts:4031-4243). This phase is primarily an extraction and scheduling exercise, not a rewrite.

## Common Pitfalls

### Pitfall 1: FTS5 Index Gets Out of Sync With contacts Table
**What goes wrong:** If any code path modifies `contacts` without going through the trigger-firing query engine, the FTS index silently diverges.
**Why it happens:** Triggers fire on DML statements processed normally. Certain bulk operations bypass triggers.
**How to avoid:** Always use `db.prepare(...).run()` or `db.transaction()` for contact mutations — never raw `db.exec()` with multi-row inserts. The existing `bulkUpsertContacts()` uses a prepared statement inside a transaction, so triggers fire correctly.
**Warning signs:** FTS5 search returns no results or stale results after a refresh.

### Pitfall 2: FTS5 UPDATE Trigger Order Is Critical
**What goes wrong:** The UPDATE trigger must delete the OLD entry before inserting the NEW one. If reversed, FTS5 looks up the already-updated row when processing the delete command and removes wrong tokens.
**Why it happens:** FTS5 external content tables re-read the backing table during delete processing.
**How to avoid:** Always write UPDATE trigger as: (1) INSERT 'delete' with old.*, then (2) INSERT new.*. This is documented in official SQLite FTS5 docs.
**Warning signs:** Stale tokens remain in index; searches return rows that no longer match query.

### Pitfall 3: SQLite "database is locked" Under Concurrent Write Pressure
**What goes wrong:** The sync loop holds a write transaction while the webhook handler tries to upsert an incoming message contact. WAL allows one writer at a time — long transactions block other writers.
**Why it happens:** SQLite WAL mode serializes writers. Long transactions hold the write lock.
**How to avoid:** Batch writes into transactions of 50-100 rows maximum. Do not hold a write transaction open while waiting for WAHA API responses. Fetch data from WAHA API, then write to DB, then fetch more.
**Warning signs:** `SQLITE_BUSY` or `database is locked` errors in gateway logs during directory refresh.

### Pitfall 4: FTS5 Query Injection via Unescaped User Input
**What goes wrong:** FTS5 MATCH syntax has special operators (`AND`, `OR`, `NOT`, `*`, `"`, `(`). Raw user input in a MATCH clause causes parse errors or unintended matching.
**Why it happens:** Unlike LIKE queries where bound parameters are literals, FTS5 MATCH treats the bound string as a query expression.
**How to avoid:** Wrap user search input in double-quotes: `'"' + term.replace(/"/g, '""') + '"'`. This searches for the literal phrase.
**Warning signs:** `SqliteError: fts5: syntax error` in logs when users type special characters.

### Pitfall 5: Template Literal Double-Escaping in monitor.ts
**What goes wrong:** All embedded JS in monitor.ts is inside backtick template literals. Backslashes must be doubled or output will be wrong.
**Why it happens:** Architectural decision from 2026-03-16. All admin panel JS is a template literal string.
**How to avoid:** In any new monitor.ts JS code: use `\\\\w` not `\\w` for regex, `\\\\'` not `\\'` for strings. Run a double-backslash audit on every monitor.ts edit (STATE.md architectural decision).

### Pitfall 6: contacts TEXT PRIMARY KEY vs rowid
**What goes wrong:** `contacts` has `jid TEXT PRIMARY KEY`. SQLite TEXT PRIMARY KEY is NOT automatically the rowid alias — only `INTEGER PRIMARY KEY` is. The rowid is a separate hidden column.
**Why it happens:** Common SQLite misconception.
**How to avoid:** The trigger pattern using `new.rowid` / `old.rowid` is correct — TEXT PK tables still have an implicit rowid. Verify with `SELECT rowid, jid FROM contacts LIMIT 5` on the live DB. The `content_rowid='rowid'` in the FTS5 definition refers to this implicit rowid.

## Code Examples

Verified patterns from official sources:

### FTS5 External Content Table — Complete DDL
```sql
-- Source: https://www.sqlite.org/fts5.html (External Content Tables section)
CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts
  USING fts5(jid, display_name, content='contacts', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS contacts_ai AFTER INSERT ON contacts BEGIN
  INSERT INTO contacts_fts(rowid, jid, display_name)
    VALUES (new.rowid, new.jid, new.display_name);
END;

CREATE TRIGGER IF NOT EXISTS contacts_ad AFTER DELETE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, jid, display_name)
    VALUES ('delete', old.rowid, old.jid, old.display_name);
END;

CREATE TRIGGER IF NOT EXISTS contacts_au AFTER UPDATE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, jid, display_name)
    VALUES ('delete', old.rowid, old.jid, old.display_name);
  INSERT INTO contacts_fts(rowid, jid, display_name)
    VALUES (new.rowid, new.jid, new.display_name);
END;
```

### WAHA API Contacts Endpoint with Pagination
```
GET /api/contacts/all?session=SESSION_NAME&limit=100&offset=0&sortBy=id&sortOrder=asc
```
Confirmed: supports limit + offset. No updatedAfter parameter exists. Full re-pull every cycle is the only sync strategy.

### Batched Write Pattern
```typescript
// Source: existing bulkUpsertContacts in directory.ts — already transaction-wrapped
const BATCH_SIZE = 100;
for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
  const batch = contacts.slice(i, i + BATCH_SIZE);
  db.bulkUpsertContacts(batch); // wraps in transaction internally
}
```

### Sync Status API Endpoint
```typescript
// GET /api/admin/sync/status — returns SyncState for the UI status bar
if (req.url === "/api/admin/sync/status" && req.method === "GET") {
  const state = getSyncState(opts.accountId);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(state ?? { status: "idle", lastSyncAt: null }));
  return;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WAHA API search (live, slow) | FTS5 local SQLite search (instant) | Phase 13 | No WAHA rate pressure on search |
| On-demand contacts listing | Background-synced SQLite cache | Phase 13 | Directory always populated even if WAHA is slow |
| Contacts tab: Load More button | Contacts tab: page nav matching Groups tab | Phase 13 | Consistent UX across entity types |
| FTS3 (older SQLite) | FTS5 (SQLite >= 3.9.0, 2015) | 2015 | FTS5 has better performance, rank() function, external content support |

## Open Questions

1. **rowid behavior for contacts TEXT PRIMARY KEY**
   - What we know: TEXT PRIMARY KEY tables have an implicit rowid separate from the PK column. `new.rowid` in triggers is valid.
   - What's unclear: Whether rowid values are stable across upserts (ON CONFLICT DO UPDATE does not change rowid).
   - Recommendation: Verify with `SELECT rowid, jid FROM contacts LIMIT 5` on hpg6 before writing the migration. ON CONFLICT DO UPDATE preserves rowid, so triggers will use consistent rowid values.

2. **FTS5 rebuild safety on a live WAL DB**
   - What we know: `INSERT INTO contacts_fts(contacts_fts) VALUES('rebuild')` is a write operation that reconstructs the FTS index from the content table.
   - What's unclear: Whether it blocks readers during rebuild.
   - Recommendation: It acquires a write lock for the duration of the rebuild. On WAL mode, readers can continue using their existing snapshot. On startup (no active readers), this is safe. Run it once in the migration step with a guard: only if `SELECT COUNT(*) FROM contacts_fts` returns 0.

3. **Sync loop abort signal source**
   - What we know: health.ts receives `opts.abortSignal` from monitor.ts which gets it from channel.ts.
   - Recommendation: Use the same shared AbortSignal. If the channel tears down, all background loops stop together.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected in project |
| Config file | none |
| Quick run command | n/a |
| Full suite command | n/a |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | Background sync runs on timer, contacts appear in DB | manual-only | n/a | ❌ no test infra |
| SYNC-02 | FTS5 search returns results for known contact names | manual-only | n/a | ❌ |
| SYNC-03 | Sync status bar updates after cycle completes | manual-only (browser) | n/a | ❌ |
| SYNC-04 | Contacts tab shows pagination controls and correct pages | manual-only (browser) | n/a | ❌ |
| SYNC-05 | Search by name finds contacts in local DB without hitting WAHA | manual-only (browser) | n/a | ❌ |

Manual verification procedure: Deploy to hpg6, trigger sync via Refresh button or wait for timer, confirm contacts appear with resolved names, search for a known contact name, confirm results appear instantly.

### Wave 0 Gaps
None — no automated test infrastructure exists in this project by design. All validation is manual (deploy + browser + gateway logs). This is an established project convention.

## Sources

### Primary (HIGH confidence)
- [SQLite FTS5 Official Docs](https://www.sqlite.org/fts5.html) — external content tables, trigger design, query syntax, rebuild command
- `src/health.ts` (project file) — setTimeout chain pattern with AbortSignal and unref, verified working
- `src/directory.ts` (project file) — existing schema, bulkUpsertContacts, getContacts with limit/offset
- `src/monitor.ts:4031-4243` (project file) — complete directory refresh logic to extract to sync.ts
- [WAHA Contacts API Docs](https://waha.devlike.pro/docs/how-to/contacts/) — confirmed /api/contacts/all supports limit/offset; confirmed no updatedAfter parameter

### Secondary (MEDIUM confidence)
- [better-sqlite3 FTS5 issue #654](https://github.com/WiseLibs/better-sqlite3/issues/654) — RETURNING + FTS5 trigger bug, fixed in SQLite 3.36.0; does not affect our upsert pattern
- [SQLite WAL docs](https://sqlite.org/wal.html) — WAL allows concurrent readers, single writer; long write transactions cause SQLITE_BUSY

### Tertiary (LOW confidence)
- WebSearch results on Node.js AbortSignal graceful shutdown patterns — consistent with what health.ts already implements

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already in project, FTS5 confirmed in official SQLite docs
- Architecture: HIGH — health.ts pattern directly cloneable, refresh logic fully present in monitor.ts
- FTS5 trigger design: HIGH — from official SQLite docs, canonical approach
- WAHA API pagination: HIGH — verified via official WAHA docs (limit/offset on /api/contacts/all, no updatedAfter)
- Pitfalls: HIGH — derived from code review of existing project patterns + official SQLite docs

**Research date:** 2026-03-17
**Valid until:** 2026-06-17 (SQLite FTS5 is extremely stable; WAHA API may change sooner)
