# Phase 4: Multi-Session - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Multiple WhatsApp sessions (bot and human) coexist with role-based permissions, trigger word activation enables group chat interaction, and sessions are manageable from the admin panel. The bot session (Sammie/logan) handles outbound sends; human sessions (omer) act as listeners that can receive messages and trigger bot interactions via trigger words.

Requirements: MSESS-01, MSESS-02, MSESS-03, MSESS-04, MSESS-05, MSESS-06, MSESS-07, MSESS-08, MSESS-09, MSESS-10

</domain>

<decisions>
## Implementation Decisions

### Session Registry (MSESS-01, MSESS-02)
- Extend existing `accounts` config structure — each account already has `sessionId`, `baseUrl`, `apiKey`
- Add `role` field: `"bot"` or `"human"` (default: `"bot"` for backward compatibility)
- Add `subRole` field: `"full-access"` or `"listener"` (default: `"full-access"`)
- Roles are string-based, not enum — new roles can be added without code changes (MSESS-02)
- The existing `accounts.ts` (`resolveWahaAccount`, `listEnabledWahaAccounts`) already supports multi-account; extend `WahaAccountConfig` and `ResolvedWahaAccount` types with role/subRole fields
- Keep backward compatible: if no role/subRole specified, default to bot/full-access (existing single-session configs just work)

### Listener Guardrail (MSESS-03)
- Replace hardcoded `assertAllowedSession` (currently blocks "omer") with role-based check
- New logic: if session's subRole is `"listener"`, block ALL outgoing sends (throw descriptive error)
- Bot sessions with `"full-access"` subRole can send freely
- Human sessions with `"full-access"` subRole can also send (for cases where user's session needs to send on their behalf)
- The guardrail check stays in `send.ts` but reads role config instead of hardcoding session names

### Trigger Word Activation (MSESS-05, MSESS-06, MSESS-07)
- Configurable trigger word in plugin config: `triggerWord` field (default: `"!sammie"`)
- Matching is case-insensitive (MSESS-06) and checks message start
- When trigger detected in ANY inbound message (group or DM):
  1. Strip trigger prefix from message text
  2. Route remaining text as bot prompt to OpenClaw
  3. Bot responds via DM to the requesting user by default (MSESS-07)
- Trigger detection happens in `inbound.ts` during message preprocessing
- Add `triggerResponseMode` config: `"dm"` (default) or `"reply-in-chat"` — controls where bot responds

### Cross-Session Routing (MSESS-08, MSESS-09)
- When bot needs to send to a group: check if bot session is a member → use bot session
- If bot is not a member: fall back to a human session that IS a member (respecting permissions)
- Session selection logic: new `resolveSessionForTarget()` function in accounts.ts or a new `session-router.ts`
- Uses WAHA `/api/{session}/chats` or group participant list to check membership
- Cache group membership per session (LRU, reasonable TTL) to avoid repeated API calls

### Message Reading from Listener Sessions (MSESS-10)
- Bot can read recent messages from chats monitored by listener sessions
- Use WAHA `/api/{session}/chats/{chatId}/messages?limit=N` endpoint
- Expose as utility action: `readMessages` with params: `chatId`, `limit` (default 10, max 50)
- Only works on sessions the plugin has access to (uses listener session credentials)
- Returns message text, sender, timestamp — not full media (keep response lean)

### Admin Panel Sessions Tab (MSESS-04)
- New "Sessions" tab in admin panel (monitor.ts embedded HTML)
- Shows all registered sessions with: name, sessionId, role, subRole, connection status (from health monitor)
- Connection status pulls from existing health monitor state (already tracks per-session health)
- Read-only for v1 — viewing/monitoring only, no inline role editing from UI
- Role/subRole changes go through config API (existing POST /api/admin/config)

### Claude's Discretion
- Exact trigger word stripping logic (regex vs string match)
- Group membership cache TTL and eviction strategy
- readMessages response format (how to present to LLM)
- Admin panel Sessions tab layout and styling
- Error message wording when listener session attempts to send

</decisions>

<specifics>
## Specific Ideas

- The two existing sessions are `3cf11776_logan` (Sammie/bot, full-access) and `3cf11776_omer` (Omer/human, listener)
- Trigger word use case: Omer types "!sammie what's the weather" in a family group → Sammie strips prefix, processes, DMs Omer the answer
- The `assertAllowedSession` guardrail has been accidentally broken before (noted in STATE.md blockers) — needs careful rework with role-based logic and tests
- Cross-session routing enables Sammie to send messages in groups where only Omer's session is a member

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `accounts.ts` (`resolveWahaAccount`, `listEnabledWahaAccounts`, `ResolvedWahaAccount`): Multi-account infrastructure already exists — extend with role/subRole
- `assertAllowedSession()` in send.ts:31: Current guardrail — replace hardcoded "omer" check with role-based check
- `health.ts` (HealthMonitor): Already pings per-session — can provide connection status for admin panel
- `monitor.ts` admin panel: Existing tab system — add Sessions tab following same pattern
- `config-schema.ts`: Schema validation — add role/subRole fields
- `types.ts` (`WahaAccountConfig`): Account type definition — extend with role/subRole

### Established Patterns
- Account resolution: `resolveWahaAccount` with `cfg` + `accountId` → `ResolvedWahaAccount`
- Utility action registration: add to `UTILITY_ACTIONS` + `ACTION_HANDLERS` in channel.ts
- Config merging: base config merged with per-account overrides in `mergeWahaAccountConfig`
- Inbound message preprocessing: raw webhook → extract fields → build ctxPayload → deliver to OpenClaw
- Admin panel API routes: `GET/POST /api/admin/*` in monitor.ts with embedded HTML/JS

### Integration Points
- `accounts.ts`: Add role/subRole to types, update resolution logic
- `send.ts`: Replace `assertAllowedSession` with role-based check
- `inbound.ts`: Add trigger word detection in message preprocessing
- `channel.ts`: Add readMessages utility action, update session routing
- `monitor.ts`: Add Sessions tab to admin panel, add `/api/admin/sessions` enhancements
- `config-schema.ts`: Add role, subRole, triggerWord fields
- `types.ts`: Extend WahaAccountConfig with role/subRole/triggerWord

</code_context>

<deferred>
## Deferred Ideas

- Role editing from admin panel UI (v1 is read-only, config API handles changes)
- Trigger word aliases (multiple trigger words per bot) — keep simple with single trigger for now
- Per-group trigger word customization — future enhancement
- Media reading from listener sessions (v1 is text-only message reading)
- Auto-discovery of WAHA sessions (scan WAHA API for all sessions) — manual config for now
- Webhook routing per session (WAHA already sends session in payload — existing code handles this)

</deferred>

---

*Phase: 04-multi-session*
*Context gathered: 2026-03-11*
