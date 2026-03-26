# Phase 36: Timeout & Error Hardening - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — infrastructure phase)

<domain>
## Phase Boundary

Every outbound HTTP call has an explicit timeout — no fetch() can hang indefinitely. Covers: bare fetch() calls in monitor.ts (fetchBotJids, /api/admin/sessions, follow/unfollow bulk), media download in downloadWahaMedia(), Gemini video polling, Nominatim geocode, and RateLimiter queue bounds.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

### Key Files
- `src/monitor.ts` — fetchBotJids(), /api/admin/sessions handler, follow/unfollow bulk actions use bare fetch()
- `src/media.ts` — downloadWahaMedia() fetch without timeout, Gemini video polling loop
- `src/rate-limiter.ts` — RateLimiter class with unbounded queue

### Established Patterns
- `callWahaApi` in http-client.ts already uses AbortSignal.timeout
- `AbortSignal.timeout(ms)` is the standard pattern in the codebase

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
