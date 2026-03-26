# Phase 4: Multi-Session - Research

**Researched:** 2026-03-11
**Domain:** Multi-session WhatsApp management, role-based access control, trigger-word routing
**Confidence:** HIGH

## Summary

Phase 4 extends the existing multi-account infrastructure in `accounts.ts` to support role-based session management. The codebase already has `ResolvedWahaAccount`, `listEnabledWahaAccounts`, and `mergeWahaAccountConfig` -- these just need `role` and `subRole` fields added. The hardcoded `assertAllowedSession` guardrail in `send.ts` (which blocks "omer" by name) must be replaced with a config-driven role check. Trigger word detection is new inbound processing logic in `inbound.ts`. Cross-session routing requires a new session selection function that checks group membership via WAHA API.

The main risk is the `assertAllowedSession` rework -- it was accidentally broken before (noted in STATE.md blockers) and is called in 11+ places across `send.ts` and `monitor.ts`. The replacement must be backward-compatible: configs without role/subRole default to bot/full-access behavior.

**Primary recommendation:** Implement in layers -- (1) types + config schema, (2) role-based guardrail replacing assertAllowedSession, (3) trigger word detection, (4) cross-session routing + readMessages action, (5) admin panel Sessions tab.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Extend existing `accounts` config structure with `role` (bot/human) and `subRole` (full-access/listener) fields
- Roles are string-based, not enum -- new roles addable without code changes
- Backward compatible: missing role/subRole defaults to bot/full-access
- Replace hardcoded `assertAllowedSession` with role-based check reading config
- Listener subRole blocks ALL outgoing sends; bot/full-access and human/full-access can send
- Trigger word configurable in plugin config (`triggerWord`, default `!sammie`), case-insensitive, checks message start
- Trigger response strips prefix, routes to OpenClaw, responds via DM by default
- `triggerResponseMode` config: "dm" (default) or "reply-in-chat"
- Cross-session routing: bot session first, fall back to human session if bot not a member
- New `resolveSessionForTarget()` function for session selection
- Cache group membership per session (LRU, reasonable TTL)
- `readMessages` utility action: chatId + limit params, text-only response, max 50 messages
- Admin panel "Sessions" tab: read-only, shows name/sessionId/role/subRole/connection status
- Role changes via config API only (existing POST /api/admin/config)

### Claude's Discretion
- Exact trigger word stripping logic (regex vs string match)
- Group membership cache TTL and eviction strategy
- readMessages response format (how to present to LLM)
- Admin panel Sessions tab layout and styling
- Error message wording when listener session attempts to send

### Deferred Ideas (OUT OF SCOPE)
- Role editing from admin panel UI (v1 is read-only, config API handles changes)
- Trigger word aliases (multiple trigger words per bot)
- Per-group trigger word customization
- Media reading from listener sessions (v1 is text-only message reading)
- Auto-discovery of WAHA sessions (scan WAHA API for all sessions)
- Webhook routing per session (WAHA already sends session in payload)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MSESS-01 | Session registry with name, sessionId, role, sub-role | Extend `WahaAccountConfig` type + `WahaAccountSchemaBase` zod schema + `ResolvedWahaAccount` |
| MSESS-02 | Extensible roles (no code changes for new types) | String-based role/subRole fields, no TypeScript enum, validation via zod `.string()` not `.enum()` |
| MSESS-03 | Listener sub-role blocks outgoing sends | Replace `assertAllowedSession` in `send.ts` with `assertCanSend(session, cfg)` that reads role config |
| MSESS-04 | Admin panel sessions tab | New tab in monitor.ts embedded HTML, reuse existing tab pattern, read health state from `getHealthState()` |
| MSESS-05 | Configurable trigger word activation | New `triggerWord` field in config schema, detection in `inbound.ts` message preprocessing |
| MSESS-06 | Case-insensitive trigger matching | `.toLowerCase()` comparison on message start |
| MSESS-07 | Bot responds via DM by default | After trigger detection, use sender JID as target for bot response delivery |
| MSESS-08 | Bot sends from own session if member | `resolveSessionForTarget()` checks bot session membership first |
| MSESS-09 | Fallback to user session if bot not member | `resolveSessionForTarget()` iterates enabled full-access sessions, checks membership |
| MSESS-10 | Read recent messages from listener sessions | New `readMessages` utility action wrapping existing `getWahaChatMessages` with session override |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| lru-cache | (already installed) | Group membership cache | Already used for resolveTarget cache (Phase 1) |
| zod | (already installed) | Config schema validation | Already used for all config schemas |
| vitest | ^4.0.18 | Unit testing | Already configured in project |

