# Domain Pitfalls

**Domain:** Reliability hardening and multi-session support for a production WhatsApp plugin (WAHA + OpenClaw)
**Researched:** 2026-03-11
**Confidence:** HIGH (based on codebase analysis + lessons learned history + community patterns)

## Critical Pitfalls

Mistakes that cause production outages, data loss, or require significant rework.

### Pitfall 1: AbortController Timeout Aborting Response Body Reads

**What goes wrong:** Adding `AbortSignal.timeout(30000)` to `fetch()` in `callWahaApi` can abort mid-response-body-read. The HTTP connection completes (status 200), but reading `response.json()` or `response.text()` takes time on large payloads (e.g., `getWahaGroups` returning hundreds of groups). The abort fires during the body parse, throwing `TimeoutError` on a request that actually succeeded server-side. The side effect (message sent, group created) already happened, but the caller thinks it failed and may retry.

**Why it happens:** `AbortSignal.timeout()` measures wall-clock time from signal creation, not from TCP connect. Large JSON responses or slow network reads eat into the budget after the server already processed the mutation.

**Consequences:** Duplicate messages sent to WhatsApp users. Duplicate group operations. The LLM receives an error and may retry the action, compounding the problem.

**Prevention:**
- Use separate timeouts for connect vs. body read, or set a generous timeout (30s) that accounts for body parsing time
- For mutation operations (send, edit, delete, create), do NOT retry on timeout -- return a warning like "Request may have succeeded but confirmation timed out"
- Use `AbortSignal.timeout()` (static method) rather than manual `setTimeout` + `controller.abort()` to avoid timer leak cleanup complexity
- Handle `error.name === 'TimeoutError'` distinctly from `error.name === 'AbortError'` (manual cancellation) in error logging

**Detection:** Monitor for duplicate messages in WhatsApp chats after deploying timeout logic. Check logs for "TimeoutError" on endpoints that return large payloads (`/api/groups`, `/api/contacts`, `/api/chats/overview`).

**Phase:** Phase 1 (R5: Request Timeouts)

---

### Pitfall 2: Rate Limiter Breaking Existing Synchronous Call Patterns

**What goes wrong:** The current `callWahaApi` is a simple async function -- callers `await` it and get a result. Wrapping it in a token-bucket rate limiter changes the timing contract: calls that used to resolve in ~50ms now queue for seconds. Callers that fire multiple API calls in sequence (e.g., `autoResolveTarget` calls `getGroups` + `getChatsOverview` + `getChannels` in sequence) suddenly take 3x longer because each call waits for a token.

**Why it happens:** Token bucket limiters add queuing delay that is invisible to callers. The `resolveWahaTarget` function makes 3 sequential API calls -- at 20 req/s that's fine, but if the bucket is partially drained by concurrent webhook-triggered API calls (presence updates, read receipts), the resolve calls queue behind them.

**Consequences:** Name resolution takes 5-10 seconds instead of <1s. The LLM times out waiting for the action response. User messages appear to hang. Presence calls (which are fire-and-forget `.catch(() => {})` pattern) drain the rate limiter budget, starving actual user-facing operations.

**Prevention:**
- Implement priority lanes: presence/typing calls get LOW priority, user-facing sends/resolves get HIGH priority
- Or: exempt fire-and-forget calls (presence, read receipts) from the rate limiter entirely -- they already swallow errors
- Set the rate limit generously (30-50 req/s) since WAHA is local (127.0.0.1) and can handle high throughput -- the limiter is a safety net, not a throttle
- Add the rate limiter at the `callWahaApi` level (single chokepoint), NOT per-function -- avoids missing any call paths
- Use `tryRemoveTokens()` (sync, non-blocking) for fire-and-forget calls: if no token available, skip the call silently

**Detection:** After deploying, measure p95 latency of `autoResolveTarget`. If it exceeds 3s, the rate limiter is too aggressive or presence calls are draining the budget.

**Phase:** Phase 1 (R2: Outbound Rate Limiter)

---

### Pitfall 3: Session Guardrail Regression During Multi-Session Support

**What goes wrong:** The current `assertAllowedSession()` hardcodes "only logan sessions can send." Multi-session support requires allowing other sessions to send (e.g., a human session triggered by `!sammie`). Developers weaken the guardrail to "allow any configured session" but forget to re-implement the core safety: the bot should never impersonate the human user's identity in contexts the human didn't authorize.

**Why it happens:** The guardrail was already accidentally removed once (see send.ts header comment, v1.9.0 history). The code comment says "DO NOT REMOVE" but multi-session fundamentally requires changing it. The temptation is to just remove the check and rely on config-level session roles, but a config error could then let the bot send as Omer.

