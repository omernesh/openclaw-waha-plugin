---
phase: 27-pairing-cleanup-and-code-quality
plan: "02"
subsystem: admin-panel
tags: [theme, ux, log-export, code-quality]
dependency_graph:
  requires: []
  provides: [system-theme-detection, log-export]
  affects: [src/admin/src/hooks/useTheme.ts, src/admin/src/components/tabs/LogTab.tsx]
tech_stack:
  added: []
  patterns: [window.matchMedia, Blob/URL.createObjectURL]
key_files:
  modified:
    - src/admin/src/hooks/useTheme.ts
    - src/admin/src/components/tabs/LogTab.tsx
decisions:
  - useTheme falls back to prefers-color-scheme only when no localStorage value exists; stored user preference always wins
  - Log export uses lines from logData (server-filtered lines) so export respects active level/search filters
  - Export format is plain text (journalctl-compatible), no CSV
metrics:
  duration: "5m"
  completed: "2026-03-20"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
requirements:
  - CQ-04
  - CQ-05
---

# Phase 27 Plan 02: System Theme Detection and Log Export Summary

Admin panel now respects prefers-color-scheme on first load and has a download button that exports visible filtered log entries as a timestamped plain text file.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | System theme auto-detection via prefers-color-scheme (CQ-04) | edbd428 |
| 2 | Log tab export/download button (CQ-05) | fd1aa44 |

## Changes Made

### Task 1 — useTheme system detection (CQ-04)
`src/admin/src/hooks/useTheme.ts` — useState initializer now checks `window.matchMedia('(prefers-color-scheme: dark)').matches` when no localStorage value exists. Stored user preference (`'light'` or `'dark'`) still takes priority. Added CQ-04 marker comment.

### Task 2 — Log export button (CQ-05)
`src/admin/src/components/tabs/LogTab.tsx` — Added `Download` icon import, `handleExportLogs` callback that creates a `Blob` from `logData.lines`, triggers a `<a download>` click, and revokes the object URL. Button placed at the end of the toolbar row using the same `variant="ghost" size="icon"` pattern as other toolbar actions.

## Decisions Made

- System theme detection uses one-time check (no MediaQueryList listener) — user toggle button is the UX for runtime theme changes
- Export targets `logData?.lines` (the server-returned, already-filtered lines) so the download reflects whatever level filter and search is active
- Plain text format chosen to match journalctl output that operators are familiar with

## Deviations from Plan

None — plan executed exactly as written.

Pre-existing TypeScript errors in `ChannelsTab.tsx`, `ContactsTab.tsx`, and `DirectoryTab.tsx` were noted but are out of scope (not caused by this plan's changes). Logged to deferred-items if needed.

## Self-Check: PASSED

- src/admin/src/hooks/useTheme.ts — modified, contains `prefers-color-scheme`
- src/admin/src/components/tabs/LogTab.tsx — modified, contains `Download`, `handleExportLogs`, `Blob`
- Commits edbd428, fd1aa44 exist
- `npx tsc --noEmit` shows no errors in modified files
