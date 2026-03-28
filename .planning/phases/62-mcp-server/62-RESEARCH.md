# Phase 62: MCP Server - Research

**Researched:** 2026-03-28
**Domain:** MCP TypeScript SDK (@modelcontextprotocol/sdk v1.28.0), HTTP/stdio transport, tool and resource registration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Transport: StreamableHTTPServerTransport (not deprecated SSE transport)
- stdio mode for `npx chatlytics-mcp` local installs
- Resource URI scheme: `chatlytics://`

### Claude's Discretion
- MCP SDK version and transport config
- Tool consolidation strategy (grouping actions into 8-10 tools)
- Resource URI scheme details (beyond `chatlytics://` prefix)
- stdio wrapper implementation

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MCP-01 | 8-10 consolidated MCP tools (send_message, send_media, read_messages, search, get_directory, manage_group, get_status, update_settings, send_poll, send_reaction) | handleProxySend + api-v1.ts provide business logic for all tools |
| MCP-02 | Streamable HTTP transport on /mcp path (not deprecated SSE) | StreamableHTTPServerTransport.handleRequest() wires into existing monitor.ts routing |
| MCP-03 | stdio transport mode for npx chatlytics-mcp local installs | StdioServerTransport + new bin entry in package.json |
| MCP-04 | MCP resources for contacts, groups, sessions, config, mimicry status at chatlytics:// URIs | ResourceTemplate + registerResource — maps directly to api-v1.ts data sources |
| MCP-05 | Actionable error messages with recovery hints in tool responses | isError:true content blocks with structured hint strings |
</phase_requirements>

---

## Summary

The MCP TypeScript SDK v1.28.0 is the current stable v1.x release. The `main` GitHub branch is a v2 pre-alpha; **v1.28.0 from npm is the correct target** for production. It uses `@modelcontextprotocol/sdk` as the single package with subpath exports (`/server/mcp.js`, `/server/stdio.js`, `/server/streamableHttp.js`).

The project already has all the business logic needed (Phase 60 REST API, Phase 61 webhook). The MCP server is a thin adapter layer: `McpServer` registers tools that call the same functions that `handleApiV1Request` calls. Both HTTP (`StreamableHTTPServerTransport`) and stdio (`StdioServerTransport`) modes use the same `McpServer` instance — only the transport differs.

The implementation has two deliverables: (1) `src/mcp-server.ts` — a factory that creates and configures the `McpServer` with all tools and resources, and (2) `src/mcp-stdio.ts` — a standalone entry point for `npx chatlytics-mcp` that creates the server with `StdioServerTransport`.

**Primary recommendation:** Install `@modelcontextprotocol/sdk@^1.28.0` (zod v4.3.6 already installed, satisfies `^3.25 || ^4.0`). Wire `StreamableHTTPServerTransport.handleRequest()` into monitor.ts alongside the existing `/api/v1/` block. Extract a `createMcpServer(cfg)` factory for test isolation.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.28.0 | MCP server, transports, tool/resource registration | Official Anthropic SDK; only supported SDK for TypeScript MCP servers |
| zod | 4.3.6 (already installed) | Tool input schema validation | SDK peer dep `^3.25 || ^4.0`; already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @cfworker/json-schema | (optional) | JSON Schema validation via `./validation/cfworker` export | Not needed — we use the default ajv validation path |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk@^1.28.0
```

**Version verified:** `npm view @modelcontextprotocol/sdk version` → `1.28.0` (dist-tags.latest = 1.28.0, 2026-03-28)

---

## Architecture Patterns

### File Structure
```
src/
├── mcp-server.ts        # createMcpServer(cfg) factory — tools + resources
├── mcp-stdio.ts         # npx chatlytics-mcp entry point (StdioServerTransport)
└── monitor.ts           # add /mcp route block (StreamableHTTPServerTransport)
```

### Pattern 1: Stateless StreamableHTTP per-request (MCP-02)

Each `POST /mcp` creates a fresh `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` (stateless). This matches the existing monitor.ts pattern — no session state to manage.

```typescript
// Source: github.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/streamableHttp.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// In monitor.ts request handler, after /api/v1/ block:
if (req.url?.startsWith("/mcp")) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(opts.config);
  await server.connect(transport);
  await transport.handleRequest(req, res);
  return;
}
```

**Why stateless:** No in-memory session map needed. Each MCP request is self-contained. Matches the existing server's design (no persistent state beyond SQLite).

**Handles GET (SSE) and DELETE too:** `StreamableHTTPServerTransport.handleRequest()` handles all three MCP HTTP methods (POST, GET, DELETE). Route all `/mcp` traffic to the same handler.

### Pattern 2: registerTool with Zod schemas (MCP-01)

Use `server.registerTool()` (the non-deprecated API). Input schemas use Zod v4 object shapes.

```typescript
// Source: github.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/mcp.ts
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({ name: "chatlytics", version: "1.0.0" });

