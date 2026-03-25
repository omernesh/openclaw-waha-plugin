# Requirements: WAHA OpenClaw Plugin — v1.18 Join/Leave/List & Skill Completeness

**Defined:** 2026-03-25
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.18 Requirements

Requirements for Join/Leave/List & Skill Completeness milestone.

### Slash Commands

- [ ] **CMD-01**: User can send `/join <invite-link>` to join a group via WhatsApp invite link without LLM involvement
- [ ] **CMD-02**: User can send `/join <group-name>` to join a group by fuzzy name search, with LLM confirmation on ambiguous matches
- [ ] **CMD-03**: User can send `/leave <group-or-channel-name>` to leave a group/channel by fuzzy name match
- [ ] **CMD-04**: User can send `/list` to see all groups and channels the agent is a member of
- [ ] **CMD-05**: User can send `/list groups` to see only groups
- [ ] **CMD-06**: User can send `/list channels` to see only channels/newsletters

### Invite Links

- [ ] **INV-01**: Agent can retrieve and share a group's invite link when asked
- [ ] **INV-02**: SKILL.md clearly documents getInviteCode, revokeInviteCode, and joinGroup actions

### Admin UI

- [ ] **UI-01**: Directory tab shows a "Leave" action button on each group/channel row
- [ ] **UI-02**: Directory tab has a "Join by Link" input field for joining groups via invite URL
- [ ] **UI-03**: Leave/Join actions provide success/error feedback in the UI

### Skill Completeness

- [ ] **SKL-01**: whatsapp-messenger skill documents ALL implemented WAHA API endpoints (excluding hijacked ones)
- [ ] **SKL-02**: Skill organizes endpoints by category (messaging, groups, contacts, channels, labels, status, presence, profile, media, calls)
- [ ] **SKL-03**: Skill documents the new /join, /leave, /list slash commands

### Testing

- [ ] **TST-01**: Join by invite link tested via WhatsApp
- [ ] **TST-02**: Join by name tested via WhatsApp (exact + ambiguous match)
- [ ] **TST-03**: Leave group/channel tested via WhatsApp
- [ ] **TST-04**: /list, /list groups, /list channels tested via WhatsApp
- [ ] **TST-05**: Invite link retrieval tested via WhatsApp
- [ ] **TST-06**: Admin UI Join/Leave buttons tested via browser

## Future Requirements

None deferred — all features in scope for v1.18.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Join by QR code scan | Requires device camera, not applicable for server-side agent |
| Group creation from slash command | Already available via LLM action, no need to duplicate |
| Bulk join/leave | Edge case, can be added later if needed |
| Newsletter creation from slash command | Low demand, follow/unfollow sufficient |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CMD-01 | — | Pending |
| CMD-02 | — | Pending |
| CMD-03 | — | Pending |
| CMD-04 | — | Pending |
| CMD-05 | — | Pending |
| CMD-06 | — | Pending |
| INV-01 | — | Pending |
| INV-02 | — | Pending |
| UI-01 | — | Pending |
| UI-02 | — | Pending |
| UI-03 | — | Pending |
| SKL-01 | — | Pending |
| SKL-02 | — | Pending |
| SKL-03 | — | Pending |
| TST-01 | — | Pending |
| TST-02 | — | Pending |
| TST-03 | — | Pending |
| TST-04 | — | Pending |
| TST-05 | — | Pending |
| TST-06 | — | Pending |

**Coverage:**
- v1.18 requirements: 20 total
- Mapped to phases: 0
- Unmapped: 20

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 after initial definition*
