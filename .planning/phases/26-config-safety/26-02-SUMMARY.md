---
phase: 26-config-safety
plan: 02
subsystem: admin-ui
tags: [validation, config, export, import, settings-tab]

# Dependency graph
requires:
  - 26-01 (export/import API endpoints, validation_failed error format)
provides:
  - Field-level validation error display in SettingsTab (CFG-02)
  - Export Config button triggering openclaw-config.json download (CFG-04)
  - Import Config button with file picker, validation errors, and config reload (CFG-05)
affects: [admin-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "request() throws parsed JSON body on non-2xx — callers can inspect .error and .fields without re-parsing"
    - "applyValidationErrors() centralizes 400 handling — used by handleSave, handleSaveAndRestart, handleImport"
    - "FieldError component renders null when no error — safe to place after every relevant input"

key-files:
  created: []
  modified:
    - src/admin/src/lib/api.ts
    - src/admin/src/components/tabs/SettingsTab.tsx

key-decisions:
  - "request() JSON parse of error body is re-throw-safe: catches SyntaxError separately, re-throws parsed objects"
  - "Export uses direct fetch() (not request()) to get a Blob — request() always calls .json()"
  - "fieldErrors cleared on every save attempt — stale errors from a previous failure never persist across a new submit"
  - "handleSaveAndRestart reuses applyValidationErrors — consistent behavior between save paths"

patterns-established:
  - "Validation UI: backend 400 -> parsed JSON -> applyValidationErrors() -> setFieldErrors() -> FieldError components"

requirements-completed: [CFG-02, CFG-04, CFG-05]

# Metrics
duration: 10min
completed: 2026-03-20
---

# Phase 26 Plan 02: Config Safety — Frontend Summary

**Validation errors surface field-by-field in Settings tab; Export downloads full config; Import applies config with server-side validation**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-20T04:18:00Z
- **Completed:** 2026-03-20T04:28:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- `request()` in api.ts now throws parsed JSON body on non-2xx responses — structured error objects (`.error`, `.fields`) survive to callers without re-parsing
- `api.exportConfig()` fetches config blob directly (bypasses `request()` since Blob, not JSON is needed)
- `api.importConfig()` posts full config JSON, returns `{ ok: boolean }`
- `FieldError` component renders a destructive-colored message under each offending input when `fieldErrors` map has a matching path
- `applyValidationErrors()` centralizes 400 handling — detects `validation_failed`, sets `fieldErrors` state, shows count toast
- `handleSave` and `handleSaveAndRestart` both clear `fieldErrors` on attempt start and call `applyValidationErrors()` on failure
- `handleExport` creates object URL, triggers `<a>` click, revokes URL, shows success toast
- `handleImport` reads file, parses JSON, calls `api.importConfig()`, reloads config from server on success, shows field errors on failure
- Export Config and Import Config buttons added alongside Save / Save & Restart; hidden `<input type="file">` bound to `fileInputRef`
- `FieldError` placed under: `webhookPort`, `dmFilter.tokenEstimate`, `groupFilter.tokenEstimate`

## Task Commits

1. **Task 1: Add export/import API + validation error UI** - `4045747` (feat)

## Files Created/Modified
- `src/admin/src/lib/api.ts` - Updated `request()` error handling; added `exportConfig`, `importConfig` methods
- `src/admin/src/components/tabs/SettingsTab.tsx` - Added `FieldError` component, `fieldErrors` state, `fileInputRef`, `applyValidationErrors()`, `handleExport`, `handleImport`, Export/Import buttons, `FieldError` placements

## Decisions Made
- `request()` throws parsed JSON body (not `ApiError`) when response is valid JSON — callers that know the shape get the object directly; other callers still see a thrown value they can `String()`
- Export bypasses `request()` to get a raw `Blob` — `request()` always calls `.json()` which would fail on blob content types
- `fieldErrors` cleared at the start of each save/import attempt — no stale error state carried across submissions

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
Pre-existing TypeScript errors in `ChannelsTab.tsx`, `ContactsTab.tsx`, and `DirectoryTab.tsx` (unrelated to this plan, out of scope).

## User Setup Required
None.

## Next Phase Readiness
- Phase 26 complete: all 5 CFG requirements (CFG-01 through CFG-05) implemented
- Frontend wires to backend endpoints from Plan 01 — ready for deploy and QA

---
*Phase: 26-config-safety*
*Completed: 2026-03-20*
