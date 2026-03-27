# Phase 56: Adaptive Activity Patterns - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a system that learns per-chat active hours from message history and automatically aligns send gates to observed human activity patterns, with weekly rescans and graceful fallback to global config.

</domain>

<decisions>
## Implementation Decisions

### Activity Analysis Strategy
- Peak hours detection: **Hour histogram** — count messages per hour-of-day over 7 days, top 60% of hours by volume become the send window
- Scan depth: **Last 500 messages** per chat (paginated batches of 100), stop if older than 7 days
- Which chats: **All chats with ≥20 messages in last 7 days** — only profile active conversations
- Storage: **`chat_activity_profiles` SQLite table** with derived `peak_start_hour` and `peak_end_hour` columns — simple override for existing gate config

### Scheduling & Integration
- Rescan frequency: **Weekly** (every 7 days) via setTimeout chain pattern from sync.ts
- When to run: **During off-peak hours only** (outside the configured send window) — matches success criterion #2
- Per-chat override mechanism: **Feed `peak_start_hour`/`peak_end_hour` as `TargetGateOverride`** into existing `resolveGateConfig()` cascade
- Fallback: **Use global/session gate config unchanged** when no profile exists — matches success criterion #4

### Claude's Discretion
- SQLite table schema details (columns, indexes)
- Histogram analysis algorithm internals
- Background task error handling and retry logic
- How to determine "off-peak" from config for scan scheduling

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DirectoryDb` in `src/directory.ts` — SQLite setup pattern (WAL, busy_timeout, safe migrations)
- `resolveGateConfig()` in `src/mimicry-gate.ts` — cascading config: defaults → global → per-session → per-target
- `TargetGateOverride` type in `src/mimicry-gate.ts` — supports startHour, endHour override
- `getWahaChatMessages()` in `src/send.ts` — paginated message history API
- `startDirectorySync()` in `src/sync.ts` — setTimeout chain pattern for background tasks
- `checkTimeOfDay()` in `src/mimicry-gate.ts` — timezone-aware hour check with cross-midnight support

### Established Patterns
- setTimeout chain (NOT setInterval) for periodic tasks — schedule next after current completes
- `.unref()` on all timers to avoid blocking shutdown
- AbortSignal support for graceful cancellation
- Per-account state tracking via mutable state objects

### Integration Points
- `src/mimicry-gate.ts` — enhance resolveGateConfig to check activity profiles
- `src/directory.ts` — add chat_activity_profiles table to DirectoryDb
- `src/monitor.ts` — start background analysis task alongside directory sync
- `src/send.ts` — getWahaChatMessages for scanning message history

</code_context>

<specifics>
## Specific Ideas

- Activity profiles stored in same SQLite DB as directory (DirectoryDb)
- Background scanner runs weekly, only during off-peak hours
- When resolveGateConfig sees a chatId with an activity profile, override startHour/endHour
- Incremental: only scan chats that haven't been profiled in the last 7 days

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
