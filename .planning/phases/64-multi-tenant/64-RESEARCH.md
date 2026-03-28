# Phase 64: Multi-Tenant Process Isolation - Research

**Researched:** 2026-03-28
**Domain:** Node.js child_process isolation, per-workspace SQLite scoping, WAHA session namespacing, API gateway routing
**Confidence:** HIGH

## Summary

Phase 64 adds crash isolation between workspaces by running each workspace in its own `child_process.fork()` child. The parent process acts as a gateway: it resolves the API key to a workspaceId, then HTTP-proxies the request to the child's dynamically allocated port.

The key insight is that the existing `getDataDir()` function in `data-dir.ts` already reads from `CHATLYTICS_DATA_DIR`. Setting that env var to `{baseDataDir}/{workspaceId}` when forking the child process causes all SQLite singletons (`directory.ts`, `mimicry-gate.ts`, `analytics.ts`) to automatically land in workspace-scoped paths — no changes required in those modules.

`directory.ts` already accepts a `tenantId` parameter in `getDirectoryDb()` but the env var approach makes that irrelevant for the workspace child; each child only has one workspace's data in scope. The auth database (`auth.db`) stays in the shared parent process — it is the source of truth for API key → workspaceId lookup.

**Primary recommendation:** `child_process.fork` + workspace-scoped `CHATLYTICS_DATA_DIR` env var + parent HTTP proxy via `http.request` + `req.pipe`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — CONTEXT.md has no locked decisions. All choices are at Claude's discretion.

### Claude's Discretion
All implementation choices:
- Process isolation model (child_process.fork vs worker_threads)
- Process manager implementation
- Workspace-scoped SQLite paths
- WAHA session naming convention
- API gateway routing (by API key → workspace)

### Deferred Ideas (OUT OF SCOPE)
None explicitly listed.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TENANT-01 | Per-workspace process isolation (crash containment) | `child_process.fork` gives separate V8 heap; parent `exit` event enables restart; DI `forkFn` param for testing |
| TENANT-02 | Per-workspace SQLite databases (directory, mimicry, analytics) | Set `CHATLYTICS_DATA_DIR={baseDir}/{workspaceId}` in fork env; all singletons auto-scope; no db module changes needed |
| TENANT-03 | Per-workspace WAHA session namespacing (`ctl_{workspaceId}_{sessionName}`) | Strip hyphens from UUID workspaceId; set `CHATLYTICS_WORKSPACE_ID` env var in child; session name builder in child startup |
| TENANT-04 | API gateway routes by API key to workspace process | Parent calls `auth.api.verifyApiKey` → `user.workspaceId` → port lookup → `http.request` proxy |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` | built-in | Fork isolated workspace processes | Separate V8 heap = true crash isolation; `worker_threads` shares memory |
| `node:http` | built-in | HTTP proxy from parent to child ports | Already used throughout codebase; no new deps |
| `better-auth` | ^1.5.6 (already installed) | API key verification in parent gateway | `auth.api.verifyApiKey` returns user+workspaceId |
| `lru-cache` | ^11.2.6 (already installed) | Cache API key → workspaceId lookups | Already used in `accounts.ts`; prevents per-request auth.db queries |
| `better-sqlite3` | ^11.10.0 (already installed) | Direct auth.db query fallback | Already used everywhere |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:events` | built-in | Mock ChildProcess in tests | EventEmitter subclass simulates fork lifecycle |
| `node:net` | built-in | Find free port (port 0) | Child binds to port 0, OS assigns, child reports via IPC |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `child_process.fork` | `worker_threads` | Workers share V8 heap — a `process.exit()` in a worker kills the whole process; fork is true isolation |
| `child_process.fork` | Separate Docker containers per workspace | Correct isolation but requires orchestration (k8s/compose) — overkill for v2.0 single-server deployment |
| HTTP proxy via `http.request` | IPC message passing | IPC doesn't support streaming (SSE); HTTP pipe does |
| Dynamic port per child | Fixed port pool (8051, 8052...) | Dynamic is safer (no port conflicts on restart); child reports port via IPC `ready` message |

**Installation:** No new packages needed — all tools are built-in or already in `package.json`.

---

## Architecture Patterns

### Recommended Project Structure

