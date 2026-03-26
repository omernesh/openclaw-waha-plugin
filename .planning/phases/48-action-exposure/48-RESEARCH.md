# Phase 48: Action Exposure - Research

**Researched:** 2026-03-26
**Domain:** channel.ts UTILITY_ACTIONS audit — exposing implemented handlers to the agent
**Confidence:** HIGH

## Summary

Phase 48 is a pure `channel.ts` edit. The implementation gap is simple: `ACTION_HANDLERS` in `channel.ts` contains ~80+ actions, but `UTILITY_ACTIONS` only exposes a curated subset. Dozens of fully-implemented group, chat, contact, status, presence, and profile actions are reachable by the gateway (via `supportsAction`) but invisible to the LLM (not in `listActions()`). The fix is to add missing action names to `UTILITY_ACTIONS`.

Two actions have name mismatches between the requirement spec and the existing handler: `demoteToMember` (requirement) vs `demoteFromAdmin` (handler), and `getMessageById` (requirement) vs `getChatMessage` (handler). The correct approach is to add the existing handler name to UTILITY_ACTIONS and add an alias for the requirement name where needed.

Three actions need both new `send.ts` functions AND `ACTION_HANDLERS` entries: `createOrUpdateContact` (maps to `PUT /api/{session}/contacts/{contactId}`, confirmed working), `getNewMessageId` (maps to `GET /api/{session}/status/new-message-id`, confirmed working), and `convertVoice`/`convertVideo` (map to `POST /api/{session}/media/convert/voice|video`, confirmed live). Session management and API key CRUD (`createApiKey`, `getApiKeys`, `updateApiKey`, `deleteApiKey`) must be removed from UTILITY_ACTIONS — they are currently exposed and must not be.

**Primary recommendation:** Three-pass edit — (1) remove admin-only actions from UTILITY_ACTIONS, (2) add existing handler names for all requirements, (3) implement 4 missing send.ts functions + handler entries for `createOrUpdateContact`, `getNewMessageId`, `convertVoice`, `convertVideo`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion — pure infrastructure phase.

### Claude's Discretion
Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)
None — infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACT-01 | All group admin actions exposed in UTILITY_ACTIONS (addParticipants, removeParticipants, promoteToAdmin, demoteToMember, setGroupSubject, setGroupDescription, setGroupPicture, deleteGroupPicture, getGroupPicture, setInfoAdminOnly, setMessagesAdminOnly, getInviteCode, revokeInviteCode, deleteGroup, leaveGroup) | All 15 are in ACTION_HANDLERS — just need UTILITY_ACTIONS entries. Note: handler uses `demoteFromAdmin`, not `demoteToMember` — need alias. |
| ACT-02 | All chat management actions exposed (archiveChat, unarchiveChat, clearMessages, unreadChat, getChatPicture, getMessageById) | archiveChat, unarchiveChat, unreadChat, getChatPicture all in ACTION_HANDLERS. `clearMessages` maps to handler `clearChatMessages`. `getMessageById` maps to handler `getChatMessage` — needs alias. |
| ACT-03 | All contact actions exposed (getContactAbout, getContactPicture, blockContact, unblockContact, createOrUpdateContact) | First 4 in ACTION_HANDLERS. `createOrUpdateContact` is NOT implemented — needs new send.ts function + handler entry. WAHA endpoint: `PUT /api/{session}/contacts/{contactId}`, confirmed working. |
| ACT-04 | All status/stories actions exposed (sendVoiceStatus, sendVideoStatus, deleteStatus, getNewMessageId) | sendVoiceStatus, sendVideoStatus, deleteStatus all in ACTION_HANDLERS. `getNewMessageId` NOT implemented — needs new send.ts function + handler entry. WAHA endpoint: `GET /api/{session}/status/new-message-id`, confirmed working. |
| ACT-05 | Presence actions exposed (setPresence, getPresence, subscribePresence) | `getPresence` already in UTILITY_ACTIONS. `subscribePresence` in ACTION_HANDLERS, not exposed. `setPresence` — handler is named `setPresenceStatus`, needs `setPresence` alias or rename. |
| ACT-06 | Profile actions exposed (getProfile, setProfileName, setProfileStatus, setProfilePicture, deleteProfilePicture) | `getProfile` already in UTILITY_ACTIONS. Others in ACTION_HANDLERS, not exposed. |
| ACT-07 | Media actions exposed (convertVoice, convertVideo) | NOT in ACTION_HANDLERS. Need new send.ts functions + handler entries. WAHA endpoints confirmed: `POST /api/{session}/media/convert/voice` and `POST /api/{session}/media/convert/video`. |
| ACT-08 | Session management and API key CRUD remain excluded | `createApiKey`, `getApiKeys`, `updateApiKey`, `deleteApiKey` are currently IN UTILITY_ACTIONS — must be removed. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | runtime via jiti | Source language | Project convention |
| channel.ts | — | UTILITY_ACTIONS list lives here | Single file edit |
| send.ts | — | WAHA API wrappers | New functions go here |

