---
phase: 21-directory-tab
plan: "02"
subsystem: admin-ui
tags: [react, contacts, channels, directory, bulk-edit, settings-sheet]
dependency_graph:
  requires: [21-01]
  provides: [ContactsTab, ContactSettingsSheet, ChannelsTab, BulkEditToolbar]
  affects: [DirectoryTab.tsx]
tech_stack:
  added: []
  patterns:
    - DataTable with ColumnDef<DirectoryContact> for contacts and channels
    - Side panel Sheet for per-contact DM settings editing
    - Bulk edit toolbar pattern with entityType-driven action set
    - refreshCounter state for sub-tab-triggered data re-fetch
key_files:
  created:
    - src/admin/src/components/tabs/directory/BulkEditToolbar.tsx
    - src/admin/src/components/tabs/directory/ContactSettingsSheet.tsx
    - src/admin/src/components/tabs/directory/ContactsTab.tsx
    - src/admin/src/components/tabs/directory/ChannelsTab.tsx
  modified:
    - src/admin/src/components/tabs/DirectoryTab.tsx
decisions:
  - ContactSettingsSheet stays open after save — triggers onSaved() for parent refresh only
  - customKeywords split on load (split(',').filter(Boolean)) and joined on save (join(','))
  - refreshCounter in DirectoryTab as the re-fetch trigger for onRefresh callbacks from sub-tabs
  - bulkMode disables row click in ContactsTab — clicking toggles selection instead of opening sheet
metrics:
  duration: "4m 21s"
  completed: "2026-03-18"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 1
---

# Phase 21 Plan 02: Contacts and Channels DataTables Summary

ContactsTab with DataTable and ContactSettingsSheet side panel, ChannelsTab with DataTable, shared BulkEditToolbar, all wired into DirectoryTab.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create ContactsTab, ContactSettingsSheet, BulkEditToolbar | dfbf24b | BulkEditToolbar.tsx, ContactSettingsSheet.tsx, ContactsTab.tsx |
| 2 | Create ChannelsTab and wire all sub-tabs into DirectoryTab | 9223f00 | ChannelsTab.tsx, DirectoryTab.tsx |

## What Was Built

**BulkEditToolbar** — Shared toolbar component that renders bulk action buttons based on `entityType`. Contacts: Allow DM / Revoke DM (action strings `allow-dm`, `revoke-dm`). Newsletters: Follow / Unfollow. Only renders when `selectedCount > 0`.

**ContactSettingsSheet** — Shadcn Sheet side panel for editing per-contact DM settings. Fields: Allow DM toggle (immediate via `toggleAllowDm`), Mode select (active/listen_only), Mention Only switch, Can Initiate Override select (default/allow/block), Custom Keywords freeform TagInput, TTL access buttons (Grant 24h / Grant 7d / Revoke). Save calls `updateDirectorySettings` and shows sonner toast. Sheet stays open after save — `onSaved()` triggers parent refresh only.

**ContactsTab** — DataTable with columns: Name (displayName or "Unknown"), Phone/JID (stripped @c.us suffix), DM Access badge (green Allowed / red Blocked), Messages count, Last Message date. Bulk mode toggle shows checkboxes and BulkEditToolbar. Row click opens ContactSettingsSheet when not in bulk mode.

**ChannelsTab** — DataTable with columns: Channel Name, Newsletter JID, Messages count, First Seen date. Bulk mode toggle shows checkboxes and BulkEditToolbar with entityType="newsletter" for Follow/Unfollow. No row click (channels have no individual DM settings).

**DirectoryTab updates** — Added `refreshCounter` state incremented by `refreshData()`. Added `refreshCounter` to the `useEffect` dependency array alongside `refreshKey`. Imported and rendered `ContactsTab` and `ChannelsTab` in their respective `TabsContent` panels, passing `data?.contacts`, `data?.total`, shared pagination, loading, and `onRefresh={refreshData}`.

## Key Implementation Notes

- **customKeywords wire format**: Comma-separated string on the API. Split on load: `(dmSettings?.customKeywords ?? '').split(',').filter(Boolean)`. Join on save: `keywords.join(',')`.
- **Timestamps are Unix seconds**: Both `lastMessageAt` and `firstSeenAt` are multiplied by 1000 for `new Date()`.
- **Bulk mode and row click are mutually exclusive**: When `bulkMode` is true, `onRowClick` is not passed to DataTable so clicking rows toggles selection via the table's built-in mechanism.
- **onClose location**: `onClose()` is only called in `onOpenChange` (user closes via X/overlay). It is NOT called in the save handler — this is a locked design decision.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

Files exist:
- src/admin/src/components/tabs/directory/BulkEditToolbar.tsx: FOUND
- src/admin/src/components/tabs/directory/ContactSettingsSheet.tsx: FOUND
- src/admin/src/components/tabs/directory/ContactsTab.tsx: FOUND
- src/admin/src/components/tabs/directory/ChannelsTab.tsx: FOUND
- src/admin/src/components/tabs/DirectoryTab.tsx: modified, FOUND

Commits exist:
- dfbf24b: FOUND (Task 1)
- 9223f00: FOUND (Task 2)

TypeScript: zero errors in new files (pre-existing sidebar.tsx error unrelated)
Build: passes (vite build completes in ~1s, 1862 modules transformed)

## Self-Check: PASSED
