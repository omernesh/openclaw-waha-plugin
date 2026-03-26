# Architecture Research

**Domain:** Human Mimicry Hardening — time-of-day send gates, hourly message caps, Claude Code mimicry integration
**Researched:** 2026-03-26
**Confidence:** HIGH (code directly inspected, all integration points verified in source)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OpenClaw Gateway (READ-ONLY)                │
│   handleAction() → plugin.handleAction() → send.ts functions        │
├─────────────────────────────────────────────────────────────────────┤
│                  NEW: MimicryGate (src/mimicry-gate.ts)             │
│  ┌──────────────────┐  ┌───────────────────┐  ┌─────────────────┐  │
│  │  TimeOfDayGate   │  │  HourlyCapTracker │  │  MimicryRouter  │  │
│  │  (gate.check())  │  │  (cap.consume())  │  │  (delay+type)   │  │
│  └────────┬─────────┘  └────────┬──────────┘  └───────┬─────────┘  │
│           │                     │                     │             │
├───────────┴─────────────────────┴─────────────────────┴────────────┤
│                 Existing: send.ts (sendWahaText, sendWahaImage...)  │
│  sendWahaText → [assertCanSend] → [assertPolicyCanSend] → WAHA API  │
├─────────────────────────────────────────────────────────────────────┤
│              Existing: http-client.ts (callWahaApi)                 │
│   [TokenBucket] → [circuit breaker] → [429 backoff] → fetch()      │
├─────────────────────────────────────────────────────────────────────┤
│              Existing: Config Layer (config-schema.ts)              │
│  WahaConfigSchema (global) → accounts.{id} (per-session override)  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|----------------|--------|
| `src/mimicry-gate.ts` | Time-of-day gate + hourly cap enforcement + progression table | NEW |
| `src/send.ts` | All WAHA API calls; mimicry gate inserted here for outbound sends | MODIFIED (light) |
| `src/channel.ts` | Action dispatch; Claude Code sends routed through typing simulation | MODIFIED (light) |
| `src/config-schema.ts` | New Zod fields: `sendGate`, `hourlyCap`, `mimicry` | MODIFIED |
| `src/monitor.ts` | New admin API route: GET /api/admin/mimicry for cap status | MODIFIED |
| `src/admin/` (React) | New UI in DashboardTab/SettingsTab for gate and cap config | MODIFIED |
| `src/presence.ts` | Existing typing simulation — reused by Claude Code path | UNCHANGED |

---

## Recommended Project Structure

```
src/
├── mimicry-gate.ts          # NEW — time gate + hourly cap + cap state tracker
├── send.ts                  # MODIFIED — gate/cap checked before outbound sends
├── channel.ts               # MODIFIED — Claude Code sends routed through presence.ts
├── config-schema.ts         # MODIFIED — new sendGate/hourlyCap Zod schemas
├── presence.ts              # UNCHANGED — reused for Claude Code typing simulation
├── http-client.ts           # UNCHANGED — token bucket stays (different concern)
├── monitor.ts               # MODIFIED — /api/admin/mimicry GET route for cap status
└── admin/src/
    └── components/tabs/
        └── DashboardTab.tsx # MODIFIED — new Mimicry card showing gate + cap state
```

### Structure Rationale

- **`mimicry-gate.ts` is new, standalone:** Keeps time-gate and cap logic isolated from the existing token bucket in `http-client.ts`. The token bucket manages per-second API burst; mimicry-gate manages per-hour human volume. These are different timescales and different concerns — do not merge.
- **Gate check in `send.ts`, not `http-client.ts`:** `callWahaApi` handles ALL WAHA calls including health checks, directory syncs, and group fetches. Caps must only count outbound message sends, not every API call. The right chokepoint is the `sendWahaText` / `sendWahaImage` / `sendWahaVideo` / `sendWahaFile` layer.
- **Claude Code path goes through `channel.ts`:** The whatsapp-messenger skill calls `handleAction()` which dispatches to `send.ts` functions. The `handleAction()` in `channel.ts` is the correct injection point for pre-send typing delay + presence simulation, keeping `send.ts` free of double-simulation.

---

## Architectural Patterns

### Pattern 1: Gate Check as Pre-Send Guard

**What:** `mimicry-gate.ts` exports a single `checkMimicryGate(accountId, chatId, cfg)` function. Call it at the top of `sendWahaText`, `sendWahaImage`, `sendWahaVideo`, `sendWahaFile` — the four outbound message sends that count against the cap. Non-message calls (group info, contacts, presence) skip it.