New files:

```
src/
├── workspace-manager.ts     # WorkspaceProcessManager class — fork, track, proxy, restart
├── workspace-entry.ts       # Child entry point (thin wrapper around standalone.ts logic)
├── workspace-manager.test.ts # Unit tests with mock ChildProcess
```

Modified files:
```
src/standalone.ts            # When CHATLYTICS_WORKSPACE_ID set, derive session names
src/monitor.ts               # Route /api/v1/* through parent gateway when workspace-mode enabled
```

### Pattern 1: Fork with Workspace-Scoped Env

**What:** Parent forks a child process per workspace, setting env vars that scope all SQLite and WAHA session references.

**When to use:** On parent startup (load all workspaces from auth.db), on new workspace creation.

```typescript
// Source: node:child_process fork API (built-in, Node.js docs)
import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("./workspace-entry.js", import.meta.url));

function forkWorkspace(opts: {
  workspaceId: string;
  baseDataDir: string;
  wahaBaseUrl: string;
  wahaApiKey: string;
}): ChildProcess {
  const workspaceDataDir = join(opts.baseDataDir, opts.workspaceId);
  return fork(ENTRY, [], {
    env: {
      ...process.env,
      CHATLYTICS_DATA_DIR: workspaceDataDir,         // scopes ALL SQLite singletons
      CHATLYTICS_WORKSPACE_ID: opts.workspaceId,     // for session name prefix
      CHATLYTICS_PORT: "0",                          // child picks free port, reports via IPC
      WAHA_BASE_URL: opts.wahaBaseUrl,
      WAHA_API_KEY: opts.wahaApiKey,
    },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
}
```

### Pattern 2: Child Lifecycle Management

**What:** Parent tracks child processes and auto-restarts on crash.

```typescript
// Source: node:child_process events (built-in, Node.js docs)
type WorkspaceEntry = {
  workspaceId: string;
  child: ChildProcess;
  port: number | null;
  status: "starting" | "ready" | "crashed";
  restartCount: number;
};

const registry = new Map<string, WorkspaceEntry>();

function attachLifecycle(entry: WorkspaceEntry): void {
  entry.child.on("message", (msg: { type: string; port?: number }) => {
    if (msg.type === "ready" && msg.port) {
      entry.port = msg.port;
      entry.status = "ready";
    }
  });

  entry.child.on("exit", (code, signal) => {
    log.warn("workspace child exited", { workspaceId: entry.workspaceId, code, signal });
    entry.status = "crashed";
    // Exponential backoff restart (max 5 restarts)
    const delay = Math.min(1000 * 2 ** entry.restartCount, 30_000);
    entry.restartCount++;
    setTimeout(() => restartWorkspace(entry.workspaceId), delay);
  });
}
```

### Pattern 3: HTTP Proxy to Child

**What:** Parent resolves API key to workspaceId, then pipes the request to the child's port.

```typescript
// Source: node:http built-in (Node.js docs)
import http from "node:http";

async function proxyToWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  port: number
): Promise<void> {
  const proxyReq = http.request(
    { host: "127.0.0.1", port, path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    log.warn("proxy error", { port, error: err.message });
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Workspace unavailable" }));
  });
  req.pipe(proxyReq);
}
```

### Pattern 4: WAHA Session Name Construction

**What:** Derive namespaced session name from workspaceId and base session name.

```typescript
// Strip UUID hyphens to get a valid identifier segment
// e.g. "550e8400-e29b-41d4-a716-446655440000" -> "550e8400e29b41d4a716446655440000"
// Final: "ctl_550e8400e29b41d4a716446655440000_logan"
export function buildWorkspaceSessionName(workspaceId: string, sessionName: string): string {
  const cleanId = workspaceId.replace(/-/g, "");
  return `ctl_${cleanId}_${sessionName}`;
}
```

### Pattern 5: API Key → workspaceId Gateway Lookup

**What:** Parent gateway resolves Bearer token to workspaceId using better-auth.

