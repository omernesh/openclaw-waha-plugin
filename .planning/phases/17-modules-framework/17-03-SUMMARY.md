---
phase: 17-modules-framework
plan: "03"
subsystem: admin-panel
tags: [modules-tab, admin-ui, module-registry, module-assignments]
dependency_graph:
  requires: [17-01]
  provides: [modules-admin-tab, modules-api-endpoints, module-assignment-ui]
  affects: [src/monitor.ts]
tech_stack:
  added: []
  patterns: [module-card-ui, optimistic-toggle, expandable-assignment-section, details-summary-pattern]
key_files:
  created: []
  modified:
    - src/monitor.ts
decisions:
  - "Module assignment UI uses <details>/<summary> expandable pattern consistent with existing admin panel collapsible sections."
  - "loadModuleAssignments() is called eagerly for all modules on loadModules() and lazily on details toggle — ensures count badges are populated immediately."
  - "Toggle uses optimistic UI: checkbox updates immediately, reverts on API error."
  - "All DB calls use opts.accountId (not a standalone accountId variable) consistent with all other admin routes."
metrics:
  duration: ~25 minutes
  completed: "2026-03-17"
  tasks_completed: 2
  files_modified: 1
requirements: [MOD-03, MOD-04]
---

# Phase 17 Plan 03: Modules Admin Tab Summary

**One-liner:** Modules admin tab with enable/disable toggles and per-module chat assignment CRUD, backed by six new /api/admin/modules/* endpoints.

## What Was Built

Added a Modules tab to the admin panel (between Sessions and Log) and the backend API routes to support it.

### Server-side API Routes (Task 1)

Added import for `getModuleRegistry` in `monitor.ts`, then registered six new routes:

1. **GET /api/admin/modules** — returns `{ modules: [{ id, name, description, version, enabled, assignmentCount }] }` by combining `ModuleRegistry.listModules()` with `DirectoryDb.getModuleAssignments()` for counts.

2. **PUT /api/admin/modules/:id/enable** — calls `getModuleRegistry().enableModule(id)`, returns `{ ok: true }`.

3. **PUT /api/admin/modules/:id/disable** — calls `getModuleRegistry().disableModule(id)`, returns `{ ok: true }`.

4. **GET /api/admin/modules/:id/assignments** — returns `{ assignments: string[] }` via `DirectoryDb.getModuleAssignments()`.

5. **POST /api/admin/modules/:id/assignments** — body `{ jid }`, calls `DirectoryDb.assignModule()`, returns `{ ok: true }`.

6. **DELETE /api/admin/modules/:id/assignments/:jid** — calls `DirectoryDb.unassignModule()`, returns `{ ok: true }`.

All routes use `opts.accountId` (matching existing admin route pattern). Placed before the directory/bulk routes section.

### Frontend UI (Task 2)

**Tab button:** Added `<button onclick="switchTab('modules', this)" id="tab-modules">Modules</button>` between Sessions and Log in the nav bar.

**Tab content:** `<div class="tab-content" id="content-modules">` with `modules-list` container and `modules-empty` empty-state div.

**loadModules():** Fetches `/api/admin/modules`, renders a card per module containing:
- Module name, description, version
- Assignment count badge (updated live)
- Enable/disable toggle (`.toggle`/`.slider` CSS classes, optimistic UI)
- `<details>` expandable Chat Assignments section

**loadModuleAssignments(moduleId):** Fetches assignments for one module, renders per-JID rows with remove (×) button. Called eagerly on tab load and lazily on details toggle.

**toggleModule(moduleId, checkbox):** PUT enable/disable with optimistic checkbox state; reverts and shows error toast on failure.

**addModuleAssignment(moduleId):** POST new JID from text input, refreshes list on success.

**removeModuleAssignment(moduleId, jid):** DELETE assignment, refreshes list on success.

**Wiring:** `switchTab` handles `'modules'` → `loadModules()`. `'modules'` added to valid hash list. `wireRefreshBtn("refresh-modules", loadModules, null)` registered.

## Verification

- TypeScript: no new errors introduced (pre-existing errors from missing `openclaw/plugin-sdk` and `@types/node` are unrelated)
- Tab bar has Modules button at correct position (between Sessions and Log): line 491
- `content-modules` tab div exists: line 1015
- `loadModules()` function fetches `/api/admin/modules`: line 2234
- Module cards have enable/disable toggle and assignment section
- `switchTab` handles `modules`: line 1076
- `wireRefreshBtn` wired: line 3883
- All six API routes registered: lines 4632-4735

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/monitor.ts` modified: FOUND
- Task 1 commit `566c26d` exists: FOUND
- Task 2 commit `60a9b12` exists: FOUND
- `tab-modules` button in nav: FOUND (line 491)
- `content-modules` div exists: FOUND (line 1015)
- `loadModules` function fetches `/api/admin/modules`: FOUND (line 2234)
- `GET /api/admin/modules` route: FOUND (line 4632)
- `PUT enable/disable` routes: FOUND (lines 4649, 4666)
- Assignment CRUD routes: FOUND (lines 4683, 4701, 4723)
- `wireRefreshBtn("refresh-modules", ...)`: FOUND (line 3883)
- No new TypeScript errors: CONFIRMED
