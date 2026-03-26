# Phase 32: Platform Abstraction - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Consolidate WAHA API calls behind a WahaClient class, define a platform adapter interface, and prepare multi-tenant config isolation for future SaaS deployment.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — architectural refactor:

- PLAT-01: Extract WahaClient class. Currently ~80 individual sendWaha* functions in send.ts call callWahaApi directly. Create a WahaClient class that wraps these with stateful config (baseUrl, apiKey, session), built-in retry, and caching. Functions in send.ts should delegate to the client. The client should be instantiated per-account. Keep backward compatibility — existing callers should still work.
- PLAT-02: Define adapter interface. Create a ChannelAdapter or PlatformAdapter interface that abstracts the WAHA-specific implementation. This allows future platforms (direct WhatsApp Web, other messaging APIs) to be swapped in. Interface should cover: send, receive, presence, groups, contacts, media. Don't over-abstract — keep it practical.
- PLAT-03: Multi-tenant config isolation groundwork. Currently config is a singleton (one openclaw.json). For SaaS, each tenant needs isolated config, sessions, and directory databases. Add tenant ID parameter to key functions (config read, directory access, session resolution). Don't implement full multi-tenancy — just thread the parameter through so it CAN be isolated later. Default tenant = "default" for backward compat.

IMPORTANT constraints:
- This is GROUNDWORK, not full multi-tenancy. No new deployment infrastructure.
- Must not break any existing functionality. All changes backward-compatible.
- send.ts functions must continue to work as-is (WahaClient wraps them, doesn't replace)
- No changes to the OpenClaw plugin SDK interface
- Keep the refactor incremental — this is the foundation, not the full SaaS platform

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/send.ts` — ~1600 lines, all WAHA API functions
- `src/http-client.ts` — callWahaApi, TokenBucket rate limiter
- `src/accounts.ts` — resolveAccountParams, multi-account resolution
- `src/directory.ts` — DirectoryDb with per-account instances
- `src/config-schema.ts` — Zod schemas for config

### Established Patterns
- resolveAccountParams(cfg, accountId) → {baseUrl, apiKey, session}
- callWahaApi({baseUrl, apiKey, path, body?, method?})
- Per-account directory DBs (already semi-isolated)
- Config read from ~/.openclaw/openclaw.json

### Integration Points
- New src/waha-client.ts — WahaClient class
- New src/adapter.ts — PlatformAdapter interface
- send.ts — refactor to use WahaClient internally
- accounts.ts — tenant-aware account resolution
- directory.ts — tenant-aware DB paths

</code_context>

<specifics>
## Specific Ideas

- WahaClient should accept {baseUrl, apiKey, session, rateLimiter?} in constructor
- Adapter interface methods: sendText, sendMedia, getGroups, getContacts, setPresence, handleWebhook
- Tenant ID: simple string parameter, defaults to "default"
- Don't move files around — add new files, modify existing ones minimally

</specifics>

<deferred>
## Deferred Ideas

- Full SaaS deployment (Docker per-tenant, auth, billing) — future milestone
- Multiple simultaneous WAHA servers — future
- Admin panel tenant switching — future

</deferred>
