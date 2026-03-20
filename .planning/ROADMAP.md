# Roadmap: WAHA OpenClaw Plugin

## Milestones

- ✅ **v1.10 Admin Panel & Multi-Session** — Phases 1-11 (shipped 2026-03-16)
- ✅ **v1.11 Polish, Sync & Features** — Phases 12-17 (shipped 2026-03-18)
- ✅ **v1.12 UI Overhaul & Feature Polish** — Phases 18-24 (shipped 2026-03-18)
- 🚧 **v1.13 Close All Gaps** — Phases 25-32 (in progress)

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

### v1.13 Close All Gaps (Phases 25-32)

**Milestone Goal:** Close every remaining operational, API coverage, test coverage, and code quality gap. Ship session auto-recovery, config safety, pairing cleanup, full WAHA API coverage, real-time admin panel, analytics, comprehensive test coverage, and platform abstraction groundwork.

- [x] **Phase 25: Session Auto-Recovery** — Auto-restart unhealthy sessions, cooldown, alerting (REC-01 through REC-04) (completed 2026-03-20)
- [x] **Phase 26: Config Safety** — Zod validation, structured errors, backup/rotate, export/import (CFG-01 through CFG-05) (completed 2026-03-20)
- [x] **Phase 27: Pairing Cleanup and Code Quality** — Dead code removal, bot echo fix, deploy guard, and 5 CQ fixes (PAIR-01 through PAIR-03, CQ-01 through CQ-05) (completed 2026-03-20)
- [x] **Phase 28: API Coverage Completion** — Channel search, bulk presence, group join-info/refresh/events, API keys, presence verification (API-01 through API-07, PRES-01, PRES-02) (completed 2026-03-20)
- [x] **Phase 29: Real-Time Admin Panel** — SSE endpoint, live dashboard, log auto-scroll, connection indicator (RT-01 through RT-04) (completed 2026-03-20)
- [x] **Phase 30: Analytics** — SQLite events table, analytics API, Analytics tab with charts (ANL-01 through ANL-03) (completed 2026-03-20)
- [x] **Phase 31: Test Coverage Sprint** — monitor.ts, inbound.ts, directory.ts, shutup.ts, React component tests (TST-01 through TST-05) (completed 2026-03-20)
- [x] **Phase 32: Platform Abstraction** — WahaClient extraction, adapter interface, multi-tenant groundwork (PLAT-01 through PLAT-03) (completed 2026-03-20)

## Phase Details

### Phase 25: Session Auto-Recovery
**Goal**: Unhealthy sessions recover automatically without operator intervention, with cooldown to prevent restart storms and visible recovery history in the admin panel.
**Depends on**: Nothing (first phase of milestone)
**Requirements**: REC-01, REC-02, REC-03, REC-04
**Success Criteria** (what must be TRUE):
  1. After 5 consecutive health check failures, WAHA session restart is attempted automatically — operator does not need to manually trigger recovery
  2. A second restart attempt cannot fire within 5 minutes of the previous one — a second failure within the cooldown window is logged but no restart is triggered
  3. The Dashboard health card for the affected session shows attempt count, last recovery timestamp, and whether the last attempt succeeded or failed
  4. When a session goes unhealthy and a healthy session is available, a WhatsApp alert message is delivered to all god mode users via the healthy session
**Plans**: 2 plans
Plans:
- [x] 25-01-PLAN.md — Backend: auto-recovery logic, cooldown, alerting, recovery API
- [x] 25-02-PLAN.md — Frontend: Dashboard health card recovery display

### Phase 26: Config Safety
**Goal**: Config saves from the admin panel are validated before hitting disk, corrupt configs are rejected with actionable errors, and operators can export/import/restore configs without touching the server.
**Depends on**: Nothing
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04, CFG-05
**Success Criteria** (what must be TRUE):
  1. Submitting an invalid config value via the admin Settings tab returns a field-level error message pinned to the offending field — the config file on disk is not modified
  2. Every successful config save rotates backups, preserving the 3 most recent previous versions alongside the current config
  3. Clicking "Export Config" in the admin panel downloads the full current config as a JSON file
  4. Uploading a valid JSON file via "Import Config" applies it and shows a success toast; uploading an invalid file shows a structured validation error without touching the live config
**Plans**: 2 plans
Plans:
- [ ] 26-01-PLAN.md — Backend: Zod validation, backup rotation, export/import endpoints
- [ ] 26-02-PLAN.md — Frontend: validation error display, export/import buttons in Settings tab

### Phase 27: Pairing Cleanup and Code Quality
**Goal**: Dead pairing code is removed, bot echo no longer triggers pairing challenges for itself, pairing.ts ships reliably in deploy artifacts, and five lingering code quality issues are resolved.
**Depends on**: Nothing
**Requirements**: PAIR-01, PAIR-02, PAIR-03, CQ-01, CQ-02, CQ-03, CQ-04, CQ-05
**Success Criteria** (what must be TRUE):
  1. The plugin PairingEngine class is removed (or integrated) — no dead code path remains that creates pairing challenges from the plugin side
  2. Sending a message from the bot session to itself no longer triggers a pairing challenge in the bot's inbound pipeline
  3. pairing.ts is present in both hpg6 deploy locations after a standard deploy — absence is detected at startup and logged as an error
  4. The remaining `.catch(() => {})` in shutup.ts:239 is replaced with `warnOnError()` — mute confirmation failures are visible in logs
  5. Admin panel theme toggle respects `prefers-color-scheme` on first load (no manual toggle required on a fresh browser session)
