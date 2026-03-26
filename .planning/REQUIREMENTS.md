# Requirements: WAHA OpenClaw Plugin — v1.19 Full WAHA Capabilities & Modular Skill Architecture

**Defined:** 2026-03-26
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.19 Requirements

### Action Exposure

- [x] **ACT-01**: All group admin actions exposed in UTILITY_ACTIONS (addParticipants, removeParticipants, promoteToAdmin, demoteToMember, setGroupSubject, setGroupDescription, setGroupPicture, deleteGroupPicture, getGroupPicture, setInfoAdminOnly, setMessagesAdminOnly, getInviteCode, revokeInviteCode, deleteGroup, leaveGroup)
- [x] **ACT-02**: All chat management actions exposed (archiveChat, unarchiveChat, clearMessages, unreadChat, getChatPicture, getMessageById)
- [x] **ACT-03**: All contact actions exposed (getContactAbout, getContactPicture, blockContact, unblockContact, createOrUpdateContact)
- [x] **ACT-04**: All status/stories actions exposed (sendVoiceStatus, sendVideoStatus, deleteStatus, getNewMessageId)
- [x] **ACT-05**: Presence actions exposed (setPresence, getPresence, subscribePresence)
- [x] **ACT-06**: Profile actions exposed (getProfile, setProfileName, setProfileStatus, setProfilePicture, deleteProfilePicture)
- [x] **ACT-07**: Media actions exposed (convertVoice, convertVideo)
- [x] **ACT-08**: Session management and API key CRUD remain excluded from UTILITY_ACTIONS (admin-only)

### Modular Skill Architecture

- [ ] **SKL-01**: SKILL.md restructured as concise index referencing per-category instruction files
- [ ] **SKL-02**: Per-category files created: groups.md, contacts.md, channels.md, chats.md, status.md, presence.md, profile.md, media.md, messaging.md, slash-commands.md
- [ ] **SKL-03**: Each sub-file has action table with parameters, task-oriented examples, and gotchas
- [ ] **SKL-04**: Anthropic skill-creator used to structure files and write evals
- [ ] **SKL-05**: Evals verify agent can find correct action, use correct params, handle errors
- [ ] **SKL-06**: whatsapp-messenger Claude Code skill updated to match new structure
- [ ] **SKL-07**: Document vCard (contacts) and iCal (calendar events) file-based approaches in skill — the agent sends .vcf files for contacts and .ics files for events

### Live Testing

- [ ] **TST-01**: Agent adds Michael Greenberg (972556839823@c.us) to test group and removes him
- [ ] **TST-02**: Agent promotes Michael to admin and demotes back to member
- [ ] **TST-03**: Agent updates group subject and description
- [ ] **TST-04**: Agent sets and deletes group picture
- [ ] **TST-05**: Agent toggles info-admin-only and messages-admin-only settings
- [ ] **TST-06**: Agent gets and revokes invite code
- [ ] **TST-07**: Agent gets group participants list
- [ ] **TST-08**: Agent creates a test group and deletes it
- [ ] **TST-09**: Agent gets contact about info and profile picture
- [ ] **TST-10**: Agent posts a text status and deletes it
- [ ] **TST-11**: Agent sets bot presence to online
- [ ] **TST-12**: /join, /leave, /list still work after refactoring (regression check)

## Future Requirements

- Labels CRUD — deferred (WhatsApp Business only, not applicable for personal WhatsApp)
- WAHA Events API — check NOWEB support status; iCal file workaround documented in skill

## Out of Scope

| Feature | Reason |
|---------|--------|
| Labels management | WhatsApp Business feature only — personal WhatsApp doesn't support |
| Session management exposure to LLM | Admin-only — too dangerous for LLM to manage sessions |
| API key CRUD exposure to LLM | Admin-only — security risk |
| WAHA Events API (sendEvent) | NOWEB engine may not support; iCal file approach works and is documented |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ACT-01 | Phase 48 | Complete |
| ACT-02 | Phase 48 | Complete |
| ACT-03 | Phase 48 | Complete |
| ACT-04 | Phase 48 | Complete |
| ACT-05 | Phase 48 | Complete |
| ACT-06 | Phase 48 | Complete |
| ACT-07 | Phase 48 | Complete |
| ACT-08 | Phase 48 | Complete |
| SKL-01 | Phase 49 | Pending |
| SKL-02 | Phase 49 | Pending |
| SKL-03 | Phase 49 | Pending |
| SKL-07 | Phase 49 | Pending |
| SKL-04 | Phase 50 | Pending |
| SKL-05 | Phase 50 | Pending |
| SKL-06 | Phase 51 | Pending |
| TST-01 | Phase 52 | Pending |
| TST-02 | Phase 52 | Pending |
| TST-03 | Phase 52 | Pending |
| TST-04 | Phase 52 | Pending |
| TST-05 | Phase 52 | Pending |
| TST-06 | Phase 52 | Pending |
| TST-07 | Phase 52 | Pending |
| TST-08 | Phase 52 | Pending |
| TST-09 | Phase 52 | Pending |
| TST-10 | Phase 52 | Pending |
| TST-11 | Phase 52 | Pending |
| TST-12 | Phase 52 | Pending |

**Coverage:**
- v1.19 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 — traceability mapped after roadmap creation*
