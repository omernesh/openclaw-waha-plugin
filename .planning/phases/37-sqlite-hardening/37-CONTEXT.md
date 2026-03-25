# Phase 37: SQLite Hardening - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — infrastructure phase)

<domain>
## Phase Boundary

SQLite databases handle concurrent access gracefully and do not leak temp files. Adds PRAGMA busy_timeout = 5000 to both DirectoryDb and AnalyticsDb, periodic WAL checkpointing, and startup cleanup of orphaned media temp files.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

- `src/directory.ts` — DirectoryDb class with WAL mode already enabled
- `src/analytics.ts` — AnalyticsDb class with WAL mode already enabled
- `src/media.ts` — downloadWahaMedia saves to /tmp/openclaw/waha-media-*
- `src/monitor.ts` — startup code in createWahaWebhookServer

</code_context>

<specifics>
No specific requirements — infrastructure phase.
</specifics>

<deferred>
None.
</deferred>
