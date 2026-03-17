---
phase: 14-name-resolution
plan: "02"
subsystem: directory-ui
tags: [name-resolution, group-participants, contact-picker, lid, sql-join, batch-resolve]
dependency_graph:
  requires: [14-01]
  provides: [group-participant-name-display, god-mode-batch-resolve]
  affects: [src/directory.ts, src/monitor.ts]
tech_stack:
  added: []
  patterns: [LEFT-JOIN-COALESCE, batch-resolve, FTS5-search]
key_files:
  created: []
  modified:
    - src/directory.ts
    - src/monitor.ts
decisions:
  - getGroupParticipants uses LEFT JOIN COALESCE for @lid->@c.us resolution at SQL level
  - Contact picker batch resolve replaces N per-JID fetches with single /resolve call
  - getValue() returns raw JID strings unchanged — config save correctness preserved
metrics:
  duration: 8m
  completed_date: "2026-03-17"
  tasks_completed: 2
  files_modified: 2
---

# Phase 14 Plan 02: Group Participant Name Resolution and Contact Picker Batch Resolve Summary

**One-liner:** SQL LEFT JOIN COALESCE resolves @lid group participants to contact names; contact picker replaced N per-JID fetches with single batch resolve call.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Group participant name resolution via SQL JOIN | e85bf1c | src/directory.ts |
| 2 | God Mode Users name resolution and contact picker verification | 23e64b4 | src/monitor.ts |

## What Was Built

### Task 1: getGroupParticipants SQL JOIN Enhancement (src/directory.ts)

Replaced the single-table SELECT in `getGroupParticipants()` with a three-way COALESCE LEFT JOIN query:

```sql
SELECT gp.group_jid, gp.participant_jid,
  COALESCE(gp.display_name, c_direct.display_name, c_cus.display_name) as display_name,
  gp.is_admin, gp.allow_in_group, gp.allow_dm, gp.participant_role
FROM group_participants gp
LEFT JOIN contacts c_direct ON gp.participant_jid = c_direct.jid
LEFT JOIN contacts c_cus ON REPLACE(gp.participant_jid, '@lid', '@c.us') = c_cus.jid
  AND gp.participant_jid LIKE '%@lid'
WHERE gp.group_jid = ?
ORDER BY display_name ASC, gp.participant_jid ASC
```

Resolution priority:
1. `gp.display_name` — name already stored in group_participants table
2. `c_direct.display_name` — direct JID match in contacts table
3. `c_cus.display_name` — for @lid JIDs, the @c.us equivalent contact name

The `LIKE '%@lid'` gate prevents the c_cus JOIN from activating for @c.us participants (only needed for NOWEB @lid JIDs). Return shape unchanged — frontend uses `p.displayName || pNameFallback` which continues to work correctly.

### Task 2: Contact Picker Batch Resolve (src/monitor.ts)

Optimized both `setValue()` and `setSelectedObjects()` in `createContactPicker` to use the batch `/api/admin/directory/resolve` endpoint from Plan 01 instead of N individual per-JID fetch calls:

- **setValue**: Collects all JIDs needing resolution, fires single batch call, updates all displayNames, calls `renderChips()` once
- **setSelectedObjects**: Same batch pattern — only resolves items where `displayName === jid` (unresolved)
- **@lid fallback**: Handled automatically by `resolveJids()` in directory.ts (Plan 01)
- **getValue()**: Unchanged — still returns raw JID strings via `.map(s => s.jid)` for config save correctness

Added `NAME-03` comment near `doSearch()` confirming contact picker search uses FTS5 (Phase 13).

## Verification

- `npx vitest run` — 313 tests pass (29 test files)
- `grep "LEFT JOIN contacts" src/directory.ts` — 2 matches (c_direct, c_cus JOINs)
- `grep "COALESCE.*display_name" src/directory.ts` — 1 match (three-way COALESCE)
- `grep "api/admin/directory/resolve" src/monitor.ts` — batch resolve in setValue (line 1373) and setSelectedObjects (line 1401)
- `grep "NAME-03" src/monitor.ts` — 1 match at doSearch

## Deviations from Plan

None — plan executed exactly as written.

## Key Decisions Made

- Used `LIKE '%@lid'` gate on c_cus JOIN to prevent unnecessary JOIN for @c.us participants (correctness + performance)
- Batch resolve fires only when `needResolve.length > 0` (avoids empty API call when all names already known)
- `renderChips()` called once after all names updated (avoids N incremental re-renders)
- `setSelectedObjects` filter: `!s.displayName || s.displayName === s.jid` (handles both unset and raw-JID cases)

## Self-Check: PASSED

- src/directory.ts: FOUND
- src/monitor.ts: FOUND
- 14-02-SUMMARY.md: FOUND
- Commit e85bf1c (Task 1): FOUND
- Commit 23e64b4 (Task 2): FOUND
