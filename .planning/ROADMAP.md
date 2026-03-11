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
- [ ] **Phase 4: Multi-Session** - Session registry with roles, trigger word activation, cross-session routing, and admin panel management
- [ ] **Phase 5: Documentation and Testing** - SKILL.md refresh, unit tests, integration tests, and README

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
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD
- [ ] 04-04: TBD

### Phase 5: Documentation and Testing
**Goal**: SKILL.md accurately documents all capabilities including error handling and multi-session, tests cover core utilities and action handlers, and README enables new users to install and configure the plugin
**Depends on**: Phase 1, Phase 2, Phase 3, Phase 4
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04
**Success Criteria** (what must be TRUE):
  1. SKILL.md includes error scenario guidance (what to do when sends fail, rate limits hit, session disconnects), rate limit awareness, and multi-session examples
  2. Unit tests pass for fuzzyScore, toArr, resolveChatId, autoResolveTarget, LRU cache, and token bucket -- covering happy paths and edge cases
  3. Integration tests exercise action handlers (send, poll, edit, search) against a mock WAHA API and verify correct HTTP calls and error handling
  4. README contains installation steps, configuration reference, deployment instructions (both hpg6 locations), and troubleshooting guide
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5
Note: Phase 2 and Phase 3 can execute in parallel (both depend only on Phase 1).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Reliability Foundation | 3/3 | Complete   | 2026-03-11 |
| 2. Resilience and Observability | 2/2 | Complete   | 2026-03-11 |
| 3. Feature Gaps | 3/3 | Complete   | 2026-03-11 |
| 4. Multi-Session | 0/4 | Not started | - |
| 5. Documentation and Testing | 0/3 | Not started | - |
