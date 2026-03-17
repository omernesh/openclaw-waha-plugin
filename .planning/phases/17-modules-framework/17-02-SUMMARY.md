---
phase: 17-modules-framework
plan: "02"
subsystem: admin-panel
tags: [bulk-select, contacts-tab, channels-tab, directory-ui]
dependency_graph:
  requires: []
  provides: [bulk-select-contacts, bulk-select-channels]
  affects: [src/monitor.ts]
tech_stack:
  added: []
  patterns: [bulk-select-checkboxes, tab-aware-toolbar, waha-api-follow-unfollow]
key_files:
  created: []
  modified:
    - src/monitor.ts
decisions:
  - "Bulk checkbox code in buildContactCard was already present from a prior phase (DIR-04); this plan wired the toolbar and tab-reload logic."
  - "Follow/unfollow actions call WAHA API directly from server-side bulk endpoint; no DB state change needed."
  - "toggleBulkSelectMode and bulkAction now dispatch to loadContactsTable() for contacts tab instead of loadDirectory() for correctness with pagination."
metrics:
  duration: ~18 minutes
  completed: "2026-03-17"
  tasks_completed: 1
  files_modified: 1
requirements: [DIR-03, DIR-05]
---

# Phase 17 Plan 02: Bulk Select for Contacts and Channels Tabs Summary

**One-liner:** Wired bulk select checkboxes, toolbar, and follow/unfollow actions for Contacts and Channels directory sub-tabs.

## What Was Built

Added bulk select support to the Contacts and Channels (newsletters) tabs in the admin panel directory, matching the existing Groups tab pattern.

**Changes in `src/monitor.ts`:**

1. **`toggleBulkSelectMode()`** — now handles all three tabs: groups -> `loadGroupsTable()`, contacts -> `loadContactsTable()`, channels -> `loadDirectory()`.

2. **`updateBulkToolbar()`** — added `newsletters` branch: renders Allow DM, Revoke DM, Follow, Unfollow buttons. Contacts branch unchanged (Allow DM, Revoke DM).

3. **`bulkAction()` success handler** — now reloads the correct tab after a bulk action (contacts -> `loadContactsTable()`, channels -> `loadDirectory()`).

4. **Server-side `/api/admin/directory/bulk` endpoint** — added `follow` and `unfollow` to `validActions`. After the per-JID loop, follow/unfollow actions iterate over JIDs and POST to WAHA `/api/{session}/channels/{channelId}/follow|unfollow`. Individual failures are silently skipped; caller receives partial `updated` count.

**Note:** The `buildContactCard` checkbox (`bulkCheckbox` variable, lines 3179-3191) was already implemented from a prior phase (DIR-04) and continues to work correctly for both contacts and channels since both are rendered via `buildContactCard`.

**Note:** `switchDirTab` already resets bulk state (`bulkSelectMode = false`, `bulkSelectedJids.clear()`, `updateBulkToolbar()`) from a prior phase (DIR-04 pitfall 4).

## Verification

- TypeScript: no new errors introduced (pre-existing errors from missing `openclaw/plugin-sdk` types are unrelated)
- `buildContactCard` already renders checkbox conditional on `bulkSelectMode` (prior phase)
- `updateBulkToolbar` has newsletter-specific actions (Follow, Unfollow)
- `switchDirTab` clears bulk state (confirmed from existing code at line 2582-2585)
- Bulk endpoint handles `follow` and `unfollow` actions

## Deviations from Plan

None — plan executed exactly as written. The `buildContactCard` checkbox was already present from a prior phase, confirmed during read. All other changes were implemented as specified.

## Self-Check: PASSED

- `src/monitor.ts` modified: FOUND
- Commit `fd443b8` exists: FOUND
- `updateBulkToolbar` contains `newsletters` branch: FOUND (line 2697)
- `toggleBulkSelectMode` dispatches to `loadContactsTable()`: FOUND (line 2664)
- Bulk endpoint `validActions` includes `follow`, `unfollow`: FOUND (line 4482)
- Follow/unfollow WAHA API loop present: FOUND (lines 4541-4558)