**No new dependencies needed.** This phase only edits existing files.

## Architecture Patterns

### Current Structure

```
channel.ts
├── ACTION_HANDLERS  (line 155-374)  — all implemented actions wired to send.ts functions
├── STANDARD_ACTIONS (line 393)      — gateway-recognized names (send, poll, react, etc.)
├── UTILITY_ACTIONS  (line 398-418)  — curated LLM-visible names
└── EXPOSED_ACTIONS  (line 422)      — STANDARD_ACTIONS + UTILITY_ACTIONS → returned by listActions()

send.ts
└── export async function *  — WAHA API wrappers, all stateless
```

### Pattern: Adding to UTILITY_ACTIONS

```typescript
// Source: channel.ts line 398
const UTILITY_ACTIONS = [
  "sendMulti",           // existing
  // Add new entries here:
  "addParticipants",     // group admin — already in ACTION_HANDLERS
  "createOrUpdateContact", // new — needs ACTION_HANDLERS entry too
];
```

### Pattern: Alias for name mismatch

When requirement name differs from handler name, add BOTH to ACTION_HANDLERS:

```typescript
// ACTION_HANDLERS:
demoteFromAdmin: (p, cfg, aid) => demoteWahaGroupAdmin({...}),
demoteToMember: (p, cfg, aid) => demoteWahaGroupAdmin({...}),  // alias

// UTILITY_ACTIONS:
"demoteFromAdmin", "demoteToMember",  // expose both
```

### Pattern: New send.ts function

```typescript
// Source: send.ts — follow existing pattern
export async function createOrUpdateWahaContact(params: {
  cfg: CoreConfig;
  contactId: string;
  name?: string;
  accountId?: string;
}): Promise<Record<string, unknown>> {
  const session = resolveSession(params.cfg, params.accountId);
  const res = await wahaFetch(params.cfg, `/${session}/contacts/${encodeURIComponent(params.contactId)}`, {
    method: "PUT",
    body: JSON.stringify({ name: params.name }),
  });
  return res as Record<string, unknown>;
}
```

### Anti-Patterns to Avoid

- **Exposing session management**: `createApiKey`, `getApiKeys`, `updateApiKey`, `deleteApiKey` must NOT be in UTILITY_ACTIONS. Currently they are — this is the removal task.
- **Changing STANDARD_ACTIONS**: Never modify — gateway hardcodes these. Only UTILITY_ACTIONS is safe to edit.
- **Using ALL_ACTIONS**: The comment on line 420 is emphatic: `// DO NOT change back to ALL_ACTIONS. That was the v1.8.x bug.`
- **Adding too many at once without comments**: Each group should have a comment noting the requirement ID (ACT-01 through ACT-07).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Contact update | Custom HTTP client | `wahaFetch` pattern from send.ts | Handles session resolution, auth headers |
| Media conversion | ffmpeg wrapper | WAHA's `/media/convert/voice|video` endpoint | Already in WAHA PLUS, confirmed live |
| Message ID generation | UUID/random | WAHA's `/status/new-message-id` endpoint | WAHA generates WhatsApp-compatible IDs |

