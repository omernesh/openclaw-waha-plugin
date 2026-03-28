# Feature Research

**Domain:** Standalone multi-tenant WhatsApp agent platform (SaaS) with MCP server, OpenAPI, Docker, and webhook forwarding
**Researched:** 2026-03-28
**Confidence:** HIGH (MCP patterns), HIGH (WhatsApp API platform norms), MEDIUM (multi-tenant isolation patterns)

---

## Context: What Already Exists

The following features are **already built and working** in the OpenClaw plugin (v1.20). They are NOT new features — they are the core being extracted:

- 109 WhatsApp actions (send, groups, contacts, channels, labels, status, presence, profile, media)
- Human mimicry system (time gates, hourly caps, typing simulation, adaptive activity profiles)
- Policy engine (DM/group filters, allow-lists, per-contact rules, pairing challenges)
- React admin panel (shadcn/ui, Tailwind, Vite) — directory, config, filter stats, sessions, analytics, logs
- SQLite-backed directory with FTS5 search and background sync
- Multi-session support with role-based access
- YAML-based rules engine
- Rate limiting (token bucket), request timeouts, message queue with flood protection
- WahaClient + PlatformAdapter abstraction layer (already decoupled from OpenClaw internals in most modules)

**This research focuses only on net-new platform features** required for distribution and multi-tenancy.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features any self-hosted or SaaS WhatsApp API platform must have. Missing = product feels incomplete or unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| API key authentication | Every API platform requires Bearer token or API key auth | LOW | Header: `Authorization: Bearer ctl_xxx`. Keys stored hashed (SHA-256). Per-workspace scope. Already have crypto patterns from HMAC pairing tokens. |
| Public REST API endpoints | Developers need HTTP endpoints to integrate without MCP or SKILL.md | MEDIUM | `/api/v1/send`, `/api/v1/messages`, `/api/v1/search`, `/api/v1/directory`, `/api/v1/sessions`. Wraps existing internal functions. |
| OpenAPI 3.1 spec | All serious API platforms publish a spec. AI agent frameworks auto-generate clients from it. Required for SDK generation. | MEDIUM | Hand-written YAML. OpenAPI 3.2 released Sept 2025 but 3.1 is still ecosystem standard. Validate with Spectral. |
| Docker container | Standard distribution for self-hosted deployment. Every competitor (WAHA, Evolution API, Whapi) ships Docker. | LOW | Single container, env var config. Already have `http.createServer` in monitor.ts — no framework swap needed. |
| QR code pairing flow | All WhatsApp API platforms start with QR scan. Users expect it in the dashboard. | MEDIUM | WAHA already provides QR code via API. Need to: provision session, poll for QR, display in dashboard, detect "connected" state. |
| Webhook forwarding for inbound messages | Without this, inbound messages go nowhere in standalone mode. Required for any integration. | MEDIUM | Currently delivered to OpenClaw agent. Standalone: forward to registered callback URLs. HMAC signatures (industry standard). Retry with exponential backoff (3 attempts). |
| Standalone config file | Platform cannot depend on openclaw.json in standalone mode | LOW | config-io.ts abstraction. JSON file at `~/.chatlytics/config.json` or env vars. |
| Session health indicator | Dashboard must show WhatsApp connection status. All competitors show this prominently. | LOW | Already have session health monitoring. Expose via `/api/v1/sessions/:id/health`. |
| HMAC signatures on outbound webhooks | Industry standard for webhook authenticity. Stripe, GitHub, Svix all use it. Developers expect it. | LOW | Already have HMAC-SHA256 pattern from pairing tokens. Apply to webhook payloads. Include `X-Chatlytics-Signature` header. |

### MCP Server (Required for AI Agent Distribution)

