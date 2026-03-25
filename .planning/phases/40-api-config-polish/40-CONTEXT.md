# Phase 40: API & Config Polish - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — infrastructure phase)

<domain>
## Phase Boundary

Admin API is rate-limited, request handling is side-effect-free, and config values have enforced bounds. Adds admin rate limiting, fixes req.url mutation, enforces min bounds on healthCheckIntervalMs and syncIntervalMinutes, fixes configureReliability per-account race.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

- `src/monitor.ts` — admin routes, req.url mutation at line ~613, SSE
- `src/config-schema.ts` — Zod schemas for config fields
- `src/http-client.ts` — configureReliability() sets module globals
- `src/rate-limiter.ts` — RateLimiter class (now with maxQueue from Phase 36)

</code_context>

<specifics>
No specific requirements — infrastructure phase.
</specifics>

<deferred>
None.
</deferred>
