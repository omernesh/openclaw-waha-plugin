# Phase 55: Claude Code Integration - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Create a proxy-send endpoint in monitor.ts that applies mimicry enforcement (time gate, cap, typing simulation) to sends from the whatsapp-messenger Claude Code skill. Update the skill to route all sends through this proxy instead of calling WAHA API directly.

</domain>

<decisions>
## Implementation Decisions

### Proxy Endpoint Design
- URL: `POST /api/admin/proxy-send` — under admin namespace, matches success criteria
- Authentication: Same Bearer token as other admin routes via existing `requireAdminAuth()`
- Supported send types: text + media (sendText, sendImage, sendVideo, sendFile) — covers full skill usage
- JSON body format: Same as WAHA API (`{chatId, text, session, ...}`) so proxy can forward transparently

### Skill Routing Strategy
- Proxy URL: **config-driven** — skill reads URL from environment variable or config, not hardcoded
- No direct WAHA API fallback — if proxy is down, sends fail visibly (don't bypass mimicry)
- Session/chatId passed in same JSON body structure as WAHA API for transparent forwarding

### Claude's Discretion
- Internal proxy implementation (how it calls enforceMimicry + recordMimicrySuccess)
- Config variable name for proxy URL
- Error response format from proxy when gate/cap blocks

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `requireAdminAuth()` in monitor.ts — Bearer token auth guard
- `enforceMimicry()` from `src/mimicry-enforcer.ts` — Phase 54 chokepoint
- `recordMimicrySuccess()` from `src/mimicry-enforcer.ts` — post-success recording
- `callWahaApi()` from `src/http-client.ts` — WAHA API call wrapper with timeout, retry, rate limiting
- `sendWahaPresence()` from `src/send.ts` — typing indicator

### Established Patterns
- Admin routes all at `/api/admin/*` with shared auth middleware
- Config stored in `~/.openclaw/openclaw.json` via config-io.ts
- Webhook server in monitor.ts handles HTTP + SSE

### Integration Points
- `monitor.ts` — add new route handler for `/api/admin/proxy-send`
- `~/.claude/skills/whatsapp-messenger/SKILL.md` — update skill to use proxy URL
- whatsapp-messenger skill currently calls WAHA API directly via SSH + python3/curl on hpg6

</code_context>

<specifics>
## Specific Ideas

- Proxy should call enforceMimicry() then forward to WAHA API via callWahaApi()
- Return same response shape as WAHA API to skill (transparent proxy)
- On gate/cap block, return clear error JSON with reason

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
