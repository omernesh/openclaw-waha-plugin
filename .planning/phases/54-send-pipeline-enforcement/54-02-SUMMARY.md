---
phase: 54-send-pipeline-enforcement
plan: "02"
subsystem: send-pipeline
tags: [mimicry, enforcement, send-pipeline, rate-limiting, time-gate]
dependency_graph:
  requires: [54-01]
  provides: [send-pipeline-enforcement]
  affects: [src/send.ts, src/inbound.ts]
tech_stack:
  added: []
  patterns: [mimicry-enforcer-chokepoint, bypass-policy-flag, record-after-success]
key_files:
  created: []
  modified:
    - src/send.ts
    - src/inbound.ts
    - tests/link-preview.test.ts
decisions:
  - sendWahaMediaBatch calls enforceMimicry once with count=N before the batch loop (not per-media)
  - deliverWahaReply calls enforceMimicry AFTER presenceCtrl typing stop (avoids two concurrent typing indicators)
  - Status sends pass isStatusSend=true so they honour time gate but skip hourly cap
  - edit/delete/pin/unpin/react do NOT call enforceMimicry (not new content per CONTEXT decision)
  - link-preview.test.ts updated to mock mimicry-enforcer + directory (avoids jitter timeout)
metrics:
  duration_minutes: 10
  completed_date: "2026-03-26"
  tasks_completed: 2
  files_modified: 3
---

# Phase 54 Plan 02: Send Pipeline Enforcement Summary

## One-liner

Wired `enforceMimicry` + `recordMimicrySuccess` into all 13 outbound send paths in send.ts and deliverWahaReply in inbound.ts.

## What Was Built

Every agent outbound send now passes through the mimicry enforcement chokepoint before hitting WAHA API:

1. **send.ts**: 16 `enforceMimicry` calls, 12 `recordMimicrySuccess` calls
   - `sendWahaText` — enforce (with bypassPolicy guard) + record
   - `sendWahaMediaBatch` — batch pre-check (count=N) + record after entire batch
   - `sendWahaImage/Video/File` — added `bypassPolicy?` param, enforce + record
   - `sendWahaPoll/Location/ContactVcard/List/LinkPreview/forwardWahaMessage` — enforce + record
   - `sendWahaTextStatus/ImageStatus/VoiceStatus/VideoStatus` — `isStatusSend: true` (time gate only)

2. **inbound.ts**: `deliverWahaReply` — stop presenceCtrl typing, then `enforceMimicry`, then send, then `recordMimicrySuccess`

## Commits

| Hash | Description |
|------|-------------|
| 1ad970b | feat(54-02): wire enforceMimicry into all send.ts outbound functions |
| b16e468 | feat(54-02): wire enforceMimicry into deliverWahaReply in inbound.ts |

## Must-Haves Verified

- [x] sendWahaText calls enforceMimicry before WAHA API call and recordMimicrySuccess after
- [x] sendWahaImage/Video/File have bypassPolicy param and call enforceMimicry before WAHA API call
- [x] sendWahaPoll/Location/Vcard/List/LinkPreview/Forward call enforceMimicry (new content actions)
- [x] deliverWahaReply stops presenceCtrl typing before calling enforceMimicry
- [x] sendWahaMediaBatch does batch pre-check with count=mediaUrls.length
- [x] Status/story sends (sendWahaTextStatus etc) pass isStatusSend=true to skip cap
- [x] /shutup, /join, /leave bypass mimicry via bypassPolicy=true
- [x] recordMimicrySuccess only called after successful WAHA API response (not on throw)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed tests/link-preview.test.ts timeout**
- **Found during:** Task 1 full suite run
- **Issue:** `sendWahaText` now calls `enforceMimicry` which has jitter delay + typing simulation. The test file mocked `callWahaApi` and `accounts.js` but not `mimicry-enforcer.js` or `directory.js`, causing 5s test timeouts.
- **Fix:** Added `vi.mock("../src/mimicry-enforcer.js", ...)` and `vi.mock("../src/directory.js", ...)` at the top of `tests/link-preview.test.ts`.
- **Files modified:** tests/link-preview.test.ts
- **Commit:** 1ad970b

## Test Results

- Full suite: 655/655 tests pass (up from 655 — no regressions)
- `src/mimicry-gate.test.ts`: 50/50 pass
- `src/send-pipeline.test.ts`: 11/11 pass

## Known Stubs

None — all enforcement calls are fully wired.

## Self-Check: PASSED

- [x] src/send.ts modified with 16 enforceMimicry calls — FOUND
- [x] src/inbound.ts modified with 1 enforceMimicry call — FOUND
- [x] src/send.ts.bak.v1.20-pre54-02 backup — FOUND
- [x] src/inbound.ts.bak.v1.20-pre54-02 backup — FOUND
- [x] Commits 1ad970b, b16e468 — FOUND