### Supporting
No new dependencies needed. All functionality builds on existing infrastructure.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| String-based roles | TypeScript enum | Enum requires code changes for new roles -- user decision: strings |
| LRU for membership cache | Map with manual TTL | LRU already in project, handles eviction automatically |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Changes Structure
```
src/
├── types.ts           # Add role, subRole to WahaAccountConfig
├── config-schema.ts   # Add role, subRole, triggerWord, triggerResponseMode to schema
├── accounts.ts        # Add role/subRole to ResolvedWahaAccount, add resolveSessionForTarget()
├── send.ts            # Replace assertAllowedSession with assertCanSend (role-based)
├── inbound.ts         # Add trigger word detection in message preprocessing
├── channel.ts         # Add readMessages to UTILITY_ACTIONS + ACTION_HANDLERS
├── monitor.ts         # Add Sessions tab to admin panel HTML, enhance /api/admin/sessions
└── health.ts          # No changes needed (already tracks per-session health)
tests/
├── role-guardrail.test.ts   # Test assertCanSend with various role/subRole combos
├── trigger-word.test.ts     # Test trigger detection, stripping, case-insensitivity
└── session-router.test.ts   # Test resolveSessionForTarget logic
```

### Pattern 1: Role-Based Guardrail (replacing assertAllowedSession)

**What:** Replace hardcoded session name checks with config-driven role lookup
**When to use:** Every outbound send call (11+ call sites in send.ts + 1 in monitor.ts)

The current `assertAllowedSession` is called from `resolveAccountParams` (line 62-71 of send.ts), which is the single chokepoint for all outbound API calls. This means changing `resolveAccountParams` to accept and check role config covers all 60+ send functions automatically.

```typescript
// NEW: Role-based guardrail replacing assertAllowedSession
// Must accept cfg to look up role config for the session
export function assertCanSend(session: string, cfg: CoreConfig): void {
  const accounts = listEnabledWahaAccounts(cfg);
  const match = accounts.find(a => a.session === session);
  // Default: if no role config, allow (backward compatible)
  const role = match?.role ?? "bot";
  const subRole = match?.subRole ?? "full-access";
  if (subRole === "listener") {
    throw new Error(
      `Session '${session}' has sub-role 'listener' and cannot send messages. ` +
      `Change sub-role to 'full-access' in config to enable sending.`
    );
  }
  // full-access sessions (bot or human) can send
}
```

**Critical:** `resolveAccountParams` currently does not receive `cfg` -- it takes `cfg` as a parameter. It already has access. The change is replacing `assertAllowedSession(session)` with `assertCanSend(session, cfg)` inside `resolveAccountParams`.

### Pattern 2: Trigger Word Detection

**What:** Detect trigger word at start of inbound messages, strip prefix, route to bot
**When to use:** During inbound message preprocessing in `inbound.ts`

```typescript
// Trigger word detection — placed BEFORE group filter / DM filter checks
// so trigger-word messages bypass normal filtering
function detectTriggerWord(text: string, triggerWord: string): { triggered: boolean; strippedText: string } {
  if (!triggerWord) return { triggered: false, strippedText: text };
  const lower = text.trimStart().toLowerCase();
  const trigger = triggerWord.toLowerCase();
  if (!lower.startsWith(trigger)) return { triggered: false, strippedText: text };
  // Strip trigger + optional whitespace after it
  const afterTrigger = text.trimStart().slice(trigger.length).trimStart();
  return { triggered: true, strippedText: afterTrigger };
}
```

### Pattern 3: Cross-Session Routing

**What:** Select optimal session to send to a target chat based on membership
**When to use:** When bot session may not be in the target group

```typescript
// In accounts.ts or new session-router.ts
export async function resolveSessionForTarget(params: {
  cfg: CoreConfig;
  targetChatId: string;
  preferredAccountId?: string;
}): Promise<ResolvedWahaAccount> {
  // 1. Try bot sessions first (preferred)
  // 2. Check group membership via cached WAHA API call
  // 3. Fall back to human full-access sessions
  // 4. Throw if no session can reach the target
}
```

### Anti-Patterns to Avoid
- **Hardcoding session names:** The current `assertAllowedSession` hardcodes "omer" and "logan" -- the new system must be purely config-driven
- **Breaking backward compatibility:** Existing configs without role/subRole must continue working (default: bot/full-access)
- **Processing triggers on bot's own messages:** `fromMe` messages are already filtered in monitor.ts (line 2254) -- ensure trigger detection only runs on external messages
- **Checking membership on every send:** Use LRU cache for group membership lookups

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Group membership caching | Custom Map with setTimeout cleanup | `lru-cache` with TTL | Already in project, handles eviction, max size |
| Config schema validation | Manual type checking | Zod schemas (existing pattern) | Consistent with all other config fields |
| Message reading API | New WAHA fetch logic | Existing `getWahaChatMessages` | Already implemented, tested, has timeouts/rate limiting |

