# Roadmap: WAHA OpenClaw Plugin

## Overview

This roadmap hardens a production WhatsApp plugin (v1.10.4, ~87% API coverage) from "working but fragile" to "production-grade and extensible." The journey starts with reliability infrastructure (every WAHA API call can currently hang forever or silently fail), adds resilience and observability, fills feature gaps, introduces multi-session support for shared bot access, and closes with documentation and testing. Each phase delivers a coherent capability that can be verified by sending WhatsApp messages through Sammie.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Reliability Foundation** - Production-grade HTTP client with timeouts, rate limiting, structured logging, and bounded caches (completed 2026-03-11)
- [x] **Phase 2: Resilience and Observability** - Session health monitoring, inbound message queue, and actionable error messages (completed 2026-03-11)
- [x] **Phase 3: Feature Gaps** - URL previews, mute/unmute, mentions detection, multi-recipient send, and better errors (completed 2026-03-11)
- [x] **Phase 4: Multi-Session** - Session registry with roles, trigger word activation, cross-session routing, and admin panel management (completed 2026-03-13)
- [x] **Phase 5: Documentation and Testing** - SKILL.md refresh, unit tests, integration tests, and README (completed 2026-03-13)
- [x] **Phase 6: WhatsApp Rules and Policy System** - Lazy-loaded YAML rules with hierarchical policies, merge engine, manager authorization, and compact policy injection (completed 2026-03-13)

## Phase Details

### Phase 1: Reliability Foundation
**Goal**: Every outbound WAHA API call is protected by timeouts, rate limiting, retry with backoff, and structured error logging -- no call can hang forever, no error is silently swallowed, and caches cannot grow unbounded
**Depends on**: Nothing (first phase)
**Requirements**: REL-01, REL-02, REL-03, REL-04, REL-05, REL-06, REL-07, REL-08, REL-09, REL-10, REL-11
**Success Criteria** (what must be TRUE):
  1. When a WAHA API call fails, the gateway log contains a structured entry with action name, chatId, HTTP status, and error message -- no silent swallowing
  2. When a WAHA API call takes longer than 30 seconds, it is aborted and returns a timeout error (mutation calls return "may have succeeded" warning instead of retrying)
  3. When Sammie sends messages rapidly (>20/s), the rate limiter queues excess requests instead of flooding WAHA, and fire-and-forget calls (presence, typing) do not starve user-facing sends
  4. When WAHA returns 429, the plugin backs off with exponential delay and jitter, reading Retry-After when present, and caps at 3 retries
  5. The resolveTarget cache uses LRU eviction with max 1000 entries, and webhook deduplication filters duplicate messages by composite key without over-filtering distinct events
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md -- Extract callWahaApi into http-client.ts with timeout, rate limiting, 429 backoff, structured logging; set up vitest
- [x] 01-02-PLAN.md -- Replace silent .catch patterns, swap resolveTarget to LRU cache, add webhook dedup, memory audit
- [x] 01-03-PLAN.md -- Add reliability config fields to schema, deploy to hpg6, verify end-to-end

### Phase 2: Resilience and Observability
**Goal**: The plugin detects session disconnects, handles webhook floods gracefully, and provides actionable error context to the LLM
**Depends on**: Phase 1
**Requirements**: RES-01, RES-02, RES-03, RES-04, RES-05
**Success Criteria** (what must be TRUE):
  1. When the WAHA session disconnects, the admin panel Status tab shows a health warning within 3 minutes (after 3 consecutive failed pings)
  2. When a burst of 200+ webhook messages arrives simultaneously, the inbound queue accepts up to 100, drops oldest on overflow, and processes DMs before group messages
  3. When an action handler fails, the LLM receives an error message containing the action name, target, what went wrong, and a suggested fix -- not a raw stack trace or generic "error"
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Health monitor module (setTimeout chain, HealthState), error formatter (LLM-friendly messages), config schema fields for Phase 2
- [ ] 02-02-PLAN.md -- Inbound queue with DM priority, wire health + queue into monitor.ts, admin panel health dots + Queue tab, deploy to hpg6

### Phase 3: Feature Gaps
**Goal**: Sammie can send URL previews, mute/unmute chats, detect @mentions in received messages, send to multiple recipients at once, and provide context-rich error guidance
**Depends on**: Phase 1
**Requirements**: FEAT-01, FEAT-02, FEAT-03, FEAT-04, FEAT-05, FEAT-06, FEAT-07
**Success Criteria** (what must be TRUE):
  1. When Sammie sends a message containing a URL with link preview enabled, the recipient sees a rich preview card (title, description, thumbnail) instead of a plain text link
  2. When Sammie mutes or unmutes a chat, the chat's notification state changes accordingly and the action confirms success
  3. When a message mentioning @someone arrives, the inbound message context includes the mentioned JIDs so Sammie knows who was tagged
  4. When Sammie sends a message to 3 recipients, each recipient receives the message and Sammie gets per-recipient success/failure results
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md -- Auto link preview in sendWahaText, chat mute/unmute actions, verify FEAT-02 and FEAT-07
- [x] 03-02-PLAN.md -- Extract @mentions from inbound messages into ctxPayload
- [x] 03-03-PLAN.md -- Multi-recipient sendMulti utility action