**Consequences:** Bot sends messages AS the human user (Omer) in personal chats, groups, or to contacts. This is a privacy/trust violation with no undo -- WhatsApp messages are delivered permanently.

**Prevention:**
- Replace hardcoded guardrail with config-driven allowlist, but keep the default-deny principle: sessions not explicitly listed as `bot` or `full-access` CANNOT send
- Add a runtime assertion: if a session has role `human` and sub-role `listener`, throw on any send attempt (not just log)
- Add an integration test that verifies: given a human-listener session, all 80+ send functions throw
- Keep the guardrail function name `assertAllowedSession` and the DO NOT REMOVE comment -- update the comment to explain the new logic
- Log every cross-session send with session ID, target chat, and triggering user for audit

**Detection:** After deploying multi-session, grep gateway logs for the human session ID sending outbound messages. Any occurrence that isn't explicitly trigger-word-initiated is a regression.

**Phase:** Phase 5 (M1-M3: Session Registry + Roles)

---

### Pitfall 4: Webhook Deduplication by MessageId Breaking Legitimate Retries

**What goes wrong:** Adding messageId-based deduplication (sliding window of last 100 IDs) to prevent duplicate webhook processing. But WAHA sometimes delivers the same messageId for genuinely different events: `message` and `message.any` events share the same messageId. The current code already filters `message.any` events (processes only `message`), but adding messageId dedup on top creates a second filter layer that can interact badly -- if the event type filter order changes, the dedup layer silently drops the real event.

**Why it happens:** The deduplication and event-type filtering are solving overlapping problems. Developers add messageId dedup "for safety" without realizing the event-type filter already handles the `message`/`message.any` duplicate case.

**Consequences:** Legitimate inbound messages silently dropped. Users message Sammie and get no response. No error logged because the dedup layer considers it "already processed."

**Prevention:**
- Dedup key should be `${event.type}:${messageId}` not just `messageId` -- this way `message` and `message.any` events with the same messageId are distinct entries, and true duplicates (same type + same ID) are caught
- Use a `Set` with a circular buffer (not a `Map` with timestamps) for the sliding window -- simpler, no cleanup timer needed
- Log when dedup fires (at DEBUG level) so dropped messages are traceable
- Keep the existing `message`-only event type filter as the primary guard -- dedup is a secondary safety net

**Detection:** After deploying, monitor "messages processed" count in admin panel filter stats. If it drops compared to pre-deploy baseline without a corresponding drop in WhatsApp traffic, dedup is over-filtering.

**Phase:** Phase 1 (R5: Webhook Deduplication)

## Moderate Pitfalls

### Pitfall 5: LRU Cache Returning Stale Name-to-JID Mappings

**What goes wrong:** Converting `_resolveCache` from unbounded `Map` to LRU cache with max size. The current 30s TTL works because the cache is small and entries expire quickly. With LRU + max size, entries can survive much longer if they're frequently accessed (LRU promotes on read). A contact who changes their WhatsApp display name or a group that gets renamed will have stale name mappings that persist as long as the entry keeps getting read.

**Why it happens:** LRU eviction is based on access recency, not staleness. The `lru-cache` npm package does support TTL, but `ttlAutopurge` defaults to `false` -- stale entries remain in the cache contributing to max size until explicitly accessed (lazy expiry).

**Prevention:**
- Use `lru-cache` with BOTH `max` (1000) AND `ttl` (30000ms) AND `ttlAutopurge: true`
- Keep the 30s TTL from the current implementation -- it's well-tuned for the name resolution use case
- Do NOT increase TTL just because you're adding LRU -- the TTL protects against staleness, LRU protects against unbounded growth. They solve different problems
- Test: rename a group, then immediately resolve by old name -- should miss cache and re-fetch

**Phase:** Phase 1 (R4: Cache Bounds)

---

### Pitfall 6: Trigger Word Matching False Positives in Group Chats

**What goes wrong:** Implementing `!sammie` trigger word activation for group chats. The trigger word appears inside normal conversation: "I told !sammie about it" or "use !sammie-style formatting" or Hebrew text containing the substring. The bot activates on messages that weren't directed at it, consuming LLM tokens and sending unwanted responses.

**Why it happens:** Simple substring or regex matching (`/!sammie/i`) catches the trigger word in any position. WhatsApp group messages are conversational -- people reference the bot by name when talking ABOUT it, not TO it.

**Prevention:**
- Match trigger word at START of message only: `/^!sammie\b/i` (word boundary prevents partial matches)
- Or: require the trigger word to be the ONLY text before the prompt: `/^!sammie\s+(.+)/i` and extract group 1 as the prompt
- Allow configurable trigger words per session (not hardcoded) so different deployments can use different prefixes
- Add a cooldown per-user-per-group: if the same user triggers the bot more than 3 times in 60 seconds, suppress and log
- Consider requiring trigger word + mention (`@Sammie !sammie do X`) for extra-noisy groups -- but don't make this the default, it's too verbose

