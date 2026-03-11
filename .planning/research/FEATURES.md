# Feature Landscape

**Domain:** WhatsApp bot platform reliability, multi-session management, and trigger-word activation
**Researched:** 2026-03-11
**Context:** Subsequent milestone for WAHA OpenClaw Plugin (v1.10.4) -- hardening existing production system

## Table Stakes

Features users expect. Missing = system breaks under load or loses messages silently.

| Feature | Why Expected | Complexity | Confidence | Notes |
|---------|--------------|------------|------------|-------|
| Request timeouts (AbortController) | Every `fetch()` in send.ts can hang forever. Standard practice for any HTTP client. | Low | HIGH | 30s default. Wrap `callWahaApi` with AbortController. Single choke point since all calls go through it. |
| Structured error logging | `.catch(() => {})` in presence calls hides failures. Production systems need observability. | Low | HIGH | Replace silent catches with `console.warn` including action, chatId, error. |
| Webhook deduplication by messageId | WAHA delivers "at least once." Current dedup only filters `message` vs `message.any` event types, not duplicate deliveries of the same message. | Medium | HIGH | Sliding window Set of last 200 messageIds with TTL expiry (5 min). In-memory is fine -- restarts clear it safely. |
| Outbound rate limiter (token bucket) | WhatsApp aggressively bans accounts that send too fast. WAHA itself can return 429s. Every production WhatsApp bot needs send throttling. | Medium | HIGH | Token bucket: 20 tokens/sec capacity, refill at 15/sec. Queue excess, drain at allowed rate. Implement in `callWahaApi` wrapper. |
| 429 backoff (safety net) | Even with proactive rate limiting, WAHA or WhatsApp can throttle. Must handle gracefully. | Low | HIGH | Exponential backoff: 1s, 2s, 4s, max 30s. Max 3 retries. Add to `callWahaApi`. |
| Cache bounds (LRU) | `resolveTarget` cache has 30s TTL but no max size. Under sustained load, grows unbounded. | Low | HIGH | Cap at 1000 entries. Evict oldest on insert when full. Simple Map with doubly-linked list, or use a 50-line LRU class. |
| Session health monitoring | Silent WAHA disconnects go undetected. Bot stops receiving messages with no error. | Medium | HIGH | Ping `/api/{session}/me` every 60s. Log warning on 3 consecutive failures. Surface in admin panel Status tab. |

## Differentiators

Features that set the plugin apart from basic WhatsApp bot wrappers. Not expected, but high value for the OpenClaw use case.

