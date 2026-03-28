# Milestone v2.0 — Chatlytics Universal Agent Platform

**Generated:** 2026-03-28
**Purpose:** Team onboarding and project review

---

## 1. Project Overview

**Chatlytics** is a framework-agnostic WhatsApp automation platform. Any AI agent (Claude, GPT, custom) can send/receive WhatsApp messages through Chatlytics via REST API, MCP protocol, or CLI — with mimicry enforcement, policy controls, and directory features.

Previously an OpenClaw-only plugin (`waha-openclaw-channel`), v2.0 extracts the entire platform into a standalone Docker service that runs without any OpenClaw gateway dependency. The OpenClaw plugin becomes a thin client in a future phase.

**Target users:**
- AI agent developers who need WhatsApp messaging capabilities
- SaaS operators running multi-tenant WhatsApp automation
- Existing OpenClaw users (backward compatibility preserved via thin wrapper — Phase 66, gated)

**Milestone scope:** 8 of 9 phases completed. Phase 66 (OpenClaw Thin Wrapper) is gated on 30-day production stability.

---

## 2. Architecture & Technical Decisions

### New Architecture (v2.0)

```
                    ┌─────────────────────────────────────┐
                    │         Chatlytics Server            │
                    │     (standalone.ts / Docker)          │
                    │                                       │
  REST API ────────>│  /api/v1/*    (api-v1.ts)            │
  MCP Client ──────>│  /mcp         (mcp-server.ts)        │
  CLI ─────────────>│  via REST     (cli.ts)               │
  Webhooks ────────>│  /webhook/*   (monitor.ts)           │
  Admin Panel ─────>│  /admin       (React SPA)            │
  Auth ────────────>│  /api/auth/*  (better-auth)          │
                    │                                       │
                    │  ┌─── Single-Tenant ──┐              │
                    │  │ monitorWahaProvider │              │
                    │  └────────────────────┘              │
                    │  ┌─── Multi-Tenant ───────────────┐  │
                    │  │ WorkspaceGateway (parent)       │  │
                    │  │  ├─ WorkspaceProcess (child 1)  │  │
                    │  │  ├─ WorkspaceProcess (child 2)  │  │
                    │  │  └─ ...                         │  │
                    │  └────────────────────────────────┘  │
                    │                                       │
                    │          ↕ WAHA HTTP API              │
                    └───────────┬─────────────────────────┘
                                │
                    ┌───────────▼─────────────────────────┐
                    │     WAHA Server (port 3004)           │
                    │     WhatsApp Web Protocol             │
                    └─────────────────────────────────────┘
```

### Key Decisions

- **No framework for HTTP server** — Raw Node.js `http.createServer`, same pattern as existing monitor.ts. No Express/Fastify. Keeps the dependency footprint minimal and avoids middleware complexity.
  - Phase: 60 (REST API)

- **better-auth for authentication** — SQLite adapter, email+password provider, @better-auth/api-key plugin for API key management with show-once semantics.
  - Phase: 63 (Dashboard Auth)

- **child_process.fork for multi-tenant isolation** — Not worker_threads (shares V8 heap, `process.exit()` kills parent). Each workspace gets its own Node.js process with separate `CHATLYTICS_DATA_DIR`.
  - Phase: 64 (Multi-Tenant)

- **CHATLYTICS_DATA_DIR as the isolation lever** — All three SQLite singletons (directory, analytics, mimicry) read `getDataDir()`. Setting the env var per-workspace scopes all data automatically — zero changes to existing modules.
  - Phase: 59, 64

- **MCP via @modelcontextprotocol/sdk v1.28** — StreamableHTTPServerTransport (stateless mode) for HTTP, StdioServerTransport for CLI. 10 tools + 5 resources.
  - Phase: 62 (MCP Server)

- **OpenAPI 3.1 spec — hand-authored YAML** — Not code-gen. Reviewable, no build step. Spectral lint in CI.
  - Phase: 60 (REST API)

- **HMAC-SHA256 webhook signatures** — Reuses publicApiKey as signing secret. `X-Chatlytics-Signature: sha256=<hex>` matching GitHub webhook convention.
  - Phase: 61 (Webhook Forwarding)

- **Commander.js for CLI** — `npx chatlytics` with 6 subcommands. chalk + cli-table3 for output. `--json` flag for scripting.
  - Phase: 60 (CLI)

---

## 3. Phases Delivered

