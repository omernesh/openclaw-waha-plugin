# Phase 25: Session Auto-Recovery - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Enhance the existing health monitor (health.ts) to automatically attempt WAHA session restart when unhealthy, with cooldown protection, and alert god mode users via WhatsApp. Surface recovery events in admin Dashboard.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase with clear requirements:
- REC-01: Auto-restart after 5 consecutive failures via WAHA session restart API
- REC-02: 5-minute cooldown between restart attempts
- REC-03: Recovery events in Dashboard health cards (attempt count, last recovery, outcome)
- REC-04: Alert god mode users via WhatsApp using healthy session
- E2E tests can use both sessions: omer (3cf11776_omer) and logan (3cf11776_logan)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `health.ts` — existing session health monitor with periodic ping, degraded/unhealthy thresholds
- `http-client.ts` — callWahaApi with timeout, rate limiting, 429 backoff
- `send.ts` — sendWahaText for alerting god mode users
- `config-schema.ts` — DmFilterSuperUserSchema for god mode user list
- `monitor.ts` — admin API routes, Dashboard stats endpoint

### Established Patterns
- setTimeout chain for periodic operations (health.ts, sync.ts)
- console.warn for health state changes
- callWahaApi for all WAHA interactions
- Admin API routes return JSON via writeJsonResponse()

### Integration Points
- health.ts — add recovery logic after unhealthy detection
- monitor.ts — extend /api/admin/stats or add /api/admin/health with recovery history
- Dashboard React component — display recovery events in health cards

</code_context>

<specifics>
## Specific Ideas

- WAHA session restart API: POST /api/sessions/{session}/restart
- God mode users defined in config: channels.waha.dmFilter.godModeSuperUsers
- Use a healthy session to send alerts (if bot session is unhealthy, use human session)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
