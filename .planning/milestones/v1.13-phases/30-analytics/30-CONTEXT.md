# Phase 30: Analytics - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Record message activity to SQLite and surface it in a new Analytics tab with hourly/daily charts for traffic patterns and response times.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase:

- ANL-01: SQLite analytics table in directory.ts (or separate analytics.ts): message_events with columns: id, timestamp, direction (inbound/outbound), chat_type (dm/group), action (send/reply/react/etc), duration_ms (processing time), status (success/error), chat_id, account_id. Record on inbound message delivery and outbound action completion.
- ANL-02: GET /api/admin/analytics?range=24h&groupBy=hour — returns aggregated data. Support ranges: 1h, 6h, 24h, 7d, 30d. GroupBy: minute (for 1h), hour (for 6h/24h), day (for 7d/30d). Return: [{period, inbound, outbound, errors, avg_duration_ms}]
- ANL-03: Analytics tab in admin panel with recharts. Show: messages/hour bar chart (stacked inbound/outbound), response time line chart, top 5 active chats table. Range selector dropdown. Auto-refresh via SSE or polling.
- Use recharts (already in shadcn ecosystem, lightweight)
- Keep analytics table bounded — auto-prune entries older than 90 days on startup

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/directory.ts` — DirectoryDb class with better-sqlite3 patterns
- `src/monitor.ts` — admin API routes, SSE broadcasting
- `src/inbound.ts` — handleWahaInbound (instrument for inbound timing)
- `src/channel.ts` — handleAction (instrument for outbound timing)
- `src/admin/src/components/tabs/` — tab component pattern

### Established Patterns
- SQLite tables with WAL mode via better-sqlite3
- Admin API routes return JSON via writeJsonResponse
- React tabs follow TabHeader + content pattern
- SSE events for real-time updates (from Phase 29)

### Integration Points
- New analytics.ts or extend directory.ts — SQLite table + record/query methods
- monitor.ts — new /api/admin/analytics route
- inbound.ts — record inbound events
- channel.ts — record outbound events
- admin/src/components/tabs/AnalyticsTab.tsx — new tab
- admin/src/App.tsx — register new tab
- package.json — add recharts dependency

</code_context>

<specifics>
## Specific Ideas

- recharts: `npm install recharts` in admin directory
- BarChart for message volume, LineChart for response times
- Keep analytics module separate from directory.ts to avoid bloating it

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>
