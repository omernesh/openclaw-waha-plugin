---
phase: 16-pairing-mode-and-auto-reply
plan: "02"
subsystem: inbound-pipeline
tags: [pairing, auto-reply, inbound, DM-policy, zero-token]
dependency_graph:
  requires: [16-01]
  provides: [PAIR-01, PAIR-02, PAIR-03, PAIR-04, PAIR-06, REPLY-01, REPLY-04]
  affects: [src/inbound.ts, src/channel.ts]
tech_stack:
  added: []
  patterns: [singleton-engine, pipeline-guard, rate-limit-state-machine]
key_files:
  created: []
  modified:
    - src/inbound.ts
    - src/channel.ts
decisions:
  - "Use engine.grantAccess() instead of direct setContactAllowDmWithSource() in inbound.ts -- routes through PairingEngine public API for encapsulation"
  - "Pass full messageText to verifyDeepLinkToken (not pre-extracted token) -- function extracts its own regex internally"
  - "Auto-reply block always returns after firing (even rate-limited) -- explicit zero-token guarantee rather than relying on dmPolicy drop"
metrics:
  duration_minutes: 4
  completed_date: "2026-03-17"
  tasks_completed: 2
  files_modified: 2
---

# Phase 16 Plan 02: Pairing and Auto-Reply Pipeline Wiring Summary

Inbound pipeline now intercepts unauthorized DMs with pairing challenges and auto-reply rejections, consuming zero LLM tokens for both paths.

## What Was Built

**Task 1: Inbound pipeline hooks (src/inbound.ts)**

Added Phase 16 block between `statusSink?.({ lastInboundAt })` and `const dmPolicy = ...`. The block:

- Checks `isContactAllowedDm()` — allowed contacts skip the block entirely
- If `pairingMode.enabled && hmacSecret`: runs PairingEngine challenge/response flow
  - `PAIR-{12hex}` messages: verified via `engine.verifyDeepLinkToken(senderId, messageText)`
  - 6-digit messages: verified via `engine.verifyPasscode(senderId, attempt)`
  - On success: `engine.grantAccess()` grants TTL, sends "Access granted!" confirmation, returns
  - On wrong/locked: sends appropriate error message, returns
  - On no match: sends challenge message (creating challenge row if needed), returns
- Else if `autoReply.enabled`: rate-limited rejection via `AutoReplyEngine.sendRejection()`
  - Always returns after this branch (zero-token guarantee)
- Falls through to existing DM policy check when neither feature is enabled

**Task 2: Engine initialization at account start (src/channel.ts)**

Added initialization block after `startDirectorySync` in `startAccount`:

- PairingEngine: initialized when `pairingMode.enabled=true`; auto-generates ephemeral HMAC secret with warning if not configured
- AutoReplyEngine: always initialized (lightweight, no config needed)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed verifyDeepLinkToken call signature mismatch**
- **Found during:** Task 1
- **Issue:** Plan called `engine.verifyDeepLinkToken(senderId, token)` where `token` was the already-extracted 12-char hex string. But `verifyDeepLinkToken(senderJid, messageText)` runs its own internal regex to extract the token from full message text.
- **Fix:** Changed to `engine.verifyDeepLinkToken(senderId, messageText)` passing full text. Added comment explaining why.
- **Files modified:** src/inbound.ts
- **Commit:** ae19afe

**2. [Rule 2 - Missing critical functionality] Used engine.grantAccess() instead of direct setContactAllowDmWithSource()**
- **Found during:** Task 1
- **Issue:** Plan called `dirDb.setContactAllowDmWithSource(senderId, true, expiresAt, "pairing")` directly with manual TTL calculation. PairingEngine already has `grantAccess(jid, grantTtlMinutes)` that does this correctly.
- **Fix:** Replaced with `engine.grantAccess(senderId, grantTtlMinutes)` — simpler, uses engine's own API, less error-prone.
- **Files modified:** src/inbound.ts
- **Commit:** ae19afe

## Self-Check: PASSED

- src/inbound.ts: FOUND
- src/channel.ts: FOUND
- ae19afe (feat inbound pipeline hooks): FOUND
- 91e03d6 (feat engine initialization): FOUND