MCP is now the de facto protocol for connecting AI agents to external tools (adopted by Anthropic, OpenAI, Google DeepMind, Microsoft). Any platform targeting AI agent developers must have an MCP server.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| MCP tools for core actions | Claude Code, Claude Desktop, Cursor, and 12,870+ MCP-aware tools expect this | MEDIUM | Use `@modelcontextprotocol/sdk`. Streamable HTTP transport for remote (SSE deprecated in spec 2025-03-26). stdio for local installs. |
| 8-10 consolidated MCP tools | Best practice: don't map every API endpoint. Block's Linear MCP went from 30+ to 2 tools. "Simplify tool selection for the model." | LOW | Core tools: `send_message`, `send_media`, `send_reaction`, `read_messages`, `search`, `get_directory`, `manage_group`, `get_status`, `update_settings`, `send_poll`. Keep under 12. |
| MCP resources for read-only data | Resources are the MCP pattern for data the agent reads but doesn't mutate | LOW | `chatlytics://contacts`, `chatlytics://groups`, `chatlytics://sessions`, `chatlytics://config`, `chatlytics://mimicry`. |
| Streamable HTTP transport | The current MCP transport standard (replaced HTTP+SSE in spec 2025-03-26). Required for remote cloud deployment. | MEDIUM | Handle both SSE (legacy clients) and Streamable HTTP. `@modelcontextprotocol/sdk` handles transport negotiation. |
| MCP config snippet in dashboard | Users need a one-click copy of the MCP config JSON to paste into their framework | LOW | Display `mcpServers` config snippet in onboarding wizard. Include API key substitution. |
| Actionable error messages in tools | MCP best practice: errors must help the agent decide what to do next | LOW | Already have friendly error messages from v1.18. Ensure MCP tool errors include recovery hints (e.g., "Session disconnected — reconnect at dashboard"). |

### User Onboarding (Required for v2.1 SaaS)

Self-service onboarding is table stakes for any developer-facing SaaS. Competitors (Whapi, Unipile) claim "start in minutes."

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| User registration (email + password) | All SaaS platforms require sign-up | MEDIUM | Use Clerk, Better Auth, or Supabase Auth — don't build custom JWT from scratch. API keys are separate from user auth. |
| Workspace creation | Multi-tenant isolation requires workspace concept | LOW | Workspace = isolated tenant with own WAHA sessions, SQLite DBs, API keys, config. One user = one workspace in v2.1. |
| API key display and copy | Developers need their API key after onboarding. Shown once, stored hashed. | LOW | Display plaintext once on creation. Store hashed (SHA-256). Allow rotation (old key invalid immediately). |
| Integration setup wizard | New users don't know which integration method to choose | MEDIUM | 3-step guided: choose method (MCP / REST / SKILL.md) → copy config → send test message. Each path shows a working curl/code example. |
| Session connect status page | Users need "connected / disconnected / QR needed" prominently | LOW | Extend existing sessions tab. Show QR code when session is in pairing state. Poll WAHA QR endpoint until session connects. |

### Differentiators (Competitive Advantage)