| Phase | Name | Status | Summary |
|-------|------|--------|---------|
| 58 | SDK Decoupling | ✅ Complete | Zero openclaw/plugin-sdk imports outside channel.ts/index.ts. Created platform-types.ts, account-utils.ts, request-utils.ts. |
| 59 | Standalone Entry + Docker | ✅ Complete | standalone.ts boots without OpenClaw. Dockerfile (multi-stage, node:22-slim), docker-compose.yml with named volume for SQLite persistence. |
| 60 | Public REST API + OpenAPI + CLI | ✅ Complete | 6 REST endpoints under /api/v1/, Bearer auth with timingSafeEqual, openapi.yaml, Swagger UI at /docs, `npx chatlytics` CLI. |
| 61 | Webhook Forwarding | ✅ Complete | HMAC-signed delivery to callback URLs, exponential backoff (1s/2s/4s), per-URL circuit breaker, admin CRUD routes. |
| 62 | MCP Server | ✅ Complete | 10 MCP tools, 5 resources at chatlytics:// URIs, HTTP transport on /mcp, stdio mode for npx chatlytics-mcp. |
| 63 | Dashboard Auth + Onboarding | ✅ Complete | better-auth registration, QR code pairing flow, API key management (show-once, rotate), integration wizard (MCP/REST/SKILL.md). |
| 64 | Multi-Tenant Process Isolation | ✅ Complete | child_process.fork per workspace, per-workspace SQLite, WAHA session namespacing (ctl_{workspaceId}_{session}), API gateway routing by key. |
| 65 | Admin Standalone + Distribution | ✅ Complete | Workspace CRUD backend + UI, SKILL.md v4.0.0 (framework-agnostic), landing page, API docs site. |
| 66 | OpenClaw Thin Wrapper | ⏸ Gated | Requires 30-day production stability before refactoring channel.ts to HTTP client. |

---

## 4. Requirements Coverage

### Core Extraction (6/6) ✅
- ✅ CORE-01: Standalone process boots without OpenClaw SDK
- ✅ CORE-02: CHATLYTICS_CONFIG_PATH env var support
- ✅ CORE-03: WAHA webhook self-registration on startup
- ✅ CORE-04: Docker container with admin panel
- ✅ CORE-05: Health endpoint with webhook_registered field
- ✅ CORE-06: SQLite persistence via Docker named volume

### Public API (4/4) ✅
- ✅ API-01: REST endpoints for send, messages, search, directory, sessions, mimicry
- ✅ API-02: Bearer auth with timing-safe comparison
- ✅ API-03: OpenAPI 3.1 spec + Spectral lint + Swagger UI
- ✅ API-04: CORS headers for dashboard

### MCP Server (5/5) ✅
- ✅ MCP-01: 10 consolidated MCP tools
- ✅ MCP-02: Streamable HTTP transport on /mcp
- ✅ MCP-03: stdio transport for npx chatlytics-mcp
- ✅ MCP-04: Resources at chatlytics:// URIs
- ✅ MCP-05: Recovery hints in error responses

### CLI Tool (4/4) ✅
- ✅ CLI-01: npx chatlytics with 6 subcommands
- ✅ CLI-02: CHATLYTICS_API_KEY env var
- ✅ CLI-03: CHATLYTICS_URL env var
- ✅ CLI-04: Human-friendly + --json output

### Webhook Forwarding (4/4) ✅
- ✅ HOOK-01: Inbound forwarding to callback URLs
- ✅ HOOK-02: HMAC-SHA256 signatures
- ✅ HOOK-03: Exponential backoff + circuit breaker
- ✅ HOOK-04: Subscription config storage

### Auth & Onboarding (6/6) ✅
- ✅ AUTH-01: Email + password registration
- ✅ AUTH-02: Workspace creation
- ✅ AUTH-03: QR code pairing flow
- ✅ AUTH-04: API key generation (show-once)
- ✅ AUTH-05: API key rotation
- ✅ AUTH-06: Integration setup wizard

### Multi-Tenant (4/4) ✅
- ✅ TENANT-01: Crash containment via process isolation
- ✅ TENANT-02: Per-workspace SQLite databases
- ✅ TENANT-03: Session namespacing
- ✅ TENANT-04: API gateway routes by key

### Admin & Distribution (4/4 + 1 partial) ✅
- ✅ ADMIN-01: Standalone admin auth
- ✅ ADMIN-02: Workspace management UI
- ✅ SKILL-01: SKILL.md v4.0.0 framework-agnostic
- ✅ SITE-01: Landing page
- ✅ SITE-02: API documentation site

### Backward Compatibility (0/3) — Gated
- ⏸ COMPAT-01: OpenClaw thin wrapper (Phase 66, 30-day gate)
- ⏸ COMPAT-02: Action name preservation (Phase 66)
- ⏸ COMPAT-03: Admin route preservation (Phase 66)

**Total: 33/36 requirements met (92%). 3 deferred to Phase 66.**

---

## 5. Key Decisions Log

