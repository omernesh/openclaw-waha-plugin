# Roadmap: WAHA OpenClaw Plugin

## Milestones

- ✅ **v1.10 Admin Panel & Multi-Session** — Phases 1-11 (shipped 2026-03-16)
- ✅ **v1.11 Polish, Sync & Features** — Phases 12-17 (shipped 2026-03-18)
- ✅ **v1.12 UI Overhaul & Feature Polish** — Phases 18-24 (shipped 2026-03-18)
- ✅ **v1.13 Close All Gaps** — Phases 25-32 (shipped 2026-03-20)
- ✅ **v1.18 Join/Leave/List & Skill Completeness** — Phases 43-47 (shipped 2026-03-25)
- 🚧 **v1.19 Full WAHA Capabilities & Modular Skill Architecture** — Phases 48-52 (in progress)

## Phases

<details>
<summary>✅ v1.10 Admin Panel & Multi-Session (Phases 1-11) — SHIPPED 2026-03-16</summary>

- [x] Phase 1: Reliability Foundation (3/3 plans) — completed 2026-03-11
- [x] Phase 2: Resilience and Observability (2/2 plans) — completed 2026-03-11
- [x] Phase 3: Feature Gaps (3/3 plans) — completed 2026-03-11
- [x] Phase 4: Multi-Session (4/4 plans) — completed 2026-03-13
- [x] Phase 5: Documentation and Testing (2/2 plans) — completed 2026-03-13
- [x] Phase 6: WhatsApp Rules and Policy System (4/4 plans) — completed 2026-03-13
- [x] Phase 7: Admin Panel Critical Fixes (2/2 plans) — completed 2026-03-15
- [x] Phase 8: Shared UI Components (2/2 plans) — completed 2026-03-16
- [x] Phase 9: Settings UX Improvements (2/2 plans) — completed 2026-03-16
- [x] Phase 10: Directory & Group Enhancements (2/2 plans) — completed 2026-03-16
- [x] Phase 11: Dashboard, Sessions & Log (2/2 plans) — completed 2026-03-16

Full details: `.planning/milestones/v1.10-ROADMAP.md`

</details>

<details>
<summary>✅ v1.11 Polish, Sync & Features (Phases 12-17) — SHIPPED 2026-03-18</summary>

- [x] Phase 12: UI Bug Sprint (5/5 plans) — completed 2026-03-17
- [x] Phase 13: Background Directory Sync (2/2 plans) — completed 2026-03-17
- [x] Phase 14: Name Resolution (2/2 plans) — completed 2026-03-17
- [x] Phase 15: TTL Access (3/3 plans) — completed 2026-03-17
- [x] Phase 16: Pairing Mode and Auto-Reply (3/3 plans) — completed 2026-03-17
- [x] Phase 17: Modules Framework (3/3 plans) — completed 2026-03-17

Audit: `.planning/v1.11-MILESTONE-AUDIT.md`

</details>

<details>
<summary>✅ v1.12 UI Overhaul & Feature Polish (Phases 18-24) — SHIPPED 2026-03-18</summary>

- [x] Phase 18: React Scaffold (2/2 plans) — completed 2026-03-18
- [x] Phase 19: App Layout (2/2 plans) — completed 2026-03-18
- [x] Phase 20: Dashboard and Settings Tabs (2/2 plans) — completed 2026-03-18
- [x] Phase 21: Directory Tab (3/3 plans) — completed 2026-03-18
- [x] Phase 22: Sessions, Modules, Log, and Queue Tabs (2/2 plans) — completed 2026-03-18
- [x] Phase 23: Polish (2/2 plans) — completed 2026-03-18
- [x] Phase 24: Cleanup and Deploy (1/1 plans) — completed 2026-03-18

</details>

<details>
<summary>✅ v1.13 Close All Gaps (Phases 25-32) — SHIPPED 2026-03-20</summary>

- [x] Phase 25: Session Auto-Recovery (2/2 plans) — completed 2026-03-20
- [x] Phase 26: Config Safety (2/2 plans) — completed 2026-03-20
- [x] Phase 27: Pairing Cleanup and Code Quality (2/2 plans) — completed 2026-03-20
- [x] Phase 28: API Coverage Completion (3/3 plans) — completed 2026-03-20
- [x] Phase 29: Real-Time Admin Panel (2/2 plans) — completed 2026-03-20
- [x] Phase 30: Analytics (2/2 plans) — completed 2026-03-20
- [x] Phase 31: Test Coverage Sprint (3/3 plans) — completed 2026-03-20
- [x] Phase 32: Platform Abstraction (3/3 plans) — completed 2026-03-20

