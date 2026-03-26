# Phase 3: Feature Gaps - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Fill remaining feature gaps: auto-detect URLs and send with rich link preview, mute/unmute chats, extract @mentioned JIDs from inbound messages, and send messages to multiple recipients at once. Two requirements (FEAT-02 custom link preview, FEAT-07 error messages) are already satisfied by prior work and need only verification/marking.

Requirements: FEAT-01, FEAT-02, FEAT-03, FEAT-04, FEAT-05, FEAT-06, FEAT-07

</domain>

<decisions>
## Implementation Decisions

### Already Satisfied — Verify and Close
- **FEAT-02** (custom link preview): `sendWahaLinkPreview()` exists at send.ts line 591, exposed as `sendLinkPreview` utility action. Fully working.
- **FEAT-07** (context-rich error messages): `formatActionError()` in error-formatter.ts handles 9 error patterns with suggestions. Wired into handleAction. Completed in Phase 2.
- These two need no new code — just verification that they satisfy the requirements and marking complete in traceability.

### URL Auto-Preview on Regular Sends (FEAT-01)
- When `sendWahaText` is called with text containing a URL, automatically add `linkPreview: true` to the WAHA API payload
- Auto-detect URLs via simple regex (https?://...) — no need for LLM to explicitly request it
- This is separate from `sendWahaLinkPreview` (FEAT-02) which sends a custom preview card with explicit title/description/image
- Add a config option `autoLinkPreview` (default: true) so it can be disabled if needed
- Modify `sendWahaText` in send.ts to detect URLs and add the parameter

### Chat Mute/Unmute (FEAT-03, FEAT-04)
- Add `muteWahaChat()` and `unmuteWahaChat()` functions in send.ts
- WAHA API endpoints: `POST /api/{session}/chats/{chatId}/mute` and `POST /api/{session}/chats/{chatId}/unmute`
- Register as utility actions: `muteChat` and `unmuteChat` in UTILITY_ACTIONS and ACTION_HANDLERS
- Takes `chatId` parameter, uses standard account resolution pattern
- Mute duration: if WAHA supports a duration parameter, expose it; otherwise mute indefinitely
- These are NOT standard actions (no target mode in gateway) — use utility action pattern like muteChannel/unmuteChannel

### Mentions Detection (FEAT-05)
- Parse `mentionedJids` from the raw WAHA webhook payload (`rawPayload._data.message.extendedTextMessage.contextInfo.mentionedJid` or similar path)
- Research needed: verify exact WAHA webhook field path for mentioned JIDs
- Add `mentionedJids: string[]` to `WahaInboundMessage` type in types.ts
- Include mentioned JIDs in the inbound context payload sent to OpenClaw — add as a new field in ctxPayload
- Format for agent: "Mentions: @name1, @name2" appended to message context so Sammie knows who was tagged
- Only extract from direct messages, not from quoted/replied messages (keep scope minimal)

### Multi-Recipient Send (FEAT-06)
- Add a new `sendMulti` utility action (NOT modify existing `send` — keep single-target send unchanged)
- Parameters: `recipients` (array of chatIds or names), `text`, optional `replyToId`
- Implementation: sequential loop calling `sendWahaText` for each recipient (NOT parallel — respect rate limiter)
- Auto-resolve names for each recipient using existing `autoResolveTarget`
- Return array of per-recipient results: `[{ recipient, status: "sent"|"failed", error? }]`
- Do NOT fail fast — attempt all recipients even if some fail
- Maximum recipients: cap at 10 per call to prevent abuse
- No media support in sendMulti — text only for v1 (media multi-send deferred)

### Claude's Discretion
- URL detection regex pattern (simple vs comprehensive)
- Exact format of mentions in agent context (comma-separated vs structured)
- Whether to add sendMulti to SKILL.md examples or keep it discoverable via listActions
- Mute/unmute confirmation message format
- Order of implementation (which features to group into which plans)

</decisions>

<specifics>
## Specific Ideas

- FEAT-01 (auto link preview) is a quality-of-life improvement — when Sammie sends a URL, the recipient should see a rich card automatically without Sammie needing to use a special action
- Multi-recipient send is for when Sammie needs to announce something to multiple chats (e.g., "send this to the family group and the work group")
- Mentions detection helps Sammie understand social context — knowing who was @mentioned in a group message
- Chat mute/unmute is a basic capability gap — channel mute exists but regular chat mute doesn't

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sendWahaLinkPreview()` in send.ts (line 591): Custom link preview already works — FEAT-02 satisfied
- `formatActionError()` in error-formatter.ts: Error formatting already works — FEAT-07 satisfied
- `muteWahaChannel()` / `unmuteWahaChannel()` in send.ts (lines 1255-1265): Pattern to follow for chat mute/unmute
- `autoResolveTarget()` in channel.ts: Name-to-JID resolution, reuse for multi-recipient
- `ACTION_HANDLERS` map in channel.ts (line 106): Registration pattern for new utility actions
- `UTILITY_ACTIONS` array in channel.ts (line 263): Where new action names are listed

### Established Patterns
- Utility action registration: add to UTILITY_ACTIONS array + ACTION_HANDLERS map
- WAHA API callers: `resolveWahaAccount` → `assertAllowedSession` → `callWahaApi`
- Conditional spread for optional params: `...(params.foo ? { foo: params.foo } : {})`
- String coercion on gateway params: `String(p.chatId)`
- Inbound message extraction: raw webhook → typed WahaInboundMessage → ctxPayload for OpenClaw

### Integration Points
- `send.ts`: Add muteWahaChat, unmuteWahaChat, modify sendWahaText for linkPreview
- `channel.ts`: Register new actions in UTILITY_ACTIONS, ACTION_HANDLERS, add sendMulti handler
- `inbound.ts`: Extract mentionedJids from raw webhook payload in handleWahaInbound
- `types.ts`: Add mentionedJids field to WahaInboundMessage
- `config-schema.ts`: Add autoLinkPreview config field

</code_context>

<deferred>
## Deferred Ideas

- Media multi-send (images/videos to multiple recipients) — could add in a future phase
- Mention notifications (alert Sammie when he's specifically @mentioned) — could be useful but separate feature
- Link preview caching (avoid re-fetching previews for same URL) — premature optimization
- Mute with scheduled unmute (mute for X hours) — depends on WAHA support

</deferred>

---

*Phase: 03-feature-gaps*
*Context gathered: 2026-03-11*
