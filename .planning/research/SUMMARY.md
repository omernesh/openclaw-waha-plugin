# Project Research Summary

**Project:** Chatlytics v2.0 — Standalone WhatsApp Agent Platform
**Domain:** Plugin-to-SaaS extraction — WhatsApp automation with MCP server, REST API, Docker distribution
**Researched:** 2026-03-28
**Confidence:** HIGH

## Executive Summary

Chatlytics v2.0 is the extraction of a battle-tested OpenClaw plugin (16,000+ LOC, 594 passing tests, v1.20 production) into a standalone, Docker-distributable platform with a public REST API and MCP server. The core business logic — 109 WhatsApp actions, human mimicry, policy engine, SQLite directory, React admin panel — is already complete and requires zero rewrite. The entire v2.0 effort is decoupling: severing 6 source files from the OpenClaw plugin SDK, adding a standalone entry point, wiring a public API surface (REST + MCP), and packaging as Docker. This is infrastructure work, not feature work.

The recommended approach is strictly additive: new files (`standalone.ts`, `mcp-server.ts`, `api-router.ts`, `webhook-forwarder.ts`, `platform-types.ts`, `account-utils.ts`, `request-utils.ts`) do all the new work. Existing files that need SDK imports replaced get only minimal, localized changes. `channel.ts` and 15+ core modules are untouched. The stack additions are minimal: `@modelcontextprotocol/sdk` (already installed at v1.27.1), `better-auth` for auth (Phase 6+), `jose` for JWTs, `ulid` for IDs, and two dev tools (`spectral-cli`, `openapi-typescript`). No HTTP framework swap — `http.createServer` is preserved throughout.

The dominant risk is regression: 594 tests represent 50+ phases of hard-won fixes with DO NOT CHANGE markers throughout. Every extraction step must be verified against the full test suite before proceeding. The second critical risk is that `inbound.ts` couples to 8+ SDK symbols that contain real business logic — not just type aliases — and must be replaced with behavioral equivalents, not just removed. Phase 1 is the highest-risk phase; phases 2-5 are straightforward once the SDK is cleanly severed.

## Key Findings

### Recommended Stack

The existing stack (TypeScript + Node.js 22 ESM, `better-sqlite3`, React 19 + shadcn/ui + Tailwind v4 + Vite, vitest, zod, lru-cache) is locked and not under review. Four new production dependencies are needed: `@modelcontextprotocol/sdk` (MCP server — already installed at v1.27.1), `better-auth` (auth + API key management, has `toNodeHandler()` for raw Node HTTP and a `better-sqlite3` adapter), `jose` (JWT + HMAC-SHA256 webhook signatures, ESM-first), and `ulid` (sortable IDs for workspace/key records). Two dev dependencies are added: `@stoplight/spectral-cli` (OpenAPI spec linting in CI) and `openapi-typescript` (runtime-free type generation from the hand-written YAML spec).

**Core technologies (new additions only):**
- `@modelcontextprotocol/sdk` ^1.28.0: MCP server via `StreamableHTTPServerTransport` — official SDK, SSE deprecated 2025-03-26, Streamable HTTP is required
- `better-auth` ^1.5.6: User registration, API key plugin, `toNodeHandler()` mounts on existing `http.createServer`, SQLite adapter reuses existing DB infrastructure
- `jose` ^6.2.2: JWT signing + HMAC-SHA256 webhook signatures — ESM-first, unlike `jsonwebtoken` which is CommonJS-only
- `ulid` ^3.0.2: Sortable unique IDs — better than uuid for SQLite row ordering, zero dependencies
- `@stoplight/spectral-cli` ^6.15.0 (dev): OpenAPI 3.1 spec validation in CI — de facto standard
- `openapi-typescript` ^7.13.0 (dev): Type-check raw HTTP handlers against the hand-written YAML spec, no client generation overhead

**Explicitly excluded:** Express/Fastify/Hono (would require migrating 30+ admin routes), tsoa/swagger-jsdoc (require class decorators), `jsonwebtoken` (CommonJS-only), `passport.js` (unmaintained, no API key support), `rate-limiter-flexible` (existing token bucket sufficient), `node-cron` (no periodic jobs needed).

### Expected Features

Research identifies a clear v2.0 MVP scope ("Docker Alpha") and a v2.1 scope ("SaaS Beta"). Do not conflate them.

