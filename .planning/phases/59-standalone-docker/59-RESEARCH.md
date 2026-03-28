# Phase 59: Standalone Entry + Docker - Research

**Researched:** 2026-03-28
**Domain:** Docker containerization, Node.js standalone entry point, ESM module bundling
**Confidence:** HIGH

## Summary

Phase 59 creates `src/standalone.ts` — a process entry point that boots the HTTP server (from `monitor.ts`), registers WAHA webhooks, and starts health checks without any OpenClaw gateway dependency. A `Dockerfile` and `docker-compose.yml` package this into a container that starts in under 30 seconds, serves the admin panel, and persists SQLite via a named volume.

The implementation is straightforward because Phase 58 already completed all the hard work: `monitorWahaProvider()` in `monitor.ts` is a self-contained async function that starts the server, registers webhooks, and returns a `{ stop }` handle. `standalone.ts` is a thin boot script that loads config, calls `monitorWahaProvider()`, and handles `SIGTERM`/`SIGINT` for graceful shutdown. The Dockerfile copies source + dist and runs via `node --import` or `tsx` (jiti is not available outside the gateway).

The `/health` success criterion requires `GET /health` returning `{ status: "ok", webhook_registered: true }`. Currently `/healthz` returns `"ok"` plaintext, and `/api/admin/health` returns the full health object. A new `/health` JSON route is needed in `monitor.ts` — a 3-line addition.

**Primary recommendation:** `standalone.ts` calls `monitorWahaProvider()` with config from `CHATLYTICS_CONFIG_PATH`. Dockerfile uses `node:22-slim`, multi-stage build compiles admin panel in stage 1, copies `src/` + `dist/` in stage 2, runs with `tsx` (already present as jiti alternative). Docker Compose mounts config via bind-mount and data via named volume.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion — infrastructure phase.

### Claude's Discretion
Use ROADMAP phase goal, success criteria, and codebase conventions to guide all decisions.

### Deferred Ideas (OUT OF SCOPE)
None — infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-04 | Docker container starts with env var config and serves admin panel | `monitorWahaProvider()` is fully self-contained; Dockerfile + Compose wire env vars; admin panel served from `dist/admin/` via existing static serving in `monitor.ts` |
| CORE-06 | SQLite databases persist via named Docker volume | `directory.ts`, `analytics.ts`, `mimicry-gate.ts` all use SQLite; DB files default to `~/.chatlytics/`; `CHATLYTICS_DATA_DIR` env var + Docker named volume mounts at that path |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 22-slim (Docker base) | Runtime | LTS; `node:22-slim` is the standard lean Node base image |
| tsx | ^4.x (already in node_modules transitively) | TypeScript runner for standalone | Executes `.ts` files without pre-compile; replaces jiti for standalone context |
| Docker | 29.x (host) | Containerization | Already installed on host |
| Docker Compose | v2 (host) | Service orchestration | Standard for single-service local dev |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | ^11.x (already dep) | SQLite persistence | Already used by `directory.ts`, `analytics.ts`, `mimicry-gate.ts` |
| node:fs/promises | built-in | Config directory creation | Create `~/.chatlytics/` on first start |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsx | Pre-compile TypeScript to JS | Pre-compile adds build complexity; `tsx` keeps the same jiti-like DX and is already used in Node ecosystem for ESM TypeScript; Docker image build is slightly larger |
| node:22-slim | node:22-alpine | Alpine has musl libc which can cause issues with `better-sqlite3` (native binding); slim (Debian) is safer |
| Named volume | Host bind-mount for data | Bind-mount requires host path management; named volume is portable |

**Installation:**
```bash
npm install --save-dev tsx
```

