---
phase: 53-mimicrygate-core
plan: "01"
subsystem: mimicry-gate
tags: [sqlite, config-schema, zod, rolling-window, config-resolution]
dependency_graph:
  requires: []
  provides: [MimicryDb, getMimicryDb, resolveGateConfig, resolveCapLimit, getMaturityPhase, sendGate-schema, hourlyCap-schema, dm_settings-gate-columns]
  affects: [src/mimicry-gate.ts, src/config-schema.ts, src/directory.ts]
tech_stack:
  added: [src/mimicry-gate.ts]
  patterns: [AnalyticsDb-singleton-pattern, 3-level-config-merge, SQLite-rolling-window, ALTER-TABLE-migration]
key_files:
  created:
    - src/mimicry-gate.ts
  modified:
    - src/config-schema.ts
    - src/directory.ts
decisions:
  - "Rolling window via per-row timestamps (not fixed buckets) — prevents 2x burst at hour boundary"
  - "Reject-not-queue as default onBlock policy — no queue complexity, no message loss on restart"
  - "Cap keyed by WAHA session name (not plugin accountId) — logan and Omer share session bucket"
  - "3-level merge (global -> session -> target) for both gate and cap — most-specific wins"
  - "ON CONFLICT(session) DO NOTHING in ensureFirstSendAt — preserves original first_send_at"
metrics:
  duration: "~9 minutes"
  completed_date: "2026-03-26"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
---

# Phase 53 Plan 01: MimicryGate Core Infrastructure Summary

MimicryGate data layer and config contracts: SQLite rolling window + account_metadata tables, Zod sendGate/hourlyCap schemas with 3-level config resolution (global -> session -> per-target), and dm_settings extended for per-contact/group/newsletter gate and cap overrides.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add sendGate + hourlyCap Zod schemas to WahaAccountSchemaBase | 3fa859e | src/config-schema.ts |
| 2 | Create MimicryDb + types + config resolution; extend dm_settings | 3cfc636 | src/mimicry-gate.ts, src/directory.ts |

## What Was Built

### src/config-schema.ts
- `sendGate` field added to `WahaAccountSchemaBase`: enabled/timezone/startHour/endHour/onBlock with all-optional defaults (disabled by default)
- `hourlyCap` field added: enabled/limits.new/warming/stable with progressive defaults (15/30/50 msgs/hr)
- All new fields use `.optional().default()` — existing production configs load without error
- `validateWahaConfig({})` auto-includes new fields via `knownKeys` derivation from `WahaAccountSchemaBase.shape`

### src/mimicry-gate.ts (new file)
- `MimicryDb` class following `AnalyticsDb` pattern exactly (createRequire, WAL, busy_timeout=5000, WAL checkpoint timer with .unref())
- Two SQLite tables: `send_window_events(id, session, sent_at)` with idx_swe_session_time, and `account_metadata(session, first_send_at, updated_at)`
- Prepared statements: countRecentSends, recordSend, ensureFirstSendAt (ON CONFLICT DO NOTHING), getFirstSendAt, pruneOldWindows
- Pruning on construction: deletes events older than 2 hours (2hr buffer over 60min rolling window)
- `getMimicryDb()` singleton (path: `~/.openclaw/data/mimicry.db`)
- `getMaturityPhase(firstSendAt, now)`: null->new, <7d->new, <30d->warming, >=30d->stable
- `resolveGateConfig(session, cfg, targetOverride?)`: 3-level merge, returns `ResolvedGateConfig`
- `resolveCapLimit(session, maturity, cfg, targetOverride?)`: 3-level merge, returns number
- Exported types: MaturityPhase, TargetGateOverride, TargetCapOverride, ResolvedGateConfig, ResolvedCapConfig, GateResult, CapResult, CapStatus
- Phase 54 warning comment about bypassPolicy on sendWahaImage/Video/File
- NOTE: checkTimeOfDay/checkAndConsumeCap/getCapStatus are NOT here — Plan 02

### src/directory.ts
- Import of `TargetGateOverride` and `TargetCapOverride` from `./mimicry-gate.js`
- `ContactDmSettings` type extended with `sendGateOverride?: TargetGateOverride | null` and `hourlyCapOverride?: TargetCapOverride | null`
- `dm_settings` CREATE TABLE extended with `send_gate_json TEXT DEFAULT NULL` and `hourly_cap_json TEXT DEFAULT NULL`
- Migration blocks added after existing INIT-02 migration: `ALTER TABLE dm_settings ADD COLUMN` for both new columns (no-op if already exist)
- `getContactDmSettings()` updated to SELECT and JSON.parse the new columns
- `setContactDmSettings()` updated to JSON.stringify and persist new columns in INSERT OR REPLACE

## Verification

- `npx vitest run src/config-io.test.ts` — 10/10 tests pass
- `npx vitest run src/directory.test.ts` — 46/46 tests pass
- `npx vitest run` (full suite) — 594/594 tests pass
- `grep "sendGate" src/config-schema.ts` — present
- `grep "hourlyCap" src/config-schema.ts` — present
- `grep "export class MimicryDb" src/mimicry-gate.ts` — present
- `grep "send_gate_json" src/directory.ts` — 5 occurrences (schema + migration + read + write)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan establishes the data layer only. No stubs flow to UI rendering. Plan 02 builds gate/cap enforcement on top of this foundation.

## Self-Check: PASSED

Files exist:
- src/mimicry-gate.ts: FOUND
- src/config-schema.ts.bak.v1.19-pre53-01: FOUND
- src/directory.ts.bak.v1.19-pre53-01: FOUND

Commits exist:
- 3fa859e (Task 1: sendGate + hourlyCap schemas): FOUND
- 3cfc636 (Task 2: MimicryDb + dm_settings extension): FOUND
