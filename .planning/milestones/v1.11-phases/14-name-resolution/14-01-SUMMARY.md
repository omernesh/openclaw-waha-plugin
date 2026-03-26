---
phase: 14-name-resolution
plan: "01"
subsystem: directory, admin-panel
tags: [name-resolution, jid, lid, tag-input, dashboard, dedup]
dependency_graph:
  requires: [13-background-directory-sync]
  provides: [resolveJids-method, directory-resolve-endpoint, named-tag-pills, lid-dedup]
  affects: [src/directory.ts, src/monitor.ts]
tech_stack:
  added: []
  patterns: [batch-sql-in-query, debounced-fetch, lid-to-cus-fallback, dedup-filter]
key_files:
  created: []
  modified:
    - src/directory.ts
    - src/monitor.ts
decisions:
  - "@lid->@c.us fallback: two-pass approach — batch SQL IN query for all JIDs, then second pass for unresolved @lid entries mapping to their @c.us equivalents"
  - "resolveNames debounce: 50ms setTimeout after renderTags to batch all setValue-triggered lookups into a single fetch call"
  - "getValue() immutability: pill text is cosmetic only; tags[] array always stores raw JIDs to preserve config save correctness"
  - "resolve route placement: GET /api/admin/directory/resolve handler placed BEFORE /:jid handler so literal 'resolve' is not treated as a JID parameter"
metrics:
  duration: "~8 minutes"
  completed_date: "2026-03-17"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 14 Plan 01: Name Resolution — Batch Resolve Endpoint and Tag Input Names Summary

**One-liner:** Batch JID-to-name resolution API with @lid->@c.us fallback, named pill bubbles in tag inputs, and @lid/@c.us deduplication in the dashboard Access Control card.

## What Was Built

### Task 1: Batch resolve endpoint and @lid fallback

**`DirectoryDb.resolveJids(jids: string[])`** added to `src/directory.ts`:
- Accepts an array of JID strings
- Returns `Map<string, string>` of input JID to resolved display name
- Uses a single SQL `WHERE jid IN (...)` query for efficiency
- Second pass for unresolved `@lid` JIDs: replaces `@lid` with `@c.us` and looks up again
- JIDs with no match are omitted from the result map

**`GET /api/admin/directory/resolve`** route added to `src/monitor.ts`:
- Accepts `?jids=jid1,jid2,...` (comma-separated, URL-encoded)
- Calls `db.resolveJids()` and returns `{ resolved: { jid: name } }`
- Placed BEFORE the `/:jid` handler to prevent path collision
- JIDs with no resolved name are omitted from the response

**`GET /api/admin/directory/:jid`** enhanced with @lid fallback:
- If direct `getContact(jid)` returns null and jid ends with `@lid`
- Tries `getContact(jid.replace('@lid', '@c.us'))` as fallback
- Returns contact data with the original `@lid` JID preserved

### Task 2: Tag input name resolution and dashboard Access Control dedup

**`createTagInput` enhanced** in `src/monitor.ts`:
- Added optional `resolveNames: true` option
- `applyResolvedNames(resolvedMap)`: updates pill text content to show names, sets `title` attribute to raw JID (tooltip)
- `scheduleResolve()`: debounced 50ms batch fetch to `/api/admin/directory/resolve`
- `renderTags()`: adds `data-jid` attribute to each pill (used by `applyResolvedNames`), calls `scheduleResolve()` at end
- `getValue()` unchanged — still returns raw JID strings from `tags[]` array

**Three tag inputs updated** to pass `resolveNames: true`:
- `tagInputAllowFrom` — Allow From field
- `tagInputGroupAllowFrom` — Group Allow From field
- `tagInputAllowedGroups` — Allowed Groups field

**`dedupLidCus()` function** added in dashboard Access Control card:
- Removes `@lid` entries when the `@c.us` equivalent is present in the same array
- Applied to `allowFrom`, `groupAllowFrom`, `allowedGroups` arrays before rendering Name Resolver entries
- Prevents the same person appearing twice (NOWEB sends both `@lid` and `@c.us` JIDs)

## Commits

| Hash | Description |
|------|-------------|
| `9f94918` | feat(14-01): batch resolve endpoint and @lid->@c.us fallback |
| `44f9dd1` | feat(14-01): tag input name resolution and dashboard Access Control dedup |

## Verification Results

- `npx vitest run` — 313 tests pass (29 test files)
- `resolveJids` method exists in `src/directory.ts` — 1 match
- `api/admin/directory/resolve` in `src/monitor.ts` — 4 matches (route handler + frontend fetch + comments)
- `resolveNames` in `src/monitor.ts` — 6 matches (option check, usage in 3 createTagInput calls, comments)
- `dedupLidCus` in `src/monitor.ts` — 3 matches (function def + call + comment)
- `getValue()` returns `tags.slice()` — raw JIDs unchanged

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/directory.ts` modified — confirmed (resolveJids method at line 364)
- `src/monitor.ts` modified — confirmed (resolve route at line 3895, createTagInput at line 1075, dedupLidCus at line 1619)
- Commits `9f94918` and `44f9dd1` exist in git log
- All 313 tests pass
