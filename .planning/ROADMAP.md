# Roadmap: WAHA OpenClaw Plugin

## Milestones

- ✅ **v1.10 Admin Panel & Multi-Session** — Phases 1-11 (shipped 2026-03-16)
- 🚧 **v1.11 Polish, Sync & Features** — Phases 12-17 (in progress)

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

### 🚧 v1.11 Polish, Sync & Features (In Progress)

**Milestone Goal:** Fix all bugs and CRs from v1.10 human verification, implement background directory sync, and add pairing mode, TTL access, auto-reply, and modules system.

- [x] **Phase 12: UI Bug Sprint** — Fix all standalone admin panel regressions and polish items (completed 2026-03-17)
- [x] **Phase 13: Background Directory Sync** — Continuous WAHA-to-SQLite sync with local search (completed 2026-03-17)
- [x] **Phase 14: Name Resolution** — Resolve @lid JIDs to display names throughout the UI (completed 2026-03-17)
- [x] **Phase 15: TTL Access** — Schema and infrastructure for auto-expiring allowlist entries (completed 2026-03-17)
- [ ] **Phase 16: Pairing Mode and Auto-Reply** — Passcode-gated onboarding and canned rejection messages
- [ ] **Phase 17: Modules Framework** — Bulk directory actions and extensible module system

## Phase Details

### Phase 12: UI Bug Sprint
**Goal**: The admin panel works correctly and smoothly — no regressions, no raw error states, consistent UX patterns throughout
**Depends on**: Nothing (all fixes are self-contained UI changes)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11, DASH-01, DASH-02, DASH-03, DASH-04, UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, DIR-01, DIR-02, DIR-04, INIT-01, INIT-02
**Success Criteria** (what must be TRUE):
  1. Dashboard renders without flickering — the Access Control card loads once and stays stable
  2. All Refresh buttons across every tab show a spinner while loading and display "Last refreshed" timestamp after completion
  3. Sessions tab role/subRole changes appear immediately without page reload, and a 502 during restart shows a polling overlay instead of a raw error
  4. Directory search bar, log search bar, and all tag-style input fields (Custom Keywords, Mention Patterns, Group Override Keywords) have a working clear/remove button
  5. Tooltips are fully visible and not clipped by container overflow; contact settings drawer stays open after saving
**Plans**: 5 plans

Plans:
- [ ] 12-01-PLAN.md — Dashboard: fix flickering, per-session stats/health, collapsible cards, readable labels
- [ ] 12-02-PLAN.md — Sessions: optimistic UI, 502 overlay, labels, pairing removal, Can Initiate
- [ ] 12-03-PLAN.md — Refresh buttons, search clear buttons, tooltip overflow fix
- [ ] 12-04-PLAN.md — Tag inputs for keywords/patterns, contact drawer stays open
- [ ] 12-05-PLAN.md — Directory: trigger operator visibility, channel toggle, bot badge, role auto-grant

### Phase 13: Background Directory Sync
**Goal**: The directory is always locally cached — contacts, groups, and newsletters are pulled from WAHA into SQLite continuously so search is instant and name lookups work without hitting the live API
**Depends on**: Phase 12
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05
**Success Criteria** (what must be TRUE):
  1. Contacts, groups, and newsletters are automatically pulled from WAHA and stored in SQLite without any manual action
  2. Directory search returns results instantly from the local database — no waiting for WAHA API calls
  3. The Directory tab shows "Last synced" timestamp and sync progress indicator so the user knows sync is running
  4. Contacts tab has pagination matching the Groups tab so both tabs behave consistently
**Plans**: 2 plans

Plans:
- [ ] 13-01-PLAN.md — Sync engine (sync.ts) + FTS5 full-text search in directory.ts
- [ ] 13-02-PLAN.md — Config wiring, sync startup, status API, contacts pagination, status bar UI

### Phase 14: Name Resolution
**Goal**: Raw @lid JIDs are never shown to the user — every JID in the admin panel displays a resolved contact name with the JID as a tooltip, populated from the locally synced directory
**Depends on**: Phase 13 (requires synced local directory data for @lid lookup)
**Requirements**: NAME-01, NAME-02, NAME-03, NAME-04, NAME-05
**Success Criteria** (what must be TRUE):
  1. The Dashboard Access Control card shows contact names instead of @lid JID strings
  2. God Mode Users tag bubbles display resolved names, and the contact picker finds contacts by searching the local SQLite directory
  3. Allow From, Group Allow From, and Allowed Groups tag bubbles display resolved names with raw JIDs available on hover
  4. Group participants list shows contact names instead of raw LID numbers
**Plans**: 2 plans

Plans:
- [ ] 14-01-PLAN.md — Batch resolve endpoint, @lid fallback, tag input name resolution, dashboard dedup
- [ ] 14-02-PLAN.md — Group participant SQL JOIN resolution, God Mode batch resolve, contact picker verification