**Key insight:** Most of this phase extends existing infrastructure rather than building new systems. The account resolution, health monitoring, admin panel, and WAHA API call patterns are all established.

## Common Pitfalls

### Pitfall 1: assertAllowedSession Regression
**What goes wrong:** The guardrail is accidentally weakened or removed, allowing the bot to send messages AS the human user
**Why it happens:** The function is called in 11+ places via `resolveAccountParams` -- any refactor that misses the cfg parameter threading breaks the check
**How to avoid:** The new `assertCanSend` function must be called from `resolveAccountParams` which already receives `cfg`. Write comprehensive tests with all role/subRole combinations.
**Warning signs:** Messages appearing from the "omer" session in WhatsApp groups

### Pitfall 2: Backward Compatibility Break
**What goes wrong:** Existing single-session configs (no role/subRole) stop working after the update
**Why it happens:** New code requires role field but existing configs don't have it
**How to avoid:** Default values: role="bot", subRole="full-access". Zod schema uses `.optional().default("bot")`. Test with existing config format.
**Warning signs:** Gateway fails to start after update

### Pitfall 3: Trigger Word in Bot's Own Messages
**What goes wrong:** Bot sees its own message starting with trigger word and creates infinite loop
**Why it happens:** Trigger detection runs before `fromMe` check
**How to avoid:** `fromMe` is already filtered at line 2254 of monitor.ts before message processing. Verify trigger detection is placed AFTER this check.
**Warning signs:** Recursive message loops, gateway CPU spike

### Pitfall 4: monitor.ts assertAllowedSession for Webhooks
**What goes wrong:** Webhook handler at line 2238 still uses old `assertAllowedSession`, blocking webhooks from the human session entirely
**Why it happens:** The webhook handler needs to ACCEPT messages from ALL sessions (both bot and human) -- it currently blocks non-logan sessions
**How to avoid:** Replace the webhook `assertAllowedSession` check with a simple "is this a registered session?" check. All registered sessions should have their webhooks processed.
**Warning signs:** Messages from the human session's WhatsApp are silently dropped

