---
phase: 30-analytics
verified: 2026-03-20T09:00:00Z
status: gaps_found
score: 9/10 must-haves verified
gaps:
  - truth: "Every outbound action completion records an analytics event with direction=outbound"
    status: partial
    reason: "recordAnalyticsEvent is only placed at the fallback handler path (line 714) and the catch block (line 737) in channel.ts. Standard targeted actions (send, reply, react, poll, edit, unsend, pin, unpin, read, delete) each return before reaching either recording point. Utility/custom actions through ACTION_HANDLERS are covered. Core standard actions are not."
    artifacts:
      - path: "src/channel.ts"
        issue: "Lines 543-706 contain 10+ standard action branches — each returns early before the fallback recording at line 714. Only actions reaching the fallback (line 709) record analytics."
    missing:
      - "Add recordAnalyticsEvent calls inside each standard action branch (send/reply, react, poll, edit, unsend/delete, pin, unpin, read), or refactor the handler to funnel all successful returns through a common post-action recording point."
human_verification:
  - test: "Open admin panel Analytics tab and verify charts render with real data"
    expected: "Analytics tab appears in sidebar, stacked bar chart and line chart render, range selector (1h/6h/24h/7d/30d) switches views, summary cards show counts"
    why_human: "Visual rendering, chart interactivity, and live API data flow cannot be verified programmatically"
  - test: "Send a few test WhatsApp messages and verify they appear in analytics"
    expected: "After sending messages and refreshing the Analytics tab, the inbound count in summary cards and chart bars increases"
    why_human: "Requires live WAHA session, real message traffic, and visual inspection of chart data updating"
---

# Phase 30: Analytics Verification Report

