# Phase 63: Dashboard Auth + Onboarding - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous mode)

<domain>
## Phase Boundary

A new user can sign up, connect a WhatsApp number via QR code, and get an API key or MCP config — entirely self-service with no manual server config. better-auth registration, workspace creation, QR pairing, API key UI.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key areas:
- better-auth configuration (SQLite adapter, email+password provider)
- Workspace model design
- QR code flow (WAHA QR endpoint → SSE → admin panel)
- API key generation (crypto.randomBytes, ctl_ prefix)
- Admin panel React integration

</decisions>

<code_context>
## Existing Code Insights

Admin panel: src/admin/ (React + Vite + shadcn/ui + Tailwind). Existing tabs: Directory, Config, Filter Stats, Status.
Server: monitor.ts HTTP server. Auth pattern: api-v1-auth.ts (Bearer token).
WAHA QR: GET /api/{session}/auth/qr endpoint.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
