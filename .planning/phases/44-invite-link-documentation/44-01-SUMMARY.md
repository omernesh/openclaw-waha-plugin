---
phase: 44-invite-link-documentation
plan: "01"
subsystem: documentation
tags: [skill-md, invite-codes, slash-commands, agent-docs]
dependency_graph:
  requires: [43-slash-commands]
  provides: [invite-code-docs, slash-command-docs]
  affects: [SKILL.md]
tech_stack:
  added: []
  patterns: [agent-facing-docs, example-blocks]
key_files:
  created: []
  modified:
    - SKILL.md
decisions:
  - Expanded Group Management table to 3-column format to accommodate return value descriptions
  - Placed /join /leave /list section before /shutup section per plan ordering
metrics:
  duration: "166s"
  completed: "2026-03-25T19:53:37Z"
  tasks_completed: 2
  files_changed: 1
requirements:
  - INV-01
  - INV-02
---

# Phase 44 Plan 01: Invite Link Documentation Summary

**One-liner:** Added getInviteCode/revokeInviteCode return value docs and /join /leave /list slash command reference to SKILL.md.

## What Was Changed in SKILL.md

### Sections Expanded

**Group Management table (lines ~131-152):**
- Replaced sparse `| getInviteCode / revokeInviteCode | groupId |` row with 3 separate expanded rows
- `getInviteCode` row now documents return shape: `{ inviteCode, inviteLink }` with full URL description
- `revokeInviteCode` row explains it revokes current link and returns a new `{ inviteCode, inviteLink }`
- `joinGroup` row clarifies inviteCode format: part AFTER `chat.whatsapp.com/` — not the full URL
- Table upgraded from 2-column to 3-column format (Action | Parameters | Notes)
- Removed duplicate bare `joinGroup` row, keeping only the expanded version

**Invite Links — Examples block (new, after Group Management table):**
- `getInviteCode` example with expected return value shape
- `send` example showing how to share the link
- `revokeInviteCode` example
- `joinGroup` example showing code extraction from URL

### Sections Added

**`# /join, /leave, /list Commands` (new section before /shutup):**
- Authorization gate documented (godModeSuperUsers + allowFrom, same as /shutup)
- `/join` table with 4 variants: invite link, raw code, by name, ambiguous name
- Note explaining name-based /join only finds groups bot already belongs to
- `/leave` table with fuzzy search + disambiguation behavior
- `/leave` documents both `leaveGroup` (groups) and `unfollowChannel` (channels/newsletters)
- `/list` table with `/list`, `/list groups`, `/list channels` variants
- Example output showing numbered groups and channels

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- SKILL.md: FOUND
- 44-01-SUMMARY.md: FOUND
- Commit 63eeb49 (Task 1): FOUND
- Commit 5ffc727 (Task 2): FOUND
