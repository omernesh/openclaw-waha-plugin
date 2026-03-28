# Roadmap: WAHA OpenClaw Plugin → Chatlytics

## Milestones

- ✅ **v1.10 Admin Panel & Multi-Session** — Phases 1-11 (shipped 2026-03-16)
- ✅ **v1.11 Polish, Sync & Features** — Phases 12-17 (shipped 2026-03-18)
- ✅ **v1.12 UI Overhaul & Feature Polish** — Phases 18-24 (shipped 2026-03-18)
- ✅ **v1.13 Close All Gaps** — Phases 25-32 (shipped 2026-03-20)
- ✅ **v1.18 Join/Leave/List & Skill Completeness** — Phases 43-47 (shipped 2026-03-25)
- ✅ **v1.19 Full WAHA Capabilities & Modular Skill Architecture** — Phases 48-52 (shipped 2026-03-26)
- ✅ **v1.20 Human Mimicry Hardening** — Phases 53-57 (shipped 2026-03-27)
- 🚧 **v2.0 Chatlytics Universal Agent Platform** — Phases 58-66 (active)

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

## v1.20 Human Mimicry Hardening — ✅ SHIPPED 2026-03-27

- [x] **Phase 53: MimicryGate Core** - Config schema + enforcement primitives (completed 2026-03-26)
- [x] **Phase 54: Send Pipeline Enforcement** - Wire gate/cap into send.ts + behavioral polish (completed 2026-03-26)
- [x] **Phase 55: Claude Code Integration** - Proxy-send endpoint + mimicry routing (completed 2026-03-27)
- [x] **Phase 56: Adaptive Activity Patterns** - Per-chat activity profiles, auto-adapt gate timing (completed 2026-03-27)
- [x] **Phase 57: Admin UI & Observability** - Dashboard card, settings tab controls, mimicry status API (completed 2026-03-27)

---

## v2.0 Chatlytics Universal Agent Platform — Active

**Milestone Goal:** Extract the WAHA OpenClaw plugin into Chatlytics — a standalone, Docker-distributable WhatsApp platform that any AI agent framework can connect to via MCP server, REST API, or SKILL.md. Phases 58-62 are Docker Alpha scope. Phases 63-66 are v2.1 SaaS scope.

### Phases

- [x] **Phase 58: SDK Decoupling** — Remove all openclaw/plugin-sdk imports outside channel.ts; new platform-types.ts, account-utils.ts, request-utils.ts (completed 2026-03-28)
- [ ] **Phase 59: Standalone Entry + Docker** — standalone.ts boots HTTP server, registers WAHA webhook; Dockerfile + Docker Compose with named volume
- [ ] **Phase 60: Public REST API + OpenAPI + CLI** — /api/v1/ route groups, API key auth, openapi.yaml, Spectral CI lint, Swagger UI, `npx chatlytics` CLI tool
- [ ] **Phase 61: Webhook Forwarding** — HMAC-signed inbound delivery to callback URLs, exponential backoff, circuit breaker
- [ ] **Phase 62: MCP Server** — 8-10 consolidated tools via StreamableHTTPServerTransport + stdio mode for npx chatlytics-mcp
- [ ] **Phase 63: Dashboard Auth + Onboarding** — better-auth registration, workspace creation, QR pairing, API key UI (v2.1)
- [ ] **Phase 64: Multi-Tenant Process Isolation** — per-workspace process, SQLite DBs, WAHA session namespacing, API gateway routing (v2.1)
- [ ] **Phase 65: Admin Standalone + Distribution** — standalone admin auth, workspace management, SKILL.md v4, landing page + docs site (v2.1)
- [ ] **Phase 66: OpenClaw Thin Wrapper** — refactor channel.ts to HTTP client delegating to Chatlytics API (gated: 30-day production stability)

## Phase Details

