---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Chatlytics Universal Agent Platform
status: verifying
stopped_at: Completed 64-02-PLAN.md
last_updated: "2026-03-28T17:31:33.916Z"
last_activity: 2026-03-28
progress:
  total_phases: 9
  completed_phases: 3
  total_plans: 17
  completed_plans: 11
  percent: 70
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-26)

**Core value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.
**Current focus:** Phase 64 — multi-tenant

## Current Position

Phase: 64 (multi-tenant) — EXECUTING
Plan: 2 of 2
Status: Phase complete — ready for verification
Last activity: 2026-03-28

Progress: [███████░░░] 70%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 53. MimicryGate Core | - | - | - |
| 54. Send Pipeline Enforcement | - | - | - |
| 55. Claude Code Integration | - | - | - |
| 56. Adaptive Activity Patterns | - | - | - |
| 57. Admin UI & Observability | - | - | - |
| Phase 53 P01 | 9 | 2 tasks | 3 files |
| Phase 53 P02 | 358 | 2 tasks | 2 files |
| Phase 54 P01 | 4 | 1 task (TDD) | 2 files |
| Phase 54 P02 | 10 | 2 tasks | 3 files |
| Phase 55 P01 | 22 | 2 tasks | 4 files |
| Phase 56 P01 | 602 | 2 tasks | 4 files |
| Phase 57 P01 | 15 | 2 tasks | 5 files |
| Phase 58 P03 | 28m 39s | 2 tasks | 4 files |
| Phase 59 P01 | 8m | 2 tasks | 7 files |
| Phase 60-rest-api-cli P02 | 20 | 2 tasks | 6 files |
| Phase 60 P03 | 17m 49s | 2 tasks | 5 files |
| Phase 61 P01 | 15 | 1 tasks | 3 files |
| Phase 61 P02 | 8m | 1 tasks | 1 files |
| Phase 62 P01 | 12m | 1 tasks | 3 files |
| Phase 62 P02 | 8m | 2 tasks | 3 files |
| Phase 63-dashboard-auth P01 | 21 | 2 tasks | 4 files |
| Phase 63 P02 | 14m | 2 tasks | 9 files |
| Phase 63 P03 | 4m | 1 tasks | 3 files |
| Phase 64 P01 | 609s | 2 tasks | 4 files |
| Phase 64 P02 | 341s | 2 tasks | 3 files |

## Accumulated Context

### Decisions

