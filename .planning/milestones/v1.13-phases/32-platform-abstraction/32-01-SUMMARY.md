---
phase: 32-platform-abstraction
plan: "01"
subsystem: api-client
tags: [refactor, waha-client, send-ts, platform-abstraction]
dependency_graph:
  requires: [src/http-client.ts, src/accounts.ts]
  provides: [src/waha-client.ts]
  affects: [src/send.ts]
tech_stack:
  added: []
  patterns: [stateful-client, factory-method, module-cache]
key_files:
  created:
    - src/waha-client.ts
  modified:
    - src/send.ts
key_decisions:
  - "WahaClient cache keyed by accountId (no TTL) — accounts don't change within a session; clearWahaClientCache() for hot-reload"
  - "resolveAccountParams kept as deprecated shim (not called) — safer than removing for now"
  - "assertCanSend added to mutation-only paths in refactored functions; read-only functions (getWahaGroups, getWahaContacts, etc.) do NOT call assertCanSend"
  - "getWahaContacts uses client.get with session as query param, NOT path segment — DO NOT CHANGE comment preserved"
  - "Pre-existing read-messages test failure confirmed unrelated to this refactor (fails on stashed state too)"
metrics:
  duration_minutes: 12
  completed_date: "2026-03-20"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
  files_created: 1
---

# Phase 32 Plan 01: WahaClient Platform Abstraction Summary

WahaClient class extracted from send.ts into new src/waha-client.ts — stateful config object encapsulating baseUrl/apiKey/session per account, with cached instances and typed HTTP convenience methods.

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Create WahaClient class | 53354c3 | Done |
| 2 | Refactor send.ts to use WahaClient | c30ad8b | Done |

## What Was Built

### src/waha-client.ts (new, 170 lines)

- `WahaClient` class: readonly `baseUrl`, `apiKey`, `session`, `accountId` properties
- `request()` — core method delegating to `callWahaApi()` (inherits timeout, rate limiting, dedup)
- `get()`, `post()`, `put()`, `del()` — HTTP convenience methods
- `sessionPath(template)` — replaces `{session}` with `encodeURIComponent(this.session)`
- `static fromAccount(account: ResolvedWahaAccount)` — factory from resolved account
- `getWahaClient(cfg, accountId?)` — module-level cache function (keyed by accountId)
- `clearWahaClientCache()` — for config hot-reload and tests

### src/send.ts (refactored)

- Import added: `getWahaClient, type WahaClient` from `./waha-client.js`
- `getClient(cfg, accountId?)` — internal thin wrapper around `getWahaClient()`
- `resolveSessionPath()` — now delegates to `getClient(...).sessionPath()`
- `resolveAccountParams()` — kept as deprecated shim (no callers remain)
- All ~115 `callWahaApi()` direct calls replaced with `client.get/post/put/del`
- All `resolveWahaAccount()` direct usages in send functions replaced with `getClient()`
- `assertCanSend` preserved on all mutation-path functions

## Acceptance Criteria

- `grep -c "export class WahaClient" src/waha-client.ts` → 1
- `grep -c "export function getWahaClient" src/waha-client.ts` → 1
- `grep -c "callWahaApi" src/waha-client.ts` → 4 (import + 1 call in request())
- `grep -c "fromAccount" src/waha-client.ts` → 2 (definition + usage in getWahaClient)
- `grep -c "getClient\|getWahaClient" src/send.ts` → 116
- `grep -c "callWahaApi" src/send.ts` → 4 (import line + 3 comment lines only, 0 function calls)
- `npx tsc --noEmit` → passes
- 525/526 tests pass (1 pre-existing failure in read-messages.test.ts unrelated to this plan)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Added assertCanSend to newly-migrated mutation functions**
- Found during: Task 2
- Issue: When migrating from `resolveAccountParams` (which called `assertCanSend` internally) to `getClient` (which does not), mutation functions would lose the listener-session guard
- Fix: Explicitly added `assertCanSend(client.session, params.cfg)` to all mutation-path functions during migration
- Files modified: src/send.ts

**2. [Rule 1 - Bug] getWahaContacts session query param preserved correctly**
- Found during: Task 2
- Issue: Original code used `?session=${session}` as a query string appended to the path. Migrating to `client.get()` with a `query` param object is the correct equivalent and avoids double-encoding
- Fix: Used `client.get('/api/contacts/all', { session: client.session })` — maps correctly to the query param form

## Self-Check: PASSED
