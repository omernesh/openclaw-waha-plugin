---
gsd_state_version: 1.0
milestone: v1.18
milestone_name: Join/Leave/List & Skill Completeness
status: Ready to plan
stopped_at: Completed 44-01-PLAN.md
last_updated: "2026-03-25T19:58:27.821Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 3
  completed_plans: 3
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-25)

**Core value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.
**Current focus:** Phase 44 — invite-link-documentation

## Current Position

Phase: 45
Plan: Not started

## Accumulated Context

### Decisions

- All WAHA join/leave/follow/unfollow APIs already exist in send.ts — this is a UX + discoverability milestone
- Slash commands (/join, /leave, /list) go in inbound.ts, before LLM processing
- Fuzzy name resolution reuses autoResolveTarget from channel.ts
- Ambiguous matches (non-exact) escalate to LLM for user confirmation
- Join supports both invite links AND group names
- Leave by name only (JID not user-friendly)
- /list supports filters: groups, channels, or all
- Admin UI adds Leave button + Join by Link input to directory tab
- Skill audit excludes "hijacked" endpoints (e.g., sendText used for human behavior mimicry)
- getInviteCode action already exists but SKILL.md doesn't document it clearly
- Phase 44 (docs) is independent of Phase 43 (code) — can run in parallel
- Phase 45 (Admin UI) is independent — React SPA addition to src/admin/
- Phase 46 depends on Phase 44 for audit scope completeness
- Phase 47 (testing) depends on all prior phases
- [Phase 43-slash-commands]: name-based /join returns Already a member (resolveWahaTarget only finds groups bot already belongs to)
- [Phase 43-slash-commands]: PendingSelectionRecord type extended with join/leave (SQLite TEXT column, no migration needed)
- [Phase 43-slash-commands]: Reuse checkShutupAuthorization for /join /leave /list authorization (same admin gate)
- [Phase 43-slash-commands]: Guard pending selection block with !slashMatch to prevent slash commands being treated as numbered replies
- [Phase 44-invite-link-documentation]: Expanded Group Management table to 3-column format to accommodate return value descriptions
- [Phase 44-invite-link-documentation]: Placed /join /leave /list section before /shutup section per plan ordering requirement

### Pending Todos

None.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260320-hoy | Embed WAHA WhatsApp pages into OpenClaw Mission Control dashboard | 2026-03-20 | b300c98 | [260320-hoy-embed-waha-whatsapp-pages-into-openclaw-](./quick/260320-hoy-embed-waha-whatsapp-pages-into-openclaw-/) |
| 260320-k2e | Restore per-group filter override UI in React admin panel | 2026-03-20 | 9a0d101 | [260320-k2e-restore-all-old-gui-features-from-pre-vi](./quick/260320-k2e-restore-all-old-gui-features-from-pre-vi/) |
| 260320-rii | Restore all missing old GUI features to React admin panel | 2026-03-20 | be3c87e | [260320-rii-restore-all-missing-old-gui-features-to-](./quick/260320-rii-restore-all-missing-old-gui-features-to-/) |
| 260320-u7x | Directory tab complete overhaul — avatars, stacked layout, pagination, action buttons | 2026-03-20 | a74432c | [260320-u7x-directory-tab-complete-overhaul-avatars-](./quick/260320-u7x-directory-tab-complete-overhaul-avatars-/) |
| 260321-4i9 | Session-aware trigger reply routing — bot session used for groups where bot is a member | 2026-03-21 | 24aeafd | [260321-4i9-fix-operator-to-invoke-sammie-in-any-cha](./quick/260321-4i9-fix-operator-to-invoke-sammie-in-any-cha/) |
| 260324-mbd | Fix bulk allow-dm not persisting + add timed DM access with duration picker | 2026-03-24 | 1d6481f | [260324-mbd-fix-bulk-allow-dm-not-persisting-add-tim](./quick/260324-mbd-fix-bulk-allow-dm-not-persisting-add-tim/) |
| 260324-mxr | Add 1h+5h expiry to contact card + push v1.16.18 | 2026-03-24 | 0f888a1 | [260324-mxr-add-1h-5h-expiry-to-contact-card-push-it](./quick/260324-mxr-add-1h-5h-expiry-to-contact-card-push-it/) |
| 260324-sl3 | Fix unauthorized DM response: isDm guard covers @c.us + @lid, excludes groups/newsletters | 2026-03-24 | pending | [260324-sl3-fix-unauthorized-dm-response-when-enable](./quick/260324-sl3-fix-unauthorized-dm-response-when-enable/) |
| 260324-sl3 | Fix unauthorized DM response firing on newsletter chatIds | 2026-03-24 | dfa4035 | [260324-sl3-fix-unauthorized-dm-response-when-enable](./quick/260324-sl3-fix-unauthorized-dm-response-when-enable/) |

## Session Continuity

Last session: 2026-03-25T19:55:28.483Z
Stopped at: Completed 44-01-PLAN.md
Resume file: None
