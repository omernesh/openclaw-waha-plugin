# Roadmap: WAHA OpenClaw Plugin

## Milestones

- ✅ **v1.10 Admin Panel & Multi-Session** — Phases 1-11 (shipped 2026-03-16)
- ✅ **v1.11 Polish, Sync & Features** — Phases 12-17 (shipped 2026-03-18)
- ✅ **v1.12 UI Overhaul & Feature Polish** — Phases 18-24 (shipped 2026-03-18)
- ✅ **v1.13 Close All Gaps** — Phases 25-32 (shipped 2026-03-20)
- ✅ **v1.18 Join/Leave/List & Skill Completeness** — Phases 43-47 (shipped 2026-03-25)
- ✅ **v1.19 Full WAHA Capabilities & Modular Skill Architecture** — Phases 48-52 (shipped 2026-03-26)
- 🟡 **v1.20 Human Mimicry Hardening** — Phases 53-57 (active)

## Phases

<details>
<summary>✅ v1.10 Admin Panel & Multi-Session (Phases 1-11) — SHIPPED 2026-03-16</summary>

- [x] Phase 1: Reliability Foundation (3/3 plans) — completed 2026-03-11
- [x] Phase 2: Resilience and Observability (2/2 plans) — completed 2026-03-11
- [x] Phase 3: Feature Gaps (3/3 plans) — completed 2026-03-11
- [x] Phase 4: Multi-Session (4/4 plans) — completed 2026-03-13
- [x] Phase 5: Documentation and Testing (2/2 plans) — completed 2026-03-13
- [x] Phase 6: WhatsApp Rules and Policy System (4/4 plans) — completed 2026-03-13
- [x] Phase 7: Admin Panel Critical Fixes (2/2 plans) — completed 2026-03-15
- [x] Phase 8: Shared UI Components (2/2 plans) — completed 2026-03-16
- [x] Phase 9: Settings UX Improvements (2/2 plans) — completed 2026-03-16
- [x] Phase 10: Directory & Group Enhancements (2/2 plans) — completed 2026-03-16
- [x] Phase 11: Dashboard, Sessions & Log (2/2 plans) — completed 2026-03-16

Full details: `.planning/milestones/v1.10-ROADMAP.md`

</details>

<details>
<summary>✅ v1.11 Polish, Sync & Features (Phases 12-17) — SHIPPED 2026-03-18</summary>

- [x] Phase 12: UI Bug Sprint (5/5 plans) — completed 2026-03-17
- [x] Phase 13: Background Directory Sync (2/2 plans) — completed 2026-03-17
- [x] Phase 14: Name Resolution (2/2 plans) — completed 2026-03-17
- [x] Phase 15: TTL Access (3/3 plans) — completed 2026-03-17
- [x] Phase 16: Pairing Mode and Auto-Reply (3/3 plans) — completed 2026-03-17
- [x] Phase 17: Modules Framework (3/3 plans) — completed 2026-03-17

Audit: `.planning/v1.11-MILESTONE-AUDIT.md`

</details>

<details>
<summary>✅ v1.12 UI Overhaul & Feature Polish (Phases 18-24) — SHIPPED 2026-03-18</summary>

- [x] Phase 18: React Scaffold (2/2 plans) — completed 2026-03-18
- [x] Phase 19: App Layout (2/2 plans) — completed 2026-03-18
- [x] Phase 20: Dashboard and Settings Tabs (2/2 plans) — completed 2026-03-18
- [x] Phase 21: Directory Tab (3/3 plans) — completed 2026-03-18
- [x] Phase 22: Sessions, Modules, Log, and Queue Tabs (2/2 plans) — completed 2026-03-18
- [x] Phase 23: Polish (2/2 plans) — completed 2026-03-18
- [x] Phase 24: Cleanup and Deploy (1/1 plans) — completed 2026-03-18

</details>

<details>
<summary>✅ v1.13 Close All Gaps (Phases 25-32) — SHIPPED 2026-03-20</summary>

- [x] Phase 25: Session Auto-Recovery (2/2 plans) — completed 2026-03-20
- [x] Phase 26: Config Safety (2/2 plans) — completed 2026-03-20
- [x] Phase 27: Pairing Cleanup and Code Quality (2/2 plans) — completed 2026-03-20
- [x] Phase 28: API Coverage Completion (3/3 plans) — completed 2026-03-20
- [x] Phase 29: Real-Time Admin Panel (2/2 plans) — completed 2026-03-20
- [x] Phase 30: Analytics (2/2 plans) — completed 2026-03-20
- [x] Phase 31: Test Coverage Sprint (3/3 plans) — completed 2026-03-20
- [x] Phase 32: Platform Abstraction (3/3 plans) — completed 2026-03-20

</details>

## Standalone Phases

- [x] Phase 36: Timeout & Error Hardening (1/1 plans) — completed 2026-03-25
- [x] Phase 38: Resilience & Health (1/1 plans) — completed 2026-03-25
- [x] Phase 39: Graceful Shutdown & SSE (1/1 plans) — completed 2026-03-25
- [x] Phase 41: Metrics Endpoint (1/1 plans) — completed 2026-03-25
- [x] Phase 42: Full Regression Testing (1/1 plans) — completed 2026-03-25

## v1.18 Join/Leave/List & Skill Completeness — ✅ SHIPPED 2026-03-25 ([archive](.planning/milestones/v1.18-ROADMAP.md))

## v1.19 Full WAHA Capabilities & Modular Skill Architecture — ✅ SHIPPED 2026-03-26 ([archive](.planning/milestones/v1.19-ROADMAP.md))

## v1.20 Human Mimicry Hardening — Active

