# Stack Research

**Domain:** Standalone multi-tenant WhatsApp automation platform (Chatlytics v2.0)
**Researched:** 2026-03-28
**Confidence:** HIGH

---

## Context: What Already Exists (Do Not Re-evaluate)

The following stack is validated and in production (16,000+ LOC, 594 passing tests). These are not up for debate.

| Layer | Technology | Notes |
|-------|------------|-------|
| Runtime | TypeScript + Node.js 22 (ESM) | `"type": "module"`, tsx used by jiti for dev |
| HTTP Server | `http.createServer` (raw Node) | monitor.ts — self-contained, ~30 admin routes |
| Database | `better-sqlite3` ^11.10.0 | directory, mimicry, analytics — per-account instances |
| Admin SPA | React 19 + shadcn/ui + Tailwind CSS v4 + Vite v8 | Fully built, deployed |
| Testing | vitest ^4 | 594 passing, React Testing Library |
| Validation | `zod` ^4.3.6 | Config schema, inbound |
| Caching | `lru-cache` ^11.2.6 | Bounded LRU throughout |
| YAML | `yaml` ^2 | Rules engine |

**Do not replace any of the above.**

---

## New Additions Required for v2.0

These are the only new packages needed for the features listed in the milestone question.

### Core New Technologies

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@modelcontextprotocol/sdk` | ^1.28.0 | MCP server — tools, resources, prompts via StreamableHTTP + stdio | Official Anthropic TypeScript SDK. Only viable option for MCP protocol. v1.28.0 is current stable (v2 anticipated but not yet released). Peer dep on zod already satisfied by project's zod ^4.3.6. |
| `better-auth` | ^1.5.6 | User registration, email/password sessions, API key management | Has `toNodeHandler()` that mounts onto raw `http.createServer` — critical given existing server architecture. Built-in API key plugin (generate, hash, rotate, revoke). Has a `better-sqlite3` adapter so the existing DB infrastructure is reused. Most actively maintained TypeScript auth library in 2026 (weekly releases). |
| `@stoplight/spectral-cli` | ^6.15.0 | OpenAPI 3.1 spec linting and validation | De-facto standard for OpenAPI spec validation. Has built-in OAS 3.1 ruleset. PRD mandates hand-written YAML spec — spectral validates it without requiring Express or code decorators. Runs in CI with zero config. |
| `openapi-typescript` | ^7.13.0 | Generate TypeScript types from the hand-written OpenAPI spec | Runtime-free type generation. Keeps `/api/v1/` handler signatures in sync with the YAML spec. Does NOT generate a full client — only types, which is all that is needed to type-check the raw `http.createServer` route handlers. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `jose` | ^6.2.2 | JWT signing/verification, HMAC-SHA256 webhook signatures | Generate workspace API key JWTs; sign outbound webhook payloads with HMAC-SHA256 for verification. ESM-first — required since project is `"type": "module"`. |
| `ulid` | ^3.0.2 | Sortable unique IDs for workspace, API key, webhook subscription records | ULIDs are lexicographically sortable (useful for SQLite ordering). Zero dependencies. Same effort as uuid, better properties for row ordering. |
| `@hey-api/openapi-ts` | ^0.94.5 | Generate TypeScript + Python SDK clients from the OpenAPI spec | Only needed for Phase 7 (distribution/SDK clients). Do not add until that phase — it generates heavy client boilerplate and its output format moves between versions. |

### Development Tools (no install — run via npx)

| Tool | Purpose | Notes |
|------|---------|-------|
| `@modelcontextprotocol/inspector` | Visual debug UI for MCP server | `npx @modelcontextprotocol/inspector` — no local install needed. Use during Phase 3 to verify tool schemas, request/response shapes, and transport behavior. |

---

## Installation

```bash
# New production dependencies
npm install @modelcontextprotocol/sdk better-auth jose ulid

