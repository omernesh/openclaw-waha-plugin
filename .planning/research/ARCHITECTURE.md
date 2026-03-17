# Architecture Research

**Domain:** WhatsApp OpenClaw plugin — v1.11 feature integration
**Researched:** 2026-03-17
**Confidence:** HIGH (based on direct source inspection of all relevant files)

---

## Current System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway (READ-ONLY)                      │
│    handleAction() → channel.ts → outbound pipeline                   │
│    webhook events  → monitor.ts → inbound pipeline                   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ plugin-sdk interface only
┌───────────────────────────────▼──────────────────────────────────────┐
│                         channel.ts (Plugin Adapter)                   │
│  listActions() · handleAction() · autoResolveTarget · send/recv       │
└───┬──────────────────────┬───────────────────────┬───────────────────┘
    │                      │                       │
┌───▼─────────┐   ┌────────▼─────────┐   ┌────────▼────────┐
│  send.ts    │   │  inbound.ts      │   │  monitor.ts     │
│ WAHA API    │   │ webhook handler  │   │ HTTP server     │
│ calls       │   │ DM/group filter  │   │ admin panel     │
│ (~1600 LOC) │   │ rules resolution │   │ /api/admin/*    │
└───────────┬─┘   └──────────┬───────┘   └────────┬────────┘
            │                │                    │
            └────────────────▼────────────────────▼
                     ┌────────────────────┐
                     │   directory.ts     │
                     │  DirectoryDb       │
                     │  SQLite (WAL)      │
                     │  contacts          │
                     │  dm_settings       │
                     │  allow_list        │
                     │  group_participants│
                     │  group_filter_*    │
                     │  muted_groups      │
                     │  pending_selections│
                     └────────────────────┘
            ┌────────────────────────────────────┐
            │        Supporting modules           │
            │  http-client.ts  health.ts          │
            │  accounts.ts     dedup.ts           │
            │  normalize.ts    dm-filter.ts       │
            │  inbound-queue.ts  presence.ts      │
            │  rules-*.ts      shutup.ts          │
            │  mentions.ts     trigger-word.ts    │
            └────────────────────────────────────┘
```

---

## v1.11 Feature Integration Map

Each v1.11 feature is analyzed below: what it touches, what is new, what is modified.

---

### 1. Background Directory Sync

**What it does:** Continuously pulls contacts/groups/newsletters from WAHA API into SQLite so that directory search queries hit local DB instead of live WAHA API.

**New file required:** `src/directory-sync.ts`

```
WAHA API (/api/contacts, /api/groups, /api/lids)
    ↓  (rate-limited, paginated, setTimeout chain)
directory-sync.ts  →  DirectoryDb.upsertContact()
    ↓  (exposes state for admin panel)
syncStatus: { lastSyncAt, totalSynced, inProgress, sessionKey }
```

**New file: `src/directory-sync.ts`**

Responsibilities:
- `startDirectorySync(opts)` — initiates background loop per-session (same pattern as `health.ts` setTimeout chain)
- Iterates contacts, groups, newsletters from WAHA API with rate limiting (calls `callWahaApi` from `http-client.ts`)
- Writes via `DirectoryDb.upsertContact()` — no new DB methods needed for initial pass
- Exposes `getSyncStatus(sessionKey)` for admin panel display
- AbortSignal pattern (same as `health.ts`) for clean shutdown

**Existing file modifications:**

| File | Change |
|------|--------|
| `monitor.ts` | Start `directorySync` loop alongside `startHealthCheck` at startup; add `GET /api/admin/sync/status` route |
| `directory.ts` | Add `upsertContactBatch()` for efficient bulk inserts; add `expires_at` column to `allow_list` (needed by FEATURE-02 too) |
| `config-schema.ts` | Add `syncIntervalMs` config field (default 3600000 — 1 hour) |
| Admin panel Directory tab | Show "Last synced: HH:MM" + "X contacts synced" from sync status API |

**Data flow — search after sync:**
```
User types in Directory search
    → GET /api/admin/directory?search=nadav
    → DirectoryDb.getContacts({ search: "nadav" })
    → SQLite LIKE query (instant, no WAHA API call)
    → Results rendered
```

**SQLite additions in `directory.ts`:**
- `upsertContactBatch(rows[])` — transaction-wrapped batch insert for sync efficiency
- No schema changes needed for basic sync (existing `contacts` table already has `display_name`, `jid`, `is_group`)

---

### 2. Pairing Mode

**What it does:** Passcode-gated temporary DM access. Unknown contact DMs → challenge/response → grants TTL-limited access. Also supports wa.me deep link with embedded passcode.

**New file required:** `src/pairing.ts`

```
Inbound DM (unauthorized contact)
    ↓
inbound.ts DM filter check
    ↓
pairing.ts: isPairingEnabled() → sendChallenge() / verifyPasscode()
    ↓
DirectoryDb: upsertTTLGrant() → allow_list with expires_at
    ↓
contact granted access for TTL duration
```

**New file: `src/pairing.ts`**

Responsibilities:
- `isPairingEnabled(cfg, accountId)` — checks if pairing mode is on for this session
- `handlePairingChallenge(senderJid, messageText, cfg, account)` — detects wa.me passcode injection OR pending challenge response
- `sendPairingChallenge(senderJid, account)` — sends scripted challenge message via `sendWahaText` (no LLM)
- `verifyPasscode(passcode, cfg, accountId)` — checks against config-stored passcode
- `grantPairingAccess(senderJid, db, ttlMs)` — writes TTL entry to allow_list via `DirectoryDb`
- `PairingState` — SQLite-backed map of `senderJid → { challenged_at, attempts }` with auto-expiry (short TTL, ~5 min window)

**Existing file modifications:**

| File | Change |
|------|--------|
| `inbound.ts` | Add pairing check after DM filter rejects; call `handlePairingChallenge()`; if challenge passed, short-circuit to allow message through |
| `config-schema.ts` | Add `pairingMode.enabled`, `pairingMode.passcode`, `pairingMode.ttlMs`, `pairingMode.maxAttempts` to `WahaAccountSchemaBase` |
| `directory.ts` | Add `expires_at` column to `allow_list`; add `upsertTTLGrant(jid, expiresAt)` and `pruneExpiredGrants()`; add `pairing_challenges` table |
| `monitor.ts` | Add `GET /api/admin/pairing/grants` (active TTL grants) and `DELETE /api/admin/pairing/grants/:jid` (manual revoke) |
| Admin panel | New pairing section in Settings tab: toggle, passcode field, TTL config, active grants table |

**Integration point in `inbound.ts` — insertion location:**
```
DM filter check → BLOCKED
    ↓
[NEW] if pairingMode.enabled:
    handlePairingChallenge() → may grant access or send challenge
    if granted: continue processing as normal
    if challenged/blocked: return (no LLM)
    ↓ (only if not pairing mode or pairing did not intercept)
auto-reply canned message (FEATURE-03)
    ↓
drop message (silent)
```

**Config addition (config-schema.ts):**
```typescript
pairingMode: z.object({
  enabled: z.boolean().optional().default(false),
  passcode: buildSecretInputSchema().optional(),
  ttlMs: z.number().int().positive().optional().default(1_800_000), // 30 min
  maxAttempts: z.number().int().positive().optional().default(3),
}).optional()
```

---

### 3. TTL-Based Access (FEATURE-02)

**What it does:** Manual admin-set expiring access for contacts and groups — independent of pairing mode but shares the same `expires_at` infrastructure.

**No new file needed.** Builds on `directory.ts` schema changes from pairing mode.

**Existing file modifications:**

| File | Change |
|------|--------|
| `directory.ts` | `expires_at INTEGER` column on `allow_list` (migration-safe ALTER TABLE); `upsertTTLGrant(jid, expiresAt)`; `pruneExpiredGrants()` called on startup and periodically; `getContact()` returns `expiresAt` field |
| `inbound.ts` | DM filter allow-list check must validate `expires_at IS NULL OR expires_at > NOW()` — currently allow-list entries have no expiry |
| `monitor.ts` | `PUT /api/admin/directory/:jid/settings` gains `expiresAt` field; `GET /api/admin/directory` returns `expiresAt` in response |
| Admin panel Directory tab | Contact settings drawer: "Access Expires" datetime picker; show "Expires in 2h 15m" badge on active TTL grants; gray out expired entries |

**DB migration approach (same pattern as existing migrations):**
```typescript
// Migration-safe in _createSchema():
try {
  this.db.prepare(`ALTER TABLE allow_list ADD COLUMN expires_at INTEGER`).run();
} catch (e) {
  if (!String(e).includes('duplicate column')) throw e;
}
```

**Inbound check — modified allow-list lookup:**
```
// Was: SELECT allow_dm FROM allow_list WHERE jid = ?
// Now: SELECT allow_dm FROM allow_list WHERE jid = ?
//       AND (expires_at IS NULL OR expires_at > ?)
// Second param: Date.now()
```

---

### 4. Auto-Reply Canned Message (FEATURE-03)

**What it does:** When DM is blocked (not in allowlist, pairing not active), send scripted rejection message instead of silent drop. Rate-limited per-contact to avoid spam.

**No new file needed.**

**Existing file modifications:**

| File | Change |
|------|--------|
| `inbound.ts` | After DM filter rejects AND pairing mode does not intercept: call `sendAutoReply()` if enabled in config |
| `directory.ts` | New table `auto_reply_log (jid TEXT PRIMARY KEY, sent_at INTEGER)` — tracks last reply time per contact for rate limiting |
| `config-schema.ts` | Add `autoReply.enabled`, `autoReply.message`, `autoReply.cooldownMs` to account schema |
| `send.ts` | No change — `sendWahaText()` already handles scripted sends |

**Auto-reply data flow:**
```
DM blocked by filter
    ↓
pairingMode.enabled? → handle pairing (may allow or challenge)
    ↓ (if not pairing or pairing failed)
autoReply.enabled?
    → DirectoryDb.getLastAutoReply(senderJid)
    → if null or > cooldownMs ago:
        sendWahaText(account, senderJid, resolvedMessage)
        DirectoryDb.recordAutoReply(senderJid)
    → else: silent drop (cooldown active)
```

**`resolvedMessage` template resolution:**
- `[bot admin name]` → query `group_participants` for `participant_role = 'bot_admin'`; resolve names from directory
- Keep simple: string replacement, no template engine

---

### 5. Modules System (FEATURE-04)

**What it does:** Framework for pluggable higher-level capabilities (channel moderator, event planner, etc.) assigned to specific chats. New admin panel tab.

**New files required:**

| File | Purpose |
|------|---------|
| `src/modules/module-types.ts` | `WahaModule` interface definition |
| `src/modules/module-registry.ts` | Registry singleton: `registerModule()`, `getModulesForChat()` |
| `src/modules/index.ts` | Barrel export + auto-registration of built-in modules |

**No first-party modules ship in v1.11** — the framework only. Modules tab shows empty state with "No modules installed."

**Module interface (`module-types.ts`):**
```typescript
export interface WahaModule {
  id: string;
  name: string;
  description: string;
  version: string;
  configSchema: z.ZodObject<any>;

  // Lifecycle
  init(db: DirectoryDb, config: unknown): Promise<void>;

  // Hooks (return false to suppress normal processing)
  onInbound?(msg: WahaInboundMessage, chat: string): Promise<boolean | void>;
  onOutbound?(action: string, params: Record<string, unknown>): Promise<boolean | void>;
}
```

**Module registry (`module-registry.ts`):**
```typescript
// Module state: per-chat assignments stored in SQLite
// New DB table: modules (module_id, enabled, config_json, assigned_chats_json)
class ModuleRegistry {
  register(mod: WahaModule): void
  getEnabled(): WahaModule[]
  getModulesForChat(chatJid: string): WahaModule[]
  getConfig(moduleId: string): unknown
}
export const moduleRegistry = new ModuleRegistry();
```

**Existing file modifications:**

| File | Change |
|------|--------|
| `directory.ts` | New table `modules (module_id TEXT PRIMARY KEY, enabled INTEGER, config_json TEXT, assigned_chats_json TEXT, updated_at INTEGER)` |
| `inbound.ts` | After DM/group filter pass: call `moduleRegistry.getModulesForChat(chatJid)` and invoke `onInbound` hooks |
| `channel.ts` | Before `handleAction` dispatches: call module `onOutbound` hooks (optional, for enforcement) |
| `monitor.ts` | Add `/api/admin/modules` CRUD routes; add "Modules" tab HTML/JS between Sessions and Log tabs |

**Admin panel Modules tab routes:**
- `GET /api/admin/modules` — list all registered modules with status
- `PUT /api/admin/modules/:id/enable` — toggle
- `PUT /api/admin/modules/:id/config` — save config
- `PUT /api/admin/modules/:id/assignments` — set assigned chats (JID array)

**Inbound hook insertion point in `inbound.ts`:**
```
Message passes DM/group filter
    ↓
Rules policy resolved
    ↓
[NEW] Module hooks: moduleRegistry.getModulesForChat(chatJid)
    → for each module: await module.onInbound(msg, chatJid)
    → if any returns false: suppress delivery (module handled it)
    ↓
deliverWahaReply() / OpenClaw runtime delivery
```

---

## Component Boundary Summary

```
New files
  src/directory-sync.ts    — background WAHA→SQLite sync loop
  src/pairing.ts           — passcode challenge/response + TTL grant
  src/modules/             — module framework (3 files)
    module-types.ts        — WahaModule interface
    module-registry.ts     — registry singleton + SQLite store
    index.ts               — barrel + auto-register built-ins

Modified files — light touch (< 50 lines each)
  config-schema.ts         — pairingMode, autoReply, syncIntervalMs
  channel.ts               — module outbound hooks (optional, later)

Modified files — moderate changes (50-200 lines each)
  directory.ts             — expires_at migration, TTL methods,
                             auto_reply_log table, modules table,
                             upsertContactBatch, pruneExpiredGrants
  inbound.ts               — pairing hook, auto-reply hook,
                             module hooks; TTL expiry check
  monitor.ts               — sync status route, pairing routes,
                             modules routes, Modules tab HTML/JS

Admin panel changes (embedded in monitor.ts)
  Directory tab            — sync status indicator, TTL badges
  Settings tab             — pairingMode config, autoReply config
  Modules tab (NEW)        — module list, enable/config/assignments
```

---

## Data Flow Changes

### Background Sync Flow (new)
```
monitor.ts startup
    → startDirectorySync({ session, baseUrl, apiKey, intervalMs, db })
    → directory-sync.ts: fetch /api/contacts (paginated via offset/limit)
    → for each contact: db.upsertContact(jid, displayName)
    → after contacts: fetch /api/groups → upsertContact (is_group=true)
    → after groups: fetch /api/lids → store @lid→@c.us mapping
    → sleep intervalMs → repeat
    → getSyncStatus() returns { lastSyncAt, totalSynced, inProgress }
```

### Pairing Flow (new)
```
Inbound DM from unknown jid
    → inbound.ts: DM filter → BLOCKED
    → pairing.ts: isPairingEnabled() → true
    → check pairing_challenges table: has pending challenge for jid?
      YES: verifyPasscode(messageText)
        → match: grantPairingAccess(jid, ttlMs) → db.upsertTTLGrant()
                 allow message through normal pipeline
        → no match: send "wrong passcode" reply, increment attempts
        → max attempts: ban from pairing for cooldown period
      NO: sendPairingChallenge(jid) → sendWahaText() scripted
          db.upsertPairingChallenge(jid, { challenged_at: now, attempts: 0 })
```

### TTL Access Check (modified existing flow)
```
inbound.ts: isAllowed(jid) check
    → Was: allow_list WHERE jid = ?
    → Now: allow_list WHERE jid = ? AND (expires_at IS NULL OR expires_at > NOW())
    → Expired entries behave as blocked — trigger auto-reply or pairing
```

### Module Hook Flow (new)
```
Message passes filter + rules resolution
    → moduleRegistry.getModulesForChat(chatJid)
    → [module1.onInbound, module2.onInbound] (serial, in registration order)
    → any module returns false → suppress delivery (module handled it)
    → all modules pass → normal delivery to OpenClaw runtime
```

---

## Suggested Build Order

Dependencies chain upward — each item unlocks the next.

**Phase 1 (foundation — all features depend on this)**
- `directory.ts`: `expires_at` migration + `upsertTTLGrant` + `pruneExpiredGrants`
- `directory.ts`: `upsertContactBatch` + `auto_reply_log` table + `pairing_challenges` table
- `config-schema.ts`: `pairingMode` + `autoReply` + `syncIntervalMs` fields
- Rationale: All subsequent features depend on these DB and config changes. One migration pass is cleaner than two.

**Phase 2 (background sync — independent of pairing)**
- `directory-sync.ts`: new file, background loop
- `monitor.ts`: start sync at startup, `/api/admin/sync/status` route
- Admin panel Directory tab: sync status indicator
- Rationale: Unblocks BUG-06, BUG-11, BUG-15 (directory search bugs). No dependencies on pairing. Can ship independently.

**Phase 3 (pairing mode — depends on Phase 1)**
- `pairing.ts`: new file, challenge/response/grant logic
- `inbound.ts`: pairing hook insertion
- `monitor.ts`: pairing grant management routes
- Admin panel Settings: pairing config section + active grants table
- Rationale: Depends on `expires_at` infrastructure from Phase 1. Logically prior to FEATURE-02 since pairing creates TTL grants.

**Phase 4 (TTL access — depends on Phase 1 + Phase 3 schema)**
- `inbound.ts`: TTL expiry check in allow-list lookup
- `monitor.ts`: `expiresAt` in directory settings route
- Admin panel Directory tab: TTL badges, datetime picker in settings drawer
- Rationale: Same `expires_at` column. Pairing and TTL share infrastructure. Admin control of TTL is the manual complement to automated pairing.

**Phase 5 (auto-reply — depends on Phase 1 + Phase 3 hook location)**
- `inbound.ts`: auto-reply hook after pairing check
- `monitor.ts`: autoReply config exposed in settings
- Admin panel Settings: autoReply section (toggle, message template, cooldown)
- Rationale: Needs pairing hook location established first (Phase 3). `auto_reply_log` table added in Phase 1.

**Phase 6 (modules framework — depends on Phase 1 DB pattern)**
- `src/modules/module-types.ts`: `WahaModule` interface
- `src/modules/module-registry.ts`: registry + SQLite modules table
- `src/modules/index.ts`: barrel
- `directory.ts`: modules table migration
- `inbound.ts`: module `onInbound` hooks
- `monitor.ts`: modules routes + Modules tab
- Rationale: Self-contained. Depends on DirectoryDb pattern established in Phase 1 but not on pairing or auto-reply. Could be parallelized with Phases 3-5 if needed, but Phase 1 must come first.

**Critical path:** Phase 1 → (Phase 2 || Phase 3) → Phase 4 → Phase 5 → Phase 6

Phase 2 and Phase 3 are independent of each other and can be run in parallel.

---

## Architectural Patterns to Follow

### Pattern 1: setTimeout Chain for Background Loops

**What:** Schedule next iteration only after current completes. Used by `health.ts` as canonical example.

**When to use:** All new background loops (directory sync).

**Trade-offs:** Slightly longer total cycle time than setInterval (interval + work time), but avoids pile-up. The right trade-off for all plugin background loops.

```typescript
function tick(opts: SyncOptions, state: SyncState): void {
  if (opts.abortSignal.aborted) return;
  doWork(opts, state).finally(() => {
    if (!opts.abortSignal.aborted) {
      const t = setTimeout(() => tick(opts, state), opts.intervalMs);
      if (typeof t === 'object' && 'unref' in t) (t as NodeJS.Timeout).unref();
    }
  });
}
```

### Pattern 2: Migration-Safe ALTER TABLE

**What:** Try/catch ALTER TABLE that ignores "duplicate column" errors. Used throughout `directory.ts`.

**When to use:** Every new column added to existing tables in v1.11.

**Trade-offs:** Slightly verbose but absolutely required — production DB already exists and restarts frequently.

```typescript
try {
  this.db.prepare(`ALTER TABLE allow_list ADD COLUMN expires_at INTEGER`).run();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.includes('duplicate column')) throw e;
}
```

### Pattern 3: Scripted Replies via sendWahaText

**What:** Use `sendWahaText()` directly for scripted/automated replies that must NOT reach the LLM.

**When to use:** Pairing challenges, auto-reply canned messages. Any zero-token response.

**Trade-offs:** Bypasses the OpenClaw runtime entirely. No LLM cost, no token burn. Must use `account.session` and `account.baseUrl` from the resolved account.

### Pattern 4: Module Hooks as Serial Middleware

**What:** Ordered list of hook functions called sequentially. First `false` return short-circuits remaining hooks.

**When to use:** Module `onInbound` pipeline.

**Trade-offs:** Slower than `Promise.all` but predictable order and correct short-circuit semantics. Test each module in isolation.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Sync Loop Using setInterval

**What people do:** `setInterval(() => runSync(), 3600_000)`

**Why it's wrong:** If a sync takes longer than the interval, a second iteration starts while the first is still running. Causes duplicate DB writes and race conditions.

**Do this instead:** setTimeout chain — `health.ts` is the canonical example.

### Anti-Pattern 2: Background Sync Bypassing http-client Rate Limiter

**What people do:** Call `fetch()` directly in the sync loop to avoid rate limiter overhead.

**Why it's wrong:** WAHA API has implicit rate limits. Directory sync runs continuously and will trigger 429s, starving the message handler of API quota.

**Do this instead:** Always call `callWahaApi()` from `http-client.ts`. Add deliberate inter-page delay in sync loop (e.g., 500ms between pages).

### Anti-Pattern 3: Storing Pairing State In-Memory Only

**What people do:** `const pairingState = new Map<string, PairingChallenge>()`

**Why it's wrong:** Gateway restarts frequently. In-memory state is lost on restart. A challenge sent before restart cannot be verified after restart.

**Do this instead:** Store pending challenges in SQLite `pairing_challenges` table — same pattern as `pending_selections` used by shutup.ts. Short TTL (5 min) prevents stale challenge buildup.

### Anti-Pattern 4: Module Hooks Awaited in Parallel

**What people do:** `await Promise.all(modules.map(m => m.onInbound(msg, chat)))`

**Why it's wrong:** If two modules both want to short-circuit delivery, parallel execution makes it impossible to know which "won". Side effects between modules may race.

**Do this instead:** Serial execution with early-exit on `false` return.

### Anti-Pattern 5: TTL Check in Application Code Instead of SQL

**What people do:** Load allow-list entry then check `entry.expiresAt < Date.now()` in TypeScript.

**Why it's wrong:** Loads expired entries unnecessarily. More code paths to test. Risk of forgetting the check.

**Do this instead:** Add `AND (expires_at IS NULL OR expires_at > ?)` directly in the SQL WHERE clause with `Date.now()` as the parameter.

---

## Integration Points Summary

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| WAHA API (contacts) | `callWahaApi()` via `http-client.ts` | Paginated; use offset/limit in sync loop |
| WAHA API (groups) | `callWahaApi()` via `http-client.ts` | Returns dict — use `Object.values()` (existing quirk) |
| WAHA API (lids) | `getWahaAllLids()` from `send.ts` | Already implemented; sync should reuse same function |
| SQLite | `DirectoryDb` methods only | Never call `this.db` directly outside `directory.ts` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `directory-sync.ts` → `directory.ts` | `DirectoryDb` method calls only | No direct DB access from sync module |
| `pairing.ts` → `inbound.ts` | Function calls, returns boolean | pairing.ts must NOT import from inbound.ts (circular dep) |
| `pairing.ts` → `send.ts` | `sendWahaText()` for challenge messages | Same pattern as shutup.ts |
| `module-registry.ts` → `directory.ts` | `DirectoryDb` for module config persistence | Registry receives db reference at init |
| `inbound.ts` → `module-registry.ts` | `moduleRegistry.getModulesForChat()` | Singleton import; initialized before first message |
| `monitor.ts` → `directory-sync.ts` | `startDirectorySync()` + `getSyncStatus()` | Same pattern as `startHealthCheck` from `health.ts` |
| Admin panel → `/api/admin/*` routes | XHR to monitor.ts HTTP server | All existing CORS, JSON, textContent-only patterns apply |

---

## Sources

- Direct source inspection: `src/directory.ts`, `src/health.ts`, `src/inbound.ts`, `src/monitor.ts`, `src/channel.ts`, `src/config-schema.ts`, `src/inbound-queue.ts`, `src/shutup.ts`, `src/dm-filter.ts`
- `.planning/PROJECT.md` — v1.11 requirements and feature scope
- `.planning/phases/11-dashboard-sessions-log/bugs.md` — FEATURE-01 through FEATURE-04 specifications with user design decisions

---

*Architecture research for: WAHA OpenClaw Plugin v1.11 integration design*
*Researched: 2026-03-17*
