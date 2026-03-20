---
phase: 31-test-coverage-sprint
plan: "02"
subsystem: testing
tags: [tests, monitor, inbound, vitest, coverage]
dependency_graph:
  requires: []
  provides: [monitor-tests, inbound-tests]
  affects: [src/monitor.ts, src/inbound.ts]
tech_stack:
  added: []
  patterns: [vitest, vi.mock, mock-req-res, server-emit-request]
key_files:
  created:
    - src/monitor.test.ts
    - src/inbound.test.ts
  modified:
    - src/monitor.ts
decisions:
  - "Use server.emit('request', req, res) pattern to test createWahaWebhookServer routes without starting HTTP server"
  - "callRoute resolves when res.end() is called — avoids fixed timeouts for async routes"
  - "InboundQueue mock uses class syntax (not vi.fn().mockImplementation) because it's used with 'new'"
  - "readBody injected via opts.readBody so webhook body can be controlled per-test"
  - "DmFilter exported directly from dm-filter.ts for instanceof assertions in inbound tests"
metrics:
  duration_minutes: 25
  completed_date: "2026-03-20"
  tasks_completed: 2
  files_modified: 3
---

# Phase 31 Plan 02: Monitor + Inbound Test Suites Summary

Test suites for the two largest untested modules: monitor.ts (admin API routes) and inbound.ts (message pipeline).

## Completed Tasks

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | monitor.ts admin API route tests | 0cb395b | src/monitor.test.ts, src/monitor.ts |
| 2 | inbound.ts pipeline tests | f25bc81 | src/inbound.test.ts |

## Test Coverage

### src/monitor.test.ts — 25 tests, 694 lines

Covers:
- `readWahaWebhookBody` — delegates to SDK readRequestBodyWithLimit
- `broadcastSSE` — no-op with zero clients
- Admin API routes:
  - GET /healthz
  - GET /api/admin/health
  - GET /api/admin/queue
  - GET /api/admin/recovery
  - GET /api/admin/config
  - POST /api/admin/config (valid + 400 validation failure)
  - GET /api/admin/sessions
  - GET /api/admin/directory (list + type filter)
  - GET /api/admin/directory/:jid (found + 404)
  - PUT /api/admin/directory/:jid/settings
  - GET /api/admin/analytics
  - POST /api/admin/restart
  - GET /api/admin/modules
  - GET /api/admin/stats
  - GET /api/admin/directory/group/:groupJid/participants
  - POST /api/admin/config/import
  - Catch-all 404
  - Webhook POST processing (queued, ignored-session, ignored-fromMe)

### src/inbound.test.ts — 20 tests, 582 lines

Covers:
- `getDmFilterForAdmin` — singleton, keyword match, disabled, drop
- `getGroupFilterForAdmin` — default patterns, keyword drop
- `handleWahaInbound`:
  - fromMe message (bot role) → claim attempted
  - Cross-session dedup: already-claimed → skip, claimed → process
  - Empty body → early return
  - DM filtering: allowed sender → SDK deliverer reached
  - Group filter: keyword miss → drop, keyword hit → allow
  - Muted group → drop
  - /shutup command: authorized → intercepted, unauthorized → not intercepted
  - Media message → preprocessInboundMessage called
  - allowedGroups: group not in list → drop

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed url.pathname reference error in /api/admin/presence route**
- **Found during:** Task 1 — running monitor tests
- **Issue:** `url.pathname` referenced a `url` variable that was block-scoped to the `/api/admin/directory` if-block. Outside that block, `url` was undefined, causing a ReferenceError when requests fell through to the presence route.
- **Fix:** Changed `if (url.pathname === "/api/admin/presence"` to `if (req.url === "/api/admin/presence"` in src/monitor.ts
- **Files modified:** src/monitor.ts (line 1869)
- **Commit:** 0cb395b

## Self-Check: PASSED

- [x] src/monitor.test.ts exists (694 lines, ≥150 required)
- [x] src/inbound.test.ts exists (582 lines, ≥100 required)
- [x] 48 describe/it blocks in monitor.test.ts (≥15 required)
- [x] 32 describe/it blocks in inbound.test.ts (≥10 required)
- [x] `/api/admin/` appears 34 times in monitor.test.ts
- [x] `handleWahaInbound` appears 17 times in inbound.test.ts
- [x] `getDmFilterForAdmin`/`getGroupFilterForAdmin` appear 15 times in inbound.test.ts
- [x] All 45 tests pass: `npx vitest run src/monitor.test.ts src/inbound.test.ts` exits 0
- [x] Commits 0cb395b and f25bc81 exist
