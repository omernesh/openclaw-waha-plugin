---
phase: 16-pairing-mode-and-auto-reply
verified: 2026-03-17T15:30:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 16: Pairing Mode and Auto-Reply Verification Report

**Phase Goal:** Unknown contacts who DM the bot receive a canned rejection or passcode challenge — authorized contacts get temporary access automatically, and the whole flow costs zero LLM tokens
**Verified:** 2026-03-17T15:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Pairing engine generates 6-digit passcode, hashes it, stores challenge in SQLite, verifies attempts | VERIFIED | `src/pairing.ts:46-110` — `createChallenge` uses `randomInt(100000,999999)`, SHA-256 hash, `upsertPairingChallenge`; `verifyPasscode` checks hash, tracks attempts |
| 2 | HMAC-SHA256 tokens generated from JID+secret, verified without DB lookup | VERIFIED | `src/pairing.ts:116-145` — `generateDeepLinkToken` = `createHmac("sha256", hmacSecret).update(jid).digest("hex").slice(0,12)`; `verifyDeepLinkToken` recomputes and uses `timingSafeEqual` |
| 3 | After 3 wrong attempts a challenge is locked for 30 minutes | VERIFIED | `src/pairing.ts:92-101` — `if (newAttempts >= 3) { lockedUntil = now + 1800; }` |
| 4 | Auto-reply engine sends canned rejection with template variable substitution | VERIFIED | `src/auto-reply.ts:57-88` — `sendRejection` calls `resolveTemplate` then `sendWahaText`; `resolveTemplate` replaces `{admin_name}`, `{phone}`, `{jid}` |
| 5 | Auto-reply is rate-limited to one message per contact per configurable interval | VERIFIED | `src/auto-reply.ts:37-44` — `shouldReply` checks `auto_reply_log.last_reply_at`; interval from `intervalMinutes` config field |
| 6 | Unknown DM triggers passcode challenge (zero LLM tokens) | VERIFIED | `src/inbound.ts:584-708` — Phase 16 block fires for `!isGroup && !triggerActivated && !senderAllowed`; all paths `return` before `dmPolicy` / LLM dispatch |
| 7 | Correct passcode grants temporary allowlist access and stops further challenges | VERIFIED | `src/inbound.ts:644-657` — `engine.grantAccess(senderId, grantTtlMinutes)` then `return` |
| 8 | PAIR-{token} deep link auto-authorizes sender without passcode | VERIFIED | `src/inbound.ts:613-631` — regex `/^PAIR-[a-f0-9]{12}$/i` test, `engine.verifyDeepLinkToken`, `engine.grantAccess`, `return` |
| 9 | Admin panel Settings tab has Pairing Mode and Auto-Reply sections | VERIFIED | `src/monitor.ts:638-710` — collapsible `<details>` sections with all required controls (toggle, passcode, TTL, challenge message, deep link, message textarea, rate limit dropdown) |
| 10 | Admin panel Directory tab shows Pairing badge and Revoke link on pairing-granted contacts | VERIFIED | `src/monitor.ts:3197-3210` — checks `c.source === 'pairing'`, renders badge + revoke link; source field propagated from `getContactTtl` via directory API at line 4280 |

