---
phase: 23-polish
plan: "01"
subsystem: admin-ui
tags: [ui-polish, error-boundaries, skeleton, toast, tooltip]
dependency_graph:
  requires: [22-02]
  provides: [skeleton-primitives, tooltip-primitives, tab-error-boundaries, toast-notifications]
  affects: [src/admin/src/App.tsx, src/admin/src/components/tabs/*, src/admin/src/components/ui/*]
tech_stack:
  added: [sonner (toast), @radix-ui/react-tooltip (already installed)]
  patterns: [React class component error boundary, Radix portal tooltips, shadcn Skeleton]
key_files:
  created:
    - src/admin/src/components/ui/skeleton.tsx
    - src/admin/src/components/ui/tooltip.tsx
    - src/admin/src/components/shared/TabErrorBoundary.tsx
  modified:
    - src/admin/src/App.tsx
    - src/admin/src/components/tabs/DashboardTab.tsx
    - src/admin/src/components/tabs/SettingsTab.tsx
    - src/admin/src/components/tabs/SessionsTab.tsx
    - src/admin/src/components/tabs/QueueTab.tsx
    - src/admin/src/components/tabs/ModulesTab.tsx
    - src/admin/src/components/tabs/LogTab.tsx
    - src/admin/src/components/tabs/DirectoryTab.tsx
decisions:
  - TabErrorBoundary uses key={refreshKey} so clicking Refresh in the header automatically resets any error state
  - DirectoryTab skeleton uses early return (loading && data === null) to show skeleton only on first load, not on pagination/search refetches
  - LogTab loading indicator replaced inline (within scrollable area) since the filter/search bar stays visible during refetch
metrics:
  duration_seconds: 271
  completed_date: "2026-03-18"
  tasks_completed: 2
  files_modified: 11
---

# Phase 23 Plan 01: Polish — Error Boundaries, Skeletons, Toasts, Tooltips Summary

**One-liner:** Skeleton loading placeholders, TabErrorBoundary isolation, Sonner toast notifications replacing alert() dialogs, and Radix portal Tooltip for overflow-safe rendering across all 7 admin panel tabs.

## What Was Built

### Task 1: UI Primitives and TabErrorBoundary

- **Skeleton** (`src/admin/src/components/ui/skeleton.tsx`): Standard shadcn Skeleton with `animate-pulse rounded-md bg-primary/10`, accepts className, exports named `Skeleton`.
- **Tooltip** (`src/admin/src/components/ui/tooltip.tsx`): Full Radix Tooltip wrapper with `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent`. Content renders via Radix portal — no overflow clipping.
- **TabErrorBoundary** (`src/admin/src/components/shared/TabErrorBoundary.tsx`): React class component error boundary. Shows card with AlertTriangle icon, error message, tab name heading, and Retry button that resets `hasError`. Uses `getDerivedStateFromError` + `componentDidCatch`.

### Task 2: Integration Across All Tabs

- **App.tsx**: Each tab wrapped in `<TabErrorBoundary key={refreshKey} tabName={activeTab}>` — error resets automatically when user clicks Refresh.
- **SettingsTab**: All 3 `alert()` calls replaced with `toast.error()`. Added `toast.success('Settings saved')` and `toast.success('Restarting gateway...')`. Loading state replaced with 3× `Skeleton h-[200px]` cards.
- **DashboardTab**: Loading state replaced with structured skeletons: 1 session health card (h-120), 2 filter cards side-by-side (h-80), 2 detail cards (h-100 each).
- **SessionsTab**: Loading state replaced with 2× `Skeleton h-[140px]` in a 2-column grid.
- **QueueTab**: Loading state replaced with 3× `Skeleton h-[80px]` in a grid.
- **ModulesTab**: Loading state replaced with 2× `Skeleton h-[100px]`.
- **LogTab**: Inline loading text inside scroll area replaced with 5 skeleton rows of varying widths.
- **DirectoryTab**: Added early-return skeleton (loading && data === null) with `h-[40px]` search bar + `h-[400px]` table area.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

Files created:
- src/admin/src/components/ui/skeleton.tsx — FOUND
- src/admin/src/components/ui/tooltip.tsx — FOUND
- src/admin/src/components/shared/TabErrorBoundary.tsx — FOUND

Commits:
- f199915 — feat(23-01): add Skeleton, Tooltip, and TabErrorBoundary UI primitives
- 8980ae1 — feat(23-01): wire error boundaries, skeleton loading, and toasts into all tabs

## Self-Check: PASSED
