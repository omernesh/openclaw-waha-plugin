# Stack Research: v1.11 New Features

**Domain:** WhatsApp OpenClaw plugin — background sync, pairing mode, TTL access, auto-reply, modules system
**Researched:** 2026-03-17
**Confidence:** HIGH (all recommendations verified against official sources or current npm registry)

---

## Existing Stack (Do Not Re-Research)

These are already in production. Do NOT add alternatives or reconsider them.

| Package | Version | In `package.json` |
|---------|---------|-------------------|
| `better-sqlite3` | ^11.10.0 | yes |
| `lru-cache` | ^11.2.6 | yes |
| `yaml` | ^2.8.2 | yes |
| `zod` | ^4.3.6 | yes |
| `p-queue` | (in use) | yes |
| TypeScript | ^5.9.3 | devDep |
| vitest | ^4.0.18 | devDep |

**Built-in Node.js APIs already in use:** `node:http`, `node:fs`, `node:crypto`, `node:path`, `node:os`, `AbortSignal.timeout()`, native `fetch`, `setInterval`/`setTimeout`.

---

## Recommended Stack — New Additions

### Background Directory Sync (CR-08, BUG-06, BUG-11, BUG-15)

**Decision: No new dependency. Use existing `setInterval`/`setTimeout` chain pattern.**

The project already uses a `setTimeout` chain (not `setInterval`) for health pings — a documented architectural decision. Apply the same pattern for background sync. The sync is long-running, sequential, and must respect rate limits — a simple async loop with configurable delay between batches is the right fit.

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `setTimeout` chain (existing pattern) | Built-in | Drive background sync loop | Consistent with health monitoring pattern. Prevents timer pile-up when a sync batch takes longer than the interval (which `setInterval` cannot prevent). Self-throttling: next tick only starts after current batch completes. |
| `better-sqlite3` (existing) | ^11.10.0 | Store synced contacts/groups | Already the directory store. Add `synced_at`, `sync_source` columns and a `sync_state` table. No new dependency. |

**Why NOT `node-cron` or `croner`:** Background directory sync is continuous, adaptive, and rate-limited — not time-scheduled. Cron syntax (run at 2am) doesn't model "pull until WAHA reports everything is synced, then idle". A `setTimeout` loop with configurable interval and backoff is both simpler and more accurate for this use case. Croner (zero-dep, ESM, TypeScript) would be the right choice IF we needed time-of-day scheduling — flag for future use if a "sync daily at midnight" requirement appears.

**Sync architecture:** Pull WAHA contacts/groups/newsletters in configurable batches (e.g., 50 at a time), pause between batches (e.g., 2s), write to SQLite, track progress in a `sync_state` table (`last_sync_at`, `total_synced`, `sync_complete`). After initial full sync, switch to delta mode (re-sync every N hours or on webhook event).

**New SQLite additions (no new package):**

```sql
-- Add to contacts table (migration-safe ALTER TABLE pattern, already used)
ALTER TABLE contacts ADD COLUMN synced_at INTEGER;
ALTER TABLE contacts ADD COLUMN sync_source TEXT; -- 'waha_contacts' | 'waha_groups' | 'webhook'

-- New table for sync progress
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,  -- e.g., 'contacts', 'groups', 'newsletters'
  last_sync_at INTEGER,
  total_synced INTEGER DEFAULT 0,
  sync_complete INTEGER DEFAULT 0
);
```

---

### TTL-Based Access (FEATURE-02)

**Decision: No new dependency. `expires_at INTEGER` column + cleanup query on `better-sqlite3`.**

SQLite stores timestamps as Unix milliseconds (integers). The TTL pattern is: store `expires_at` column, check `expires_at IS NULL OR expires_at > ?` (current time) on every access, run periodic cleanup. This is a well-established SQLite pattern requiring zero new libraries.

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `better-sqlite3` (existing) | ^11.10.0 | `expires_at` column in `dm_settings` and `allow_list` | Synchronous SQLite fits the hot-path inbound filter check. Migrations follow the existing `ALTER TABLE ... ADD COLUMN` pattern with duplicate-column error handling already in `_createSchema()`. |

**New SQLite additions:**

