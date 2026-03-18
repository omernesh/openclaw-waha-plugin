---
phase: 21-directory-tab
plan: "03"
subsystem: admin-ui
tags: [react, directory, groups, participants, expandable-rows, lazy-load]
dependency_graph:
  requires: [21-01]
  provides: [GroupsTab, ParticipantRow]
  affects: [DirectoryTab]
tech_stack:
  added: []
  patterns:
    - ColumnDef<DirectoryContact> with expandedRowId + renderExpandedRow for lazy participant expansion
    - isBotSession guard gates per-participant controls (bot sessions get badge only, no switches)
    - Optimistic state updates with toast feedback for all participant API calls
    - bulkAllowAll re-fetches after success to sync all participant allowInGroup states
key_files:
  created:
    - src/admin/src/components/tabs/directory/ParticipantRow.tsx
    - src/admin/src/components/tabs/directory/GroupsTab.tsx
  modified:
    - src/admin/src/components/tabs/DirectoryTab.tsx
decisions:
  - "ChevronDown expand indicator reads expandedRowId from table meta to avoid extra state prop threading"
  - "GroupsTab resets expandedGroupJid to null on page change to prevent stale expansion"
  - "Contacts and channels sub-tabs left as placeholders — Plan 02 not yet run (parallel wave)"
metrics:
  duration: "155s"
  completed: "2026-03-18"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Phase 21 Plan 03: Groups Tab with Expandable Participants Summary

GroupsTab with lazy-loaded participant expansion, bot session badges, Allow in Group / Allow DM toggles, Role dropdown, and Allow All bulk toggle — all using correct ParticipantEnriched field names.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create ParticipantRow component | 6d0770a | src/admin/src/components/tabs/directory/ParticipantRow.tsx |
| 2 | Create GroupsTab and wire into DirectoryTab | f2f6be8 | src/admin/src/components/tabs/directory/GroupsTab.tsx, src/admin/src/components/tabs/DirectoryTab.tsx |

## What Was Built

**ParticipantRow.tsx** — Lazy-fetches participants on first render via `api.getGroupParticipants(groupJid)`. Shows "Loading participants..." while fetching. At the top, an "Allow All Participants" Switch calls `api.bulkAllowAll` with `{ allowed: boolean }` (not `{ allow: boolean }`) and re-fetches on success. Each participant row shows resolved `displayName` (fallback to `participantJid`). Bot sessions (`p.isBotSession === true`) show only Admin badge + Bot badge with no controls. Non-bot participants get Allow in Group Switch, Allow DM Switch, and Role dropdown (Participant / Manager / Bot Admin). All updates are optimistic with sonner toast feedback.

**GroupsTab.tsx** — DataTable of groups with columns: expand indicator, Group Name (displayName ?? "Unknown Group"), JID, Messages count, Last Message date. Clicking a row toggles `expandedGroupJid`. DataTable's `renderExpandedRow` renders `<ParticipantRow groupJid={row.jid} />`. ChevronDown rotates 180deg when the row is expanded (via table meta injection). Pagination change resets expansion.

**DirectoryTab.tsx** — Import added and `<GroupsTab>` wired into `TabsContent value="groups"`. Contacts and channels remain as placeholders until Plan 02 runs.

## Verification

- `npx tsc --noEmit --project src/admin/tsconfig.json` — only pre-existing sidebar.tsx error (HTMLMainElement), zero errors in new files
- `npm run build` — passes, 1858 modules transformed, output in dist/admin/
- GroupsTab uses `ColumnDef<DirectoryContact>` with `expandedRowId` and `renderExpandedRow`
- ParticipantRow uses correct field names: `participantJid`, `displayName`, `allowInGroup`, `isBotSession`
- Bot participants show "Bot" Badge with no Allow/Block controls
- Non-bot participants show Allow in Group, Allow DM, and Role controls
- `bulkAllowAll` sends `{ allowed: boolean }` (not `{ allow: boolean }`)
- DirectoryTab imports GroupsTab and renders it in groups sub-tab

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

**Note on expand indicator:** The plan suggested using `lucide-react ChevronDown` with conditional rotate. Since `DataTable` doesn't pass meta to cell renderers by default, the column's `cell` function reads `expandedRowId` from `table.options.meta`. To thread this, `GroupsTab` spreads the current `expandedGroupJid` into each column's meta on every render. This is a clean pattern that avoids prop drilling through DataTable internals.

## Self-Check: PASSED

Files exist:
- FOUND: src/admin/src/components/tabs/directory/ParticipantRow.tsx
- FOUND: src/admin/src/components/tabs/directory/GroupsTab.tsx

Commits exist:
- FOUND: 6d0770a (ParticipantRow)
- FOUND: f2f6be8 (GroupsTab + DirectoryTab)