```typescript
// Source: better-auth verifyApiKey API
import { auth } from "./auth.js";
import { LRUCache } from "lru-cache";

// Cache key lookups — avoids auth.db query on every request
const keyCache = new LRUCache<string, string>({ max: 500, ttl: 60_000 });

async function resolveWorkspaceFromKey(bearerToken: string): Promise<string | null> {
  const cached = keyCache.get(bearerToken);
  if (cached) return cached;

  const result = await auth.api.verifyApiKey({ body: { key: bearerToken } });
  if (!result?.valid || !result.user?.workspaceId) return null;

  keyCache.set(bearerToken, result.user.workspaceId);
  return result.user.workspaceId;
}
```

### Pattern 6: Child Entry Point

**What:** `workspace-entry.ts` is the module path passed to `fork()`. It reads workspace env vars and boots `monitorWahaProvider` on a dynamic port.

```typescript
// workspace-entry.ts — forked by WorkspaceProcessManager
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { getDataDir } from "./data-dir.js";
import { monitorWahaProvider } from "./monitor.js";
import { getConfigPath, readConfig } from "./config-io.js";

// Find a free port by binding to port 0
async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

const workspaceId = process.env.CHATLYTICS_WORKSPACE_ID!;
const dataDir = getDataDir(); // already scoped via CHATLYTICS_DATA_DIR
mkdirSync(dataDir, { recursive: true });

const port = parseInt(process.env.CHATLYTICS_PORT ?? "0", 10) || await getFreePort();
// ... boot monitorWahaProvider on port, then:
process.send?.({ type: "ready", port });
```

### Anti-Patterns to Avoid

- **`worker_threads` for isolation:** Workers share the same V8 heap and process. A `process.exit()` in a worker kills the parent. Use `fork()` only.
- **Sharing SQLite files between workspace processes:** SQLite WAL mode handles concurrent readers but write contention across processes causes `SQLITE_BUSY`. Per-process, per-workspace files eliminate this.
- **Opening auth.db inside child processes:** auth.db is global shared state (workspaceId registry). Only the parent reads it. Children never open auth.db.
- **Allocating fixed ports at compile time:** Use dynamic port 0 to avoid conflicts on container restart or port collision.
- **Not clearing IPC message handlers on child restart:** Detach old handlers before re-forking to prevent memory leaks.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| API key verification | Custom SHA-256 + SQL | `auth.api.verifyApiKey` | better-auth handles hashing, expiry, disabled state |
| HTTP proxying | Custom buffered re-implementation | `http.request` + `req.pipe` | Node.js built-in handles streaming, backpressure, chunked encoding |
| Free port discovery | Port scanning loop | Bind to port `0` and read assigned port | OS guarantees no conflict, atomic |
| LRU cache for key lookups | Custom Map + TTL | `lru-cache` (already in deps) | Battle-tested, already used in `accounts.ts` |
| Exponential backoff on restart | Custom timer math | Simple `Math.min(1000 * 2 ** count, 30_000)` | Already the pattern in `webhook-forwarder.ts` |

**Key insight:** The entire SQLite isolation problem is solved by `CHATLYTICS_DATA_DIR` env scoping — no changes to `directory.ts`, `mimicry-gate.ts`, or `analytics.ts` required.

---

## Common Pitfalls

### Pitfall 1: ESM Fork Module Resolution

**What goes wrong:** `fork('./src/workspace-entry.ts')` fails because Node.js resolves the module path against CJS rules, but the package is `type: "module"`.

**Why it happens:** `child_process.fork` expects a `.js` file (or `.mjs`). When the codebase uses jiti at runtime (on hpg6), `.ts` files work. In test/dev environments the entry point must resolve.

**How to avoid:** Pass the `.js` extension path in the fork call (jiti resolves `.js` → `.ts` on hpg6). In tests, mock `forkFn` entirely. For Docker builds where TypeScript is compiled, use the compiled `.js` output path.

**Warning signs:** `ERR_UNKNOWN_FILE_EXTENSION` or `Cannot find module` in child process startup logs.

### Pitfall 2: auth.db Opened in Both Parent and Child

**What goes wrong:** Child process imports `auth.ts` transitively (e.g. via `monitor.ts`), which opens `auth.db` at module scope. Now two processes have the same SQLite file open for writes → SQLITE_BUSY errors.

**Why it happens:** `auth.ts` opens the DB at module scope (line 31: `const authDb = new Database(authDbPath)`). If `CHATLYTICS_DATA_DIR` is workspace-scoped, auth.db would land in the wrong directory anyway.