## Common Pitfalls

### Pitfall 1: Name Mismatch — demoteToMember vs demoteFromAdmin
**What goes wrong:** ACT-01 requires `demoteToMember` but the handler is `demoteFromAdmin`. Adding only `demoteToMember` to UTILITY_ACTIONS without a matching ACTION_HANDLERS entry causes "WAHA action not supported" error.
**Why it happens:** Requirement was named from WAHA docs perspective, handler was named from WAHA API endpoint perspective.
**How to avoid:** Add both names to ACTION_HANDLERS (alias), expose both in UTILITY_ACTIONS, or pick one canonical name.
**Warning signs:** "WAHA action demoteToMember not supported" in gateway logs.

### Pitfall 2: Name Mismatch — getMessageById vs getChatMessage
**What goes wrong:** ACT-02 requires `getMessageById`. The handler is `getChatMessage`. Same problem.
**How to avoid:** Add `getMessageById` alias in ACTION_HANDLERS pointing to same implementation, add to UTILITY_ACTIONS.

### Pitfall 3: Name Mismatch — clearMessages vs clearChatMessages
**What goes wrong:** ACT-02 requires `clearMessages`. Handler is `clearChatMessages`.
**How to avoid:** Same alias approach.

### Pitfall 4: setPresence vs setPresenceStatus
**What goes wrong:** ACT-05 requires `setPresence`. Handler is `setPresenceStatus`.
**How to avoid:** Add `setPresence` alias. Both can coexist.

### Pitfall 5: API Key CRUD currently exposed
**What goes wrong:** `createApiKey`, `getApiKeys`, `updateApiKey`, `deleteApiKey` are currently in UTILITY_ACTIONS (line 417). ACT-08 requires they be REMOVED.
**Why it matters:** These are admin operations — giving LLM access risks accidental key rotation/deletion.
**How to avoid:** Remove from UTILITY_ACTIONS, keep in ACTION_HANDLERS (so they remain callable if explicitly supported via `supportsAction`, just not advertised).

### Pitfall 6: convertVoice/convertVideo need send.ts functions first
**What goes wrong:** Adding to UTILITY_ACTIONS before the ACTION_HANDLERS entry and send.ts function causes runtime "handler not found" error.
**How to avoid:** Implement in order: send.ts function → ACTION_HANDLERS entry → UTILITY_ACTIONS addition.

### Pitfall 7: Deploy order — src/ not root, clear jiti cache
**What goes wrong:** SCP to wrong directory or forgetting jiti cache means stale code serves.
**How to avoid:** Always SCP to `src/` subdir on BOTH hpg6 locations, then `rm -rf /tmp/jiti/`, then restart gateway.

## Complete Gap Analysis

### Already in ACTION_HANDLERS but NOT in UTILITY_ACTIONS (add to UTILITY_ACTIONS only)

**ACT-01 group admin:**
- `addParticipants`, `removeParticipants`, `promoteToAdmin`, `demoteFromAdmin`
- `setGroupSubject`, `setGroupDescription`, `setGroupPicture`, `deleteGroupPicture`, `getGroupPicture`
- `setInfoAdminOnly`, `getInfoAdminOnly`, `setMessagesAdminOnly`, `getMessagesAdminOnly`
- `getInviteCode`, `revokeInviteCode`, `deleteGroup`, `leaveGroup`

**ACT-02 chat management:**
- `archiveChat`, `unarchiveChat`, `clearChatMessages`, `unreadChat`, `getChatPicture`

**ACT-03 contacts:**
- `getContactAbout`, `getContactPicture`, `blockContact`, `unblockContact`

