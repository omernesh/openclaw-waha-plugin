---
phase: 43-slash-commands
plan: 01
subsystem: messaging
tags: [slash-commands, whatsapp, group-management, fuzzy-matching, sqlite]

requires:
  - phase: 07-shutup
    provides: checkShutupAuthorization, handleSelectionResponse, PendingSelectionRecord pattern
  - phase: send.ts
    provides: joinWahaGroup, leaveWahaGroup, getWahaGroups, getWahaChannels, unfollowWahaChannel, resolveWahaTarget

provides:
  - "src/commands.ts: COMMANDS_RE regex, handleSlashCommand dispatcher, handleCommandSelectionResponse"
  - "PendingSelectionRecord type extended with join/leave variants"
  - "/join handler: invite link extraction + name-based fuzzy search with pending selection flow"
  - "/leave handler: auto-resolves groups and channels, executes leave/unfollow"
  - "/list handler: formatted group + channel listing with emoji prefixes and filter support"

affects: [inbound.ts, 43-02]

tech-stack:
  added: []
  patterns:
    - "Slash command file (commands.ts) follows shutup.ts structure exactly"
    - "Authorization reuses checkShutupAuthorization from shutup.ts"
    - "Pending selections stored across ALL account DBs for cross-session resilience"
    - "All WAHA calls wrapped in try/catch with user-facing error replies"

key-files:
  created:
    - src/commands.ts
  modified:
    - src/directory.ts

key-decisions:
  - "For name-based /join, bot can only see groups it already belongs to — reply 'Already a member'"
  - "Invite link detection: chat.whatsapp.com/ OR raw 22+ alphanumeric code"
  - "handleList: getWahaGroups returns dict (Object.values), getWahaChannels returns array"
  - "handleLeave filters resolveWahaTarget results to @g.us and @newsletter only"
  - "PendingSelectionRecord type union extended (SQLite TEXT column, no migration needed)"

patterns-established:
  - "COMMANDS_RE: /^\\/(join|leave|list)\\s*(.*)?$/i"
  - "All slash command replies use bypassPolicy: true to bypass mute/filter checks"

requirements-completed: [CMD-01, CMD-02, CMD-03, CMD-04, CMD-05, CMD-06]

review_status: skipped

duration: 8min
completed: 2026-03-25
---

# Phase 43 Plan 01: Slash Commands — commands.ts Summary

**regex-based /join, /leave, /list WhatsApp commands that bypass the LLM for direct group/channel management via invite links and fuzzy name matching**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-25T19:20:00Z
- **Completed:** 2026-03-25T19:28:24Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/commands.ts` (456 lines) with all six CMD requirements implemented
- Extended `PendingSelectionRecord` type to support "join" and "leave" selection flows
- `/join` handles both invite links (URL or raw code) and fuzzy name search with numbered disambiguation
- `/leave` resolves groups/channels via fuzzy search, filters out contacts, executes leave/unfollow
- `/list` fetches groups + channels with emoji-prefixed output and groups/channels/all filter support
- Authorization reuses `checkShutupAuthorization` from shutup.ts for consistency

## Task Commits

1. **Task 1: Extend PendingSelectionRecord type** - `b77316b` (feat)
2. **Task 2: Create src/commands.ts** - `59b3622` (feat)

## Files Created/Modified

- `src/commands.ts` — COMMANDS_RE regex, handleSlashCommand dispatcher, handleJoin/handleLeave/handleList/handleCommandSelectionResponse
- `src/directory.ts` — PendingSelectionRecord type extended with "join" | "leave" union variants

## Decisions Made

- For name-based /join, `resolveWahaTarget` only finds groups the bot already belongs to — reply "Already a member" is correct behavior (joining requires an invite code we don't have for unknown groups)
- Invite link detection: either contains `chat.whatsapp.com/` or is a 22+ character alphanumeric string
- `/leave` uses `type: "auto"` to search both groups and channels, then filters to `@g.us` and `@newsletter` JIDs only
- `handleList` uses `Object.values()` on groups response (WAHA quirk: returns dict not array) but channels are already an array
- Pending selections stored across ALL account DBs following the shutup.ts cross-session pattern

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — TypeScript compiled cleanly on first pass.

## Review Findings

Review skipped (mandatory_review not triggered for this plan).

## Next Phase Readiness

- `src/commands.ts` is ready to be wired into `inbound.ts` (Plan 43-02)
- `COMMANDS_RE` export and `handleSlashCommand` / `handleCommandSelectionResponse` functions match the integration contract expected by Plan 43-02
- `PendingSelectionRecord` now supports all four selection types needed by both shutup.ts and commands.ts

---
*Phase: 43-slash-commands*
*Completed: 2026-03-25*
