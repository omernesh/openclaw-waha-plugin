---
phase: 49-modular-skill-architecture
plan: "01"
subsystem: documentation
tags: [skill-files, documentation, whatsapp, agent-instructions]
dependency_graph:
  requires: []
  provides: [skills/messaging.md, skills/groups.md, skills/contacts.md, skills/channels.md, skills/chats.md]
  affects: [SKILL.md index restructure (plan 02)]
tech_stack:
  added: []
  patterns: [per-category markdown skill files, action tables, task-oriented examples, gotchas sections]
key_files:
  created:
    - skills/messaging.md
    - skills/groups.md
    - skills/contacts.md
    - skills/channels.md
    - skills/chats.md
  modified: []
decisions:
  - "Labels placed in chats.md (not a separate file) with WhatsApp Business caveat — matches research recommendation"
  - "readMessages vs read comparison table in messaging.md — explicit disambiguation for common confusion"
  - "Channel invite code gotcha placed at top of channels.md with bold warning — highest-impact gotcha"
metrics:
  duration_seconds: 224
  completed_date: "2026-03-26"
  tasks_completed: 2
  files_created: 5
  files_modified: 0
requirements_addressed: [SKL-02, SKL-03, SKL-07]
---

# Phase 49 Plan 01: Skill Category Files (Core 5) Summary

Created 5 per-category skill instruction files covering the highest-action-count WhatsApp categories.

## One-Liner

5 self-contained category skill files: messaging (22 actions + iCal), groups (26 actions), contacts (8 actions + vCard 3-method guide), channels (14 actions + invite code gotcha), chats (15 actions + labels Business caveat).

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create messaging.md, groups.md, contacts.md | c4c173a | skills/messaging.md, skills/groups.md, skills/contacts.md |
| 2 | Create channels.md and chats.md | 0fcb0fe | skills/channels.md, skills/chats.md |

## What Was Built

### skills/messaging.md
- All 10 standard actions (send, reply, poll, react, edit, unsend, pin, unpin, read, delete)
- 12 rich message utility actions including starMessage (was missing from SKILL.md tables)
- `readMessages` vs `read` comparison table — explicit disambiguation
- iCal section: both `sendEvent` (native WhatsApp event) and `sendFile` with `.ics` (external calendar interop)
- Gotchas: poll parameters, full messageId format, sendButtons deprecated, NOWEB poll.vote unreliability

### skills/groups.md
- All 26 group actions across 5 categories (query, create/delete, join, settings, participants)
- Invite code workflow: getInviteCode → share → joinGroup with code extraction
- demoteFromAdmin/demoteToMember alias documented
- NOWEB @lid JID requirement for addParticipants documented

### skills/contacts.md
- All 8 contact actions including createOrUpdateContact (ACT-03 new in Phase 48)
- vCard documented with 3 methods: send+contacts[], sendContactVcard, sendFile with .vcf
- phoneNumber format gotcha: country code + digits, NO + prefix
- When to use which vCard method (comparison table)

### skills/channels.md
- All 14 channel actions
- Invite code vs JID gotcha prominently placed at file top and in Gotchas section
- WAHA silent no-op warning (followChannel with wrong ID returns 200 but does nothing)
- previewChannelMessages documented (no follow required)

### skills/chats.md
- All 15 chat management actions
- Labels section with WhatsApp Business only caveat
- Alias pairs: clearMessages/clearChatMessages, readChatMessages/read
- readMessages vs read vs readChatMessages disambiguation table
- muteChat duration in seconds documented

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all files are complete self-contained documentation.

## Self-Check: PASSED

Files verified:
- skills/messaging.md: FOUND
- skills/groups.md: FOUND
- skills/contacts.md: FOUND
- skills/channels.md: FOUND
- skills/chats.md: FOUND

Commits verified:
- c4c173a: FOUND (feat(49-01): create messaging.md, groups.md, contacts.md skill files)
- 0fcb0fe: FOUND (feat(49-01): create channels.md and chats.md skill files)

Content checks:
- sendEvent in messaging.md: PASS
- ics in messaging.md: PASS
- addParticipants in groups.md: PASS
- vcf in contacts.md: PASS
- createOrUpdateContact in contacts.md: PASS
- followChannel in channels.md: PASS
- invite code in channels.md: PASS
- archiveChat in chats.md: PASS
- WhatsApp Business in chats.md: PASS
