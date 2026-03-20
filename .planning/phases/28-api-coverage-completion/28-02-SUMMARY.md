---
phase: 28-api-coverage-completion
plan: 02
subsystem: api
tags: [webhook, group-events, api-keys, waha, directory]

# Dependency graph
requires:
  - phase: 28-api-coverage-completion/28-01
    provides: Phase 28 plan 01 API additions context
provides:
  - group.join/group.leave webhook handlers in monitor.ts
  - Directory upsert on participant join
  - 4 API key CRUD functions in send.ts
  - createApiKey/getApiKeys/updateApiKey/deleteApiKey in channel.ts ACTION_HANDLERS + UTILITY_ACTIONS
  - SKILL.md Group Membership Events and API Keys sections
affects: [directory-sync, inbound-pipeline, agent-api-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Synthetic message pattern for non-message webhook events (group.join/group.leave)"
    - "Directory update on join events via bulkUpsertGroupParticipants"
    - "API key functions use /api/keys directly (server-scoped, not resolveSessionPath)"

key-files:
  created: []
  modified:
    - src/monitor.ts
    - src/send.ts
    - src/channel.ts
    - SKILL.md

key-decisions:
  - "group.leave does not remove participant from DirectoryDb — no removal method exists; row kept as historical record, future sync cleans stale entries"
  - "API key endpoints are server-scoped (/api/keys), not session-scoped — no resolveSessionPath"
  - "group join updates directory via bulkUpsertGroupParticipants with isAdmin=false default"

patterns-established:
  - "Synthetic message for webhook events: messageId uniqueness via action+timestamp+jid, dedup via isDuplicate()"

requirements-completed: [API-06, API-07]

# Metrics
duration: 15min
completed: 2026-03-20
---

# Phase 28 Plan 02: Group Events and API Keys Summary

**Group join/leave webhook events converted to synthetic inbound messages with directory tracking, plus 4 WAHA API key CRUD actions wired end-to-end**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-20T05:00:00Z
- **Completed:** 2026-03-20T05:15:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- group.join and group.leave webhook events handled in monitor.ts with dedup, synthetic WahaInboundMessage creation, and enqueue
- On group.join: participant upserted into DirectoryDb via bulkUpsertGroupParticipants
- createWahaApiKey, getWahaApiKeys, updateWahaApiKey, deleteWahaApiKey added to send.ts and wired in channel.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Handle group webhook events in monitor.ts** - `7d61212` (feat)
2. **Task 2: Add API Keys CRUD functions and wire to channel.ts** - `61daa2b` (feat)

**Plan metadata:** (final commit below)

## Files Created/Modified
- `src/monitor.ts` - Added group.join/group.leave event handler block with dedup, synthetic message creation, and directory upsert
- `src/send.ts` - Added 4 API key CRUD functions (createWahaApiKey, getWahaApiKeys, updateWahaApiKey, deleteWahaApiKey)
- `src/channel.ts` - Imported 4 API key functions, added to ACTION_HANDLERS and UTILITY_ACTIONS
- `SKILL.md` - Added "Group Membership Events" and "API Keys Management" sections

## Decisions Made
- group.leave does not remove the participant from DirectoryDb — no removal method exists on the class. The row stays as a historical record; a future directory sync will clean stale entries. This avoids adding a new DirectoryDb method in this plan's scope.
- API key endpoints are server-scoped (not session-scoped), so they use `/api/keys` directly rather than `resolveSessionPath`. This follows the WAHA API design.
- Directory update on group.join uses `bulkUpsertGroupParticipants` with `isAdmin: false` as a safe default; a full sync will correct admin status if needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used correct DirectoryDb methods instead of non-existent ones**
- **Found during:** Task 1 (group event handler)
- **Issue:** Plan interface snippet referenced `upsertGroupParticipant` and `removeGroupParticipant` which don't exist on DirectoryDb
- **Fix:** Used existing `bulkUpsertGroupParticipants` for join; left leave as no-op with comment explaining rationale
- **Files modified:** src/monitor.ts
- **Verification:** TypeScript compile passes
- **Committed in:** 7d61212

**2. [Rule 1 - Bug] Used getDirectoryDb() instead of opts.dirDb**
- **Found during:** Task 1 (group event handler)
- **Issue:** opts in the webhook handler has no dirDb field; pattern is getDirectoryDb(accountId) throughout monitor.ts
- **Fix:** Used getDirectoryDb(account.accountId) directly, consistent with all other handler blocks
- **Files modified:** src/monitor.ts
- **Verification:** TypeScript compile passes
- **Committed in:** 7d61212

---

**Total deviations:** 2 auto-fixed (both Rule 1 - bugs in plan interface sketch)
**Impact on plan:** Both fixes necessary for correct compilation and runtime behavior. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## Next Phase Readiness
- Phase 28 Plan 03 can proceed; no blockers
- group.leave participant removal deferred pending DirectoryDb method addition (not blocking)

---
*Phase: 28-api-coverage-completion*
*Completed: 2026-03-20*
