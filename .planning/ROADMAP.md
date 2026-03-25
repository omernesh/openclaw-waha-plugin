# Roadmap: WAHA OpenClaw Plugin

## Milestones

- ✅ **v1.10 Admin Panel & Multi-Session** — Phases 1-11 (shipped 2026-03-16)
- ✅ **v1.11 Polish, Sync & Features** — Phases 12-17 (shipped 2026-03-18)
- ✅ **v1.12 UI Overhaul & Feature Polish** — Phases 18-24 (shipped 2026-03-18)
- ✅ **v1.13 Close All Gaps** — Phases 25-32 (shipped 2026-03-20)
- 🚧 **v1.18 Join/Leave/List & Skill Completeness** — Phases 43-47 (in progress)

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
- [ ] **Phase 44: Invite Link Documentation** - Document invite code actions in SKILL.md
- [ ] **Phase 45: Admin UI Join/Leave** - Leave button and Join by Link in directory tab
- [ ] **Phase 46: Skill Completeness Audit** - whatsapp-messenger skill documents all endpoints
- [ ] **Phase 47: Live WhatsApp Testing** - End-to-end validation of all v1.18 features

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
**Plans**: TBD

### Phase 45: Admin UI Join/Leave
**Goal**: Users can leave any group/channel or join a new one directly from the directory tab in the admin panel
**Depends on**: Nothing (React SPA addition to existing directory tab)
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. Every group and channel row in the directory tab shows a "Leave" button that triggers the WAHA leave API
  2. Directory tab has a "Join by Link" input field that accepts a WhatsApp invite URL and executes join on submit
  3. Leave and Join actions display a success toast or inline error — no silent failures
**Plans**: TBD
**UI hint**: yes

### Phase 46: Skill Completeness Audit
**Goal**: The whatsapp-messenger Claude Code skill documents every implemented WAHA endpoint so agents never miss an available capability
**Depends on**: Phase 44 (invite link docs inform audit scope)
**Requirements**: SKL-01, SKL-02, SKL-03
**Success Criteria** (what must be TRUE):
  1. whatsapp-messenger skill lists all implemented endpoints grouped by category (messaging, groups, contacts, channels, labels, status, presence, profile, media, calls)
  2. No implemented action is undocumented (audit confirms zero gaps)
  3. Skill documents /join, /leave, /list slash commands with syntax and behavior description
**Plans**: TBD

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
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 43. Slash Commands | 2/2 | Complete   | 2026-03-25 |
| 44. Invite Link Documentation | 0/? | Not started | - |
| 45. Admin UI Join/Leave | 0/? | Not started | - |
| 46. Skill Completeness Audit | 0/? | Not started | - |
| 47. Live WhatsApp Testing | 0/? | Not started | - |