**Version verification:** tsx is used at runtime in Docker — install as devDependency and copy `node_modules` into image, OR install in image directly. Standard pattern: install in image.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── standalone.ts        # NEW: entry point — loads config, calls monitorWahaProvider()
├── monitor.ts           # EXISTING: add /health JSON route (3 lines)
├── platform-types.ts    # Phase 58 (existing)
├── account-utils.ts     # Phase 58 (existing)
├── request-utils.ts     # Phase 58 (existing)
└── ...
Dockerfile               # NEW: multi-stage build
docker-compose.yml       # NEW: service definition with volume
config-example.json      # EXISTING: document env var override
```

### Pattern 1: Standalone Entry Point
**What:** `src/standalone.ts` is a Node.js process entry — loads config from env, boots server, handles signals.
**When to use:** This is the only entry for standalone/Docker operation.
**Example:**
```typescript
// src/standalone.ts
import { readFile } from "node:fs/promises";
import { getConfigPath } from "./config-io.js";
import { monitorWahaProvider } from "./monitor.js";
import { DEFAULT_ACCOUNT_ID } from "./account-utils.js";
import type { CoreConfig } from "./types.js";

async function main() {
  const configPath = getConfigPath(); // respects CHATLYTICS_CONFIG_PATH
  const raw = await readFile(configPath, "utf-8");
  const config = JSON.parse(raw) as CoreConfig;

  const ac = new AbortController();
  const { stop } = await monitorWahaProvider({
    accountId: DEFAULT_ACCOUNT_ID,
    config,
    runtime: { log: undefined },
    abortSignal: ac.signal,
  });

  process.on("SIGTERM", async () => { ac.abort(); await stop(); process.exit(0); });
  process.on("SIGINT",  async () => { ac.abort(); await stop(); process.exit(0); });
}

main().catch((err) => { console.error("startup failed", err); process.exit(1); });
```

### Pattern 2: /health JSON Route (3-line addition to monitor.ts)
**What:** Standalone health endpoint that returns structured JSON matching the success criteria.
**When to use:** Docker HEALTHCHECK and external monitoring.
**Example:**
```typescript
// Add in monitor.ts request handler, before HEALTH_PATH check
if (req.url === "/health" && req.method === "GET") {
  const accounts = listEnabledWahaAccounts(opts.config);
  const allRegistered = accounts.every(a => getHealthState(a.session)?.webhook_registered ?? false);
  writeJsonResponse(res, 200, { status: "ok", webhook_registered: allRegistered });
  return;
}
```

### Pattern 3: Multi-Stage Dockerfile
**What:** Stage 1 builds the React admin panel (Vite); Stage 2 is the runtime image with source + built assets.
**When to use:** Avoids shipping Vite + React build tools in the runtime image.
**Example:**
```dockerfile
# Stage 1: build admin panel
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:admin

# Stage 2: runtime
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm install tsx
COPY src/ ./src/
COPY --from=builder /app/dist/admin/ ./dist/admin/
COPY index.ts ./

ENV NODE_ENV=production
EXPOSE 8050
CMD ["npx", "tsx", "src/standalone.ts"]
```

### Pattern 4: Docker Compose with Named Volume
**What:** `docker-compose.yml` that mounts config and persists data.
**When to use:** All Docker deployments.
**Example:**
```yaml
services:
  chatlytics:
    build: .
    ports:
      - "8050:8050"
    environment:
      - CHATLYTICS_CONFIG_PATH=/config/config.json
      - CHATLYTICS_DATA_DIR=/data
    volumes:
      - ./config.json:/config/config.json:ro
      - chatlytics-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8050/health"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 30s

volumes:
  chatlytics-data:
```

### Pattern 5: SQLite Data Directory via CHATLYTICS_DATA_DIR
**What:** All SQLite databases resolve their path from `CHATLYTICS_DATA_DIR` env var (or default `~/.chatlytics/`), enabling Docker volume persistence.
**When to use:** Container startup — ensures DBs land in the named volume.
**Key files that open SQLite:**
- `src/directory.ts` — `getDirectoryDb()` — needs data dir awareness
- `src/analytics.ts` — `getAnalyticsDb()` — needs data dir awareness
- `src/mimicry-gate.ts` — `getMimicryDb()` — needs data dir awareness

These currently hardcode `~/.chatlytics/` or use a config-relative path. Need to check each and add `CHATLYTICS_DATA_DIR` support.

### Anti-Patterns to Avoid
- **Running as root in Docker:** Use `USER node` in Dockerfile — better-sqlite3 native bindings work fine as non-root.
- **COPY . . without .dockerignore:** Copies `src/**/*.bak.*` files, `node_modules/`, etc. A `.dockerignore` is required.
- **Using jiti in standalone:** The gateway uses jiti for runtime TypeScript compilation. In standalone, use `tsx` or pre-compile. Do NOT try to use jiti outside the gateway context.
- **Running tsx in production with full devDependencies:** Install tsx specifically (not all devDeps) to keep image lean.
- **Hardcoding SQLite paths:** Any `Database(join(homedir(), ".chatlytics", "foo.db"))` call must check `CHATLYTICS_DATA_DIR` first — otherwise data lands outside the named volume on container restart.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript execution | Custom transpile step | `tsx` (or `ts-node --esm`) | tsx handles ESM + path aliases natively |
| Graceful shutdown | Custom drain logic | AbortController (already wired in `createWahaWebhookServer`) | Phase 39 already implemented graceful drain |
| Health endpoint | Custom health server | Add `/health` route to existing `createWahaWebhookServer` | Same port, no second server needed |
| Config loading | Custom parser | `getConfigPath()` + `readConfig()` from `config-io.ts` | Already handles CHATLYTICS_CONFIG_PATH, backups, mutex |

**Key insight:** `monitorWahaProvider()` already encapsulates everything — server start, webhook registration, health checks. `standalone.ts` is a 30-line wrapper that loads config and calls it.

## Common Pitfalls

### Pitfall 1: better-sqlite3 Native Binding Mismatch
**What goes wrong:** `better-sqlite3` includes a native `.node` binding compiled for the build machine's Node ABI. If the Docker image Node version differs from build machine, the binding fails at runtime with `Error: The module was compiled against a different Node.js version`.
**Why it happens:** `npm ci` on the host compiles for host Node; Docker image has different Node.
**How to avoid:** Run `npm ci` INSIDE the Docker image (in the Dockerfile), not on the host. The Dockerfile `RUN npm ci` step handles this.
**Warning signs:** `Error: The module '/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node' was compiled against a different Node.js version` in container logs.

### Pitfall 2: ESM + tsx path resolution
**What goes wrong:** `import "./config-io.js"` works with jiti (which strips `.js` extensions) but tsx may need explicit `.ts` vs `.js` handling.
**Why it happens:** The codebase uses `.js` extensions in imports (Node ESM convention) while source files are `.ts`. tsx handles this correctly — it remaps `.js` imports to `.ts` source files.
**How to avoid:** Use `tsx` (not `ts-node`). tsx specifically handles the `.js` → `.ts` remapping for ESM TypeScript.
**Warning signs:** `Cannot find module './config-io.js'` at startup.

### Pitfall 3: SQLite files outside the volume
**What goes wrong:** Container restarts cleanly but directory data, analytics, and mimicry state are gone.
**Why it happens:** SQLite files created at `~/.chatlytics/*.db` but volume mounted at `/data/`. The home directory inside the container (`/root` or `/home/node`) is ephemeral.
**How to avoid:** Add `CHATLYTICS_DATA_DIR` env var support to `getDirectoryDb()`, `getAnalyticsDb()`, and `getMimicryDb()`. Mount the Docker volume at that path.
**Warning signs:** Directory tab shows empty after container restart.

### Pitfall 4: Admin panel not found (dist/admin missing)
**What goes wrong:** Container starts but `/admin` returns 503 "Admin panel not available".
**Why it happens:** `dist/admin/index.html` not present in the runtime image.
**How to avoid:** Multi-stage build copies `dist/admin/` from builder stage. Verify with `COPY --from=builder /app/dist/admin/ ./dist/admin/`.
**Warning signs:** `503 Admin panel not available: dist/admin/index.html not found` response.

### Pitfall 5: webpack/Vite build fails for ESM packages
**What goes wrong:** `npm run build:admin` fails because some dependency uses Node-only APIs.
**Why it happens:** Vite bundles for browser; any server-side import accidentally pulled into admin bundle fails.
**How to avoid:** Admin panel source (`src/admin/`) should not import from `src/monitor.ts`, `src/directory.ts`, etc. It communicates via fetch. Current architecture is already clean on this.
**Warning signs:** Vite build errors about `node:fs`, `node:path`, `better-sqlite3` in admin bundle.

### Pitfall 6: /health vs /healthz route name conflict
**What goes wrong:** Success criteria says `GET /health` but existing code has `/healthz` (plaintext) and `/api/admin/health` (JSON).
**Why it happens:** `/healthz` was added early for Kubernetes-style liveness probes.
**How to avoid:** Add a NEW `/health` route that returns `{ status: "ok", webhook_registered: bool }`. Keep `/healthz` as-is (DO NOT REMOVE per existing comments). Both routes serve different consumers.
**Warning signs:** `GET /health` returns 404 or wrong content type.

## Code Examples

### Checking current SQLite path patterns
```typescript
// From src/directory.ts — getDirectoryDb() opens DB at:
// join(homedir(), ".chatlytics", "directory.db")
// Must be: process.env.CHATLYTICS_DATA_DIR ?? join(homedir(), ".chatlytics")

// Pattern to add to each db getter:
function getDataDir(): string {
  return process.env.CHATLYTICS_DATA_DIR ?? join(homedir(), ".chatlytics");
}
```

### .dockerignore (required)
```
node_modules/
dist/
src/**/*.bak.*
.planning/
*.png
*.yaml
*.json.bak.*
.git/
```

### Startup readiness check
The 30-second startup criterion is achievable: `monitorWahaProvider()` starts the HTTP server synchronously (via `server.listen()`), then webhook registration runs in a loop (non-blocking). Server is ready immediately; webhook_registered flips to true after WAHA responds (~1-2 seconds).

## Runtime State Inventory

> Not a rename/refactor phase — skip.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Dockerfile build + run | ✓ | 29.1.3 | — |
| Node.js | tsx runtime in container | ✓ | 25.8.1 (host) / 22 (image) | — |
| better-sqlite3 | directory, analytics, mimicry | ✓ | ^11.x (in package.json) | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts (root) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-04 | Container starts and serves admin panel | smoke | `docker compose up -d && curl -f http://localhost:8050/health` | ❌ Wave 0 (docker-compose.yml) |
| CORE-04 | `/health` returns `{ status: "ok", webhook_registered: bool }` | unit | `npx vitest run src/standalone.test.ts` | ❌ Wave 0 |
| CORE-06 | SQLite path respects `CHATLYTICS_DATA_DIR` | unit | `npx vitest run src/standalone.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/standalone.test.ts` — unit tests for `getDataDir()` env var resolution and `/health` route response shape
- [ ] `Dockerfile` — build artifact, created in Wave 1
- [ ] `docker-compose.yml` — service definition, created in Wave 1

## Sources

### Primary (HIGH confidence)
- Codebase read (`src/monitor.ts`, `src/health.ts`, `src/config-io.ts`, `src/platform-types.ts`, `src/account-utils.ts`) — direct inspection
- `package.json` — confirmed deps: better-sqlite3, zod, react; devDeps: vitest, typescript, vite
- Docker CLI `--version` on host — confirmed 29.1.3 available

### Secondary (MEDIUM confidence)
- tsx behavior with ESM `.js` imports — known to handle `.js`→`.ts` remapping correctly in Node ESM mode
- `node:22-slim` vs alpine for native modules — established community pattern for better-sqlite3

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project; Docker confirmed available
- Architecture: HIGH — `monitorWahaProvider()` is the exact integration point; read directly
- Pitfalls: HIGH — SQLite path issue identified by reading db getters; others from known Docker+better-sqlite3 patterns

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable domain)