**When to use:** Any outbound call that creates a visible WhatsApp message.

**Trade-offs:** Minor per-send overhead (single Map lookup + time arithmetic). Negligible at this scale.

**Example:**
```typescript
// src/send.ts — top of sendWahaText(), sendWahaImage(), sendWahaVideo(), sendWahaFile()
import { checkMimicryGate } from "./mimicry-gate.js";

export async function sendWahaText(params: { cfg, to, text, accountId, bypassPolicy, ... }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  // NEW: time gate + hourly cap check (after assertCanSend, before policy check)
  // bypassPolicy also bypasses gate (system commands like /shutup confirmations)
  if (!params.bypassPolicy) {
    checkMimicryGate(client.accountId, chatId, params.cfg); // throws GateError | CapError
  }
  // ... rest of existing logic unchanged
}
```

### Pattern 2: In-Memory Cap Tracker with Hourly Buckets

**What:** `mimicry-gate.ts` tracks sent message counts in a `Map<accountId, HourlyWindow>` where `HourlyWindow = { hour: number, count: number }`. On each send, if `Date.now()` is in a new hour, reset count. Compare against configured `hourlyCap.limit`.

**When to use:** Hourly message cap enforcement.

**Trade-offs:** In-memory only — resets on gateway restart. Acceptable: gateway restart is a rare ops action, not a normal event. Persisting to SQLite adds complexity without meaningful benefit (cap is a rate limiter, not an audit log). If you need historical outbound counts, `analytics.ts` already stores `message_events` with `direction='outbound'`.

**Example:**
```typescript
// src/mimicry-gate.ts
interface HourlyWindow { hour: number; count: number; }
const capWindows = new Map<string, HourlyWindow>();

function currentHour(): number { return Math.floor(Date.now() / 3_600_000); }

export function checkAndConsumeCap(accountId: string, cfg: CoreConfig): void {
  const limit = resolveCapLimit(accountId, cfg); // global → per-session merge
  if (!limit) return; // cap disabled
  const h = currentHour();
  const win = capWindows.get(accountId) ?? { hour: h, count: 0 };
  if (win.hour !== h) { win.hour = h; win.count = 0; }
  if (win.count >= limit) throw new CapError(`Hourly cap reached (${win.count}/${limit})`);
  win.count++;
  capWindows.set(accountId, win);
}
```

### Pattern 3: Config Hierarchy — Global → Per-Session Merge

**What:** Mirrors the existing pattern in `config-schema.ts` where `WahaConfigSchema` has top-level fields that per-account entries can override. New `sendGate` and `hourlyCap` objects follow the same pattern: top-level defaults, `accounts.{id}` can override. `resolveGateConfig(accountId, cfg)` merges: per-session value takes priority over global, global is the fallback.

**When to use:** All gate and cap resolution in `mimicry-gate.ts`.

**Trade-offs:** No per-contact/group overrides in v1.20. The `DirectoryDb.dm_settings` table has a natural place for per-contact cap settings in a future phase — leave that door open by keeping `resolveCapLimit` as a function (not inline logic), so the signature can later accept `chatId`.

**Example config schema addition (`config-schema.ts`):**
```typescript
const SendGateSchema = z.object({
  enabled: z.boolean().optional().default(true),
  startHour: z.number().int().min(0).max(23).optional().default(7),   // 7am
  endHour: z.number().int().min(0).max(23).optional().default(1),     // 1am (next day)
  timezone: z.string().optional().default("Asia/Jerusalem"),
  onBlock: z.enum(["reject", "queue"]).optional().default("reject"),
}).optional();

const HourlyCapSchema = z.object({
  enabled: z.boolean().optional().default(true),
  limit: z.number().int().positive().optional().default(40),
  progressiveLimits: z.array(
    z.object({
      daysOld: z.number().int().min(0),
      limit: z.number().int().positive()
    })
  ).optional(), // [{daysOld:0, limit:15}, {daysOld:30, limit:30}, {daysOld:90, limit:50}]
}).optional();
```

Add both to `WahaAccountSchemaBase`: `sendGate: SendGateSchema`, `hourlyCap: HourlyCapSchema`.

### Pattern 4: Claude Code Mimicry Integration Point

**What:** The whatsapp-messenger skill calls `handleAction("send", { target, params })` in `channel.ts`. `handleAction` currently dispatches directly to `sendWahaText`. To route through typing delay, inject a presence simulation step before the WAHA send.