**Must have for v2.0 (table stakes — block shipping Docker):**
- Config abstraction — standalone JSON replacing `openclaw.json`, read via `CHATLYTICS_CONFIG_PATH` env var
- Standalone HTTP server — container boots, serves admin panel, zero OpenClaw dependency at runtime
- API key authentication — single static key from env var (`CHATLYTICS_API_KEY`), `ctl_` prefix, stored hashed
- WAHA self-registration — `standalone.ts` registers its webhook URL with WAHA on startup (critical — nothing works without this)
- Public REST API — `/api/v1/send`, `/api/v1/messages`, `/api/v1/search`, `/api/v1/directory`, `/api/v1/sessions`, `/api/v1/mimicry/status`
- OpenAPI 3.1 spec — hand-written YAML, served at `/openapi.yaml`, validated with Spectral in CI
- MCP server — 8-10 consolidated tools via `StreamableHTTPServerTransport`, stdio mode for `npx chatlytics-mcp`
- Docker container — single image, env var config, named volume for SQLite data persistence
- Webhook forwarding — inbound messages to registered callback URLs with HMAC-SHA256 signatures and exponential backoff retry

**Should have for v2.1 (after Docker Alpha validates architecture):**
- User registration (email + password) via `better-auth`
- Workspace creation + QR code pairing flow (self-service onboarding)
- API key management in dashboard (create, rotate, revoke)
- Multi-tenant process-per-workspace isolation
- Webhook subscription management UI
- Integration setup wizard (MCP config snippet, SKILL.md download, curl example)
- MCP resources (`chatlytics://contacts`, `chatlytics://groups`, `chatlytics://sessions`, `chatlytics://mimicry`)

**Defer to v2.2+:**
- SDK clients (TypeScript + Python, auto-generated via `@hey-api/openapi-ts`)
- Usage billing and plan limits
- Team management (multiple users per workspace)
- MCP push notifications for inbound messages (ecosystem not ready in 2026 — webhooks only)
- Shared WAHA instance multi-tenancy (process-per-tenant required first)

**Competitive differentiators already built — just expose them:**
- Server-side human mimicry (transparent to API callers) — no competitor has this
- Policy engine with per-contact rules and allow-lists — no competitor has this
- FTS5 directory search — competitors rely on slow WAHA search endpoints
- SKILL.md distribution format — unique to this ecosystem

**MCP tool count:** Target 8-10 consolidated tools. Do not map all 109 actions 1:1. Recommended set: `send_message`, `send_media`, `send_reaction`, `send_poll`, `read_messages`, `search`, `get_directory`, `manage_group`, `get_status`, `update_settings`.

### Architecture Approach

The architecture is additive, not rewriting. A new `standalone.ts` entry point boots the existing `http.createServer` in `monitor.ts` without loading `channel.ts` (the OpenClaw adapter). New route branches (`/mcp`, `/api/v1/`) are added to the existing dispatcher without touching the 30+ existing admin routes. A shared `deps` object is passed to both `createMcpServer()` and `createApiRouter()` — no logic duplication between REST and MCP surfaces. Reply delivery in `inbound.ts` is abstracted via an `IReplyDeliverer` interface: OpenClaw mode injects the existing OC delivery pipeline; standalone mode injects `WebhookForwarder`.

**Major components and status:**
1. `standalone.ts` (NEW) — entry point: boots HTTP server, registers WAHA webhook, wires deps, skips OC plugin registration
2. `platform-types.ts` (NEW) — `IReplyDeliverer`, `StandaloneReplyPayload`, `isGroupJid()` — replaces SDK type imports
3. `account-utils.ts` (NEW) — ~25 lines replacing SDK account resolution (`DEFAULT_ACCOUNT_ID`, `normalizeAccountId`, `listConfiguredAccountIds`)
4. `request-utils.ts` (NEW) — `readRequestBodyWithLimit`, `isRequestBodyLimitError` — replacing SDK webhook-ingress utilities
5. `webhook-forwarder.ts` (NEW) — HMAC-signed delivery with exponential backoff, bounded queue, circuit breaker
6. `api-router.ts` (NEW) — `/api/v1/*` route handlers, API key middleware, shares deps with MCP server
7. `mcp-server.ts` (NEW) — `McpServer` factory with 8-10 tools, `StreamableHTTPServerTransport` on `/mcp`
8. `mcp-stdio.ts` (NEW) — stdio entry for `npx chatlytics-mcp`, thin proxy, no business logic
9. `monitor.ts` (MODIFY) — add `/mcp` and `/api/v1/` branches; swap 5 SDK imports for local equivalents
10. `inbound.ts` (MODIFY) — inject `IReplyDeliverer`, swap `isWhatsAppGroupJid` one-liner, localize `normalizeAccountId`
11. `accounts.ts` (MODIFY) — swap SDK account resolution imports for `account-utils.ts`
12. `channel.ts` + 15 core modules (NO CHANGE) — preserved exactly as-is