**ACT-04 status:**
- `sendVoiceStatus`, `sendVideoStatus`, `deleteStatus`

**ACT-05 presence:**
- `subscribePresence` (getPresence already exposed)

**ACT-06 profile:**
- `setProfileName`, `setProfileStatus`, `setProfilePicture`, `deleteProfilePicture` (getProfile already exposed)

### Need aliases in ACTION_HANDLERS + UTILITY_ACTIONS entries

| Requirement Name | Existing Handler Name | Resolution |
|-----------------|----------------------|------------|
| `demoteToMember` | `demoteFromAdmin` | Add `demoteToMember` alias in ACTION_HANDLERS |
| `getMessageById` | `getChatMessage` | Add `getMessageById` alias in ACTION_HANDLERS |
| `clearMessages` | `clearChatMessages` | Add `clearMessages` alias in ACTION_HANDLERS |
| `setPresence` | `setPresenceStatus` | Add `setPresence` alias in ACTION_HANDLERS |

### Need new send.ts function + ACTION_HANDLERS entry + UTILITY_ACTIONS entry

| Action | WAHA Endpoint | Status |
|--------|--------------|--------|
| `createOrUpdateContact` | `PUT /api/{session}/contacts/{contactId}` | Confirmed working (returns `{success:true}`) |
| `getNewMessageId` | `GET /api/{session}/status/new-message-id` | Confirmed working (returns `{id:"..."}`) |
| `convertVoice` | `POST /api/{session}/media/convert/voice` | Endpoint exists, needs body with file URL |
| `convertVideo` | `POST /api/{session}/media/convert/video` | Endpoint exists, needs body with file URL |

### Must REMOVE from UTILITY_ACTIONS (ACT-08)

- `createApiKey`, `getApiKeys`, `updateApiKey`, `deleteApiKey`

## Code Examples

### New send.ts function: createOrUpdateWahaContact
```typescript
// Source: verified against WAHA 2026.3.2 — PUT /api/{session}/contacts/{contactId}
export async function createOrUpdateWahaContact(params: {
  cfg: CoreConfig;
  contactId: string;
  name?: string;
  accountId?: string;
}): Promise<Record<string, unknown>> {
  const session = resolveSession(params.cfg, params.accountId);
  const res = await wahaFetch(params.cfg, `/${session}/contacts/${encodeURIComponent(params.contactId)}`, {
    method: "PUT",
    body: JSON.stringify({ name: params.name }),
  });
  return res as Record<string, unknown>;
}
```

### New send.ts function: getWahaNewMessageId
```typescript
// Source: verified against WAHA 2026.3.2 — GET /api/{session}/status/new-message-id
export async function getWahaNewMessageId(params: {
  cfg: CoreConfig;
  accountId?: string;
}): Promise<{ id: string }> {
  const session = resolveSession(params.cfg, params.accountId);
  const res = await wahaFetch(params.cfg, `/${session}/status/new-message-id`, { method: "GET" });
  return res as { id: string };
}
```

### New send.ts functions: convertWahaVoice / convertWahaVideo
```typescript
// Source: verified endpoints exist — WAHA 2026.3.2 POST /api/{session}/media/convert/voice|video
export async function convertWahaVoice(params: {
  cfg: CoreConfig;
  url: string;
  accountId?: string;
}): Promise<Record<string, unknown>> {
  const session = resolveSession(params.cfg, params.accountId);
  const res = await wahaFetch(params.cfg, `/${session}/media/convert/voice`, {
    method: "POST",
    body: JSON.stringify({ url: params.url }),
  });
  return res as Record<string, unknown>;
}

export async function convertWahaVideo(params: {
  cfg: CoreConfig;
  url: string;
  accountId?: string;
}): Promise<Record<string, unknown>> {
  const session = resolveSession(params.cfg, params.accountId);
  const res = await wahaFetch(params.cfg, `/${session}/media/convert/video`, {
    method: "POST",
    body: JSON.stringify({ url: params.url }),
  });
  return res as Record<string, unknown>;
}
```

