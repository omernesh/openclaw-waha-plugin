---
phase: 56-adaptive-activity-patterns
verified: 2026-03-27T23:30:00Z
status: passed
score: 5/5 must-haves verified
gaps: []
human_verification:
  - test: "Send a message to a chat that has a learned activity profile and verify gate uses profile hours"
    expected: "Message allowed when inside profile's peak window even if outside global gate window"
    why_human: "Requires live WAHA session with real message history and an active scannerstate"
  - test: "Wait for scanner to complete a full pass on hpg6 and confirm chat_activity_profiles rows populated"
    expected: "SQLite table contains rows with realistic peakStartHour/peakEndHour for active chats"
    why_human: "Requires time (7-day scan window) and production deployment to observe real data"
---

# Phase 56: Adaptive Activity Patterns — Verification Report

**Phase Goal:** The system learns per-chat active hours from message history and automatically aligns send gates to observed human activity patterns
**Verified:** 2026-03-27T23:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SQLite table `chat_activity_profiles` exists storing per-chat busiest hours derived from last 7 days of message history | VERIFIED | `directory.ts:355` — `CREATE TABLE IF NOT EXISTS chat_activity_profiles` with `peak_start_hour`, `peak_end_hour`, `scanned_at` columns; `directory.test.ts` 4 tests green |
| 2 | Activity profile scans run incrementally during off-peak hours without stalling other send operations | VERIFIED | `activity-scanner.ts:89` — `isOffPeak()` calls `resolveGateConfig+checkTimeOfDay`; `tick()` at line 282 returns early with 30-min retry when not off-peak; `BATCH_SIZE=10` chats per tick with 500ms inter-chat sleep; AbortSignal checked throughout |
| 3 | When a chat has an activity profile, the time gate uses that chat's peak hours instead of the global/session default window | VERIFIED | `mimicry-enforcer.ts:102-117` — Step 2b block: if no manual override, calls `dirDb.getActivityProfile(chatId)` and sets `targetGateOverride = { startHour: profile.peakStartHour, endHour: profile.peakEndHour }`; `send-pipeline.test.ts:384` — ADAPT-04 test verifies profile overrides blocking global gate |
| 4 | When no profile exists for a chat, the system falls back to global or session-level gate configuration without error | VERIFIED | `mimicry-enforcer.ts:106-116` — `if (profile)` guard; catch swallows any `getActivityProfile` errors; `send-pipeline.test.ts:448` — ADAPT-05 test confirms null profile falls back silently to global config |
| 5 | Activity profiles are rescanned automatically each week, overwriting stale data | VERIFIED | `activity-scanner.ts:35` — `FULL_PASS_DELAY_MS = 7 * 24 * 60 * 60_000`; `tick():309` — `scheduleNext(opts, state, FULL_PASS_DELAY_MS)` after full pass; `upsertActivityProfile` uses `INSERT ... ON CONFLICT(jid) DO UPDATE` for overwrite; `activity-scanner.test.ts:238` — rescan overwrite test green |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/activity-scanner.ts` | Background scanner with `computePeakWindow`, `fetchRecentTimestamps`, `tick`, `startActivityScanner` | VERIFIED | 14 KB, all 4 functions present and substantive; exports `startActivityScanner` and `computePeakWindow` |
| `src/directory.ts` | `chat_activity_profiles` table + `upsertActivityProfile` + `getActivityProfile` + `getChatsNeedingRescan` | VERIFIED | All 3 methods at lines 1517, 1542, 1564; table DDL at line 355; `ActivityProfile` type exported at line 101 |
| `src/activity-scanner.test.ts` | Tests for ADAPT-01, ADAPT-02, ADAPT-03 | VERIFIED | 9 tests covering `computePeakWindow` (5 cases) + scanner tick/pagination/rescan (4 cases); all passing |
| `src/directory.test.ts` | Tests for activity profile CRUD | VERIFIED | 4 tests in `describe("activity profile")` block at line 416; all passing |
| `src/mimicry-enforcer.ts` | Activity profile lookup in Step 2b of `enforceMimicry` | VERIFIED | Step 2b block at lines 102-117; uses `getActivityProfile`; manual override precedence enforced |
| `src/channel.ts` | `startActivityScanner` call after `startDirectorySync` | VERIFIED | Import at line 26; call at lines 1138-1143 sharing same `abortSignal` |
| `src/send-pipeline.test.ts` | Tests for ADAPT-04 (profile applied) and ADAPT-05 (null fallback) | VERIFIED | 4 tests in `describe("activity profile gate adaptation")` block; all 4 passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/activity-scanner.ts` | `src/directory.ts` | `upsertActivityProfile` / `getChatsNeedingRescan` calls | WIRED | `activity-scanner.ts:219` calls `getChatsNeedingRescan`; line 246 calls `upsertActivityProfile` |
| `src/activity-scanner.ts` | `src/mimicry-gate.ts` | `checkTimeOfDay` / `resolveGateConfig` for off-peak guard | WIRED | Import at line 17; used in `isOffPeak()` at lines 92-94 |
| `src/mimicry-enforcer.ts` | `src/directory.ts` | `getActivityProfile(chatId)` call | WIRED | Line 109 calls `dirDb.getActivityProfile(chatId)` |
| `src/channel.ts` | `src/activity-scanner.ts` | `startActivityScanner()` import and call | WIRED | Import at line 26; call at lines 1138-1143 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/mimicry-enforcer.ts` | `targetGateOverride` (from profile) | `dirDb.getActivityProfile(chatId)` → SQLite `chat_activity_profiles` table | Yes — reads from `peak_start_hour`/`peak_end_hour` columns; populated by scanner from real WAHA message history | FLOWING |
| `src/activity-scanner.ts` | `timestamps[]` | `getWahaChatMessages` WAHA API → paginated real message objects | Yes — fetches from live WAHA API; multiplies Unix seconds by 1000 | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED for live WAHA API calls (requires running server). Test suite covers all unit-testable behaviors.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `computePeakWindow` returns null for sparse data | vitest run activity-scanner.test.ts | 9/9 pass | PASS |
| Scanner skips when on-peak | vitest run activity-scanner.test.ts | 9/9 pass | PASS |
| Pagination stops at 500 messages | vitest run activity-scanner.test.ts | 9/9 pass | PASS |
| Profile overrides global gate (ADAPT-04) | vitest run send-pipeline.test.ts | 4/4 pass | PASS |
| Null profile falls back to global (ADAPT-05) | vitest run send-pipeline.test.ts | 4/4 pass | PASS |
| Full regression suite | npm test | 683/683 pass | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ADAPT-01 | 56-01 | Scan last 7 days of message history to build per-chat activity profiles | SATISFIED | `fetchRecentTimestamps` paginates 7-day window; `computePeakWindow` derives peak hours; profile stored via `upsertActivityProfile` |
| ADAPT-02 | 56-01 | Profiles stored in SQLite, rescanned weekly | SATISFIED | `chat_activity_profiles` table in DirectoryDb; `FULL_PASS_DELAY_MS = 7 days`; upsert overwrites stale rows |
| ADAPT-03 | 56-01 | Scanning runs incrementally during off-peak hours | SATISFIED | `isOffPeak()` guard in `tick()`; `BATCH_SIZE=10` per tick; 500ms inter-chat sleep; off-peak retry = 30 min |
| ADAPT-04 | 56-02 | Time gates adapt per-chat based on activity profile | SATISFIED | Step 2b in `mimicry-enforcer.ts`; `send-pipeline.test.ts` ADAPT-04 test passes |
| ADAPT-05 | 56-02 | Fallback to global/session gate when no profile | SATISFIED | `if (profile)` guard + catch block in Step 2b; ADAPT-05 test passes |

**Note:** REQUIREMENTS.md traceability table (lines 107-108) and checkbox list (lines 54-55) still show ADAPT-04 and ADAPT-05 as "Pending" — these are documentation stale entries. The implementation is complete and tested. REQUIREMENTS.md should be updated to mark both as Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODO, FIXME, placeholder, or empty-return stubs found in phase-modified files.

### Human Verification Required

#### 1. Live Activity Profile Population

**Test:** Deploy to hpg6, wait for scanner to complete at least one off-peak tick, then query the SQLite DB: `SELECT * FROM chat_activity_profiles LIMIT 10`
**Expected:** Rows present with realistic `peak_start_hour`/`peak_end_hour` values for active chats
**Why human:** Scanner runs only during off-peak hours with a 30s startup delay; requires live WAHA message history to produce real data

#### 2. End-to-End Gate Override in Production

**Test:** Identify a chat with a learned profile, attempt to send via the agent at a time inside the profile's peak window but outside the global gate window
**Expected:** Send succeeds (profile overrides global gate), not blocked
**Why human:** Requires production deployment, real message history, and timing relative to profile peak hours

### Gaps Summary

No gaps found. All 5 success criteria verified against the codebase:

1. `chat_activity_profiles` table exists with correct schema — VERIFIED
2. Incremental off-peak scanning without blocking — VERIFIED
3. Per-chat peak hours override global gate — VERIFIED
4. Graceful fallback to global config when no profile — VERIFIED
5. Weekly rescan via 7-day `scheduleNext` delay + upsert overwrite — VERIFIED

One documentation staleness item: REQUIREMENTS.md shows ADAPT-04 and ADAPT-05 as Pending/unchecked. This is a docs-only issue; the code is correct. Recommend updating REQUIREMENTS.md as a cleanup step.

---

_Verified: 2026-03-27T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
