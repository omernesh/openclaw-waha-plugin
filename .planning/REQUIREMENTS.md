# Requirements: WAHA OpenClaw Plugin

**Defined:** 2026-03-11
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures.

## v1 Requirements

Requirements for this milestone cycle. Each maps to roadmap phases.

### Reliability

- [x] **REL-01**: All WAHA API calls have structured error logging with action name, chatId, and error context
- [x] **REL-02**: All silent `.catch(() => {})` patterns replaced with warning logs (presence, typing, seen calls)
- [x] **REL-03**: All WAHA API fetch() calls have 30s AbortController-based timeouts
- [x] **REL-04**: Timeout errors on mutation endpoints return "may have succeeded" warnings instead of retrying
- [x] **REL-05**: Proactive token-bucket rate limiter on all outbound WAHA API calls (configurable, default ~20 req/s)
- [x] **REL-06**: Fire-and-forget calls (presence, typing) exempt from or deprioritized in rate limiter
- [x] **REL-07**: Exponential backoff with jitter on 429 responses (1s/2s/4s, max 3 retries, cap 30s)
- [x] **REL-08**: Read `Retry-After` header from 429 responses when present
- [x] **REL-09**: Webhook deduplication by composite key `${eventType}:${messageId}` (sliding window of 200, 5-min TTL)
- [x] **REL-10**: resolveTarget cache replaced with LRU cache (max 1000 entries, 30s TTL)
- [x] **REL-11**: Memory audit — verify no unbounded growth in caches, event listeners, or webhook handler state

### Resilience

- [x] **RES-01**: Session health check pings WAHA `/api/{session}/me` every 60s
- [x] **RES-02**: Log warning after 3 consecutive health check failures, surface in admin panel Status tab
- [x] **RES-03**: Inbound message queue with bounded size (100 messages), drop oldest on overflow
- [x] **RES-04**: DM messages get priority over group messages in the inbound queue
- [x] **RES-05**: All action handler errors return LLM-friendly messages with action name, target, and suggested fix

### Features

- [x] **FEAT-01**: Send URLs with rich link preview using WAHA's `linkPreview: true` parameter
- [x] **FEAT-02**: Custom link preview send via WAHA `/api/send/link-custom-preview` endpoint
- [x] **FEAT-03**: Mute chat action via WAHA `/api/{session}/chats/{chatId}/mute`
- [x] **FEAT-04**: Unmute chat action via WAHA `/api/{session}/chats/{chatId}/unmute`
- [x] **FEAT-05**: Extract @mentioned JIDs from inbound messages and include in message context
- [x] **FEAT-06**: Multi-recipient send — sequential send to multiple chats with per-recipient results
- [x] **FEAT-07**: Context-rich error messages with suggested fixes (e.g., "contact not found — verify phone number")

### Multi-Session

- [x] **MSESS-01**: Session registry in plugin config — each session has name, sessionId, role (bot/human), sub-role (full-access/listener)
- [x] **MSESS-02**: Roles are extensible — new role types can be added without code changes
- [x] **MSESS-03**: Listener sub-role blocks all outgoing message sends
- [x] **MSESS-04**: Admin panel tab to manage sessions — assign roles/sub-roles, view connection status
- [x] **MSESS-05**: Configurable trigger word (e.g., `!sammie`) — when detected in any chat, strip prefix and route text as bot prompt
- [x] **MSESS-06**: Trigger word matching is case-insensitive
- [x] **MSESS-07**: Bot responds to trigger-word prompts via DM to the requesting user by default
- [x] **MSESS-08**: If user requests group delivery and bot is a member, bot sends from its own session
- [x] **MSESS-09**: If bot is not a member of the target group, send via user's session (respecting role/sub-role permissions)
- [x] **MSESS-10**: Bot can read recent messages from chats it monitors (via listener sessions) to fulfill context prompts

### Documentation

- [x] **DOC-01**: SKILL.md refreshed with error scenarios, rate limit guidance, and multi-session examples
- [x] **DOC-02**: Unit tests for fuzzyScore, toArr, resolveChatId, autoResolveTarget, LRU cache, token bucket
- [x] **DOC-03**: Integration tests for action handlers with mock WAHA API
- [x] **DOC-04**: README updated with installation, configuration, deployment guide

### Rules and Policy System

