# Phase 60: Public REST API + OpenAPI + CLI — Research

**Researched:** 2026-03-28
**Domain:** Node.js HTTP server routing, OpenAPI 3.1, Spectral linting, Swagger UI, CLI tooling
**Confidence:** HIGH

## Summary

Phase 60 extends the raw Node.js HTTP server in `monitor.ts` with a `/api/v1/` route group protected by Bearer token auth (`ctl_xxx` prefix). All implementation stays in the same pattern as existing admin routes — no framework added. The OpenAPI spec is hand-authored YAML (served at `/openapi.yaml`) because code-gen from raw Node.js routes adds more complexity than it saves. Swagger UI is served via the `swagger-ui-dist` npm package bundled at build time (no CDN dependency). The CLI is a single TypeScript file compiled with the existing TypeScript setup, using `commander` for subcommands and `chalk` + `cli-table3` for output.

The existing `requireAdminAuth` function in `monitor.ts` (Phase 34, SEC-01) already uses `timingSafeEqual` and covers the pattern for the new `/api/v1/` auth guard. The new auth function should be a separate guard (`requirePublicApiAuth`) using a different config key (`channels.waha.publicApiKey`) to keep the admin token and the public API token independent.

**Primary recommendation:** Raw Node.js routes matching the existing admin route pattern, hand-authored OpenAPI 3.1 YAML, `swagger-ui-dist` for /docs, `commander` for CLI, Spectral in a pre-commit/CI lint script.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — no locked decisions from discuss phase.

