# Architecture Research

**Domain:** Chatlytics v2.0 — standalone multi-tenant WhatsApp automation platform extraction
**Researched:** 2026-03-28
**Confidence:** HIGH — based on direct source inspection of all 6 coupled files, MCP SDK v1.27.1 API review

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Clients / Consumers                             │
│  ┌──────────┐  ┌────────────┐  ┌───────────────┐  ┌─────────────┐  │
│  │ MCP Tool │  │ REST curl/ │  │  Admin Panel  │  │  OpenClaw   │  │
│  │ (Claude) │  │ SDK client │  │  (React SPA)  │  │ thin plugin │  │
│  └────┬─────┘  └─────┬──────┘  └───────┬───────┘  └──────┬──────┘  │
└───────┼──────────────┼─────────────────┼─────────────────┼─────────┘
        │              │                 │                 │
┌───────┴──────────────┴─────────────────┴─────────────────┴─────────┐
│              standalone.ts  —  Entry Point (NEW)                    │
│                                                                     │
│   monitor.ts (http.createServer)                                    │
│   ├─ /mcp            — MCP StreamableHTTP transport (NEW)           │
│   ├─ /api/v1/*       — Public REST API, API-key auth (NEW)          │
│   ├─ /webhook/waha   — WAHA webhook receiver (EXISTING)             │
│   ├─ /api/admin/*    — Admin dashboard API (EXISTING)               │
│   └─ /dist/admin/*   — React SPA static files (EXISTING)           │
├─────────────────────────────────────────────────────────────────────┤
│              Core Business Logic (zero SDK deps — reuse as-is)      │
│                                                                     │
│   send.ts          directory.ts      mimicry-gate.ts                │
│   mimicry-enforcer.ts  activity-scanner.ts  http-client.ts          │
│   adapter.ts       logger.ts         dedup.ts    dm-filter.ts       │
│   health.ts        rules-resolver.ts inbound-queue.ts               │
├─────────────────────────────────────────────────────────────────────┤
│              SDK-Decoupled Layer (NEW/MODIFIED)                     │
│                                                                     │
│   platform-types.ts    — local type defs replacing SDK interfaces   │
│   standalone-inbound.ts — inbound without OC delivery               │
│   webhook-forwarder.ts — outbound callback with HMAC + backoff      │
│   config-io.ts         — EXISTING, already OC-agnostic              │
│   account-utils.ts     — DEFAULT_ACCOUNT_ID + local normalizers     │
│   request-utils.ts     — readRequestBodyWithLimit replacement        │
├─────────────────────────────────────────────────────────────────────┤
│              Data Layer                                             │
│   ┌──────────────┐  ┌─────────────┐  ┌────────────────┐            │
│   │ directory.db │  │ mimicry.db  │  │ analytics.db   │            │
│   │ (SQLite/WAL) │  │ (SQLite/WAL)│  │ (SQLite/WAL)   │            │
│   └──────────────┘  └─────────────┘  └────────────────┘            │
│   ┌──────────────────────────────────────────────────────┐         │
│   │  standalone.json  — config (replaces openclaw.json)  │         │
│   └──────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|----------------|--------|
| `standalone.ts` | New entry point — boot HTTP server, register WAHA webhook, skip OC plugin registration | NEW |
| `monitor.ts` | HTTP server, admin routes, SSE, MCP route, public API route — add route branches | MODIFY |
| `platform-types.ts` | Local definitions for types currently imported from `openclaw/plugin-sdk/*` | NEW |
| `webhook-forwarder.ts` | Deliver inbound messages to registered callback URLs with HMAC + retry | NEW |
| `account-utils.ts` | `DEFAULT_ACCOUNT_ID`, `normalizeAccountId`, `listConfiguredAccountIds` — local impls | NEW |
| `request-utils.ts` | `readRequestBodyWithLimit`, `isRequestBodyLimitError` replacement | NEW |
| `mcp-server.ts` | MCP `McpServer` factory + tools, mounted via `StreamableHTTPServerTransport` on `/mcp` | NEW |
| `mcp-stdio.ts` | stdio transport entry point for `npx chatlytics-mcp` | NEW |
| `api-router.ts` | `/api/v1/*` REST route handlers, API key middleware | NEW |
| `config-io.ts` | Already OC-agnostic — swap config path via `CHATLYTICS_CONFIG_PATH` env var only | NO CHANGE |
| `send.ts` | All WAHA API wrappers — zero SDK deps | NO CHANGE |
| `directory.ts` | SQLite directory — zero SDK deps | NO CHANGE |
| `mimicry-gate.ts` | Time gate + hourly caps — zero SDK deps | NO CHANGE |
| `inbound.ts` | Inbound pipeline — inject `IReplyDeliverer`, localize `isWhatsAppGroupJid` | MINOR MODIFY |
| `accounts.ts` | Account resolution — swap SDK imports for `account-utils.ts` | MINOR MODIFY |
| `channel.ts` | OpenClaw adapter — keep for backward compat, not used in standalone | KEEP (OC only) |
| `adapter.ts` | PlatformAdapter interface — zero SDK deps | NO CHANGE |

---

## Decoupling the 6 SDK-Dependent Files

### 1. `channel.ts` — Heaviest Coupling, No Standalone Work Needed

**SDK imports used:**
- `ChannelPlugin`, `OpenClawConfig`, `buildChannelConfigSchema`, `deleteAccountFromConfigSection`, etc. from `openclaw/plugin-sdk/core`
- `buildBaseChannelStatusSummary`, `createDefaultChannelRuntimeState` from `plugin-sdk/status-helpers`
- `resolveDefaultGroupPolicy` from `plugin-sdk/config-runtime`
- `waitUntilAbort` from `plugin-sdk/channel-runtime`
- `ChannelMessageActionAdapter` from `plugin-sdk/channel-contract`

**Strategy: Keep as-is for OpenClaw mode. Not imported in standalone.**

`channel.ts` is the OpenClaw plugin adapter — it is only instantiated when the plugin runs inside the OC gateway. `standalone.ts` never imports it. The action dispatch surface that `channel.ts` provides (`handleAction` / `listActions`) is replaced in standalone mode by `api-router.ts` (REST) and `mcp-server.ts` (MCP).

The one piece of logic to extract: `autoResolveTarget` / name-to-JID resolution. Extract to `target-resolver.ts` (no SDK dep) so it can be shared between `channel.ts` and the REST API layer.

### 2. `inbound.ts` — Multi-layered Coupling, Minor Modification

**SDK imports used:**
- `resolveDefaultGroupPolicy`, `resolveAllowlistProviderRuntimeGroupPolicy` from `plugin-sdk/config-runtime`
- `createNormalizedOutboundDeliverer`, `OutboundReplyPayload`, `formatTextWithAttachmentLinks`, `resolveOutboundMediaUrls` from `plugin-sdk/reply-payload`
- `createReplyPrefixOptions`, `logInboundDrop` from `plugin-sdk/channel-runtime`
- `readStoreAllowFromForDmPolicy`, `resolveDmGroupAccessWithCommandGate` from `plugin-sdk/security-runtime`
- `isWhatsAppGroupJid` from `plugin-sdk/whatsapp-shared`
- `normalizeAccountId` from `plugin-sdk/account-id`

**Strategy: Dependency injection + trivial one-liner replacements.**

The bulk of `inbound.ts` (dedup, slash commands, pairing, module hooks, analytics, mimicry) is already SDK-free. SDK coupling is at two narrow boundaries:

**Boundary 1 — Group policy resolution** (`resolveDefaultGroupPolicy` etc.): In standalone mode, policy lives entirely in `standalone.json`. Replace with local `resolveStandaloneGroupPolicy()` that reads config directly — no SDK needed.

**Boundary 2 — Reply delivery** (`createNormalizedOutboundDeliverer`, `OutboundReplyPayload`): In OC mode, replies go to the OC agent pipeline. In standalone mode, they go to `WebhookForwarder`. Introduce `IReplyDeliverer` in `platform-types.ts` and inject it:

```typescript
// platform-types.ts (NEW)
export interface IReplyDeliverer {
  deliver(payload: StandaloneReplyPayload): Promise<void>;
}
export interface StandaloneReplyPayload {
  chatId: string;
  text?: string;
  mediaUrls?: string[];
  accountId: string;
  sessionId: string;
}
```

`inbound.ts` accepts `IReplyDeliverer` via `setReplyDeliverer()`. OC entry (`index.ts`) passes the OC deliverer. `standalone.ts` passes `WebhookForwarder`.

**Boundary 3 — `isWhatsAppGroupJid`**: Already noted in source at line 468 — "direct JID check replaces SDK isWhatsAppGroupJid." The inline version is `jid.endsWith("@g.us")`. Add this one-liner to `platform-types.ts` as `export function isGroupJid(jid: string): boolean { return jid.endsWith("@g.us"); }` and use it everywhere.

**`normalizeAccountId`**: Delegates to `account-utils.ts` after Phase 1.

### 3. `config-schema.ts` — Already Decoupled

**SDK imports claimed in PRD:** `buildSecretInputSchema` from plugin SDK.

**Actual state (verified by inspection):** `config-schema.ts` imports `buildSecretInputSchema` from `./secret-input.js` — a local file. The file header comment explicitly states: "Local schema definitions — previously imported from openclaw/plugin-sdk but restructured in OpenClaw v2026.3.22. Defined locally. DO NOT REMOVE."

**Action: None.** Verify `src/secret-input.ts` has zero SDK imports (confirm before Phase 1 starts) and consider this file already free.

### 4. `accounts.ts` — Medium Coupling, Trivial Fix

**SDK imports used:**
- `DEFAULT_ACCOUNT_ID`, `normalizeAccountId`, `listConfiguredAccountIds`, `resolveAccountWithDefaultFallback` from `openclaw/plugin-sdk/account-resolution`

**Strategy: Create `account-utils.ts` with local implementations. ~25 lines total.**

```typescript
// account-utils.ts (NEW)
export const DEFAULT_ACCOUNT_ID = "default";

export function normalizeAccountId(id: string): string {
  return id.trim().toLowerCase();
}

export function listConfiguredAccountIds(
  accounts: Record<string, unknown> | undefined,
  normalize: (id: string) => string = normalizeAccountId
): string[] {
  return Object.keys(accounts ?? {}).map(normalize);
}

export function resolveAccountWithDefaultFallback(
  accountId: string | undefined
): string {
  return accountId ? normalizeAccountId(accountId) : DEFAULT_ACCOUNT_ID;
}
```

Update `accounts.ts` to import from `./account-utils.js` instead of the SDK. Zero behavioral change.

### 5. `monitor.ts` — Light Coupling, 3 Replaceable Imports

**SDK imports used:**
- `readRequestBodyWithLimit`, `isRequestBodyLimitError`, `requestBodyErrorToText` from `plugin-sdk/webhook-ingress`
- `isWhatsAppGroupJid` from `plugin-sdk/whatsapp-shared`
- `DEFAULT_ACCOUNT_ID` from `plugin-sdk/account-id`
- `createLoggerBackedRuntime` from `plugin-sdk/runtime`

**Strategy:**

- `readRequestBodyWithLimit` / `isRequestBodyLimitError` / `requestBodyErrorToText`: Implement in `request-utils.ts` (~25 lines). Body reader with size and timeout limits using Node.js streams.
- `isWhatsAppGroupJid`: One-liner from `platform-types.ts`.
- `DEFAULT_ACCOUNT_ID`: Import from `account-utils.ts`.
- `createLoggerBackedRuntime`: Used only to construct a runtime env for OC pairing calls inside `monitor.ts`. In standalone mode, OC pairing is not applicable — guard this with a runtime mode check or stub the dependency. Do NOT remove — it serves OC mode.

```typescript
// request-utils.ts (NEW)
import type { IncomingMessage } from "node:http";

export class RequestBodyLimitError extends Error {
  constructor(public readonly reason: "too_large" | "timeout") {
    super(`Request body ${reason}`);
  }
}

export async function readRequestBodyWithLimit(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const timer = setTimeout(
      () => reject(new RequestBodyLimitError("timeout")),
      timeoutMs
    );
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        clearTimeout(timer);
        req.destroy();
        reject(new RequestBodyLimitError("too_large"));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

export function isRequestBodyLimitError(e: unknown): e is RequestBodyLimitError {
  return e instanceof RequestBodyLimitError;
}

export function requestBodyErrorToText(e: RequestBodyLimitError): string {
  return e.reason === "too_large" ? "Payload too large" : "Request timeout";
}
```

### 6. `normalize.ts` — Already Decoupled

**Actual state (verified by inspection):** `normalize.ts` contains only pure functions (`normalizeWahaMessagingTarget`, `normalizeWahaAllowEntry`, `resolveWahaAllowlistMatch`). Zero SDK imports. The PRD's inclusion of this file as SDK-dependent is outdated.

**Action: None.**

---

## MCP Server Integration with `http.createServer`

### Transport

MCP SDK v1.27.1 (installed) ships `StreamableHTTPServerTransport` in `server/streamableHttp.ts`. This transport accepts `(req: IncomingMessage, res: ServerResponse, body?: unknown)` directly — no Express or Hono required. It supports both streaming SSE responses and direct JSON responses per the MCP Streamable HTTP spec.

The legacy `SSEServerTransport` (also present in the SDK) is the older MCP SSE-only transport. Use `StreamableHTTPServerTransport` instead — it is the current spec and handles both SSE and non-streaming in one transport.

### Co-hosting Pattern

Mount on the existing `http.createServer` instance in `monitor.ts` via a new route branch. This preserves all existing routes with zero risk:

```typescript
// monitor.ts — add inside existing request dispatcher
// DO NOT restructure the dispatcher — add /mcp as a new branch

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";

let mcpServer: McpServer | null = null;
const mcpTransports = new Map<string, StreamableHTTPServerTransport>();

export function setMcpServer(s: McpServer): void { mcpServer = s; }

// In HTTP handler (new branch):
if (url.pathname === "/mcp") {
  if (!mcpServer) { res.writeHead(503); res.end("MCP not initialized"); return; }
  const rawBody = await readRequestBodyWithLimit(req, 1_048_576, 30_000);
  const body = rawBody.length ? JSON.parse(rawBody.toString()) : undefined;
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? mcpTransports.get(sessionId) : undefined;
  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => mcpTransports.set(sid, transport!),
    });
    await mcpServer.connect(transport);
  }
  await transport.handleRequest(req, res, body);
  return;
}
```

### MCP Server Factory

```typescript
// mcp-server.ts (NEW)
// McpServer is instantiated in standalone.ts, passed to setMcpServer() in monitor.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface McpDeps {
  sendText(params: { chatId: string; text: string; accountId?: string }): Promise<{ id: string }>;
  getMessages(params: { chatId: string; limit?: number }): Promise<unknown[]>;
  search(params: { q: string; scope?: string }): Promise<unknown[]>;
  getDirectory(params: { type?: string; search?: string }): Promise<unknown[]>;
  getMimicryStatus(params: { accountId?: string }): Promise<unknown>;
}

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "chatlytics", version: "2.0.0" });

  server.tool(
    "send_message",
    { chatId: z.string(), text: z.string(), accountId: z.string().optional() },
    async (args) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await deps.sendText(args)) }],
    })
  );
  // ... remaining tools
  return server;
}
```

The same `deps` object is built in `standalone.ts` and passed to both `createMcpServer()` and `api-router.ts` — no logic duplication.

### stdio Transport (Local `npx` Mode)

```typescript
// mcp-stdio.ts (NEW) — separate entry point
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, buildMcpDeps } from "./mcp-server.js";

const transport = new StdioServerTransport();
await createMcpServer(buildMcpDeps()).connect(transport);
```

Does not start an HTTP server. Packaged as `bin.mcp-stdio` in `package.json`.

---

## Multi-Tenant Isolation Model

### v2.0: Single-Process, Single-Workspace (Recommended)

For the initial Docker container, run one process per workspace. The `accountId`-scoped SQLite instances already provide data isolation. No architectural change from v1.x.

Config path via env var (`CHATLYTICS_CONFIG_PATH`) — one env var, one workspace per container.

### v2.1: Process-Per-Workspace (50+ workspaces)

```
nginx / API gateway
  ├─ routes by API key header → workspace registry lookup → upstream port
  │
  ├─ workspace-abc (port 8100) → Chatlytics process
  ├─ workspace-def (port 8101) → Chatlytics process
  └─ workspace-xyz (port 8102) → Chatlytics process
```

Each workspace process starts with its own config path. Crash isolation is complete — one runaway workspace cannot affect others. Memory overhead: ~50MB per idle process.

Workspace registry: `~/.chatlytics/registry.json` maps `{ workspaceId: port }`. The API gateway (nginx map or a 50-line Node.js proxy) reads this file to route by API key.

**Why not shared-process?** The `DirectoryDb` and `MimicryDb` are already per-`accountId`, so SQL is isolated. But shared-process exposes risks: a panic in one tenant's inbound handler could crash the process serving all tenants. SQLite's single-writer-per-database model also means long-running tenant operations could cause lock contention despite WAL mode.

### Tenant Data Layout

```
~/.chatlytics/
├── registry.json              # workspaceId → port mapping (v2.1)
└── workspaces/
    └── {workspaceId}/
        ├── standalone.json    # workspace config (replaces openclaw.json)
        ├── directory.db       # contacts, groups, participants
        ├── mimicry.db         # gate windows, cap buckets
        └── analytics.db       # event store
```

WAHA session naming: `{workspaceId}_{sessionName}` — enforced at session provisioning time. Already supported by WAHA's multi-session architecture.

---

## Recommended Project Structure (v2.0)

```
src/
├── standalone.ts           # NEW: entry point for standalone/Docker mode
├── mcp-server.ts           # NEW: McpServer factory (tools)
├── mcp-stdio.ts            # NEW: stdio entry for npx chatlytics-mcp
├── webhook-forwarder.ts    # NEW: callback URL delivery, HMAC, backoff
├── api-router.ts           # NEW: /api/v1/* REST route handlers
├── platform-types.ts       # NEW: IReplyDeliverer, StandaloneReplyPayload, isGroupJid
├── request-utils.ts        # NEW: readRequestBodyWithLimit, isRequestBodyLimitError
├── account-utils.ts        # NEW: DEFAULT_ACCOUNT_ID, normalizeAccountId (local impls)
│
├── monitor.ts              # MODIFY: add /mcp and /api/v1/ route branches
├── inbound.ts              # MODIFY: inject IReplyDeliverer, swap isWhatsAppGroupJid
├── accounts.ts             # MODIFY: import from account-utils.ts instead of SDK
│
├── channel.ts              # KEEP UNCHANGED (OpenClaw mode only)
├── config-schema.ts        # NO CHANGE (already decoupled)
├── normalize.ts            # NO CHANGE (already zero SDK deps)
│
├── send.ts                 # NO CHANGE
├── directory.ts            # NO CHANGE
├── mimicry-gate.ts         # NO CHANGE
├── mimicry-enforcer.ts     # NO CHANGE
├── activity-scanner.ts     # NO CHANGE
├── http-client.ts          # NO CHANGE
├── adapter.ts              # NO CHANGE
├── logger.ts               # NO CHANGE
├── dedup.ts                # NO CHANGE
├── dm-filter.ts            # NO CHANGE
├── health.ts               # NO CHANGE
├── config-io.ts            # NO CHANGE (add CHATLYTICS_CONFIG_PATH env support if not present)
└── admin/                  # NO CHANGE (React SPA)
```

---

## Architectural Patterns

### Pattern 1: Dependency Injection for Reply Delivery

**What:** `inbound.ts` receives an `IReplyDeliverer` via `setReplyDeliverer()` at startup. OC mode passes the OC pipeline deliverer. Standalone mode passes `WebhookForwarder`.

**When to use:** Wherever behavior must differ between OC mode and standalone mode. Replaces SDK-coupled behavior at module boundaries without forking core logic.

**Trade-offs:** One init-time call adds to startup sequence. The injected collaborator must be set before the first webhook arrives — enforced by `standalone.ts` boot order.

```typescript
// inbound.ts
let _replyDeliverer: IReplyDeliverer | null = null;
export function setReplyDeliverer(d: IReplyDeliverer): void {
  _replyDeliverer = d;
}

// standalone.ts
setReplyDeliverer(new WebhookForwarder(config.webhooks));

// index.ts (OpenClaw)
setReplyDeliverer(createOpenClawDeliverer(ocRuntime));
```

### Pattern 2: Single HTTP Server, Additive Route Branching

**What:** Keep one `http.createServer` in `monitor.ts`. Add `/mcp` and `/api/v1/` as new `if` branches at the top of the request dispatcher — before existing branches.

**When to use:** Adding new route namespaces to an existing raw-HTTP server with DO NOT CHANGE sections.

**Trade-offs:** Raw HTTP routing is verbose. Acceptable for the ~10 new REST routes in v2.0. If v2.1 adds >30 new routes, extract `api-router.ts` into a micro-framework or consider Express for the v1 namespace only.

### Pattern 3: Shared Deps Object, Dual Surfaces

**What:** Build a `deps` object in `standalone.ts` containing function references. Pass it to both `createMcpServer(deps)` and `apiRouter(deps)`. Same function references, two consumer surfaces.

**When to use:** When REST API and MCP tools expose the same capabilities. Prevents duplicating business logic between surfaces.

```typescript
// standalone.ts
const deps = {
  sendText: (p) => sendWahaText(p, config),
  getMessages: (p) => getWahaChatMessages(p, config),
  search: (p) => searchDirectory(p, dirDb),
  getDirectory: (p) => queryDirectory(p, dirDb),
  getMimicryStatus: (p) => getCapStatus(p, mimicryDb),
};
const mcpServer = createMcpServer(deps);
const apiHandler = createApiRouter(deps);
setMcpServer(mcpServer);
setApiRouter(apiHandler);
```

---

## Data Flow

### Outbound (REST API or MCP Tool → WhatsApp)

```
Client (REST or MCP tool call)
    ↓ API key validation middleware
    ↓ Request parsing (api-router.ts or mcp-server.ts)
    ↓ Mimicry enforcement (mimicry-enforcer.ts — time gate + hourly cap check)
    ↓ Rate limiting (http-client.ts token bucket)
    ↓ WAHA API call (send.ts)
    ↓ Response → client
```

### Inbound (WAHA webhook → registered callback URL)

```
WAHA POST /webhook/waha
    ↓ HMAC signature check (signature.ts)
    ↓ Always return HTTP 200 immediately (prevents WAHA retry storms)
    ↓ Dedup by messageId (dedup.ts)
    ↓ Inbound queue (inbound-queue.ts — bounded, priority DMs)
    ↓ handleWahaInbound() (inbound.ts)
    ↓ Policy check (dm-filter, rules-resolver)
    ↓ Slash command detection (commands.ts, shutup.ts)
    ↓ Module hooks (module-registry.ts)
    ↓ IReplyDeliverer.deliver()
         ├─ OpenClaw mode: OC agent delivery pipeline (unchanged)
         └─ Standalone mode: WebhookForwarder
               ↓ POST to registered callback URL
               ↓ X-Chatlytics-Signature: HMAC-SHA256 header
               ↓ Retry with exponential backoff (3 attempts, 1s/2s/4s)
               ↓ Dead-letter log on final failure
```

### MCP Request/Response Flow

```
Claude Code / MCP client
    ↓ POST /mcp with mcp-session-id header (or new session)
    ↓ monitor.ts routes to StreamableHTTPServerTransport
    ↓ Transport parses JSON-RPC, dispatches to McpServer
    ↓ Tool handler calls shared deps function
    ↓ (same path as REST outbound from here)
    ↓ Response via SSE stream (tools/call) or direct JSON (init)
```

---

## Build Order (Phase Dependencies)

| Phase | Deliverable | New Files | Modified Files | Depends On |
|-------|-------------|-----------|----------------|------------|
| **Phase 1** | SDK decoupling | `platform-types.ts`, `account-utils.ts`, `request-utils.ts` | `accounts.ts`, `monitor.ts` (swap imports), `inbound.ts` (IReplyDeliverer inject + isGroupJid) | Nothing — all parallel |
| **Phase 1** | Config path abstraction | — | `config-io.ts` (if CHATLYTICS_CONFIG_PATH not yet supported) | Nothing |
| **Phase 2** | Standalone entry + Docker | `standalone.ts`, `Dockerfile` | — | Phase 1 complete |
| **Phase 2** | Webhook forwarder | `webhook-forwarder.ts` | — | `platform-types.ts` (IReplyDeliverer) |
| **Phase 3** | Public REST API | `api-router.ts` | `monitor.ts` (add /api/v1/ branch) | `standalone.ts` booting |
| **Phase 4** | MCP server | `mcp-server.ts` | `monitor.ts` (add /mcp branch) | `api-router.ts` (reuse deps), Phase 3 |
| **Phase 4** | MCP stdio | `mcp-stdio.ts` | `package.json` (bin entry) | `mcp-server.ts` |
| **Phase 5** | Dashboard auth + onboarding | `auth-middleware.ts` | `monitor.ts` (auth guards) | Phase 3 |
| **Phase 6** | Multi-tenant process isolation | `workspace-registry.ts`, `gateway-proxy.ts` | `standalone.ts` | All above stable |

Phase 1 can be done in a single PR — it is pure import substitution with no behavioral change. Phases 2-4 are the core v2.0 deliverables.

---

## Integration Points

### External Services

| Service | Integration | Notes |
|---------|-------------|-------|
| WAHA API | `http-client.ts` → `send.ts` | Existing, stable. 30s AbortController timeouts. Token bucket rate limiter. |
| Registered callback URLs | `webhook-forwarder.ts` POST | NEW. HMAC-SHA256 per webhook. Exponential backoff. Store URLs in `standalone.json`. |
| MCP clients (Claude Code, Claude Desktop) | `StreamableHTTPServerTransport` on `/mcp` | MCP SDK v1.27.1 already installed. Native Node.js HTTP — no framework needed. |

### Internal Module Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `monitor.ts` ↔ `mcp-server.ts` | `setMcpServer()` + shared http.Server | Transport takes IncomingMessage/ServerResponse directly |
| `monitor.ts` ↔ `api-router.ts` | `setApiRouter(handler)` + route branch call | Keep route logic in api-router.ts, not inlined in monitor.ts |
| `inbound.ts` ↔ `webhook-forwarder.ts` | `IReplyDeliverer` interface (injected) | No direct import — loose coupling via interface |
| `standalone.ts` ↔ `channel.ts` | None | `channel.ts` is only imported by `index.ts` (OC entry) |
| `api-router.ts` ↔ `mcp-server.ts` | Shared `McpDeps` / `ApiDeps` object | Same function references, no logic duplication |

---

## Anti-Patterns

### Anti-Pattern 1: Forking Core Logic with `if (standalone)` Branches

**What people do:** Add `if (process.env.STANDALONE_MODE)` checks inside `inbound.ts` or `send.ts`.

**Why wrong:** Turns core modules into mode-aware state machines. Tests must simulate modes. Future changes must reason about both branches. Regressions are invisible.

**Do this instead:** Dependency injection (Pattern 1). Core modules accept collaborators at init time. Entry points wire the right collaborators for their mode.

### Anti-Pattern 2: Rewriting the HTTP Router with Express

**What people do:** "Now that we're standalone, let's clean up monitor.ts with Express."

**Why wrong:** `monitor.ts` has 2,400+ lines of battle-tested routes with DO NOT CHANGE markers. Migrating to Express requires touching every handler, risks regressions on admin panel, SSE, WAHA webhook, and proxy-send paths. Express provides no benefit for the ~10 new REST routes needed.

**Do this instead:** Add `/mcp` and `/api/v1/` as new branches in the existing dispatcher. Use `api-router.ts` as a sub-handler to keep new code separate from existing routes. Mark the addition clearly — do not move existing route code.

### Anti-Pattern 3: Second HTTP Server for MCP

**What people do:** `const mcpHttpServer = http.createServer(...); mcpHttpServer.listen(8051)`.

**Why wrong:** Two ports in Docker, two TLS termination points, two auth boundaries, doubled CORS config. The MCP SDK's `StreamableHTTPServerTransport` is designed to mount on a route of an existing server.

**Do this instead:** Mount `/mcp` on the existing monitor.ts server. One port (8050), one TLS cert, one auth middleware.

### Anti-Pattern 4: Shared WAHA Sessions Across Workspaces

**What people do:** Multi-tenant deployment reuses the same WAHA session names across workspaces.

**Why wrong:** WAHA session names are global webhook routing identifiers. Two workspaces sharing a session receive each other's webhooks and could send messages impersonating each other.

**Do this instead:** Prefix all session names: `{workspaceId}_{sessionName}`. Enforced at provisioning time. Zero WAHA API changes needed — it already supports multi-session.

---

## Scaling Considerations

| Scale | Architecture |
|-------|-------------|
| 1 workspace (v2.0) | Single process, single Docker container — existing architecture unchanged |
| 10-50 workspaces (v2.1) | Process-per-workspace, nginx upstream routing by API key → workspace registry, shared WAHA with session namespacing |
| 100k+ workspaces | WAHA-per-tenant cluster, SQLite → Postgres for directory. Out of scope for v2.x. |

**First bottleneck:** SQLite WAL write contention on a busy single workspace under high inbound message volume. Mitigation: per-workspace database files (already planned) with `PRAGMA busy_timeout = 5000`.

**Second bottleneck:** Activity scanner periodic WAHA API polls (one poll per active chat per scan interval). At 50 workspaces × 20 active chats = 1,000 periodic HTTP calls. Mitigation: per-workspace jitter on scan intervals, WAHA API call budget enforcement in `http-client.ts` token bucket.

---

## Sources

- Direct source inspection: `src/channel.ts`, `src/inbound.ts`, `src/monitor.ts`, `src/accounts.ts`, `src/config-schema.ts`, `src/normalize.ts`, `src/adapter.ts` (all inspected 2026-03-28)
- `docs/PRD-v2.md` — target architecture diagram, SDK coupling list (T01), multi-tenant model recommendation
- `.planning/PROJECT.md` — milestone history, existing architectural decisions
- `node_modules/@modelcontextprotocol/sdk` v1.27.1 — `server/streamableHttp.d.ts` confirms native Node.js HTTP transport, no Express dependency; `server/mcp.d.ts`, `server/stdio.d.ts`

---
*Architecture research for: Chatlytics v2.0 standalone extraction from OpenClaw plugin*
*Researched: 2026-03-28*