**Key insight:** The existing `startHumanPresence()` in `presence.ts` is designed for inbound replies (it takes `incomingText` to calibrate read delay). For Claude Code outbound sends (no incoming message), use a simplified path: `sendWahaPresence(typing: true)` → sleep(calcTypingDuration) → `sendWahaPresence(typing: false)` → send. The `calcTypingDuration` helper is private to `presence.ts` — either export it or duplicate the simple formula in `mimicry-gate.ts`.

**Where exactly:** In `channel.ts` → `handleAction()`, when action is `send` (or any message-creating action), check if the session has `mimicry.simulateTyping` enabled. If yes, run typing simulation before dispatching to `send.ts`. This is exclusively the external tool call path — bot replies go through `inbound.ts` → `startHumanPresence()` and never touch `handleAction()`.

**Example:**
```typescript
// src/channel.ts — inside handleAction(), before send dispatch
if (action === "send" && shouldSimulateTyping(resolvedAccountId, cfg)) {
  const chatId = resolveTarget(...);
  const text = params.text ?? "";
  await simulateOutboundTyping({ cfg, chatId, text, accountId: resolvedAccountId });
}
// then dispatch to sendWahaText as before
```

```typescript
// src/mimicry-gate.ts — new exported helper
export async function simulateOutboundTyping(params: {
  cfg: CoreConfig; chatId: string; text: string; accountId?: string;
}): Promise<void> {
  const presenceCfg = resolvePresenceConfig(params.cfg);
  if (!presenceCfg.enabled) return;
  await sendWahaPresence({ ...params, typing: true }).catch(warnOnError("mimicry typing-start"));
  const charsPerSecond = (presenceCfg.wpm * 5) / 60;
  const baseMs = (params.text.length / charsPerSecond) * 1000;
  const jitter = presenceCfg.jitter;
  const jittered = baseMs * (jitter[0] + Math.random() * (jitter[1] - jitter[0]));
  const duration = Math.min(Math.max(jittered, presenceCfg.typingDurationMs[0]), presenceCfg.typingDurationMs[1]);
  await sleep(duration);
  await sendWahaPresence({ ...params, typing: false }).catch(warnOnError("mimicry typing-stop"));
}
```

---

## Data Flow

### Outbound Send Flow (v1.20)

```
handleAction("send", params)              [channel.ts]
    |
    v
shouldSimulateTyping(accountId, cfg)?
    | YES
    v
simulateOutboundTyping()                  [mimicry-gate.ts]
  --> sendWahaPresence(typing=true)
  --> sleep(calcTypingDuration(text))
  --> sendWahaPresence(typing=false)
    |
    v
sendWahaText(params)                      [send.ts]
    |
    v
checkMimicryGate(accountId, cfg)          [mimicry-gate.ts]
  --> checkTimeOfDay(accountId, cfg)      -- throws GateError if outside hours
  --> checkAndConsumeCap(accountId, cfg)  -- throws CapError if over limit
    |
    v
assertCanSend()                           [existing -- unchanged]
assertPolicyCanSend()                     [existing -- unchanged]
    |
    v
callWahaApi()                             [http-client.ts -- unchanged]
  --> TokenBucket.acquire()
  --> fetch()
```

### Inbound Bot Reply Flow (UNCHANGED — for contrast)

```
handleWahaInbound()                       [inbound.ts]
    |
    v
startHumanPresence()                      [presence.ts]
  --> sendSeen + readDelay + typing flicker
    |
    v
deliverWahaReply()                        [inbound.ts]
    |
    v
sendWahaText() / sendWahaMediaBatch()     [send.ts]
  --> checkMimicryGate()                  -- ALSO applies here (bot replies count too)
  --> callWahaApi()
```

Note: bot inbound replies will also be counted against the hourly cap via the `send.ts` gate check. This is intentional — the cap limits all outbound messages from the session, regardless of trigger source.

### Config Resolution Flow

```
resolveGateConfig(accountId, cfg):
  accounts[accountId].sendGate        (per-session, highest priority)
    | fallback
  cfg.channels.waha.sendGate          (global)
    | fallback
  DEFAULTS                            (enabled=true, 7am-1am, reject)

resolveCapLimit(accountId, cfg):
  accounts[accountId].hourlyCap.limit (per-session)
    | fallback
  cfg.channels.waha.hourlyCap.limit   (global)
    | fallback + progression check
  progressiveLimits[accountAge].limit (if progressive table set)
```

### Admin Panel Data Flow (new routes)

