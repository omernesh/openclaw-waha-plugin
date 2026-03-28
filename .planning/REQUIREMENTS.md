# Requirements: Chatlytics v2.0

**Defined:** 2026-03-28
**Core Value:** Any AI agent framework can send/receive WhatsApp messages through Chatlytics with mimicry enforcement, policy controls, and directory features — zero framework-specific code required.

## v2.0 Requirements

Requirements for the Chatlytics Universal Agent Platform. Each maps to roadmap phases.

### Core Extraction

- [x] **CORE-01**: Standalone process boots without any OpenClaw SDK dependency at runtime
- [x] **CORE-02**: Config reads from standalone JSON file (CHATLYTICS_CONFIG_PATH env var or ~/.chatlytics/config.json)
- [x] **CORE-03**: WAHA webhook self-registration on startup (POST /api/{session}/webhooks)
- [x] **CORE-04**: Docker container starts with env var config and serves admin panel
- [x] **CORE-05**: Health endpoint reports webhook_registered and session connection status
- [x] **CORE-06**: SQLite databases persist via named Docker volume

### Public API

- [x] **API-01**: REST endpoints for send, read messages, search, directory, sessions, mimicry status under /api/v1/
- [x] **API-02**: API key authentication via Bearer ctl_xxx header with timing-safe comparison
- [x] **API-03**: OpenAPI 3.1 spec served at /openapi.yaml and validated with Spectral in CI
- [x] **API-04**: CORS headers for dashboard cross-origin requests

### MCP Server

- [x] **MCP-01**: 8-10 consolidated MCP tools (send_message, send_media, read_messages, search, get_directory, manage_group, get_status, update_settings, send_poll, send_reaction)
- [x] **MCP-02**: Streamable HTTP transport on /mcp path (not deprecated SSE)
- [x] **MCP-03**: stdio transport mode for npx chatlytics-mcp local installs
- [x] **MCP-04**: MCP resources for contacts, groups, sessions, config, mimicry status
- [x] **MCP-05**: Actionable error messages with recovery hints in tool responses

### CLI Tool

