# Requirements: WAHA OpenClaw Plugin — v1.19 Full WAHA Capabilities & Modular Skill Architecture

**Defined:** 2026-03-26
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.19 Requirements

### Action Exposure

- [ ] **ACT-01**: All group admin actions exposed in UTILITY_ACTIONS (addParticipants, removeParticipants, promoteToAdmin, demoteToMember, setGroupSubject, setGroupDescription, setGroupPicture, deleteGroupPicture, getGroupPicture, setInfoAdminOnly, setMessagesAdminOnly, getInviteCode, revokeInviteCode, deleteGroup, leaveGroup)
- [ ] **ACT-02**: All chat management actions exposed (archiveChat, unarchiveChat, clearMessages, unreadChat, getChatPicture, getMessageById)
- [ ] **ACT-03**: All contact actions exposed (getContactAbout, getContactPicture, blockContact, unblockContact, createOrUpdateContact)
- [ ] **ACT-04**: All status/stories actions exposed (sendVoiceStatus, sendVideoStatus, deleteStatus, getNewMessageId)
- [ ] **ACT-05**: Presence actions exposed (setPresence, getPresence, subscribePresence)
- [ ] **ACT-06**: Profile actions exposed (getProfile, setProfileName, setProfileStatus, setProfilePicture, deleteProfilePicture)
- [ ] **ACT-07**: Media actions exposed (convertVoice, convertVideo)
- [ ] **ACT-08**: Session management and API key CRUD remain excluded from UTILITY_ACTIONS (admin-only)

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
| ACT-01 | — | Pending |
| ACT-02 | — | Pending |
| ACT-03 | — | Pending |
| ACT-04 | — | Pending |
| ACT-05 | — | Pending |
| ACT-06 | — | Pending |
| ACT-07 | — | Pending |
| ACT-08 | — | Pending |
| SKL-01 | — | Pending |
| SKL-02 | — | Pending |
| SKL-03 | — | Pending |
| SKL-04 | — | Pending |
| SKL-05 | — | Pending |
| SKL-06 | — | Pending |
| SKL-07 | — | Pending |
| TST-01 | — | Pending |
| TST-02 | — | Pending |
| TST-03 | — | Pending |
| TST-04 | — | Pending |
| TST-05 | — | Pending |
| TST-06 | — | Pending |
| TST-07 | — | Pending |
| TST-08 | — | Pending |
| TST-09 | — | Pending |
| TST-10 | — | Pending |
| TST-11 | — | Pending |
| TST-12 | — | Pending |

**Coverage:**
- v1.19 requirements: 27 total
- Mapped to phases: 0
- Unmapped: 27

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 after initial definition*
