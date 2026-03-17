---
phase: 15-ttl-access
verified: 2026-03-17T16:15:00Z
status: human_needed
score: 10/10 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 8/9
  gaps_closed:
    - "Inbound filter checks expires_at before granting access — expired entries treated as blocked"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Set allow-dm for a contact, set TTL to 30 minutes, wait for expiry, send a WhatsApp message from that contact, check gateway logs"
    expected: "Message is dropped; sender is logged as blocked after TTL expiry"
    why_human: "End-to-end inbound enforcement requires live gateway with real WhatsApp sessions. The file-write approach (syncExpiredToConfig) mirrors the established allow-dm pattern but cannot be verified without observing actual inbound rejection post-expiry."
  - test: "Set TTL to 1 minute via Access Expires dropdown, observe badge countdown"
    expected: "Badge changes from green to yellow to red as time approaches, then shows Expired and entry dims"
    why_human: "Real-time badge refresh and visual transition require live browser session"
  - test: "Set allow-dm for a contact, set TTL via dropdown, wait for sync cycle, check openclaw.json on hpg6 to confirm JID removed from allowFrom array"
    expected: "JID is absent from channels.waha.allowFrom in ~/.openclaw/openclaw.json after the sync interval elapses"
    why_human: "Confirms the file-write path works end-to-end at the file level before testing full inbound rejection"
---

# Phase 15: TTL Access Verification Report

**Phase Goal:** Admins can grant time-limited access to contacts and groups — entries auto-expire without manual cleanup, and the admin panel shows how much time is left
**Verified:** 2026-03-17T16:15:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (Plan 03)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | allow_list table has expires_at INTEGER column (NULL = never expires) | VERIFIED | `src/directory.ts:234` — migration-safe ALTER TABLE adds `expires_at INTEGER DEFAULT NULL`; try/catch for idempotent re-run |
| 2 | isContactAllowedDm returns false for contacts whose expires_at is in the past | VERIFIED | `src/directory.ts:597-601` — SQL: `AND (expires_at IS NULL OR expires_at > strftime('%s','now'))` with DO NOT REMOVE comment |
| 3 | getAllowedDmJids excludes contacts whose expires_at is in the past | VERIFIED | `src/directory.ts:605-608` — same TTL filter applied to allow_list SELECT |
| 4 | setContactAllowDm accepts optional expiresAt parameter | VERIFIED | `src/directory.ts:579` — signature: `setContactAllowDm(jid, allowed, expiresAt?: number \| null)` |
| 5 | PUT /api/admin/directory/:jid/ttl sets or clears expires_at on an allow_list entry | VERIFIED | `src/monitor.ts:4439` — endpoint exists, validates input, calls `db.setContactAllowDm(jid, true, body.expiresAt)` |
| 6 | Sync cycle cleanup deletes allow_list rows where expires_at < now minus 24 hours | VERIFIED | `src/sync.ts:549-556` — `db.cleanupExpiredAllowList()` called at end of runSyncCycle with try/catch |
| 7 | Contact settings card has Access Expires dropdown with Never/30min/1h/4h/24h/7days/Custom options | VERIFIED | `src/monitor.ts:2996-3021` — all 7 options present; preset selection logic via IIFE; custom picker shows on "Custom..." |
| 8 | Active TTL grants show remaining time badge next to contact name (color-coded green/yellow/red) | VERIFIED | `src/monitor.ts:2918-2937` — `formatTtlBadge()` generates badges; green >3600s, yellow >900s, red ≤900s |
| 9 | Expired entries appear grayed out with Expired badge and sorted to bottom | VERIFIED | CSS `.expired-card` (opacity 0.5, gray border) at line 368; `formatTtlBadge` returns "Expired" span; sort at lines 2890-2896 |
| 10 | Expired JIDs are removed from openclaw.json allowFrom during each sync cycle (TTL-03) | VERIFIED | `src/directory.ts:660` — `getExpiredJids()` queries `expires_at <= now`. `src/sync.ts:246` — `syncExpiredToConfig()` reads openclaw.json, filters expired JIDs from `waha.allowFrom`, writes back. `src/sync.ts:533-545` — called in `runSyncCycle` BEFORE the 24h cleanup. `src/sync.ts:13-15` — `readFileSync`, `writeFileSync`, `homedir` imports present. |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/directory.ts` | expires_at column, TTL-aware allow_list queries, getExpiredJids method | VERIFIED | Column migration, TTL filters in isContactAllowedDm + getAllowedDmJids, getContactTtl, cleanupExpiredAllowList, getExpiredCount, getExpiredJids all present |
| `src/sync.ts` | Periodic cleanup and config sync for expired allow_list entries | VERIFIED | `syncExpiredToConfig()` at line 246; `getExpiredJids()` call at line 538; `cleanupExpiredAllowList()` at line 550; node:fs/path/os imports at lines 13-15 |
| `src/monitor.ts` | PUT /api/admin/directory/:jid/ttl endpoint + TTL UI | VERIFIED | Endpoint at line 4439; Access Expires dropdown at 2996; formatTtlBadge at 2918; expired-card CSS at 368; sort at 2890 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/directory.ts` | allow_list table | SQL WHERE clause with expires_at check | VERIFIED | `expires_at IS NULL OR expires_at > strftime('%s','now')` in both isContactAllowedDm and getAllowedDmJids |
| `src/sync.ts` | `src/directory.ts` | cleanup call during sync cycle | VERIFIED | `db.cleanupExpiredAllowList()` at sync.ts:550 |
| `src/sync.ts` | `src/directory.ts` | `db.getExpiredJids()` called during sync cycle | VERIFIED | `sync.ts:538` — call exists before cleanup block |
| `src/sync.ts (syncExpiredToConfig)` | openclaw.json allowFrom | readFileSync/writeFileSync + allowFrom.splice | VERIFIED | `sync.ts:250` reads config; `sync.ts:259` splices expired JIDs; `sync.ts:266` writes back |
| `src/sync.ts (runSyncCycle)` | `syncExpiredToConfig` | TTL-03 block runs before TTL-02 cleanup | VERIFIED | `sync.ts:533-545` TTL-03 block precedes `sync.ts:547-556` TTL-02 block — order is correct |
| `src/monitor.ts (PUT /ttl)` | `src/directory.ts` | `db.setContactAllowDm(jid, true, body.expiresAt)` | VERIFIED | Line 4458 — writes expires_at to allow_list |
| `src/monitor.ts (GET /directory)` | `src/directory.ts (getContactTtl)` | `ttl?.expiresAt ?? null` in enriched response | VERIFIED | Lines 4114-4122 — expiresAt and expired fields in API response |
| `src/monitor.ts (buildContactCard)` | `PUT /api/admin/directory/:jid/ttl` | fetch call in ttlChanged() | VERIFIED | Lines 3126-3132 — immediate PUT on dropdown change |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| TTL-01 | 15-02 | Contact/group settings card has "Access Expires" field with Never/datetime/duration options | SATISFIED | Dropdown with 7 options at monitor.ts:2996; ttlChanged() handler wired via onchange |
| TTL-02 | 15-01 | SQLite allow_list table has expires_at column with automatic expiry enforcement | SATISFIED | Column migration + TTL-filtered queries in directory.ts |
| TTL-03 | 15-03 (gap closure) | Inbound filter checks expires_at before granting access — expired entries treated as blocked | SATISFIED | `getExpiredJids()` + `syncExpiredToConfig()` in sync.ts removes expired JIDs from openclaw.json allowFrom on each sync cycle. Inbound reads from config file — file removal completes the enforcement chain. Mirrors the established allow-dm file-write pattern. |
| TTL-04 | 15-02 | Admin panel shows remaining time on active TTL grants | SATISFIED | formatTtlBadge() generates color-coded badges; rendered in buildContactCard |
| TTL-05 | 15-02 | Expired entries visually marked in Directory (grayed out or badge) | SATISFIED | expired-card CSS class, "Expired" badge, and sort-to-bottom all implemented |