**Score:** 10/10 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/pairing.ts` | PairingEngine class with challenge CRUD, passcode verification, HMAC token generation/verification | VERIFIED | 231 lines; exports `PairingEngine`, `getPairingEngine`, all required methods present |
| `src/auto-reply.ts` | AutoReplyEngine class with rate-limited rejection sending | VERIFIED | 120 lines; exports `AutoReplyEngine`, `getAutoReplyEngine`, all required methods present |
| `src/directory.ts` | `pairing_challenges` and `auto_reply_log` SQLite tables; `source`/`granted_at` on `allow_list` | VERIFIED | Tables at lines 178-190; migration-safe ALTER TABLE at lines 257-264; helper methods at lines 701-804 |
| `src/config-schema.ts` | `pairingMode` and `autoReply` config schema fields | VERIFIED | Both fields at lines 108-128 with all sub-fields (`grantTtlMinutes`, `challengeMessage`, `hmacSecret`, `intervalMinutes`) |
| `src/inbound.ts` | Pairing challenge hook and auto-reply hook in inbound pipeline | VERIFIED | Phase 16 block at lines 578-752; correct pipeline position (after statusSink line 575, before dmPolicy line 754) |
| `src/channel.ts` | PairingEngine and AutoReplyEngine initialization at login time | VERIFIED | Initialization block at lines 916-937; imports at lines 29-31; `randomBytes` at line 928 for ephemeral secret |
| `src/monitor.ts` | Pairing Mode / Auto-Reply UI sections; pairing badge in Directory; API routes | VERIFIED | UI sections at lines 638-710; badge at lines 3197-3210; API routes at lines 4795-4832 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/pairing.ts` | `src/directory.ts` | `getDirectoryDb` for SQLite access | WIRED | `getDirectoryDb` called in `createChallenge`, `verifyPasscode`, `hasActiveChallenge`, `grantAccess`, `revokeGrant` |
| `src/auto-reply.ts` | `src/send.ts` | `sendWahaText` for rejection messages | WIRED | Import at line 18; called in `sendRejection` at line 77 |
| `src/inbound.ts` | `src/pairing.ts` | `getPairingEngine` import, `verifyPasscode`/`verifyDeepLinkToken` calls | WIRED | Import at line 46; `getPairingEngine` at line 608; `verifyDeepLinkToken` at line 614; `verifyPasscode` at line 640 |
| `src/inbound.ts` | `src/auto-reply.ts` | `getAutoReplyEngine` import, `sendRejection` call | WIRED | Import at line 47; `getAutoReplyEngine` at line 712; `shouldReply` at line 715; `sendRejection` at line 729 |
| `src/channel.ts` | `src/pairing.ts` | Import and init at `startAccount` | WIRED | Import at line 29; initialization at lines 916-932 |
| `src/monitor.ts` | `src/directory.ts` | `getPairingGrants` and `revokePairingGrant` calls | WIRED | `revokePairingGrant` at line 4827; `getContactTtl` with `source` at line 4280 |
| `src/monitor.ts` | `POST /api/admin/config` | Config save includes `pairingMode` and `autoReply` fields | WIRED | Config save block at lines 2395-2406 |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PAIR-01 | 16-01, 16-02 | Unknown contact DMs bot → bot replies with scripted passcode challenge (zero LLM tokens) | SATISFIED | Phase 16 block in `inbound.ts`; all paths `return` before LLM; `sendWahaText` sends challenge |
| PAIR-02 | 16-01, 16-02 | Correct passcode grants temporary allowlist entry with configurable TTL | SATISFIED | `engine.grantAccess(senderId, grantTtlMinutes)` in inbound.ts; TTL from `pairingMode.grantTtlMinutes` |
| PAIR-03 | 16-01, 16-02 | wa.me deep link with obfuscated passcode enables zero-friction auto-authorization | SATISFIED | `generateDeepLinkToken` in `pairing.ts`; deep link format `https://wa.me/{phone}?text=PAIR-{token}`; verified in inbound pipeline |
| PAIR-04 | 16-02, 16-03 | Passcode is configurable per-session in admin panel | SATISFIED | Passcode field `id="pairingPasscode"` in Settings tab; Generate button; round-trips through config save/load |
| PAIR-05 | 16-03 | Admin panel shows active temporary grants with remaining TTL and manual revoke | SATISFIED | Directory badge + revoke link at `monitor.ts:3197-3210`; TTL badge from `formatTtlBadge`; DELETE `/api/admin/pairing/grant/:jid` |
| PAIR-06 | 16-01, 16-02 | Passcode attempts are rate-limited to prevent brute force | SATISFIED | 3-attempt lockout in `verifyPasscode`; `locked_until = now + 1800`; lock check on next attempt |
| REPLY-01 | 16-01, 16-02 | Unauthorized DMs receive a configurable canned rejection message (zero LLM tokens) | SATISFIED | `autoReply.enabled` path in inbound.ts; `sendRejection` sends message; `return` prevents LLM dispatch |
| REPLY-02 | 16-01 | Rejection message supports template variables (e.g., bot admin name) | SATISFIED | `resolveTemplate` in `auto-reply.ts`; `{admin_name}`, `{phone}`, `{jid}` variables supported |
| REPLY-03 | 16-01, 16-02 | Auto-reply is rate-limited per contact (once per configurable interval, default 24h) | SATISFIED | `shouldReply` checks `auto_reply_log`; interval from `intervalMinutes` (default 1440min); `recordAutoReply` updates log |
| REPLY-04 | 16-02, 16-03 | "Send rejection message" toggle in Settings (on/off) | SATISFIED | `autoReplyEnabled` checkbox in Settings tab; `autoReply.enabled` field in config schema |

All 10 requirements: SATISFIED. No orphaned or unaccounted requirements.

---

## Anti-Patterns Found

None found. No TODOs, FIXMEs, stub implementations, or empty handlers in any phase 16 files. All new code paths have substantive implementations. The `console.warn` in `auto-reply.ts:81` is a legitimate non-fatal warning (send failure), not a stub.

---

## Human Verification Required

### 1. End-to-end passcode challenge flow

**Test:** Send a DM from an unknown WhatsApp number to the bot with pairing mode enabled; then reply with the correct 6-digit passcode shown in the admin panel
**Expected:** Bot sends challenge message on first DM (zero LLM tokens in logs); correct passcode triggers "Access granted!" response; subsequent DMs reach the LLM normally
**Why human:** Live WhatsApp session required; gateway log inspection needed to confirm zero-token path

### 2. PAIR-{token} deep link authorization

**Test:** Generate a wa.me deep link for a specific JID via the admin panel; send that `PAIR-{token}` text from that contact's WhatsApp number
**Expected:** Bot responds "Access granted!" and contact is added to allowlist with TTL; no passcode challenge sent
**Why human:** Requires real WhatsApp session; HMAC correctness can only be confirmed end-to-end

### 3. Brute-force lockout

**Test:** Send 3 wrong 6-digit passcodes consecutively to the bot
**Expected:** After the 3rd wrong attempt, bot responds "Too many incorrect attempts. Please try again later." and subsequent attempts within 30 minutes return the same lockout message
**Why human:** Requires WhatsApp session to observe response messages

### 4. Auto-reply rate limiting

**Test:** Send 2 DMs from an unauthorized contact with auto-reply enabled (intervalMinutes=1)
**Expected:** First DM triggers rejection message; second DM within 1 minute receives no reply (rate-limited)
**Why human:** Requires WhatsApp session and time-based behavior observation

### 5. Admin panel UI rendering

**Test:** Open admin panel Settings tab; verify Pairing Mode and Auto-Reply sections render correctly; toggle switches; generate passcode; generate deep link for a JID; save config; reload and confirm values persist
**Expected:** All controls render; toggle shows/hides fields; Generate button fills passcode with 6 digits; deep link displays wa.me URL; config round-trips correctly
**Why human:** Visual/UX validation and config persistence requires browser interaction

---

## Gaps Summary

No gaps found. All 10 observable truths are verified, all 7 artifacts are substantive and wired, all 10 requirements are satisfied. The phase goal is fully achieved.

---

_Verified: 2026-03-17T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
