# Phase 53: MimicryGate Core - Research

**Researched:** 2026-03-26
**Domain:** TypeScript module design -- SQLite rolling window, Zod schema extension, injectable clock, config hierarchy merge
**Confidence:** HIGH (all findings from direct codebase inspection)

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | New mimicry-gate.ts with time gate check, cap tracker, config resolution | SQLite pattern from AnalyticsDb; Zod extension from WahaAccountSchemaBase confirmed |
| INFRA-02 | Config hierarchy follows existing merge pattern (global -> session) | validateWahaConfig + WahaAccountSchemaBase pattern verified |
| INFRA-03 | Zod schemas for sendGate and hourlyCap with .optional().default() on all new fields | WahaAccountSchemaBase.strict() confirmed; knownKeys auto-derived from schema shape |
| INFRA-04 | bypassPolicy flag skips all mimicry gates | sendWahaText:214 has bypassPolicy; sendWahaImage/Video/File do NOT yet (Phase 54 gap) |
| GATE-01 | Outbound messages blocked outside configurable send window (default 7am-1am local) | Intl.DateTimeFormat pattern confirmed; cross-midnight window logic documented |
| GATE-02 | Send window configurable at global and per-session levels | WahaAccountSchemaBase + accounts.{id} override confirmed in config-schema.ts:176 |
| GATE-03 | Quiet hours policy configurable as reject or queue | Reject-not-queue locked in STATE.md; onBlock enum field needed |
| GATE-04 | Timezone configurable per session via IANA string | Intl.DateTimeFormat with timeZone option confirmed Node 18+ |
| CAP-01 | Hard hourly cap per session using rolling window (not top-of-hour reset) | Rolling window: store timestamps, COUNT WHERE sent_at > now-3600000 |
| CAP-02 | Account maturity tracked in 3 phases from first_send_at | account_metadata SQLite table; ON CONFLICT DO NOTHING ensures first write wins |
| CAP-03 | Progressive default caps: New=15/hr, Warming=30/hr, Stable=50/hr | progressiveLimits array in HourlyCapSchema |
| CAP-04 | Cap configurable at global and per-session levels | Same WahaAccountSchemaBase + accounts.{id} hierarchy |
| CAP-05 | Cap counter persisted in SQLite to survive gateway restarts | Rolling window per-timestamp rows in SQLite |
</phase_requirements>

## Summary

Phase 53 builds `src/mimicry-gate.ts` as a completely standalone module -- no live send paths are modified. The module provides five exported functions (`checkTimeOfDay`, `checkAndConsumeCap`, `resolveGateConfig`, `resolveCapLimit`, `getCapStatus`) plus two new SQLite tables (`send_window_events` for rolling window counts and `account_metadata` for maturity state persistence). Config schema is extended with `SendGateSchema` and `HourlyCapSchema` objects added to `WahaAccountSchemaBase`. All new Zod fields use `.optional().default()`. The `knownKeys` set in `validateWahaConfig` is auto-derived from `Object.keys(WahaAccountSchemaBase.shape)` -- no manual update needed when fields are added to the schema object.

The rolling window cap (CAP-01, CAP-05) uses per-timestamp SQLite rows, not an in-memory counter or top-of-hour bucket reset. This is a locked decision from STATE.md (prevents 2x burst exploit at hour boundaries and survives restarts). Account maturity (CAP-02) is derived from `first_send_at` in the `account_metadata` SQLite table -- never from plugin startup time.

All five gate functions accept a `now?: number` injectable clock parameter (defaulting to `Date.now()`). This is non-negotiable for testability -- vitest tests pass fixed timestamps without global timer mocks.

**Primary recommendation:** Follow the `AnalyticsDb` class pattern exactly for the new `MimicryDb` class. Use `createRequire(import.meta.url)` for `better-sqlite3`, WAL mode, `busy_timeout = 5000`, periodic WAL checkpoint, and a `prune()` method. Reuse the `~/.openclaw/data/` path convention.

## Standard Stack

