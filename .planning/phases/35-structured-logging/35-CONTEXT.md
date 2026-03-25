# Phase 35: Structured Logging - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — infrastructure phase)

<domain>
## Phase Boundary

All log output is machine-parseable JSON with consistent fields (level, timestamp, component, sessionId, chatId), enabling log aggregation and filtering. A `logger` module replaces all freeform `console.log/warn/error` calls in production code. Log level is configurable.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

### Key Files
- All source files use `console.log/warn/error` with freeform string templates
- `src/monitor.ts` — heaviest logging (webhook events, admin API, health)
- `src/inbound.ts` — message processing logs
- `src/send.ts` — API call logs
- `src/health.ts` — health check logs
- `src/sync.ts` — sync cycle logs
- `src/http-client.ts` — request/response logs

### Integration Points
- Logger module must be importable from all source files
- Log level configurable via config or environment variable
- Must not break existing log format consumers (journalctl)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