### Phase 58: SDK Decoupling
**Goal**: Zero openclaw/plugin-sdk imports exist outside channel.ts and index.ts — the codebase can load and run without the OpenClaw SDK present
**Depends on**: Phase 57 (last v1.20 phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-05
**Success Criteria** (what must be TRUE):
  1. `grep -r "openclaw/plugin-sdk" src/` returns zero results outside src/channel.ts and index.ts
  2. `platform-types.ts`, `account-utils.ts`, and `request-utils.ts` exist and cover all replaced SDK symbols
  3. All 594 tests pass after every file modification (no regressions)
  4. `monitor.ts` loads without importing any SDK symbol (confirmed by starting the HTTP server in isolation)
  5. CHATLYTICS_CONFIG_PATH env var is respected by the config loader and overrides the default path
**Plans**: 3 plans

### Phase 59: Standalone Entry + Docker
**Goal**: A Docker container starts, serves the admin panel on a configured port, registers its webhook with WAHA, and reports healthy — zero OpenClaw gateway involved
**Depends on**: Phase 58
**Requirements**: CORE-04, CORE-06
**Success Criteria** (what must be TRUE):
  1. `docker compose up` completes and the container reports ready within 30 seconds
  2. `GET /health` returns `{ status: "ok", webhook_registered: true }` after startup
  3. The admin panel loads in a browser at the configured port with all existing tabs functional
  4. SQLite databases persist across container restarts via named Docker volume
  5. Stopping and restarting the container re-registers the WAHA webhook and resumes normal operation
**Plans**: 2 plans
Plans:
- [ ] 59-01-PLAN.md -- Standalone entry point, /health route, CHATLYTICS_DATA_DIR for SQLite
- [ ] 59-02-PLAN.md -- Dockerfile, docker-compose.yml, container verification
**UI hint**: yes

### Phase 60: Public REST API + OpenAPI + CLI
**Goal**: External callers can send WhatsApp messages, read messages, search contacts, and query sessions via authenticated REST endpoints, a machine-readable spec, and a CLI tool
**Depends on**: Phase 59
**Requirements**: API-01, API-02, API-03, API-04, CLI-01, CLI-02, CLI-03, CLI-04
**Success Criteria** (what must be TRUE):
  1. `curl -H "Authorization: Bearer ctl_xxx" http://localhost:PORT/api/v1/send` sends a WhatsApp message and returns the WAHA message ID
  2. A request with a wrong or missing API key receives HTTP 401 — timing-safe comparison is used (no timing leak)
  3. `GET /openapi.yaml` returns a valid OpenAPI 3.1 document and `spectral lint` passes with zero errors in CI
  4. `GET /docs` renders a Swagger UI with all /api/v1/ endpoints listed and interactive
  5. Cross-origin requests from the admin panel dashboard succeed (CORS headers present)
  6. `npx chatlytics send "hello" --to "John"` sends a WhatsApp message via the REST API and prints the result
  7. `npx chatlytics search "marketing"` returns matching contacts/groups with colored table output
  8. `npx chatlytics --json status` returns machine-readable JSON for scripting
**Plans**: TBD

### Phase 61: Webhook Forwarding
**Goal**: Every inbound WhatsApp message is delivered to the operator's registered callback URL with a cryptographic signature and automatic retry on failure
**Depends on**: Phase 59
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04
**Success Criteria** (what must be TRUE):
  1. Sending a WhatsApp message to the connected account causes an HTTP POST to the configured callback URL within 2 seconds
  2. The delivered payload includes an `X-Chatlytics-Signature` header containing an HMAC-SHA256 digest of the raw body, verifiable with the API key
  3. A callback URL that returns 5xx triggers exponential backoff retries (1s, 2s, 4s) before the delivery is dead-lettered
  4. A callback URL that never responds is abandoned after three timeouts and the circuit breaker opens to prevent queue saturation
**Plans**: TBD

### Phase 62: MCP Server
**Goal**: Any MCP-compatible AI agent (Claude, Cursor, etc.) can connect to Chatlytics and send/receive WhatsApp messages using 8-10 consolidated tools
**Depends on**: Phase 60, Phase 61
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05
**Success Criteria** (what must be TRUE):
  1. Claude Code connects to `http://localhost:PORT/mcp` and lists all tools including send_message, read_messages, search, get_directory, and manage_group
  2. Calling `send_message` via MCP sends a real WhatsApp message through the mimicry gate, identical to a REST send
  3. `npx chatlytics-mcp` (stdio mode) connects without a running HTTP server and routes all tool calls to the same business logic
  4. MCP resources expose contacts, groups, sessions, and mimicry status at `chatlytics://` URIs
  5. A tool call that would be blocked by the mimicry gate returns a human-readable error with a recovery hint (e.g., "Gate closed until 09:00 — retry then")
**Plans**: TBD

### Phase 63: Dashboard Auth + Onboarding
**Goal**: A new user can sign up, connect a WhatsApp number via QR code, and get an API key or MCP config — entirely self-service with no manual server config
**Depends on**: Phase 62
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):
  1. A new visitor to the dashboard can register with email and password and is redirected to workspace setup
  2. The dashboard QR code flow shows a live QR code, refreshes every 20 seconds, and transitions to "Connected" when the phone scans it
  3. API keys are displayed in full exactly once after creation with a copy button; subsequent views show only the last 4 characters
  4. Rotating an API key invalidates the old key immediately — a request using the old key returns 401 within milliseconds
  5. The integration wizard presents MCP config, REST curl example, and SKILL.md download options after connection is confirmed
