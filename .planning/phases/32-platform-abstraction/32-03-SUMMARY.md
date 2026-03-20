---
phase: 32-platform-abstraction
plan: "03"
subsystem: database
tags: [multi-tenancy, directory, accounts, platform-abstraction, tenant-isolation]

requires:
  - phase: 32-01
    provides: WahaClient and accounts.ts ResolvedWahaAccount type

provides:
  - tenantId parameter in getDirectoryDb (directory.ts)
  - tenantId field on ResolvedWahaAccount (accounts.ts)
  - tenantId threading through resolveWahaAccount, listEnabledWahaAccounts, resolveSessionForTarget
  - _tenantId module var and getTenantId() export in channel.ts

affects: [src/directory.ts, src/accounts.ts, src/channel.ts]

tech-stack:
  added: []
  patterns: [tenant-isolation, default-tenant-compat, optional-parameter-threading]

key-files:
  created: []
  modified:
    - src/directory.ts
    - src/accounts.ts
    - src/channel.ts

key-decisions:
  - "Default tenant 'default' uses legacy DB path (no subdirectory) — no migration required for existing installs"
  - "Non-default tenants get isolated subdirectories: ~/.openclaw/data/<tenant>/waha-directory-<accountId>.db"
  - "Cache key changed from safeId to 'safeTenant:safeId' to allow same accountId in different tenants"
  - "tenantId extracted from coreCfg.channels.waha.tenantId in handleAction — config-driven, not call-site-driven"

patterns-established:
  - "Optional tenantId with 'default' fallback: all existing callers untouched, new callers opt-in"

requirements-completed: [PLAT-03]

duration: 10min
completed: "2026-03-20"
---

# Phase 32 Plan 03: Tenant ID Threading Summary

**tenantId parameter threaded through directory.ts, accounts.ts, and channel.ts — isolated DB paths per tenant with full backward compat for 'default' tenant**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-20T09:15:00Z
- **Completed:** 2026-03-20T09:25:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `getDirectoryDb` accepts optional `tenantId` (default: `"default"`); cache key is now `tenant:accountId`
- Default tenant uses legacy flat path — no migration needed for existing installations
- `ResolvedWahaAccount` gains `tenantId` field; all resolution functions thread it through
- `channel.ts` reads `tenantId` from plugin config and stores in `_tenantId`; `getTenantId()` exported
- Two isolated instances in the same process (different tenants) return different DB instances
- 525/526 tests pass (1 pre-existing read-messages failure unrelated to this plan)

## Task Commits

1. **Task 1: Thread tenantId through directory.ts** - `7316a85` (feat)
2. **Task 2: Thread tenantId through accounts.ts and channel.ts** - `a5281c8` (feat)

## Files Created/Modified

- `src/directory.ts` — `getDirectoryDb` updated: optional `tenantId` param, composite cache key, tenant-specific DB subdirectory for non-default tenants
- `src/accounts.ts` — `ResolvedWahaAccount` type adds `tenantId: string`; `resolveWahaAccount`, `listEnabledWahaAccounts`, `resolveSessionForTarget` accept optional `tenantId`
- `src/channel.ts` — `_tenantId` module var, `getTenantId()` export, `_tenantId` set in `handleAction`, passed to `getDirectoryDb` and `resolveWahaAccount` call sites

## Decisions Made

- Default tenant uses legacy flat path (no subdirectory) — DO NOT CHANGE, existing installs depend on it
- `tenantId` read from `coreCfg.channels.waha.tenantId` via `as any` cast (field not in schema yet, future schema work)
- All 3 `resolveWahaAccount` call sites in channel.ts updated to pass `tenantId: _tenantId`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TypeScript compiled clean on first attempt, all tests passed immediately.

## Next Phase Readiness

- PLAT-03 complete; tenant isolation groundwork in place
- Phase 32 (3/3 plans) complete — all platform abstraction work done
- Ready for milestone completion and deployment

---
*Phase: 32-platform-abstraction*
*Completed: 2026-03-20*