### Anti-Patterns Found

None. Previous blocker (missing syncAllowList call in TTL endpoint) has been addressed via sync-cycle-based removal in Plan 03.

### Human Verification Required

#### 1. End-to-End TTL Enforcement (inbound rejection)

**Test:** Grant DM access to a contact, set a short TTL (30 minutes), wait for the sync cycle interval (default 30 minutes), send a WhatsApp message from that contact, check gateway logs.
**Expected:** Message is dropped with "blocked" reason in gateway logs after TTL expiry.
**Why human:** The TTL-03 fix writes to `openclaw.json` (same mechanism as the working allow-dm endpoint). Whether the gateway picks up the file change at runtime vs requiring a restart cannot be verified programmatically. This test confirms the full chain: SQLite expiry -> sync cycle -> file write -> inbound rejection.

#### 2. Config File Inspection (file-level verification)

**Test:** Grant DM access to a contact, set TTL to 2 minutes via Access Expires dropdown, wait one sync cycle, SSH to hpg6 and inspect `~/.openclaw/openclaw.json`.
**Expected:** The JID is absent from `channels.waha.allowFrom` in the JSON file.
**Why human:** Confirms `syncExpiredToConfig` wrote to the correct file path and the splice logic removed the correct entry. This is a lower-risk first step before testing full inbound rejection.

#### 3. Real-Time Badge Countdown

**Test:** Open admin panel directory, grant TTL access for 2 minutes, observe badge update over time.
**Expected:** Badge shows "Expires in 2m", updates over time, turns red at <15m (immediately here since <1h), shows "Expired" and card dims after 2 minutes.
**Why human:** Real-time visual behavior requires a live browser session.

#### 4. Custom Datetime Picker

**Test:** Click "Custom..." in the Access Expires dropdown, select a future datetime, click Apply.
**Expected:** Picker disappears, toast confirms "Access expires at [datetime]", badge appears on contact card.
**Why human:** Interactive UI behavior — picker show/hide, Apply button, toast message.

### Re-Verification Summary

**Gap closed:** TTL-03 was previously BLOCKED because `inbound.ts` reads `account.config.allowFrom` from the in-memory config object, while TTL expiry was only tracked in SQLite. Expired JIDs remained in `allowFrom` indefinitely.

**Fix implemented (Plan 03):**
- `getExpiredJids()` added to `DirectoryDb` — queries all `allow_list` rows where `expires_at <= now`
- `syncExpiredToConfig()` added to `sync.ts` — reads `openclaw.json`, removes expired JIDs from `waha.allowFrom` array, writes back
- `runSyncCycle` expanded: TTL-03 config removal block runs BEFORE TTL-02 24h SQLite cleanup, so expired rows are still present in SQLite when config sync reads their JIDs

**Architectural note:** The fix uses the same file-write-only pattern as the existing `syncAllowList` function in `monitor.ts` (which powers the working allow-dm toggle). The assumption is that the gateway picks up allowFrom changes from the file, as it does for all allow-dm operations. This cannot be verified programmatically without a live gateway test (see Human Verification item 1).

**Regression check:** All 9 previously-verified truths confirmed intact. No regressions detected.

---

_Verified: 2026-03-17T16:15:00Z_
_Verifier: Claude (gsd-verifier)_