server.registerTool("send_message", {
  description: "Send a WhatsApp text message through the mimicry gate",
  inputSchema: {
    chatId: z.string().describe("WhatsApp chat JID or display name"),
    session: z.string().describe("WAHA session name"),
    text: z.string().describe("Message text to send"),
  },
}, async (args) => {
  const result = await handleProxySend({ body: args, cfg });
  if (result.body.blocked) {
    return {
      content: [{ type: "text", text: `Blocked: ${result.body.error}. Recovery: ${result.body.hint ?? ""}` }],
      isError: true,
    };
  }
  return { content: [{ type: "text", text: JSON.stringify(result.body) }] };
});
```

**Tool return format:** `{ content: [{ type: "text", text: "..." }] }` for success; same structure with `isError: true` for errors. The `isError` flag is the correct way to surface tool-level errors (MCP-05).

### Pattern 3: Resource registration with chatlytics:// URIs (MCP-04)

Fixed URIs for list endpoints; `ResourceTemplate` for parameterized lookups.

```typescript
// Source: github.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/mcp.ts
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

// Fixed resource — sessions list
server.registerResource(
  "sessions",
  "chatlytics://sessions",
  { description: "All configured WAHA sessions with health status" },
  async (_uri) => {
    const sessions = listEnabledWahaAccounts(cfg).map(...);
    return { contents: [{ uri: "chatlytics://sessions", text: JSON.stringify(sessions), mimeType: "application/json" }] };
  }
);

// Template resource — single contact by JID
const contactTemplate = new ResourceTemplate(
  "chatlytics://contacts/{jid}",
  { list: async () => ({ resources: db.getContacts({ limit: 100 }).map(c => ({ uri: `chatlytics://contacts/${c.jid}`, name: c.name ?? c.jid })) }) }
);
server.registerResource("contact", contactTemplate, { description: "WhatsApp contact by JID" }, async (_uri, vars) => {
  const entry = db.getContact(vars.jid as string);
  return { contents: [{ uri: _uri.toString(), text: JSON.stringify(entry), mimeType: "application/json" }] };
});
```

### Pattern 4: stdio transport for npx chatlytics-mcp (MCP-03)

```typescript
// Source: WebSearch verified against official docs
// src/mcp-stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { readConfig } from "./config-io.js";