**How to avoid:** Child process must NOT import `auth.ts`. `workspace-entry.ts` should initialize monitorWahaProvider with a flag that skips auth middleware initialization. Auth routes (`/api/auth/*`) are handled exclusively by the parent.

**Warning signs:** `SQLITE_BUSY: database is locked` errors in child process logs.

### Pitfall 3: Process Registry Not Cleaned Up on Restart

**What goes wrong:** A crashed child's entry stays in the registry with stale `port` and `status: 'crashed'`. New requests proxy to a dead port → connection refused.

**Why it happens:** The `exit` handler sets status to `crashed` but the port is still in the entry. During the restart delay window, requests arriving will get 502.

**How to avoid:** Set `entry.port = null` in the `exit` handler immediately. In the proxy: check `entry.status !== 'ready' || entry.port === null` and return 503 with `Retry-After` header.

**Warning signs:** Intermittent 502 errors after a workspace crash.

### Pitfall 4: WAHA Session Name Collision Between Workspaces

**What goes wrong:** Two workspaces have the same base session name (e.g. `logan`). Without namespacing they would share the same WAHA session, causing message cross-contamination.

**Why it happens:** WAHA sessions are globally named. Nothing in WAHA prevents two processes from connecting to the same session name.

**How to avoid:** `buildWorkspaceSessionName(workspaceId, sessionName)` must be called when registering/connecting WAHA sessions. The child reads `CHATLYTICS_WORKSPACE_ID` from env and prefixes all session names before passing them to the WAHA API.

**Warning signs:** Messages from workspace A appearing in workspace B's inbound queue.

### Pitfall 5: Webhook Delivery to Wrong Workspace

**What goes wrong:** WAHA sends webhook events to the parent's `/webhook/waha` endpoint. The parent must route to the correct child based on the session name in the webhook payload.

**Why it happens:** All WAHA instances post to the same configured webhook URL. If the parent doesn't inspect the session field in the payload, it either broadcasts to all workspaces or drops the event.

**How to avoid:** Parent webhook handler reads `body.session` → strips `ctl_{workspaceId}_` prefix → routes to the correct child's webhook endpoint (or forwards via IPC).

**Warning signs:** Missing inbound messages in workspace B after sending to workspace A.

---

## Code Examples

### WorkspaceProcessManager skeleton

```typescript
// Source: node:child_process built-in (HIGH confidence)
import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { LRUCache } from "lru-cache";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "workspace-manager" });

export type ForkFn = typeof fork;

export interface WorkspaceManagerOptions {
  baseDataDir: string;
  entryPath: string;
  _forkFn?: ForkFn; // DI for tests
}

export class WorkspaceProcessManager {
  private readonly registry = new Map<string, WorkspaceEntry>();
  private readonly forkFn: ForkFn;
  private readonly baseDataDir: string;
  private readonly entryPath: string;

  constructor(opts: WorkspaceManagerOptions) {
    this.forkFn = opts._forkFn ?? fork;
    this.baseDataDir = opts.baseDataDir;
    this.entryPath = opts.entryPath;
  }

  async startWorkspace(workspaceId: string, wahaConfig: WahaConfig): Promise<void> {
    if (this.registry.has(workspaceId)) return; // already running
    const entry: WorkspaceEntry = {
      workspaceId,
      child: null!,
      port: null,
      status: "starting",
      restartCount: 0,
      wahaConfig,
    };
    this.registry.set(workspaceId, entry);
    this._fork(entry);
  }

  private _fork(entry: WorkspaceEntry): void {
    const child = this.forkFn(this.entryPath, [], {
      env: {
        ...process.env,
        CHATLYTICS_DATA_DIR: join(this.baseDataDir, entry.workspaceId),
        CHATLYTICS_WORKSPACE_ID: entry.workspaceId,
        CHATLYTICS_PORT: "0",
      },
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    entry.child = child;
    entry.status = "starting";
    entry.port = null;

    child.on("message", (msg: unknown) => {
      const m = msg as { type: string; port?: number };
      if (m.type === "ready" && m.port) {
        entry.port = m.port;
        entry.status = "ready";
        log.info("workspace ready", { workspaceId: entry.workspaceId, port: m.port });
      }
    });

    child.on("exit", (code, signal) => {
      log.warn("workspace exited", { workspaceId: entry.workspaceId, code, signal });
      entry.status = "crashed";
      entry.port = null;
      const delay = Math.min(1000 * 2 ** entry.restartCount, 30_000);
      entry.restartCount++;
      setTimeout(() => this._fork(entry), delay);
    });
  }

  getPort(workspaceId: string): number | null {
    const entry = this.registry.get(workspaceId);
    if (!entry || entry.status !== "ready" || !entry.port) return null;
    return entry.port;
  }

  async stopAll(): Promise<void> {
    for (const entry of this.registry.values()) {
      entry.child.send({ type: "shutdown" });
    }
  }
}
```

