---
phase: 61-webhook-forwarding
plan: "02"
subsystem: monitor
tags: [webhook-forwarding, inbound, admin-api, hook-01, hook-04]
dependency_graph:
  requires: [61-01]
  provides: [forwardWebhook-callsite, webhook-subscriptions-crud]
  affects: [src/monitor.ts]
tech_stack:
  added: []
  patterns: [fire-and-forget, modifyConfig-upsert]
key_files:
  created: []
  modified:
    - src/monitor.ts
decisions:
  - "Forwarding uses startup-time cfg.webhookSubscriptions — config changes take effect after server restart (consistent with existing pattern)"
  - "Fire-and-forget via void + .catch() — never blocks inbound message delivery"
  - "Group forwarding placed outside participant loop to avoid duplicate fires per participant"
metrics:
  duration: "8m"
  completed: "2026-03-28"
  tasks: 1
  files: 1
---

# Phase 61 Plan 02: Webhook Forwarding Wiring Summary

**One-liner:** Wired fire-and-forget forwardWebhook into all inbound event paths (message, reaction, poll.vote, rsvp, group) and added GET/POST/DELETE /api/admin/webhook-subscriptions CRUD routes persisted via modifyConfig.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire forwardWebhook into inbound path + admin subscription routes | b76ef29 | src/monitor.ts |

## What Was Built

**Inbound forwarding (HOOK-01):**
- `message` events: forwardWebhook called after inboundQueue.enqueue, before 200 response
- `message.reaction` events: forwardWebhook called after dedup check
- `poll.vote` events: forwardWebhook called after poll vote enqueue
- `rsvp` events: forwardWebhook called after RSVP enqueue
- `group` join/leave events: forwardWebhook called after all participant processing

All forwarding is fire-and-forget (`void forwardWebhook(...).catch(...)`) — NEVER blocks inbound delivery.

**Admin subscription CRUD (HOOK-04):**
- `GET /api/admin/webhook-subscriptions` — reads live config, returns current subscription array
- `POST /api/admin/webhook-subscriptions` — upserts by URL (update if exists, append if new), persists via modifyConfig
- `DELETE /api/admin/webhook-subscriptions` — filters out matching URL, persists via modifyConfig

All 3 routes protected by existing `requireAdminAuth` guard (applied at line ~612 for all `/api/admin/*`).

## Verification

- `grep "void forwardWebhook" src/monitor.ts` — 5 call sites confirmed
- `grep "webhook-subscriptions" src/monitor.ts` — 3 routes confirmed
- `grep "HOOK-01" src/monitor.ts` — 5 comments confirmed
- `grep "HOOK-04" src/monitor.ts` — 3 comments confirmed
- `grep "DO NOT await" src/monitor.ts` — fire-and-forget documentation present
- `npm test` — 1432 tests passing, 0 regressions

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- src/monitor.ts exists and contains all required changes
- Commit b76ef29 exists in git history
- 1432 tests passing