```sql
-- dm_settings: add expires_at (null = never expires)
ALTER TABLE dm_settings ADD COLUMN expires_at INTEGER;

-- allow_list: add expires_at (null = never expires)
ALTER TABLE allow_list ADD COLUMN expires_at INTEGER;

-- pairing_grants: temporary access granted by passcode challenge
CREATE TABLE IF NOT EXISTS pairing_grants (
  jid TEXT NOT NULL,
  session_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  passcode_used TEXT,
  revoked INTEGER DEFAULT 0,
  PRIMARY KEY (jid, session_id)
);
```

**Cleanup:** Add a `cleanupExpiredGrants()` method to `DirectoryDb`, called from the sync loop (no need for a separate timer). Pattern: `DELETE FROM pairing_grants WHERE expires_at < ? AND revoked = 0`.

---

### Pairing Mode — Passcode Challenge/Response and wa.me Deep Links (FEATURE-01)

**Decision: No new dependency. URL parsing via built-in `URL` API. Passcode state in SQLite.**

The wa.me deep link format is: `https://wa.me/{phone}?text={encoded_message}`. When a contact clicks the link, WhatsApp opens a DM pre-filled with the encoded message text. The plugin reads the first message from an unknown contact and checks if it matches a configured passcode pattern.

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Built-in `URL` + `URLSearchParams` | Node 18+ built-in | Parse wa.me link parameters, construct deep links for admin panel display | Zero dependencies. `new URL(href)` and `url.searchParams.get('text')` cover all needed operations. `encodeURIComponent()` handles encoding. |
| `better-sqlite3` (existing) | ^11.10.0 | `pairing_grants` table, pending challenge state | Persists grant state across gateway restarts (same reason `pending_selections` was moved to SQLite in Phase 7). |
| `node:crypto` (existing) | Built-in | Generate cryptographically random passcodes | `crypto.randomBytes(4).toString('hex')` gives an 8-character hex passcode (e.g., `a3f9b2c1`). Already imported in `src/signature.ts`. |

**wa.me link construction (admin panel, no library):**

```typescript
function buildWamePairingLink(phone: string, passcode: string): string {
  const msg = `VERIFY-${passcode}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
```

**Passcode challenge flow (all in `inbound.ts`, pre-LLM):**

1. Unknown contact sends first message
2. Check `pairing_grants` table — if no active grant, enter challenge mode
3. Message text matches configured passcode pattern (e.g., `VERIFY-{code}`) → grant TTL access, write to `pairing_grants`
4. Message text does NOT match → send rejection canned response (see auto-reply below), log attempt

**Per-session passcode config (in existing `WahaChannelConfig`):**

```typescript
pairingMode: {
  enabled: boolean;
  passcode: string;           // configurable in admin panel, stored in openclaw.json
  grantTtlMinutes: number;    // default: 30
  deepLinkPhone: string;      // phone number for wa.me link display
}
```

---

### Auto-Reply Canned Message (FEATURE-03)

**Decision: No new dependency. Rate limiting via SQLite `last_reply_at` column in `pairing_grants` / new `auto_reply_log` table. Cooldown checked with a simple timestamp comparison.**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `better-sqlite3` (existing) | ^11.10.0 | Track `last_auto_reply_at` per JID to enforce cooldown | Single timestamp per JID. Pattern: `SELECT last_auto_reply_at FROM auto_reply_log WHERE jid = ?`. If `now - last > cooldown_ms`, send reply and update. |

**New SQLite table:**

```sql
CREATE TABLE IF NOT EXISTS auto_reply_log (
  jid TEXT PRIMARY KEY,
  last_reply_at INTEGER NOT NULL
);
```

**Config additions (existing `WahaChannelConfig`):**

```typescript
autoReply: {
  enabled: boolean;
  message: string;                   // template, {{adminNames}} variable
  cooldownHours: number;             // default: 24
}
```

**Template resolution:** `{{adminNames}}` resolves to names of participants with `participant_role = 'bot_admin'` from `group_participants` table — already tracked. No new system needed.

**Send path:** Call the existing `sendWahaText()` directly from `inbound.ts` before routing to LLM. Zero token cost. Must NOT trigger the inbound pipeline recursively — use a flag or bypass the inbound filter for plugin-originated sends.

---

### Modules System (FEATURE-04)

**Decision: No new dependency. Pure TypeScript interface + registry pattern. No dynamic `require()` or filesystem loader.**

Modules are in-process TypeScript classes that implement a standard interface. They register themselves at plugin init time. The inbound pipeline calls each active module's `onInbound()` hook. No hot-reload (consistent with project constraint — gateway restart required for all code changes).

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TypeScript interfaces (existing) | ^5.9.3 | `WahaModule` interface with `name`, `init()`, `configSchema`, `onInbound()`, `onOutbound()` hooks | Same pattern as the OpenClaw plugin SDK itself. No extra tooling. Statically typed. Testable via vitest (same as existing `mentions.ts` pure-function extraction). |
| `zod` (existing) | ^4.3.6 | Per-module config schema validation | Consistent with `config-schema.ts`. Each module exports a `zod` schema for its settings. |
| `better-sqlite3` (existing) | ^11.10.0 | `module_assignments` table (which modules are assigned to which groups/contacts) | Same store as everything else. Avoid a separate config file per module. |

**Module interface (new `src/module-types.ts`):**

```typescript
export interface WahaModule {
  readonly name: string;
  readonly description: string;
  readonly configSchema: z.ZodSchema;          // zod schema for module config
  init(ctx: WahaModuleContext): Promise<void>;  // called at plugin startup
  onInbound?(msg: InboundMessage, ctx: WahaModuleContext): Promise<void | 'stop'>;
  onOutbound?(action: string, params: unknown, ctx: WahaModuleContext): Promise<void>;
}

