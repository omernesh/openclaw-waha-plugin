# Project Research Summary

**Project:** WAHA OpenClaw Plugin v1.20 Human Mimicry Hardening
**Domain:** WhatsApp anti-bot detection — time gates, hourly caps, typing delay, Claude Code integration
**Researched:** 2026-03-26
**Confidence:** HIGH (stack and architecture verified against live codebase; features MEDIUM due to undocumented Meta detection signals)

## Executive Summary

v1.20 adds human behavioral simulation to a mature WhatsApp plugin to reduce Meta ban risk. The core risk being addressed is automated sending patterns: nighttime messages, burst volume, and uniform inter-message timing are the three primary signals that trigger WhatsApp account reviews. The recommended approach is additive: a new `src/mimicry-gate.ts` module provides time-of-day gating and hourly cap enforcement, wired into the existing `send.ts` send functions and `channel.ts` action dispatch. No new dependencies are required — the entire feature set is implementable using Node.js built-ins (`Intl.DateTimeFormat`, `setTimeout`) and the existing `better-sqlite3` infrastructure already in the codebase.

The most significant architectural constraint is that the `whatsapp-messenger` Claude Code skill currently calls the WAHA API directly, bypassing all plugin-level rate limiting. Without routing these calls through the plugin's mimicry system, the hourly cap is meaningless for the primary send path. The integration point is a new `POST /api/admin/proxy-send` route in `monitor.ts` — the skill must be updated to call this instead of WAHA directly. This is the highest-risk integration in the milestone and must be treated as a dedicated phase.

The second structural concern is state persistence. Account maturity tracking (progressive caps by account age) and hourly message counts must survive gateway restarts. In-memory counters are insufficient. The rolling window hourly count must be stored in SQLite per-timestamp rows, and `first_send_at` per session must be persisted in a new `account_metadata` table. The existing `AnalyticsDb` and `DirectoryDb` patterns make this straightforward to implement correctly.

## Key Findings

### Recommended Stack

All capabilities are implementable with zero new dependencies. The existing `better-sqlite3` (^11.10.0) covers the hourly counter and maturity state tables following the established `AnalyticsDb` pattern. `Intl.DateTimeFormat` (Node.js built-in) handles timezone-aware time-of-day checks with full IANA string support. Typing delay uses `setTimeout` math against the already-working `sendWahaPresence()` at `send.ts:176`. Config schema is extended using the existing Zod infrastructure in `config-schema.ts`.

**Core technologies:**
- `Intl.DateTimeFormat` (built-in) — timezone-aware hour check — zero deps, DST-correct, Node 18+
- `better-sqlite3` ^11.10.0 (existing) — hourly counter + maturity state — follows `AnalyticsDb` pattern exactly
- `sendWahaPresence()` in `send.ts:176` (existing) — outbound typing simulation — already implemented and working
- `zod` ^4.3.6 (existing) — new `sendGate` and `hourlyCap` schema blocks — every new field must use `.optional().default()`
- `setTimeout` (built-in) — typing delay jitter — no library needed

**What NOT to use:** `luxon`, `date-fns-tz`, `@js-temporal/polyfill`, `rate-limiter-flexible`, `node-cron`. All add dependencies for functionality the codebase already covers.

### Expected Features

**Must have (P1 — v1.20 launch):**
- Time-of-day send gate with configurable window (default 7am-1am local) — direct ban risk, highest priority
- Hourly message cap per session (hard limit, default 30 new / 50 stable) — burst is the #1 ban signal
- Account maturity phase tracker (New/Warming/Stable derived from `first_send_at`) — new accounts under heightened surveillance
- Progressive default caps tied to maturity phase — week-1 limits are stricter than stable-account limits
- Config hierarchy: global `sendGate`/`hourlyCap` with per-session override — matches existing `dmFilter`/`groupFilter` pattern
- Claude Code sends routed through mimicry proxy — currently 100% unprotected; bypass makes cap meaningless
- Quiet hours policy: reject (default) or queue — reject-not-queue is the safer default (avoids message loss on restart)
- Jittered inter-message delays — uniform timing is statistically detectable

**Should have (P2 — after validation):**
- Typing delay proportional to message length (extend existing formula in `presence.ts`)
- Admin panel maturity phase dashboard card (phase, days until upgrade, cap usage)
- Drain rate throttling: 3-8s jittered delay between consecutive queue drain sends
- Per-contact `rateLimitExempt` flag in directory settings