# New dev dependencies
npm install -D @stoplight/spectral-cli openapi-typescript
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `better-auth` | Clerk / Auth0 | External SaaS — adds latency, vendor lock-in, cost at scale, and breaks self-hosted Docker deployments that have no internet. Better Auth is fully self-contained. |
| `better-auth` | Passport.js | Unmaintained ecosystem (last major release ~2019). No built-in API key support. Would require 5+ separate plugins wired manually. No ESM-first design. |
| `better-auth` | Custom JWT auth | Reinventing token rotation, session management, key revocation, CSRF protection — weeks of error-prone work. Better Auth ships all of it. |
| `@stoplight/spectral-cli` | `swagger-parser` | swagger-parser validates structure only. Spectral runs both schema validation and style/completeness rules. OAS 3.1 support is native in spectral, patchy in swagger-parser. |
| `@stoplight/spectral-cli` | Redocly CLI | Redocly includes bundler + preview + lint (heavy). Spectral is CI-focused, lighter, pure validation. |
| MCP StreamableHTTP transport | MCP SSE transport | SSE deprecated in MCP spec 2025-03-26. Multiple providers (Atlassian, Keboola) announcing hard cutoffs April–June 2026. Implement StreamableHTTP from the start; optionally add SSE fallback for backward compat. |
| `openapi-typescript` | `@hey-api/openapi-ts` | hey-api generates full client SDK code — heavyweight for a server-side type-checking use case. `openapi-typescript` generates only types, which is exactly what is needed to type-check raw `http` handlers without adding a framework. |
| `jose` | `jsonwebtoken` | `jsonwebtoken` is CommonJS-only with no native ESM support. The project is `"type": "module"`. `jose` is ESM-first, actively maintained, FIPS-compliant. |
| `ulid` | `uuid` | Both are trivially small. ULIDs add lexicographic sort ordering for free, useful for SQLite workspace and API key tables. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Express / Fastify / Hono | PRD explicitly says reuse `http.createServer`. Adding a framework means migrating 30+ existing admin routes, risking regressions on working code. The raw Node server already handles routing via if/switch. | Keep `http.createServer`; extend existing route dispatcher |
| `tsoa` / `swagger-jsdoc` | Both require Express or class-based controllers to auto-generate OpenAPI. Existing code is functional, not class-based. PRD explicitly specifies hand-written YAML. | Hand-write YAML, validate with spectral |
| `openapi-generator-cli` (Java) | Requires Java runtime in build environment. `@hey-api/openapi-ts` achieves the same result in Node. | `@hey-api/openapi-ts` deferred to Phase 7 |
| `passport.js` | No ESM support, no API key plugin, fragmented ecosystem, unmaintained. | `better-auth` |
| `helmet` | HTTP security headers middleware designed for Express. For raw Node, set headers manually in the response handler (5 lines). No dep needed. | Manual headers in monitor.ts |
| `dotenv` | Node 20+ has `--env-file` flag. Docker passes env vars directly. Adding dotenv for env loading is unnecessary. | `node --env-file=.env` in dev, Docker ENV in prod |
| `pino` / `winston` | Structured logging already fully implemented in `logger.ts` (JSON, child pattern, 594 tests depend on it). Do not replace. | Existing `logger.ts` |
| `rate-limiter-flexible` | Per-workspace rate limiting is a config enforcement layer, not a distributed rate limiter. The existing token bucket in `rate-limiter.ts` handles WAHA API calls. API-level limits can be enforced with simple counter logic against existing SQLite. | Extend existing `RateLimiter` or plain SQLite counters |
| `node-cron` / `cron` | No periodic jobs needed. Time gates check `Date.now()` inline on each send. No background scheduler required. | Inline time checks in existing send pipeline |

---

## Stack Patterns by Variant

**MCP transport — cloud/remote (api.chatlytics.ai/mcp):**
- Use `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`
- Mount on existing `http.createServer` under `/mcp` path — check `Authorization: Bearer ctl_xxx` before handing off to transport
- Single `McpServer` instance per workspace, created on first authenticated request

