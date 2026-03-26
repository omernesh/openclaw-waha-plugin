---
phase: 17-modules-framework
plan: 01
subsystem: plugin-architecture
tags: [module-system, sqlite, inbound-pipeline, typescript, better-sqlite3]

# Dependency graph
requires:
  - phase: 16-pairing-mode-and-auto-reply
    provides: DirectoryDb public API pattern, inbound pipeline structure, pairing/auto-reply block position
provides:
  - WahaModule interface and ModuleContext type (src/module-types.ts)
  - ModuleRegistry singleton with register/list/enable/disable/getModulesForChat (src/module-registry.ts)
  - SQLite module_assignments and module_config tables in DirectoryDb
  - DirectoryDb CRUD methods for module assignments and config
  - Module hook invocation in inbound pipeline after pairing/auto-reply, before DM policy
affects:
  - 17-02 (module REST API — uses module-registry.ts and DirectoryDb module methods)
  - 17-03 (admin panel module UI — uses /api/admin/modules endpoints from 17-02)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ModuleRegistry singleton pattern (getModuleRegistry())
    - WahaModule interface with onInbound hook returning boolean for pipeline consumption
    - module_assignments table linking module_id to chat JIDs for scoped hook firing

key-files:
  created:
    - src/module-types.ts
    - src/module-registry.ts
  modified:
    - src/directory.ts
    - src/inbound.ts

key-decisions:
  - "message.messageId used in ModuleContext (not message.id?.id) — WahaInboundMessage uses messageId directly"
  - "Module hooks fire after pairing/auto-reply block and BEFORE DM policy check — modules see pre-policy messages"
  - "getModulesForChat returns [] fast when no modules registered — zero-cost for unregistered deployments"

patterns-established:
  - "WahaModule.onInbound returns true to consume message (stop pipeline), void/false to continue"
  - "Module errors are caught per-module and logged — never stop the pipeline"
  - "Modules only fire for chats explicitly assigned in module_assignments SQLite table"

requirements-completed: [MOD-01, MOD-02, MOD-05, MOD-06]

# Metrics
duration: 5min
completed: 2026-03-17
---

# Phase 17 Plan 01: Modules Framework Foundation Summary

**WahaModule interface + ModuleRegistry singleton + SQLite module_assignments table + inbound pipeline hook, enabling developers to register modules that receive scoped onInbound calls for assigned chats**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-17T15:12:47Z
- **Completed:** 2026-03-17T15:18:01Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- WahaModule interface and ModuleContext type defined in src/module-types.ts with MOD-06 comment (WhatsApp-specific, no cross-platform abstraction)
- ModuleRegistry singleton implemented with register/unregister/list/enable/disable/getModulesForChat — queries DirectoryDb for chat-scoped hook firing
- module_assignments and module_config SQLite tables added to DirectoryDb with full CRUD methods (getModuleAssignments, getChatModules, assignModule, unassignModule, getModuleConfig, setModuleConfig)
- Module hook block wired into inbound.ts between pairing/auto-reply and DM policy — modules are isolated from pipeline failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Define WahaModule interface and create module registry** - `fdd87db` (feat)
2. **Task 2: Wire module hooks into inbound pipeline** - `9147383` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/module-types.ts` - WahaModule interface + ModuleContext type
- `src/module-registry.ts` - ModuleRegistry class + getModuleRegistry() singleton + convenience exports
- `src/directory.ts` - Added module_assignments + module_config CREATE TABLE, plus 6 public CRUD methods
- `src/inbound.ts` - Added import of getModuleRegistry/ModuleContext + module hook block in pipeline

## Decisions Made
- Used `message.messageId` (not `message.id?.id`) in ModuleContext — WahaInboundMessage has a flat `messageId` field, not a nested id object. Plan template used WAHA raw message shape; this codebase normalizes first.
- Module hooks inserted BEFORE DM policy check (not after) — this means modules can intercept messages that would otherwise be dropped by DM policy. Matches plan spec: "after fromMe+dedup+pairing/auto-reply, before DM policy."

## Deviations from Plan

None - plan executed exactly as written. The only adjustment was using the correct `message.messageId` field (WahaInboundMessage shape) instead of the plan template's `message.id?.id` (raw WAHA shape).

## Issues Encountered
- No tsconfig.json in project — `npx tsc --noEmit` could not run. Used TypeScript's `transpileModule()` API directly to validate syntax of all modified files. All validated clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Module framework backbone complete. Plan 17-02 can add the REST API endpoints (list/assign/unassign/config) and Plan 17-03 can add the admin panel UI tab.
- Any module can now be registered via `registerModule(mod)` and assigned to chats via DirectoryDb.assignModule(). The pipeline will call onInbound for those chats.

---
*Phase: 17-modules-framework*
*Completed: 2026-03-17*
