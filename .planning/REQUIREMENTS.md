# Requirements: WAHA OpenClaw Plugin

**Defined:** 2026-03-11
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures.

## v1 Requirements

Requirements for this milestone cycle. Each maps to roadmap phases.

### Reliability

- [ ] **REL-01**: All WAHA API calls have structured error logging with action name, chatId, and error context
- [ ] **REL-02**: All silent `.catch(() => {})` patterns replaced with warning logs (presence, typing, seen calls)
- [ ] **REL-03**: All WAHA API fetch() calls have 30s AbortController-based timeouts
- [ ] **REL-04**: Timeout errors on mutation endpoints return "may have succeeded" warnings instead of retrying
- [ ] **REL-05**: Proactive token-bucket rate limiter on all outbound WAHA API calls (configurable, default ~20 req/s)
- [ ] **REL-06**: Fire-and-forget calls (presence, typing) exempt from or deprioritized in rate limiter
- [ ] **REL-07**: Exponential backoff with jitter on 429 responses (1s/2s/4s, max 3 retries, cap 30s)
- [ ] **REL-08**: Read `Retry-After` header from 429 responses when present
- [ ] **REL-09**: Webhook deduplication by composite key `${eventType}:${messageId}` (sliding window of 200, 5-min TTL)
- [ ] **REL-10**: resolveTarget cache replaced with LRU cache (max 1000 entries, 30s TTL)
- [ ] **REL-11**: Memory audit — verify no unbounded growth in caches, event listeners, or webhook handler state

### Resilience

- [ ] **RES-01**: Session health check pings WAHA `/api/{session}/me` every 60s
- [ ] **RES-02**: Log warning after 3 consecutive health check failures, surface in admin panel Status tab
- [ ] **RES-03**: Inbound message queue with bounded size (100 messages), drop oldest on overflow
- [ ] **RES-04**: DM messages get priority over group messages in the inbound queue
- [ ] **RES-05**: All action handler errors return LLM-friendly messages with action name, target, and suggested fix

### Features

- [ ] **FEAT-01**: Send URLs with rich link preview using WAHA's `linkPreview: true` parameter
- [ ] **FEAT-02**: Custom link preview send via WAHA `/api/send/link-custom-preview` endpoint
- [ ] **FEAT-03**: Mute chat action via WAHA `/api/{session}/chats/{chatId}/mute`
- [ ] **FEAT-04**: Unmute chat action via WAHA `/api/{session}/chats/{chatId}/unmute`
- [ ] **FEAT-05**: Extract @mentioned JIDs from inbound messages and include in message context
- [ ] **FEAT-06**: Multi-recipient send — sequential send to multiple chats with per-recipient results
- [ ] **FEAT-07**: Context-rich error messages with suggested fixes (e.g., "contact not found — verify phone number")

### Multi-Session

- [ ] **MSESS-01**: Session registry in plugin config — each session has name, sessionId, role (bot/human), sub-role (full-access/listener)
- [ ] **MSESS-02**: Roles are extensible — new role types can be added without code changes
- [ ] **MSESS-03**: Listener sub-role blocks all outgoing message sends
- [ ] **MSESS-04**: Admin panel tab to manage sessions — assign roles/sub-roles, view connection status
- [ ] **MSESS-05**: Configurable trigger word (e.g., `!sammie`) — when detected in any chat, strip prefix and route text as bot prompt
- [ ] **MSESS-06**: Trigger word matching is case-insensitive
- [ ] **MSESS-07**: Bot responds to trigger-word prompts via DM to the requesting user by default
- [ ] **MSESS-08**: If user requests group delivery and bot is a member, bot sends from its own session
- [ ] **MSESS-09**: If bot is not a member of the target group, send via user's session (respecting role/sub-role permissions)
- [ ] **MSESS-10**: Bot can read recent messages from chats it monitors (via listener sessions) to fulfill context prompts

### Documentation

- [ ] **DOC-01**: SKILL.md refreshed with error scenarios, rate limit guidance, and multi-session examples
- [ ] **DOC-02**: Unit tests for fuzzyScore, toArr, resolveChatId, autoResolveTarget, LRU cache, token bucket
- [ ] **DOC-03**: Integration tests for action handlers with mock WAHA API
- [ ] **DOC-04**: README updated with installation, configuration, deployment guide

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
| REL-01 | Phase 1 | Pending |
| REL-02 | Phase 1 | Pending |
| REL-03 | Phase 1 | Pending |
| REL-04 | Phase 1 | Pending |
| REL-05 | Phase 1 | Pending |
| REL-06 | Phase 1 | Pending |
| REL-07 | Phase 1 | Pending |
| REL-08 | Phase 1 | Pending |
| REL-09 | Phase 1 | Pending |
| REL-10 | Phase 1 | Pending |
| REL-11 | Phase 1 | Pending |
| RES-01 | Phase 2 | Pending |
| RES-02 | Phase 2 | Pending |
| RES-03 | Phase 2 | Pending |
| RES-04 | Phase 2 | Pending |
| RES-05 | Phase 2 | Pending |
| FEAT-01 | Phase 3 | Pending |
| FEAT-02 | Phase 3 | Pending |
| FEAT-03 | Phase 3 | Pending |
| FEAT-04 | Phase 3 | Pending |
| FEAT-05 | Phase 3 | Pending |
| FEAT-06 | Phase 3 | Pending |
| FEAT-07 | Phase 3 | Pending |
| MSESS-01 | Phase 4 | Pending |
| MSESS-02 | Phase 4 | Pending |
| MSESS-03 | Phase 4 | Pending |
| MSESS-04 | Phase 4 | Pending |
| MSESS-05 | Phase 4 | Pending |
| MSESS-06 | Phase 4 | Pending |
| MSESS-07 | Phase 4 | Pending |
| MSESS-08 | Phase 4 | Pending |
| MSESS-09 | Phase 4 | Pending |
| MSESS-10 | Phase 4 | Pending |
| DOC-01 | Phase 5 | Pending |
| DOC-02 | Phase 5 | Pending |
| DOC-03 | Phase 5 | Pending |
| DOC-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 36 total
- Mapped to phases: 36
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-11*
*Last updated: 2026-03-11 after initial definition*