### Phase 15: TTL Access
**Goal**: Admins can grant time-limited access to contacts and groups — entries auto-expire without manual cleanup, and the admin panel shows how much time is left
**Depends on**: Phase 13 (requires synced directory; TTL grants target known contacts)
**Requirements**: TTL-01, TTL-02, TTL-03, TTL-04, TTL-05
**Success Criteria** (what must be TRUE):
  1. The contact/group settings card has an "Access Expires" field with Never, specific datetime, and relative duration options
  2. Expired entries are automatically treated as blocked — the inbound filter rejects them at the SQL layer without needing code-level expiry checks
  3. Active TTL grants show remaining time ("Expires in 2h 14m") in the admin panel directory view
  4. Expired entries are visually distinct in the directory — grayed out or badged — so admins can see stale grants at a glance
**Plans**: 3 plans

Plans:
- [ ] 15-01-PLAN.md — Schema migration, TTL-aware queries, sync cleanup, TTL API endpoint
- [ ] 15-02-PLAN.md — Access Expires UI control, TTL badges, expired entry styling
- [ ] 15-03-PLAN.md — Gap closure: sync expired JIDs from SQLite to config allowFrom (TTL-03)

### Phase 16: Pairing Mode and Auto-Reply
**Goal**: Unknown contacts who DM the bot receive a canned rejection or passcode challenge — authorized contacts get temporary access automatically, and the whole flow costs zero LLM tokens
**Depends on**: Phase 15 (pairing grants use TTL expires_at; auto-reply rate-limit uses SQLite tables from Phase 15)
**Requirements**: PAIR-01, PAIR-02, PAIR-03, PAIR-04, PAIR-05, PAIR-06, REPLY-01, REPLY-02, REPLY-03, REPLY-04
**Success Criteria** (what must be TRUE):
  1. An unknown contact who DMs the bot receives a canned rejection message (when auto-reply is enabled) with no LLM tokens consumed
  2. An unknown contact who sends the correct passcode is granted temporary allowlist access with a configurable TTL, and receives no further challenge
  3. A wa.me deep link with an obfuscated token automatically authorizes a contact when they click it — zero manual passcode entry required
  4. Passcode brute-forcing is blocked — after 3 wrong attempts the contact is rate-limited for 30 minutes
  5. The admin panel shows active temporary grants with remaining TTL and a manual revoke button
**Plans**: TBD

### Phase 17: Modules Framework
**Goal**: The plugin is extensible — developers can register WhatsApp-specific modules that hook into the inbound pipeline, and admins can enable/disable them and assign them to chats from the admin panel
**Depends on**: Phase 15 (modules use DirectoryDb patterns; assignment UI queries synced directory)
**Requirements**: DIR-03, DIR-05, MOD-01, MOD-02, MOD-03, MOD-04, MOD-05, MOD-06
**Success Criteria** (what must be TRUE):
  1. A developer can implement the WahaModule interface, register it, and have its onInbound hook called for assigned chats without modifying inbound.ts directly
  2. The admin panel has a Modules tab where modules can be enabled/disabled and assigned to specific groups/contacts/newsletters
  3. Contacts and channels tabs support bulk select with checkboxes and a bulk action toolbar (Allow DM, Revoke DM, Set Mode)
  4. Module hooks only fire after the fromMe and dedup checks — the bot's own messages never reach module hooks
**Plans**: TBD

## Progress

**Execution Order:** 12 → 13 → 14 → 15 → 16 → 17

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Reliability Foundation | v1.10 | 3/3 | Complete | 2026-03-11 |
| 2. Resilience and Observability | v1.10 | 2/2 | Complete | 2026-03-11 |
| 3. Feature Gaps | v1.10 | 3/3 | Complete | 2026-03-11 |
| 4. Multi-Session | v1.10 | 4/4 | Complete | 2026-03-13 |
| 5. Documentation and Testing | v1.10 | 2/2 | Complete | 2026-03-13 |
| 6. WhatsApp Rules and Policy System | v1.10 | 4/4 | Complete | 2026-03-13 |
| 7. Admin Panel Critical Fixes | v1.10 | 2/2 | Complete | 2026-03-15 |
| 8. Shared UI Components | v1.10 | 2/2 | Complete | 2026-03-16 |
| 9. Settings UX Improvements | v1.10 | 2/2 | Complete | 2026-03-16 |
| 10. Directory & Group Enhancements | v1.10 | 2/2 | Complete | 2026-03-16 |
| 11. Dashboard, Sessions & Log | v1.10 | 2/2 | Complete | 2026-03-16 |
| 12. UI Bug Sprint | 5/5 | Complete    | 2026-03-17 | - |
| 13. Background Directory Sync | 2/2 | Complete    | 2026-03-17 | - |
| 14. Name Resolution | 2/2 | Complete    | 2026-03-17 | - |
| 15. TTL Access | 2/2 | Complete   | 2026-03-17 | - |
| 16. Pairing Mode and Auto-Reply | v1.11 | 0/TBD | Not started | - |
| 17. Modules Framework | v1.11 | 0/TBD | Not started | - |
