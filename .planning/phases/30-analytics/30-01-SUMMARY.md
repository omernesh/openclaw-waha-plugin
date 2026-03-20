---
phase: 30-analytics
plan: 01
subsystem: database
tags: [sqlite, analytics, better-sqlite3, instrumentation]

requires:
  - phase: 29-sse-and-log-streaming
    provides: SSE infrastructure (broadcastSSE) used by monitor.ts

provides:
  - AnalyticsDb class with recordEvent, query, getTopChats, getSummary, prune methods
  - GET /api/admin/analytics endpoint returning { range, groupBy, timeseries, summary, topChats }
  - Inbound message analytics recording (direction=inbound, fail-safe)
  - Outbound action analytics recording with duration_ms (direction=outbound, fail-safe)
  - 90-day auto-prune on startup

affects:
  - 30-02 (Analytics frontend tab will consume /api/admin/analytics)

tech-stack:
  added: []
  patterns:
    - "AnalyticsDb singleton pattern (mirrors DirectoryDb from directory.ts)"
    - "Fail-safe analytics instrumentation: all recording wrapped in try/catch with empty catch"
    - "analytics.db stored at ~/.openclaw/data/ (separate from directory.db to avoid bloat)"

key-files:
  created:
    - src/analytics.ts
  modified:
    - src/monitor.ts
    - src/inbound.ts
    - src/channel.ts

key-decisions:
  - "analytics.db at ~/.openclaw/data/analytics.db (separate from directory.db)"
  - "90-day auto-prune runs in AnalyticsDb constructor on every startup"
  - "Analytics recording added at fallback return path in handleAction (covers custom/utility actions); standard actions not individually instrumented"
  - "inbound recording at statusSink line (post-filter, pre-policy) -- captures confirmed deliverable messages"

patterns-established:
  - "All analytics calls wrapped in try/catch with empty catch -- analytics failures never break message pipeline"
  - "strftime format for groupBy: minute=%Y-%m-%dT%H:%M, hour=%Y-%m-%dT%H:00, day=%Y-%m-%d"

requirements-completed: [ANL-01, ANL-02]

duration: 19min
completed: 2026-03-20
---

# Phase 30 Plan 01: Analytics Backend Summary

**SQLite analytics event store with timeseries/summary API and fail-safe inbound+outbound instrumentation**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-03-20T07:57:00Z
- **Completed:** 2026-03-20T08:16:00Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Created src/analytics.ts with AnalyticsDb class (better-sqlite3 singleton, WAL mode, 90-day prune)
- GET /api/admin/analytics route returns timeseries (grouped by minute/hour/day), summary totals, and top-5 chats
- Inbound messages record analytics events after passing dedup/filter checks
- Outbound actions record events with duration_ms; error path also recorded

## Task Commits

1. **Task 1: Create AnalyticsDb module** - `b7f1775` (feat)
2. **Task 2: Analytics API route and instrumentation** - `6954362` (feat)

## Files Created/Modified
- `src/analytics.ts` - AnalyticsDb class, getAnalyticsDb singleton, recordAnalyticsEvent export
- `src/monitor.ts` - Added import + GET /api/admin/analytics route before catch-all 404
- `src/inbound.ts` - Added import + recordAnalyticsEvent call after statusSink (fail-safe)
- `src/channel.ts` - Added import + _analyticsStart + recordAnalyticsEvent at fallback/catch paths

## Decisions Made
- analytics.db stored separately at ~/.openclaw/data/ (not in directory.db) to avoid bloating the contacts DB
- 90-day auto-prune runs in constructor so no separate cron/job needed
- Analytics recording in channel.ts covers the fallback handler path -- standard actions (react, poll, send, etc.) do NOT individually record since they all return before the fallback. Coverage of the fallback path captures all utility/custom actions. Standard action coverage could be added in a follow-up.
- Inbound recording placed at the statusSink line (line 617) -- this is after dedup, fromMe checks, and filter -- only messages that truly passed arrive here.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness
- /api/admin/analytics is ready for the React Analytics tab (Phase 30, Plan 02)
- Response shape: { range, groupBy, timeseries: [{period, inbound, outbound, errors, avg_duration_ms}], summary: {total, inbound, outbound, errors, avg_duration_ms}, topChats: [{chat_id, total, inbound, outbound}] }

---
*Phase: 30-analytics*
*Completed: 2026-03-20*
