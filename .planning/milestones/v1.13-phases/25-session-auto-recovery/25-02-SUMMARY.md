---
phase: 25-session-auto-recovery
plan: "02"
subsystem: admin-ui
tags: [admin-ui, dashboard, recovery, health]
dependency_graph:
  requires: [25-01]
  provides: [recovery-dashboard-ui]
  affects: [src/admin/src/types.ts, src/admin/src/components/tabs/DashboardTab.tsx]
tech_stack:
  added: []
  patterns: [conditional-render, two-line-card-layout]
key_files:
  created: []
  modified:
    - src/admin/src/types.ts
    - src/admin/src/components/tabs/DashboardTab.tsx
decisions:
  - Recovery info row rendered conditionally (only when recoveryAttemptCount > 0) to preserve clean UI for sessions with no recovery history
metrics:
  duration_seconds: 180
  completed_date: "2026-03-20"
  tasks_completed: 1
  files_modified: 2
---

# Phase 25 Plan 02: Dashboard Recovery UI Summary

**One-liner:** Dashboard health cards extended with two-line layout showing recovery attempt count, last timestamp, success/failed outcome badge, and cooldown indicator.

## What Was Built

- `src/admin/src/types.ts`: StatsResponse sessions array extended with 4 recovery fields: `recoveryAttemptCount: number`, `recoveryLastAttemptAt: number | null`, `recoveryLastOutcome: 'success' | 'failed' | null`, `recoveryInCooldown: boolean`.
- `src/admin/src/components/tabs/DashboardTab.tsx`: Session health card rows refactored from single flex row to two-line layout. Top line preserves existing elements (name, status badge, failure count, last check time) plus new cooldown badge. Second line appears only when `recoveryAttemptCount > 0`, showing attempt count, outcome badge (success=default/failed=destructive), and last attempt timestamp.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 05cb3d4 | feat(25-02): add recovery fields to types and Dashboard health cards |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/admin/src/types.ts` contains `recoveryAttemptCount`, `recoveryLastAttemptAt`, `recoveryLastOutcome`, `recoveryInCooldown`
- `src/admin/src/components/tabs/DashboardTab.tsx` contains all 4 recovery field references
- DashboardTab still contains `dmFilter` section and `Access Control` section (no regression)
- Pre-existing TS errors (ChannelsTab.tsx, ContactsTab.tsx, DirectoryTab.tsx) confirmed pre-existing — unchanged by this plan
- Commit 05cb3d4 verified in git log
