# Phase 29: Real-Time Admin Panel - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add Server-Sent Events (SSE) to the admin panel so it receives live updates — health changes, queue depth, new log entries — without manual refresh.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase:

- RT-01: SSE endpoint at GET /api/admin/events. Emit JSON events with type field (health, queue, log, config). Keep-alive every 30s. Support multiple concurrent connections. Auto-cleanup on disconnect.
- RT-02: Dashboard cards auto-update on health/queue events. No full page reload — just update the affected card data. Health card should reflect state within 2 seconds of change.
- RT-03: Log tab auto-scrolls on new log entries via SSE. Only auto-scroll if user hasn't scrolled up (preserve user scroll position). New entries append to existing list.
- RT-04: Connection indicator in sidebar — green "Connected", amber "Reconnecting", red "Disconnected". Use EventSource API with auto-reconnect.
- Use React hook (useEventSource or similar) for SSE client-side management
- SSE events should be lightweight — send event type + minimal data, let client fetch full data if needed

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/monitor.ts` — HTTP server, existing admin API routes
- `src/health.ts` — health state changes (can emit SSE events)
- `src/inbound-queue.ts` — queue depth tracking
- `src/admin/src/lib/api.ts` — API client
- `src/admin/src/components/layout/Sidebar.tsx` — sidebar component

### Established Patterns
- Admin routes: {const m = req.method === "GET" && req.url?.match(...)}
- Health state tracked in health.ts with callbacks
- Queue stats via getStats() in inbound-queue.ts
- React state management via hooks

### Integration Points
- monitor.ts — SSE endpoint, emit events from health/queue/log handlers
- health.ts — emit SSE on state change
- admin/hooks/ — new useEventSource hook
- DashboardTab — consume SSE for health/queue updates
- LogTab — consume SSE for new log entries
- Sidebar — connection indicator

</code_context>

<specifics>
## Specific Ideas

- SSE is simpler than WebSocket for one-way server→client push
- EventSource API auto-reconnects on disconnect
- Node.js SSE: set headers (Content-Type: text/event-stream, Cache-Control: no-cache, Connection: keep-alive), write `data: {...}\n\n` format
- Keep SSE connections list in monitor.ts, broadcast helper function

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>