**Detection:** Monitor false positive rate by checking how often the bot responds in groups where no one explicitly requested it. Admin panel should show trigger activations per group.

**Phase:** Phase 5 (M5: Trigger Word Activation)

---

### Pitfall 7: Cross-Session Message Routing Loops

**What goes wrong:** Bot session (logan) receives a trigger-word message from human session (omer) in a group. Bot processes it, sends a response to the group. The webhook for the bot's own outgoing message arrives back at the inbound handler. If the bot's message contains the trigger word (e.g., quoting the user's message), it triggers processing again, creating an infinite loop.

**Why it happens:** WAHA sends webhooks for ALL messages in monitored chats, including messages sent BY the bot session itself. The current code may filter by `fromMe` in some paths but not all. Multi-session adds complexity: a message from the bot session IS `fromMe` for that session, but might not be filtered correctly if the webhook arrives tagged with a different session's perspective.

**Consequences:** Infinite message loop in a WhatsApp group. Bot floods the chat. WAHA rate-limits or bans the session. Users are spammed.

**Prevention:**
- Always filter `fromMe: true` messages in the inbound webhook handler BEFORE any trigger word processing
- Maintain a "recently sent" set of messageIds (last 50) -- if an inbound webhook messageId matches a recently sent message, skip immediately
- Add a circuit breaker: if the bot sends more than 5 messages to the same chat within 10 seconds, pause processing for that chat for 60 seconds
- For cross-session routing (bot sends via human session), track the messageId returned by the send API and add it to the "recently sent" set of BOTH sessions
- Log loop detection events at WARN level

**Detection:** Any chat where the bot sends >3 consecutive messages without human interaction is suspicious. Add this as an admin panel metric.

**Phase:** Phase 5 (M6-M7: Bot Response Routing + Fallback Logic)

---

### Pitfall 8: Silent Error Swallowing in Presence Calls Hiding Real Issues

**What goes wrong:** The codebase has ~20 instances of `.catch(() => {})` on presence/typing calls (grep confirmed). When adding structured error logging (Phase 1, R1), developers must decide: log these failures or keep them silent. If they add logging, presence errors flood the logs (presence calls fail frequently when contacts are offline). If they keep them silent, genuine API connectivity issues (wrong API key, WAHA down) are hidden behind the same `.catch(() => {})`.

**Why it happens:** Presence/typing indicators are cosmetic -- failure doesn't affect message delivery. The `.catch(() => {})` pattern was a pragmatic choice. But it masks real problems: if WAHA goes down, the first N presence calls fail silently before a real send call finally surfaces the error.

**Prevention:**
- Replace `.catch(() => {})` with `.catch(logPresenceError)` where `logPresenceError` logs at DEBUG level normally, but escalates to WARN if >5 consecutive presence failures occur (circuit breaker pattern)
- Track consecutive presence failure count per session -- if it exceeds threshold, trigger a session health check (R3)
- Do NOT promote all presence errors to WARN/ERROR -- the logs will be unreadable
- Keep the fire-and-forget pattern (no await) -- presence calls must not block message delivery

**Detection:** After deploying error logging, check that presence errors appear at DEBUG level in logs. If they're absent, the logging isn't connected. If they flood at WARN level, the threshold is too low.

**Phase:** Phase 1 (R1: Error Logging) and Phase 2 (R3: Session Health Check)

## Minor Pitfalls

### Pitfall 9: Config PUT Replacing Entire WAHA Session Config

**What goes wrong:** When adding multi-session management (admin panel session tab), the PUT endpoint for WAHA session config REPLACES the entire config object. Updating one field (e.g., webhook URL) without including all other fields (noweb.store, markOnline, metadata) silently deletes them.

**Prevention:**
- Always GET the current session config, merge changes, then PUT the full object
- Add a helper function `patchWahaSessionConfig(session, partial)` that does GET-merge-PUT atomically
- Document this in LESSONS_LEARNED.md (it's already mentioned but easy to forget)

**Phase:** Phase 5 (M4: Admin Panel Session Management)

---

### Pitfall 10: Memory Leak from Unbounded Event Listeners in Multi-Session

**What goes wrong:** Each session registers webhook listeners, interval timers (health checks), and presence subscriptions. When sessions are added/removed dynamically, old listeners and timers are not cleaned up, causing memory leaks over hours/days.

**Prevention:**
- Track all intervals and listeners per session in a `Map<sessionId, Disposable[]>`
- When removing a session, iterate and dispose all registered resources
- Use `AbortController` per session to cancel all associated async operations on session removal
- Add a memory usage metric to the admin panel status tab

**Phase:** Phase 5 (M1: Session Registry)

---

### Pitfall 11: SQLite WAL Mode Conflicts Under Multi-Session Write Contention

**What goes wrong:** The `DirectoryDb` uses SQLite in WAL mode, which supports concurrent reads but only one writer at a time. Multi-session support means multiple inbound webhook handlers writing contact/participant records simultaneously. SQLite will handle this with busy-wait, but if a write takes too long (bulk directory refresh), other writes queue up and eventually timeout with `SQLITE_BUSY`.

**Prevention:**
- Set `busy_timeout` pragma (e.g., 5000ms) so SQLite retries instead of immediately failing
- Batch directory refresh writes in a single transaction (already good practice, verify it's done)
- Consider separate directory databases per session if write contention becomes measurable
- Monitor `SQLITE_BUSY` errors in logs after deploying multi-session

**Phase:** Phase 5 (M1: Session Registry)

---

### Pitfall 12: 429 Backoff Timer Stacking

**What goes wrong:** Multiple concurrent API calls all receive 429 responses simultaneously. Each one independently starts an exponential backoff retry. When the backoff period expires, all pending calls retry at the same instant, creating a "thundering herd" that triggers another round of 429s.

**Prevention:**
- Add jitter to backoff delays: `delay = baseDelay * 2^attempt + random(0, baseDelay)`
- Use a shared backoff state: when one call receives 429, ALL pending calls should wait (not just the one that got rejected)
- Read the `Retry-After` header from WAHA's 429 response if present -- it's more accurate than exponential guessing
- Cap max retries at 3 with max delay of 30s

**Phase:** Phase 1 (R2: 429 Backoff Safety Net)

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: Request Timeouts | AbortController aborting during response body read | Generous timeout (30s), don't retry mutations on timeout |
| Phase 1: Rate Limiter | Presence calls draining the rate limit budget | Exempt or deprioritize fire-and-forget calls |
| Phase 1: Cache Bounds | LRU keeping stale entries alive via access recency | Use TTL + LRU together, keep 30s TTL |
| Phase 1: 429 Backoff | Thundering herd on backoff expiry | Add jitter, use shared backoff state |
| Phase 1: Webhook Dedup | Over-filtering legitimate messages | Dedup key = `eventType:messageId`, not just messageId |
| Phase 1: Error Logging | Presence errors flooding logs | Log at DEBUG, escalate after consecutive failures |
| Phase 2: Message Queue | Queue overflow dropping DMs in favor of group spam | Priority queue: DMs > groups > presence |
| Phase 2: Session Health | Health check ping counted against rate limiter | Exempt health pings from rate limiting |
| Phase 5: Session Guardrail | Removing DO NOT REMOVE guard for multi-session | Replace with config-driven allowlist, keep default-deny |
| Phase 5: Trigger Words | False positives in group conversations | Match at message start only with word boundary |
| Phase 5: Cross-Session Routing | Message routing loops between sessions | Filter fromMe + recently-sent set + circuit breaker |
| Phase 5: Session Config | PUT replacing entire config, deleting fields | GET-merge-PUT helper function |
| Phase 5: Session Lifecycle | Memory leaks from uncleared listeners/timers | Per-session disposable registry |

## Sources

- Codebase analysis: `src/send.ts`, `src/channel.ts`, `src/inbound.ts`, `src/accounts.ts`, `src/directory.ts`, `src/presence.ts` (direct inspection)
- Project history: `docs/LESSONS_LEARNED.md`, `docs/ROADMAP.md`, `CLAUDE.md` (verified patterns and past regressions)
- [AbortController Guide - Better Stack](https://betterstack.com/community/guides/scaling-nodejs/understanding-abortcontroller/)
- [AbortSignal.timeout() - MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- [Managing Async Operations with AbortController - AppSignal](https://blog.appsignal.com/2025/02/12/managing-asynchronous-operations-in-nodejs-with-abortcontroller.html)
- [Token Bucket Rate Limiter - CodeSignal](https://codesignal.com/learn/courses/throttling-api-requests/lessons/throttling-api-requests-with-token-bucket-1)
- [limiter npm package](https://www.npmjs.com/package/limiter)
- [lru-cache npm package](https://www.npmjs.com/package/lru-cache)
- [LRU Cache in Node.js - DEV Community](https://dev.to/darkmavis1980/when-and-how-to-use-lru-cache-in-nodejs-backend-projects-42c8)
- [WAHA Scaling - 500+ Sessions](https://dev.to/waha/waha-scaling-how-to-handle-500-whatsapp-sessions-3fie)
- [WAHA Sessions API - DeepWiki](https://deepwiki.com/devlikeapro/waha/4.1-sessions-api)