Features unique to Chatlytics that competitors (WAHA, Evolution API, Whapi) lack or implement poorly.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Server-side human mimicry (invisible to clients) | Competitors have no ban prevention. Chatlytics enforces time gates + hourly caps at the API layer — no client code needed. | LOW (already built) | MimicryGate + MimicryEnforcer already exist. Key differentiator: mimicry is transparent — clients call `send_message`, server decides when to actually send. |
| Policy engine with per-contact rules | No WhatsApp API platform offers this level of access control. DM filters, allow-lists, god-mode bypass, pairing challenges. | LOW (already built) | Expose policy config via `/api/v1/config` PATCH. Admin panel already has full UI. |
| Adaptive activity profiles | Per-chat peak-hour learning is unique. The scanner adjusts mimicry windows based on actual usage patterns. No competitor does this. | LOW (already built) | Expose via `chatlytics://activity-profiles` MCP resource and `/api/v1/mimicry/activity-profiles`. |
| FTS5 directory search | Instant fuzzy search across contacts/groups without round-tripping WAHA. Competitors rely on WAHA's slow search endpoints. | LOW (already built) | Already in directory.ts. Expose via `/api/v1/search` and `search` MCP tool. |
| OpenClaw plugin preserved as thin wrapper | Zero migration cost for existing OpenClaw users. Framework-agnostic backend with framework-specific adapters. | MEDIUM | channel.ts becomes a thin HTTP client calling Chatlytics API. All existing SKILL.md action names preserved. |
| SKILL.md distribution format | No WhatsApp API platform has a dedicated "skill file" format for AI agents. Unique to the ecosystem we originated. | LOW | SKILL.md v6+ adapted to reference Chatlytics API endpoints. Covers non-MCP frameworks that accept markdown skill files. |
| Mimicry status API | Developers can see current gate state, hourly cap usage, and next available send window. No competitor exposes this. | LOW | Already have `/api/admin/mimicry/status`. Promote to public API at `/api/v1/mimicry/status`. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time MCP push for inbound messages | Agents want to react to messages without polling | MCP notifications ecosystem is broken in practice (2026). No major framework (LangChain, OpenAI SDK) handles server-push. Chicken-and-egg: servers don't emit, clients don't consume. Building this wastes a phase. | Webhook callbacks (reliable, all frameworks support HTTP callbacks). Expose `read_messages` tool for polling. |
| Per-message billing in v2.0 | Needed for SaaS monetization | Premature. Instruments every send path with billing counters before the send path is even decoupled from OpenClaw. Adds complexity before architecture is stable. | Add usage counters early (cheap), wire billing logic in v2.2 after PMF. |
| Auto-generated SDK clients in v2.0 | Developers want a typed client | openapi-generator output quality varies. TypeScript output often needs manual fixups. Takes a full phase to do well. | Ship the OpenAPI spec first — developers can generate their own clients. Add official SDK in v2.2. |
| WhatsApp Business API (official Meta) | "Legit" tier with Meta approval | Different protocol entirely (Cloud API vs personal). Requires Meta business verification, template approval, per-conversation pricing. Different codebase. Not worth the scope. | Explicitly not in scope. Document clearly. Chatlytics targets personal/power-user accounts via WAHA. |
| GraphQL API | Some developers prefer GraphQL | Extra complexity (resolver layer, schema, subscriptions) over a codebase that already has a clean REST API shape. No evidence of demand. | REST + OpenAPI covers all use cases. |
| Shared WAHA instance multi-tenancy | Cost savings | WAHA sessions are per-phone-number. Mixing tenants in one process risks cross-tenant event delivery bugs. The `accountId` pattern was designed for multi-session, not multi-tenant. | Process-per-tenant for v2.1. Shared WAHA possible in v2.2 with proven isolation. |
| Custom WAHA instance (bring your own) | Power users want their own WAHA | Configuration surface explosion. Different WAHA versions, different API quirks, different Plus vs free feature sets. Support nightmare. | Offer Docker Compose with bundled WAHA. Control the WAHA version. |
| Broadcast/bulk send at scale | Send same message to N contacts | WhatsApp TOS violation at scale. Triggers bans. The mimicry system actively prevents this pattern. | Multi-recipient `sendMulti` exists (10-cap, text-only, sequential with rate limiting). That's the safe limit. |

---

## Feature Dependencies

```
[Config Abstraction] (standalone JSON, not openclaw.json)
    └──required by──> [Standalone HTTP Server]
    └──required by──> [Docker Container]
    └──required by──> [Multi-Tenant Workspace Isolation]

[Standalone HTTP Server] (decouple from OpenClaw gateway)
    └──required by──> [Docker Container]
    └──required by──> [Public REST API]
    └──required by──> [MCP Server]
    └──required by──> [API Key Auth Middleware]

[API Key Auth]
    └──required by──> [Public REST API]
    └──required by──> [MCP Tools] (tools call REST API internally)
    └──required by──> [Webhook Subscription Management]
    └──required by──> [OpenClaw Thin Wrapper]

[WAHA Self-Registration] (register webhook URL with WAHA on startup)
    └──required by──> [Webhook Forwarding]
    └──required by──> [QR Code Pairing Flow] (must detect session state changes)

[Webhook Forwarding]
    └──required by──> [Inbound Message Delivery in Standalone Mode]
    └──enhances──> [MCP read_messages] (local store populated by forwarded webhooks)

[Public REST API]
    └──required by──> [OpenAPI 3.1 Spec] (spec documents the API)
    └──required by──> [MCP Tools] (thin wrapper over same functions)

[User Registration + Workspace]
    └──required by──> [Multi-Tenant Isolation]
    └──required by──> [QR Code Pairing Flow] (workspace must exist first)
    └──required by──> [API Key Management UI]

[Multi-Tenant Isolation]
    └──required by──> [Concurrent Workspaces (50+)]
    └──requires──> [Config Abstraction]
    └──requires──> [Per-workspace SQLite]
    └──requires──> [Per-workspace WAHA Session Namespacing]
```

### Dependency Notes