</details>

## Standalone Phases

- [x] Phase 36: Timeout & Error Hardening (1/1 plans) — completed 2026-03-25
- [x] Phase 38: Resilience & Health (1/1 plans) — completed 2026-03-25
- [x] Phase 39: Graceful Shutdown & SSE (1/1 plans) — completed 2026-03-25
- [x] Phase 41: Metrics Endpoint (1/1 plans) — completed 2026-03-25
- [x] Phase 42: Full Regression Testing (1/1 plans) — completed 2026-03-25

## v1.18 Join/Leave/List & Skill Completeness

- [x] **Phase 43: Slash Commands** - Implement /join, /leave, /list commands in inbound.ts (completed 2026-03-25)
- [x] **Phase 44: Invite Link Documentation** - Document invite code actions in SKILL.md (completed 2026-03-25)
- [x] **Phase 45: Admin UI Join/Leave** - Leave button and Join by Link in directory tab (completed 2026-03-25)
- [x] **Phase 46: Skill Completeness Audit** - whatsapp-messenger skill documents all endpoints (completed 2026-03-25)
- [x] **Phase 47: Live WhatsApp Testing** - End-to-end validation of all v1.18 features (completed 2026-03-25)

## v1.19 Full WAHA Capabilities & Modular Skill Architecture

- [x] **Phase 48: Action Exposure** - Add all missing actions to UTILITY_ACTIONS in channel.ts (ACT-01 through ACT-08) (completed 2026-03-26)
- [x] **Phase 49: Modular Skill Architecture** - Restructure SKILL.md into per-category files with index (SKL-01, SKL-02, SKL-03, SKL-07) (completed 2026-03-26)
- [x] **Phase 50: Skill Creator & Evals** - Use Anthropic skill-creator to validate structure and write evals (SKL-04, SKL-05) (completed 2026-03-26)
- [ ] **Phase 51: Claude Code Skill Update** - Update whatsapp-messenger Claude Code skill (SKL-06)
- [ ] **Phase 52: Deploy & Live Testing** - Deploy to hpg6 and run all live capability tests (TST-01 through TST-12)

## Phase Details

### Phase 43: Slash Commands
**Goal**: Users can join/leave groups and list memberships via WhatsApp slash commands, bypassing the LLM entirely
**Depends on**: Nothing (standalone inbound.ts addition)
**Requirements**: CMD-01, CMD-02, CMD-03, CMD-04, CMD-05, CMD-06
**Success Criteria** (what must be TRUE):
  1. Sending `/join <invite-link>` to the bot causes the bot to join the group and reply with confirmation, no LLM involved
  2. Sending `/join <group-name>` fuzzy-matches and joins the group; ambiguous matches prompt a confirmation list before acting
  3. Sending `/leave <name>` fuzzy-matches and leaves the matching group or channel with a confirmation reply
  4. Sending `/list` returns a formatted list of all groups and channels the bot is a member of
  5. Sending `/list groups` or `/list channels` returns a filtered subset of the membership list
**Plans:** 2/2 plans complete
Plans:
- [x] 43-01-PLAN.md — Create src/commands.ts with /join, /leave, /list handlers
- [x] 43-02-PLAN.md — Wire commands into inbound.ts pipeline

### Phase 44: Invite Link Documentation
**Goal**: Agents can confidently retrieve and share invite links because SKILL.md documents the actions clearly
**Depends on**: Nothing (documentation only)
**Requirements**: INV-01, INV-02
**Success Criteria** (what must be TRUE):
  1. Agent can ask for a group's invite link and receive it without guessing the action name
  2. SKILL.md lists getInviteCode and revokeInviteCode with correct parameters and examples
  3. SKILL.md documents joinGroup action with both invite-link and group-name variants
**Plans:** 1/1 plans complete
Plans:
- [x] 44-01-PLAN.md — Expand Group Management invite-code docs + add Slash Commands section in SKILL.md

### Phase 45: Admin UI Join/Leave
**Goal**: Users can leave any group/channel or join a new one directly from the directory tab in the admin panel
**Depends on**: Nothing (React SPA addition to existing directory tab)
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. Every group and channel row in the directory tab shows a "Leave" button that triggers the WAHA leave API
  2. Directory tab has a "Join by Link" input field that accepts a WhatsApp invite URL and executes join on submit
  3. Leave and Join actions display a success toast or inline error — no silent failures
