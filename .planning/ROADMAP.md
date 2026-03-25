# Roadmap: WAHA OpenClaw Plugin

## Milestones

- ✅ **v1.10 Admin Panel & Multi-Session** — Phases 1-11 (shipped 2026-03-16)
- ✅ **v1.11 Polish, Sync & Features** — Phases 12-17 (shipped 2026-03-18)
- ✅ **v1.12 UI Overhaul & Feature Polish** — Phases 18-24 (shipped 2026-03-18)
- ✅ **v1.13 Close All Gaps** — Phases 25-32 (shipped 2026-03-20)
- 🚧 **v1.14 Enterprise Hardening** — Phases 33-41 (in progress)

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

### v1.14 Enterprise Hardening (In Progress)

**Milestone Goal:** Close all 27 security, resilience, observability, concurrency, and lifecycle gaps to make the plugin production-safe for internet-facing deployment.

- [x] **Phase 33: Config Infrastructure** - Config write mutex, async I/O, and atomic writes (completed 2026-03-25)
- [ ] **Phase 34: Security** - Admin auth, config import validation, JID validation, HMAC defaults
- [ ] **Phase 35: Structured Logging** - JSON logger module replacing all freeform console.* calls
- [ ] **Phase 36: Timeout & Error Hardening** - AbortSignal timeouts on all bare fetch calls
- [ ] **Phase 37: SQLite Hardening** - busy_timeout, WAL checkpoints, temp file cleanup
- [ ] **Phase 38: Resilience & Health** - Circuit breaker, recovery detection, queue safety
- [ ] **Phase 39: Graceful Shutdown & SSE** - Request drain, SSE cleanup, SSE connection cap
- [ ] **Phase 40: API & Config Polish** - Admin rate limiting, req.url fix, config bounds, per-account reliability
- [ ] **Phase 41: Metrics Endpoint** - Prometheus /metrics with heap, event loop, request, SQLite, queue stats

## Phase Details

### Phase 33: Config Infrastructure
**Goal**: Config file operations are safe under concurrent access — no data loss, no blocking, no corruption
**Depends on**: Nothing (foundational for v1.14)
**Requirements**: CON-01, MEM-01, DI-02
**Success Criteria** (what must be TRUE):
  1. Two concurrent config saves never produce a corrupted or partially-written config file
  2. Config writes do not block the event loop (async fs/promises used throughout)
  3. Config writes use write-to-temp-then-rename so a crash mid-write leaves the previous valid file intact
  4. A promise-based mutex serializes all read-modify-write config operations
**Plans**: 2 plans
Plans:
- [x] 33-01-PLAN.md — Create config-io module with mutex, async I/O, and atomic writes
- [ ] 33-02-PLAN.md — Replace all config I/O callsites in monitor.ts and sync.ts

### Phase 34: Security
**Goal**: Admin API and webhook endpoints are protected against unauthorized access and injection
**Depends on**: Phase 33 (config infra needed for reading auth tokens from config)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. All `/api/admin/*` routes reject requests without a valid Bearer token (HTTP 401)
  2. Config import endpoint rejects payloads with unknown top-level keys (HTTP 400 with descriptive error)
  3. URL path segments containing JIDs are validated against the allowed JID regex before any database or API operation
  4. When `webhookHmacKey` is not configured, a random secret is generated on startup and logged; `webhookHmacKey: "disabled"` explicitly disables verification
**Plans**: TBD

### Phase 35: Structured Logging
**Goal**: All log output is machine-parseable JSON with consistent fields, enabling log aggregation and filtering
**Depends on**: Phase 33 (logger is cross-cutting; config infra must be stable first)
**Requirements**: OBS-01
**Success Criteria** (what must be TRUE):
  1. A `logger` module exists that outputs JSON lines with `level`, `timestamp`, `component`, and optional `sessionId`/`chatId` fields
  2. All `console.log`, `console.warn`, `console.error` calls in production code are replaced with `logger.*` calls
  3. Log level is configurable (debug/info/warn/error) and respects the configured level at runtime
**Plans**: TBD

### Phase 36: Timeout & Error Hardening
**Goal**: Every outbound HTTP call has an explicit timeout — no fetch() can hang indefinitely
**Depends on**: Phase 35 (timeout errors should use structured logger)
**Requirements**: EH-01, EH-02, EH-03, EH-04, API-03
**Success Criteria** (what must be TRUE):
  1. All bare `fetch()` calls in monitor.ts (fetchBotJids, /api/admin/sessions, follow/unfollow bulk) use `AbortSignal.timeout(30_000)` or route through `callWahaApi()`
  2. `downloadWahaMedia()` fetch call has `AbortSignal.timeout(30_000)`
  3. Gemini video polling fetch calls have `AbortSignal.timeout(5_000)`
  4. Nominatim geocode call has `AbortSignal.timeout(5_000)` and a 1-req/sec rate limit
  5. `RateLimiter` constructor accepts `maxQueue` and throws when queue exceeds it
