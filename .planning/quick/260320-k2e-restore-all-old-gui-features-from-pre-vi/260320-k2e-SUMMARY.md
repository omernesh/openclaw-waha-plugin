---
phase: quick
plan: 260320-k2e
subsystem: admin-ui
tags: [directory, groups, filter-override, react]
dependency_graph:
  requires: []
  provides: [GroupFilterOverride component, per-group filter UI]
  affects: [ParticipantRow, DirectoryTab]
tech_stack:
  added: []
  patterns: [ContactSettingsSheet styling, TagInput freeform, Switch/Select/Tooltip]
key_files:
  created:
    - src/admin/src/components/tabs/directory/GroupFilterOverride.tsx
  modified:
    - src/admin/src/types.ts
    - src/admin/src/components/tabs/directory/ParticipantRow.tsx
decisions:
  - godModeScope maps '' <-> null (Select cannot hold null directly)
  - mentionPatterns sent as null when empty (not []) — server distinguishes
  - Override panel uses border/rounded-md/p-4/mb-3 to visually separate from participant list
metrics:
  duration: ~5 min
  completed: "2026-03-20"
  tasks_completed: 1
  files_changed: 3
---

# Quick Task 260320-k2e: Restore Per-Group Filter Override UI

Per-group filter override panel restored in the React admin panel. GroupFilterOverride component renders above the participant list when any group row is expanded in Directory > Groups.

## What Was Built

`GroupFilterOverride` component that:
- Fetches current override state on mount via `api.getGroupFilter(groupJid)`
- Override Enabled toggle — when OFF shows "Inheriting global filter settings"
- When ON reveals: Filter Enabled switch, Trigger Operator (OR/AND), Mention Patterns (TagInput freeform), God Mode Scope (Select)
- Save button calls `api.updateGroupFilter` with typed payload
- Follows ContactSettingsSheet pattern: Tip tooltips, space-y-4 spacing, Switch/Select/Button/Label

`GroupFilterOverrideData` interface added to types.ts to type-cast the `Record<string, unknown>` override field from the API response.

`ParticipantRow` updated: one import line + one JSX render line inserted before the Allow All toggle — zero changes to existing participant logic.

## Commits

| Hash | Message |
|------|---------|
| 9a0d101 | feat(260320-k2e): add per-group filter override UI to Directory tab |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- GroupFilterOverride.tsx: FOUND
- ParticipantRow.tsx updated: FOUND (GroupFilterOverride import + render)
- types.ts GroupFilterOverrideData: FOUND
- Build: PASSED (dist/admin built in 1.16s)
- TypeScript errors in modified files: 0
