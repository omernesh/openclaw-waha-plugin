---
gsd_state_version: 1.0
milestone: v1.20
milestone_name: Human Mimicry Hardening
status: active
stopped_at: Completed 54-01-PLAN.md
last_updated: "2026-03-26T19:14:00Z"
last_activity: 2026-03-26
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 6
  completed_plans: 3
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-26)

**Core value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.
**Current focus:** Phase 54 — Send Pipeline Enforcement

## Current Position

Phase: 54
Plan: 01 complete
Status: Active — 54-01 done, 54-02+ pending
Last activity: 2026-03-26

Progress: [█████░░░░░] 50%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 53. MimicryGate Core | - | - | - |
| 54. Send Pipeline Enforcement | - | - | - |
| 55. Claude Code Integration | - | - | - |
| 56. Adaptive Activity Patterns | - | - | - |
| 57. Admin UI & Observability | - | - | - |
| Phase 53 P01 | 9 | 2 tasks | 3 files |
| Phase 53 P02 | 358 | 2 tasks | 2 files |
| Phase 54 P01 | 4 | 1 task (TDD) | 2 files |

## Accumulated Context

### Decisions

- **2026-03-26 (Roadmap)**: Reject-not-queue as default quiet hours policy — avoids message loss on restart and SQLite queue complexity
- **2026-03-26 (Roadmap)**: Rolling window hourly counter (SQLite per-timestamp rows) over fixed top-of-hour bucket — prevents 2x burst exploit at hour boundaries
- **2026-03-26 (Roadmap)**: Phase 53 is the hard dependency for all others — no live deploy needed until Phase 54
- **2026-03-26 (Roadmap)**: Phases 54, 55, 56 are all independent after Phase 53 (can be sequenced in any order; Phase 55 is highest ban-risk gap)
- **2026-03-26 (Roadmap)**: Cap keyed by WAHA session name, not plugin accountId — logan and Omer sends share the same hourly bucket per session
- [Phase 53]: Rolling window via per-row timestamps (not fixed buckets) prevents 2x burst at hour boundary
- [Phase 53]: Reject-not-queue as default onBlock policy eliminates queue complexity and message loss on restart
- [Phase 53]: 3-level config merge (global -> session -> target) for both gate and cap; most-specific wins
- [Phase 53]: Intl.DateTimeFormat with formatToParts for timezone-aware hour extraction (not getHours())
- [Phase 53]: Cross-midnight window: endHour <= startHour means hour >= startHour OR hour < endHour
- [Phase 53]: getCapStatus is read-only -- never calls recordSend
- [Phase 54]: Separate mimicry-enforcer.ts avoids circular import between send.ts and mimicry-gate.ts
- [Phase 54]: DI params _db/_now/_sleep for enforcer test isolation without fake timers
- [Phase 54]: recordMimicrySuccess called by caller AFTER WAHA success -- failed sends don't consume cap

### Architecture Notes

- `src/mimicry-gate.ts` is new file — all enforcement primitives live here
- Integration points confirmed: `sendWahaText`, `sendWahaImage`, `sendWahaVideo`, `sendWahaFile` in `send.ts`; `handleAction()` dispatch in `channel.ts`; `monitor.ts` HTTP server for proxy-send + mimicry status API
- `bypassPolicy` flag in `send.ts` already exists — preserves `/shutup`, `/join`, `/leave` bypass behavior
- Typing simulation entry point: `sendWahaPresence()` at `send.ts:176` (existing, working)
- SQLite infrastructure: follow `AnalyticsDb` pattern for rolling window table + `account_metadata` table
- All new Zod fields MUST use `.optional().default()` — production configs must load without error
- `src/mimicry-enforcer.ts` is the chokepoint — Plan 02 wires it into sendWahaText/Image/Video/File/etc in send.ts

### Research Flags

- **Phase 55**: Verify exact call sites in `whatsapp-messenger` skill before implementing proxy-send — confirm which endpoints the skill calls directly
- **Phase 53**: Confirm rolling window query performance against existing `message_events` table structure before choosing table design

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-03-26T19:14:00Z
Stopped at: Completed 54-01-PLAN.md
Resume file: None
