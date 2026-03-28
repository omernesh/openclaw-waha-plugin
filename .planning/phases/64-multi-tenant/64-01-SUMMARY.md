---
phase: 64-multi-tenant
plan: "01"
subsystem: workspace-isolation
tags: [multi-tenant, child-process, isolation, tdd]
dependency_graph:
  requires: []
  provides: [workspace-manager, workspace-entry, TENANT-01, TENANT-02, TENANT-03]
  affects: [src/monitor.ts]
tech_stack:
  added: [node:child_process.fork, IPC messaging]
  patterns: [process-per-tenant, exponential-backoff, dependency-injection]
key_files:
  created:
    - src/workspace-manager.ts
    - src/workspace-entry.ts
    - src/workspace-manager.test.ts
  modified:
    - src/monitor.ts
decisions:
  - "DI forkFn param in WorkspaceManagerOptions for test isolation without spawning real processes"
  - "session name format ctl_{hex32}_{baseName} strips UUID hyphens to fit clean WAHA session namespace"
  - "initAuthDb() guarded by !CHATLYTICS_WORKSPACE_ID in monitor.ts start() — children must not open auth.db"
  - "dynamic port discovery via temporary HTTP server binding to port 0 on 127.0.0.1"
  - "exponential backoff formula Math.min(1000 * 2**restartCount, 30_000) — matches webhook-forwarder pattern"
metrics:
  duration: "10m 9s"
  completed: "2026-03-28T17:20:25Z"
  tasks_completed: 2
  files_changed: 4
requirements_addressed: [TENANT-01, TENANT-02, TENANT-03]
---

# Phase 64 Plan 01: WorkspaceProcessManager + Child Entry Point Summary

**One-liner:** Per-workspace child process isolation with CHATLYTICS_DATA_DIR scoping, ctl_{hex32} WAHA session namespacing, and exponential backoff restart.

## What Was Built

### Task 1: WorkspaceProcessManager + session name utilities + tests (TDD)

`src/workspace-manager.ts` — WorkspaceProcessManager class and session name utilities:

- `buildWorkspaceSessionName(uuid, base)` strips UUID hyphens, returns `ctl_{hex32}_{base}`
- `extractWorkspaceIdFromSession(name)` regex-extracts and reconstructs UUID with hyphens
- `WorkspaceProcessManager` forks children with workspace-scoped env vars via DI `_forkFn`
- `startWorkspace()` is idempotent — no-op if already registered
- IPC `{ type: "ready", port }` handler sets entry status to "ready" and records port
- Exit handler sets status "crashed", port null, schedules restart with `Math.min(1000 * 2**n, 30_000)`
- `stopAll()` sends `{ type: "shutdown" }` to all children, kills after 5s
- `listWorkspaces()`, `getPort()`, `getStatus()` for runtime inspection

`src/workspace-manager.test.ts` — 28 unit tests covering all behaviors:
- Session name roundtrip (buildWorkspaceSessionName / extractWorkspaceIdFromSession)
- Fork env vars (CHATLYTICS_DATA_DIR, CHATLYTICS_WORKSPACE_ID, CHATLYTICS_PORT)
- IPC ready signal → port/status tracking
- Crash handling (status=crashed, port=null)
- Exponential backoff restart scheduling with fake timers
- Crash isolation: workspace A crash does not affect workspace B
- stopAll sends shutdown to all children

### Task 2: Workspace child entry point

`src/workspace-entry.ts` — child process entry point for each workspace:
- Guards on `CHATLYTICS_WORKSPACE_ID` presence (exits if not set — must be run via manager)
- `findFreePort()` binds temporary HTTP server to port 0, reads assigned port, closes
- `prefixSessionNames()` rewrites WAHA account session names to `ctl_{hex32}_{base}` format
- Overrides `cfg.waha.webhookPort` with dynamic port before calling monitorWahaProvider
- After monitorWahaProvider resolves: calls `process.send?.({ type: "ready", port })`
- Listens for IPC `{ type: "shutdown" }` → calls stop() + process.exit(0)
- SIGTERM/SIGINT handlers for Docker/shell shutdown

`src/monitor.ts` — guarded initAuthDb() call:
- Added `if (!process.env.CHATLYTICS_WORKSPACE_ID)` guard around `initAuthDb()` in `start()`
- Workspace children skip auth.db initialization — auth routes are parent-only

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test path separator mismatch on Windows**
- **Found during:** Task 1 test run (GREEN phase)
- **Issue:** Test expected `/data/workspaceId` (POSIX) but `path.join` on Windows produces `\data\workspaceId`
- **Fix:** Changed test assertion to use `join(BASE_DATA_DIR, WORKSPACE_ID)` from node:path
- **Files modified:** src/workspace-manager.test.ts
- **Commit:** e9ee4d5

**2. [Rule 1 - Bug] stopAll test timed out with fake timers**
- **Found during:** Task 1 test run (GREEN phase)
- **Issue:** `stopAll()` has internal 5s `setTimeout` that doesn't advance with `vi.useFakeTimers()` unless explicitly triggered
- **Fix:** Test now calls `vi.advanceTimersByTime(6_000)` before awaiting stopAll promise
- **Files modified:** src/workspace-manager.test.ts
- **Commit:** e9ee4d5

## Verification Results

```
src/workspace-manager.test.ts: 28/28 tests passed
Full suite: 1460/1460 tests passed (5 pre-existing worktree failures excluded)
grep buildWorkspaceSessionName src/workspace-manager.ts: 3 matches
grep extractWorkspaceIdFromSession src/workspace-manager.ts: 2 matches
grep WorkspaceProcessManager src/workspace-manager.ts: 4 matches
grep CHATLYTICS_DATA_DIR src/workspace-manager.ts: 7 matches
grep CHATLYTICS_WORKSPACE_ID src/workspace-manager.ts: 5 matches
grep CHATLYTICS_DATA_DIR src/workspace-manager.ts: present
grep ctl_ src/workspace-manager.ts: present
```

## Known Stubs

None — all functionality is implemented. workspace-entry.ts wires directly to monitorWahaProvider with no placeholder paths.

## Self-Check: PASSED
