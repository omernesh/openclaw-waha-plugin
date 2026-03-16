---
phase: 09-settings-ux-improvements
plan: 02
subsystem: ui
tags: [vanilla-js, admin-panel, tag-input, group-filter, trigger-operator, monitor-ts]

requires:
  - phase: 08-shared-ui-components
    provides: "createTagInput() factory function with getValue/setValue API"

provides:
  - "gfoTagInputs registry: per-group tag input instances keyed by sanitized JID"
  - "Trigger operator AND/OR select with tooltip in group filter override section"
  - "triggerOperator field persisted in GroupFilterOverride type and SQLite schema"
  - "Backend PUT /api/admin/directory/:jid/filter validates and persists triggerOperator"

affects:
  - 09-settings-ux (remaining plans in phase 9)

tech-stack:
  added: []
  patterns:
    - "Per-group component registry: gfoTagInputs object keyed by sfx for independent instances per group panel"
    - "ALTER TABLE migration with try/catch for idempotent column addition"

key-files:
  created: []
  modified:
    - src/monitor.ts
    - src/directory.ts

key-decisions:
  - "Reused sfx variable from buildGroupPanel for gfoTagInputs registry key — same sanitized JID suffix used for all element IDs"
  - "ALTER TABLE migration wrapped in try/catch for idempotent column addition — safe on repeated startups"
  - "triggerOperator defaults to OR if not provided — backward compatible with existing group filter overrides"

requirements-completed: [UX-03]

duration: 4min
completed: 2026-03-16
---

# Phase 9 Plan 02: Group Filter Tag Input and Trigger Operator Summary

**Group filter keywords replaced with createTagInput pill bubbles, per-group AND/OR trigger operator select with tooltip, triggerOperator persisted end-to-end from UI to SQLite**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-16T15:48:28Z
- **Completed:** 2026-03-16T15:52:56Z
- **Tasks:** 1 (+ 1 auto-approved checkpoint)
- **Files modified:** 2

## Accomplishments

- Plain text keyword input replaced with createTagInput pill bubble component in group filter override section
- Trigger operator AND/OR select added with tooltip explaining match behavior
- Per-group tag input instances stored in gfoTagInputs registry keyed by sanitized JID
- loadGroupFilter and saveGroupFilter updated to use tag input getValue/setValue and trigger operator select
- Backend PUT handler validates triggerOperator (must be OR or AND) and persists to SQLite
- GroupFilterOverride type extended with triggerOperator field, DB schema migrated with ALTER TABLE

## Task Commits

1. **Task 1: Replace group filter keywords with tag input and add trigger operator select** - `dd23033` (feat)

## Files Created/Modified

- `src/monitor.ts` - Added gfoTagInputs registry, replaced plain text input with tag input container, added trigger operator select HTML, updated loadGroupFilter/saveGroupFilter, backend handler accepts triggerOperator
- `src/directory.ts` - Added triggerOperator to GroupFilterOverride type, ALTER TABLE migration, updated getGroupFilterOverride/setGroupFilterOverride

## Decisions Made

- **Reused sfx for registry key:** The sanitized JID suffix already used for all DOM element IDs in buildGroupPanel is also used as the gfoTagInputs registry key, keeping consistent naming.
- **ALTER TABLE migration with try/catch:** SQLite does not support IF NOT EXISTS for ALTER TABLE ADD COLUMN. Wrapping in try/catch is the standard pattern — column-already-exists error is silently caught on subsequent startups.
- **triggerOperator defaults to OR:** Existing group filter overrides without triggerOperator get OR behavior by default, which matches the pre-existing any-keyword matching behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added triggerOperator to directory.ts type, schema, and persistence**
- **Found during:** Task 1 (Step 6)
- **Issue:** Plan mentioned updating the backend handler but the GroupFilterOverride type, SQLite schema, and get/set methods also needed the new field
- **Fix:** Added triggerOperator to GroupFilterOverride type, ALTER TABLE migration, updated getGroupFilterOverride to read trigger_operator column, updated setGroupFilterOverride to write it
- **Files modified:** src/directory.ts
- **Verification:** Full test suite passes (313 tests), backend handler correctly persists field
- **Committed in:** dd23033 (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added backend validation for triggerOperator**
- **Found during:** Task 1 (Step 6)
- **Issue:** Backend should validate triggerOperator values like it validates godModeScope
- **Fix:** Added validation that triggerOperator must be 'OR' or 'AND', returns 400 on invalid value
- **Files modified:** src/monitor.ts
- **Verification:** Validation block matches existing godModeScope pattern
- **Committed in:** dd23033 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both auto-fixes essential for end-to-end persistence. Plan mentioned updating the backend handler but full schema/type changes were implicit requirements.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Group filter override now uses tag input consistent with other Settings fields
- triggerOperator persisted and ready for use in message filtering logic if needed
- Full test suite green (313 tests, zero regressions)

---
*Phase: 09-settings-ux-improvements*
*Completed: 2026-03-16*
