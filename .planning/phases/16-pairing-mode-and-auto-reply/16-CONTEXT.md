# Phase 16: Pairing Mode and Auto-Reply - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement passcode-gated pairing mode and auto-reply for unauthorized DMs. Unknown contacts receive either a passcode challenge (pairing mode) or a canned rejection (auto-reply), entirely scripted with zero LLM tokens. Correct passcodes grant temporary allowlist access with TTL (Phase 15). wa.me deep links with HMAC tokens enable zero-friction authorization. Admin panel provides pairing configuration, active grants display, and revoke capability.

</domain>

<decisions>
## Implementation Decisions

### Pairing Mode Engine
- New `src/pairing.ts` file — challenge state in SQLite `pairing_challenges` table (not memory, survives restarts)
- 6-digit numeric passcode via `node:crypto randomInt(100000, 999999)` — simple, WhatsApp-friendly
- wa.me deep link: `https://wa.me/{phone}?text=PAIR-{hmac_token}` where token is HMAC-SHA256(passcode+jid+secret) — obfuscated, one-use, verifiable without DB lookup
- Passcode storage: SQLite `pairing_challenges` table with jid, passcode_hash (SHA-256), created_at, attempts, locked_until columns
- Rate limiting: 3 wrong attempts → locked for 30 minutes (locked_until column)

### Auto-Reply System
- Pipeline position: after fromMe check + dedup, before DM policy check — pairing intercepts first, then auto-reply fires if no pairing match and contact unauthorized
- Rate limit: SQLite `auto_reply_log` table with jid and last_reply_at — one reply per contact per 24h (configurable)
- Template variables: `{admin_name}` resolves to Bot Admin role contact names from session config
- Toggle: "Send rejection message" on/off in Settings (some admins prefer silent drop)
- Default message: "Hey! Thanks for reaching out. Unfortunately, I'm not permitted to chat with you right now. Please ask {admin_name} to add you to my allow list."

### Admin Panel UI
- Passcode config in Settings tab → new "Pairing Mode" section under Access Control
- Passcode display, TTL dropdown for grants, enable/disable toggle, wa.me link generator button
- Active grants shown in Directory tab using TTL badges from Phase 15 + "Source: Pairing" badge to distinguish
- Revoke: click TTL badge → "Revoke" confirmation → removes from allowlist + config

### Claude's Discretion
- Exact HMAC secret generation and storage (per-session or global)
- Challenge message text (scripted, configurable in admin panel)
- Whether to support passcode rotation (generate new passcode) from admin panel
- Auto-reply message editor UI design
- How wa.me link generator renders in Settings (copy button, QR code?)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DirectoryDb` — SQLite connection, migration-safe ALTER TABLE pattern
- `setContactAllowDm(jid, allow, expiresAt)` — TTL-aware allow from Phase 15
- `syncExpiredToConfig()` — config file sync pattern from Phase 15
- `sendWahaText(params, chatId, text)` — send scripted messages
- `showToast()`, `createTagInput()`, `<details>` sections — admin panel components
- `node:crypto` — already imported in codebase

### Established Patterns
- fromMe guard in inbound pipeline — must come before pairing/auto-reply
- DO NOT CHANGE markers on inbound pipeline ordering
- textContent only in admin panel
- Template literal double-escaping in monitor.ts

### Integration Points
- `inbound.ts` handleWahaInbound — insert pairing + auto-reply hooks
- `channel.ts` loginAccount — start pairing system alongside health/sync
- Settings tab Access Control section — add Pairing Mode section
- Directory listing — extend TTL badge with source indicator

</code_context>

<specifics>
## Specific Ideas

- FEATURE-01: Passcode challenge/response with wa.me deep links
- FEATURE-03: Canned rejection auto-reply
- fromMe guard MUST precede pairing/auto-reply to prevent self-loop (pitfall from research)
- Pairing grants use Phase 15 TTL infrastructure (expires_at on allow_list)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
