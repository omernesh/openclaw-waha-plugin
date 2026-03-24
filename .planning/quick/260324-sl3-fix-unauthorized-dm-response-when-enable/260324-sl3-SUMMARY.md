---
phase: quick
plan: 260324-sl3
subsystem: inbound
tags: [bugfix, newsletter, dm-filter, pairing, auto-reply]
dependency_graph:
  requires: []
  provides: [newsletter-safe-inbound-pipeline]
  affects: [inbound.ts, inbound.test.ts]
tech_stack:
  added: []
  patterns: [isDm-guard-pattern]
key_files:
  created: []
  modified:
    - src/inbound.ts
    - src/inbound.test.ts
decisions:
  - "Use chatId.endsWith('@c.us') as isDm instead of !isGroup — explicit and future-proof"
  - "Replace all DM-specific !isGroup uses with isDm throughout inbound.ts"
  - "Added sub-path mocks for openclaw/plugin-sdk/* to fix pre-existing test import failures"
metrics:
  duration: "~30 minutes"
  completed: "2026-03-24"
  tasks_completed: 1
  files_modified: 2
---

# Phase quick Plan 260324-sl3: Fix Unauthorized DM Response for Newsletter ChatIds

**One-liner:** Replace `!isGroup` with `isDm` (`chatId.endsWith('@c.us')`) guard on all DM-specific logic blocks in inbound.ts to prevent auto-reply/pairing challenges from firing on newsletter chats.

## What Was Done

### Task 1: Fix DM-only guard and add test coverage

**Root cause:** `!isGroup` was used as the DM-only guard throughout inbound.ts. For newsletter chatIds (`@newsletter`), `isGroup=false`, making `!isGroup=true`. This caused Phase 16 auto-reply, pairing challenges, TTL-03 expiry checks, DM keyword filters, pending selection checks, and human session drop logic to fire for newsletter chats — which is wrong.

**Fix:** Added `isDm` const immediately after `isGroup`:
```ts
const isDm = typeof message.chatId === "string" && message.chatId.endsWith("@c.us");
```

Replaced `!isGroup` with `isDm` on 6 blocks:
1. Phase 16 auto-reply/pairing block (line ~691)
2. Gateway pairing reply (`else if` at line ~956)
3. TTL-03 expiry check (line ~984)
4. DM keyword filter (line ~1010)
5. Pending selection check (line ~513)
6. Human session drop (line ~561)
7. Per-DM settings enforcement (line ~1047)

Also fixed pre-existing test infrastructure issue: `inbound.test.ts` was failing due to missing mocks for `openclaw/plugin-sdk` sub-path imports (`/config-runtime`, `/reply-payload`, `/channel-runtime`, `/channel-inbound`, `/security-runtime`, `/whatsapp-shared`, `/account-id`, `/account-resolution`, `/secret-input`). Added all required mocks plus `routing`, `session`, and `reply` properties to the `getWahaRuntime` mock.

**Test assertions updated:** `resolveDmGroupAccessWithCommandGate` imports changed from `openclaw/plugin-sdk` to `openclaw/plugin-sdk/security-runtime` (where the actual code imports from). `getAutoReplyEngine` mock updated to include `shouldReply`/`sendRejection` (actual API) alongside legacy `shouldAutoReply`/`sendAutoReply`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing test import failures for openclaw sub-paths**
- **Found during:** Task 1, running tests
- **Issue:** `inbound.test.ts` was failing before my changes due to missing mocks for 9 openclaw sub-path packages not installed in local node_modules
- **Fix:** Added vi.mock() calls for all required sub-paths; updated test assertions to import from correct sub-paths; completed getWahaRuntime mock with routing/session/reply objects
- **Files modified:** src/inbound.test.ts
- **Commit:** dfa4035

**2. [Rule 2 - Extended scope] Applied isDm fix to all 7 DM-specific !isGroup checks**
- **Found during:** Task 1, grep review
- **Issue:** Plan specified 4 specific lines but grep found 3 more `!isGroup` uses that were also DM-specific
- **Fix:** Applied isDm to pending selection (line ~513), human session drop (line ~561), and per-DM settings (line ~1047)
- **Files modified:** src/inbound.ts
- **Commit:** dfa4035

## Known Stubs

None.

## Self-Check: PASSED

- src/inbound.ts — modified, isDm guard in place
- src/inbound.test.ts — modified, 23 tests passing
- commit dfa4035 exists
