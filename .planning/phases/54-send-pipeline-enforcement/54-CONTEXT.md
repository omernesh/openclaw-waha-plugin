# Phase 54: Send Pipeline Enforcement - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire Phase 53's gate/cap enforcement into every outbound message path so that every agent send passes through time gate and hourly cap checks, with human-like timing variance (jitter, typing simulation, drain throttling).

</domain>

<decisions>
## Implementation Decisions

### Gate Enforcement Point
- Single chokepoint wrapper (`enforceMimicry()`) called before every outbound WAHA API send — not per-function checks
- Only "new content" actions count against cap: send, poll, location, vcard, forward, status posts are EXEMPT, edit/delete/pin/unpin are EXEMPT
- Blocked sends return structured error to caller so LLM sees "outside send window" — no silent drops
- Typing indicator sent AFTER gate check passes — only show typing if message will actually send

### Jitter & Timing Strategy
- Base delay between consecutive sends: 5 seconds with +/-40% jitter (3-7s effective range) — covers BEH-03 requirement
- Typing indicator duration: message.length / 4 chars-per-second, capped at 8s — ~50 WPM simulation (BEH-02)
- Jitter applies to BOTH agent replies (deliverWahaReply) AND gateway actions — consistent behavior
- Delay + typing implemented in the chokepoint (`enforceMimicry()`) as part of gate check

### Bypass & Edge Cases
- Bypass commands: `/shutup`, `/join`, `/leave` + any action with `bypassPolicy=true` (matches Phase 53 INFRA-04)
- Status/story posts do NOT count against hourly cap (different audience, separate concern)
- Batch behavior: all-or-nothing — pre-check batch size vs remaining cap, reject entire batch if would exceed
- Record send count AFTER WAHA API success only — failed calls don't consume cap quota

### Claude's Discretion
- Internal implementation of the chokepoint (function signature, error format, where exactly to hook in)
- Naming conventions for new types/interfaces
- Test structure and coverage approach

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/mimicry-gate.ts`: `checkTimeOfDay()`, `checkAndConsumeCap()`, `getCapStatus()`, `resolveGateConfig()`, `resolveCapLimit()`, `MimicryDb` singleton
- `src/send.ts`: `assertCanSend()`, `assertPolicyCanSend()` — existing guard pattern to follow
- `src/http-client.ts`: `callWahaApi()` — has timeout, 429 backoff, rate limiting already
- `sendWahaPresence()` — typing indicator function already exists
- `bypassPolicy` param already on `sendWahaText()` — extend to other send functions

### Established Patterns
- Guard functions called at top of send functions before API call
- `bypassPolicy?: boolean` param pattern for system command bypass
- Config resolution: global -> per-session -> per-target merge (3-level)
- TokenBucket per-account rate limiting in http-client.ts

### Integration Points
- `sendWahaText()` (line 207) — primary text send, already has bypassPolicy
- `sendWahaImage/Video/File()` — need bypassPolicy param added
- `sendWahaMediaBatch()` (line 376) — called by deliverWahaReply for media
- `deliverWahaReply()` in inbound.ts (line 145) — agent reply pipeline
- `sendWahaPoll/Location/Vcard/List/LinkPreview/ButtonsReply/Event()` — rich message senders
- `forwardWahaMessage()` — forward action
- All send functions already call `assertCanSend()` — enforceMimicry can follow same pattern

</code_context>

<specifics>
## Specific Ideas

- The chokepoint should be a single `enforceMimicry(session, chatId, opts)` function that returns allowed/blocked
- When allowed, it handles typing delay internally before returning
- When blocked, returns a structured error with reason (time gate vs cap exceeded)
- For batches, accept a `count` parameter for pre-checking multiple items at once

</specifics>

<deferred>
## Deferred Ideas

- Persistent message queue for "queue" mode (hold until window opens) — currently reject-only is safer
- Per-contact rateLimitExempt flag — deferred to EXEMPT-01
- Send-time distribution analytics — deferred to DIST-01

</deferred>