**Defer (v2+):**
- Active-hours soft preference queue (hold for next engagement peak, not just any open hour)
- Send-time distribution analytics chart (hourly histogram)
- Automatic phase promotion based on read receipt engagement signals
- Cross-session aggregate cap

### Architecture Approach

The architecture is a pre-send guard pattern: a new standalone `src/mimicry-gate.ts` module is inserted into the send pipeline at the `sendWahaText`/`sendWahaImage`/`sendWahaVideo`/`sendWahaFile` layer in `send.ts` — NOT in `callWahaApi` (which handles health checks and API reads, not just message sends). Typing simulation for tool-call sends is injected at the `handleAction()` dispatch layer in `channel.ts`, keeping double-simulation away from the inbound bot reply path (which already goes through `startHumanPresence()` in `presence.ts`). The Claude Code integration path is a new HTTP proxy route in `monitor.ts` that enforces all mimicry logic before forwarding to WAHA.

**Major components:**
1. `src/mimicry-gate.ts` (NEW) — time gate check, hourly cap tracker, config resolution, `simulateOutboundTyping`, `getCapStatus`
2. `src/send.ts` (MODIFIED) — `checkMimicryGate()` call at top of 4 send functions; respects existing `bypassPolicy` flag
3. `src/channel.ts` (MODIFIED) — typing simulation for tool-call `send` action via `simulateOutboundTyping()`
4. `src/monitor.ts` (MODIFIED) — `POST /api/admin/proxy-send` (Claude Code entry point) + `GET /api/admin/mimicry` (status API)
5. `src/config-schema.ts` (MODIFIED) — `SendGateSchema` + `HourlyCapSchema` Zod objects added to `WahaAccountSchemaBase`
6. `src/admin/` React panel (MODIFIED) — new "Send Gates" card in DashboardTab + sendGate/hourlyCap config in SettingsTab

**Build order:** Phase 1 (config schema + mimicry-gate core) is the hard dependency for all others. Phase 2 (wire into send.ts) and Phase 3 (Claude Code proxy) can run in parallel after Phase 1. Phase 4 (admin UI) is always last.

### Critical Pitfalls

1. **Hourly cap placed inside token bucket acquire() hangs the drainer** — check hourly cap BEFORE calling `acquire()`; throw synchronously, never await; the token bucket queue is for per-second burst shaping, not hourly count gating
2. **Claude Code skill bypasses plugin entirely** — the skill calls WAHA API directly via HTTP; plugin-level caps do nothing; must add `POST /api/admin/proxy-send` to `monitor.ts` with auth check and update the skill to call it
3. **Timezone bug: `new Date().getHours()` returns UTC on hpg6** — use `Intl.DateTimeFormat` with configured IANA timezone; handle cross-midnight windows with `currentHour >= startHour || currentHour < endHour` logic
4. **In-memory hourly counter resets on restart; top-of-hour bucket allows 2x burst** — store per-message timestamps in SQLite rolling window; count `WHERE sent_at > (now - 3_600_000)`; never use a single counter that resets at :00
5. **Config schema breaks existing configs on deploy** — every new field must use `.optional().default(value)`; add new field names to `knownKeys` set in `validateWahaConfig`; test against production `openclaw.json` before deploying
6. **Progressive limits maturity state not persisted across restarts** — store `first_send_at` per session in SQLite `account_metadata` table; never compute maturity from plugin startup time
7. **Cap keyed by `accountId` instead of WAHA session name** — Logan (bot) and Omer (Claude Code) sends must share the same hourly cap bucket; key by WAHA session name, not plugin `accountId`

## Implications for Roadmap

Based on research, the architecture's build order and pitfall prevention requirements map cleanly to 4 phases. Phase 3 (Claude Code integration) is the highest ban-risk gap and should be prioritized alongside Phase 2.