- [x] **CLI-01**: `npx chatlytics` CLI with subcommands for core actions (send, read, search, groups, contacts, status)
- [x] **CLI-02**: CLI reads API key from CHATLYTICS_API_KEY env var or --api-key flag
- [x] **CLI-03**: CLI reads server URL from CHATLYTICS_URL env var or --url flag (default http://localhost:8050)
- [x] **CLI-04**: Human-friendly output with color and tables, plus --json flag for machine-readable output

### Webhook Forwarding

- [x] **HOOK-01**: Inbound messages forwarded to registered callback URLs
- [x] **HOOK-02**: HMAC-SHA256 signatures on webhook payloads (X-Chatlytics-Signature header)
- [x] **HOOK-03**: Exponential backoff retry (3 attempts: 1s/2s/4s) with circuit breaker
- [x] **HOOK-04**: Webhook subscription stored in config (URL, event filters)

### Auth & Onboarding

- [x] **AUTH-01**: User registration with email and password (better-auth)
- [x] **AUTH-02**: Workspace creation (isolated tenant with own sessions, DBs, API keys)
- [x] **AUTH-03**: QR code scanning flow in dashboard (provision WAHA session, poll QR, detect connected)
- [x] **AUTH-04**: API key generation UI (show plaintext once, copy button, stored hashed)
- [x] **AUTH-05**: API key rotation (old key invalidated immediately)
- [x] **AUTH-06**: Integration setup wizard (choose MCP/REST/SKILL.md, copy config, send test message)

### Multi-Tenant

- [x] **TENANT-01**: Per-workspace process isolation (crash containment)
- [x] **TENANT-02**: Per-workspace SQLite databases (directory, mimicry, analytics)
- [x] **TENANT-03**: Per-workspace WAHA session namespacing (ctl_{workspaceId}_{sessionName})
- [x] **TENANT-04**: API gateway routes by API key to workspace process

### Admin & Distribution

- [ ] **ADMIN-01**: Admin panel with standalone auth (not embedded in OpenClaw gateway)
- [ ] **ADMIN-02**: Workspace management in admin panel (create, switch, delete workspaces)
- [ ] **SKILL-01**: SKILL.md v4 referencing Chatlytics API key + MCP config (framework-agnostic)
- [x] **SITE-01**: Landing page at chatlytics.ai with product overview and getting started guide
- [x] **SITE-02**: API documentation site with interactive examples

### Backward Compatibility

- [ ] **COMPAT-01**: OpenClaw plugin refactored as thin Chatlytics API wrapper
- [ ] **COMPAT-02**: All existing SKILL.md action names preserved in REST API
- [ ] **COMPAT-03**: Existing admin panel routes and functionality preserved

## Future Requirements

Deferred to v2.2+. Tracked but not in current roadmap.

### SDK & Billing

- **SDK-01**: Auto-generated TypeScript SDK client from OpenAPI spec
- **SDK-02**: Auto-generated Python SDK client from OpenAPI spec
- **BILL-01**: Per-workspace usage counters (messages sent, API calls)
- **BILL-02**: Plan limits enforcement (message cap per plan tier)

### Advanced Features

- **TEAM-01**: Multiple users per workspace with role-based access
- **MCP-06**: MCP prompt templates (whatsapp-assistant, group-manager system prompts)
- **SKILL-02**: Framework-specific SKILL.md auto-generation per agent framework
- **AUDIT-01**: Per-workspace audit log of all API calls and policy decisions
- **WAHA-01**: Bring-your-own WAHA instance support

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| WhatsApp Business API (official Meta) | Different protocol (Cloud API), requires business verification, different pricing model |
| GraphQL API | REST + OpenAPI covers all use cases, no evidence of demand |
| MCP push notifications for inbound | Ecosystem not ready in 2026 — no major framework handles server-push |
| Shared WAHA instance multi-tenancy | Cross-tenant event delivery risk; process-per-tenant required first |
| Real-time chat (WebSocket) | Webhook callbacks + polling sufficient for agent use cases |
| Broadcast/bulk send at scale | WhatsApp TOS violation, mimicry system prevents this |
| Scheduled messages | WAHA doesn't support |
| Disappearing messages | Low priority |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 58 | Complete |
| CORE-02 | Phase 58 | Complete |
| CORE-03 | Phase 58 | Complete |
| CORE-05 | Phase 58 | Complete |
| CORE-04 | Phase 59 | Complete |
| CORE-06 | Phase 59 | Complete |
| API-01 | Phase 60 | Complete |
| API-02 | Phase 60 | Complete |
| API-03 | Phase 60 | Complete |
| API-04 | Phase 60 | Complete |
| CLI-01 | Phase 60 | Complete |
| CLI-02 | Phase 60 | Complete |
| CLI-03 | Phase 60 | Complete |
| CLI-04 | Phase 60 | Complete |
| HOOK-01 | Phase 61 | Complete |
| HOOK-02 | Phase 61 | Complete |
| HOOK-03 | Phase 61 | Complete |
| HOOK-04 | Phase 61 | Complete |
| MCP-01 | Phase 62 | Complete |
| MCP-02 | Phase 62 | Complete |
| MCP-03 | Phase 62 | Complete |
| MCP-04 | Phase 62 | Complete |
| MCP-05 | Phase 62 | Complete |
| AUTH-01 | Phase 63 | Complete |
| AUTH-02 | Phase 63 | Complete |
| AUTH-03 | Phase 63 | Complete |
| AUTH-04 | Phase 63 | Complete |
| AUTH-05 | Phase 63 | Complete |
| AUTH-06 | Phase 63 | Complete |
| TENANT-01 | Phase 64 | Complete |
| TENANT-02 | Phase 64 | Complete |
| TENANT-03 | Phase 64 | Complete |
| TENANT-04 | Phase 64 | Complete |
| ADMIN-01 | Phase 65 | Pending |
| ADMIN-02 | Phase 65 | Pending |
| SKILL-01 | Phase 65 | Pending |
| SITE-01 | Phase 65 | Complete |
| SITE-02 | Phase 65 | Complete |
| COMPAT-01 | Phase 66 | Pending |
| COMPAT-02 | Phase 66 | Pending |
| COMPAT-03 | Phase 66 | Pending |

**Coverage:**
- v2.0 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-28*
*Last updated: 2026-03-28 — traceability populated by roadmapper*
