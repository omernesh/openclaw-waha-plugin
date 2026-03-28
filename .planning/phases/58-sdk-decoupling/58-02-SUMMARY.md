---
phase: 58-sdk-decoupling
plan: 02
subsystem: infra
tags: [sdk-decoupling, health, webhooks, standalone, platform-types, account-utils, request-utils]

requires:
  - phase: 58-01
    provides: platform-types.ts, account-utils.ts, request-utils.ts (local SDK replacements)

provides:
  - monitor.ts with zero openclaw/plugin-sdk imports
  - send.ts with zero openclaw/plugin-sdk imports
  - monitor.test.ts SDK mocks replaced with local module mocks
  - webhook_registered field in HealthState (CORE-05)
  - setWebhookRegistered() exported from health.ts
  - CORE-03 webhook self-registration in monitorWahaProvider (GET+merge+PUT, non-fatal)

affects: [58-03, standalone.ts, docker-alpha]

tech-stack:
  added: []
  patterns:
    - "Local detectMime stub: SDK took {filePath,headerMime,buffer} but was called with plain URL string — always returned undefined. Stub makes the extension-fallback path explicit."
    - "GET+merge+PUT webhook upsert: fetch existing webhooks, upsert our URL, PUT back — avoids overwriting other webhooks in shared WAHA deployments."
    - "Non-fatal webhook registration: setWebhookRegistered(session, false) on failure, warn log, continue startup."

key-files:
  created: []
  modified:
    - src/monitor.ts
    - src/send.ts
    - src/monitor.test.ts
    - src/health.ts

key-decisions:
  - "detectMime local stub always returns undefined — send.ts already had extension-based fallback, SDK function was unreachable anyway (called with string not object)"
  - "sendMediaWithLeadingCaption inlined in send.ts — exact SDK behavior, caption only on first media item, onError receives object {error,mediaUrl,caption,index,isFirst}"
  - "createLoggerBackedRuntime inlined as no-op — standalone server has no channel-level runtime, returns {log: undefined}"
  - "Webhook registration uses GET+merge+PUT to preserve existing WAHA webhook entries — PUT /api/sessions/{session} replaces entire webhooks array"
  - "webhookPublicUrl config field gates CORE-03 — if not set, registration is silently skipped (non-fatal)"

requirements-completed: [CORE-01, CORE-03, CORE-05]

duration: 25min
completed: 2026-03-28
---

# Phase 58 Plan 02: SDK Decoupling (monitor.ts + send.ts) Summary

**monitor.ts and send.ts are now SDK-free; webhook self-registration (CORE-03) and health webhook_registered field (CORE-05) implemented.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-28T05:20:00Z
- **Completed:** 2026-03-28T05:45:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Replaced 7 openclaw/plugin-sdk import statements in monitor.ts with local modules (request-utils.js, platform-types.js, account-utils.js) and an inlined createLoggerBackedRuntime factory
- Replaced 3 openclaw/plugin-sdk import statements in send.ts with local implementations (detectMime stub, sendMediaWithLeadingCaption inline, account-utils.js)
- Removed SDK mocks in monitor.test.ts; replaced with mocks targeting local modules
- Added webhook_registered boolean to HealthState and exported setWebhookRegistered() from health.ts (CORE-05)
- Implemented CORE-03 webhook self-registration in monitorWahaProvider using GET+merge+PUT WAHA session API — non-fatal, skipped if webhookPublicUrl not configured
- All 685 tests pass

## Task Commits

1. **Task 1: Decouple monitor.ts and send.ts from SDK** - `9c2e0ac` (feat)
2. **Task 2: CORE-03 webhook self-registration + CORE-05 health field** - `e495939` (feat)

## Files Created/Modified

- `src/monitor.ts` — Removed 5 SDK imports; added local module imports (request-utils, platform-types, account-utils); inlined createLoggerBackedRuntime; added callWahaApi + setWebhookRegistered imports; added CORE-03 webhook registration block in monitorWahaProvider
- `src/send.ts` — Removed 3 SDK imports; inlined detectMime stub and sendMediaWithLeadingCaption; switched DEFAULT_ACCOUNT_ID to account-utils.js
- `src/monitor.test.ts` — Removed openclaw/plugin-sdk and openclaw/plugin-sdk/webhook-ingress vi.mock blocks; replaced with vi.mock("./request-utils.js"), vi.mock("./platform-types.js"), vi.mock("./account-utils.js")
- `src/health.ts` — Added webhook_registered: boolean to HealthState; added setWebhookRegistered(session, registered) export; set webhook_registered: false in startHealthCheck initial state

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WAHA webhook registration endpoint does not exist at /api/{session}/webhooks**
- **Found during:** Task 2 (researching WAHA API)
- **Issue:** Plan's pseudocode used `PUT /api/sessions/${session}/webhooks` which returns 404. WAHA stores webhooks as part of the session config object.
- **Fix:** Used GET `/api/sessions/{session}` to read existing config, upserted our webhook URL into the array, then PUT `/api/sessions/{session}` with `{config:{webhooks:[...]}}`. This preserves all existing webhook entries.
- **Files modified:** src/monitor.ts
- **Commit:** e495939

**2. [Rule 2 - Missing functionality] detectMime SDK function called with wrong argument type**
- **Found during:** Task 1 (reading SDK source)
- **Issue:** SDK's detectMime takes `{filePath, headerMime, buffer}` object but send.ts calls it with a plain URL string — always returned undefined. The extension-based fallback in resolveMime() handled all actual MIME resolution.
- **Fix:** Replaced with explicit stub `function detectMime(_url: unknown): string | undefined { return undefined; }` — makes the behavior explicit and documents why the SDK import was redundant.
- **Files modified:** src/send.ts
- **Commit:** 9c2e0ac

## Self-Check: PASSED

- `src/monitor.ts` — FOUND, zero SDK import statements
- `src/send.ts` — FOUND, zero SDK import statements
- `src/monitor.test.ts` — FOUND, zero SDK mocks
- `src/health.ts` — FOUND, contains webhook_registered
- Commit `9c2e0ac` — FOUND
- Commit `e495939` — FOUND
- 685 tests pass