async function main() {
  const cfg = await readConfig();
  const server = createMcpServer(cfg);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until process exits — no server.close() needed for stdio
}
main().catch(err => { process.stderr.write(String(err) + "\n"); process.exit(1); });
```

**Critical:** stdio mode must NEVER write to stdout except JSON-RPC. Use `process.stderr` for all logs. The existing logger writes to stdout via JSON — must redirect to stderr in stdio mode, or suppress logging entirely. Pass `LOG_LEVEL=silent` or set the logger to write to stderr when `CHATLYTICS_MCP_STDIO=true`.

**bin entry in package.json:**
```json
"bin": { "chatlytics-mcp": "./src/mcp-stdio.ts" }
```

Because the project uses jiti for TypeScript execution, `npx chatlytics-mcp` will work via the bin entry pointing directly to the `.ts` file. Alternatively, a compiled `.js` wrapper may be needed — see Open Questions.

### Pattern 5: Tool consolidation strategy (MCP-01)

The 10 tools from REQUIREMENTS.md map directly to existing business logic:

| MCP Tool | Business Logic | Source |
|----------|---------------|--------|
| `send_message` | `handleProxySend({ type: "text", ... })` | proxy-send-handler.ts |
| `send_media` | `handleProxySend({ type: "image"|"video"|"file", ... })` | proxy-send-handler.ts |
| `read_messages` | `getWahaChatMessages(...)` | send.ts |
| `search` | `db.getContacts({ search: q })` | directory.ts |
| `get_directory` | `db.getContacts({ limit, offset, type })` | directory.ts |
| `manage_group` | `callWahaApi(...)` for group operations | send.ts |
| `get_status` | `getHealthState()` + `getCapStatus()` | health.ts + mimicry-gate.ts |
| `update_settings` | `modifyConfig(...)` | config-io.ts |
| `send_poll` | `handleProxySend` with poll payload | proxy-send-handler.ts |
| `send_reaction` | `callWahaApi("/api/sendReaction", ...)` | send.ts |

### Anti-Patterns to Avoid

- **Using deprecated SSE transport (`SSEServerTransport`)**: The spec deprecated SSE-only transport. Use `StreamableHTTPServerTransport` only.
- **Stateful session map for stateless server**: Over-engineering. The server has no persistent in-memory state between requests — stateless transport is correct.
- **Writing to stdout in stdio mode**: Corrupts the JSON-RPC stream. All log output must go to stderr.
- **Creating McpServer inside the route handler vs. factory**: Creating one server with all tools registered once is more efficient; connect a new transport per request, but reuse the server if stateful or create per request if stateless.
- **Returning HTTP error codes from tool callbacks**: MCP tools always return HTTP 200; errors go in `{ isError: true, content: [...] }`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC protocol | Custom message parsing | `@modelcontextprotocol/sdk` | Handles framing, batching, notifications, cancellation |
| SSE streaming | Manual SSE write loop | `StreamableHTTPServerTransport.handleRequest()` | Handles Last-Event-ID resumability, session negotiation |
| stdio framing | readline/newline splitting | `StdioServerTransport` | Handles backpressure, drain events, buffer edge cases |
| Tool schema to JSON Schema | Manual conversion | SDK auto-converts Zod shapes | SDK calls `zod-to-json-schema` internally |
| MCP capability negotiation | Manual `initialize` handler | `McpServer.connect()` | Handles version negotiation, capability advertisement |

---

## Common Pitfalls

### Pitfall 1: stdout contamination in stdio mode
**What goes wrong:** Any `console.log` or logger output to stdout corrupts the JSON-RPC framing and breaks the MCP client connection silently.
**Why it happens:** The existing logger (`createLogger`) writes JSON to stdout by default.
**How to avoid:** In `mcp-stdio.ts`, set `process.env.LOG_LEVEL = "silent"` before importing the logger, or redirect logger output to stderr using the existing `setLogLevel()` utility.
**Warning signs:** Claude Code or cursor IDE shows "connection closed unexpectedly" immediately after connecting.

### Pitfall 2: Stateful session management (unnecessary complexity)
**What goes wrong:** Implementing a per-session transport map (as in the stateful example) when the server has no session-specific state.
**Why it happens:** The example in the SDK README uses stateful mode for resumable connections.
**How to avoid:** Use `sessionIdGenerator: undefined` for stateless mode. Each POST creates a fresh transport and discards it when the response closes.
**Warning signs:** Session cleanup code, Map<string, transport> patterns that are never actually needed.

### Pitfall 3: MCP error vs. HTTP error confusion
**What goes wrong:** Returning a non-200 HTTP status from the `/mcp` route causes MCP clients to fail unexpectedly.
**Why it happens:** Tool errors in REST APIs return 4xx; MCP tool errors return HTTP 200 with `isError: true` in the body.
**How to avoid:** Tool callbacks ALWAYS return `{ content: [...], isError: true }` for domain errors. Only return HTTP errors for transport-level failures (malformed JSON-RPC, auth failures).
**Warning signs:** Claude shows "Tool call failed" without any error details.

### Pitfall 4: mimicry gate errors not surfaced with recovery hints
**What goes wrong:** Gate block returns `{ blocked: true, error: "Gate closed" }` — MCP client sees a generic error.
**Why it happens:** `handleProxySend` returns a 403 body; the tool callback needs to inspect and reformat.
**How to avoid:** In `send_message` tool callback, check `result.body.blocked === true` and construct a human-readable message: `Gate closed until HH:MM — retry then or check mimicry config`.
**Warning signs:** MCP-05 fails in testing — no recovery hint in error text.

### Pitfall 5: npx chatlytics-mcp fails because bin target isn't executable
**What goes wrong:** `npx chatlytics-mcp` runs but node cannot execute the `.ts` file without jiti registered.
**Why it happens:** npm `bin` entries run as Node.js scripts; `.ts` files need a runtime loader.
**How to avoid:** Add a shebang `#!/usr/bin/env node` and ensure the file is compiled or use `tsx`/`jiti` as the runner. Options: (a) compile `mcp-stdio.ts` to `dist/mcp-stdio.js` via a new build script, (b) use `node --import jiti/register src/mcp-stdio.ts`, (c) a thin `.js` bin wrapper that calls `jiti`.
**Warning signs:** `Error: Unknown file extension ".ts"` when running `npx chatlytics-mcp`.

