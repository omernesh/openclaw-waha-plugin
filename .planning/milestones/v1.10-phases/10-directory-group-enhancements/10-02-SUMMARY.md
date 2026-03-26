---
phase: 10-directory-group-enhancements
plan: 02
subsystem: ui
tags: [admin-panel, directory, participants, roles, bulk-edit, sqlite, vanilla-js]

requires:
  - phase: 10-directory-group-enhancements
    plan: 01
    provides: groups paginated table, DOM-safe rendering patterns, loadGroupsTable()

provides:
  - ParticipantRole type (bot_admin/manager/participant) with SQLite persistence
  - participant_role column migration (migration-safe ALTER TABLE)
  - setParticipantRole() / getParticipantRole() methods on DirectoryDb
  - PUT /api/admin/directory/group/:groupJid/participants/:participantJid/role endpoint
  - Role dropdown UI in loadGroupParticipants() panel
  - Bulk select mode (bulkSelectMode state, toggleBulkSelectMode, checkboxes)
  - Sticky bulk action toolbar (bulk-toolbar) with contextual actions
  - POST /api/admin/directory/bulk endpoint (allow-dm, revoke-dm, allow-group, revoke-group, set-role)
  - Tab switch clears bulk state via switchDirTab() reset

affects: [11-dashboard-sessions-log, future-directory-plans]

tech-stack:
  added: []
  patterns:
    - Migration-safe ALTER TABLE with try/catch (duplicate column pattern, established in Phase 9)
    - JSON.stringify for safely embedding user JIDs in inline onclick handlers (checkbox click handlers)
    - Exact URL match for bulk endpoint before generic regex routes (Pitfall 7 prevention)
    - bulkCurrentGroupJid context variable tracks participant panel context for toolbar actions

key-files:
  created: []
  modified:
    - src/directory.ts
    - src/monitor.ts

key-decisions:
  - "PUT /api/admin/directory/group/:groupJid/participants/:participantJid/role uses method PUT (not POST) — consistent with REST semantics for role updates"
  - "JSON.stringify(jid) used in participant checkbox onclick to safely embed user-supplied JID strings in inline handlers"
  - "Bulk endpoint uses exact req.url === string match — placed before POST /api/admin/directory/refresh to prevent generic directory/:jid route collision"
  - "bulkCurrentGroupJid set when loadGroupParticipants() renders in bulk mode — context flag tells toolbar which actions to show (DM vs group/role)"
  - "bulkRoleAction uses prompt() for role selection — simple, no extra UI components needed for this use case"
  - "Participant roles are plugin-level labels only (no WAHA meaning) — stored in SQLite, not synced to config JSON"

requirements-completed: [DIR-03, DIR-04]

duration: 7min
completed: 2026-03-16
---

# Phase 10 Plan 02: Participant Roles and Bulk Edit Summary

**Participant role dropdown (Bot Admin/Manager/Participant) with SQLite persistence plus checkbox bulk-select mode with sticky action toolbar for batch operations**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-16T16:43:03Z
- **Completed:** 2026-03-16T16:50:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `ParticipantRole` type exported from directory.ts: `"bot_admin" | "manager" | "participant"`
- `GroupParticipant` type now includes `participantRole: ParticipantRole` field
- `participant_role` column added via migration-safe ALTER TABLE (existing rows default to `'participant'`)
- `bulkUpsertGroupParticipants()` updated to preserve existing roles on re-import via COALESCE subquery
- `setParticipantRole()` and `getParticipantRole()` methods added to `DirectoryDb`
- New PUT endpoint: `/api/admin/directory/group/:groupJid/participants/:participantJid/role`
- Role dropdown in each participant row renders Bot Admin / Manager / Participant options with current selection
- `setParticipantRole()` JS function wired to dropdown `onchange` event
- Bulk select state variables: `bulkSelectMode`, `bulkSelectedJids` (Set), `bulkCurrentGroupJid`
- "Select" button (`bulk-select-btn`) in directory header toggles bulk mode; turns red and shows "Cancel" when active
- Sticky bulk toolbar (`bulk-toolbar`) fixed at page bottom; appears when items are selected, hides otherwise
- Toolbar shows contextual actions: contacts tab gets "Allow DM"/"Revoke DM"; participant panel gets "Allow Group"/"Revoke Group"/"Set Role"
- Checkboxes added to: contact cards (buildContactCard), groups table rows (loadGroupsTable), participant panel rows (loadGroupParticipants)
- Tab switching via `switchDirTab()` clears all bulk state and hides toolbar
- `POST /api/admin/directory/bulk` endpoint handles all five bulk actions with input validation
- Bulk endpoint placed before generic directory routes (exact string match) to prevent route collision

## Task Commits

1. **Task 1: Participant role DB, API endpoint, and role dropdown UI** - `cd37586` (feat)
2. **Task 2: Bulk select mode with checkbox UI and bulk action toolbar** - `92df307` (feat)

## Files Created/Modified

- `src/directory.ts` - ParticipantRole type, GroupParticipant field, migration, getGroupParticipants SQL update, bulkUpsertGroupParticipants COALESCE update, setParticipantRole(), getParticipantRole()
- `src/monitor.ts` - Role dropdown in participant rows, setParticipantRole() JS, PUT role endpoint, bulk state variables, toggleBulkSelectMode/toggleBulkItem/updateBulkToolbar/bulkAction/bulkRoleAction functions, bulk-toolbar HTML, bulk-select-btn, checkboxes in contact cards/groups table/participant rows, switchDirTab bulk reset, POST /api/admin/directory/bulk endpoint

## Decisions Made

- `JSON.stringify(jid)` used in participant checkbox onclick to safely embed user-supplied JID strings in inline onclick handlers (avoids XSS)
- Bulk endpoint placed with exact `req.url ===` string match BEFORE `POST /api/admin/directory/refresh` and any generic directory regex routes (Pitfall 7)
- `bulkCurrentGroupJid` is set when participant panel loads in bulk mode — allows toolbar to know whether to show contact actions or participant actions
- `bulkRoleAction()` uses browser `prompt()` for role input — minimal, no extra UI components needed

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- src/directory.ts: FOUND
- src/monitor.ts: FOUND
- cd37586 (Task 1 commit): FOUND
- 92df307 (Task 2 commit): FOUND
- 10-02-SUMMARY.md: FOUND