### Pitfall 5: Cross-Session Routing API Calls
**What goes wrong:** Checking group membership for every send creates API call storms
**Why it happens:** WAHA API for group participants or chats is called without caching
**How to avoid:** LRU cache for membership checks. Recommended TTL: 5 minutes (groups don't change members frequently). Max entries: 500.
**Warning signs:** Rate limit 429 responses, slow sends

### Pitfall 6: Trigger Response DM Requires Sender JID
**What goes wrong:** Bot can't DM the trigger sender because it only has the group chatId
**Why it happens:** In group messages, `from` is the group JID, the actual sender is in `participant`
**How to avoid:** Use `participant` field (not `from`) for the DM target when trigger is detected in a group message. For DM messages, use `from`.
**Warning signs:** Bot tries to DM the group JID, or sends response back to the group

## Code Examples

### Extending WahaAccountConfig Type
```typescript
// In types.ts — add to WahaAccountConfig
export type WahaAccountConfig = {
  // ... existing fields ...
  role?: string;      // "bot" | "human" — extensible, no enum
  subRole?: string;   // "full-access" | "listener" — extensible, no enum
  triggerWord?: string;        // e.g., "!sammie"
  triggerResponseMode?: string; // "dm" | "reply-in-chat"
};
```

### Extending ResolvedWahaAccount
```typescript
// In accounts.ts — add to ResolvedWahaAccount
export type ResolvedWahaAccount = {
  // ... existing fields ...
  role: string;     // defaults to "bot"
  subRole: string;  // defaults to "full-access"
};
```

### Config Schema Addition
```typescript
// In config-schema.ts — add to WahaAccountSchemaBase
role: z.string().optional().default("bot"),
subRole: z.string().optional().default("full-access"),
triggerWord: z.string().optional(),
triggerResponseMode: z.string().optional().default("dm"),
```

### resolveAccountParams Update
```typescript
// In send.ts — replace assertAllowedSession call
function resolveAccountParams(cfg: CoreConfig, accountId?: string) {
  const account = resolveWahaAccount({ cfg, accountId: accountId ?? DEFAULT_ACCOUNT_ID });
  const session = account.session ?? "default";
  assertCanSend(session, cfg);  // NEW: role-based check
  return {
    baseUrl: account.baseUrl ?? "",
    apiKey: typeof account.apiKey === "string" ? account.apiKey : "",
    session,
  };
}
```

### readMessages Action Handler
```typescript
// In channel.ts ACTION_HANDLERS
readMessages: async (p, cfg, aid) => {
  const chatId = String(p.chatId);
  const limit = Math.min(Number(p.limit) || 10, 50);
  // Use specified session or find one that has access to the chat
  const messages = await getWahaChatMessages({
    cfg, chatId, limit, downloadMedia: false, accountId: aid,
  });
  // Return lean format for LLM consumption
  return Array.isArray(messages)
    ? messages.map((m: any) => ({
        from: m.from || m._data?.notifyName || "unknown",
        text: m.body || "",
        timestamp: m.timestamp,
      }))
    : messages;
},
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded session names in guardrail | Config-driven role-based checks | Phase 4 (this phase) | Enables multi-session without code changes |
| Single bot session for all sends | Cross-session routing with membership check | Phase 4 (this phase) | Bot can send to groups where only human is member |
| No trigger word support | Configurable trigger with DM response | Phase 4 (this phase) | Enables group interaction without DM filtering |

## Open Questions

1. **Trigger word interaction with group filter**
   - What we know: Group filter (`groupFilter` config with `mentionPatterns`) already filters group messages. Trigger word is a separate concept.
   - What's unclear: Should trigger-word messages bypass the group filter entirely, or should they only work if the group filter would have allowed them?
   - Recommendation: Trigger word should bypass group filter -- it's an explicit invocation, not a mention-based filter match. Place trigger detection BEFORE group filter in the processing pipeline.

2. **Webhook session validation scope**
   - What we know: `assertAllowedSession` in monitor.ts currently blocks non-logan webhooks. Multi-session requires processing webhooks from ALL registered sessions.
   - What's unclear: Should we process webhooks from sessions NOT in the config? (e.g., a third-party session sending webhooks to our endpoint)
   - Recommendation: Only process webhooks from sessions registered in config. Replace `assertAllowedSession` with `isRegisteredSession(session, cfg)` check.

3. **Cross-session routing: where to invoke**
   - What we know: `resolveAccountParams` is the chokepoint for all sends. Cross-session routing needs to select the right account BEFORE `resolveAccountParams` runs.
   - What's unclear: Should cross-session routing live in `channel.ts` (action dispatch layer) or deeper in `send.ts`?
   - Recommendation: In `channel.ts` handleAction -- resolve the right accountId before passing to action handlers. This keeps send.ts focused on API calls.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MSESS-01 | Config parses role/subRole fields | unit | `npx vitest run tests/role-guardrail.test.ts -t "config"` | No -- Wave 0 |
| MSESS-02 | Unknown role strings pass validation | unit | `npx vitest run tests/role-guardrail.test.ts -t "extensible"` | No -- Wave 0 |
| MSESS-03 | Listener subRole blocks sends | unit | `npx vitest run tests/role-guardrail.test.ts -t "listener"` | No -- Wave 0 |
| MSESS-04 | Admin sessions tab renders | manual-only | Manual browser check | N/A |
| MSESS-05 | Trigger word detected at message start | unit | `npx vitest run tests/trigger-word.test.ts -t "detect"` | No -- Wave 0 |
| MSESS-06 | Case-insensitive trigger matching | unit | `npx vitest run tests/trigger-word.test.ts -t "case"` | No -- Wave 0 |
| MSESS-07 | Trigger response uses sender JID for DM | unit | `npx vitest run tests/trigger-word.test.ts -t "dm"` | No -- Wave 0 |
| MSESS-08 | Bot session selected when member | unit | `npx vitest run tests/session-router.test.ts -t "bot member"` | No -- Wave 0 |
| MSESS-09 | Fallback to human session | unit | `npx vitest run tests/session-router.test.ts -t "fallback"` | No -- Wave 0 |
| MSESS-10 | readMessages returns lean format | unit | `npx vitest run tests/read-messages.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/role-guardrail.test.ts` -- covers MSESS-01, MSESS-02, MSESS-03
- [ ] `tests/trigger-word.test.ts` -- covers MSESS-05, MSESS-06, MSESS-07
- [ ] `tests/session-router.test.ts` -- covers MSESS-08, MSESS-09
- [ ] `tests/read-messages.test.ts` -- covers MSESS-10

## Sources

### Primary (HIGH confidence)
- Project source code: `src/accounts.ts`, `src/types.ts`, `src/config-schema.ts`, `src/send.ts`, `src/inbound.ts`, `src/channel.ts`, `src/monitor.ts`, `src/health.ts`
- Existing test files in `tests/` directory -- established patterns for vitest
- `CLAUDE.md` -- project rules, critical constraints, architecture docs
- `.planning/phases/04-multi-session/04-CONTEXT.md` -- user decisions

### Secondary (MEDIUM confidence)
- WAHA API patterns derived from existing callWahaApi usage in send.ts (60+ functions)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, extending existing infrastructure
- Architecture: HIGH - patterns are well-established in the codebase across 3 prior phases
- Pitfalls: HIGH - assertAllowedSession history is well-documented in STATE.md and code comments

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable infrastructure, no fast-moving dependencies)