---

## Code Examples

### Tool registration with error handling (MCP-01, MCP-05)
```typescript
// Source: github.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/mcp.ts
server.registerTool("send_message", {
  description: "Send a WhatsApp text message. The mimicry gate may delay or block the send based on time-of-day rules.",
  inputSchema: {
    chatId: z.string().describe("WhatsApp JID or display name (e.g. 'Alice' or '972501234567@c.us')"),
    session: z.string().describe("WAHA session name (e.g. '3cf11776_logan')"),
    text: z.string().describe("Message text"),
  },
}, async (args) => {
  const result = await handleProxySend({ body: args, cfg });
  if (result.body.blocked) {
    const hint = buildRecoveryHint(result.body); // e.g. "Gate closed until 09:00 — retry then"
    return { content: [{ type: "text", text: `${result.body.error}\n\nRecovery: ${hint}` }], isError: true };
  }
  if (result.status >= 400) {
    return { content: [{ type: "text", text: String(result.body.error) }], isError: true };
  }
  return { content: [{ type: "text", text: "Message sent." }] };
});
```

### HTTP transport wiring in monitor.ts (MCP-02)
```typescript
// After the /api/v1/ block in monitor.ts request handler
if (req.url?.startsWith("/mcp")) {
  // Auth: same Bearer token as /api/v1/ (MCP-02 doesn't require separate auth)
  if (!requirePublicApiAuth(req, res, opts.config)) return;
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(opts.config);
  await server.connect(transport);
  await transport.handleRequest(req, res);
  return;
}
```