**Plans**: TBD

### Phase 37: SQLite Hardening
**Goal**: SQLite databases handle concurrent access gracefully and do not leak temp files
**Depends on**: Phase 35 (logging for WAL checkpoint events)
**Requirements**: MEM-03, DI-01, MEM-02
**Success Criteria** (what must be TRUE):
  1. Both `DirectoryDb` and `AnalyticsDb` set `PRAGMA busy_timeout = 5000` on initialization
  2. Both databases run periodic `PRAGMA wal_checkpoint(PASSIVE)` (every sync cycle or every 30 minutes)
  3. On startup, orphaned `/tmp/openclaw/waha-media-*` files older than 10 minutes are deleted
**Plans**: TBD

### Phase 38: Resilience & Health
**Goal**: Outbound calls fail fast when a session is unhealthy, recovery is verified, and queue drains never throw unhandled rejections
**Depends on**: Phase 35 (structured logging for circuit breaker events), Phase 36 (timeout infra)
**Requirements**: RES-01, RES-02, CON-02
**Success Criteria** (what must be TRUE):
  1. `callWahaApi` checks `sessionHealthStates` and fast-fails with a descriptive error when session status is `unhealthy`, skipping the full retry cycle
  2. Auto-recovery in health.ts polls session status after restart and only marks `outcome = "success"` when session reaches CONNECTED (with 30s timeout)
  3. The `finally` block in `InboundQueue.drain()` wraps both `onQueueChange?.()` and the recursive `drain()` in try/catch — no unhandled rejections escape
**Plans**: TBD

### Phase 39: Graceful Shutdown & SSE
**Goal**: Server shutdown is clean — in-flight requests complete, SSE connections close, no leaked timers
**Depends on**: Phase 38 (queue drain safety must be in place before shutdown drain)
**Requirements**: GS-01, GS-02, OBS-03
**Success Criteria** (what must be TRUE):
  1. `server.close()` tracks in-flight requests and waits for completion (10s hard timeout) before resolving
  2. SSE keep-alive `setInterval` is `.unref()`'d; abort handler clears all SSE intervals and closes all client connections
  3. `sseClients` Set has a max cap of 50; connections beyond the cap are rejected with HTTP 503
**Plans**: TBD

### Phase 40: API & Config Polish
**Goal**: Admin API is rate-limited, request handling is side-effect-free, and config values have enforced bounds
**Depends on**: Phase 34 (auth must be in place before rate limiting), Phase 36 (RateLimiter maxQueue)
**Requirements**: API-01, API-02, CFG-01, CFG-02
**Success Criteria** (what must be TRUE):
  1. Admin API routes have IP-based or token-based rate limiting that prevents event loop DoS
  2. Static file serving uses a local variable for URL rewriting — `req.url` is never mutated
  3. `healthCheckIntervalMs` enforces minimum 10000ms and `syncIntervalMinutes` enforces minimum 1 minute via Zod `.min()` transforms
  4. `configureReliability()` is called once globally or uses per-account token buckets — no last-account-wins race
**Plans**: TBD

### Phase 41: Metrics Endpoint
**Goal**: Operational health is observable via a standard Prometheus-compatible endpoint
**Depends on**: Phase 35 (logger), Phase 37 (SQLite metrics), Phase 38 (queue/health metrics), Phase 39 (SSE metrics)
**Requirements**: OBS-02
**Success Criteria** (what must be TRUE):
  1. `GET /metrics` returns Prometheus text format with heap usage, event loop lag, HTTP request rate counters
  2. `/metrics` includes SQLite query latency, queue depth, processing latency P95, and error rate
  3. `/metrics` endpoint is accessible without admin auth (or with a separate metrics token) for scraper compatibility
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 33 -> 34 -> 35 -> 36 -> 37 -> 38 -> 39 -> 40 -> 41

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 33. Config Infrastructure | v1.14 | 1/2 | Complete    | 2026-03-25 |
| 34. Security | v1.14 | 0/TBD | Not started | - |
| 35. Structured Logging | v1.14 | 0/TBD | Not started | - |
| 36. Timeout & Error Hardening | v1.14 | 0/TBD | Not started | - |
| 37. SQLite Hardening | v1.14 | 0/TBD | Not started | - |
| 38. Resilience & Health | v1.14 | 0/TBD | Not started | - |
| 39. Graceful Shutdown & SSE | v1.14 | 0/TBD | Not started | - |
| 40. API & Config Polish | v1.14 | 0/TBD | Not started | - |
| 41. Metrics Endpoint | v1.14 | 0/TBD | Not started | - |
