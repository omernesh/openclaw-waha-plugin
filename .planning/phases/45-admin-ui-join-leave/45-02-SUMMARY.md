---
phase: 45-admin-ui-join-leave
plan: "02"
subsystem: admin-ui
tags: [react, ui, directory, join, leave, alert-dialog]
dependency_graph:
  requires: [45-01]
  provides: [admin-ui-join-leave-complete]
  affects: [GroupsTab, ChannelsTab, DirectoryTab]
tech_stack:
  added: ["@radix-ui/react-dialog (reused via alert-dialog.tsx)"]
  patterns: ["AlertDialog confirmation pattern", "toast feedback", "optimistic onRefresh"]
key_files:
  created:
    - src/admin/src/components/ui/alert-dialog.tsx
  modified:
    - src/admin/src/components/tabs/directory/GroupsTab.tsx
    - src/admin/src/components/tabs/directory/ChannelsTab.tsx
    - src/admin/src/components/tabs/DirectoryTab.tsx
decisions:
  - AlertDialog built on @radix-ui/react-dialog (same package as sheet.tsx) — no new install needed
  - AlertDialogAction and AlertDialogCancel are plain buttons (not Radix primitives) for direct onClick wiring
  - leavingJid state per-component tracks in-flight leave to show "Leaving..." and disable button
  - Join validation accepts both full URL (chat.whatsapp.com/) and raw codes (8+ alphanumeric chars)
metrics:
  duration: "~10 minutes"
  completed_date: "2026-03-25T20:18:19Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 45 Plan 02: Admin UI Join/Leave Summary

AlertDialog component + Leave buttons in GroupsTab/ChannelsTab + Join by Link in DirectoryTab.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create AlertDialog component using @radix-ui/react-dialog | 35f10d0 |
| 2 | Leave buttons + Join by Link UI wired to api.leaveEntry / api.joinByLink | bd97ddf |

## What Was Built

**alert-dialog.tsx** — Reuses `@radix-ui/react-dialog` (same package as sheet.tsx). Exports 9 primitives: `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`.

**GroupsTab.tsx** — Leave button (destructive variant) added to every group row. Clicking opens an AlertDialog: "Leave group? The bot will leave [name]. This cannot be undone from the admin panel." Confirm calls `api.leaveEntry(jid)`, shows toast, then calls `onRefresh()`. `onRefresh` prop was previously aliased to `_onRefresh` (unused) — fixed to use it. `leavingJid` state provides in-flight feedback.

**ChannelsTab.tsx** — Unfollow button (destructive variant) added to every channel row. Same AlertDialog pattern: "Unfollow channel? The bot will unfollow [name]." Calls `api.leaveEntry(jid)` on confirm.

**DirectoryTab.tsx** — Join by Link row added above the search bar. Link icon + Input (placeholder: "Join by invite link (chat.whatsapp.com/...)") + Join button. Validates URL contains `chat.whatsapp.com/` or matches raw code pattern. Calls `api.joinByLink(link)`, shows success toast, clears input, calls `refreshData()`.

## Verification

- Build: `npx vite build` — passes cleanly (11.89s)
- Test suite: 19 passed / 10 failed — same failure count as pre-changes (pre-existing mock issues for `api.getSessions` and `api.getPresence` in SettingsTab/DirectoryTab tests, unrelated to this plan)
- All acceptance criteria met: leaveEntry in GroupsTab, leaveEntry in ChannelsTab, joinByLink in DirectoryTab, AlertDialog in both tab files, "Join by invite link" placeholder present

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All wired to real api.ts methods from 45-01.

## Self-Check: PASSED

- `src/admin/src/components/ui/alert-dialog.tsx` — EXISTS
- `35f10d0` (alert-dialog commit) — EXISTS
- `bd97ddf` (UI changes commit) — EXISTS
