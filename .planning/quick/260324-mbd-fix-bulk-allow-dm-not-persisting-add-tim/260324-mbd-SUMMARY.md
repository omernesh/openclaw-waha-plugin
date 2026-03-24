---
phase: quick
plan: 260324-mbd
subsystem: admin-panel
tags: [bug-fix, feature, directory, allow-dm, timed-access]
dependency_graph:
  requires: []
  provides: [persistent-allow-dm, timed-dm-access]
  affects: [src/monitor.ts, src/admin/src/components/tabs/directory/shared-columns.tsx, src/admin/src/components/tabs/directory/BulkEditToolbar.tsx, src/admin/src/components/tabs/directory/ContactsTab.tsx, src/admin/src/lib/api.ts]
tech_stack:
  added: []
  patterns: [db-source-of-truth, timed-access-unix-seconds, dropdown-duration-picker]
key_files:
  created: []
  modified:
    - src/monitor.ts
    - src/admin/src/components/tabs/directory/shared-columns.tsx
    - src/admin/src/components/tabs/directory/BulkEditToolbar.tsx
    - src/admin/src/components/tabs/directory/ContactsTab.tsx
    - src/admin/src/lib/api.ts
decisions:
  - DB is source of truth for allowedDm enrichment — config sync is best-effort only
  - expiresAt uses Unix seconds throughout (server and client)
  - setParticipantAllowDm doesn't support TTL so participant allow-dm also calls setContactAllowDm with expiresAt
  - Pre-existing TS errors in AnalyticsTab.test and LogTab are out of scope
metrics:
  duration: "~20 minutes"
  completed: "2026-03-24"
  tasks_completed: 2
  files_modified: 5
---

# Quick Task 260324-mbd: Fix Bulk Allow-DM Not Persisting + Add Timed DM Access

**One-liner:** DB-backed allow-dm enrichment (was using stale config) + 5-option timed DM access dropdown with expiry badges in individual and bulk flows.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Fix allow-dm enrichment to use DB + accept expiresAt on endpoints | a509134 | src/monitor.ts |
| 2 | Add timed DM access UI — duration picker, expiry badge, bulk duration | 1d6481f | shared-columns.tsx, BulkEditToolbar.tsx, ContactsTab.tsx, api.ts |

## What Was Done

### Task 1 — server (monitor.ts)

**Root cause fixed:** `GET /api/admin/directory` enriched `allowedDm` from `configAllowFrom` (config file array). The config may be stale due to partial syncs or race conditions. The DB (`allow_list` table) is always written correctly. Changed `configAllowFrom.includes(c.jid)` to `db.isContactAllowedDm(c.jid)`.

**expiresAt support added to:**
- `POST /api/admin/directory/:jid/allow-dm` — accepts `{ allowed, expiresAt? }`, passes to `setContactAllowDm`
- `POST /api/admin/directory/bulk` — destructures `expiresAt` from body, passes to `setContactAllowDm` in allow-dm branch
- `POST /api/admin/directory/group/:groupJid/participants/:participantJid/allow-dm` — accepts `expiresAt`, calls both `setParticipantAllowDm` (group table) and `setContactAllowDm` (allow_list with TTL)

### Task 2 — UI (admin React panel)

**`shared-columns.tsx` (`makeDmAccessColumn`):**
- Not allowed: dropdown button with 5 duration options (1h, 24h, 7d, 30d, permanent). Each calls `api.toggleAllowDm(jid, { allowed: true, expiresAt })`
- Allowed + no expiry: green "Permanent" badge + Revoke button
- Allowed + future expiry: green "Allowed" badge + subtext ("23h left", "6d left") + Revoke button
- Allowed + expired: amber "Expired" badge + Revoke button
- `formatTimeRemaining(expiresAt)` helper formats diff in minutes/hours/days

**`BulkEditToolbar.tsx`:**
- "Allow DM" button replaced with DropdownMenu, same 5 duration options
- `onAction` signature changed to `(action, expiresAt?) => void`
- "Revoke DM" unchanged

**`ContactsTab.tsx`:**
- `handleBulkAction` accepts `expiresAt?`, passes to `api.bulkDirectory`
- Toast includes duration label (e.g., "Granted DM access for 3 contact(s) (24h)")

**`api.ts`:**
- `toggleAllowDm` body: `{ allowed: boolean; expiresAt?: number | null }`
- `bulkDirectory` body: adds `expiresAt?: number | null`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- src/monitor.ts modified and committed (a509134)
- src/admin/src/components/tabs/directory/shared-columns.tsx modified and committed (1d6481f)
- src/admin/src/components/tabs/directory/BulkEditToolbar.tsx modified and committed (1d6481f)
- src/admin/src/components/tabs/directory/ContactsTab.tsx modified and committed (1d6481f)
- src/admin/src/lib/api.ts modified and committed (1d6481f)
- Admin Vite build succeeded (11.20s)
- Root TypeScript compiles clean
- Admin TypeScript: no errors in changed files (pre-existing errors in AnalyticsTab.test.tsx and LogTab.tsx are out of scope)