**MCP transport — local install (`npx chatlytics-mcp`):**
- Separate entry point `src/mcp-stdio.ts`
- Use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- Reads `CHATLYTICS_API_KEY` + `CHATLYTICS_BASE_URL` from env, proxies all tool calls to the HTTP API
- No business logic in this entry point — thin HTTP proxy only

**Auth — API surface (REST + MCP):**
- API keys: `Authorization: Bearer ctl_xxx` header — validate hash in SQLite via `better-auth` API key plugin before route handlers run
- Admin dashboard: session cookie via `better-auth` email/password flow, mounted under `/auth/*`
- Two separate middleware contexts: `apiKeyAuth` for `/api/v1/` and `/mcp`, `sessionAuth` for `/admin/`
- Store API keys hashed (SHA-256) — display raw key only once at generation time

**Docker — production:**
- Multi-stage build: `node:22-alpine` builder stage compiles TypeScript → `node:22-alpine` runtime stage runs compiled JS
- Do NOT use `--import=tsx` in production image — compile first with `tsc`, run output JS directly
- Single `EXPOSE 8050`, env vars: `WAHA_BASE_URL`, `WAHA_API_KEY`, `CHATLYTICS_API_KEY`
- Admin panel `dist/admin/` served as static files from same HTTP server process (existing behavior preserved)

**Multi-tenant (Phase 6):**
- No new dependencies needed — existing `accountId` pattern already scopes `DirectoryDb`, `MimicryDb`, `AnalyticsDb` per account
- Per-workspace file paths: `~/.chatlytics/workspaces/{workspaceId}/` — SQLite files isolated by directory
- Process isolation: `child_process.fork()` (built-in Node) or Docker-per-tenant — no new library
- WAHA session namespacing: prefix sessions with workspace ID (already supported via `tenantId` in `ResolvedWahaAccount`)

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@modelcontextprotocol/sdk@1.28.0` | `zod@4.x` | SDK requires zod as peer dep; project has zod ^4.3.6 — satisfied |
| `better-auth@1.5.6` | `better-sqlite3@11.x` | better-auth SQLite adapter wraps better-sqlite3 — already installed |
| `openapi-typescript@7.x` | `typescript@5.x` | Requires TS 5+; project has typescript ^5.9.3 |
| MCP StreamableHTTP | Claude Code, Claude Desktop | Both support StreamableHTTP as of early 2026; SDK also ships SSE for backward compat |
| `jose@6.x` | Node.js 22 ESM | ESM-only from v5+; project is `"type": "module"` — compatible |
| `better-auth@1.5.6` | Node.js 22 | Confirmed Node 18+ support per official docs |

---

## Sources

- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.28.0 confirmed, StreamableHTTP recommended (HIGH confidence)
- [MCP SSE Deprecation — fka.dev](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/) — SSE deprecated in spec 2025-03-26 (HIGH confidence)
- [MCP Transports official spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) — StreamableHTTP is current recommendation (HIGH confidence)
- [better-auth npm](https://www.npmjs.com/package/better-auth) — v1.5.6, `toNodeHandler()` for raw Node HTTP (HIGH confidence)
- [better-auth GitHub](https://github.com/better-auth/better-auth) — SQLite adapter, API key plugin confirmed (HIGH confidence)
- [@stoplight/spectral-cli npm](https://www.npmjs.com/package/@stoplight/spectral-cli) — v6.15.0, OAS 3.1 ruleset built-in (HIGH confidence)
- [openapi-typescript](https://openapi-ts.dev/) — v7.13.0, runtime-free types, OAS 3.1 (HIGH confidence)
- [tsx vs ts-node vs Bun 2026 — pkgpulse](https://www.pkgpulse.com/blog/tsx-vs-ts-node-vs-bun-2026) — tsx for dev, compile for Docker production (MEDIUM confidence)
- `npm show` CLI — version numbers verified locally against npm registry 2026-03-28 (HIGH confidence)

---

*Stack research for: Chatlytics v2.0 standalone platform*
*Researched: 2026-03-28*
