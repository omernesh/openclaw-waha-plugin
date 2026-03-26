# Stack Research

**Domain:** WhatsApp bot human mimicry — time gates, hourly caps, typing delay
**Researched:** 2026-03-26
**Confidence:** HIGH

## Context: What's Already in the Codebase

This is an additive milestone. The following are confirmed present and must NOT be re-added:

| Capability | Where | Notes |
|------------|-------|-------|
| `better-sqlite3` ^11.10.0 | `package.json` | Used by `AnalyticsDb`, `DirectoryDb` |
| `zod` ^4.3.6 | `package.json` | Config schema validation |
| Token bucket rate limiter | `src/rate-limiter.ts` | Per-API-call concurrency, NOT per-hour message counting |
| `sendWahaPresence()` | `src/send.ts:176` | Calls `/api/startTyping` / `/api/stopTyping` — already implemented |
| `AnalyticsDb` (SQLite event store) | `src/analytics.ts` | Pattern to follow for hourly counter table |
| Multi-session config hierarchy | `src/config-schema.ts` | Global + per-account fields via `WahaConfigSchema.accounts` |
| `createRequire` + `better-sqlite3` pattern | `src/analytics.ts:9` | How to open SQLite in TypeScript with jiti |

---

## New Capabilities Needed

### 1. Timezone-Aware Time-of-Day Check

**Recommendation: Use `Intl.DateTimeFormat` (Node.js built-in — zero new dependencies)**

No library needed. `Intl.DateTimeFormat` with `timeZone` option is fully supported in Node.js 18+ and handles all IANA timezone strings (e.g., `"Asia/Jerusalem"`, `"America/New_York"`).

```typescript
function isWithinSendWindow(
  nowMs: number,
  timezone: string,   // IANA string, e.g. "Asia/Jerusalem"
  startHour: number,  // 0-23, e.g. 7
  endHour: number     // 0-23, e.g. 25 (next day 1am = 25)
): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const hour = parseInt(formatter.format(new Date(nowMs)), 10);
  // endHour > 23 = spans midnight (e.g. 7..25 means 7am to 1am next day)
  if (endHour > 24) {
    return hour >= startHour || hour < (endHour - 24);
  }
  return hour >= startHour && hour < endHour;
}
```

**Why not Luxon:** Adds 68KB. The project already avoids date libraries (no `date-fns`, no `luxon` in `package.json`). Native `Intl` handles all IANA timezones since Node 18.

**Why not Temporal API:** Stage 3 proposal, requires polyfill (`@js-temporal/polyfill`). Not production-ready without extra dependency. Overkill for a single hour-of-day check.

**Confidence:** HIGH — MDN docs + Node.js 18 confirmed support.

---

### 2. Hourly Message Counter (Sliding Window)

**Recommendation: Custom SQLite table using existing `better-sqlite3` — zero new dependencies**

**Why not `rate-limiter-flexible`:** The library supports `better-sqlite3` but adds a new dependency for functionality that is trivially implemented with 3 SQL statements against the existing SQLite infrastructure. The analytics and directory DBs establish a clean pattern to follow.

**Implementation pattern** (new file `src/send-limiter.ts`):