- **Config Abstraction is Phase 1 blocker**: All standalone work is blocked until `openclaw.json` coupling is removed. Six source files have SDK dependencies that must be severed first.
- **REST API before MCP**: MCP tools call the same internal functions as the REST API. Implement the API layer once and surface it via both HTTP and MCP. Don't implement two separate code paths.
- **Webhook Forwarding before MCP `read_messages` is useful**: Without webhook-populated local message store, `read_messages` must poll WAHA directly every time (slow, no history retention).
- **User Registration is v2.1 scope**: v2.0 works with a single manually-provisioned workspace (static API key in env var). Don't block shipping Docker on auth.
- **Multi-Tenant is v2.1 scope**: v2.0 is single-tenant Docker. The architecture is designed in (per-workspace SQLite, process-per-tenant), but not activated until v2.1.

---

## MVP Definition

### Launch With (v2.0 — Docker Alpha)

Minimum to validate that the extraction works and agents can connect.

- [ ] Standalone HTTP server — container boots, serves admin panel, no OpenClaw dependency
- [ ] Config abstraction — reads from env var path or `~/.chatlytics/config.json`
- [ ] API key authentication — one static API key from env var (`CHATLYTICS_API_KEY`)
- [ ] WAHA self-registration — registers webhook URL with WAHA on startup
- [ ] Public REST API (send, read, search, directory, sessions, mimicry status) — curl-able
- [ ] OpenAPI 3.1 spec — hand-written YAML, served at `/openapi.yaml`
- [ ] MCP server — 8-10 consolidated tools, Streamable HTTP transport, Claude Code connects and sends a message
- [ ] Docker container — `docker run -e WAHA_BASE_URL=... -e CHATLYTICS_API_KEY=... chatlytics`
- [ ] Webhook forwarding — inbound messages reach registered callback URL with HMAC signature

**Exit criteria**: Claude Code sends a WhatsApp message via MCP. `curl` sends a message via REST API. Inbound message triggers a callback.

### Add After Validation (v2.1 — SaaS Beta)

- [ ] User registration (email + password) — Clerk or Better Auth
- [ ] Workspace creation + QR code pairing flow — self-service onboarding
- [ ] API key management in dashboard (create, rotate, revoke)
- [ ] Multi-tenant isolation (process-per-tenant, per-workspace SQLite, per-workspace WAHA sessions)
- [ ] Webhook subscription management UI (register/delete callback URLs, event filters)
- [ ] Integration setup wizard (MCP config snippet, SKILL.md download, curl example)
- [ ] MCP resources (contacts, groups, sessions, config, mimicry)

### Future Consideration (v2.2+)

- [ ] SDK clients (TypeScript + Python, auto-generated from OpenAPI spec)
- [ ] Usage billing and plan limits — add counters in v2.1, wire billing in v2.2
- [ ] Team management (multiple users per workspace)
- [ ] MCP prompts (whatsapp-assistant system prompt template)
- [ ] Framework-specific SKILL.md variants

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Config abstraction (decouple openclaw.json) | HIGH | LOW | P1 |
| Standalone HTTP server (decouple OpenClaw SDK) | HIGH | MEDIUM (6 files with SDK imports) | P1 |
| API key auth middleware | HIGH | LOW | P1 |
| WAHA self-registration on startup | HIGH | LOW | P1 |
| Public REST API (`/api/v1/`) | HIGH | LOW (wraps existing functions) | P1 |
| OpenAPI 3.1 spec | HIGH | MEDIUM (hand-write YAML) | P1 |
| Docker container | HIGH | LOW (http.createServer already exists) | P1 |
| MCP server — core tools | HIGH | MEDIUM (`@modelcontextprotocol/sdk`) | P1 |
| Webhook forwarding with HMAC + retry | HIGH | MEDIUM | P1 |
| QR code pairing flow (dashboard) | MEDIUM | MEDIUM | P2 |
| MCP resources | MEDIUM | LOW | P2 |
| User registration + workspace | MEDIUM | HIGH (auth service) | P2 |
| Webhook subscription management UI | MEDIUM | LOW | P2 |
| Integration setup wizard | MEDIUM | LOW | P2 |
| Multi-tenant isolation | MEDIUM | HIGH (process management) | P2 |
| TypeScript + Python SDK clients | LOW | MEDIUM (openapi-generator) | P3 |
| MCP prompts | LOW | LOW | P3 |
| Usage billing | LOW | HIGH | P3 |
| Framework-specific SKILL.md variants | LOW | LOW | P3 |

---

## Competitor Feature Analysis