### Session name builder

```typescript
// Source: CLAUDE.md session naming convention + UUID sanitization
export function buildWorkspaceSessionName(workspaceId: string, baseName: string): string {
  // Strip hyphens from UUID: "550e8400-e29b-..." → "550e8400e29b..."
  const cleanId = workspaceId.replace(/-/g, "");
  return `ctl_${cleanId}_${baseName}`;
}

export function extractWorkspaceIdFromSession(sessionName: string): string | null {
  // "ctl_550e8400e29b41d4a716446655440000_logan" → "550e8400-e29b-41d4-a716-446655440000"
  const m = sessionName.match(/^ctl_([0-9a-f]{32})_/);
  if (!m) return null;
  const hex = m[1];
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single process, single SQLite set | Per-workspace forked process + CHATLYTICS_DATA_DIR scoping | Phase 64 | Crash in workspace A cannot affect workspace B |
| Global `getMimicryDb()` singleton | Automatically per-workspace (via env var) | Phase 64 | No code change in mimicry-gate.ts |
| API key → config → single instance | API key → workspaceId → child port → HTTP proxy | Phase 64 | Tenants fully isolated |

**No deprecated approaches here** — this is greenfield architecture for v2.0.

---

## Open Questions

1. **Should the parent gateway also handle `/api/auth/*` routes?**
   - What we know: better-auth and auth.db live in the parent process; children should not open auth.db
   - What's unclear: Phase 63 wired auth routes into `monitor.ts` which is now being forked into children
   - Recommendation: Parent intercepts `/api/auth/*` before proxying; children's `monitor.ts` must skip `initAuthDb()` when `CHATLYTICS_WORKSPACE_ID` env var is set (child mode)

2. **How does a newly created workspace trigger child process startup?**
   - What we know: Phase 63 has a registration flow; `AUTH-02` workspace creation lives in better-auth hooks
   - What's unclear: Is there a post-registration webhook/callback the parent gateway can hook into?
   - Recommendation: After `POST /api/auth/sign-up`, parent reads newly created user's `workspaceId` from auth.db and calls `manager.startWorkspace(workspaceId, defaultWahaConfig)`

3. **Webhook routing from WAHA to correct workspace child**
   - What we know: WAHA posts to a single URL; session name contains workspaceId hex prefix
   - What's unclear: Does the parent webhook endpoint decode the session name and forward to the child, or does each child register its own webhook URL?
   - Recommendation: Parent forwards to child based on `extractWorkspaceIdFromSession(body.session)` — simpler than per-workspace webhook URLs, which would require per-workspace public URL config

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js `child_process.fork` | TENANT-01 | ✓ | v25.8.1 (built-in) | — |
| Node.js `http.request` (proxy) | TENANT-04 | ✓ | v25.8.1 (built-in) | — |
| `lru-cache` | key→workspaceId cache | ✓ | ^11.2.6 (in deps) | — |
| `better-auth` `verifyApiKey` | TENANT-04 | ✓ | ^1.5.6 (in deps) | Direct SQL query on apiKey table |
| `better-sqlite3` | SQLite singletons in children | ✓ | ^11.10.0 (in deps) | — |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run src/workspace-manager.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TENANT-01 | Crash in workspace A does not remove workspace B from registry | unit | `npx vitest run src/workspace-manager.test.ts -t "crash containment"` | ❌ Wave 0 |
| TENANT-01 | Crashed workspace restarts with exponential backoff | unit | `npx vitest run src/workspace-manager.test.ts -t "restart backoff"` | ❌ Wave 0 |
| TENANT-02 | Child process receives CHATLYTICS_DATA_DIR scoped to workspaceId | unit | `npx vitest run src/workspace-manager.test.ts -t "data dir scoping"` | ❌ Wave 0 |
| TENANT-03 | buildWorkspaceSessionName produces `ctl_{hex}_baseName` format | unit | `npx vitest run src/workspace-manager.test.ts -t "session name"` | ❌ Wave 0 |
| TENANT-03 | extractWorkspaceIdFromSession round-trips correctly | unit | `npx vitest run src/workspace-manager.test.ts -t "session name"` | ❌ Wave 0 |
| TENANT-04 | Known API key resolves to correct workspaceId and routes to correct port | unit | `npx vitest run src/workspace-manager.test.ts -t "API key routing"` | ❌ Wave 0 |
| TENANT-04 | Unknown API key returns 401 before proxying | unit | `npx vitest run src/workspace-manager.test.ts -t "API key routing"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/workspace-manager.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/workspace-manager.test.ts` — covers TENANT-01, TENANT-02, TENANT-03, TENANT-04
- [ ] `src/workspace-entry.ts` — child entry point module (new file)
- [ ] `src/workspace-manager.ts` — WorkspaceProcessManager class (new file)

---

## Project Constraints (from CLAUDE.md)

| Constraint | Impact on Phase 64 |
|------------|-------------------|
| ALWAYS clear `/tmp/jiti/` cache after deploys | Each workspace child uses jiti; clearing cache on parent restart is sufficient since children are forked fresh |
| SCP source `.ts` files to `src/` subdirectory on hpg6 (NOT root) | `workspace-entry.ts` and `workspace-manager.ts` must be deployed to `src/` on both hpg6 locations |
| Deploy to BOTH hpg6 locations | `~/.openclaw/extensions/waha/src/` AND `~/.openclaw/workspace/skills/waha-openclaw-channel/src/` |
| DO NOT CHANGE `getDataDir()` fallback path | CHATLYTICS_DATA_DIR env var override is the correct approach; do not modify the fallback |
| Make backups before changes (`*.bak.vX.X.X`) | Before modifying `standalone.ts` and `monitor.ts` |
| Add DO NOT CHANGE comments on working code | Required on WorkspaceProcessManager, IPC message format, session name format |
| NEVER write "Sammie" in git-tracked files | No Sammie references in any new/modified source files |

---

## Sources

### Primary (HIGH confidence)

- Node.js built-in `child_process.fork` — verified locally (v25.8.1), confirmed `exit` event and IPC `message` event API
- Node.js built-in `http.request` — verified pipe + streaming works for SSE
- `data-dir.ts` source — verified `getDataDir()` reads `CHATLYTICS_DATA_DIR` env var
- `directory.ts` source — verified `getDirectoryDb(accountId, tenantId)` already workspace-aware
- `analytics.ts` source — verified `_analyticsDb` singleton uses `getDataDir()` — scoped by env var
- `mimicry-gate.ts` source — verified `_mimicryDb` singleton uses `getDataDir()` — scoped by env var
- `auth.ts` source — verified auth.db opened at module scope; must stay in parent only
- `accounts.ts` source — verified `tenantId: string` field on `ResolvedWahaAccount`
- `lru-cache` — already in `package.json` dependencies

### Secondary (MEDIUM confidence)

- `better-auth` `verifyApiKey` API — confirmed available via `auth.api.verifyApiKey` based on better-auth plugin architecture; not directly tested against live instance in this session

### Tertiary (LOW confidence)

- WAHA session name character restrictions — assumed alphanumeric + underscore safe based on existing session names in CLAUDE.md (`3cf11776_omer`); no official WAHA docs consulted

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all tools are built-in or already-installed deps
- Architecture: HIGH — patterns derived directly from existing codebase (getDataDir, singleton pattern, LRU cache in accounts.ts)
- Pitfalls: HIGH — auth.db double-open and webhook routing are concrete risks visible in current code
- WAHA session naming: MEDIUM — UUID sanitization approach is sound but WAHA character restrictions not officially verified

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable Node.js built-ins + stable deps)