### Core (no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--|
| `better-sqlite3` | ^11.10.0 (existing) | Rolling window table + account_metadata | Already present; AnalyticsDb and DirectoryDb patterns established |
| `zod` | ^4.3.6 (existing) | SendGateSchema + HourlyCapSchema | Already used in config-schema.ts |
| `Intl.DateTimeFormat` | Node built-in | IANA timezone-aware hour extraction | Zero deps; DST-correct; confirmed Node 18+ |
| `createRequire` | Node built-in | better-sqlite3 CommonJS import in ESM | Same pattern as analytics.ts:9 and directory.ts:10 |

### Installation

```
# No new packages needed -- all capabilities covered by existing stack
```


## Architecture Patterns

### Recommended File Structure

```
src/
├── mimicry-gate.ts        # New: all enforcement primitives, MimicryDb class
├── mimicry-gate.test.ts   # New: unit tests with injectable clock
├── config-schema.ts       # Modified: add SendGateSchema + HourlyCapSchema to WahaAccountSchemaBase
```

Test files in this project live at `src/*.test.ts`. Confirmed: `src/rate-limiter.test.ts`, `src/directory.test.ts`.

### Pattern 1: MimicryDb Class (follows AnalyticsDb exactly)

Two SQLite tables:
1. `send_window_events (id INTEGER PK, session TEXT, sent_at INTEGER)` with index on `(session, sent_at)`
2. `account_metadata (session TEXT PK, first_send_at INTEGER, updated_at INTEGER)`

Critical SQL:
- Rolling window count: `SELECT COUNT(*) as cnt FROM send_window_events WHERE session = ? AND sent_at > ?` (param 2: now - 3_600_000)
- Record send: `INSERT INTO send_window_events (session, sent_at) VALUES (?, ?)`
- Set first_send_at: `INSERT INTO account_metadata ... ON CONFLICT(session) DO NOTHING`
- Prune: `DELETE FROM send_window_events WHERE sent_at < (now - 7_200_000)` (keep 2 hours)

Constructor pattern -- copy from analytics.ts:23-35:
- `createRequire(import.meta.url)` for better-sqlite3 CJS import
- `pragma("journal_mode = WAL")` + `pragma("busy_timeout = 5000")`
- `_startWalCheckpoint()` with `.unref()` (Phase 37 MEM-03 -- DO NOT REMOVE)
- `pruneOldWindows()` called at construction
- Singleton export `getMimicryDb()` -- same as `getAnalyticsDb()`


### Pattern 2: Gate Functions with Injectable Clock

All five exported functions accept `now?: number = Date.now()`.

**Cross-midnight window (GATE-01):**
- `crossMidnight = endHour <= startHour`
- If cross-midnight: `inWindow = hour >= startHour || hour < endHour`
- If same-day: `inWindow = hour >= startHour && hour < endHour`
- Default startHour=7, endHour=1: `1 <= 7` is true, cross-midnight applies. Window: 07:00-00:59.

**Timezone-aware hour (GATE-04):**
- Use `Intl.DateTimeFormat` with `hour: "numeric", hour12: false, timeZone: tz`
- Call `.formatToParts(new Date(now))`, find `p.type === "hour"`, parse int
- Normalize midnight: `if (hour === 24) hour = 0` -- some locales return 24

**Maturity phase (CAP-02):**
- `ageDays = (now - first_send_at) / 86_400_000`
- `"new"` if ageDays < 7; `"warming"` if ageDays < 30; `"stable"` otherwise

### Pattern 3: Config Schema Extension

`validateWahaConfig` at config-schema.ts:215 derives `knownKeys` from `Object.keys(WahaAccountSchemaBase.shape)`. Adding `sendGate` and `hourlyCap` to `WahaAccountSchemaBase` automatically includes them -- no manual update needed.

Add BEFORE `.strict()` in `WahaAccountSchemaBase`:

```typescript
sendGate: z.object({
  enabled: z.boolean().optional().default(false),
  timezone: z.string().optional().default("UTC"),
  startHour: z.number().int().min(0).max(23).optional().default(7),
  endHour: z.number().int().min(0).max(23).optional().default(1),
  onBlock: z.enum(["reject", "queue"]).optional().default("reject"),
}).optional().default({}),

hourlyCap: z.object({
  enabled: z.boolean().optional().default(false),
  limits: z.object({
    new: z.number().int().positive().optional().default(15),
    warming: z.number().int().positive().optional().default(30),
    stable: z.number().int().positive().optional().default(50),
  }).optional().default({}),
}).optional().default({}),
```