**Plans**: 2 plans
Plans:
- [ ] 27-01-PLAN.md — Backend: pairing cleanup, bot echo fix, CQ-01/02/03
- [ ] 27-02-PLAN.md — Frontend: system theme auto-detect, log export button

### Phase 28: API Coverage Completion
**Goal**: All identified WAHA API gaps are closed — channel search metadata, bulk presence, group join-info, group refresh, group webhook events, API keys CRUD, and all four presence endpoints verified end-to-end.
**Depends on**: Nothing
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, API-07, PRES-01, PRES-02
**Success Criteria** (what must be TRUE):
  1. The OpenClaw agent can search WhatsApp channels by view category and retrieve channel metadata (views, countries, categories) via plugin actions
  2. A single plugin action returns presence status for all currently subscribed contacts (bulk GET)
  3. The agent can preview group details (name, participants count, description) before joining via join-info endpoint
  4. Group join/leave/participant-change webhook events are handled and delivered to the OpenClaw agent as inbound messages
  5. The agent can create, list, update, and delete WAHA API keys via plugin actions
  6. Contact online/offline presence status is visible in the admin panel Directory tab (with last-seen timestamp where available)
**Plans**: 3 plans
Plans:
- [ ] 28-01-PLAN.md — Channel search, bulk presence, group helpers (API-01 through API-05)
- [ ] 28-02-PLAN.md — Group webhook events, API Keys CRUD (API-06, API-07)
- [ ] 28-03-PLAN.md — Presence verification and admin panel display (PRES-01, PRES-02)

### Phase 29: Real-Time Admin Panel
**Goal**: The admin panel receives live server-push updates — health state changes, queue depth, new log lines — without requiring manual refresh.
**Depends on**: Nothing
**Requirements**: RT-01, RT-02, RT-03, RT-04
**Success Criteria** (what must be TRUE):
  1. A persistent SSE connection is established when the admin panel loads — the connection survives tab-switch and auto-reconnects after a brief disconnect
  2. When a session transitions from healthy to degraded or unhealthy, the Dashboard health card updates its badge color within 2 seconds without a manual refresh
  3. New log entries appear in the Log tab in real time — the tab auto-scrolls to the latest entry if the user has not manually scrolled up
  4. The admin sidebar shows a green "Connected" indicator while the SSE stream is live and an amber "Reconnecting" indicator during gaps
**Plans**: 2 plans
Plans:
- [x] 29-01-PLAN.md — Backend SSE endpoint, event emitters, useEventSource hook, connection indicator
- [x] 29-02-PLAN.md — Dashboard auto-updates and Log tab real-time streaming via SSE

### Phase 30: Analytics
**Goal**: Message activity is recorded to SQLite and surfaced in a new Analytics tab with hourly/daily charts — giving operators visibility into traffic patterns and response times.
**Depends on**: Nothing
**Requirements**: ANL-01, ANL-02, ANL-03
**Success Criteria** (what must be TRUE):
  1. Every inbound and outbound message event is recorded to the analytics table with timestamp, direction, chat type, action name, processing duration, and status
  2. The analytics API returns aggregated data for a requested time range and group-by interval (hour or day)
  3. The Analytics tab in the admin panel displays a messages-per-hour bar chart and a response-time distribution chart populated from live data
  4. Charts update on manual refresh — data shown is consistent with what was processed (counts match filter stats for the same period)
**Plans**: 2 plans
Plans:
- [ ] 30-01-PLAN.md — Backend: AnalyticsDb module, API route, inbound/outbound instrumentation
- [ ] 30-02-PLAN.md — Frontend: AnalyticsTab with recharts charts, range selector, top chats table

### Phase 31: Test Coverage Sprint
**Goal**: Every critical untested module gains a test suite — zero-coverage modules (monitor.ts, inbound.ts, shutup.ts) are no longer unguarded, and existing partial coverage in directory.ts and React components is completed.
**Depends on**: Nothing
**Requirements**: TST-01, TST-02, TST-03, TST-04, TST-05
**Success Criteria** (what must be TRUE):
  1. Every admin API route in monitor.ts has at least one passing test (mock HTTP req/res) — a code change that breaks a route is caught by the test suite before deploy
  2. The inbound.ts message pipeline (filter, dedup, queue entry, queue processing) has tests with mocked OpenClaw SDK imports
  3. directory.ts CRUD operations — create/read/update/delete contacts, participant management, LID mapping, group filter overrides — each have at least one passing test
  4. The shutup.ts interactive mute/unmute flow (pending selection, confirmation, timeout) has tests covering the happy path and the cancellation path
  5. Each React admin panel tab has at least one component test (render without crash, key interaction verified)
