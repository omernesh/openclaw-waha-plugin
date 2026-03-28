---
phase: 59-standalone-docker
plan: "01"
subsystem: standalone
tags: [docker, data-dir, health-route, sqlite, standalone]
dependency_graph:
  requires: []
  provides: [standalone-entrypoint, health-route, data-dir-utility]
  affects: [directory.ts, analytics.ts, mimicry-gate.ts, monitor.ts]
tech_stack:
  added: [src/data-dir.ts, src/standalone.ts]
  patterns: [env-var-override, graceful-shutdown, docker-healthcheck]
key_files:
  created:
    - src/data-dir.ts
    - src/standalone.ts
    - src/standalone.test.ts
  modified:
    - src/monitor.ts
    - src/directory.ts
    - src/analytics.ts
    - src/mimicry-gate.ts
decisions:
  - "getDataDir() returns CHATLYTICS_DATA_DIR env var or falls back to ~/.openclaw/data — backward compat preserved"
  - "standalone.ts calls monitorWahaProvider() directly — reuses existing HTTP server, no code duplication"
  - "/health route placed before /metrics and auth guard — public endpoint, no auth required"
  - "homedir import removed from directory.ts, analytics.ts, mimicry-gate.ts — getDataDir() handles all path logic"
metrics:
  duration: "~8 minutes"
  completed_date: "2026-03-28"
  tasks_completed: 2
  files_created: 3
  files_modified: 4
---

# Phase 59 Plan 01: Standalone Entry Point and Data Directory Utility Summary

Standalone HTTP server entry point with `getDataDir()` CHATLYTICS_DATA_DIR support and `/health` JSON route for Docker HEALTHCHECK.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create data-dir utility, /health route, standalone entry point | cecb283 | src/data-dir.ts, src/standalone.ts, src/monitor.ts, src/standalone.test.ts |
| 2 | Wire CHATLYTICS_DATA_DIR into all SQLite DB singletons | 3ae83b6 | src/directory.ts, src/analytics.ts, src/mimicry-gate.ts |

## What Was Built

### src/data-dir.ts
`getDataDir()` utility that returns `CHATLYTICS_DATA_DIR` env var or falls back to `~/.openclaw/data`. Single source of truth for all SQLite database paths — Docker containers set this to the volume mount path.

### src/standalone.ts
Standalone entry point that boots the webhook HTTP server without any OpenClaw gateway dependency. Reads config via `getConfigPath()` (honours `CHATLYTICS_CONFIG_PATH`), ensures data dir exists, calls `monitorWahaProvider()`, and wires `SIGTERM`/`SIGINT` for graceful Docker shutdown.

### /health route in monitor.ts
`GET /health` returns `{ status: "ok", webhook_registered: boolean }` as JSON. Checks all enabled WAHA accounts — `webhook_registered` is `true` only if all sessions have self-registered their webhook URL. Placed before auth guard (public endpoint, no token required).

### SQLite DB Singletons Updated
- `src/directory.ts` — `getDirectoryDb()` uses `getDataDir()` for both default and tenant paths
- `src/analytics.ts` — `getAnalyticsDb()` uses `getDataDir()`
- `src/mimicry-gate.ts` — `getMimicryDb()` uses `getDataDir()`

## Test Results

- 3 new tests in `src/standalone.test.ts` — all pass
- 460 tests in `src/` test files — all pass
- Pre-existing failures in `.claude/worktrees/agent-af2c625d/` (other parallel agent) — unrelated

## Decisions Made

1. **getDataDir fallback path** — `~/.openclaw/data` (not `~/.chatlytics/data`) to preserve backward compat with hpg6 existing databases.
2. **standalone.ts calls monitorWahaProvider directly** — no code duplication, same HTTP server used standalone as in OpenClaw gateway mode.
3. **/health is public (before auth guard)** — Docker HEALTHCHECK cannot pass API tokens; placed before `requireAdminAuth` block.
4. **homedir removed from DB files** — `getDataDir()` is now the single source of truth; old `homedir()` calls removed from all three files.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- src/data-dir.ts: exists, exports getDataDir
- src/standalone.ts: exists, calls monitorWahaProvider, SIGTERM wired
- src/standalone.test.ts: exists, 3 tests passing
- /health route: confirmed in monitor.ts at line ~515
- getDataDir in directory.ts, analytics.ts, mimicry-gate.ts: confirmed
- Old homedir paths removed from all three DB files: confirmed (0 occurrences)
- Commits c09fa34, cecb283, 3ae83b6: all present
