---
phase: 57-admin-ui-observability
plan: "01"
subsystem: admin-panel
tags: [mimicry, dashboard, settings, observability, react, typescript]
dependency_graph:
  requires: [53-01, 54-01]
  provides: [UI-01, UI-02, UI-03]
  affects: [src/monitor.ts, src/admin/src/components/tabs/DashboardTab.tsx, src/admin/src/components/tabs/SettingsTab.tsx]
tech_stack:
  added: []
  patterns: [per-session status API, debounced auto-save, refreshKey-driven fetch, read-only status endpoint]
key_files:
  created: []
  modified:
    - src/monitor.ts
    - src/admin/src/types.ts
    - src/admin/src/lib/api.ts
    - src/admin/src/components/tabs/DashboardTab.tsx
    - src/admin/src/components/tabs/SettingsTab.tsx
decisions:
  - "Route placed after /api/admin/sessions, before /api/admin/sessions/:id/role — natural position in route block"
  - "getCapStatus used (read-only) not checkAndConsumeCap — status API must never consume quota"
  - "null passed as targetOverride to resolveGateConfig/resolveCapLimit — shows global/session-level status"
  - "buildPayload() extended with sendGate/hourlyCap — ensures auto-save includes new fields"
  - "Send Gates card placed after Access Control (Section 5) — logical ordering: health → filters → access → gates"
metrics:
  duration: "~15 minutes"
  completed: "2026-03-27T20:44:46Z"
  tasks_completed: 2
  files_modified: 5
---

# Phase 57 Plan 01: Admin UI Observability Summary

**One-liner:** Added GET /api/admin/mimicry endpoint with per-session gate/cap status, dashboard Send Gates card with maturity + usage bar, and Settings mimicry section with send window, timezone, and progressive limits — all wiring into existing auto-save pattern.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Backend API route + frontend types and API method | be1f9b8 | src/monitor.ts, src/admin/src/types.ts, src/admin/src/lib/api.ts |
| 2 | Dashboard Send Gates card + Settings mimicry section | 9442cc4 | src/admin/src/components/tabs/DashboardTab.tsx, src/admin/src/components/tabs/SettingsTab.tsx |

## What Was Built

### Task 1: Backend + Types + API Method

**`src/monitor.ts`** — Added `GET /api/admin/mimicry` route (after sessions route, before sessions/:id/role):
- Calls `getMimicryDb()`, iterates `listEnabledWahaAccounts()`
- Per session: `getMaturityPhase`, `resolveCapLimit`, `getCapStatus` (read-only), `resolveGateConfig`, `checkTimeOfDay`
- Computes `daysUntilUpgrade` (ceiling of days remaining in current phase, null for stable)
- Returns `{ sessions: MimicrySessionStatus[] }` — 200 on success, 500 with log on error
- Import added: all 6 functions from `./mimicry-gate.js`

**`src/admin/src/types.ts`** — Added:
- `MimicrySessionStatus` interface (session, name, maturity, daysUntilUpgrade, capCount, capLimit, capRemaining, gateOpen, gateEnabled)
- `MimicryStatusResponse` interface (`{ sessions: MimicrySessionStatus[] }`)
- `WahaConfig` extended with `sendGate?` (enabled, timezone, startHour, endHour, onBlock) and `hourlyCap?` (enabled, limits: {new, warming, stable})

**`src/admin/src/lib/api.ts`** — Added `getMimicryStatus: () => request<MimicryStatusResponse>('/mimicry')` to api object.

### Task 2: Dashboard + Settings UI

**`src/admin/src/components/tabs/DashboardTab.tsx`** — Added:
- `mimicry` state (`MimicryStatusResponse | null`)
- `useEffect` fetching `api.getMimicryStatus()` on each `refreshKey` change (with AbortController cleanup)
- "Send Gates" Card (Section 6) — per-session: gate open/closed Badge, maturity label + days-to-upgrade, cap count/limit tabular display, usage progress bar (bg-destructive at >80%)

**`src/admin/src/components/tabs/SettingsTab.tsx`** — Added:
- Section 12: "Send Gate & Rate Limits" collapsible Card (defaultOpen: false)
- Send Gate toggle switch, Window Start/End hour inputs (0-23, validated with isNaN), Timezone IANA input, Quiet Hours Policy select (reject/queue)
- Hourly Cap toggle switch, Progressive Limits table (new/warming/stable with number inputs, isNaN-guarded)
- `buildPayload()` extended with `sendGate` and `hourlyCap` objects — ensures auto-save includes new fields
- No separate Save button — all fields auto-save via existing debounced `updateConfig` pattern

## Verification

- 683 vitest tests pass (48 test files) — no regressions
- TypeScript compiles cleanly for all 5 modified files (pre-existing errors in LogTab/AnalyticsTab/DirectoryTab unrelated to this plan)
- Vite build succeeds in 5.72s — DashboardTab-CST9MS3q.js (19.20 kB), SettingsTab-BNi5XvhJ.js (48.21 kB)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data flows from live `/api/admin/mimicry` endpoint. Dashboard card fetches real per-session data. Settings fields auto-save to real config via existing pattern.

## Self-Check: PASSED

All 5 modified files confirmed present on disk. Both task commits verified in git log (be1f9b8, 9442cc4).