Both use `.optional().default({})` -- existing configs parse without error.

### Pattern 4: Config Resolution (Global -> Per-Session Merge)

```typescript
export function resolveGateConfig(
  session: string | undefined,
  cfg: CoreConfig
): ResolvedGateConfig {
  const global = cfg.sendGate ?? {};
  const perSession = session ? (cfg.accounts?.[session]?.sendGate ?? {}) : {};
  // Shallow merge: per-session wins for each key
  return { ...global, ...perSession } as ResolvedGateConfig;
}
```

This matches the existing `dmFilter`/`groupFilter` resolution pattern in the codebase.

### Pattern 5: Public API Surface (5 exported functions)

- `checkTimeOfDay(gateConfig: ResolvedGateConfig, now?: number): GateResult` -- pure check, no side effects
- `checkAndConsumeCap(session: string, limit: number, db: MimicryDb, now?: number): CapResult` -- check AND record; only call when send is definitely happening
- `resolveGateConfig(session: string | undefined, cfg: CoreConfig): ResolvedGateConfig` -- pure merge
- `resolveCapLimit(session: string | undefined, maturity: MaturityPhase, cfg: CoreConfig): number` -- pure merge
- `getCapStatus(session: string, db: MimicryDb, now?: number): CapStatus` -- read-only snapshot for admin API (Phase 57)

`simulateOutboundTyping` is Phase 54. Do NOT add it in Phase 53.

### Anti-Patterns to Avoid

- **In-memory `Map<string, { hour, count }>`:** Resets on restart.
- **Top-of-hour bucket `Math.floor(now / 3600000)`:** Allows 2x burst.
- **`new Date().getHours()`:** Returns UTC on hpg6. Use `Intl.DateTimeFormat`.
- **Cap check inside `TokenBucket.acquire()`:** Stalls the drainer.
- **`Date.now() - moduleLoadTime` for maturity:** Use `first_send_at` from SQLite.
- **Zod fields without `.optional().default()`:** Breaks existing `openclaw.json` on deploy.
- **Adding `simulateOutboundTyping` in Phase 53:** Phase 54 concern only.


## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timezone-aware hour extraction | Custom UTC offset math | `Intl.DateTimeFormat` with `timeZone` | DST-correct, IANA strings, built-in Node 18+ |
| Sliding window rate counter | Custom timestamp array | SQLite rolling window | Survives restarts; trivial SQL |
| Config merge hierarchy | Deep merge utility | Shallow `??` chaining | Matches existing codebase pattern |
| Schema validation | Custom validators | Zod `.optional().default()` | Already in use throughout config-schema.ts |

## Common Pitfalls

### Pitfall 1: Cross-Midnight Window Logic Inverted

**What goes wrong:** `startHour=7, endHour=1`. Naive `hour >= 7 && hour < 1` is always false. Gate is permanently closed.

**How to avoid:** `crossMidnight = endHour <= startHour`. If true, use OR: `hour >= startHour || hour < endHour`. Test hours: 0, 1, 6, 7, 13, 22, 23.

**Warning signs:** All sends blocked at all times regardless of hour.

### Pitfall 2: Zod .strict() Rejects New Fields Without .optional()

**What goes wrong:** `WahaAccountSchemaBase` ends with `.strict()`. Any field without `.optional()` is required. Existing configs fail validation on startup.

**How to avoid:** Every new field uses `.optional()`. Both schema objects use `.optional().default({})` at the top level. Test: `validateWahaConfig({})` must return `{ valid: true }`.

**Warning signs:** Gateway fails to start after deploy; logs show `validation_failed`.

### Pitfall 3: checkAndConsumeCap Called Speculatively

**What goes wrong:** Called as a preview without intent to send -- send is recorded and cap decremented.

**How to avoid:** `checkAndConsumeCap` is combined check-and-record. Only call when send is definitely happening. Add code comment warning Phase 54 implementer.

### Pitfall 4: Midnight Hour Returns 24 from Intl.DateTimeFormat

**What goes wrong:** Some locales return '24' for midnight with `hour12: false`. `parseInt('24') === 24` breaks comparisons.

**How to avoid:** After `parseInt`, normalize: `if (hour === 24) hour = 0;`

