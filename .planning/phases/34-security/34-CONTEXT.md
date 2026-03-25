# Phase 34: Security - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — infrastructure phase)

<domain>
## Phase Boundary

Admin API and webhook endpoints are protected against unauthorized access and injection. Implements Bearer token authentication on all `/api/admin/*` routes, validates config import payloads beyond the `waha` sub-section, validates JID format from URL path segments, and defaults webhook HMAC to a random secret when not configured.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

### Key Files
- `src/monitor.ts` — all `/api/admin/*` routes (currently unauthenticated), webhook HMAC verification, config import endpoint
- `src/config-schema.ts` — Zod config schemas
- `src/config-io.ts` — config read/write (from Phase 33)

### Established Patterns
- HMAC verification already exists for webhook path (opt-in via `webhookHmacKey`)
- Admin routes use pattern matching on `req.url` with `writeJsonResponse`/`writeWebhookError` helpers
- JID values extracted via `decodeURIComponent(m[1])` from URL regex matches

### Integration Points
- All admin API route handlers in `createWahaWebhookServer()`
- Config schema for storing admin auth token
- Webhook HMAC verification block

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