### Claude's Discretion
All implementation choices at Claude's discretion:
- API key format and storage (e.g., `ctl_xxx` prefix, stored in config or separate file)
- Route handler pattern (express-style middleware or raw http.IncomingMessage)
- OpenAPI spec generation (manual YAML vs code-gen from routes)
- CLI framework choice (Commander.js, yargs, or custom)
- Swagger UI serving approach (static files vs CDN)

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| API-01 | REST endpoints for send, read messages, search, directory, sessions, mimicry status under /api/v1/ | Existing send.ts + directory.ts exports directly usable; pattern matches existing /api/admin/ routes |
| API-02 | API key authentication via Bearer ctl_xxx header with timing-safe comparison | `timingSafeEqual` already imported and used in monitor.ts — pattern copy for new guard |
| API-03 | OpenAPI 3.1 spec at /openapi.yaml, Spectral lint in CI | Hand-authored YAML served as static file; Spectral CLI v6.15.0 via npx in lint script |
| API-04 | CORS headers for dashboard cross-origin requests | Set in route response headers for /api/v1/* and /openapi.yaml — 4 standard CORS headers |
| CLI-01 | `npx chatlytics` CLI with subcommands send, read, search, groups, contacts, status | Commander.js 14.0.3 — `bin` field in package.json, separate `src/cli.ts` entry |
| CLI-02 | CLI reads API key from CHATLYTICS_API_KEY env var or --api-key flag | Commander global option + process.env fallback |
| CLI-03 | CLI reads server URL from CHATLYTICS_URL env var or --url flag (default http://localhost:8050) | Commander global option + process.env fallback with default |
| CLI-04 | Human-friendly color + tables, plus --json flag | chalk 5.6.2 (ESM), cli-table3 0.6.5; --json global flag skips formatting |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `node:http` | built-in | HTTP server (already used) | No framework needed — existing route pattern is consistent |
| `node:crypto` `timingSafeEqual` | built-in | Timing-safe token comparison | Already imported in monitor.ts |
| `yaml` | 2.8.3 (already in deps) | Serve openapi.yaml from TypeScript object | Already a project dependency |
| `swagger-ui-dist` | 5.32.1 | Serve Swagger UI static files at /docs | Bundles self-contained UI, no CDN needed |
| `commander` | 14.0.3 | CLI subcommand framework | Mature, typed, widely used for Node.js CLIs |
| `chalk` | 5.6.2 | Colored terminal output | ESM-only v5 matches project `"type":"module"` |
| `cli-table3` | 0.6.5 | Table output in terminal | Lightweight, no extra deps |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@stoplight/spectral-cli` | 6.15.0 | OpenAPI lint in CI/pre-push | npx run in test/CI script, not a runtime dep |

**Installation:**
```bash
npm install swagger-ui-dist commander chalk cli-table3
npm install --save-dev @stoplight/spectral-cli
```

**Version verification (checked 2026-03-28):**
- swagger-ui-dist: 5.32.1
- commander: 14.0.3
- chalk: 5.6.2
- cli-table3: 0.6.5
- @stoplight/spectral-cli: 6.15.0

## Architecture Patterns

### Recommended Project Structure
```
src/
├── api-v1.ts            # /api/v1/ route handlers (new)
├── api-v1-auth.ts       # requirePublicApiAuth() guard (new)
├── cli.ts               # npx chatlytics entry point (new)
├── openapi.yaml         # Hand-authored OpenAPI 3.1 spec (new, served as static)
├── monitor.ts           # existing — wire /api/v1/ + /openapi.yaml + /docs routes
└── config-schema.ts     # add publicApiKey field (optional, new)
```

### Pattern 1: /api/v1/ Route Wiring in monitor.ts

Existing pattern — copy the admin route guard shape:

```typescript
// NEW: Public API auth guard — separate from adminToken
// Source: mirrors requireAdminAuth() in monitor.ts (Phase 34, SEC-01)
function requirePublicApiAuth(req: IncomingMessage, res: ServerResponse, coreCfg: CoreConfig): boolean {
  const token = (coreCfg.channels?.waha as any)?.publicApiKey
    ?? process.env.CHATLYTICS_API_KEY;
  if (!token) return true; // No key configured = open (backward compat)
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    writeJsonResponse(res, 401, { error: 'Authorization required' });
    return false;
  }
  const provided = Buffer.from(authHeader.slice(7));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    writeJsonResponse(res, 401, { error: 'Invalid API key' });
    return false;
  }
  return true;
}
```

### Pattern 2: CORS Headers

Applied to all `/api/v1/*`, `/openapi.yaml`, `/docs` responses:

```typescript
function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}
// OPTIONS preflight handler before auth guard
if (req.method === 'OPTIONS' && req.url?.startsWith('/api/v1/')) {
  setCorsHeaders(res);
  res.writeHead(204);
  res.end();
  return;
}
```

### Pattern 3: Serving swagger-ui-dist

```typescript
import { join as pathJoin } from 'node:path';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const swaggerUiDist = pathJoin(_require.resolve('swagger-ui-dist'), '../');

// Route: GET /docs
if (req.url === '/docs' || req.url === '/docs/') {
  const html = readFileSync(pathJoin(swaggerUiDist, 'index.html'), 'utf-8')
    .replace('https://petstore.swagger.io/v2/swagger.json', '/openapi.yaml');
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
  return;
}
// Serve swagger-ui-dist assets at /docs/assets/*
if (req.url?.startsWith('/docs/') && req.url !== '/docs/') {
  const assetFile = req.url.slice('/docs/'.length).split('?')[0];
  const filePath = pathJoin(swaggerUiDist, assetFile);
  // ... serve with appropriate mime type
}
```

### Pattern 4: Hand-authored OpenAPI 3.1 YAML

Keep the spec as `src/openapi.yaml`, read at startup, cache in memory, serve at `GET /openapi.yaml`. This avoids code-gen complexity and keeps the spec reviewable.

```typescript
// In monitor.ts startup (inside createWahaWebhookServer):
import { readFileSync } from 'node:fs';
const OPENAPI_YAML = readFileSync(new URL('./openapi.yaml', import.meta.url), 'utf-8');

// Route: GET /openapi.yaml
if (req.url === '/openapi.yaml' && req.method === 'GET') {
  setCorsHeaders(res);
  res.writeHead(200, { 'Content-Type': 'application/yaml' });
  res.end(OPENAPI_YAML);
  return;
}
```

### Pattern 5: Commander CLI Structure

```typescript
#!/usr/bin/env node
// src/cli.ts
import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';

const program = new Command('chatlytics')
  .version('1.20.0')
  .option('--url <url>', 'Server URL', process.env.CHATLYTICS_URL ?? 'http://localhost:8050')
  .option('--api-key <key>', 'API key', process.env.CHATLYTICS_API_KEY)
  .option('--json', 'Output machine-readable JSON');

program.command('send <message>')
  .option('--to <target>', 'Recipient name or JID')
  .option('--session <session>', 'WAHA session')
  .action(async (message, opts) => { ... });

program.command('search <query>')
  .action(async (query, opts) => { ... });

program.command('status')
  .action(async (opts) => { ... });

program.parseAsync(process.argv);
```

**package.json bin field (add):**
```json
"bin": {
  "chatlytics": "./src/cli.ts"
}
```

Since the project uses jiti for runtime TypeScript, the bin shebang runs directly. For npm-published usage, add a `bin/chatlytics.js` wrapper that invokes the TS file via `node --import ...` or a small jiti wrapper.

### Pattern 6: API-01 Endpoint Surface

Map directly to existing send.ts / directory.ts / health.ts exports:

| Route | Method | Source | Notes |
|-------|--------|--------|-------|
| `/api/v1/send` | POST | `sendWahaText()` + mimicry via `enforceMimicry()` | Use proxy-send pattern from proxy-send-handler.ts |
| `/api/v1/messages` | GET | `getWahaChatMessages()` | Requires `chatId` + `session` query params |
| `/api/v1/search` | GET | `DirectoryDb.searchContacts()` | Returns contacts + groups |
| `/api/v1/directory` | GET | `DirectoryDb` list methods | Mirrors `/api/admin/directory` |
| `/api/v1/sessions` | GET | `listEnabledWahaAccounts()` + `getHealthState()` | Session list + health |
| `/api/v1/mimicry` | GET | `getCapStatus()` | Read-only, matches Phase 57 admin route |

### Anti-Patterns to Avoid

- **Don't add Express/Fastify**: The server is raw Node.js by design. Mixing frameworks creates import issues with jiti and ESM. All existing routes work without a framework.
- **Don't put API key in query params**: Always Bearer header. Query params are logged.
- **Don't reuse adminToken for publicApiKey**: Keep them independent so admin access and API access can be rotated separately.
- **Don't CDN-fetch swagger-ui**: Docker deployments may be air-gapped. Bundle `swagger-ui-dist`.
- **Don't put CLI entry in src/ root if npm publish breaks it**: Add a `bin/chatlytics.mjs` wrapper that imports `../src/cli.js` to handle the CommonJS/ESM boundary on older npm versions.
- **Don't forget CORS preflight (OPTIONS)**: Admin panel sends preflight before Bearer requests. Must return 204 before the auth guard runs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal color | ANSI escape codes | `chalk` 5.x | Cross-platform, windows support, NO_COLOR aware |
| Table formatting | String padding | `cli-table3` | Column alignment, borders, overflow handling |
| OpenAPI lint | Custom YAML validator | `@stoplight/spectral-cli` | OAS3.1-specific rules, extensible ruleset |
| Swagger UI | Custom API explorer HTML | `swagger-ui-dist` | Maintained, interactive, standards-compliant |
| CLI subcommands | `process.argv` parsing | `commander` | Help text, option inheritance, typed |
| Timing-safe compare | `===` string compare | `node:crypto timingSafeEqual` | Prevents timing oracle on token length |

## Common Pitfalls

### Pitfall 1: chalk ESM Import
**What goes wrong:** `chalk` v5 is ESM-only. `import chalk from 'chalk'` works. `require('chalk')` throws.
**Why it happens:** Package changed to pure ESM in v5. This project is already `"type":"module"` so it's fine — but the bin wrapper must also be ESM.
**How to avoid:** Use `import chalk from 'chalk'` (default import). Don't destructure.
**Warning signs:** `ERR_REQUIRE_ESM` at runtime.

### Pitfall 2: swagger-ui-dist Path Resolution
**What goes wrong:** `__dirname` doesn't exist in ESM. Path to dist files fails.
**Why it happens:** The project uses `"type":"module"` — standard ESM.
**How to avoid:** Use `createRequire(import.meta.url).resolve('swagger-ui-dist')` then `dirname()` to get the package directory. Pattern already used for ADMIN_DIST in monitor.ts.
**Warning signs:** ENOENT on swagger-ui-dist assets at `/docs/`.

### Pitfall 3: CORS Preflight Blocked by Auth Guard
**What goes wrong:** Browser sends OPTIONS preflight with no Authorization header. Auth guard returns 401. Browser blocks the actual request.
**Why it happens:** CORS preflight is unauthenticated by spec.
**How to avoid:** Handle `req.method === 'OPTIONS'` BEFORE the auth guard. Return 204 with CORS headers.
**Warning signs:** Browser console shows `CORS policy: Response to preflight has invalid HTTP status code 401`.

### Pitfall 4: API Key Format Collision
**What goes wrong:** User sets the same token for `adminToken` and `publicApiKey`. Rotating one doesn't isolate the other.
**Why it happens:** Lazy config copy-paste.
**How to avoid:** Document in config-example.json that these are independent. Consider validating they differ at startup (soft warning, not hard error).

### Pitfall 5: Spectral Lint Fails on OAS 3.1 Discriminator Keywords
**What goes wrong:** `@stoplight/spectral-cli` flags valid OAS 3.1 `oneOf`/`anyOf` schemas as errors when using discriminator without `$ref`.
**Why it happens:** Some Spectral built-in rules are tuned for OAS 3.0.
**How to avoid:** Use `.spectral.yaml` ruleset that extends `spectral:oas` and override false-positive rules. Keep schemas simple (no polymorphism in v1).
**Warning signs:** `spectral lint` exits non-zero on valid schema.

### Pitfall 6: CLI bin Entry Point + npm publish
**What goes wrong:** `"bin": { "chatlytics": "./src/cli.ts" }` — npm-installed users get a `.ts` file they can't run without jiti.
**Why it happens:** Unlike the hpg6 deploy (jiti at runtime), npm-installed users have plain Node.js.
**How to avoid:** Add a `bin/chatlytics.mjs` shim that imports cli.ts via dynamic `import()` + a compile step, OR build the CLI to `dist/cli.mjs` with `tsc`/`esbuild` as part of `npm run build`. For now (pre-multi-tenant), the CLI targets localhost installs where jiti is available. Add a Wave 0 note that a proper build step is needed before npm publish.

### Pitfall 7: /api/v1/ Conflicts with /api/admin/ Auth Middleware
**What goes wrong:** The existing admin auth guard `if (req.url?.startsWith('/api/admin/') && !requireAdminAuth(...))` is fine — it doesn't touch `/api/v1/`. But if the metrics or rate-limit guards are naively extended to `startsWith('/api/')` they'd catch v1 routes too.
**How to avoid:** Keep `/api/v1/` auth as a separate block with its own guard, rate limiter, and metrics labels. Do not refactor existing admin blocks.

## Code Examples

### /api/v1/send handler sketch
```typescript
// Source: mirrors proxy-send-handler.ts pattern (Phase 55)
if (req.url === '/api/v1/send' && req.method === 'POST') {
  setCorsHeaders(res);
  if (!requirePublicApiAuth(req, res, opts.config)) return;
  const rawBody = await readRequestBodyWithLimit(req, DEFAULT_WEBHOOK_MAX_BODY_BYTES, DEFAULT_WEBHOOK_BODY_TIMEOUT_MS);
  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); } catch { writeJsonResponse(res, 400, { error: 'Invalid JSON' }); return; }
  const result = await handleProxySend({ body, cfg: opts.config });
  writeJsonResponse(res, result.status, result.body);
  return;
}
```

### Spectral config (.spectral.yaml)
```yaml
extends: ["spectral:oas"]
rules:
  operation-tag-defined: off  # Phase 60: tags not required in v1
```

### OpenAPI 3.1 YAML skeleton
```yaml
openapi: "3.1.0"
info:
  title: Chatlytics API
  version: "1.0.0"
  description: WhatsApp messaging API for AI agents
servers:
  - url: http://localhost:8050
    description: Local instance
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: ctl_xxx
security:
  - BearerAuth: []
paths:
  /api/v1/send:
    post:
      summary: Send a WhatsApp message
      operationId: sendMessage
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [chatId, session, text]
              properties:
                chatId: { type: string }
                session: { type: string }
                text: { type: string }
      responses:
        "200":
          description: Message sent
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok: { type: boolean }
                  waha: {}
        "401":
          description: Unauthorized
        "403":
          description: Blocked by mimicry gate
```

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v25.8.1 | — |
| `swagger-ui-dist` | /docs route | ✗ (not yet installed) | 5.32.1 | — |
| `commander` | CLI | ✗ (not yet installed) | 14.0.3 | — |
| `chalk` | CLI colors | ✗ (not yet installed) | 5.6.2 | — |
| `cli-table3` | CLI tables | ✗ (not yet installed) | 0.6.5 | — |
| `@stoplight/spectral-cli` | OpenAPI lint | ✗ (not yet installed) | 6.15.0 | `npx @stoplight/spectral-cli` in CI |
| `yaml` | openapi.yaml serving | ✓ | 2.8.3 | — (already in deps) |
| `zod` | Config schema extension | ✓ | 4.3.6 | — (already in deps) |

**Missing dependencies with no fallback:**
- `swagger-ui-dist`, `commander`, `chalk`, `cli-table3` — Wave 0 install task required.

**Missing dependencies with fallback:**
- `@stoplight/spectral-cli` — can use `npx @stoplight/spectral-cli` without a local install; add as devDependency for reproducibility.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | none — vitest auto-detected from package.json |
| Quick run command | `npm test -- --reporter=verbose tests/api-v1.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | /api/v1/send returns 200 with waha message ID | unit | `npm test -- tests/api-v1.test.ts` | ❌ Wave 0 |
| API-02 | Missing/wrong bearer returns 401, timing-safe comparison | unit | `npm test -- tests/api-v1-auth.test.ts` | ❌ Wave 0 |
| API-03 | /openapi.yaml returns valid YAML, Spectral passes | unit + lint | `npm test -- tests/openapi.test.ts && npx spectral lint src/openapi.yaml` | ❌ Wave 0 |
| API-04 | CORS headers present on /api/v1/* responses | unit | `npm test -- tests/api-v1.test.ts` | ❌ Wave 0 |
| CLI-01 | `chatlytics send "hello" --to "John"` calls /api/v1/send | unit | `npm test -- tests/cli.test.ts` | ❌ Wave 0 |
| CLI-02 | CHATLYTICS_API_KEY env var used as auth header | unit | `npm test -- tests/cli.test.ts` | ❌ Wave 0 |
| CLI-03 | CHATLYTICS_URL env var used as base URL | unit | `npm test -- tests/cli.test.ts` | ❌ Wave 0 |
| CLI-04 | --json flag outputs raw JSON, default outputs table | unit | `npm test -- tests/cli.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/api-v1.test.ts tests/api-v1-auth.test.ts tests/cli.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green (688+ tests) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/api-v1.test.ts` — covers API-01, API-04 (send, sessions, directory, messages, search)
- [ ] `tests/api-v1-auth.test.ts` — covers API-02 (401 on bad/missing key, timing-safe)
- [ ] `tests/openapi.test.ts` — covers API-03 (YAML parses, required fields present)
- [ ] `tests/cli.test.ts` — covers CLI-01 through CLI-04
- [ ] Install deps: `npm install swagger-ui-dist commander chalk cli-table3 && npm install --save-dev @stoplight/spectral-cli`

## Sources

### Primary (HIGH confidence)
- Codebase direct read: `src/monitor.ts`, `src/proxy-send-handler.ts`, `src/standalone.ts` — existing patterns verified
- `package.json` — existing deps confirmed (yaml 2.8.3, zod 4.3.6, vitest 4.0.18)
- npm registry (verified 2026-03-28): swagger-ui-dist 5.32.1, commander 14.0.3, chalk 5.6.2, cli-table3 0.6.5, @stoplight/spectral-cli 6.15.0

### Secondary (MEDIUM confidence)
- chalk v5 ESM-only behavior: well-documented breaking change from v4→v5, confirmed by package type field
- swagger-ui-dist path resolution: `createRequire` pattern is standard ESM workaround for resolving CJS package paths

### Tertiary (LOW confidence)
- Spectral OAS 3.1 rule edge cases around discriminator: based on known Spectral issue patterns, not freshly verified in docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified via npm registry
- Architecture: HIGH — patterns copied directly from existing working code in monitor.ts
- Pitfalls: HIGH (CORS, ESM chalk, swagger path) / MEDIUM (Spectral OAS 3.1 discriminator edge case)

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable libraries, 30-day window reasonable)