### Pitfall 5: Tests Depend on Real System Time

**What goes wrong:** Gate boundary tests fail depending on CI server time of day.

**How to avoid:** All exported functions accept `now?: number = Date.now()`. Tests pass fixed timestamps. No `vi.useFakeTimers()` (leaks between test files in vitest).

### Pitfall 6: bypassPolicy Missing on sendWahaImage/Video/File

**What goes wrong:** `sendWahaText` has `bypassPolicy` (send.ts:214). The other 3 send functions do NOT. Phase 54 adding gate checks breaks system command bypasses.

**How to avoid:** Add a code comment in `mimicry-gate.ts` warning that Phase 54 must add `bypassPolicy` to all 4 send functions.


## Code Examples

### Verified -- AnalyticsDb constructor pattern (analytics.ts:23-35)

```typescript
// Source: src/analytics.ts:9-35 (direct inspection)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

export class MimicryDb {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS send_window_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session TEXT NOT NULL,
        sent_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_swe_session_time
        ON send_window_events (session, sent_at);
      CREATE TABLE IF NOT EXISTS account_metadata (
        session TEXT PRIMARY KEY,
        first_send_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this._startWalCheckpoint();
    this.pruneOldWindows();
  }

  // DO NOT REMOVE -- Phase 37 MEM-03: unref() prevents keeping process alive
  private _startWalCheckpoint(): void {
    const interval = setInterval(() => {
      try { this.db.pragma("wal_checkpoint(PASSIVE)"); } catch {}
    }, 30_000);
    interval.unref();
  }
}
```

### Verified -- Rolling window query (CAP-01, CAP-05)

```typescript
// Source: rolling window pattern from src/analytics.ts (adapted)
countRecentSends(session: string, now: number = Date.now()): number {
  const windowStart = now - 3_600_000; // 1 hour rolling window
  const row = this.db.prepare(
    "SELECT COUNT(*) as cnt FROM send_window_events WHERE session = ? AND sent_at > ?"
  ).get(session, windowStart) as { cnt: number };
  return row.cnt;
}

recordSend(session: string, now: number = Date.now()): void {
  this.db.prepare(
    "INSERT INTO send_window_events (session, sent_at) VALUES (?, ?)"
  ).run(session, now);
}

ensureFirstSendAt(session: string, now: number = Date.now()): void {
  // ON CONFLICT DO NOTHING -- first write wins, never overwrite
  this.db.prepare(
    "INSERT INTO account_metadata (session, first_send_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(session) DO NOTHING"
  ).run(session, now, now);
}

getFirstSendAt(session: string): number | null {
  const row = this.db.prepare(
    "SELECT first_send_at FROM account_metadata WHERE session = ?"
  ).get(session) as { first_send_at: number } | undefined;
  return row?.first_send_at ?? null;
}

pruneOldWindows(now: number = Date.now()): void {
  // Keep 2 hours of data -- rolling window only needs 1h but buffer for getCapStatus
  this.db.prepare(
    "DELETE FROM send_window_events WHERE sent_at < ?"
  ).run(now - 7_200_000);
}
```

### Verified -- knownKeys auto-derivation (config-schema.ts:215)

```typescript
// Source: src/config-schema.ts:215 (direct inspection)
// validateWahaConfig builds knownKeys from schema shape:
const knownKeys = new Set([
  ...Object.keys(WahaAccountSchemaBase.shape),
  "accounts",
  "defaultAccount",
  "adminToken",
]);
// Adding sendGate and hourlyCap to WahaAccountSchemaBase.shape
// automatically includes them -- no manual knownKeys update needed.
```

### Verified -- bypassPolicy gap on sendWahaImage/Video/File (send.ts:415-486)

```typescript
// Source: src/send.ts:207-214 (sendWahaText -- HAS bypassPolicy)
export async function sendWahaText(
  account: WahaAccount,
  chatId: string,
  text: string,
  options?: { bypassPolicy?: boolean; ... }
): Promise<void> { ... }

// Source: src/send.ts:415 (sendWahaImage -- MISSING bypassPolicy)
export async function sendWahaImage(
  account: WahaAccount,
  chatId: string,
  ...
): Promise<void> { ... }
// NOTE FOR PHASE 54: Add bypassPolicy param to sendWahaImage, sendWahaVideo,
// sendWahaFile before wiring mimicry gate. /shutup, /join, /leave use these.
```