### Phase 4: Multi-Session
**Goal**: Multiple WhatsApp sessions (bot and human) coexist with role-based permissions, trigger word activation enables group chat interaction, and sessions are manageable from the admin panel
**Depends on**: Phase 1, Phase 2
**Requirements**: MSESS-01, MSESS-02, MSESS-03, MSESS-04, MSESS-05, MSESS-06, MSESS-07, MSESS-08, MSESS-09, MSESS-10
**Success Criteria** (what must be TRUE):
  1. The plugin config defines multiple sessions with roles (bot/human) and sub-roles (full-access/listener), and a listener session cannot send outgoing messages
  2. When a user types "!sammie what is the weather" in a group chat monitored by a listener session, Sammie strips the trigger prefix, processes the prompt, and responds via DM to that user
  3. The admin panel has a Sessions tab showing all registered sessions with their roles, sub-roles, and live connection status
  4. When Sammie needs to send to a group the bot session belongs to, the message goes from the bot session; when the bot is not a member, it falls back to the user's session (respecting permissions)
  5. Sammie can read recent messages from chats monitored by listener sessions to fulfill context prompts (e.g., "what were the last messages in the family group")
**Plans**: 4 plans

Plans:
- [ ] 04-01-PLAN.md -- Types, config schema, role-based guardrail (assertCanSend replacing assertAllowedSession), webhook session validation
- [ ] 04-02-PLAN.md -- Trigger word detection in inbound messages, DM response routing
- [ ] 04-03-PLAN.md -- Cross-session routing (resolveSessionForTarget), readMessages utility action
- [ ] 04-04-PLAN.md -- Admin panel Sessions tab with role/subRole display and connection status

### Phase 5: Documentation and Testing
**Goal**: SKILL.md accurately documents all capabilities including error handling and multi-session, tests cover core utilities and action handlers, and README enables new users to install and configure the plugin
**Depends on**: Phase 1, Phase 2, Phase 3, Phase 4
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04
**Success Criteria** (what must be TRUE):
  1. SKILL.md includes error scenario guidance (what to do when sends fail, rate limits hit, session disconnects), rate limit awareness, and multi-session examples
  2. Unit tests pass for fuzzyScore, toArr, resolveChatId, autoResolveTarget, LRU cache, and token bucket -- covering happy paths and edge cases
  3. Integration tests exercise action handlers (send, poll, edit, search) against a mock WAHA API and verify correct HTTP calls and error handling
  4. README contains installation steps, configuration reference, deployment instructions (both hpg6 locations), and troubleshooting guide
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md -- Unit tests for fuzzyScore, toArr, resolveChatId, autoResolveTarget + integration tests for send, poll, edit, search handlers
- [ ] 05-02-PLAN.md -- SKILL.md refresh (error scenarios, rate limits, multi-session) + README.md update (config, deploy, troubleshooting)

### Phase 6: WhatsApp Rules and Policy System
**Goal:** Lazy-loaded, file-based rules system with hierarchical contact/group policies, sparse overrides, compact resolved-policy injection per event, participant allowlists, and manager authorization — without increasing startup context load
**Depends on:** Phase 5
**Requirements**: RULES-01, RULES-02, RULES-03, RULES-04, RULES-05, RULES-06, RULES-07, RULES-08, RULES-09, RULES-10, RULES-11, RULES-12, RULES-13, RULES-14
**Success Criteria** (what must be TRUE):
  1. When a DM arrives, the plugin loads global contact defaults + specific contact override (if present), merges them, and injects a compact resolved policy into the model context
  2. When a group message arrives, the plugin resolves group policy + evaluates participant allowlist + optionally loads speaker contact policy based on contact_rule_mode
  3. When Sammie tries to send a DM to a contact with can_initiate=false, the send is blocked with a policy error
  4. When the owner asks to edit a contact's policy, the change is authorized and persisted to the YAML override file
  5. When a non-manager tries to edit policy, the request is denied with "not authorized"
  6. Rules load lazily — only after all existing WAHA/OpenClaw message filters pass, never at startup
**Plans**: 4 plans

Plans:
- [ ] 06-01-PLAN.md -- Types, zod schemas, YAML dependency, seed default files, identity resolver, rules loader
- [ ] 06-02-PLAN.md -- Merge engine, policy cache, manager authorization matrix
- [ ] 06-03-PLAN.md -- Rules resolver (DM + group flows), resolved payload builder
- [ ] 06-04-PLAN.md -- Outbound policy enforcer, inbound hook wiring, policy edit action handler

### Phase 7: Admin Panel Critical Fixes
**Goal:** Fix broken functionality that prevents normal admin panel use — Save & Restart crash, directory pagination, and group filter override 502
**Depends on:** Phase 6
**Requirements**: AP-01, AP-02, AP-03
**Success Criteria** (what must be TRUE):
  1. Save & Restart shows "Restarting..." overlay, polls until server responds (up to 60s), then auto-reloads — no 502 crash
  2. Directory Load More loads new items with correct offset — no duplicates
  3. Group Filter Override checkbox saves without HTTP 502 error
