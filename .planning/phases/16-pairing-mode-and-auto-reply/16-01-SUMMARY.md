---
phase: 16-pairing-mode-and-auto-reply
plan: "01"
subsystem: pairing-engine
tags: [pairing, auto-reply, sqlite, hmac, passcode, rate-limiting]
dependency_graph:
  requires: []
  provides: [PairingEngine, AutoReplyEngine, pairing_challenges table, auto_reply_log table]
  affects: [src/directory.ts, src/config-schema.ts]
tech_stack:
  added: [node:crypto (createHmac, createHash, randomInt, timingSafeEqual, randomBytes)]
  patterns: [singleton getter, migration-safe ALTER TABLE, HMAC deep-link token]
key_files:
  created:
    - src/pairing.ts
    - src/auto-reply.ts
  modified:
    - src/directory.ts
    - src/config-schema.ts
decisions:
  - "Pairing challenges stored in SQLite pairing_challenges table via DirectoryDb public API (not private db cast)"
  - "HMAC tokens are stateless — 12 hex chars from hmac(jid, hmacSecret), no DB lookup on verify"
  - "Brute-force: 3 wrong attempts locks challenge for 30 min (locked_until column)"
  - "Challenge expiry: 24 hours from created_at"
  - "Auto-reply rate limit stored in auto_reply_log table via DirectoryDb.recordAutoReply()"
  - "PairingEngine accesses SQLite via new DirectoryDb public API methods, not private db cast"
  - "Source and granted_at columns added to allow_list via migration-safe ALTER TABLE"
metrics:
  duration: "~6 minutes"
  completed_date: "2026-03-17"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 16 Plan 01: Pairing Engine and Auto-Reply Engine Summary

**One-liner:** HMAC deep-link + passcode-challenge pairing engine with brute-force lockout and rate-limited rejection auto-reply using SQLite persistence.

## What Was Built

### src/pairing.ts — PairingEngine

- `createChallenge(jid)`: generates 6-digit passcode (randomInt), SHA-256 hashes it, stores in `pairing_challenges` SQLite table. Returns plaintext passcode for admin display.
- `verifyPasscode(jid, attempt)`: SHA-256 compares attempt against stored hash. Tracks attempts, locks for 30 minutes after 3 failures, returns structured result (`correct | wrong | locked | expired | not_found`).
- `generateDeepLinkToken(jid)`: HMAC-SHA256(jid, hmacSecret) truncated to 12 hex chars for wa.me deep links.
- `verifyDeepLinkToken(senderJid, text)`: extracts `PAIR-{12hex}` from message, recomputes expected token, compares with `timingSafeEqual` to prevent timing attacks.
- `hasActiveChallenge(jid)`: checks if challenge exists and is within 24-hour window.
- `getActiveGrants() / revokeGrant()`: delegates to DirectoryDb pairing grant helpers.
- `grantAccess(jid, grantTtlMinutes)`: calls `setContactAllowDmWithSource` with source='pairing' and TTL.
- Singleton: `getPairingEngine(accountId, hmacSecret)` per-account factory.
- `generateHmacSecret()`: returns 64-char hex from 32 random bytes, for config initialization.

### src/auto-reply.ts — AutoReplyEngine

- `shouldReply(jid, intervalSeconds)`: checks `auto_reply_log.last_reply_at`, returns true if not seen or older than interval.
- `sendRejection(params)`: resolves template vars (`{admin_name}`, `{phone}`, `{jid}`), sends via `sendWahaText`, records timestamp in `auto_reply_log`. Non-fatal on send failure.
- `resolveTemplate(template, vars)`: static regex replace `{key}` to value, unknown keys become empty string.
- Singleton: `getAutoReplyEngine(accountId)` per-account factory.

### src/directory.ts — Schema and Methods

New tables:
- `pairing_challenges (jid PK, passcode_hash, created_at, attempts, locked_until)`
- `auto_reply_log (jid PK, last_reply_at)`

New columns on `allow_list` (migration-safe ALTER TABLE):
- `source TEXT DEFAULT NULL` — tracks grant origin ('pairing' vs NULL for manual)
- `granted_at INTEGER DEFAULT NULL` — Unix seconds when grant was made

New methods:
- `getPairingGrants()`, `setContactAllowDmWithSource()`, `revokePairingGrant()`
- `upsertPairingChallenge()`, `getPairingChallenge()`, `updatePairingChallengeAttempts()`, `deletePairingChallenge()`
- `getAutoReplyLastSent()`, `recordAutoReply()`

### src/config-schema.ts — Config Fields

Added to `WahaAccountSchemaBase`:
- `pairingMode: { enabled, passcode, grantTtlMinutes(default 1440), challengeMessage, hmacSecret }` — optional, defaults to `{}`
- `autoReply: { enabled, message(template string), intervalMinutes(default 1440) }` — optional, defaults to `{}`

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: Create modules | ea4cb77 | src/pairing.ts, src/auto-reply.ts |
| Task 2: Schema and config | 2903014 | src/directory.ts, src/config-schema.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Avoided private field access anti-pattern**
- **Found during:** Task 1 implementation
- **Issue:** Initial design cast DirectoryDb to access private `db` property — would cause TypeScript compile error
- **Fix:** Added public helper methods to DirectoryDb for all pairing/auto-reply SQLite operations, then used those in PairingEngine/AutoReplyEngine
- **Files modified:** src/directory.ts (added 10 new public methods), src/pairing.ts, src/auto-reply.ts
- **Commit:** 2903014

**2. [Rule 1 - Bug] SQLite db.prepare pattern used throughout**
- **Found during:** Task 2
- **Issue:** Security hook flagged `db.exec()` (SQLite's exec, not child_process) as potential command injection
- **Fix:** Used `db.prepare(...).run()` pattern consistently with all other migrations in the file
- **Files modified:** src/directory.ts
- **Commit:** 2903014

## Self-Check: PASSED

- src/pairing.ts: FOUND
- src/auto-reply.ts: FOUND
- src/directory.ts: FOUND
- src/config-schema.ts: FOUND
- Commit ea4cb77: FOUND
- Commit 2903014: FOUND
