# Phase 60: Public REST API + OpenAPI + CLI - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous mode — discuss skipped)

<domain>
## Phase Boundary

External callers can send WhatsApp messages, read messages, search contacts, and query sessions via authenticated REST endpoints, a machine-readable spec, and a CLI tool. /api/v1/ route groups, API key auth, openapi.yaml, Spectral CI lint, Swagger UI, `npx chatlytics` CLI tool.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key decision areas:
- API key format and storage (e.g., `ctl_xxx` prefix, stored in config or separate file)
- Route handler pattern (express-style middleware or raw http.IncomingMessage)
- OpenAPI spec generation (manual YAML vs code-gen from routes)
- CLI framework choice (Commander.js, yargs, or custom)
- Swagger UI serving approach (static files vs CDN)

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. Key existing infrastructure:
- monitor.ts HTTP server (raw Node.js, no framework)
- send.ts WAHA API calls
- directory.ts SQLite contact/group storage
- health.ts health state management

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