```
GET /api/admin/mimicry
  Response: [{ accountId, session,
               gate: { enabled, startHour, endHour, timezone, currentlyOpen },
               cap:  { enabled, limit, usedThisHour, resetsAt } }]

SSE stream (existing /api/admin/events) -- optional: push cap_consumed events
```

---

## Integration Points

### New vs Modified — Explicit Breakdown

| File | Change Type | What Changes |
|------|-------------|-------------|
| `src/mimicry-gate.ts` | **NEW** | Time gate + cap tracker + config resolution + `simulateOutboundTyping` + `getCapStatus` |
| `src/config-schema.ts` | **MODIFIED** | Add `sendGate` and `hourlyCap` Zod schemas to `WahaAccountSchemaBase` |
| `src/send.ts` | **MODIFIED** | Add `checkMimicryGate()` call at top of 4 send functions; respect existing `bypassPolicy` flag |
| `src/channel.ts` | **MODIFIED** | Add typing simulation for tool-call `send` action; guard with `shouldSimulateTyping()` |
| `src/monitor.ts` | **MODIFIED** | Add `GET /api/admin/mimicry` route returning gate+cap status per session |
| `src/admin/src/components/tabs/DashboardTab.tsx` | **MODIFIED** | New "Send Gates" card: gate open/closed badge + cap progress bar |
| `src/admin/src/components/tabs/SettingsTab.tsx` | **MODIFIED** | New sendGate/hourlyCap config section (enable toggle, hours inputs, cap limit) |
| `src/admin/src/types.ts` | **MODIFIED** | Add `SendGateStatus`, `HourlyCapStatus` types |
| `src/presence.ts` | **UNCHANGED** | Reused via `simulateOutboundTyping` calling `sendWahaPresence` + `sleep` |
| `src/http-client.ts` | **UNCHANGED** | Token bucket stays; different concern (burst vs hourly) |
| `src/directory.ts` | **UNCHANGED** | No per-contact cap in v1.20; `dm_settings` available for Phase 2 |
| `src/analytics.ts` | **UNCHANGED** | Existing outbound event tracking covers cap audit if needed |
| `src/inbound.ts` | **UNCHANGED** | Bot reply path unchanged; gate applies via `send.ts` layer automatically |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `channel.ts` → `mimicry-gate.ts` | Direct import — `simulateOutboundTyping()` | Before `sendWahaText` dispatch in `handleAction()` |
| `send.ts` → `mimicry-gate.ts` | Direct import — `checkMimicryGate()` | At start of 4 send functions |
| `mimicry-gate.ts` → `send.ts` | Direct import — `sendWahaPresence()` | For typing start/stop in `simulateOutboundTyping` |
| `mimicry-gate.ts` → `http-client.ts` | Direct import — `sleep()` | For typing delay in `simulateOutboundTyping` |
| `monitor.ts` → `mimicry-gate.ts` | Direct import — `getCapStatus()` | For admin API route |
| `config-schema.ts` | Extended in place | Schema is source of truth; no circular dep added |

---

## Build Order

Dependencies flow: schema → enforcement → UI. Phases 2 and 3 are independent and can build in parallel.

**Phase 1 — Config Schema + MimicryGate core** (no external deps)
- Add `sendGate` + `hourlyCap` Zod schemas to `config-schema.ts`
- Write `src/mimicry-gate.ts`: `checkTimeOfDay`, `checkAndConsumeCap`, `resolveGateConfig`, `resolveCapLimit`, `getCapStatus`
- Unit tests for gate + cap logic
- Gate: `vitest` passes, config validates without error

**Phase 2 — Wire gate/cap into send.ts** (depends on Phase 1)
- Add `checkMimicryGate()` call to `sendWahaText`, `sendWahaImage`, `sendWahaVideo`, `sendWahaFile`
- Respect `bypassPolicy` flag — gate skipped when `bypassPolicy: true`
- Integration test: send outside hours throws `GateError`, exceed cap throws `CapError`
- Gate: deploy + live test, confirm messages blocked correctly, `/shutup` confirm still works

**Phase 3 — Claude Code mimicry integration** (depends on Phase 1, parallel with Phase 2)
- Add `simulateOutboundTyping()` to `mimicry-gate.ts`
- Wire into `channel.ts` `handleAction()` for `send` action
- Gate: live test via whatsapp-messenger skill — typing indicator appears in WhatsApp before message