| Feature | Value Proposition | Complexity | Confidence | Notes |
|---------|-------------------|------------|------------|-------|
| Multi-session registry with roles | Most WhatsApp bots are single-session. Supporting bot + human sessions with role-based permissions (bot/human, full-access/listener) enables cross-account orchestration. | High | MEDIUM | Config-driven session registry. Each session: `{name, sessionId, role: "bot"|"human", subRole: "full-access"|"listener"}`. Requires reworking `assertAllowedSession` guardrail (currently hardcoded to logan-only). |
| Trigger word activation | `!sammie <prompt>` in any group chat routes to the bot as a prompt. Standard pattern in Discord/Slack bots, rare in WhatsApp bots. Existing `groupFilter` patterns in inbound.ts are close but only filter, they do not route to bot as a prompt. | Medium | MEDIUM | Extend group filter: when trigger word detected, strip prefix, route stripped text as bot prompt. Config: `triggerWords: ["!sammie", "!bot"]`. Must handle: prefix stripping, case insensitivity, group context preservation. |
| Cross-session message routing | Bot responds via DM by default, but can send from user's session when bot is not a group member. Unique capability for personal assistant use cases. | High | MEDIUM | Requires: session permission checks, fallback logic (bot session -> user session), group membership detection. Risk: sending as user without clear guardrails is dangerous. Need explicit opt-in per session. |
| Inbound message queue with priority | Bounded async queue (100 messages) with DM priority over group messages. Prevents flood from busy groups overwhelming the bot. | Medium | HIGH | Priority queue: DMs get priority slot, groups get remaining capacity. Drop oldest group messages on overflow. Log drops. |
| URL preview send (link preview) | WAHA supports `/api/sendText` with `linkPreview: true` and `linkPreviewHighQuality: true`, plus `/api/send/link-custom-preview` for custom previews. Enables rich link sharing. | Low | HIGH | WAHA already has the endpoint. Just wire `sendWahaText` to pass `linkPreview: true` when text contains URLs. Custom preview: add `sendWahaLinkPreview` function for explicit control. |
| Mentions detection | Extract @mentioned JIDs from inbound messages, provide as context to LLM. Enables "respond when mentioned" without keyword matching. | Low | MEDIUM | WAHA message payload includes `mentionedJids` array. Parse and include in message context delivered to OpenClaw. |
| Multi-recipient send | Batch send to multiple chats with per-recipient results. Enables announcements, broadcast-like behavior. | Medium | MEDIUM | Sequential send with rate limiting (not parallel). Return `{chatId, success, error}[]`. Rate limit: 1 send/sec across batch. |
| Better error messages | Context-rich errors with suggested fixes instead of raw WAHA API errors. | Low | HIGH | Wrap WAHA error responses: include action name, target, HTTP status, and suggestion. E.g., "Failed to send to 972544329000@c.us (404): contact not found. Verify the phone number." |
| Mute/unmute chat | Basic feature gap. WAHA supports it, plugin doesn't expose it. | Low | HIGH | Wire to WAHA `/api/{session}/chats/{chatId}/mute` and `/unmute`. Add to UTILITY_ACTIONS. |
| Group events (join/leave) | Surface system messages about participant changes to the LLM. | Medium | LOW | WAHA webhook support for group events is unclear with NOWEB engine. Needs verification on actual webhook delivery before building. Flag for phase-specific research. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Automatic retry in `callWahaApi` for non-429 errors | Comment in send.ts says "gateway handles retries upstream." Adding retry creates double-retry storms. | Only retry on 429 (rate limit). All other errors: log and surface to caller. |
| Unbounded parallel sends | Sending to many chats in parallel will trigger WhatsApp rate limits and potential bans. | Sequential sends with token bucket. Never `Promise.all()` for bulk sends. |
| Global message persistence/history | Storing all messages creates privacy concerns, storage bloat, and is not the plugin's job. OpenClaw gateway handles conversation history. | Only persist directory data (contacts, groups) in SQLite. Messages stay transient. |
| Custom WhatsApp client (replacing WAHA) | WAHA handles the WebSocket connection, QR auth, encryption. Reimplementing is massive scope. | Stay on WAHA. Abstract via `callWahaApi` for potential future swap. |
| Hot-reload / live code swap | Gateway requires restart. Engineering around it adds complexity for minimal gain. | Accept restart requirement. Keep restart fast (<5s). |
| Scheduled/delayed messages | WAHA does not support scheduled sends. Building a scheduler adds state management complexity. | If needed later, use external cron/scheduler that calls the plugin's send action. |
| Full WhatsApp Business API features | Templates, catalogs, payments -- not applicable for personal assistant use case. | Keep focused on personal/small-team messaging. |
| Auto-reconnect with QR re-scan | Session loss requiring QR scan needs human intervention. Auto-reconnect only works for temporary network drops (WAHA handles this internally). | Detect session loss, alert user. Don't try to auto-fix QR-level disconnects. |

## Feature Dependencies

