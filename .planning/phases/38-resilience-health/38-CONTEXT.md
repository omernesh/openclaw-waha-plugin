# Phase 38: Resilience & Health - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — infrastructure phase)

<domain>
## Phase Boundary

Outbound calls fail fast when a session is unhealthy, recovery is verified before marking success, and queue drains never throw unhandled rejections. Adds circuit breaker to callWahaApi, polls session status after recovery restart, and wraps InboundQueue drain finally block.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

- `src/http-client.ts` — callWahaApi with retry logic, sessionHealthStates map
- `src/health.ts` — attemptRecovery marks success optimistically on 200
- `src/inbound-queue.ts` — drain() finally block re-calls drain() without try/catch

</code_context>

<specifics>
No specific requirements — infrastructure phase.
</specifics>

<deferred>
None.
</deferred>
