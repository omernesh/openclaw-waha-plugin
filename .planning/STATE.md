---
gsd_state_version: 1.0
milestone: v1.11
milestone_name: Polish, Sync & Features
status: in-progress
stopped_at: Completed 15-03-PLAN.md
last_updated: "2026-03-17T14:17:33.149Z"
last_activity: "2026-03-17 — Plan 12-01 complete: dashboard UI bug fixes (6 requirements)"
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 12
  completed_plans: 12
  percent: 40
---

---
gsd_state_version: 1.0
milestone: v1.11
milestone_name: Polish, Sync & Features
status: in-progress
stopped_at: null
last_updated: "2026-03-17"
last_activity: "2026-03-17 — Phase 12 Plan 01 complete: dashboard flickering fix, per-session health, collapsible filter cards, readable labels"
progress:
  [████░░░░░░] 40%
  completed_phases: 0
  total_plans: 0
  completed_plans: 1
  percent: 2
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-17)

**Core value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.
**Current focus:** Phase 12 — UI Bug Sprint

## Current Position

Phase: 12 of 17 (UI Bug Sprint) — first phase of v1.11
Plan: 1 of TBD in current phase (12-01 complete)
Status: In progress
Last activity: 2026-03-17 — Plan 12-01 complete: dashboard UI bug fixes (6 requirements)

Progress: [█░░░░░░░░░] 2% (v1.11 milestone)

## Accumulated Context

### Decisions

- Template literal double-escaping (2026-03-16): All embedded JS in monitor.ts must use double-backslash. Any monitor.ts edit requires full double-backslash audit.
- Modules are WhatsApp-specific (2026-03-17): No cross-platform abstraction. Port by re-implementation per platform.
- Background sync race prevention: page-sized batches (50-100 rows) + write mutex required from day one — not a later optimization.
- Auto-reply spam loop prevention: auto-reply hook must insert AFTER fromMe check, bot's own JIDs explicitly excluded.
- Passcode storage: hashing required. Exact storage (openclaw.json vs SQLite secrets table) to be decided in Phase 16 plan.
- _accessKvBuilt guard pattern (12-01, 2026-03-17): Boolean flag prevents re-creating DOM subtrees on periodic refresh. Reset on tab-switch and manual Refresh. Use for any DOM tree that should be built once per page view.
- LABEL_MAP pattern (12-01, 2026-03-17): Static lookup object + labelFor() helper at top of embedded script to convert raw config keys to human-readable labels.
- [Phase 12-ui-bug-sprint]: canInitiate boolean kept in ContactDmSettings for shutup.ts compat; separate canInitiateOverride enum added for 3-state UI override (12-02, 2026-03-17)
- [Phase 12-ui-bug-sprint]: Optimistic dropdown UI pattern: data-prev + onmousedown captures value before change, revert on error without full re-render (12-02, 2026-03-17)
- [Phase 12-ui-bug-sprint]: wrapRefreshButton pattern (12-03, 2026-03-17): wireRefreshBtn IIFE wires all 5 Refresh buttons with spinner + relative timestamp; extraSetup param handles per-tab pre-load logic
- [Phase 12-ui-bug-sprint]: contact-card overflow:visible (12-03, 2026-03-17): changed from overflow:hidden so .tip::after tooltips escape card boundary; card layout is unaffected
- [Phase 12-ui-bug-sprint]: Lazy tag input init in toggleContactSettings via customKeywordTagInputs registry; data-init-kw attribute seeds value from buildContactCard without extra API call (12-04, 2026-03-17)
- [Phase 12-ui-bug-sprint]: Bot JID lookup via WAHA /me with 5-min cache (12-05, 2026-03-17): fetchBotJids() caches session->JID mapping to avoid per-request API calls while keeping data fresh for admin panel
- [Phase 12-ui-bug-sprint]: Role auto-grant/revoke pattern (12-05, 2026-03-17): promote to bot_admin/manager auto-enables Allow+Allow DM; demote to participant auto-revokes Allow DM only (group Allow preserved)
- [Phase 13]: FTS5 MATCH replaces LIKE for directory search — O(log n) vs O(n), trigger-based index maintenance
- [Phase 13]: Background sync engine (sync.ts) uses setTimeout chain + per-account Map state, stores opts at startDirectorySync call time for triggerImmediateSync re-use
- [Phase 13-background-directory-sync]: Inline refresh handler removed from monitor.ts: 200-line code replaced with 3-line triggerImmediateSync(), pipeline lives only in sync.ts
- [Phase 13-background-directory-sync]: Contacts tab uses pagination matching Groups tab: loadContactsTable() with buildPageNav(goFn) generic pagination
- [Phase 14-name-resolution]: @lid->@c.us fallback: two-pass batch SQL query approach in resolveJids; resolve route before /:jid handler; getValue() returns raw JIDs for config save correctness; 50ms debounce on name resolution fetches
- [Phase 14-name-resolution]: [Phase 14-name-resolution]: getGroupParticipants uses LEFT JOIN COALESCE for @lid->@c.us resolution at SQL level (14-02, 2026-03-17)
- [Phase 14-name-resolution]: [Phase 14-name-resolution]: Contact picker batch resolve replaces N per-JID fetches with single /resolve call; getValue() returns raw JID strings unchanged (14-02, 2026-03-17)
- [Phase 15-ttl-access]: TTL stored as Unix seconds matching SQLite strftime('%s','now') for direct query use
- [Phase 15-ttl-access]: 24h grace period before expired allow_list rows deleted — keeps recently-expired visible in admin panel
- [Phase 15-ttl-access]: PUT /ttl returns 404 if contact not in allow_list — cannot set TTL on non-existent entry
- [Phase 15-ttl-access]: Access Expires dropdown fires immediately on change (no separate Save) — separate UX from DM settings Save button
- [Phase 15-ttl-access]: TTL-03 config sync runs before TTL-02 24h cleanup — expired JIDs must be in SQLite when syncExpiredToConfig reads them

### Pending Todos

None.

### Blockers/Concerns

- Phase 13 (Background Sync): SQLite write concurrency between sync loop and webhook handler is highest-risk item. Async write mutex + page-sized batch design must be explicit in the plan before coding.
- Phase 16 (Pairing Mode): Passcode hashing approach and storage location need a decision before planning.
- WAHA contacts API incremental sync (updatedAfter) not verified against live instance — fallback is full-resync with sync_state cursor if parameter unavailable.

## Session Continuity

Last session: 2026-03-17T14:07:57.370Z
Stopped at: Completed 15-03-PLAN.md
Resume file: None