export interface WahaModuleContext {
  db: DirectoryDb;
  config: WahaChannelConfig;
  sendText: (chatId: string, text: string) => Promise<void>;
  log: PluginLogger;
}
```

**Module registry (new `src/module-registry.ts`):**

```typescript
class ModuleRegistry {
  private modules: Map<string, WahaModule> = new Map();
  register(mod: WahaModule): void { ... }
  getActive(chatId: string): WahaModule[] { ... }  // checks module_assignments
}
```

**New SQLite table:**

```sql
CREATE TABLE IF NOT EXISTS module_assignments (
  module_name TEXT NOT NULL,
  target_jid TEXT NOT NULL,      -- group, contact, or newsletter JID
  target_type TEXT NOT NULL,     -- 'group' | 'contact' | 'newsletter'
  config_json TEXT,              -- module-specific config override (JSON)
  enabled INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (module_name, target_jid)
);
```

**Admin panel tab:** New "Modules" tab in `monitor.ts` using the existing shared UI component library (Button, Badge, Modal, Toast, Table, Form already available). No new frontend library.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `node-cron` / `croner` | Background sync is rate-limited async loop, not time-scheduled. Adds dependency for wrong abstraction. | `setTimeout` chain (existing pattern, already preferred for health pings) |
| `croner` for future use | Flag it — if time-of-day scheduling is ever needed, croner (zero-dep, ESM-native, TypeScript typings, used by PM2/Uptime Kuma) is the right pick. | `croner` ^8.x if scheduling by wall clock is required |
| `uuid` / `nanoid` | Passcode generation needs only 4 random bytes. | `node:crypto` `randomBytes()` (already imported) |
| `express` or any HTTP framework | Admin panel is already served by `node:http` in `monitor.ts`. Adding a framework now would require rewiring all existing routes. | `node:http` (existing) |
| Dynamic `require()` / filesystem module loading | Modules are in-process TypeScript — no need for plugin files on disk, no security surface. Hot-reload is out of scope (gateway restart required). | Static registry with `register()` calls at init |
| Separate config file per module | Adds deployment complexity (must SCP more files). | `module_assignments` SQLite table + existing `openclaw.json` config |
| `node:sqlite` (Node.js built-in, v22.5+) | The host gateway Node.js version is not guaranteed to be v22.5+. `better-sqlite3` is already a dependency and proven in production. | `better-sqlite3` (existing) |

---

## No New npm Dependencies Required

All v1.11 features are implementable with the existing dependency set:

| Feature | Implementation | New Packages |
|---------|----------------|--------------|
| Background directory sync | `setTimeout` chain + `better-sqlite3` | None |
| TTL-based access | `expires_at` column + `better-sqlite3` | None |
| Pairing mode passcode | `node:crypto` + `better-sqlite3` + `inbound.ts` pre-filter | None |
| wa.me deep link injection | Built-in `URL` + `encodeURIComponent` | None |
| Auto-reply canned message | `better-sqlite3` cooldown table + `sendWahaText` call | None |
| Modules system | TypeScript interface + `zod` + `better-sqlite3` | None |
| Modules admin tab | Existing shared UI component library in `monitor.ts` | None |

**Current `package.json` after v1.11:** Identical to v1.10 — no changes to `dependencies` or `devDependencies`.

---

## Integration Points

| New Capability | Touches | Integration Note |
|----------------|---------|-----------------|
| Background sync loop | `src/directory.ts`, new `src/sync.ts` | Started from `channel.ts` `init()`. Uses existing `DirectoryDb`. Rate-limited via shared token-bucket. |
| TTL check | `src/inbound.ts` (DM filter), `src/directory.ts` | Add `isExpired(jid)` to `DirectoryDb`. Called at same point as allow-list check. |
| Passcode challenge | `src/inbound.ts` (pre-LLM, before existing filters) | Check pairing mode enabled → unknown contact → check message matches passcode → grant/deny. |
| Auto-reply send | `src/inbound.ts` → `src/send.ts` `sendWahaText()` | Must bypass own inbound pipeline. Pass `_skipAutoReply: true` in internal context or check sender is own session JID. |
| Module hooks | `src/inbound.ts` (after existing filters, before LLM delivery) | `await registry.runInboundHooks(msg)` — if any module returns `'stop'`, halt LLM delivery. |
| Module admin tab | `src/monitor.ts` (new route block + HTML tab) | Follow existing tab pattern: new `case '/api/admin/modules':` route + tab registration in `renderAdminPanel()`. |
| wa.me link display | Admin panel — Pairing Mode section | Display-only in admin panel. No backend route needed — construct URL client-side from phone + passcode config. |

---

## SQLite Migration Strategy

All new columns follow the existing migration-safe pattern in `_createSchema()`:

```typescript
// Pattern already used in production for trigger_operator and participant_role columns:
try {
  this.db.prepare(`ALTER TABLE contacts ADD COLUMN synced_at INTEGER`).run();
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.includes('duplicate column')) throw e;
}
```

New tables use `CREATE TABLE IF NOT EXISTS` — idempotent, safe to run on every startup.

---

## Sources

- [node-cron GitHub — kelektiv/node-cron ESM discussion](https://github.com/kelektiv/node-cron/issues/700) — confirmed CJS-only, not ideal for this ESM project
- [croner npm](https://www.npmjs.com/package/croner) — zero-dep, ESM-native, TypeScript typings, used by PM2 and Uptime Kuma. Best cron choice IF wall-clock scheduling is ever needed (not needed for v1.11 continuous sync).
- [better-sqlite3 GitHub — WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — confirmed synchronous API, WAL mode, ALTER TABLE migration pattern
- [wa.me deep link format — Meta Developers Community](https://developers.facebook.com/community/threads/957849225969148/) — confirmed `?text=` parameter with `encodeURIComponent` encoding
- [wa.me link with ?text parameter guide](https://en.ajakteman.com/2026/03/how-to-create-wame-link-with-text.html) — confirmed format: `https://wa.me/{phone}?text={encoded}`
- [Node.js Advanced Patterns: Plugin Manager — Medium](https://v-checha.medium.com/node-js-advanced-patterns-plugin-manager-44adb72aa6bb) — confirmed interface + registry pattern for TypeScript plugins
- [TypeScript Plugin System Design — DEV Community](https://dev.to/hexshift/designing-a-plugin-system-in-typescript-for-modular-web-applications-4db5) — lifecycle hooks pattern (`init`, `onEvent`)
- [setInterval vs cron — Sabbir.co](https://www.sabbir.co/blogs/68e2852ae6f20e639fc2c9bc) — confirmed setInterval drift risk; setTimeout chain preferred for long-running loops
- [croner Overview — Hexagon/croner GitHub](https://github.com/Hexagon/croner) — MEDIUM confidence on version (^8.x), verified ESM support and zero-dep claim

---

*Stack research for: WAHA OpenClaw Plugin v1.11*
*Researched: 2026-03-17*