### Verified -- Intl.DateTimeFormat formatToParts (Node 18+)

```typescript
// Source: MDN Intl.DateTimeFormat + Node.js 18 built-in (no library needed)
function extractHour(nowMs: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(nowMs));
  const hourPart = parts.find((p) => p.type === "hour");
  let hour = parseInt(hourPart?.value ?? "0", 10);
  if (hour === 24) hour = 0; // some locales return 24 for midnight
  return hour;
}

function checkTimeOfDay(
  config: ResolvedGateConfig,
  now: number = Date.now()
): GateResult {
  if (!config.enabled) return { allowed: true };
  const hour = extractHour(now, config.timezone ?? "UTC");
  const { startHour = 7, endHour = 1 } = config;
  const crossMidnight = endHour <= startHour;
  const inWindow = crossMidnight
    ? hour >= startHour || hour < endHour
    : hour >= startHour && hour < endHour;
  if (!inWindow) {
    return { allowed: false, reason: `Outside send window (${startHour}:00-${endHour}:00 ${config.timezone})` };
  }
  return { allowed: true };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed hourly bucket `Math.floor(ts / 3600000)` | Rolling window `COUNT WHERE sent_at > now - 3_600_000` | v1.20 design decision | Eliminates 2x burst exploit at hour boundaries |
| In-memory maturity counter reset on restart | `first_send_at` persisted in SQLite `account_metadata` | v1.20 design decision | Maturity state survives gateway restarts |
| UTC `new Date().getHours()` | `Intl.DateTimeFormat` with IANA timezone | v1.20 Phase 53 | DST-correct for all global timezones |
| Global hourly cap shared across accounts | Per-WAHA-session cap keyed by session name | v1.20 design decision (STATE.md) | Logan and Omer sends correctly share one bucket per session |

**No deprecated patterns from existing codebase apply to this new module.**

## Open Questions

1. **Bot reply counting against cap**
   - What we know: Bot replies go through `sendWahaText` in `send.ts`. When Phase 54 wires the gate, they will decrement the hourly cap unless explicitly exempted.
   - What is unclear: Is this intended? If bot replies are frequent, they could exhaust the cap before Claude Code sends land.
   - Recommendation: Phase 53 does not wire the gate (standalone module). Document this question clearly in `mimicry-gate.ts` code comments so Phase 54 implementer decides. Options: `skipMimicryGate?: boolean` param on `sendWahaText`, or accept that bot replies count.

2. **SQLite file path convention**
   - What we know: `AnalyticsDb` and `DirectoryDb` both use `~/.openclaw/data/` path via `os.homedir()`.
   - What is unclear: Should `MimicryDb` use a separate file (`mimicry.db`) or share `analytics.db`?
   - Recommendation: Separate file `mimicry.db` -- cleaner separation; Phase 53 is standalone; no table naming conflicts.

3. **Rolling window query performance at scale**
   - What we know: Index on `(session, sent_at)` covers the `WHERE session = ? AND sent_at > ?` query. At 50 msg/hr max, table rows stay small (pruned to 2hr window = max ~100 rows per session).
   - What is unclear: Whether `COUNT(*)` on indexed rows needs optimization.
   - Recommendation: No optimization needed at this scale. The index is sufficient. Flag for review only if sessions exceed 200 msg/hr.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified -- Phase 53 is code-only, uses existing better-sqlite3 and Node.js built-ins already present)

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run src/mimicry-gate.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GATE-01 | Blocks send outside 7am-1am window | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| GATE-01 | Allows send inside window (hour=13) | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| GATE-01 | Cross-midnight: hour=0 allowed, hour=6 blocked | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| GATE-03 | Returns `allowed: false, reason` on block | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| GATE-04 | Uses IANA timezone not UTC | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| CAP-01 | Blocks when count >= limit in rolling window | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| CAP-01 | Allows when count < limit | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| CAP-01 | Rolling window: sends from >1h ago do not count | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| CAP-02 | Maturity "new" for ageDays < 7 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| CAP-02 | Maturity "warming" for 7 <= ageDays < 30 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| CAP-02 | Maturity "stable" for ageDays >= 30 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| CAP-03 | resolveCapLimit returns 15 for "new" by default | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| CAP-04 | Per-session cap overrides global cap | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| CAP-05 | MimicryDb counts persist across instance recreation | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| INFRA-02 | resolveGateConfig: per-session wins over global | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 |
| INFRA-03 | validateWahaConfig({}) succeeds with new fields | unit | `npx vitest run src/config-schema.test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/mimicry-gate.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/mimicry-gate.test.ts` -- covers GATE-01..04, CAP-01..05, INFRA-02..04
- [ ] `src/config-schema.test.ts` -- covers INFRA-03 (validateWahaConfig with new fields)

*(Both files are new -- this is a new module with no prior tests)*

## Project Constraints (from CLAUDE.md)

- **All new Zod fields must use `.optional().default()`** -- existing `openclaw.json` on hpg6 must load without error
- **`WahaAccountSchemaBase` uses `.strict()`** -- unknown keys fail validation; new fields auto-included via `Object.keys(schema.shape)`, no manual `knownKeys` update
- **`better-sqlite3` loaded via `createRequire(import.meta.url)`** -- jiti ESM/CJS boundary; do not use `import`
- **WAL mode + `busy_timeout = 5000` required** -- matches existing DB classes; do not skip
- **`_startWalCheckpoint().unref()` required** -- Phase 37 MEM-03 fix; prevents process from staying alive; DO NOT REMOVE
- **Two deploy locations on hpg6**: `~/.openclaw/extensions/waha/` AND `~/.openclaw/workspace/skills/waha-openclaw-channel/`
- **Clear `/tmp/jiti/` after deploy** -- jiti cache is path-based, not content-based; stale cache serves old code
- **DO NOT CHANGE comments** -- Phase 53 creates new file; no existing DO NOT CHANGE markers in scope, but add them to MimicryDb constructor pattern
- **Never write "Sammie" in git-tracked files** -- use "the agent" or "the bot" in code comments
- **Make backups before modifying existing files** -- `cp config-schema.ts config-schema.ts.bak.vX.X.X` before editing
- **Cap keyed by WAHA session name** (locked in STATE.md) -- NOT by plugin `accountId`; Logan and Omer sends share one bucket per session
- **Reject-not-queue as default quiet hours policy** (locked in STATE.md) -- `onBlock: "reject"` default
- **Rolling window over fixed bucket** (locked in STATE.md) -- per-timestamp rows, `COUNT WHERE sent_at > now - 3_600_000`

## Sources

### Primary (HIGH confidence)

- `src/analytics.ts:1-84` -- AnalyticsDb constructor pattern, WAL setup, prune, singleton
- `src/directory.ts:1-120` -- DirectoryDb class; confirms same constructor structure
- `src/config-schema.ts:52-230` -- WahaAccountSchemaBase.strict(), validateWahaConfig knownKeys auto-derivation
- `src/send.ts:176-486` -- sendWahaPresence, sendWahaText bypassPolicy, sendWahaImage/Video/File lack bypassPolicy
- `src/http-client.ts:41-100` -- TokenBucket drain loop; cap check must be BEFORE acquire()
- `src/rate-limiter.test.ts` -- vitest test style (describe/it/expect, no global mocks)
- `.planning/STATE.md` -- locked decisions: rolling window, reject-not-queue, cap by session name
- `MDN Intl.DateTimeFormat` -- formatToParts API, hour12: false, Node 18+ support

### Secondary (MEDIUM confidence)

- `.planning/research/SUMMARY.md` -- milestone-level research confirming zero new deps and all integration points
- `.planning/research/STACK.md` -- confirmed better-sqlite3 ^11.10.0, zod ^4.3.6 in package.json

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified in package.json; no new dependencies
- Architecture: HIGH -- all files inspected directly; patterns copied from existing AnalyticsDb/DirectoryDb
- Pitfalls: HIGH -- each derived from specific code location (config-schema.ts:163, send.ts:214, analytics.ts:30)
- Test strategy: HIGH -- vitest confirmed in use; test file pattern confirmed from src/rate-limiter.test.ts

**Research date:** 2026-03-26
**Valid until:** 2026-04-25 (stable stack; 30-day window)