### ACTION_HANDLERS alias pattern
```typescript
// Add alongside existing demoteFromAdmin entry:
demoteToMember: (p, cfg, aid) => demoteWahaGroupAdmin({ cfg, groupId: String(p.groupId), participants: p.participants as string[], accountId: aid }),
getMessageById: (p, cfg, aid) => getWahaChatMessage({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), accountId: aid }),
clearMessages: (p, cfg, aid) => clearWahaChatMessages({ cfg, chatId: String(p.chatId), accountId: aid }),
setPresence: (p, cfg, aid) => setWahaPresenceStatus({ cfg, status: p.status as "online" | "offline", accountId: aid }),
```

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| WAHA PLUS | convertVoice/convertVideo, createOrUpdateContact, getNewMessageId | ✓ | 2026.3.2 | — |
| hpg6 SSH | Deploy | ✓ | — | — |

## Validation Architecture

This phase has no automated test suite. Validation is manual via gateway log inspection and WAHA API calls.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | How to Verify |
|--------|----------|-----------|---------------|
| ACT-01 | Group admin actions reachable | Manual smoke | Ask agent to `getInviteCode` for test group — no "unknown action" error |
| ACT-02 | Chat management actions reachable | Manual smoke | Ask agent to `archiveChat` then `unarchiveChat` |
| ACT-03 | Contact actions reachable | Manual smoke | Ask agent to `getContactAbout` for Omer's JID |
| ACT-04 | Status actions reachable | Manual smoke | Ask agent to `getNewMessageId` |
| ACT-05 | Presence actions reachable | Manual smoke | Ask agent to `subscribePresence` for Omer |
| ACT-06 | Profile actions reachable | Manual smoke | Ask agent to `getProfile` |
| ACT-07 | Media convert actions reachable | Manual smoke | Ask agent to `convertVoice` with a test URL |
| ACT-08 | API key CRUD not callable | Manual smoke | Confirm `createApiKey` not in `listActions()` output |

### Quick check: verify listActions() after deploy
```bash
ssh omer@100.114.126.43 'curl -s "http://127.0.0.1:3004/api/3cf11776_logan/chats/120363421825201386@g.us/messages?limit=1" -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA="'
```
(Then send "list your available actions" to the agent via WhatsApp test message)

## Sources

### Primary (HIGH confidence)
- Direct WAHA API probe (2026-03-26) — `PUT /api/{session}/contacts/{contactId}` returns `{success:true}`
- Direct WAHA API probe (2026-03-26) — `GET /api/{session}/status/new-message-id` returns `{id:"..."}`
- Direct WAHA API probe (2026-03-26) — `POST /api/{session}/media/convert/voice|video` endpoints exist (500 without body = correct behavior)
- channel.ts line 154-418 read directly — ACTION_HANDLERS and UTILITY_ACTIONS audited

### Secondary (MEDIUM confidence)
- [WAHA Send Messages docs](https://waha.devlike.pro/docs/how-to/send-messages/) — confirmed convertVoice/convertVideo endpoint paths
- [WAHA Contacts docs](https://waha.devlike.pro/docs/how-to/contacts/) — confirmed PUT contact update, no contact creation
- [DeepWiki WAHA API Reference](https://deepwiki.com/devlikeapro/waha-docs/4-api-reference) — confirmed `/status/new-message-id` endpoint

## Metadata

**Confidence breakdown:**
- Gap analysis (what's missing from UTILITY_ACTIONS): HIGH — read directly from source
- Name mismatches: HIGH — confirmed by reading ACTION_HANDLERS
- New WAHA endpoints: HIGH — probed live WAHA 2026.3.2 instance
- convertVoice/convertVideo body schema: MEDIUM — endpoints exist, body format inferred from error message + docs

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable codebase, WAHA endpoint confirmed live)