- **2026-03-26 (Roadmap)**: Reject-not-queue as default quiet hours policy — avoids message loss on restart and SQLite queue complexity
- **2026-03-26 (Roadmap)**: Rolling window hourly counter (SQLite per-timestamp rows) over fixed top-of-hour bucket — prevents 2x burst exploit at hour boundaries
- **2026-03-26 (Roadmap)**: Phase 53 is the hard dependency for all others — no live deploy needed until Phase 54
- **2026-03-26 (Roadmap)**: Phases 54, 55, 56 are all independent after Phase 53 (can be sequenced in any order; Phase 55 is highest ban-risk gap)
- **2026-03-26 (Roadmap)**: Cap keyed by WAHA session name, not plugin accountId — logan and Omer sends share the same hourly bucket per session
- [Phase 53]: Rolling window via per-row timestamps (not fixed buckets) prevents 2x burst at hour boundary
- [Phase 53]: Reject-not-queue as default onBlock policy eliminates queue complexity and message loss on restart
- [Phase 53]: 3-level config merge (global -> session -> target) for both gate and cap; most-specific wins
- [Phase 53]: Intl.DateTimeFormat with formatToParts for timezone-aware hour extraction (not getHours())
- [Phase 53]: Cross-midnight window: endHour <= startHour means hour >= startHour OR hour < endHour
- [Phase 53]: getCapStatus is read-only -- never calls recordSend
- [Phase 54]: Separate mimicry-enforcer.ts avoids circular import between send.ts and mimicry-gate.ts
- [Phase 54]: DI params _db/_now/_sleep for enforcer test isolation without fake timers
- [Phase 54]: recordMimicrySuccess called by caller AFTER WAHA success -- failed sends don't consume cap
- [Phase 54]: sendWahaMediaBatch calls enforceMimicry once with count=N before the batch loop (not per-media)
- [Phase 54]: deliverWahaReply calls enforceMimicry AFTER presenceCtrl typing stop to avoid two concurrent typing indicators
- [Phase 54]: Status sends pass isStatusSend=true so they honour time gate but skip hourly cap
- [Phase 55]: Extracted handleProxySend into proxy-send-handler.ts for testability (avoids mocking full HTTP server)
- [Phase 55]: Proxy calls callWahaApi directly, not sendWahaText, to avoid double mimicry enforcement
- [Phase 55]: recordMimicrySuccess called only after WAHA success -- failed proxy sends don't consume cap
- [Phase 56]: _firstTickDelayMs DI param in ScannerOptions for test isolation without fake timers
- [Phase 56]: computePeakWindow uses contiguous span of top-60% hours (permissive for bimodal activity patterns)
- [Phase 56]: isOffPeak delegates to resolveGateConfig + checkTimeOfDay from mimicry-gate.ts (no logic duplication)
- [Phase 56-02]: Step 2b guard `if (!targetGateOverride)` ensures manual admin override always wins over learned profile
- [Phase 56-02]: getActivityProfile error swallowed (non-fatal) — falls back to global gate config silently
- [Phase 56-02]: startActivityScanner receives session: account.accountId (same as accountId per ScannerOptions)
- [Phase 57]: Route placed after /api/admin/sessions, getCapStatus used (read-only) never checkAndConsumeCap — status API must not consume quota
- [Phase 57]: buildPayload() in SettingsTab extended with sendGate/hourlyCap to wire auto-save for new mimicry config fields
- [Phase 58-03]: Use string[] for allowlist entries in resolveDmGroupAccessWithCommandGate — matches normalizeWahaAllowEntry return type
- [Phase 58-03]: createReplyPrefixOptions shim returns prefixContext + onModelSelected without gateway-specific identity resolution
- [Phase 59]: getDataDir() returns CHATLYTICS_DATA_DIR or falls back to ~/.openclaw/data for backward compat
- [Phase 59]: standalone.ts calls monitorWahaProvider() directly — reuses existing HTTP server, no code duplication
- [Phase 59]: C:/Program Files/Git/health route is public (before auth guard) — Docker HEALTHCHECK cannot pass API tokens
- [Phase 59]: node:22-slim over alpine: better-sqlite3 native bindings require glibc
- [Phase 59]: HEALTHCHECK probes /healthz (always public liveness) not /health (may gain auth later)
- [Phase 59]: chatlytics-data named volume (not bind mount): Docker manages lifecycle, survives container recreation
- [Phase 60-02]: Hand-authored OpenAPI 3.1 YAML over code-gen — simpler, reviewable, no AST extraction needed
- [Phase 60-02]: swagger-ui-dist bundled not CDN — Docker/air-gapped deployments need self-contained Swagger UI
- [Phase 60]: Export makeApiCall and formatOutput from cli.ts for unit testing without spawning subprocesses
- [Phase 60]: Guard program.parseAsync behind process.argv check to prevent auto-execution during vitest
- [Phase 61]: Use publicApiKey as HMAC signing secret for webhook forwarding (operators already have this key)
- [Phase 61]: In-memory circuit breaker per URL (Map<string, CircuitState>), not opossum library
- [Phase 61]: Forwarding uses startup-time cfg.webhookSubscriptions — config changes take effect after server restart (consistent with existing pattern)
- [Phase 62-01]: McpServer instance created fresh per createMcpServer(cfg) — transport connected externally by Plan 02
- [Phase 62-01]: update_settings restricted to channels.waha paths to prevent unintended config corruption
- [Phase 62-01]: sanitizeCfg redacts api key/secret/password/token fields before exposing via chatlytics://config resource
- [Phase 62-02]: Stateless StreamableHTTPServerTransport (sessionIdGenerator: undefined) for HTTP MCP — no in-memory session map needed
- [Phase 62-02]: LOG_LEVEL=silent set before all imports in mcp-stdio.ts to prevent stdout contamination of MCP stdio transport
- [Phase 62-02]: build:mcp uses node -e wrapper around esbuild (cross-platform Windows banner quoting fix)
- [Phase 63-dashboard-auth]: Split authConfig from betterAuth() call so getMigrations() can reuse the same config object without accessing auth.options
- [Phase 63-dashboard-auth]: getMigrations import path is better-auth/db/migration (not better-auth/db) per package.json exports map
- [Phase 63-dashboard-auth]: initAuthDb() called in monitor start() before server.listen to guarantee auth tables exist before any request
- [Phase 63]: AuthGate wraps App outside SSEProvider -- no SSE connection until authenticated
- [Phase 63]: callWahaApi uses params object not positional args -- extraHeaders not in interface; use query param instead
- [Phase 63]: ApiKey masking uses start field from better-auth (prefix chars) -- last-4 only visible in show-once dialog
- [Phase 63-03]: window.location.origin for server URL pre-fill works in dev and production
- [Phase 63-03]: Send Test Message uses session cookie auth in admin panel instead of Authorization header
- [Phase 64]: DI forkFn param in WorkspaceManagerOptions for test isolation without spawning real processes
- [Phase 64]: session name format ctl_{hex32}_{baseName} strips UUID hyphens to fit clean WAHA session namespace
- [Phase 64]: initAuthDb() guarded by !CHATLYTICS_WORKSPACE_ID in monitor.ts start() — children must not open auth.db
- [Phase 64]: LRU cache (max 500, TTL 60s) wraps verifyApiKey in WorkspaceGateway — avoids per-request auth.db queries
- [Phase 64]: WorkspaceGateway routing order: healthz → auth → webhook → api/v1 — prevents unauthenticated proxy access
- [Phase 64]: bootMultiTenant queries auth.db read-only for workspace discovery, entryPath resolved via fileURLToPath(import.meta.url)

### Architecture Notes

- `src/mimicry-gate.ts` is new file — all enforcement primitives live here
- Integration points confirmed: `sendWahaText`, `sendWahaImage`, `sendWahaVideo`, `sendWahaFile` in `send.ts`; `handleAction()` dispatch in `channel.ts`; `monitor.ts` HTTP server for proxy-send + mimicry status API
- `bypassPolicy` flag in `send.ts` already exists — preserves `/shutup`, `/join`, `/leave` bypass behavior
- Typing simulation entry point: `sendWahaPresence()` at `send.ts:176` (existing, working)
- SQLite infrastructure: follow `AnalyticsDb` pattern for rolling window table + `account_metadata` table
- All new Zod fields MUST use `.optional().default()` — production configs must load without error
- `src/mimicry-enforcer.ts` is the chokepoint — Plan 02 wires it into sendWahaText/Image/Video/File/etc in send.ts
- `src/proxy-send-handler.ts` is the Claude Code proxy — calls enforceMimicry + callWahaApi + recordMimicrySuccess

### Research Flags

- **Phase 55**: Verify exact call sites in `whatsapp-messenger` skill before implementing proxy-send — confirm which endpoints the skill calls directly
- **Phase 53**: Confirm rolling window query performance against existing `message_events` table structure before choosing table design

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-03-28T17:31:33.910Z
Stopped at: Completed 64-02-PLAN.md
Resume file: None