- [x] **RULES-01**: YAML file loader for _default.yaml and sparse override files with safe parse and zod validation
- [x] **RULES-02**: Identity normalizer: JID/LID -> @c:/@lid:/@g: stable IDs for policy resolution
- [x] **RULES-03**: 5-layer merge engine: scalar replace, object deep merge, array replace, missing=inherit
- [x] **RULES-04**: Inbound DM policy resolver: load global contact default + override, merge, return compact payload
- [x] **RULES-05**: Inbound group policy resolver: load group default + override, evaluate contact_rule_mode and participant allowlist
- [x] **RULES-06**: Outbound policy enforcer: assertPolicyCanSend blocks sends when can_initiate=false or participation_mode=silent_observer
- [x] **RULES-07**: Policy-keyed LRU cache: scope ID + mtime key, short TTL, invalidate on edit
- [x] **RULES-08**: Manager authorization: owner-only appoint/revoke, global manager edit access, scope manager limited access
- [x] **RULES-09**: Compact resolved-payload builder: DM and group serializers producing minimal ResolvedPolicy objects
- [x] **RULES-10**: ctxPayload injection: WahaResolvedPolicy field attached to inbound context before model turn
- [x] **RULES-11**: Policy edit command: authorized field update + YAML file write via editPolicy action
- [x] **RULES-12**: Seed _default.yaml files: contacts and groups global defaults with schema-compliant values
- [x] **RULES-13**: Unit tests for merge engine, identity normalizer, payload builder, auth matrix
- [x] **RULES-14**: Integration tests for DM resolution, group resolution, unknown participant, outbound enforcement

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Group Events

- **GRP-01**: Handle group.join system messages and surface participant info to LLM
- **GRP-02**: Handle group.leave system messages and surface participant info to LLM
- **GRP-03**: Handle group.promote/group.demote system messages

### Platform Abstraction

- **PLAT-01**: Extract WahaClient class with config, retry, caching built in
- **PLAT-02**: Define platform adapter interface contract
- **PLAT-03**: Port whatsapp-messenger Claude Code skill to use WahaClient
- **PLAT-04**: Monorepo setup for core client and platform adapters

## Out of Scope

| Feature | Reason |
|---------|--------|
| Scheduled/delayed messages | WAHA does not support |
| WhatsApp Business templates | Not applicable for personal assistant use case |
| Broadcast lists | WAHA limitation |
| Call initiation | WAHA limitation |
| Disappearing messages | Low priority, complex state management |
| Hot-reload / live code swap | Gateway requires restart, minimal gain for complexity |
| Global message persistence | Privacy concerns, not plugin's job — OpenClaw handles history |
| Auto-reconnect with QR re-scan | Requires human intervention, WAHA handles network drops internally |
| Custom WhatsApp client | WAHA handles WebSocket, QR auth, encryption — massive scope |
| Unbounded parallel sends | Triggers WhatsApp rate limits and bans |
| Automatic retry for non-429 errors | Gateway handles retries upstream, double-retry creates storms |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REL-01 | Phase 1 | Complete |
| REL-02 | Phase 1 | Complete |
| REL-03 | Phase 1 | Complete |
| REL-04 | Phase 1 | Complete |
| REL-05 | Phase 1 | Complete |
| REL-06 | Phase 1 | Complete |
| REL-07 | Phase 1 | Complete |
| REL-08 | Phase 1 | Complete |
| REL-09 | Phase 1 | Complete |
| REL-10 | Phase 1 | Complete |
| REL-11 | Phase 1 | Complete |
| RES-01 | Phase 2 | Complete |
| RES-02 | Phase 2 | Complete |
| RES-03 | Phase 2 | Complete |
| RES-04 | Phase 2 | Complete |
| RES-05 | Phase 2 | Complete |
| FEAT-01 | Phase 3 | Complete |
| FEAT-02 | Phase 3 | Complete |
| FEAT-03 | Phase 3 | Complete |
| FEAT-04 | Phase 3 | Complete |
| FEAT-05 | Phase 3 | Complete |
| FEAT-06 | Phase 3 | Complete |
| FEAT-07 | Phase 3 | Complete |
| MSESS-01 | Phase 4 | Complete |
| MSESS-02 | Phase 4 | Complete |
| MSESS-03 | Phase 4 | Complete |
| MSESS-04 | Phase 4 | Complete |
| MSESS-05 | Phase 4 | Complete |
| MSESS-06 | Phase 4 | Complete |
| MSESS-07 | Phase 4 | Complete |
| MSESS-08 | Phase 4 | Complete |
| MSESS-09 | Phase 4 | Complete |
| MSESS-10 | Phase 4 | Complete |
| DOC-01 | Phase 5 | Complete |
| DOC-02 | Phase 5 | Complete |
| DOC-03 | Phase 5 | Complete |
| DOC-04 | Phase 5 | Complete |
| RULES-01 | Phase 6 | Planned |
| RULES-02 | Phase 6 | Planned |
| RULES-03 | Phase 6 | Planned |
| RULES-04 | Phase 6 | Planned |
| RULES-05 | Phase 6 | Planned |
| RULES-06 | Phase 6 | Planned |
| RULES-07 | Phase 6 | Planned |
| RULES-08 | Phase 6 | Planned |
| RULES-09 | Phase 6 | Planned |
| RULES-10 | Phase 6 | Planned |
| RULES-11 | Phase 6 | Planned |
| RULES-12 | Phase 6 | Planned |
| RULES-13 | Phase 6 | Planned |
| RULES-14 | Phase 6 | Planned |

**Coverage:**
- v1 requirements: 36 total (complete)
- Phase 6 requirements: 14 total (planned)
- Mapped to phases: 50
- Unmapped: 0

---
*Requirements defined: 2026-03-11*
*Last updated: 2026-03-14 after Phase 6 planning*