| Feature | WAHA (self-hosted) | Whapi (cloud) | Evolution API | Chatlytics |
|---------|-------------------|---------------|---------------|------------|
| REST API | Yes (own API) | Yes | Yes | Yes (wraps WAHA) |
| MCP server | No | No | No | YES (differentiator) |
| OpenAPI spec | Yes (auto-generated) | Yes | Partial | Yes (hand-written, validated) |
| Docker | Yes | N/A (cloud only) | Yes | Yes |
| Webhook forwarding | Outbound only | Yes | Yes | Yes (HMAC + retry + filters) |
| Human mimicry / ban prevention | No | No | No | YES (differentiator) |
| Policy engine / access control | No | No | No | YES (differentiator) |
| Admin dashboard | Basic | Yes | Partial | Yes (React + shadcn/ui) |
| QR code onboarding | Yes (API-driven) | Yes (guided) | Yes | Yes (dashboard-integrated) |
| Multi-tenant | No | Yes (cloud-managed) | No | Yes (v2.1) |
| SKILL.md format | No | No | No | YES (unique) |
| FTS5 directory search | No | No | No | YES (differentiator) |
| SDK clients | Community-generated | No | No | v2.2 |
| Usage billing | No | Per-message | No | v2.2 |

---

## MCP Tool Design Decisions (Research-Backed)

Based on Block's MCP server playbook and the MCP best practices documentation:

**Tool count target**: 8-10. The FelixIsaac whatsapp-mcp-extended has 41 tools — this is too many for reliable LLM tool selection. Block evolved Linear MCP from 30+ tools down to 2. Chatlytics targets ~8-10 core tools.

**Recommended tool set**:
1. `send_message` — text with optional formatting
2. `send_media` — image/video/file/voice with caption
3. `send_reaction` — emoji reaction to a message
4. `send_poll` — create a poll (separate due to unique structure)
5. `read_messages` — list messages for a chat, with count/offset
6. `search` — find contacts, groups, channels by name (wraps FTS5)
7. `get_directory` — list contacts/groups with settings
8. `manage_group` — consolidated group operations (create, add/remove participants, rename)
9. `get_status` — session health + mimicry cap status in one call
10. `update_settings` — update contact DM settings or config

**Why not 1:1 mapping with 109 actions**: MCP tools are "prompts for LLMs." An agent that sees 109 tools with similar names has a harder selection problem. 10 well-named tools with rich descriptions perform better. The 109 actions remain available via the REST API for direct HTTP callers.

**Inbound message delivery**: Do NOT implement MCP push notifications for inbound messages. The ecosystem doesn't consume them (confirmed 2026 — no major framework handles server-push). Use webhook callbacks as the primary inbound channel. Expose `read_messages` for polling. Document this clearly in tool descriptions.

**Transport**: Use Streamable HTTP (the current spec, not deprecated SSE). Support both for transition period since many clients still use SSE transport.

---

## Sources

- [GitHub: lharries/whatsapp-mcp](https://github.com/lharries/whatsapp-mcp) — 12-tool WhatsApp MCP reference implementation
- [GitHub: FelixIsaac/whatsapp-mcp-extended](https://github.com/FelixIsaac/whatsapp-mcp-extended) — 41-tool extended WhatsApp MCP (useful as ceiling example)
- [Block's Playbook for Designing MCP Servers](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers) — Tool consolidation, naming conventions, error handling
- [15 Best Practices for Building MCP Servers in Production](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/) — Tool count, transport, security
- [MCP Notifications — Why Can't Your Agent Watch Your Inbox?](https://ankitmundada.medium.com/mcp-has-notifications-so-why-cant-your-agent-watch-your-inbox-bb688fde7ac5) — Why MCP push is not viable in 2026
- [MCP Transports Spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) — Streamable HTTP replaces SSE
- [Whapi.Cloud](https://whapi.cloud/) — Self-hosted WhatsApp competitor feature reference
- [Evolution API](https://github.com/EvolutionAPI/evolution-api) — Open-source WhatsApp automation server
- [HMAC for Webhooks — Prismatic](https://prismatic.io/blog/how-secure-webhook-endpoints-hmac/) — HMAC signature patterns for webhook security
- [WorkOS: Multi-Tenant SaaS Architecture](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture) — Tenant isolation patterns
- [PulseMCP Server Directory](https://www.pulsemcp.com/servers?q=whatsapp) — WhatsApp MCP ecosystem survey (12,870+ servers indexed)

---
*Feature research for: Chatlytics v2.0 — standalone multi-tenant WhatsApp agent platform*
*Researched: 2026-03-28*