**Plans:** 2/2 plans complete
Plans:
- [x] 45-01-PLAN.md — Backend routes (monitor.ts) + API client methods (api.ts)
- [x] 45-02-PLAN.md — UI components: AlertDialog, Leave buttons, Join by Link input

### Phase 46: Skill Completeness Audit
**Goal**: The whatsapp-messenger Claude Code skill documents every implemented WAHA endpoint so agents never miss an available capability
**Depends on**: Phase 44 (invite link docs inform audit scope)
**Requirements**: SKL-01, SKL-02, SKL-03
**Success Criteria** (what must be TRUE):
  1. whatsapp-messenger skill lists all implemented endpoints grouped by category (messaging, groups, contacts, channels, labels, status, presence, profile, media, calls)
  2. No implemented action is undocumented (audit confirms zero gaps)
  3. Skill documents /join, /leave, /list slash commands with syntax and behavior description
**Plans:** 1/1 plans complete
Plans:
- [x] 46-01-PLAN.md — Rewrite whatsapp-messenger SKILL.md with all ~100+ endpoints in 14 categories

### Phase 47: Live WhatsApp Testing
**Goal**: All v1.18 features are verified working end-to-end on real WhatsApp via WAHA API
**Depends on**: Phase 43, Phase 44, Phase 45, Phase 46
**Requirements**: TST-01, TST-02, TST-03, TST-04, TST-05, TST-06
**Success Criteria** (what must be TRUE):
  1. /join via invite link succeeds: bot joins the target group and sends confirmation
  2. /join via group name succeeds for exact match; ambiguous match returns candidate list
  3. /leave removes the bot from the named group/channel and confirms in chat
  4. /list, /list groups, /list channels each return correct filtered membership lists
  5. Invite link retrieval works: agent receives the link when asked via LLM action
  6. Admin UI Leave and Join by Link both complete successfully and show correct feedback in browser
**Plans:** 2/2 plans complete
Plans:
- [x] 47-01-PLAN.md — Build and deploy v1.18 to hpg6, verify clean gateway startup
- [ ] 47-02-PLAN.md — Run all live WhatsApp tests (TST-01 to TST-06), human verification checkpoint

### Phase 48: Action Exposure
**Goal**: Every implemented WAHA action is reachable by the agent — no capabilities hidden in ACTION_HANDLERS but absent from UTILITY_ACTIONS
**Depends on**: Nothing (standalone channel.ts edit)
**Requirements**: ACT-01, ACT-02, ACT-03, ACT-04, ACT-05, ACT-06, ACT-07, ACT-08
**Success Criteria** (what must be TRUE):
  1. Agent can invoke group admin actions (addParticipants, removeParticipants, promoteToAdmin, demoteToMember, setGroupSubject, setGroupDescription, setGroupPicture, deleteGroupPicture, getGroupPicture, setInfoAdminOnly, setMessagesAdminOnly, getInviteCode, revokeInviteCode, deleteGroup, leaveGroup) without "unknown action" errors
  2. Agent can invoke chat management actions (archiveChat, unarchiveChat, clearMessages, unreadChat, getChatPicture, getMessageById) without errors
  3. Agent can invoke contact actions (getContactAbout, getContactPicture, blockContact, unblockContact, createOrUpdateContact) without errors
  4. Agent can invoke status, presence, and profile actions (sendVoiceStatus, sendVideoStatus, deleteStatus, getNewMessageId, setPresence, getPresence, subscribePresence, getProfile, setProfileName, setProfileStatus, setProfilePicture, deleteProfilePicture) without errors
  5. Session management and API key CRUD actions are NOT in UTILITY_ACTIONS and cannot be invoked by the agent
**Plans:** 1/1 plans complete
Plans:
- [x] 48-01-PLAN.md — Add send.ts functions, ACTION_HANDLERS aliases, update UTILITY_ACTIONS