### Phase 1: Config Schema + MimicryGate Core
**Rationale:** All subsequent phases require `SendGateSchema`, `HourlyCapSchema`, and the core enforcement functions. Building this standalone first means unit tests validate gate logic before it touches live send paths. No live deploy needed at this phase — pure logic + schema changes.
**Delivers:** `src/mimicry-gate.ts` with `checkTimeOfDay`, `checkAndConsumeCap`, `resolveGateConfig`, `resolveCapLimit`, `getCapStatus`; new Zod schemas in `config-schema.ts`; SQLite rolling window table + `account_metadata` table; unit tests with injectable `now` clock
**Addresses:** Time-of-day gate, hourly cap, progressive limits (maturity phases), config hierarchy
**Avoids:** Config schema breakage (`.optional().default()` on every new field); timezone UTC bug (`Intl.DateTimeFormat`); hourly reset exploit (rolling window in SQLite); maturity state loss (SQLite `account_metadata` table); testability gap (injectable `now` parameter on all gate functions)

### Phase 2: Wire Gate/Cap into send.ts
**Rationale:** Once `mimicry-gate.ts` exists and is tested, wiring it into the 4 send functions is a focused, low-risk change. The existing `bypassPolicy` flag preserves system commands (`/shutup`, `/join`, `/leave`). This phase makes the cap real for all agent-side sends.
**Delivers:** `checkMimicryGate()` at top of `sendWahaText`, `sendWahaImage`, `sendWahaVideo`, `sendWahaFile`; integration test confirming blocked sends outside window and over cap; live deploy test confirming `/shutup` confirm still passes through unblocked
**Uses:** Phase 1 `mimicry-gate.ts`; existing `bypassPolicy` flag in `send.ts`
**Avoids:** Token bucket interaction bug (cap check before `acquire()`); double-simulation for bot replies (gate in `send.ts` only — no typing sim here, typing sim stays in `channel.ts`)

### Phase 3: Claude Code Mimicry Integration (proxy-send endpoint)
**Rationale:** Without this phase, the hourly cap is enforced for agent sends but not for Claude Code sends — the primary ban risk path is still unprotected. This is the most impactful phase for actual ban prevention. Runs in parallel with Phase 2 since both depend only on Phase 1.
**Delivers:** `POST /api/admin/proxy-send` route in `monitor.ts` with `requireAuth` middleware, gate enforcement, cap enforcement, typing simulation, then WAHA forward; updated `whatsapp-messenger` skill pointing to this endpoint instead of WAHA directly; typing simulation in `channel.ts` `handleAction()` for `send` action
**Uses:** Phase 1 `mimicry-gate.ts`; existing `requireAuth` middleware in `monitor.ts`; existing `sendWahaPresence()` in `send.ts:176`
**Avoids:** Claude Code bypass (cap is meaningful for all sends including skill sends); per-session vs per-account cap confusion (proxy uses WAHA session name as cap key); unauthenticated proxy endpoint (existing `requireAuth` applied)

### Phase 4: Admin UI + Status API
**Rationale:** Gate and cap enforcement should be observable before calling the milestone complete. Admins need to see what phase the account is in, whether the gate is currently open, and how close the cap is to its limit. This phase adds no enforcement logic — purely observability and configuration surface.
**Delivers:** `GET /api/admin/mimicry` status endpoint (gate open/closed per session, cap usage, maturity phase); DashboardTab "Send Gates" card with gate status badge and cap progress bar with reset ETA; SettingsTab sendGate hours pickers, timezone selector, hourlyCap limit input, progressive limits table; Playwright tests for all new UI
**Implements:** Admin panel components using existing shadcn/ui + Tailwind patterns; Mimicry status API
**Avoids:** UX pitfalls: cap shows count with no reset ETA; gate rejects with no retry-after info; maturity phase changes silently

### Phase Ordering Rationale

- Phase 1 is the only hard dependency — it establishes the schema and all enforcement primitives
- Phases 2 and 3 are independent after Phase 1; Phase 3 should be prioritized (directly addresses the Claude Code bypass gap which is the highest ban risk)
- Phase 4 is always last — observability layer added after enforcement is proven and stable
- Reject-not-queue chosen as default policy: eliminates message loss on restart and avoids SQLite queue complexity for v1.20
- Rolling window hourly counter (SQLite per-timestamp rows) chosen over fixed bucket: prevents the 2x burst exploit at hour boundaries that naive implementations allow

### Research Flags