**Multi-tenant model:** v2.0 is single-process, single-workspace per container. v2.1 uses process-per-workspace with nginx routing by API key. Per-workspace file layout: `~/.chatlytics/workspaces/{workspaceId}/{directory.db, mimicry.db, analytics.db, standalone.json}`.

### Critical Pitfalls

1. **`inbound.ts` SDK decoupling without logic replacement** — 8+ SDK symbols contain real business logic (group policy resolution, DM access rules, reply formatting). Removing imports without re-implementing logic silently breaks inbound processing. Audit each symbol in `/usr/lib/node_modules/openclaw/dist/` before removal. All 594 tests must pass after each change.

2. **`monitor.ts` SDK imports cause container boot failure** — `monitor.ts` imports 6 SDK symbols at module load time. Any remaining when standalone boots causes module-not-found on startup. Container appears to boot but is non-functional. Run `grep -r "openclaw/plugin-sdk" src/` to verify zero results before exiting Phase 1.

3. **MCP SSE transport is deprecated** — MCP spec deprecated SSE on 2025-03-26. `SSEServerTransport` breaks under load balancers and fails with current Claude Code builds. Use `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js` from day one.

4. **WAHA webhook not self-registered on startup** — `standalone.ts` must call `POST /api/{session}/webhooks` explicitly. Outbound send works immediately (masking the bug); inbound silently delivers nothing. Health endpoint must include `webhook_registered: true/false` flag.

5. **OpenClaw plugin regression** — `channel.ts` and all core modules have DO NOT CHANGE markers earned through 50+ phases. Never modify `channel.ts` for standalone purposes. Never add `if (standalone)` mode branches to core modules. Use dependency injection exclusively.

6. **SQLite WAL corruption on networked Docker volumes** — WAL mode requires OS-level file locking that fails on EFS, GCS FUSE, and similar. Add startup write-test. Document that volumes must be local block storage.

7. **Webhook retry storms from slow consumer endpoints** — Unbounded queue growth when consumer responds slowly (not down). Fix: per-tenant bounded queue (max 500), 10s `AbortController` per attempt, circuit breaker after 5 consecutive timeouts.

## Implications for Roadmap

The dependency graph mandates this order: SDK decoupling blocks everything. Config abstraction and standalone entry point unlock Docker. REST API unlocks both MCP (reuses same deps) and OpenAPI spec. Auth and onboarding are v2.1 scope and must not delay Docker Alpha.

### Phase 1: SDK Decoupling + Standalone Foundation
**Rationale:** All subsequent phases import `monitor.ts` or `inbound.ts` which crash until SDK imports are replaced. Highest-risk phase — surgery on working code with 594 tests as the safety net.
**Delivers:** Zero `openclaw/plugin-sdk` imports outside `channel.ts` and `index.ts`. New: `platform-types.ts`, `account-utils.ts`, `request-utils.ts`. Modified: `monitor.ts`, `inbound.ts`, `accounts.ts`. Confirmed no-change: `config-schema.ts`, `normalize.ts`. All 594 tests pass. CHATLYTICS_CONFIG_PATH support verified in `config-io.ts`.
**Avoids:** monitor.ts boot crash pitfall, inbound.ts logic-removal pitfall, SQLite WAL corruption pitfall (Dockerfile design)
**Research flag:** None — direct source inspection complete, exact import lists documented

### Phase 2: Standalone Entry + Docker Container
**Rationale:** Once SDK is clean, `standalone.ts` can boot. This phase proves the container runs end-to-end before adding API surface.
**Delivers:** `standalone.ts` booting HTTP server, registering WAHA webhook, verifying registration, health endpoint with `webhook_registered` flag. `Dockerfile` multi-stage `node:22-alpine` (compile with `tsc`, no jiti in prod). Docker Compose with named volume. Container starts, admin panel loads, health endpoint returns healthy.
**Avoids:** WAHA webhook not self-registered pitfall, jiti-in-production tech debt, `better-sqlite3` Alpine native addon build issue (python3/make/g++ in builder stage)
**Research flag:** None — standard multi-stage Docker patterns