```typescript
// Table: send_counts
// Columns: account_id TEXT, window_start INTEGER, count INTEGER
// window_start = floor(timestamp / 3600000) * 3600000 (1-hour buckets)

// Check if under cap
function canSend(db: Database, accountId: string, cap: number): boolean {
  const windowStart = Math.floor(Date.now() / 3600_000) * 3600_000;
  const row = db.prepare(
    "SELECT count FROM send_counts WHERE account_id = ? AND window_start = ?"
  ).get(accountId, windowStart) as { count: number } | undefined;
  return (row?.count ?? 0) < cap;
}

// Increment counter
function recordSend(db: Database, accountId: string): void {
  const windowStart = Math.floor(Date.now() / 3600_000) * 3600_000;
  db.prepare(`
    INSERT INTO send_counts (account_id, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(account_id, window_start) DO UPDATE SET count = count + 1
  `).run(accountId, windowStart);
}
```

This is a **fixed window** (hourly buckets), not sliding window. Sliding window requires per-message timestamp storage — unnecessary complexity for an anti-bot use case where "roughly 30 messages per hour" is the goal, not exact enforcement.

**Progressive limits** (account maturity) are a config value, not algorithmic — no extra library needed. Config field: `hourlyCapBaseline: number`, `hourlyCapMature: number`, `matureAfterDays: number`.

**Persistence across restarts:** Yes — SQLite survives restarts, unlike in-memory counters.

**Prune old rows:** Add `DELETE FROM send_counts WHERE window_start < ?` with 24h retention on init (same pattern as `AnalyticsDb.prune()`).

**Confidence:** HIGH — pattern directly mirrors existing `AnalyticsDb` and `DirectoryDb` implementations.

---

### 3. Claude Code Mimicry Integration (whatsapp-messenger skill routing)

**Recommendation: Wrap `sendWahaText` with a new `sendWithMimicry()` function — no new dependencies**

The existing `sendWahaPresence()` (src/send.ts:176) already calls `/api/startTyping` and `/api/stopTyping`. The typing delay logic is pure `setTimeout` math.

**Integration point:** The `whatsapp-messenger` Claude Code skill calls `sendWahaText` directly via the plugin's action handler in `channel.ts`. Mimicry wrapping should happen at the `send` action dispatch layer.

**Typing delay formula:**
```typescript
function typingDelayMs(text: string): number {
  // Human average: ~200 chars/min = ~3.3 chars/sec
  // Add jitter: +/-20%
  const baseMs = (text.length / 3.3) * 1000;
  const jitter = baseMs * (0.8 + Math.random() * 0.4);
  return Math.min(Math.max(jitter, 500), 8000); // clamp 0.5s to 8s
}
```

**No new library needed.** TheaterJS and similar libraries are browser-only typing animation tools, not server-side delay calculators.

**Config flag to control mimicry:** `humanMimicry.enabled: boolean` per-account. When `false` (default for bot session), sends fire immediately. When `true` (for `omer` session / Claude Code sends), typing indicator + delay is applied.

**Confidence:** HIGH — `sendWahaPresence` already works (confirmed in CLAUDE.md and send.ts).

---

## Recommended Stack (New Additions Only)

### Core Technologies — No New Dependencies

| Capability | Approach | Why |
|------------|----------|-----|
| Timezone check | `Intl.DateTimeFormat` (built-in) | Zero deps, full IANA support, Node 18+ |
| Hourly counter | New SQLite table on existing `better-sqlite3` | Reuses established DB pattern, persists across restarts |
| Typing delay | `setTimeout` + existing `sendWahaPresence()` | Already implemented, just needs orchestration wrapper |
| Progressive limits | Config fields on `WahaAccountSchemaBase` | Zod already present, no new validation library |
| Time gate enforcement | Inline at `sendWahaText` call site | No middleware framework needed |

### Supporting Libraries — No New Additions

| Library | Already Present | Usage |
|---------|----------------|-------|
| `better-sqlite3` ^11.10.0 | YES | Add `send_counts` table alongside `message_events` |
| `zod` ^4.3.6 | YES | Extend `WahaAccountSchemaBase` with mimicry config fields |
| `lru-cache` ^11.2.6 | YES | Cache per-account config lookups if needed |

---

## Installation

```bash
# No new packages needed.
# All capabilities implemented using existing dependencies.
```

---

## Config Schema Additions (Zod)

New fields on `WahaAccountSchemaBase` in `src/config-schema.ts`:

```typescript
humanMimicry: z.object({
  enabled: z.boolean().optional().default(false),
  timezone: z.string().optional().default("UTC"),
  sendWindowStart: z.number().int().min(0).max(23).optional().default(7),   // 7am
  sendWindowEnd: z.number().int().min(0).max(48).optional().default(25),    // 1am next day
  hourlyCapBaseline: z.number().int().positive().optional().default(30),    // new accounts
  hourlyCapMature: z.number().int().positive().optional().default(50),      // mature accounts
  matureAfterDays: z.number().int().positive().optional().default(30),
  typingDelayEnabled: z.boolean().optional().default(false),
}).optional().default({})
```

Config hierarchy: global `humanMimicry` block + per-account override via `accounts[id].humanMimicry`. Resolver merges shallow (per-account wins) — matches existing pattern from `dmFilter`/`groupFilter`.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `Intl.DateTimeFormat` (built-in) | `luxon` ^3.x | Only if project already uses Luxon for other reasons — not this project |
| `Intl.DateTimeFormat` (built-in) | `@js-temporal/polyfill` | When Temporal reaches Stage 4 + Node native support (not yet) |
| Custom SQLite table | `rate-limiter-flexible` | When you need Redis or distributed rate limiting across multiple nodes |
| Custom SQLite table | In-memory counter | Never for this use case — restarts reset the counter |
| `setTimeout` + existing `sendWahaPresence` | Any typing animation library | Never — these are browser-only tools |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `luxon` / `date-fns-tz` / `dayjs` | Zero additional capability over `Intl.DateTimeFormat` for hour-of-day check | `Intl.DateTimeFormat` |
| `@js-temporal/polyfill` | Stage 3 API, polyfill overhead, no production track record in Node.js | `Intl.DateTimeFormat` |
| `rate-limiter-flexible` | Adds a new dependency for 3-line SQLite queries; library's SQLite backend still requires `better-sqlite3` anyway | Direct `better-sqlite3` with custom table |
| `cron` / `node-cron` | No periodic jobs needed — time gates check current time on each send, no background scheduler | Inline `Date.now()` + `Intl` check |
| `p-limit` / `async-mutex` | `better-sqlite3` is synchronous, no async concurrency issue; existing `RateLimiter` covers API-call concurrency | Existing `RateLimiter` class |

---

## Integration Points in Existing Code

| File | Change Needed |
|------|---------------|
| `src/config-schema.ts` | Add `humanMimicry` object to `WahaAccountSchemaBase` |
| `src/send.ts` | Add gate + cap check before `callWahaApi` in `sendWahaText`; call `sendWahaPresence` + delay when `typingDelayEnabled` |
| `src/send-limiter.ts` | New file: `SendLimiterDb` class (hourly counter) + `isWithinSendWindow()` (time gate) |
| `src/monitor.ts` | Admin API endpoint to expose current hourly count + gate status per session |
| `src/admin/` | React UI additions: mimicry config section, hourly cap gauge per session |

---

## Sources

- Node.js `Intl.DateTimeFormat` — [MDN docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat) — HIGH confidence (official spec)
- `better-sqlite3` ^11.10.0 — confirmed in `package.json` — HIGH confidence
- `rate-limiter-flexible` SQLite support — [GitHub wiki](https://github.com/animir/node-rate-limiter-flexible/wiki/SQLite) — MEDIUM (confirmed supported but not used here)
- Temporal API status — [MDN Temporal](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal) — HIGH (Stage 3, polyfill required as of 2026)
- WAHA `/api/startTyping` — `src/send.ts:185` (existing working implementation) — HIGH confidence
- Existing SQLite pattern — `src/analytics.ts`, `src/directory.ts` — HIGH confidence

---
*Stack research for: WAHA OpenClaw Plugin v1.20 Human Mimicry Hardening*
*Researched: 2026-03-26*