### Resource registration (MCP-04)
```typescript
// Fixed resource
server.registerResource("sessions", "chatlytics://sessions",
  { description: "WAHA session list with health status" },
  async () => {
    const sessions = listEnabledWahaAccounts(cfg).map(acc => ({
      ...acc, health: getHealthState(acc.session)
    }));
    return { contents: [{ uri: "chatlytics://sessions", text: JSON.stringify(sessions), mimeType: "application/json" }] };
  }
);

// Parameterized resource
const contactTemplate = new ResourceTemplate("chatlytics://contacts/{jid}", {
  list: async () => ({
    resources: db.getContacts({ limit: 200 }).map(c => ({ uri: `chatlytics://contacts/${encodeURIComponent(c.jid)}`, name: c.name ?? c.jid }))
  })
});
server.registerResource("contact", contactTemplate,
  { description: "WhatsApp contact or group details by JID" },
  async (uri, vars) => {
    const entry = db.getContact(vars.jid as string);
    return { contents: [{ uri: uri.toString(), text: JSON.stringify(entry ?? null), mimeType: "application/json" }] };
  }
);
```

---

## Environment Availability

Step 2.6: SKIPPED — this phase adds a new npm dependency and new TypeScript files. No external service dependencies beyond what's already running (WAHA server). The `@modelcontextprotocol/sdk` package will be installed as part of Wave 0.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npm test -- --reporter=verbose tests/mcp-server.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | All 10 tools registered and callable | unit | `npm test -- tests/mcp-server.test.ts` | ❌ Wave 0 |
| MCP-02 | POST /mcp routes to transport.handleRequest | unit | `npm test -- tests/mcp-http.test.ts` | ❌ Wave 0 |
| MCP-03 | stdio entry point connects without HTTP server | unit | `npm test -- tests/mcp-stdio.test.ts` | ❌ Wave 0 |
| MCP-04 | Resources return correct data for chatlytics:// URIs | unit | `npm test -- tests/mcp-server.test.ts` | ❌ Wave 0 |
| MCP-05 | Mimicry block returns isError + recovery hint | unit | `npm test -- tests/mcp-server.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/mcp-server.test.ts tests/mcp-http.test.ts tests/mcp-stdio.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/mcp-server.test.ts` — covers MCP-01, MCP-04, MCP-05
- [ ] `tests/mcp-http.test.ts` — covers MCP-02 (route wiring)
- [ ] `tests/mcp-stdio.test.ts` — covers MCP-03

---

## Open Questions

1. **npx chatlytics-mcp bin execution model**
   - What we know: npm bin entries run as Node scripts; `.ts` files require a loader; project currently uses jiti at runtime via the OpenClaw gateway
   - What's unclear: The standalone Docker image uses `node src/standalone.ts` — presumably it has jiti available. But for `npx`, the package is installed fresh.
   - Recommendation: Add a build step for `mcp-stdio.ts` (compile to `dist/mcp-stdio.mjs`) and point bin at the compiled output. Alternatively, use a thin `bin/chatlytics-mcp.js` wrapper with `#!/usr/bin/env node` that imports via `--import jiti/register`. Planner should pick: compile option is cleaner.

2. **Auth on /mcp endpoint**
   - What we know: `/api/v1/` requires Bearer token via `requirePublicApiAuth`. MCP spec supports OAuth but that's out of scope.
   - What's unclear: Should `/mcp` require the same Bearer token?
   - Recommendation: Yes — apply `requirePublicApiAuth` before passing to transport. MCP clients that support HTTP can pass `Authorization: Bearer ctl_xxx` headers.

3. **manage_group tool scope**
   - What we know: The requirement lists `manage_group` as one tool but group management covers 10+ WAHA operations (create, rename, add participant, etc.)
   - What's unclear: Should `manage_group` use a `action` discriminator param, or split into multiple tools?
   - Recommendation: Single `manage_group` tool with `action` enum param (`"add_participant" | "remove_participant" | "rename" | ...`). Keeps tool count at 10 and gives the LLM one tool to learn.

---

## Sources

### Primary (HIGH confidence)
- `npm view @modelcontextprotocol/sdk version` → 1.28.0 (verified 2026-03-28)
- `npm view @modelcontextprotocol/sdk dist-tags` → latest: 1.28.0
- github.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/mcp.ts — `registerTool`, `registerResource`, `ResourceTemplate` API signatures
- github.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/streamableHttp.ts — `StreamableHTTPServerTransport` constructor and `handleRequest` signature
- github.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/stdio.ts — `StdioServerTransport` constructor
- npm registry: `peerDependencies: { "zod": "^3.25 || ^4.0" }` — zod v4.3.6 compatible (optional: `@cfworker/json-schema`)

### Secondary (MEDIUM confidence)
- modelcontextprotocol.io/docs/develop/build-server — general MCP server tutorial (Python-focused but TypeScript pattern confirmed by SDK source)
- WebSearch: StdioServerTransport pattern verified across multiple 2025 blog posts consistent with SDK source

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm version verified, SDK source inspected directly
- Architecture: HIGH — transport and tool APIs read from SDK source, patterns cross-verified
- Pitfalls: HIGH — stdout contamination and isError patterns are well-documented in SDK source and community
- Open questions: MEDIUM — bin execution model requires testing to confirm

**Research date:** 2026-03-28
**Valid until:** 2026-06-28 (MCP SDK v1.x is stable; v2 pre-alpha won't ship before Q2 2026 per README)