**Plans**: TBD
**UI hint**: yes

### Phase 64: Multi-Tenant Process Isolation
**Goal**: Multiple workspaces run in isolated processes so a crash or SQLite write storm in one workspace cannot affect any other
**Depends on**: Phase 63
**Requirements**: TENANT-01, TENANT-02, TENANT-03, TENANT-04
**Success Criteria** (what must be TRUE):
  1. Creating two workspaces and crashing one process does not interrupt message delivery in the other workspace
  2. Each workspace has its own directory.db, mimicry.db, and analytics.db at a workspace-scoped path — no shared SQLite files
  3. WAHA sessions are namespaced as `ctl_{workspaceId}_{sessionName}` — two workspaces cannot share or interfere with each other's sessions
  4. An API request authenticated with workspace A's key cannot read or write to workspace B's data under any request path
**Plans**: TBD

### Phase 65: Admin Standalone + Distribution
**Goal**: The admin panel has its own authentication independent of OpenClaw, operators can manage multiple workspaces, and integration materials are publicly available
**Depends on**: Phase 64
**Requirements**: ADMIN-01, ADMIN-02, SKILL-01, SITE-01, SITE-02
**Success Criteria** (what must be TRUE):
  1. The admin panel login page works without an OpenClaw gateway running — auth is handled by the Chatlytics process
  2. Operators can create, switch between, and delete workspaces from the admin panel without editing config files
  3. SKILL.md v4 references the Chatlytics API key and MCP endpoint with no OpenClaw-specific instructions
  4. chatlytics.ai serves a landing page with a product overview, feature list, and getting started link
  5. The documentation site has interactive API examples and copy-paste MCP config snippets
**Plans**: TBD
**UI hint**: yes

### Phase 66: OpenClaw Thin Wrapper
**Goal**: The OpenClaw plugin delegates all action handling to the Chatlytics REST API so the plugin becomes a thin HTTP client with no duplicated business logic
**Depends on**: Phase 62 (Docker Alpha must be production-stable for 30+ days before this phase starts)
**Requirements**: COMPAT-01, COMPAT-02, COMPAT-03
**Success Criteria** (what must be TRUE):
  1. All 594 existing tests pass after channel.ts is refactored to an HTTP client
  2. All existing SKILL.md action names continue to work via the REST API with identical response shapes
  3. The existing admin panel routes (/api/admin/*) remain functional and return the same data as before
  4. Action response times measured at the gateway remain under 300ms at p95 (accounting for HTTP round-trip)
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 53. MimicryGate Core | v1.20 | 2/2 | Complete | 2026-03-26 |
| 54. Send Pipeline Enforcement | v1.20 | 2/2 | Complete | 2026-03-26 |
| 55. Claude Code Integration | v1.20 | 1/1 | Complete | 2026-03-27 |
| 56. Adaptive Activity Patterns | v1.20 | 2/2 | Complete | 2026-03-27 |
| 57. Admin UI & Observability | v1.20 | 1/1 | Complete | 2026-03-27 |
| 58. SDK Decoupling | v2.0 | 3/3 | Complete   | 2026-03-28 |
| 59. Standalone Entry + Docker | v2.0 | 0/2 | Not started | - |
| 60. Public REST API + OpenAPI | v2.0 | 0/? | Not started | - |
| 61. Webhook Forwarding | v2.0 | 0/? | Not started | - |
| 62. MCP Server | v2.0 | 0/? | Not started | - |
| 63. Dashboard Auth + Onboarding | v2.1 | 0/? | Not started | - |
| 64. Multi-Tenant Process Isolation | v2.1 | 0/? | Not started | - |
| 65. Admin Standalone + Distribution | v2.1 | 0/? | Not started | - |
| 66. OpenClaw Thin Wrapper | v2.1 | 0/? | Not started | - |
