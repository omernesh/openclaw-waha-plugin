---
phase: 64-multi-tenant
plan: "02"
subsystem: workspace-gateway
tags: [multi-tenant, routing, api-key, webhook, proxy, tdd]
dependency_graph:
  requires: [64-01]
  provides: [workspace-gateway, multi-tenant-boot]
  affects: [standalone.ts, monitor.ts]
tech_stack:
  added: []
  patterns: [LRU-cache, http-proxy, TDD-red-green]
key_files:
  created:
    - src/workspace-gateway.ts
    - src/workspace-gateway.test.ts
  modified:
    - src/standalone.ts
decisions:
  - "LRU cache (max 500, TTL 60s) wraps verifyApiKey — avoids per-request auth.db queries"
  - "Routing order: healthz → auth → webhook → api/v1 — prevents unauthenticated proxy access"
  - "401 vs 503 distinction: 401 = bad key, 503 = key valid but workspace crashed/starting"
  - "Webhook routing uses extractWorkspaceIdFromSession (ctl_{hex32}_ prefix) not auth"
  - "bootMultiTenant queries auth.db read-only for workspace discovery — no migration side effect"
metrics:
  duration: 341s
  completed: "2026-03-28"
  tasks_completed: 2
  files_changed: 3
---

# Phase 64 Plan 02: WorkspaceGateway — Parent Router Summary

**One-liner:** HTTP parent gateway with LRU-cached API key routing and session-prefix webhook routing to workspace child processes, with 401/503 guards and multi-tenant boot in standalone.ts.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | WorkspaceGateway + tests (TDD) | 7805013 |
| 2 | Wire multi-tenant mode into standalone.ts | 579bb60 |

## What Was Built

### src/workspace-gateway.ts

- `resolveWorkspaceFromKey(token)` — LRU cache (max 500, TTL 60s) + `auth.api.verifyApiKey` for API key → workspaceId resolution
- `proxyToWorkspace(req, res, port)` — streaming `node:http` proxy to child port, 502 on connection error
- `WorkspaceGateway` class — HTTP server routing:
  - `GET /healthz` — parent health (no auth, not proxied)
  - `/api/auth/*` — delegated to `toNodeHandler(auth.handler)` (parent handles auth)
  - `POST /webhook/waha` — session prefix extraction → child port → proxy
  - `/api/v1/*`, `/mcp` — Bearer token → workspaceId → child port → proxy
  - 401 for unknown/missing API key (before any proxy attempt)
  - 503 + `Retry-After: 30` for crashed/starting workspaces
  - 404 for everything else

### src/workspace-gateway.test.ts

11 unit tests covering:
- `resolveWorkspaceFromKey` cache hit/miss, invalid key, null result
- `/healthz` returns 200 without auth
- `/api/v1/*` — 401 on no header, 401 on invalid token, 503 on crashed workspace
- `/webhook/waha` — 404 on unknown session prefix, 404 when workspace port null
- Unknown routes — 404

### src/standalone.ts

- `CHATLYTICS_MULTI_TENANT=true` env var activates `bootMultiTenant()`
- `bootMultiTenant()`:
  1. `initAuthDb()` — parent owns auth.db exclusively
  2. Query auth.db: `SELECT DISTINCT workspaceId FROM user WHERE workspaceId IS NOT NULL`
  3. Create `WorkspaceProcessManager` with `entryPath` resolved via `fileURLToPath(import.meta.url)`
  4. Fork child process per discovered workspace with shared WAHA config
  5. Start `WorkspaceGateway` on configured port
  6. `SIGTERM/SIGINT` → `gateway.stop()` → `manager.stopAll()`
- Single-tenant path unchanged (wrapped in `else` branch)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data paths are wired.

## Self-Check: PASSED

- src/workspace-gateway.ts: FOUND
- src/workspace-gateway.test.ts: FOUND
- src/standalone.ts: modified, FOUND
- commit 7805013: FOUND
- commit 579bb60: FOUND
- grep WorkspaceGateway src/workspace-gateway.ts: matches
- grep resolveWorkspaceFromKey src/workspace-gateway.ts: matches
- grep proxyToWorkspace src/workspace-gateway.ts: matches
- grep extractWorkspaceIdFromSession src/workspace-gateway.ts: matches
- grep verifyApiKey src/workspace-gateway.ts: matches
- grep 401 src/workspace-gateway.ts: matches
- grep 503 src/workspace-gateway.ts: matches
- grep CHATLYTICS_MULTI_TENANT src/standalone.ts: 5 matches
- All 11 workspace-gateway tests passing
- Full suite: 1471 tests passing (5 pre-existing failures in other worktree, unrelated)
