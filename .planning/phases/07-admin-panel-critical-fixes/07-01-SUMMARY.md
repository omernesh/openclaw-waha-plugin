---
phase: 07-admin-panel-critical-fixes
plan: 01
subsystem: admin-panel
tags: [admin-panel, reliability, ux, error-handling]
dependency_graph:
  requires: []
  provides: [save-restart-polling-overlay, group-filter-timeout-fallback]
  affects: [src/monitor.ts]
tech_stack:
  added: []
  patterns: [polling-loop, abort-controller-timeout, dom-element-creation]
key_files:
  created: []
  modified:
    - src/monitor.ts
decisions:
  - "DOM element creation (appendChild) instead of innerHTML to avoid XSS security hook"
  - "pollUntilReady uses simple counter variable (not Date.now()) for elapsed time tracking"
  - "AbortController 10s timeout on saveGroupFilter to surface hung requests as clear error"
  - "listEnabledWahaAccounts fallback to primary account prevents 502 from config resolution crashes"
metrics:
  duration: 8min
  completed: "2026-03-16"
  tasks_completed: 2
  files_modified: 1
---

# Phase 07 Plan 01: Admin Panel Critical Fixes (AP-01 + AP-03) Summary

**One-liner:** Replaced blind 5s reload with polling overlay for Save & Restart, and added AbortController timeout + server fallback for Group Filter Override saves.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Fix Save & Restart polling overlay (AP-01) | 6c566de | src/monitor.ts |
| 2 | Fix Group Filter Override 502 error handling (AP-03) | f1c5d8a | src/monitor.ts |

## What Was Built

### Task 1: Save & Restart Polling Overlay (AP-01)

Replaced the broken `saveAndRestart()` function that used a blind 5-second `setTimeout` (causing Cloudflare 502 when restart took >5s) with a full polling approach:

- Fullscreen overlay (z-index: 99999) with CSS spinner, shown immediately after calling restart
- `pollUntilReady(elapsed)` function polls `/api/admin/stats` every 3 seconds
- On HTTP 200 response: removes overlay and calls `location.reload()`
- On failure: increments counter, updates status text "Waiting for server... Xs elapsed"
- After 60 seconds: shows "Gateway did not respond within 60s" message + manual refresh button
- Used DOM element creation (appendChild) instead of innerHTML to pass security hooks

### Task 2: Group Filter Override 502 Fix (AP-03)

Fixed two root causes of the 502 error when toggling the "Override global filter" checkbox:

**Server-side (PUT handler):**
- Added `console.log('[waha] PUT group filter override for', jid)` for debug visibility
- Wrapped `listEnabledWahaAccounts(opts.config)` in try/catch with fallback to `opts.accountId` if it throws (handles config structure issues that previously caused the handler to crash without sending a response)

**Client-side (saveGroupFilter):**
- Added `AbortController` with 10-second timeout — request aborts rather than hanging indefinitely
- Distinguished `AbortError` (timeout) from other errors with targeted toast messages
- Disabled checkbox during save to prevent double-click submissions
- Shows "Saving..." toast while request is in flight

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Used DOM element creation instead of innerHTML**
- **Found during:** Task 1 implementation
- **Issue:** Security reminder hook blocked `innerHTML` usage for overlay creation
- **Fix:** Rewrote overlay creation using `document.createElement`, `textContent`, and `appendChild` — safer and functionally identical
- **Files modified:** src/monitor.ts
- **Commit:** 6c566de

None other — plan executed as written.

## Verification Results

- `grep -c "pollUntilReady" src/monitor.ts` → 5 (>= 1 required)
- `grep -c "Restarting" src/monitor.ts` → 2 (>= 2 required)
- `grep "setTimeout.*location.reload.*5000" src/monitor.ts` → no matches (good)
- `grep -c "60" src/monitor.ts` → 17 (includes the 60-second timeout)
- `grep -c "AbortController" src/monitor.ts` → 2 (>= 1 required)
- `grep -c "listEnabledWahaAccounts" src/monitor.ts` → 6 (>= 1 required)
- `grep "fallback to primary" src/monitor.ts` → 2 matches (>= 1 required)
- `grep -c "PUT group filter override" src/monitor.ts` → 1 (>= 1 required)

## Self-Check: PASSED

Files modified:
- [x] src/monitor.ts exists and contains pollUntilReady, AbortController, and fallback to primary account

Commits:
- [x] 6c566de — feat(07-01): fix Save & Restart with polling overlay (AP-01)
- [x] f1c5d8a — feat(07-01): fix Group Filter Override 502 with error handling (AP-03)
