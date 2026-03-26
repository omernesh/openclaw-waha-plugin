---
phase: 45-admin-ui-join-leave
plan: "01"
subsystem: admin-api
tags: [admin, api, join, leave, groups, channels]
dependency_graph:
  requires: []
  provides: [POST /api/admin/directory/join, POST /api/admin/directory/leave/:jid, api.joinByLink, api.leaveEntry]
  affects: [src/monitor.ts, src/admin/src/lib/api.ts]
tech_stack:
  added: []
  patterns: [route-before-generic-handler, jid-suffix-dispatch]
key_files:
  created: []
  modified:
    - src/monitor.ts
    - src/admin/src/lib/api.ts
decisions:
  - "invite code extraction from full chat.whatsapp.com URL handled server-side — client sends raw link"
  - "JID suffix (@g.us vs @newsletter) determines backend call — no separate endpoints needed"
  - "Both routes placed before /directory/refresh to prevent :jid pattern collision"
metrics:
  duration_minutes: 5
  completed_date: "2026-03-25T20:10:26Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 45 Plan 01: Add Join/Leave Admin API Routes Summary

Two backend API routes + two client methods wired — POST /api/admin/directory/join accepts invite links and calls joinWahaGroup; POST /api/admin/directory/leave/:jid dispatches to leaveWahaGroup or unfollowWahaChannel based on JID suffix.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add join and leave routes to monitor.ts | 8e582af | src/monitor.ts |
| 2 | Add joinByLink() and leaveEntry() to api.ts | 2ef4f51 | src/admin/src/lib/api.ts |

## What Was Built

### monitor.ts Changes
- Extended send.ts import line to include `joinWahaGroup`, `leaveWahaGroup`, `unfollowWahaChannel`
- `POST /api/admin/directory/join`: parses `{ inviteLink }`, extracts invite code from full chat.whatsapp.com URL if needed, calls `joinWahaGroup`
- `POST /api/admin/directory/leave/:jid`: decodes JID from URL, validates with `isValidJid()`, dispatches to `leaveWahaGroup` (@g.us) or `unfollowWahaChannel` (@newsletter)
- Both routes placed before `/directory/refresh` (line ~1852) to prevent route collision with generic `:jid` handlers

### api.ts Changes
- `joinByLink(inviteLink: string)` — POSTs `{ inviteLink }` to `/directory/join`, returns `{ ok: boolean }`
- `leaveEntry(jid: string)` — POSTs to `/directory/leave/${encodeURIComponent(jid)}`, returns `{ ok: boolean }`
- Added inside `// Directory` section, after `refreshDirectory`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — both routes are fully wired to real send.ts functions.

## Self-Check: PASSED

- `grep "api/admin/directory/join" src/monitor.ts` — 3 matches (comment + if check + log)
- `grep "api/admin/directory/leave" src/monitor.ts` — 2 matches (comment + regex)
- `grep "joinWahaGroup\|leaveWahaGroup\|unfollowWahaChannel" src/monitor.ts` — 4 matches (import + 3 call sites)
- `grep "joinByLink\|leaveEntry" src/admin/src/lib/api.ts` — 2 matches
- Route ordering: join (1790) and leave (1819) before refresh (1852)
- TypeScript: no errors (`npx tsc --noEmit` clean)
