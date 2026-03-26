---
phase: 12-ui-bug-sprint
plan: 02
subsystem: ui
tags: [admin-panel, sessions, can-initiate, monitor, directory, config-schema]

# Dependency graph
requires:
  - phase: 12-01
    provides: dashboard UI fixes and sessions tab foundation (role/subRole dropdowns, health dots)
provides:
  - Optimistic UI for sessions role/subRole dropdowns (no flicker on save)
  - 502 polling overlay for gateway restart detection from sessions tab
  - Role/Sub-Role labels and explanatory text box in sessions tab
  - pairing DM Policy option removed; auto-migration to allowlist on load
  - Global Can Initiate toggle in Settings Access Control section
  - Per-contact Can Initiate 3-state dropdown (Default/Allow/Block) replacing boolean checkbox
  - can_initiate_override TEXT column in dm_settings SQLite table
  - canInitiateGlobal field in config schema and TypeScript types
affects:
  - Phase 13 (Background Sync): canInitiateOverride is persisted in dm_settings — sync must carry the new column
  - Phase 16 (Pairing Mode): pairing type removed from WahaAccountConfig.dmPolicy union

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "onmousedown + data-prev for optimistic revert: capture dropdown value before change event fires"
    - "showSessionRestartOverlay + pollSessionsUntilReady: shared pattern with saveAndRestart for 502 handling"
    - "canInitiateOverride as 3-state enum with 'default' fallback — backward-compatible with boolean canInitiate"

key-files:
  created: []
  modified:
    - src/monitor.ts
    - src/types.ts
    - src/config-schema.ts
    - src/directory.ts

key-decisions:
  - "Kept canInitiate: boolean in ContactDmSettings unchanged — shutup.ts backup/restore uses boolean. Added separate canInitiateOverride: 'default' | 'allow' | 'block' field and column."
  - "Added can_initiate_override TEXT column (not renaming existing INTEGER column) to avoid SQLite column type change and backward-compat issues."
  - "onmousedown + data-prev attribute pattern for optimistic UI revert — captures old value before the change event fires, passed into saveSessionRole as prevVal."
  - "Removed pairing from WahaAccountConfig.dmPolicy type union — breaking type change, intentional cleanup."

patterns-established:
  - "Optimistic dropdown UI: use data-prev + onmousedown to capture pre-change value; revert on API error; never re-render full list on success."
  - "Session restart overlay reuse: showSessionRestartOverlay() / pollSessionsUntilReady() mirror saveAndRestart() pattern but poll /api/admin/sessions and dismiss overlay instead of page-reload."

requirements-completed:
  - UI-03
  - UI-04
  - UX-01
  - UI-08
  - INIT-01
  - INIT-02

# Metrics
duration: 15min
completed: 2026-03-17
---

# Phase 12 Plan 02: Sessions UX Polish, Pairing Removal, and Can Initiate System Summary

**Optimistic sessions dropdowns with 502 overlay, role labels, pairing auto-migration, and a global + per-contact Can Initiate toggle system backed by SQLite**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-17T01:19:00Z
- **Completed:** 2026-03-17T01:24:01Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Sessions tab dropdowns now update optimistically (no flicker) — saveSessionRole() toasts and leaves, never reloads
- 502 and network errors during role save show a polling overlay ("Gateway restarting...") that auto-dismisses when the server responds
- Role and Sub-Role labels added above dropdowns; explanatory text box appended at bottom of sessions list
- pairing removed from DM Policy dropdown; loadConfig() auto-migrates existing pairing configs to allowlist with toast + silent API save
- Settings tab Access Control section gains a "Can Initiate (Global Default)" checkbox (default on), wired into loadConfig/saveSettings
- Per-contact Can Initiate is now a 3-state dropdown (Default/Allow/Block) stored in new `can_initiate_override TEXT` column in dm_settings
- All 313 tests continue to pass

## Task Commits

1. **Task 1: Sessions tab optimistic UI, 502 overlay, labels, pairing removal** - `869f1e1` (feat)
2. **Task 2: Can Initiate global toggle and per-contact override** - `9be9383` (feat)

## Files Created/Modified

- `src/monitor.ts` - saveSessionRole() optimistic UI; showSessionRestartOverlay() + pollSessionsUntilReady(); labels + sessions-explainer; pairing removal + auto-migration; canInitiateGlobal checkbox; per-contact Can Initiate dropdown; API handler update
- `src/types.ts` - Added canInitiateGlobal?: boolean to WahaAccountConfig; removed "pairing" from dmPolicy union
- `src/config-schema.ts` - Added canInitiateGlobal: z.boolean().optional().default(true) to WahaAccountSchemaBase
- `src/directory.ts` - Added canInitiateOverride field to ContactDmSettings type; DEFAULT_DM_SETTINGS updated; ALTER TABLE migration for can_initiate_override; get/set/query methods updated

## Decisions Made

- Kept `canInitiate: boolean` unchanged in `ContactDmSettings` (shutup.ts backup/restore requires a boolean). Added separate `canInitiateOverride: "default" | "allow" | "block"` as an additive field.
- Added `can_initiate_override TEXT DEFAULT 'default'` as a new column rather than renaming the existing INTEGER column — SQLite can't change column types in place.
- Used `data-prev` attribute + `onmousedown` to capture dropdown value before `onchange` fires — enables revert on API error without re-rendering the whole sessions list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Fixed saveSettings() dmPolicy default from 'pairing' to 'allowlist'**
- **Found during:** Task 1 (pairing removal)
- **Issue:** saveSettings() defaulted to `'pairing'` if s-dmPolicy had no value — would silently write pairing back to config on save
- **Fix:** Changed default in saveSettings() from `'pairing'` to `'allowlist'`
- **Files modified:** src/monitor.ts
- **Committed in:** 869f1e1 (Task 1 commit)

**2. [Rule 2 - Missing Critical] Fixed GET /api/admin/config default dmPolicy from 'pairing' to 'allowlist'**
- **Found during:** Task 1 (pairing removal audit)
- **Issue:** Server-side GET /api/admin/config handler defaulted to `"pairing"` when account.config.dmPolicy was undefined
- **Fix:** Changed `account.config.dmPolicy ?? "pairing"` to `account.config.dmPolicy ?? "allowlist"`
- **Files modified:** src/monitor.ts
- **Committed in:** 869f1e1 (Task 1 commit)

**3. [Rule 2 - Missing Critical] Removed 'pairing' from WahaAccountConfig.dmPolicy type union**
- **Found during:** Task 2 (types.ts review)
- **Issue:** Type still declared `dmPolicy?: "pairing" | "open" | "closed" | "allowlist"` — inconsistent with removal
- **Fix:** Removed `"pairing"` variant from the union type
- **Files modified:** src/types.ts
- **Committed in:** 9be9383 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 2 — missing critical for correctness after pairing removal)
**Impact on plan:** All fixes ensure the pairing removal is complete and consistent across UI + server + types.

## Issues Encountered

- SQLite `can_initiate INTEGER DEFAULT 1` column already existed — could not rename to TEXT. Added a new `can_initiate_override TEXT DEFAULT 'default'` column instead. The original boolean column is preserved for shutup.ts compatibility.

## Next Phase Readiness

- Sessions tab is fully polished: optimistic dropdowns, 502 overlay, labels, explanatory text
- DM Policy is pairing-free across UI, schema, and types
- Can Initiate system is wired end-to-end (global toggle + per-contact override in SQLite)
- Phase 13 (Background Sync) must include `can_initiate_override` in any dm_settings sync logic

---
*Phase: 12-ui-bug-sprint*
*Completed: 2026-03-17*
