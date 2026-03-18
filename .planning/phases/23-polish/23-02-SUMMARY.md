---
phase: 23-polish
plan: "02"
subsystem: admin-ui
tags: [react, ux, loading-state, spinner]
dependency_graph:
  requires: [23-01]
  provides: [refresh-spinner, last-refreshed-timestamp]
  affects: [TabHeader, App, all-7-tabs]
tech_stack:
  added: []
  patterns: [loading-state-lifting, callback-prop, useEffect-reporter]
key_files:
  created: []
  modified:
    - src/admin/src/components/TabHeader.tsx
    - src/admin/src/App.tsx
    - src/admin/src/components/tabs/DashboardTab.tsx
    - src/admin/src/components/tabs/SettingsTab.tsx
    - src/admin/src/components/tabs/SessionsTab.tsx
    - src/admin/src/components/tabs/QueueTab.tsx
    - src/admin/src/components/tabs/ModulesTab.tsx
    - src/admin/src/components/tabs/LogTab.tsx
    - src/admin/src/components/tabs/DirectoryTab.tsx
decisions:
  - "onLoadingChange is optional (?) on all tab props — tabs work standalone without a parent wiring it"
  - "lastRefreshed shown as toLocaleTimeString (HH:MM:SS), hidden on mobile (hidden sm:inline)"
  - "Refresh button disabled during isRefreshing to prevent double-refresh"
metrics:
  duration: "4 minutes"
  completed: "2026-03-18"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 9
requirements: [PLSH-04]
---

# Phase 23 Plan 02: Refresh Spinner and Timestamp Summary

**One-liner:** Refresh button spins via animate-spin during fetch and shows a "Last refreshed HH:MM:SS" timestamp driven by loading state lifted from all 7 tabs.

## What Was Built

Added visual feedback to the TabHeader refresh button:

1. **Spinner** — `RefreshCw` icon gets `animate-spin` class while any tab is loading. Button is also disabled during loading to prevent double-refresh.
2. **Timestamp** — After the first refresh completes, a `toLocaleTimeString()` timestamp appears next to the button (hidden on mobile via `hidden sm:inline`).
3. **Loading state propagation** — All 7 tab components now accept an optional `onLoadingChange?: (loading: boolean) => void` prop. Each tab adds a `useEffect` that calls it whenever its `loading` state changes.
4. **App.tsx wiring** — Two new state variables (`isRefreshing`, `lastRefreshed`) managed by `handleTabLoadingChange` callback (via `useCallback`). Both passed as new props to `TabHeader`. `onLoadingChange` threaded into all tabs via the shared `props` object in `renderActiveTab()`.

## Implementation Pattern

Each tab follows the same minimal addition:
```tsx
// In props interface
onLoadingChange?: (loading: boolean) => void

// In component body (after loading state declaration)
useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])
```

No existing loading logic was modified in any tab.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `grep "animate-spin" TabHeader.tsx` — confirmed
- `grep "lastRefreshed" TabHeader.tsx` — confirmed
- `grep -r "onLoadingChange" src/admin/src/components/tabs/` — 21 matches across all 7 tabs
- `cd src/admin && npx vite build` — succeeded in 1.04s

## Self-Check: PASSED

- `src/admin/src/components/TabHeader.tsx` — FOUND
- `src/admin/src/App.tsx` — FOUND
- All 7 tab files — FOUND
- Commit `10013db` — FOUND