| # | Decision | Phase | Rationale |
|---|----------|-------|-----------|
| 1 | Raw Node.js HTTP (no Express) | 60 | Existing 2000+ line monitor.ts uses raw http. Adding a framework would require rewriting all existing routes. |
| 2 | better-auth (not Clerk, Auth0) | 63 | SQLite-native, self-hosted, no external dependency. @better-auth/api-key provides show-once semantics built-in. |
| 3 | child_process.fork (not workers) | 64 | worker_threads share V8 heap — process.exit() in a worker kills the parent. Fork gives true memory isolation. |
| 4 | CHATLYTICS_DATA_DIR env var | 59/64 | Single env var scopes all 3 SQLite singletons. Zero changes to directory.ts/analytics.ts/mimicry-gate.ts. |
| 5 | node:22-slim (not Alpine) | 59 | better-sqlite3 native bindings require glibc. Alpine uses musl → build failures. |
| 6 | tsx for Docker runtime (not jiti) | 59 | jiti is gateway-specific (path-hash cache). tsx is standalone-compatible. |
| 7 | Stateless MCP transport | 62 | No session map needed. Each request creates fresh McpServer — simpler, no state cleanup. |
| 8 | publicApiKey as HMAC secret | 61 | Operators already have this key. Avoids a separate signing secret in config. |
| 9 | Sequential webhook → parallel | Review | Promise.allSettled for independent subscriptions. One slow endpoint doesn't block others. |
| 10 | checkGroupMembership moved to send.ts | 59 | Breaks transitive import chain: standalone→monitor→inbound→channel→openclaw. Docker crashed without this. |

---

## 6. Tech Debt & Deferred Items

### Phase 66 Gate
- OpenClaw thin wrapper deferred until Docker Alpha is production-stable for 30 days
- COMPAT-01, COMPAT-02, COMPAT-03 requirements pending

### Known Code Patterns to Address
- `as Record<string, unknown>` cast chains on config access (6+ files) — should be a typed accessor
- Module-scope side effects in auth.ts (mkdirSync + Database at import time)
- No schema validation on JSON.parse in 5 files (standalone.ts, api-v1.ts, etc.)
- botJidCache in monitor.ts has TTL but no max-size cap
- Swagger UI and admin panel static files cached in memory (good for perf, grows with file count)

### Visual Verification Deferred
- Admin panel auth flow (login → register → workspace setup) needs browser testing
- QR code pairing flow needs live WAHA connection
- API keys tab (show-once dialog) needs visual confirmation
- Integration wizard needs end-to-end test with real MCP client

---

## 7. Getting Started

### Run the Project

**Docker (recommended):**
```bash
cp config-example.json config.json  # fill in WAHA credentials
docker compose up -d
curl http://localhost:8050/health
```

**Local development:**
```bash
npm install --legacy-peer-deps
CHATLYTICS_CONFIG_PATH=./config.json npx tsx src/standalone.ts
```

### Key Directories

| Path | Purpose |
|------|---------|
| `src/` | All TypeScript source (loaded by tsx at runtime) |
| `src/admin/` | React admin panel (Vite + shadcn/ui + Tailwind) |
| `skills/` | 10 modular skill files for LLM agent documentation |
| `docs/site/` | Landing page + API docs (static HTML) |
| `tests/` | Additional test files (vitest) |

### Tests

```bash
npx vitest run           # 785 tests, ~10s
npx vitest run --bail 1  # fast fail mode
```

### Where to Look First

1. **`src/standalone.ts`** — Docker entry point, boots the HTTP server
2. **`src/monitor.ts`** — HTTP server, all route handling, webhook processing
3. **`src/api-v1.ts`** — REST API route handlers
4. **`src/mcp-server.ts`** — MCP tool/resource definitions
5. **`src/workspace-manager.ts`** — Multi-tenant process orchestration
6. **`src/auth.ts`** — better-auth instance and database initialization
7. **`SKILL.md`** — What the LLM agent sees (v4.0.0, framework-agnostic)

### API Quick Start

```bash
# Send a message
curl -X POST http://localhost:8050/api/v1/send \
  -H "Authorization: Bearer ctl_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"chatId": "972544329000@c.us", "text": "Hello from Chatlytics!"}'

# CLI
npx chatlytics send "Hello" --to "972544329000@c.us" --api-key ctl_xxx

# MCP (Claude Code)
claude mcp add --transport http chatlytics http://localhost:8050/mcp
```

---

## Stats

- **Timeline:** 2026-03-07 → 2026-03-28 (21 days)
- **Phases:** 8 / 9 complete (Phase 66 gated)
- **Requirements:** 33 / 36 met (92%)
- **Commits:** 895
- **Files changed:** 754 (+163,063 / -1,280)
- **Tests:** 785 passing
- **Contributors:** Omer Nesher + Claude (autonomous GSD workflow)
