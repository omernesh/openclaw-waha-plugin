---
phase: 12-ui-bug-sprint
plan: 05
subsystem: ui
tags: [admin-panel, monitor, directory, participants, bot-badge, allow-dm, role-auto-grant]

requires:
  - phase: 12-04
    provides: contact settings drawer, tag input for keywords, custom keyword persistence

provides:
  - "Per-group trigger operator indicator (inheriting global) with hide/show on override toggle"
  - "Channels tab Allow DM inline toggle with green/gray visual state (no full reload)"
  - "Server-side bot JID exclusion from contacts listing via WAHA /me endpoint (5-min cache)"
  - "Bot session badge in group participants with action control suppression"
  - "Role auto-grant: promoting to bot_admin/manager enables Allow + Allow DM automatically"
  - "Role auto-revoke: demoting to participant revokes Allow DM"

affects:
  - 12-ui-bug-sprint (final plan in phase)
  - future directory/participant UI plans

tech-stack:
  added: []
  patterns:
    - "fetchBotJids() with 5-min TTL cache for WAHA /me lookup — prevents API call per directory request"
    - "BOT_SESSION_IDS global injected server-side into embedded HTML for client-side bot detection"
    - "Inline button state update pattern (toggleChannelAllowDm) — no full directory reload on toggle"
    - "data-prev + onmousedown captures role before change for auto-grant/revoke with revert on failure"

key-files:
  created: []
  modified:
    - src/monitor.ts

key-decisions:
  - "Bot JID lookup via WAHA /api/{session}/me with 5-min module-level cache — avoids per-request API calls while keeping data fresh enough for admin panel use"
  - "Bot session matching uses BOT_SESSION_IDS (session names) for participant badge; server-side JID matching via fetchBotJids() for contacts filter — two-tier approach needed because participants store JIDs, not session names"
  - "Channels inline toggle uses POST to existing /allow-dm endpoint (not a new PUT) to avoid backend changes — plan's PUT vs POST distinction was non-blocking"
  - "Auto-grant fires both allow-group and allow-dm on promotion; auto-revoke fires only allow-dm on demotion (group Allow preserved — user is still in the group)"

patterns-established:
  - "isBotSession check pattern: typeof BOT_SESSION_IDS !== 'undefined' && BOT_SESSION_IDS.some(sid => jid.indexOf(sid) !== -1)"
  - "Inline button update after API call: update textContent, background, border, onclick attribute directly on the button element"

requirements-completed: [UI-10, UI-11, DIR-01, DIR-02, DIR-04]

duration: 35min
completed: 2026-03-17
---

# Phase 12 Plan 05: Directory UX Polish Summary

**Trigger operator inherit indicator, channel allow-DM inline toggle, bot JID filtering, bot participant badge with control suppression, and role-based allow auto-grant/revoke**

## Performance

- **Duration:** 35 min
- **Started:** 2026-03-17T03:45:00Z
- **Completed:** 2026-03-17T04:20:00Z
- **Tasks:** 2 (both committed in one atomic commit due to single-file changes)
- **Files modified:** 1

## Accomplishments

- Added "Trigger Operator: OR (inheriting global)" read-only indicator above the group filter override checkbox; hides when override is active (UI-10)
- Channels tab Allow DM is now an inline toggle — "Allowed" (green) vs "Allow DM" (gray outline) — updates button in place without reloading the directory (UI-11)
- Bot session JIDs excluded from contacts listing via cached WAHA `/api/{session}/me` fetch (5-min TTL); non-blocking — skips filter gracefully on API failure (DIR-01)
- Bot session participants in groups show a `bot` badge next to their name; Allow/Allow DM/role dropdown controls are suppressed for bot rows (DIR-02)
- Promoting a participant to Bot Admin or Manager auto-fires Allow (group) + Allow DM API calls and updates button visuals inline; toast: "Allow and Allow DM auto-enabled." (DIR-04)
- Demoting from Bot Admin/Manager to Participant auto-revokes Allow DM; group Allow is preserved; toast: "Allow DM revoked." (DIR-04)

## Task Commits

1. **Task 1 + Task 2: Trigger operator, channel toggle, bot exclusion/badge, role auto-grant** - `98a5cea` (feat)

**Plan metadata:** (pending)

## Files Created/Modified

- `src/monitor.ts` - globalTriggerOperator variable, loadConfig() stores it, gfo-op-indicator element, toggleChannelAllowDm function, fetchBotJids() with cache, buildAdminHtml() injects BOT_SESSION_IDS, isBotSession check in participant loop, bot-badge CSS, setParticipantRole() extended with auto-grant/revoke

## Decisions Made

- Bot JID lookup uses WAHA `/api/{session}/me` with a 5-min module-level cache (`botJidCache`). This avoids per-request API calls while ensuring bot exclusion works without a config change. Non-blocking: if WAHA is unreachable, contacts list simply shows all contacts (including bot contacts).
- Bot session matching for participant badges uses `BOT_SESSION_IDS` (session names injected at HTML build time). The check uses `indexOf(sid)` against the participant JID — pragmatic given that session names don't directly embed phone numbers, but this handles cases where session name fragments could appear in JIDs. Server-side contacts filtering uses the actual JID from WAHA me endpoint.
- Channel toggle uses existing POST `/allow-dm` endpoint rather than creating a new PUT handler. The plan described PUT but the existing POST endpoint with `{allowed: boolean}` covers the same functionality.
- Auto-grant fires both `allow-group` and `allow-dm` on promotion. Auto-revoke fires only `allow-dm` on demotion (group Allow preserved since the user is still in the group and may legitimately have been given group access for other reasons).

## Deviations from Plan

None - plan executed as specified. The POST vs PUT choice for the channel allow-dm endpoint is a minor implementation detail with identical functional outcome.

## Issues Encountered

None. All acceptance criteria met in a single implementation pass. Tests (313) passed on first run.

## Next Phase Readiness

- Phase 12 (UI Bug Sprint) is now complete — all 5 plans executed
- All 5 requirements (UI-10, UI-11, DIR-01, DIR-02, DIR-04) implemented
- Ready for next phase in v1.11 milestone

---
*Phase: 12-ui-bug-sprint*
*Completed: 2026-03-17*