```
Request timeouts ──> Rate limiter (limiter needs timeout-aware calls)
                 ──> 429 backoff (backoff needs timeout-aware calls)

Error logging ──> Better error messages (logging infrastructure supports rich errors)

Session health monitoring ──> Multi-session registry (health checks need session list)

Multi-session registry ──> Trigger word activation (need to know which session is bot vs human)
                       ──> Cross-session routing (need role/permission model)
                       ──> Session fallback logic (need to enumerate available sessions)

Trigger word activation ──> Cross-session routing (trigger from human session, route to bot)

Webhook deduplication ──> Inbound message queue (dedup before queuing)
                      ──> Mentions detection (dedup ensures single processing)

URL preview send ──> (no dependencies, standalone)
Mute/unmute ──> (no dependencies, standalone)
Mentions detection ──> (no dependencies, standalone)
```

## MVP Recommendation

### Phase 1 -- Reliability (must ship first, system breaks without these)
1. **Request timeouts** -- single change in `callWahaApi`, protects everything
2. **Structured error logging** -- replace silent catches, immediate observability
3. **Webhook deduplication by messageId** -- prevents double-processing
4. **Cache bounds (LRU)** -- prevents memory leak
5. **Outbound rate limiter (token bucket)** -- prevents account ban
6. **429 backoff** -- safety net for rate limiter

### Phase 2 -- Resilience
1. **Session health monitoring** -- detect silent disconnects
2. **Inbound message queue with priority** -- handle load spikes
3. **Better error messages** -- LLM gets actionable errors

### Phase 3 -- Missing Features (quick wins)
1. **URL preview send** -- low effort, WAHA already supports it
2. **Mute/unmute chat** -- low effort, basic gap
3. **Mentions detection** -- low effort, improves group context
4. **Multi-recipient send** -- medium effort, enables announcements

### Phase 4 -- Multi-Session (high complexity, defer until reliability is solid)
1. **Multi-session registry with roles** -- foundation for everything else
2. **Trigger word activation** -- builds on registry
3. **Cross-session message routing** -- builds on registry + trigger words

**Defer indefinitely:** Group events (join/leave) -- needs NOWEB webhook verification first. Flag for research when Phase 3 starts.

## Complexity Budget

| Phase | Estimated Effort | Risk Level |
|-------|-----------------|------------|
| Phase 1 (Reliability) | 1-2 days | Low -- well-understood patterns, single file changes |
| Phase 2 (Resilience) | 1-2 days | Low-Medium -- health check is straightforward, queue needs testing |
| Phase 3 (Missing Features) | 2-3 days | Low -- mostly wiring existing WAHA endpoints |
| Phase 4 (Multi-Session) | 4-6 days | High -- reworks session guardrail, new config schema, cross-session security |

## Sources

- [WAHA Send Messages docs](https://waha.devlike.pro/docs/how-to/send-messages/) -- link preview API details (HIGH confidence)
- [WAHA Sessions docs](https://waha.devlike.pro/docs/how-to/sessions/) -- session management API (HIGH confidence)
- [WAHA Scaling guide](https://dev.to/waha/waha-scaling-how-to-handle-500-whatsapp-sessions-3fie) -- multi-session architecture (MEDIUM confidence)
- [Hookdeck webhook idempotency guide](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) -- dedup patterns (HIGH confidence)
- [Token bucket rate limiting in Node.js](https://hackernoon.com/the-token-bucket-algorithm-for-api-rate-limiting-in-nodejs-a-simple-guide) -- implementation pattern (HIGH confidence)
- [WhatsApp API rate limits overview](https://www.wati.io/en/blog/whatsapp-business-api/whatsapp-api-rate-limits/) -- rate limit context (MEDIUM confidence)
- [WhatsApp 2026 updates](https://sanuker.com/whatsapp-api-2026_updates-pacing-limits-usernames/) -- pacing changes (MEDIUM confidence)
- [CodeWords group activation](https://docs.codewords.ai/more-features/whatsapp-automations/for-whatsapp-groups) -- trigger word patterns (MEDIUM confidence)
- [node-rate-limiter](https://github.com/jhurliman/node-rate-limiter) -- existing TypeScript token bucket library (HIGH confidence)
- [wa-multi-session](https://github.com/mimamch/wa-multi-session) -- multi-session WhatsApp patterns (LOW confidence)
