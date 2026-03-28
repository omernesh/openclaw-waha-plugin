---
phase: 63-dashboard-auth
plan: "01"
subsystem: auth
tags: [better-auth, sqlite, authentication, api-keys, monitor]
dependency_graph:
  requires: []
  provides: [auth-endpoints, initAuthDb, better-auth-instance]
  affects: [src/monitor.ts, vite.admin.config.ts]
tech_stack:
  added: [better-auth@1.5.6, "@better-auth/api-key@1.5.6"]
  patterns: [betterAuth-sqlite-adapter, toNodeHandler-raw-node-http, getMigrations-startup]
key_files:
  created: [src/auth.ts]
  modified: [src/monitor.ts, package.json, vite.admin.config.ts]
decisions:
  - "Split authConfig from betterAuth() call so getMigrations() can reuse the same config object"
  - "Import path for getMigrations is better-auth/db/migration (not better-auth/db)"
  - "initAuthDb() called in monitor start() before server.listen to guarantee tables exist"
  - "trustedOrigins includes localhost:5173 alongside CHATLYTICS_ORIGIN for dev server without proxy"
metrics:
  duration: 21m
  completed_date: "2026-03-28T16:17:42Z"
  tasks_completed: 2
  files_changed: 4
requirements: [AUTH-01, AUTH-02]
---

# Phase 63 Plan 01: better-auth Server-Side Plumbing Summary

**One-liner:** better-auth 1.5.6 with emailAndPassword + apiKey plugins, SQLite at data dir, wired into monitor.ts via toNodeHandler before body reading, workspaceId auto-assigned on registration.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install better-auth and create auth module | 41260a0 | src/auth.ts, package.json, package-lock.json |
| 2 | Wire /api/auth/* into monitor.ts | a4e6cda | src/monitor.ts, vite.admin.config.ts |

## What Was Built

### src/auth.ts
- `betterAuth()` instance with `emailAndPassword: { enabled: true }` and `apiKey({ defaultPrefix: "ctl_" })`
- SQLite database at `getDataDir()/auth.db` — opened once at module scope, same pattern as `getDirectoryDb`
- `workspaceId` as `user.additionalFields` — assigned via `databaseHooks.user.create.after` using `crypto.randomUUID()`
- `trustedOrigins`: `CHATLYTICS_ORIGIN ?? http://localhost:8050` plus `http://localhost:5173` for dev
- `initAuthDb()` — calls `getMigrations(authConfig).runMigrations()` on startup; creates user, session, account, verification, apikey tables

### src/monitor.ts
- Imports `toNodeHandler` from `better-auth/node` and `{ auth, initAuthDb }` from `./auth.js`
- `initAuthDb()` called in `start()` before `server.listen()` — tables guaranteed to exist before any request
- `/api/auth/*` route mounted AFTER `handleCorsPreflightIfNeeded` and BEFORE `/mcp` block — critical ordering to avoid body consumption

### vite.admin.config.ts
- Added `server.proxy: { '/api': 'http://localhost:8050' }` — prevents 404/CORS on auth calls during `npm run dev:admin`

## Verification

- `grep -c "toNodeHandler" src/monitor.ts` = 2 (import + usage)
- `grep -n "api/auth" src/monitor.ts` shows route at line 618, before `/mcp` at line 627
- `npm ls better-auth` = `better-auth@1.5.6`
- `npx tsc --noEmit --skipLibCheck` — zero errors
- `npx vitest run` — 1407 tests pass, 0 regressions (6 pre-existing worktree path failures unaffected)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] getMigrations import path corrected**
- **Found during:** Task 1
- **Issue:** Plan specified `import("better-auth/db")` but `getMigrations` lives at `better-auth/db/migration` per actual package.json exports
- **Fix:** Used `better-auth/db/migration` import path; verified via package.json exports map
- **Files modified:** src/auth.ts
- **Commit:** 41260a0

**2. [Rule 1 - Bug] authConfig extracted from betterAuth() call**
- **Found during:** Task 1
- **Issue:** `getMigrations` takes `BetterAuthOptions` directly; `auth.options` is not the public config shape
- **Fix:** Named `authConfig` constant passed to both `betterAuth()` and `getMigrations()`
- **Files modified:** src/auth.ts
- **Commit:** 41260a0

**3. [Rule 3 - Blocking] npm install required --legacy-peer-deps**
- **Found during:** Task 1
- **Issue:** Peer dependency conflict prevented `npm install better-auth @better-auth/api-key`
- **Fix:** Added `--legacy-peer-deps` flag; installed successfully at v1.5.6
- **Commit:** 41260a0

## Known Stubs

None — this plan delivers server-side plumbing only. No UI stubs. The `/api/auth/*` endpoints are fully functional once the gateway starts.

## Self-Check: PASSED