### Phase 3: Public REST API + OpenAPI Spec
**Rationale:** REST API precedes MCP (MCP tools reuse the same `deps` object). OpenAPI spec must be validated in CI from the moment the first route exists — spec drift is irreversible.
**Delivers:** `api-router.ts` with 6 route groups. API key middleware with `crypto.timingSafeEqual`. `openapi.yaml` hand-written, served at `/openapi.yaml`. `spectral lint` in CI. Swagger UI at `/docs`.
**Uses:** `openapi-typescript` for type-checking handlers against spec
**Avoids:** Spec drift, timing-attack on API key comparison, Express/tsoa anti-patterns

### Phase 4: Webhook Forwarding
**Rationale:** Inbound delivery completes the platform. Can parallelize with Phase 3 (no shared files). Both must complete before Phase 5 if `read_messages` is to have local message history.
**Delivers:** `webhook-forwarder.ts` with HMAC-SHA256 via `jose`, exponential backoff (1s/2s/4s), bounded queue (max 500), circuit breaker after 5 timeouts, 10s AbortController, dead-letter log. Webhook subscription stored in `standalone.json`.
**Avoids:** Retry storm pitfall, HMAC-regeneration-on-retry bug (original payload bytes + original timestamp), SSRF via internal callback URLs (RFC-1918 validation)

### Phase 5: MCP Server
**Rationale:** Depends on REST API deps object (Phase 3). MCP server is a thin consumer of same business functions — no new logic, new surface only.
**Delivers:** `mcp-server.ts` with 8-10 tools, `StreamableHTTPServerTransport` on `/mcp`, session map by `mcp-session-id` header. `mcp-stdio.ts` for `npx chatlytics-mcp`. Claude Code connects and sends a WhatsApp message via `send_message` tool.
**Avoids:** Deprecated SSE transport, second HTTP server anti-pattern, tool count explosion (cap at 10), MCP push notifications (use webhook as inbound channel — document explicitly)
**Research flag:** Verify `StreamableHTTPServerTransport` session cleanup on disconnect to prevent `mcpTransports` map leak

### Phase 6: Dashboard Auth + Onboarding (v2.1)
**Rationale:** v2.0 uses static API key from env var. Auth is a v2.1 concern — must not delay Docker Alpha. Implement after Phases 1-5 prove architecture stability.
**Delivers:** `better-auth` with `toNodeHandler()`, email/password registration, workspace creation, API key generation UI (show once, copy button, "I've saved this" confirm), QR code pairing with 20s auto-refresh.
**Uses:** `better-auth` ^1.5.6, `ulid` for workspace IDs, `jose` for API key JWTs
**Research flag:** Verify `better-auth` `toNodeHandler()` only intercepts `/auth/*` and does not swallow unmatched requests

### Phase 7: Multi-Tenant Process Isolation (v2.1)
**Rationale:** Process-per-workspace is the safe model. Shared-process risks cross-tenant panics and SQLite write contention. Implement only after Phase 6 (workspace records exist to route by).
**Delivers:** `workspace-registry.ts` (workspaceId → port map), `gateway-proxy.ts` (API key → workspace port lookup + proxy), per-workspace data paths, UUID-only workspace ID validation with `path.resolve()` guard.
**Avoids:** Path traversal via workspaceId, shared WAHA session collision (`ctl_{workspaceId}_{sessionName}` prefix), shared-process isolation failure
**Research flag:** nginx map vs Node.js proxy for workspace routing — depends on expected concurrent workspace count

### Phase 8: OpenClaw Thin Wrapper (v2.1 — optional, post-stability)
**Rationale:** Explicitly blocked until Phases 2-5 prove production stability for 30+ days. Current OpenClaw plugin is the primary deployment and must not regress.
**Delivers:** `channel.ts` refactored to HTTP client delegating to Chatlytics API. All 594 tests pass. Action response times remain < 300ms.
**Avoids:** Plugin regression — stop if any test fails, stop if latency increases materially
**Research flag:** OpenClaw gateway `handleAction()` timeout budget — verify before committing to HTTP round-trip architecture

### Phase Ordering Rationale

- Phase 1 first: `monitor.ts` and `inbound.ts` have SDK imports that crash on load — all other phases import these files
- Phase 2 before Phase 3: `standalone.ts` provides boot context (config path, WAHA registration, dep wiring) that REST handlers depend on
- Phase 3 before Phase 5: MCP tools call the same `deps` functions as REST handlers — implement once, surface twice
- Phase 4 parallel-compatible with Phase 3 but both complete before Phase 5 (for populated local message store)
- Phases 6-8 are strictly v2.1 scope — do not let them delay Docker Alpha
- Phase 8 explicitly gated on 30 days of production stability