### Phase 49: Modular Skill Architecture
**Goal**: SKILL.md is a concise index and each action category has its own instruction file with full parameter tables, examples, and gotchas
**Depends on**: Nothing (documentation work, independent of Phase 48)
**Requirements**: SKL-01, SKL-02, SKL-03, SKL-07
**Success Criteria** (what must be TRUE):
  1. SKILL.md contains only a brief overview and links to per-category files (no inline action tables)
  2. Ten category files exist (groups.md, contacts.md, channels.md, chats.md, status.md, presence.md, profile.md, media.md, messaging.md, slash-commands.md) each with action table, parameters, examples, and gotchas section
  3. vCard (.vcf) and iCal (.ics) file-based approaches are documented in contacts.md and messaging.md respectively with usage examples
  4. Agent reading any single category file has enough context to correctly invoke all actions in that category
**Plans:** 2/2 plans complete
Plans:
- [x] 49-01-PLAN.md — Create messaging.md, groups.md, contacts.md, channels.md, chats.md category files
- [x] 49-02-PLAN.md — Create status.md, presence.md, profile.md, media.md, slash-commands.md + rewrite SKILL.md index

### Phase 50: Skill Creator & Evals
**Goal**: Skill files are validated by Anthropic skill-creator and evals confirm the agent can find actions, use correct params, and handle errors
**Depends on**: Phase 49
**Requirements**: SKL-04, SKL-05
**Success Criteria** (what must be TRUE):
  1. All per-category skill files pass skill-creator structure validation without warnings
  2. Evals cover at least: correct action selection given a task description, correct parameter construction, and graceful error handling for at least 3 categories
  3. Eval results are saved alongside skill files for future regression comparison
**Plans:** 1/1 plans complete
Plans:
- [x] 50-01-PLAN.md — Validate SKILL.md structure, create evals.json (8+ evals across 4 categories), run eval subagents, grade and benchmark results

### Phase 51: Claude Code Skill Update
**Goal**: The whatsapp-messenger Claude Code skill reflects the new modular structure so it stays in sync with what the agent reads
**Depends on**: Phase 48, Phase 49
**Requirements**: SKL-06
**Success Criteria** (what must be TRUE):
  1. whatsapp-messenger skill file references the new modular SKILL.md index structure
  2. All newly exposed actions from Phase 48 appear in the skill with correct invocation examples
  3. Skill accurately reflects the full action surface available to the agent post-v1.19
**Plans**: 1 plan
Plans:
- [ ] 51-01-PLAN.md — Deploy whatsapp-messenger v2.0.0 skill + plugin SKILL.md v6.0.0 to SIMPC and hpg6

### Phase 52: Deploy & Live Testing
**Goal**: All v1.19 changes are deployed to production and every live test passes on real WhatsApp
**Depends on**: Phase 48, Phase 49, Phase 50, Phase 51
**Requirements**: TST-01, TST-02, TST-03, TST-04, TST-05, TST-06, TST-07, TST-08, TST-09, TST-10, TST-11, TST-12
**Success Criteria** (what must be TRUE):
  1. Agent adds Michael Greenberg to the test group, then removes him — both confirmed via WhatsApp
  2. Agent promotes Michael to admin and demotes back to member in the test group
  3. Agent updates the test group's subject and description to new values
  4. Agent sets a group picture and then deletes it; agent toggles info-admin-only and messages-admin-only settings; agent gets and revokes the invite code
  5. Agent creates a new test group and deletes it
  6. Agent retrieves Michael's contact about text and profile picture URL
  7. Agent posts a text status and then deletes it; agent sets bot presence to online
  8. /join, /leave, /list slash commands still work correctly (regression check)
**Plans**: 1 plan
Plans:
- [ ] 51-01-PLAN.md — Deploy whatsapp-messenger v2.0.0 skill + plugin SKILL.md v6.0.0 to SIMPC and hpg6

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 43. Slash Commands | 2/2 | Complete | 2026-03-25 |
| 44. Invite Link Documentation | 1/1 | Complete | 2026-03-25 |
| 45. Admin UI Join/Leave | 2/2 | Complete | 2026-03-25 |
| 46. Skill Completeness Audit | 1/1 | Complete | 2026-03-25 |
| 47. Live WhatsApp Testing | 1/2 | Complete | 2026-03-25 |
| 48. Action Exposure | 1/1 | Complete    | 2026-03-26 |
| 49. Modular Skill Architecture | 2/2 | Complete    | 2026-03-26 |
| 50. Skill Creator & Evals | 1/1 | Complete    | 2026-03-26 |
| 51. Claude Code Skill Update | 0/1 | Not started | - |
| 52. Deploy & Live Testing | 0/TBD | Not started | - |