**Phase Goal:** Message activity is recorded to SQLite and surfaced in a new Analytics tab with hourly/daily charts — giving operators visibility into traffic patterns and response times.
**Verified:** 2026-03-20T09:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Every inbound message delivery records an analytics event with direction=inbound | VERIFIED | `inbound.ts` line 51: import; line 620-624: recordAnalyticsEvent wrapped in try/catch after dedup/filter pass |
| 2 | Every outbound action completion records an analytics event with direction=outbound | PARTIAL | Fallback/utility actions covered (line 714). Standard actions (send, react, poll, edit, etc.) each return early — never reach the recording point at line 714 |
| 3 | GET /api/admin/analytics returns aggregated data grouped by hour or day | VERIFIED | `monitor.ts` line 2170-2193: route parses range+groupBy, calls getAnalyticsDb().query() + getSummary() + getTopChats(), returns JSON |
| 4 | Analytics table auto-prunes entries older than 90 days on startup | VERIFIED | `analytics.ts` line 27: `this.prune(90)` called in constructor |
| 5 | Analytics tab appears in the sidebar navigation and renders when clicked | VERIFIED (automated) | `AppSidebar.tsx` line 39: `'analytics'` in TabId union; line 49: NAV_ITEMS entry with BarChart3 icon; `App.tsx` line 18: lazy import; line 63: renderActiveTab case |
| 6 | Messages-per-hour bar chart displays stacked inbound/outbound bars | VERIFIED | `AnalyticsTab.tsx` lines 184-198: ResponsiveContainer + BarChart + stacked Bar (inbound #22c55e, outbound #3b82f6, errors #ef4444) |
| 7 | Response time line chart shows average duration per period | VERIFIED | `AnalyticsTab.tsx` lines 208-226: LineChart with Line for avg_duration_ms (#f59e0b) |
| 8 | Top 5 active chats table displays chat IDs with message counts | VERIFIED | `AnalyticsTab.tsx` lines 236-255: table over data.topChats, truncated chat_id, inbound/outbound/total columns |
| 9 | Range selector dropdown switches between 1h, 6h, 24h, 7d, 30d views | VERIFIED | `AnalyticsTab.tsx`: button group with 5 ranges, useEffect re-fetches on range change |
| 10 | Charts populate from live API data, not mock data | VERIFIED | `AnalyticsTab.tsx` line 72: `api.getAnalytics(range)` called in useEffect on [refreshKey, range]; no mock data in component |

**Score:** 9/10 truths verified (1 partial)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/analytics.ts` | AnalyticsDb class with recordEvent, query, prune methods; exports getAnalyticsDb, recordAnalyticsEvent | VERIFIED | 61 lines. All 6 required exports present: AnalyticsDb, recordEvent, query, getTopChats, getSummary, prune, getAnalyticsDb, recordAnalyticsEvent. WAL mode, foreign keys, 90-day prune in constructor. |
| `src/monitor.ts` | GET /api/admin/analytics route | VERIFIED | Line 2170: route present, calls getAnalyticsDb(), returns {range, groupBy, timeseries, summary, topChats} |
| `src/admin/src/components/tabs/AnalyticsTab.tsx` | Analytics tab with recharts charts and range selector; min_lines: 80 | VERIFIED | 268 lines (well above min). BarChart, LineChart, ResponsiveContainer, range selector, summary cards, top chats table. |
| `src/admin/src/lib/api.ts` | getAnalytics() API method | VERIFIED | Line 189: `getAnalytics: (range = '24h', groupBy?: string): Promise<AnalyticsResponse>` |
| `src/admin/src/types.ts` | AnalyticsResponse type | VERIFIED | Lines 259-289: AnalyticsTimeseriesPoint, AnalyticsSummary, AnalyticsTopChat, AnalyticsResponse all defined |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/inbound.ts` | `src/analytics.ts` | recordAnalyticsEvent after message delivery | WIRED | Import line 51, call line 623, fail-safe try/catch |
| `src/channel.ts` | `src/analytics.ts` | recordAnalyticsEvent in handleAction | PARTIAL | Import line 93, _analyticsStart line 537. Recording ONLY at fallback path (line 714) and catch block (line 737) — standard action branches (send, react, poll, etc.) return before recording |
| `src/monitor.ts` | `src/analytics.ts` | getAnalyticsDb().query() in API route | WIRED | Import line 30, getAnalyticsDb() call line 2185 |
| `src/admin/src/components/tabs/AnalyticsTab.tsx` | `/api/admin/analytics` | api.getAnalytics() fetch call | WIRED | Line 72: api.getAnalytics(range) in useEffect |
| `src/admin/src/App.tsx` | `AnalyticsTab.tsx` | lazy import and renderActiveTab case | WIRED | Line 18: lazy import; line 63: case 'analytics' |
| `src/admin/src/components/AppSidebar.tsx` | analytics tab id | NAV_ITEMS entry | WIRED | Line 39: TabId union includes 'analytics'; line 49: NAV_ITEMS entry |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| ANL-01 | 30-01 | SQLite analytics table (message_events: timestamp, direction, chat_type, action, duration_ms, status) | SATISFIED | `analytics.ts`: CREATE TABLE IF NOT EXISTS message_events with all required columns + indexes; WAL mode; 90-day prune |
| ANL-02 | 30-01 | Analytics API endpoint (GET /api/admin/analytics?range=24h&groupBy=hour) | SATISFIED | `monitor.ts` line 2170: route returns {range, groupBy, timeseries, summary, topChats}; auto-selects groupBy from range shorthand |
| ANL-03 | 30-02 | Analytics tab in admin panel with charts (recharts — messages/hour, response times, top chats) | SATISFIED | `AnalyticsTab.tsx` 268 lines: stacked BarChart, LineChart, top chats table, range selector, summary cards; recharts@^3.8.0 in package.json; Vite build artifact present at dist/assets/AnalyticsTab-Bcf6cPCB.js |

No orphaned requirements — all 3 ANL-* requirements are claimed by plans and have implementation evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No TODO/FIXME/placeholder/return null/return {} patterns found in analytics.ts or AnalyticsTab.tsx.

### Human Verification Required

#### 1. Analytics Tab Visual Rendering

**Test:** Deploy to hpg6, open admin panel, click "Analytics" in the sidebar
**Expected:** Analytics tab loads, shows summary cards (may be 0), stacked bar chart area is visible, range selector shows 5 options (1h/6h/24h/7d/30d)
**Why human:** Visual rendering, chart layout, and tab navigation cannot be verified programmatically

#### 2. Live Data Population

**Test:** Send a few test WhatsApp messages (inbound to the bot session), then open Analytics tab and click refresh
**Expected:** Summary cards show non-zero inbound count, bar chart shows at least one bar for the current period
**Why human:** Requires live WAHA session, real message traffic, and visual inspection of chart data

### Gaps Summary

One gap found: outbound analytics coverage is incomplete.

The plan's truth "Every outbound action completion records an analytics event" is only partially achieved. The `recordAnalyticsEvent` call in `channel.ts` sits at the fallback handler path (line 714) which is only reached for utility/custom actions going through `ACTION_HANDLERS`. The 10+ standard targeted actions (send, reply, react, poll, edit, unsend, delete, pin, unpin, read) each contain an early `return` statement before reaching the fallback — so they never record. The SUMMARY acknowledged this as "Standard action coverage could be added in a follow-up" — meaning it was a known scope decision, not an oversight.

**Impact assessment:** Inbound analytics (the higher-volume path) and all custom/utility actions record correctly. Standard action outbound recording is missing. For an operator viewing the Analytics tab, outbound counts will be under-reported unless the agent primarily uses utility actions. This is a known gap, not a blocker for inbound visibility, but it does make the "outbound" metrics unreliable.

The requirements ANL-01, ANL-02, ANL-03 are all satisfied — the gap is in the implementation completeness of the instrumentation, not in the data model, API, or UI.

---

_Verified: 2026-03-20T09:00:00Z_
_Verifier: Claude (gsd-verifier)_