### Research Flags

Phases needing deeper research during planning:
- **Phase 5 (MCP):** Verify `StreamableHTTPServerTransport` session cleanup behavior on client disconnect — potential `mcpTransports` map leak. Check `onsessionclose` callback in SDK source.
- **Phase 6 (Auth):** Verify `better-auth@1.5.6` `toNodeHandler()` integration with existing raw HTTP dispatcher — confirm it only intercepts `/auth/*`.
- **Phase 7 (Multi-Tenant):** Determine nginx vs Node.js proxy for workspace routing based on expected concurrent workspace count at launch.

Phases with standard patterns (skip research-phase):
- **Phase 1 (SDK Decoupling):** Source inspection complete. Exact import lists and replacement implementations documented.
- **Phase 2 (Docker):** Standard multi-stage `node:22-alpine` build. Known `better-sqlite3` native addon pattern.
- **Phase 3 (REST API + OpenAPI):** Well-documented. `spectral-cli` is one config file.
- **Phase 4 (Webhook Forwarding):** Industry-standard HMAC + retry patterns.
- **Phase 8 (Thin Wrapper):** Decision question, not research question.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified against npm registry 2026-03-28. MCP SDK already installed and inspected at v1.27.1. Version compatibility confirmed for all new additions. |
| Features | HIGH | MCP ecosystem research is current (2026). Competitor analysis covers WAHA, Whapi, Evolution API. MCP push notifications explicitly confirmed non-viable. |
| Architecture | HIGH | Based on direct source inspection of all 6 SDK-coupled files. Decoupling strategies have code-level detail with exact implementations. MCP SDK native Node.js HTTP confirmed. |
| Pitfalls | HIGH | Derived from direct codebase analysis. Timing attack, WAL corruption, retry storm, and SSE deprecation all verified with external sources. |

**Overall confidence:** HIGH

### Gaps to Address

- **`better-sqlite3` native addon in Alpine Docker:** Must be compiled inside the Alpine container (not copied from host). Requires `python3`, `make`, `g++` in builder stage. Verify build step before Phase 2 is declared done.
- **MCP session lifetime management:** Confirm whether SDK handles session cleanup on disconnect or if explicit cleanup is needed to prevent `mcpTransports` map growth. Inspect `onsessionclose` or equivalent in SDK source at Phase 5 start.
- **`config-io.ts` CHATLYTICS_CONFIG_PATH support:** Research notes it "may need" this env var added. Inspect at Phase 1 start to confirm current state before assuming no-change.
- **Activity scanner in standalone mode:** The activity scanner polls WAHA periodically. Confirm it initializes correctly from `standalone.ts` or add null-safe guard — it was not included in the 6 SDK-coupled files but depends on runtime context.

## Sources

### Primary (HIGH confidence)
- Direct source inspection — `src/channel.ts`, `src/inbound.ts`, `src/monitor.ts`, `src/accounts.ts`, `src/config-schema.ts`, `src/normalize.ts`, `src/adapter.ts` (2026-03-28)
- `node_modules/@modelcontextprotocol/sdk` v1.27.1 — `server/streamableHttp.d.ts`, `server/mcp.d.ts`, `server/stdio.d.ts`
- MCP Transports specification (2025-11-25) — StreamableHTTP as current standard, SSE deprecation confirmed
- `npm show` CLI — all package versions verified against npm registry 2026-03-28
- `better-auth` GitHub — `toNodeHandler()`, SQLite adapter, API key plugin confirmed
- `@stoplight/spectral-cli` npm — OAS 3.1 ruleset, CI integration confirmed

### Secondary (MEDIUM confidence)
- Block's Playbook for Designing MCP Servers — tool consolidation (30+ → 2 tools for Linear)
- SQLite WAL mode Docker volume documentation — WAL corruption on networked filesystems
- WhatsApp MCP ecosystem survey (PulseMCP, 12,870+ servers) — competitor landscape
- WorkOS multi-tenant SaaS architecture guide — process-per-tenant rationale
- Building Reliable Webhook Delivery (2026) — retry, HMAC, failure handling patterns
- MCP push notifications analysis (2026) — confirmed non-viable: no major framework (LangChain, OpenAI SDK) handles server-push

### Tertiary (LOW confidence)
- tsx vs ts-node vs Bun 2026 comparison — tsx for dev, tsc for Docker production (community consensus)

---
*Research completed: 2026-03-28*
*Ready for roadmap: yes*
