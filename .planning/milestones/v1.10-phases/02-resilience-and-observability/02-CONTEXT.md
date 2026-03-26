# Phase 2: Resilience and Observability - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Detect WAHA session disconnects via periodic health pings, handle inbound webhook floods with a bounded priority queue, and return actionable error messages to the LLM (Sammie) when actions fail. Surface health and queue status in the admin panel.

Requirements: RES-01, RES-02, RES-03, RES-04, RES-05

</domain>

<decisions>
## Implementation Decisions

### Session Health Monitoring (RES-01, RES-02)
- Ping WAHA `/api/{session}/me` at a configurable interval (default 60s via `healthCheckIntervalMs` in config)
- After 3 consecutive failed pings, log a warning and show health warning in admin panel Status tab
- **Warn only** — do NOT block outbound sends on health failure (WAHA might still work for sends even if /me fails)
- **No auto-recovery** — do not attempt session restart. WAHA handles its own reconnection internally
- Health check timer lives in `monitor.ts` (already starts per-account, has session context, serves admin panel)

### Inbound Message Queue (RES-03, RES-04)
- **Two separate queues**: DM queue and group queue. DM queue drains first (priority)
- Queue sizes configurable via config (default 50 DM slots + 50 group slots)
- **Drop oldest on overflow** — silent drop, no auto-reply. Increment overflow counter in stats
- **Serial processing** — one message at a time. Adds backpressure without race conditions. Current handler already processes serially
- No "busy" auto-reply on overflow — sending responses during overload worsens the situation

### LLM Error Messages (RES-05)
- **Structured plain text** format: "Failed to [action] [target]: [status] [error]. Try: [suggestion]."
- **Include retry hints**: rate limits and timeouts say "retry after Xs" or "try again"; permanent errors say "do not retry"
- **Include alternative action suggestions**: e.g., contact not found → suggest "search contacts" to verify target
- **Centralized error wrapper** around handleAction's try/catch — one place formats all errors consistently. Individual actions just throw, the wrapper formats

### Admin Panel Updates
- **Status tab**: Simple green/yellow/red dot per session. Green = healthy, yellow = 1-2 failed pings, red = 3+ failed. Shows last successful ping time
- **New Queue tab**: Dedicated tab showing queue depth (current DM/group counts) and overflow drop count
- **Display only** — no reconnect button (consistent with no auto-recovery decision)
- **New `/api/admin/health` endpoint**: JSON endpoint returning session health status, consecutive failures, last ping time. External tools (n8n) can poll it for alerts

### Claude's Discretion
- Exact health check implementation details (setInterval vs setTimeout chain)
- Queue data structure choice (array shift vs linked list)
- Error message suggestion mapping (which errors suggest which alternative actions)
- Admin panel UI styling details for health indicators and queue tab
- Whether to add the circuit breaker pattern deferred from Phase 1

</decisions>

<specifics>
## Specific Ideas

- Health endpoint `/api/admin/health` should be simple JSON — easy for n8n or other monitoring to poll
- Queue overflow counter should be visible in the new Queue tab, same as filter stats pattern
- Error messages should be natural language that Sammie can incorporate into responses to the user, not raw technical output
- Two-queue design keeps DM priority simple and predictable — no priority sorting complexity

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `monitor.ts` already has admin API routes, admin panel UI, and per-account startup — natural home for health checks
- `http-client.ts` (from Phase 1) has `callWahaApi` with structured logging — health pings should use this
- `warnOnError()` utility (from Phase 1) — use for health check failure logging
- Filter stats tracking pattern in `monitor.ts` — reuse for queue overflow counters

### Established Patterns
- Admin panel tabs: Directory, Config, Filter Stats, Status — adding Queue tab follows existing pattern
- Admin API routes under `/api/admin/*` — health endpoint follows convention
- Config schema in `config-schema.ts` with Zod validation — add health and queue config fields
- `handleAction` in `channel.ts` already has try/catch — wrap with error formatter

### Integration Points
- `monitor.ts` `monitorWahaProvider()` — add health check timer startup here
- `inbound.ts` `handleWahaInbound()` — queue ingestion point (currently processes directly)
- `channel.ts` `handleAction()` — wrap with centralized error formatter
- `config-schema.ts` — add `healthCheckIntervalMs`, `dmQueueSize`, `groupQueueSize` fields

</code_context>

<deferred>
## Deferred Ideas

- Circuit breaker pattern — deferred from Phase 1, evaluate during Phase 2 research if needed
- WhatsApp notification on session disconnect (send alert from another session) — Phase 4 multi-session feature
- Queue metrics over time (history/graphs) — out of scope, simple counters sufficient

</deferred>

---

*Phase: 02-resilience-and-observability*
*Context gathered: 2026-03-11*