**Plans**: 2 plans

Plans:
- [ ] 07-01-PLAN.md -- Fix Save & Restart polling overlay + Group Filter Override 502 error handling
- [ ] 07-02-PLAN.md -- Fix directory pagination by moving @lid/@s.whatsapp.net filtering to SQL level

### Phase 8: Shared UI Components
**Goal:** Build reusable UI components (name resolver, contact picker, tag input, contact list) used across Settings, Dashboard, and Directory sections
**Depends on:** Phase 7
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. All JID/LID/phone number displays show resolved human-readable contact names
  2. Tag-style input works with comma/space/enter to create bubbles with 'x' to delete
  3. Contact picker supports UTF-8 (Hebrew + English) fuzzy search with multi-select
  4. God Mode Users shows names with remove buttons, adding/removing handles paired JIDs (@c.us + @lid)
**Plans**: 2 plans

Plans:
- [ ] 08-01-PLAN.md -- Name Resolver + Tag Input factory functions, CSS, wire Tag Input into allowFrom/groupAllowFrom/allowedGroups, Name Resolver in dashboard
- [ ] 08-02-PLAN.md -- Contact Picker + God Mode Users Field factory functions, CSS, wire into godModeSuperUsers textareas

### Phase 9: Settings UX Improvements
**Goal:** Improve Settings tab usability with tooltips, fixed pairing mode, tab switching, and group filter UX
**Depends on:** Phase 8
**Requirements**: UX-01, UX-02, UX-03, UX-04
**Success Criteria** (what must be TRUE):
  1. DM Policy "pairing" mode is either working with tests or removed/disabled with explanation
  2. All Contact Settings fields have tooltips explaining what they do
  3. Group Filter Override has per-group trigger operator and tag-style keyword input
  4. Tab switching clears search bar, search bar has 'x' clear button, "Newsletters" renamed to "Channels"
**Plans**: 2 plans

Plans:
- [ ] 09-01-PLAN.md -- Disable pairing mode with explanation tooltip, add Contact Settings tooltips, tab switch clears search, search bar clear button, rename Newsletters to Channels
- [ ] 09-02-PLAN.md -- Replace group filter keywords with tag-style input, add per-group trigger operator AND/OR select

### Phase 10: Directory & Group Enhancements
**Goal:** Paginated group browsing, fixed participants display, participant roles, and bulk edit
**Depends on:** Phase 8
**Requirements**: DIR-01, DIR-02, DIR-03, DIR-04
**Success Criteria** (what must be TRUE):
  1. Groups displayed in paginated table with page nav and "Display [X] groups" selector
  2. All group participants load with contact names, global allowlist state reflected in buttons
  3. Participant roles assignable via dropdown: Bot Admin, Manager, Participant
  4. Bulk selection and edit works for contacts/groups/participants
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Groups paginated table + participant name resolution and global allowlist display
- [ ] 10-02-PLAN.md -- Participant role dropdown + bulk select mode with action toolbar

### Phase 11: Dashboard, Sessions & Log
**Goal:** Complete dashboard with all sessions, editable session roles, and structured log display
**Depends on:** Phase 7
**Requirements**: DASH-01, SESS-01, LOG-01
**Success Criteria** (what must be TRUE):
  1. Dashboard shows all connected sessions (both omer and logan) with ports and status
  2. Session roles editable via dropdown in Sessions tab
  3. Log entries have clearly formatted timestamps and visual separation between entries
**Plans**: 2 plans

Plans:
- [ ] 11-01-PLAN.md -- Dashboard multi-session card + Sessions tab role dropdowns + PUT endpoint
- [ ] 11-02-PLAN.md -- Structured log display with timestamp parsing and level badges

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9/10 (parallel) -> 11
Note: Phase 9 and Phase 10 can execute in parallel (both depend on Phase 8). Phase 11 depends only on Phase 7.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Reliability Foundation | 3/3 | Complete   | 2026-03-11 |
| 2. Resilience and Observability | 2/2 | Complete   | 2026-03-11 |
| 3. Feature Gaps | 3/3 | Complete   | 2026-03-11 |
| 4. Multi-Session | 4/4 | Complete   | 2026-03-13 |
| 5. Documentation and Testing | 2/2 | Complete   | 2026-03-13 |
| 6. WhatsApp Rules and Policy System | 4/4 | Complete   | 2026-03-13 |
| 7. Admin Panel Critical Fixes | 2/2 | Complete   | 2026-03-15 |
| 8. Shared UI Components | 2/2 | Complete   | 2026-03-16 |
| 9. Settings UX Improvements | 2/2 | Complete   | 2026-03-16 |
| 10. Directory & Group Enhancements | 2/2 | Complete    | 2026-03-16 |
| 11. Dashboard, Sessions & Log | 2/2 | Complete   | 2026-03-16 |
