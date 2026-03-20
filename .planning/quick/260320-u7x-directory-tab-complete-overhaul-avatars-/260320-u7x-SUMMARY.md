---
id: 260320-u7x
type: quick
title: "Directory Tab Complete Overhaul — Avatars, Stacked Layout, Pagination, Action Buttons"
completed: "2026-03-20"
duration: ~15 min
tasks_completed: 3/3
commits:
  - 28ceab8
  - a74432c
files_modified:
  - src/admin/src/components/shared/Avatar.tsx (created)
  - src/admin/src/components/shared/DataTable.tsx
  - src/admin/src/components/tabs/DirectoryTab.tsx
  - src/admin/src/components/tabs/directory/ContactsTab.tsx
  - src/admin/src/components/tabs/directory/GroupsTab.tsx
  - src/admin/src/components/tabs/directory/ChannelsTab.tsx
  - src/admin/src/components/tabs/directory/ParticipantRow.tsx
---

# Quick Task 260320-u7x Summary

**One-liner:** React Directory tab overhauled with colored avatar circles, stacked name+JID columns, clickable Allow DM buttons, Settings/Participants action buttons, and full numbered pagination with page-size dropdown.

## What Was Done

All 10 gaps from the old GUI inventory closed:

1. **Avatar circles** — New `Avatar.tsx` component: colored circle (12-color palette, deterministic hash from name), 2-letter initials, sizes sm/md. Imported in all 4 components.

2. **Stacked name+JID** — Contacts, Groups, Channels now show `displayName` (font-medium) above JID (`text-xs muted mono`) in a single column. Separate JID columns removed.

3. **Allow DM button (Contacts)** — Replaced read-only Badge with a clickable `<Button variant="outline" size="sm">`. Green styling when allowed, calls `api.toggleAllowDm` with `e.stopPropagation()`.

4. **Allow DM button (Channels)** — Same pattern as contacts.

5. **Settings button (Contacts)** — Ghost button with Settings icon, `e.stopPropagation()` then `setSelectedJid()` to open ContactSettingsSheet.

6. **Settings button (Channels)** — Same pattern.

7. **Participants button (Groups)** — `<Button variant="outline">` with Users icon + rotating ChevronDown. Calls `toggleGroup()` with stopPropagation. Row-click still also toggles.

8. **Full numbered pagination** — DataTable now renders `<<`, `<`, up to 5 numbered page buttons (window around current page), `>`, `>>`. Current page highlighted with `variant="default"`.

9. **Page-size dropdown** — DataTable new optional `pageSizeOptions` prop (default [10, 25, 50, 100]). Resets pageIndex to 0 on change. DirectoryTab default pageSize changed from 50 → 25.

10. **ParticipantRow avatar + JID** — `Avatar size="sm"` (28px) added before name. `participantJid` shown below display name in muted mono text.

## Preserved (No Regressions)

- Bulk mode in ContactsTab and ChannelsTab (select column, BulkEditToolbar)
- Presence dot indicators on contacts (DO NOT REMOVE comment respected)
- ContactSettingsSheet wiring in contacts and channels
- GroupFilterOverride in ParticipantRow
- All Allow in Group / Allow DM / Role dropdown controls in ParticipantRow
- Timestamp multiplication by 1000 for Date constructor
- DO NOT CHANGE markers on all DataTable core behavior

## Deviations from Plan

**1. [Rule 1 - Bug] Pre-existing BulkEditToolbar type narrowing error**
- **Found during:** Task 3 verification
- **Issue:** ContactsTab and ChannelsTab `handleBulkAction` had narrower types than BulkEditToolbar's `onAction` prop — pre-existing TS error from prior commit
- **Status:** Pre-existing (confirmed via `git stash` test). Not introduced by this task. Linter reverted my attempted fix. Deferred to separate task.

## Build Results

- `npx vite build` — 2435 modules, built in ~1s, no errors
- `npx vitest run` — 24/29 tests pass (5 SettingsTab failures are pre-existing, confirmed via git stash)
- New code has zero TypeScript errors; only pre-existing errors remain in test files and DirectoryTab typeMap

## Self-Check: PASSED

- `src/admin/src/components/shared/Avatar.tsx` — FOUND
- `src/admin/src/components/shared/DataTable.tsx` — FOUND (pageSizeOptions prop, numbered buttons)
- Commit 28ceab8 — FOUND
- Commit a74432c — FOUND