- [x] **Phase 53: MimicryGate Core** - Config schema + enforcement primitives (mimicry-gate.ts, Zod schemas, SQLite tables) (completed 2026-03-26)
- [ ] **Phase 54: Send Pipeline Enforcement** - Wire gate/cap into send.ts + behavioral polish (jitter, typing, drain throttle)
- [ ] **Phase 55: Claude Code Integration** - Proxy-send endpoint + route whatsapp-messenger skill through mimicry
- [ ] **Phase 56: Adaptive Activity Patterns** - Scan group/contact history to build per-chat activity profiles, store in SQLite, adapt gate timing
- [ ] **Phase 57: Admin UI & Observability** - Dashboard card, settings tab controls, mimicry status API

## Phase Details

### Phase 53: MimicryGate Core
**Goal**: All mimicry enforcement logic exists as a tested, standalone module with no live send paths touched yet
**Depends on**: Nothing (first phase of v1.20)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, GATE-01, GATE-02, GATE-03, GATE-04, CAP-01, CAP-02, CAP-03, CAP-04, CAP-05
**Success Criteria** (what must be TRUE):
  1. `src/mimicry-gate.ts` exists with `checkTimeOfDay`, `checkAndConsumeCap`, `resolveGateConfig`, `resolveCapLimit`, and `getCapStatus` functions that accept an injectable `now` clock parameter
  2. Calling `checkTimeOfDay` with a time outside the configured window returns a "blocked" result without touching any WAHA API
  3. Hourly cap counts are stored per-session in SQLite using a rolling window (not a fixed top-of-hour bucket) and survive a gateway restart
  4. Account maturity phase (New/Warming/Stable) is derived from persisted `first_send_at` in the `account_metadata` SQLite table, not from process uptime
  5. All new Zod schema fields in `config-schema.ts` use `.optional().default()` and existing production configs load without error
**Plans:** 2/2 plans complete
Plans:
- [x] 53-01-PLAN.md — Config schema extension + MimicryDb class + types + config resolution
- [x] 53-02-PLAN.md — Gate enforcement functions (checkTimeOfDay, checkAndConsumeCap, getCapStatus) + TDD tests

### Phase 54: Send Pipeline Enforcement
**Goal**: Every outbound message from the agent passes through time gate and hourly cap checks, with human-like timing variance
**Depends on**: Phase 53
**Requirements**: BEH-01, BEH-02, BEH-03
**Success Criteria** (what must be TRUE):
  1. Sending a message outside the configured window returns an error to the caller instead of reaching WAHA
  2. Sending more messages than the hourly cap in a rolling 60-minute window is rejected after the cap is hit, without resetting at the top of the hour
  3. The `/shutup`, `/join`, and `/leave` commands bypass the gate and cap enforcements via `bypassPolicy` flag
  4. Consecutive sends from the queue have 3-8 second jittered delays between them (drain rate throttling)
  5. Inter-message delays include random variance of +/-30-50% of base delay so timing is not mechanically uniform
**Plans:** 2 plans
Plans:
- [ ] 54-01-PLAN.md — enforceMimicry chokepoint + recordMimicrySuccess (TDD in mimicry-enforcer.ts)
- [ ] 54-02-PLAN.md — Wire enforcement into send.ts + inbound.ts send paths

### Phase 55: Claude Code Integration
**Goal**: Sends from the whatsapp-messenger Claude Code skill are subject to the same time gate, hourly cap, and typing simulation as agent sends
**Depends on**: Phase 53
**Requirements**: CC-01, CC-02
**Success Criteria** (what must be TRUE):
  1. `POST /api/admin/proxy-send` route exists in `monitor.ts` with authentication required
  2. A Claude Code send that would exceed the hourly cap is rejected by the proxy endpoint with a clear error, not forwarded to WAHA
  3. A Claude Code send inside the window and under cap triggers a typing indicator proportional to message length before the message is delivered
  4. The whatsapp-messenger skill routes all sends through the proxy endpoint instead of calling WAHA directly
**Plans**: TBD

### Phase 56: Adaptive Activity Patterns
**Goal**: The system learns per-chat active hours from message history and automatically aligns send gates to observed human activity patterns
**Depends on**: Phase 53
**Requirements**: ADAPT-01, ADAPT-02, ADAPT-03, ADAPT-04, ADAPT-05
**Success Criteria** (what must be TRUE):
  1. A SQLite table (`chat_activity_profiles`) exists storing per-chat busiest hours and days derived from the last 7 days of message history
  2. Activity profile scans run incrementally during off-peak hours without stalling other send operations
  3. When a chat has an activity profile, the time gate uses that chat's peak hours instead of the global/session default window
  4. When no profile exists for a chat, the system falls back to the global or session-level gate configuration without error
  5. Activity profiles are rescanned automatically each week, overwriting stale data
**Plans**: TBD

### Phase 57: Admin UI & Observability
**Goal**: Operators can see the mimicry system's current state and configure send gates and caps from the admin panel
**Depends on**: Phase 54, Phase 55
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. The dashboard shows a "Send Gates" card per session with: maturity phase label, days until next phase upgrade, current hourly cap usage (N/max), and gate open/closed badge
  2. The settings tab has inputs for send window start/end hours, timezone selector (IANA string), hourly cap limit, and the progressive limits table (New/Warming/Stable)
  3. `GET /api/admin/mimicry` returns gate open/closed status, cap usage, and maturity phase for each active session
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 53. MimicryGate Core | 2/2 | Complete    | 2026-03-26 |
| 54. Send Pipeline Enforcement | 0/2 | Planned | - |
| 55. Claude Code Integration | 0/? | Not started | - |
| 56. Adaptive Activity Patterns | 0/? | Not started | - |
| 57. Admin UI & Observability | 0/? | Not started | - |
