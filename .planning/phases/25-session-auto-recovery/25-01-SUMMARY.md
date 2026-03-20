---
phase: 25-session-auto-recovery
plan: "01"
subsystem: health
tags: [health, auto-recovery, alerting, admin-api]
dependency_graph:
  requires: []
  provides: [auto-recovery-logic, recovery-history-api]
  affects: [src/health.ts, src/monitor.ts]
tech_stack:
  added: []
  patterns: [ring-buffer, cooldown-guard, fire-and-forget-async, dynamic-import]
key_files:
  created: []
  modified:
    - src/health.ts
    - src/monitor.ts
decisions:
  - Dynamic imports in alertGodModeUsers to avoid circular dependency (health.ts -> send.ts -> accounts.ts)
  - enableRecovery defaults to false for backward compatibility — opt-in per call site
  - UNHEALTHY_THRESHOLD updated from 3 to 5 (now unified with AUTO_RECOVERY_THRESHOLD)
  - bypassPolicy: true for WhatsApp alerts (system alerts must bypass filter policy)
metrics:
  duration_seconds: 160
  completed_date: "2026-03-20"
  tasks_completed: 2
  files_modified: 2
---

# Phase 25 Plan 01: Session Auto-Recovery Summary

**One-liner:** WAHA session auto-restart after 5 consecutive health failures with 5-min cooldown, god mode WhatsApp alerting, and recovery history API at `/api/admin/recovery`.

## What Was Built

- `src/health.ts`: Extended with `attemptRecovery` (POST `/api/sessions/{session}/restart` via callWahaApi), `alertGodModeUsers` (WhatsApp alert via healthy sender session), and ring-buffered `recoveryHistory` (max 50 events). New exports: `RecoveryState`, `RecoveryEvent`, `getRecoveryState`, `getRecoveryHistory`.
- `src/monitor.ts`: New `GET /api/admin/recovery` endpoint returning per-session recovery state + full history. Stats endpoint session objects extended with `recoveryAttemptCount`, `recoveryLastAttemptAt`, `recoveryLastOutcome`, `recoveryInCooldown`. `startHealthCheck` now called with `enableRecovery: true`, `cfg`, `accountId`.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 8246f31 | feat(25-01): add auto-recovery logic, cooldown, alerting, and history to health.ts |
| 2 | e0cb4a6 | feat(25-01): add recovery history API endpoint and extend stats in monitor.ts |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/health.ts` exists and contains all required exports
- `src/monitor.ts` contains `/api/admin/recovery` route and `enableRecovery: true`
- Both commits verified in git log
- `npx tsc --noEmit` exits 0 (no type errors)
