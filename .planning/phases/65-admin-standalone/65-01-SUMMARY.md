---
phase: 65-admin-standalone
plan: "01"
subsystem: admin-ui
tags: [workspace-management, admin-panel, multi-tenant, react, better-auth]
dependency_graph:
  requires: [64-01, 64-02, 63-01, 63-02, 63-03]
  provides: [workspace-crud-api, workspaces-tab-ui]
  affects: [monitor.ts, auth.ts, workspace-manager.ts, admin-panel]
tech_stack:
  added: [dialog.tsx (Radix UI dialog)]
  patterns: [shadcn Card/Dialog/AlertDialog, fetch with credentials:include, react lazy]
key_files:
  created:
    - src/admin/src/components/tabs/WorkspacesTab.tsx
    - src/admin/src/components/ui/dialog.tsx
  modified:
    - src/auth.ts
    - src/monitor.ts
    - src/workspace-manager.ts
    - src/admin/src/App.tsx
    - src/admin/src/components/AppSidebar.tsx
    - src/admin/src/components/TabHeader.tsx
decisions:
  - "Export authDb from auth.ts for direct SQL queries in workspace routes (avoids going through better-auth internals for admin operations)"
  - "Add optional manager param to createWahaWebhookServer + monitorWahaProvider — workspace routes degrade gracefully (listWorkspaces returns empty, stopWorkspace is no-op) when manager not provided"
  - "stopWorkspace() deletes from registry BEFORE killing child process — prevents exit handler from re-forking a deleted workspace"
  - "dialog.tsx created using @radix-ui/react-dialog (already installed) — no new dependencies needed"
  - "TAB_TITLES in TabHeader.tsx also completed for onboarding/api-keys/integration (were missing, TypeScript Record<TabId,string> would error)"
metrics:
  duration: "~20 min"
  completed_date: "2026-03-28"
  tasks_completed: 1
  tasks_total: 2
  files_modified: 7
---

# Phase 65 Plan 01: Workspace CRUD + Admin Standalone Summary

**One-liner:** Workspace management tab (list/create/delete) backed by 3 /api/admin/workspaces routes using authDb direct SQL + WorkspaceProcessManager.

## What Was Built

### ADMIN-01: Standalone auth (confirmed)
- Admin panel auth (better-auth) already implemented in Phase 63 — works without OpenClaw gateway
- Verified: `standalone.ts` calls `initAuthDb()` + `monitorWahaProvider()` directly

### ADMIN-02: Workspace management
**Backend (monitor.ts):**
- `GET /api/admin/workspaces` — queries authDb user table, cross-references WorkspaceProcessManager for runtime status (running/starting/crashed), returns JSON array
- `POST /api/admin/workspaces` — calls `auth.api.signUpEmail()`, databaseHooks auto-assigns workspaceId, returns created record
- `DELETE /api/admin/workspaces/:workspaceId` — calls `manager.stopWorkspace()` first, then `DELETE FROM user WHERE workspaceId = ?`
- All routes protected by existing `/api/admin/*` auth guard (lines 654-656)

**WorkspaceProcessManager (workspace-manager.ts):**
- Added `stopWorkspace(workspaceId)` method — removes from registry first, sends IPC shutdown, kills after 5s timeout
- Added restart guard in exit handler: `if (!this.registry.has(entry.workspaceId)) return` — prevents re-fork of deleted workspaces

**Frontend (React):**
- `WorkspacesTab.tsx` — card grid per workspace, status Badge (running/starting/crashed/stopped), truncated workspaceId with copy button, "Create Workspace" Dialog, AlertDialog delete confirmation, loading Skeleton, empty state
- `dialog.tsx` — new shadcn-style Dialog component using `@radix-ui/react-dialog` (already installed)
- `AppSidebar.tsx` — `workspaces` added to TabId union + NAV_ITEMS (Building2 icon, after integration)
- `TabHeader.tsx` — `workspaces: 'Workspaces'` added to TAB_TITLES; also added missing `onboarding`, `api-keys`, `integration` entries
- `App.tsx` — lazy WorkspacesTab import + renderActiveTab case

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: Workspace CRUD backend + UI + wiring | `6042eaf` | src/auth.ts, src/monitor.ts, src/workspace-manager.ts, src/admin/src/App.tsx, AppSidebar.tsx, TabHeader.tsx, WorkspacesTab.tsx |
| Fix: Add missing dialog.tsx | `9bb119d` | src/admin/src/components/ui/dialog.tsx |

## Checkpoint — Awaiting Verification

**Task 2 (checkpoint:human-verify)** was reached. The following needs visual verification in browser:

1. `npm run build` — succeeds (verified: `✓ built in 1.55s`)
2. Open admin panel → log in (ADMIN-01 standalone auth)
3. Click "Workspaces" in sidebar — tab loads with empty state or list
4. Click "Create Workspace" → dialog opens, fill name/email/password → submit → workspace appears in list
5. Status badge shows correctly (stopped if no manager running, running if multi-tenant)
6. Click "Delete" on a workspace → AlertDialog confirmation → workspace removed from list

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing `dialog.tsx` UI component**
- **Found during:** npm run build (rollup: "The system cannot find the file specified" for `@/components/ui/dialog`)
- **Issue:** WorkspacesTab imports `Dialog` from `@/components/ui/dialog` which didn't exist; only `alert-dialog.tsx` was present
- **Fix:** Created `src/admin/src/components/ui/dialog.tsx` using `@radix-ui/react-dialog` (already installed, same package as alert-dialog.tsx and sheet.tsx)
- **Files modified:** `src/admin/src/components/ui/dialog.tsx` (created)
- **Commit:** `9bb119d`

**2. [Rule 2 - Missing critical functionality] TAB_TITLES missing onboarding/api-keys/integration**
- **Found during:** Task 1 — `TabHeader.tsx` TAB_TITLES was typed `Record<TabId, string>` but missing 3 Tab IDs added in Phase 63
- **Issue:** TypeScript strict mode would error; adding `workspaces` without fixing the existing missing entries would leave the Record incomplete
- **Fix:** Added `onboarding`, `api-keys`, `integration`, and `workspaces` to TAB_TITLES
- **Files modified:** `src/admin/src/components/TabHeader.tsx`
- **Commit:** `6042eaf`

## Known Stubs

None — WorkspacesTab fetches live data from `/api/admin/workspaces` which queries authDb. No hardcoded empty values flow to UI rendering.

## Self-Check: PASSED

- FOUND: src/admin/src/components/tabs/WorkspacesTab.tsx
- FOUND: src/admin/src/components/ui/dialog.tsx
- FOUND: commit 6042eaf (feat 65-01 workspace CRUD)
- FOUND: commit 9bb119d (fix 65-01 dialog.tsx)