**Phase 4 — Admin UI + API route** (depends on Phases 1-3)
- Add `GET /api/admin/mimicry` to `monitor.ts`
- DashboardTab: new "Send Gates" card with gate status badge + hourly cap progress bar
- SettingsTab: sendGate hours pickers + hourlyCap limit input + progressive limits table
- Gate: Playwright test

### Critical Dependency Notes

- `bypassPolicy` is the existing escape hatch — all gate/cap enforcement MUST check it. System commands (`/shutup`, `/join`, `/leave`) pass `bypassPolicy: true` and must continue to bypass the gate.
- Bot inbound replies go through `send.ts` and WILL be counted against the hourly cap. This is intentional — the cap is a per-session outbound rate, regardless of trigger source. If this needs to be optional, add a separate `skipMimicryGate` boolean to `sendWahaText` params.
- The `resolvePresenceConfig()` function in `presence.ts` is unexported. Either export it (preferred) or duplicate the config resolution in `mimicry-gate.ts`.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 sessions | In-memory cap tracker per accountId — no changes needed |
| 10+ sessions (SaaS) | Move cap state to SQLite `mimicry_caps` table, same pattern as `analytics.ts` |
| High-volume | Progressive limits table in config handles account maturity automatically |

The in-memory approach is correct for the current single-node hpg6 deployment. The `Map<accountId, ...>` keying already supports multiple sessions.

---

## Anti-Patterns

### Anti-Pattern 1: Gate Check in `callWahaApi`

**What people do:** Put the gate/cap check in `http-client.ts` since all WAHA calls go through it.

**Why it's wrong:** `callWahaApi` is called for health checks, group syncs, presence updates, contact fetches — none of which are message sends. The hourly cap would count every API call, not just user-visible messages. At 15 tokens/sec (token bucket default), the cap would be exhausted in seconds.

**Do this instead:** Check at the `sendWahaText` / `sendWahaImage` / `sendWahaVideo` / `sendWahaFile` layer in `send.ts`. These four functions are the only ones that create visible WhatsApp messages.

### Anti-Pattern 2: Double-Simulate Typing for Bot Replies

**What people do:** Add `simulateOutboundTyping()` to `sendWahaText` unconditionally.

**Why it's wrong:** Inbound bot replies already go through `startHumanPresence()` in `inbound.ts` which runs a full read delay + typing flicker. Calling it again in `send.ts` would stack two typing simulations, causing the bot to show typing for 2x the expected duration.

**Do this instead:** `simulateOutboundTyping()` is only called from `channel.ts` `handleAction()` — the code path exclusive to external tool calls (Claude Code / skill invocations). The `send.ts` gate check has no typing simulation, only the gate/cap enforcement.

### Anti-Pattern 3: Persist Cap State to SQLite on Every Send

**What people do:** Write cap counters to `analytics.ts` or a new `mimicry_caps` table for persistence across restarts.

**Why it's wrong:** Gateway restarts are rare and intentional (deploy cycle). Writing to SQLite on every outbound message adds I/O overhead with no practical benefit. The `analytics.ts` already stores `message_events` with `direction='outbound'` — if you need post-restart cap reconstruction, that data is there.

**Do this instead:** In-memory `Map<accountId, HourlyWindow>`. Cap resets on restart are acceptable behavior.

### Anti-Pattern 4: Timezone Handling with `Date.getHours()`

**What people do:** Use `new Date().getHours()` for time-of-day gate.

**Why it's wrong:** Returns server local time. hpg6 is UTC+3, but if server timezone changes or user wants a different timezone in config, the gate breaks silently.

**Do this instead:** Use `Intl.DateTimeFormat` with configurable timezone from `sendGate.timezone` (default `"Asia/Jerusalem"`):

```typescript
function getHourInTimezone(tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric", hour12: false, timeZone: tz
  }).formatToParts(new Date());
  return parseInt(parts.find(p => p.type === "hour")!.value, 10);
}
```

Pure JS, no library needed, handles DST correctly.

---

## Sources

- Direct code inspection: `src/send.ts`, `src/channel.ts`, `src/http-client.ts`, `src/config-schema.ts`, `src/presence.ts`, `src/rate-limiter.ts`, `src/analytics.ts`, `src/inbound.ts`
- `.planning/PROJECT.md` — v1.20 requirements and existing architecture decisions table
- `CLAUDE.md` — critical rules, deploy constraints, send.ts DO NOT CHANGE markers

---
*Architecture research for: WAHA OpenClaw Plugin v1.20 Human Mimicry Hardening*
*Researched: 2026-03-26*