**Plans**: 3 plans
Plans:
- [ ] 31-01-PLAN.md — directory.ts CRUD + shutup.ts interactive flow tests
- [ ] 31-02-PLAN.md — monitor.ts admin API route + inbound.ts pipeline tests
- [ ] 31-03-PLAN.md — React admin panel component tests (vitest + jsdom + testing-library)

### Phase 32: Platform Abstraction
**Goal**: WAHA API calls are consolidated behind a WahaClient class, a platform adapter interface is defined for future multi-platform support, and the config/session/directory layers are structured for future multi-tenant isolation.
**Depends on**: Phase 28
**Requirements**: PLAT-01, PLAT-02, PLAT-03
**Success Criteria** (what must be TRUE):
  1. All direct `fetch()` calls to the WAHA API in send.ts are replaced by `WahaClient` methods — no raw fetch calls to WAHA remain outside WahaClient
  2. A `ChannelAdapter` interface is defined and the plugin's OpenClaw integration implements it — swapping the transport layer requires only a new adapter class, not edits to business logic
  3. Config, session registry, and DirectoryDb accept a tenant ID parameter — the plugin can run two isolated instances in the same process without state leakage between them
**Plans**: 3 plans
Plans:
- [ ] 32-01-PLAN.md — WahaClient extraction and send.ts refactor (PLAT-01)
- [ ] 32-02-PLAN.md — PlatformAdapter interface and channel.ts wiring (PLAT-02)
- [ ] 32-03-PLAN.md — Multi-tenant groundwork: tenantId threading (PLAT-03)
## Progress

**Execution Order:** 25 → 26 → 27 → 28 → 29 → 30 → 31 → 32 (28 must precede 32)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Reliability Foundation | v1.10 | 3/3 | Complete | 2026-03-11 |
| 2. Resilience and Observability | v1.10 | 2/2 | Complete | 2026-03-11 |
| 3. Feature Gaps | v1.10 | 3/3 | Complete | 2026-03-11 |
| 4. Multi-Session | v1.10 | 4/4 | Complete | 2026-03-13 |
| 5. Documentation and Testing | v1.10 | 2/2 | Complete | 2026-03-13 |
| 6. WhatsApp Rules and Policy System | v1.10 | 4/4 | Complete | 2026-03-13 |
| 7. Admin Panel Critical Fixes | v1.10 | 2/2 | Complete | 2026-03-15 |
| 8. Shared UI Components | v1.10 | 2/2 | Complete | 2026-03-16 |
| 9. Settings UX Improvements | v1.10 | 2/2 | Complete | 2026-03-16 |
| 10. Directory & Group Enhancements | v1.10 | 2/2 | Complete | 2026-03-16 |
| 11. Dashboard, Sessions & Log | v1.10 | 2/2 | Complete | 2026-03-16 |
| 12. UI Bug Sprint | v1.11 | 5/5 | Complete | 2026-03-17 |
| 13. Background Directory Sync | v1.11 | 2/2 | Complete | 2026-03-17 |
| 14. Name Resolution | v1.11 | 2/2 | Complete | 2026-03-17 |
| 15. TTL Access | v1.11 | 3/3 | Complete | 2026-03-17 |
| 16. Pairing Mode and Auto-Reply | v1.11 | 3/3 | Complete | 2026-03-17 |
| 17. Modules Framework | v1.11 | 3/3 | Complete | 2026-03-17 |
| 18. React Scaffold | v1.12 | 2/2 | Complete | 2026-03-18 |
| 19. App Layout | v1.12 | 2/2 | Complete | 2026-03-18 |
| 20. Dashboard and Settings Tabs | v1.12 | 2/2 | Complete | 2026-03-18 |
| 21. Directory Tab | v1.12 | 3/3 | Complete | 2026-03-18 |
| 22. Sessions, Modules, Log, and Queue Tabs | v1.12 | 2/2 | Complete | 2026-03-18 |
| 23. Polish | v1.12 | 2/2 | Complete | 2026-03-18 |
| 24. Cleanup and Deploy | v1.12 | 1/1 | Complete | 2026-03-18 |
| 25. Session Auto-Recovery | v1.13 | 2/2 | Complete | 2026-03-20 |
| 26. Config Safety | v1.13 | 2/2 | Complete | 2026-03-20 |
| 27. Pairing Cleanup and Code Quality | v1.13 | 2/2 | Complete | 2026-03-20 |
| 28. API Coverage Completion | v1.13 | 2/3 | Complete | 2026-03-20 |
| 29. Real-Time Admin Panel | v1.13 | 2/2 | Complete | 2026-03-20 |
| 30. Analytics | 2/2 | Complete    | 2026-03-20 | - |
| 31. Test Coverage Sprint | 2/3 | Complete    | 2026-03-20 | - |
| 32. Platform Abstraction | 3/3 | Complete   | 2026-03-20 | - |