Phases needing careful implementation review:
- **Phase 3 (Claude Code proxy):** Verify exact call sites in `whatsapp-messenger` skill before implementation — confirm the skill calls WAHA directly and identify all curl endpoint calls to replace. Also confirm `requireAuth` middleware signature in `monitor.ts` before wiring the new route.
- **Phase 1 (rolling window query):** Confirm SQLite rolling window query performance for `COUNT(*) WHERE sent_at > ?` against the `AnalyticsDb` table pattern. Should be negligible at 30-50 msg/hr but worth verifying against existing `message_events` table structure.

Phases with standard patterns (no additional research needed):
- **Phase 2 (send.ts wiring):** Pattern is identical to existing `assertCanSend`/`assertPolicyCanSend` checks already in `send.ts`. Direct implementation.
- **Phase 4 (admin UI):** shadcn/ui components and React patterns are established from v1.12 panel rewrite. Standard badge + progress bar components.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All integration points verified in live codebase (`send.ts:176`, `analytics.ts`, `config-schema.ts`). Zero new dependencies confirmed viable. |
| Features | MEDIUM | WhatsApp detection signals are undocumented by Meta. Synthesized from WAHA community ban reports and warmup tool documentation. Core features (time gate, hourly cap) are consensus-validated across multiple sources. |
| Architecture | HIGH | All files inspected directly. Integration points (`sendWahaText`, `handleAction`, `monitor.ts` HTTP server, `bypassPolicy` flag) confirmed. Build order validated against existing dependency graph. |
| Pitfalls | HIGH | All 9 pitfalls derived from direct codebase analysis (token bucket drain loop, Zod strict schema, `bypassPolicy` flag, `callWahaApi` scope). Not speculative — each references specific code locations. |

**Overall confidence:** HIGH for implementation approach; MEDIUM for feature effectiveness (cannot verify Meta's internal detection thresholds from outside)

### Gaps to Address

- **Claude Code skill architecture:** Research assumed the skill calls WAHA directly via HTTP. Confirm exact call sites in `whatsapp-messenger` skill before Phase 3 implementation to ensure the proxy endpoint covers all send paths.
- **Quiet hours queue policy:** Research recommends "reject" as default (safer, no message loss risk on restart). If deferred delivery is required, a SQLite `send_queue` table would be needed — this is out of scope for v1.20. Decide explicitly before Phase 1 config schema is locked so `onBlock: "queue" | "reject"` enum is correct from the start.
- **Bot reply counting against cap:** Architecture research confirms inbound bot replies will decrement the hourly cap (they go through `send.ts`). Verify this is intended behavior before Phase 2. If bot replies should be exempt, a `skipMimicryGate` boolean needs to be added to `sendWahaText` params in the Phase 1 schema design.

## Sources

### Primary (HIGH confidence)
- `src/send.ts` — `sendWahaText`, `sendWahaPresence`, outbound send entry points, `bypassPolicy` flag
- `src/http-client.ts` — `TokenBucket` drain loop structure, `MutationDedup` TTL
- `src/config-schema.ts` — `WahaAccountSchemaBase`, `.strict()`, `validateWahaConfig`, `knownKeys` set
- `src/analytics.ts` — SQLite pattern for timestamped event rows and prune strategy
- `src/presence.ts` — existing typing simulation, `startHumanPresence` design and scope
- Node.js `Intl.DateTimeFormat` — MDN official spec — IANA timezone support in Node 18+
- `.planning/PROJECT.md` — v1.20 requirements, multi-session architecture

### Secondary (MEDIUM confidence)
- [WAHA GitHub Issue #1362](https://github.com/devlikeapro/waha/issues/1362) — NOWEB ban signals from community reports
- [WAHA GitHub Issue #765](https://github.com/devlikeapro/waha/issues/765) — group send ban patterns
- [WAWarmer warmup docs](https://warmer.wadesk.io/blog/whatsapp-account-warm-up) — maturity phase progression and cap recommendations
- Meta WhatsApp Cloud API typing indicators (official docs) — typing indicator behavior and max duration

### Tertiary (LOW confidence)
- [tisankan.dev automation unbanned guide](https://tisankan.dev/whatsapp-automation-how-do-you-stay-unbanned/) — behavioral signal list (unverified against Meta internals)
- [a2c.chat bulk send timing](https://www.a2c.chat/en/whatsapp-bulk-sending-time-5-best-time-slots-tested.html) — send window recommendations (community data, not Meta-confirmed)

---
*Research completed: 2026-03-26*
*Ready for roadmap: yes*
