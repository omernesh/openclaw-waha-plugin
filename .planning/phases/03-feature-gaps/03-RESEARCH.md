# Phase 3: Feature Gaps - Research

**Researched:** 2026-03-11
**Domain:** WAHA API feature integration (link preview, mute/unmute, mentions, multi-send)
**Confidence:** HIGH

## Summary

Phase 3 fills five feature gaps in the WAHA OpenClaw plugin: auto link preview on text sends, chat mute/unmute actions, @mention extraction from inbound messages, multi-recipient send, and verification of two already-completed features (FEAT-02, FEAT-07). The implementation is straightforward — all features follow established patterns already in the codebase (utility action registration, callWahaApi wrappers, inbound payload extraction).

The highest-risk item is mentions detection (FEAT-05) because WAHA does not surface `mentionedJid` in its documented payload — it lives in the engine-specific `_data` field whose structure varies by engine (NOWEB vs WEBJS). All other features have clear WAHA API endpoints and established code patterns to follow.

**Primary recommendation:** Implement in two waves — Wave 1: auto link preview + mute/unmute (simple API wrappers), Wave 2: mentions extraction + multi-recipient send (more complex logic).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **FEAT-02** and **FEAT-07** are already satisfied — verify and close only, no new code
- **FEAT-01**: Auto-detect URLs in `sendWahaText` via regex, add `linkPreview: true` to WAHA payload. Config option `autoLinkPreview` (default: true)
- **FEAT-03/04**: `muteWahaChat()` / `unmuteWahaChat()` in send.ts, registered as utility actions `muteChat` / `unmuteChat`
- **FEAT-05**: Parse `mentionedJids` from raw WAHA webhook `_data` field, add to `WahaInboundMessage` type, include in ctxPayload
- **FEAT-06**: New `sendMulti` utility action — sequential loop, auto-resolve names, cap at 10, text only, no fail-fast, per-recipient results

### Claude's Discretion
- URL detection regex pattern (simple vs comprehensive)
- Exact format of mentions in agent context (comma-separated vs structured)
- Whether to add sendMulti to SKILL.md examples or keep discoverable via listActions
- Mute/unmute confirmation message format
- Order of implementation (which features to group into which plans)

### Deferred Ideas (OUT OF SCOPE)
- Media multi-send (images/videos to multiple recipients)
- Mention notifications (alert when Sammie is @mentioned)
- Link preview caching
- Mute with scheduled unmute (mute for X hours)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FEAT-01 | Send URLs with rich link preview using `linkPreview: true` | WAHA `/api/sendText` accepts `linkPreview` boolean; modify `sendWahaText` to detect URLs |
| FEAT-02 | Custom link preview via `/api/send/link-custom-preview` | Already implemented as `sendWahaLinkPreview()` at send.ts:591 — verify only |
| FEAT-03 | Mute chat via WAHA API | WAHA endpoint `PUT /api/{session}/chats/{chatId}/mute` — follow channel mute pattern |
| FEAT-04 | Unmute chat via WAHA API | WAHA endpoint `PUT /api/{session}/chats/{chatId}/unmute` — follow channel unmute pattern |
| FEAT-05 | Extract @mentioned JIDs from inbound messages | WAHA `_data` field contains engine-specific mention data; needs runtime inspection |
| FEAT-06 | Multi-recipient send with per-recipient results | New `sendMulti` utility action using sequential `sendWahaText` calls with name resolution |
| FEAT-07 | Context-rich error messages with suggested fixes | Already implemented as `formatActionError()` in error-formatter.ts — verify only |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (no new deps) | - | All features use existing WAHA API calls | Everything builds on callWahaApi and existing patterns |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lru-cache | (already installed) | Existing dependency | Already used for resolve target cache |

No new npm dependencies needed for this phase. All features are WAHA API wrappers and internal logic.

## Architecture Patterns

### Pattern 1: Auto Link Preview in sendWahaText (FEAT-01)

**What:** Detect URLs in text and add `linkPreview: true` to the WAHA API body.
**When to use:** Every call to `sendWahaText`.

```typescript
// URL detection regex — simple, reliable
const URL_REGEX = /https?:\/\/\S+/i;

export async function sendWahaText(params: {
  cfg: CoreConfig; to: string; text: string;
  replyToId?: string; accountId?: string;
}) {
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertAllowedSession(account.session);
  const chatId = normalizeWahaMessagingTarget(params.to);
  if (!chatId) throw new Error("WAHA sendText requires chatId");

  // Auto link preview: detect URLs and add linkPreview flag
  const wahaConfig = params.cfg.channels?.waha;
  const autoPreview = wahaConfig?.autoLinkPreview !== false; // default true
  const hasUrl = URL_REGEX.test(params.text);

  return callWahaApi({
    baseUrl: account.baseUrl, apiKey: account.apiKey,
    path: "/api/sendText",
    body: {
      chatId, text: params.text, session: account.session,
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
      ...(autoPreview && hasUrl ? { linkPreview: true } : {}),
    },
  });
}
```

**Discretion recommendation for URL regex:** Use `https?:\/\/\S+/i` — simple, catches all practical URLs. No need for RFC-compliant URL parsing; WhatsApp itself resolves preview metadata server-side.

### Pattern 2: Chat Mute/Unmute (FEAT-03, FEAT-04)

**What:** WAHA API wrappers following the exact same pattern as `muteWahaChannel` / `unmuteWahaChannel`.
**Implementation:** The channel mute functions at send.ts:1255-1265 are the template.

```typescript
// Follow exact pattern from muteWahaChannel (send.ts:1255)
export async function muteWahaChat(params: {
  cfg: CoreConfig; chatId: string; duration?: number; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/mute`,
    body: { ...(params.duration ? { duration: params.duration } : {}) },
  });
}

export async function unmuteWahaChat(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/unmute`,
    body: {},
  });
}
```

Register as utility actions in channel.ts:
- Add `"muteChat"` and `"unmuteChat"` to `UTILITY_ACTIONS` array
- Add handlers to `ACTION_HANDLERS` map following existing pattern

### Pattern 3: Mentions Extraction (FEAT-05)

**What:** Extract mentioned JIDs from WAHA webhook `_data` field.
**Risk:** MEDIUM — `_data` structure is engine-specific and undocumented.

The WAHA webhook payload includes a `_data` field containing raw engine data. For NOWEB engine (which this project uses), mentioned JIDs are expected at:

```
payload._data.message.extendedTextMessage.contextInfo.mentionedJid
```

This is an array of strings like `["972544329000@s.whatsapp.net"]`.

**Implementation approach:**
1. Add `mentionedJids?: string[]` to `WahaInboundMessage` type in types.ts
2. In inbound.ts `handleWahaInbound`, extract from `_data` with safe optional chaining
3. Normalize JIDs from `@s.whatsapp.net` to `@c.us` format for consistency
4. Add to ctxPayload as structured field: `mentions: ["972544329000@c.us"]`
5. Also format human-readable: `"Mentioned: +972544329000"` appended to context

```typescript
// Safe extraction with optional chaining — _data structure varies by engine
function extractMentionedJids(rawPayload: Record<string, unknown>): string[] {
  const data = rawPayload._data as Record<string, unknown> | undefined;
  if (!data) return [];

  // NOWEB engine path
  const extText = (data.message as any)?.extendedTextMessage;
  const jids: string[] = extText?.contextInfo?.mentionedJid ?? [];

  // Normalize @s.whatsapp.net to @c.us
  return jids.map(jid => jid.replace(/@s\.whatsapp\.net$/, "@c.us"));
}
```

**CRITICAL:** This path MUST be validated at runtime against actual WAHA NOWEB webhook payloads. Log the raw `_data` structure during testing to confirm the exact path. The `_data` field is explicitly undocumented ("internal engine data, can be different for each engine").

**Discretion recommendation for format:** Use structured array in ctxPayload (`mentionedJids: ["jid1", "jid2"]`) plus human-readable line in the text context (`"Mentioned: @Name1, @Name2"` using directory lookups if available, falling back to phone numbers).

### Pattern 4: Multi-Recipient Send (FEAT-06)

**What:** New `sendMulti` utility action that sends the same text to multiple recipients sequentially.

```typescript
// In channel.ts handleAction, new "sendMulti" handler
async function handleSendMulti(cfg: CoreConfig, params: Record<string, unknown>) {
  const recipients = toArr(params.recipients); // string[]
  const text = String(params.text || "");
  const replyToId = params.replyToId ? String(params.replyToId) : undefined;

  if (!text) throw new Error("sendMulti requires 'text' parameter");
  if (recipients.length === 0) throw new Error("sendMulti requires 'recipients' array");
  if (recipients.length > 10) throw new Error("sendMulti limited to 10 recipients per call");

  const results: Array<{ recipient: string; status: "sent" | "failed"; error?: string }> = [];

  for (const recipient of recipients) {
    try {
      // Resolve name to JID using existing autoResolveTarget
      const resolved = await autoResolveTarget(cfg, recipient);
      await sendWahaText({ cfg, to: resolved, text, replyToId });
      results.push({ recipient, status: "sent" });
    } catch (err: any) {
      results.push({ recipient, status: "failed", error: err.message });
    }
  }

  return { results, sent: results.filter(r => r.status === "sent").length, failed: results.filter(r => r.status === "failed").length };
}
```

**Key design decisions:**
- Sequential (not parallel) to respect rate limiter
- No fail-fast — attempts all recipients
- Cap at 10 to prevent abuse
- Text only (media multi-send deferred)
- Returns structured per-recipient results

### Anti-Patterns to Avoid
- **Do NOT modify existing `send` action** for multi-recipient — keep it single-target, add `sendMulti` as separate action
- **Do NOT parallelize sends** — will overwhelm the token-bucket rate limiter from Phase 1
- **Do NOT deeply nest into `_data`** without optional chaining — engine data can be undefined at any level
- **Do NOT route sendMulti through gateway target resolution** — it's a utility action (mode "none"), recipients are in parameters

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL detection | Complex URL parser | Simple `https?://\S+` regex | WhatsApp handles preview resolution server-side; we just need to detect presence |
| JID normalization | Custom JID parser | Existing `normalizeWahaMessagingTarget` | Already handles all JID formats |
| Name resolution | Custom resolver for sendMulti | Existing `autoResolveTarget` | Already has fuzzy matching, caching, directory lookup |
| Rate limiting for sendMulti | Custom delay logic | Existing token-bucket in http-client.ts | All calls go through `callWahaApi` which already rate-limits |

## Common Pitfalls

### Pitfall 1: _data Field Engine Variance
**What goes wrong:** Code assumes NOWEB `_data` structure, breaks on WEBJS/GOWS engine.
**Why it happens:** `_data` is explicitly undocumented and engine-specific.
**How to avoid:** Use optional chaining at every level, return empty array on any miss, log the actual structure during first test run.
**Warning signs:** Empty `mentionedJids` array when messages clearly have @mentions.

### Pitfall 2: linkPreview on Non-URL Text
**What goes wrong:** Setting `linkPreview: true` on messages without URLs could cause WAHA errors or silent failures.
**Why it happens:** Unconditionally adding the flag.
**How to avoid:** Only add `linkPreview: true` when URL regex matches.

### Pitfall 3: sendMulti Name Resolution Failures
**What goes wrong:** One name fails to resolve, error propagation stops remaining sends.
**Why it happens:** autoResolveTarget throws on no match.
**How to avoid:** Wrap each recipient's resolve+send in try/catch, log failure, continue to next.

### Pitfall 4: Chat Mute Endpoint Path
**What goes wrong:** Using wrong HTTP method or path for WAHA chat mute.
**Why it happens:** Assuming same pattern as channel mute without verifying.
**How to avoid:** Test with a curl call first: `curl -X PUT http://127.0.0.1:3004/api/{session}/chats/{chatId}/mute`. If PUT fails, try POST.

### Pitfall 5: Config Schema Not Updated
**What goes wrong:** `autoLinkPreview` config option ignored because config-schema.ts not updated.
**Why it happens:** Adding runtime code but forgetting the schema definition.
**How to avoid:** Add `autoLinkPreview?: boolean` to both `WahaAccountConfig` in types.ts and the schema in config-schema.ts.

## Code Examples

### Utility Action Registration Pattern (verified from codebase)
```typescript
// In channel.ts — UTILITY_ACTIONS array (line ~263)
const UTILITY_ACTIONS: string[] = [
  // ... existing actions ...
  "muteChat",        // FEAT-03
  "unmuteChat",      // FEAT-04
  "sendMulti",       // FEAT-06
];

// In channel.ts — ACTION_HANDLERS map (line ~106)
const ACTION_HANDLERS: Record<string, (cfg: CoreConfig, p: Record<string, unknown>) => Promise<unknown>> = {
  // ... existing handlers ...
  muteChat: (cfg, p) => muteWahaChat({ cfg, chatId: String(p.chatId), duration: p.duration ? Number(p.duration) : undefined }),
  unmuteChat: (cfg, p) => unmuteWahaChat({ cfg, chatId: String(p.chatId) }),
  sendMulti: handleSendMulti,
};
```

### Config Schema Addition
```typescript
// In types.ts — WahaAccountConfig
autoLinkPreview?: boolean;  // default: true — auto-add linkPreview on URLs
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LLM must explicitly use sendLinkPreview action | Auto-detect URLs in sendWahaText | Phase 3 | Seamless rich previews without LLM awareness |
| Single-target send only | sendMulti utility action | Phase 3 | Announce to multiple chats in one action call |
| No mention awareness | mentionedJids in inbound context | Phase 3 | Sammie knows who was tagged in group messages |

## Open Questions

1. **WAHA Chat Mute Endpoint HTTP Method**
   - What we know: Channel mute uses POST with `callWahaApi` (which defaults to POST). Chat mute likely follows same pattern.
   - What's unclear: Whether the endpoint is `PUT` or `POST`, and whether a `duration` parameter is accepted.
   - Recommendation: Try POST first (matches callWahaApi default). Test with curl during implementation. If duration param exists, expose it; otherwise omit.

2. **Exact _data Path for NOWEB Mentions**
   - What we know: Standard WhatsApp protobuf puts mentions at `message.extendedTextMessage.contextInfo.mentionedJid`
   - What's unclear: Whether WAHA NOWEB engine preserves this exact path in `_data`
   - Recommendation: Log `JSON.stringify(rawPayload._data)` during first test with a message containing @mentions. Adjust extraction path based on actual output.

3. **mentionedJid Format**
   - What we know: WhatsApp uses `@s.whatsapp.net` internally
   - What's unclear: Whether WAHA NOWEB normalizes to `@c.us` or passes through raw `@s.whatsapp.net`
   - Recommendation: Handle both — normalize to `@c.us` for consistency with rest of codebase.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual integration testing via WAHA API + WhatsApp |
| Config file | none (no automated test framework set up yet) |
| Quick run command | `ssh omer@100.114.126.43 'journalctl --user -u openclaw-gateway --since "2 minutes ago" --no-pager'` |
| Full suite command | Manual WhatsApp message tests per feature |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FEAT-01 | URL in sendWahaText gets linkPreview: true | manual | Send URL via Sammie, verify preview card appears | N/A |
| FEAT-02 | sendWahaLinkPreview works | manual-verify | Already working — verify in code | N/A |
| FEAT-03 | muteChat action mutes a chat | manual | Call muteChat action via Sammie, verify in WhatsApp | N/A |
| FEAT-04 | unmuteChat action unmutes a chat | manual | Call unmuteChat action via Sammie, verify in WhatsApp | N/A |
| FEAT-05 | @mentions extracted from inbound messages | manual | Send @mention in group, check gateway logs for mentionedJids | N/A |
| FEAT-06 | sendMulti sends to multiple recipients | manual | Ask Sammie to send to 2+ chats, verify all receive | N/A |
| FEAT-07 | formatActionError provides context-rich errors | manual-verify | Already working — verify in code | N/A |

### Sampling Rate
- **Per task commit:** Check gateway logs for errors after deploy
- **Per wave merge:** Manual WhatsApp test of each new feature
- **Phase gate:** All 7 FEAT requirements verified working via WhatsApp

### Wave 0 Gaps
None -- no automated test infrastructure exists (DOC-02/DOC-03 are Phase 5). All testing is manual integration via WhatsApp + gateway logs.

## Sources

### Primary (HIGH confidence)
- Project codebase: send.ts, channel.ts, types.ts, inbound.ts — verified current patterns
- CONTEXT.md — locked user decisions for all features

### Secondary (MEDIUM confidence)
- [WAHA Receive Messages docs](https://waha.devlike.pro/docs/how-to/receive-messages/) — webhook payload structure, `_data` field description
- [WAHA GitHub](https://github.com/devlikeapro/waha) — API endpoint patterns
- [WAHA GOWS Mentions Issue #1372](https://github.com/devlikeapro/waha/issues/1372) — confirms mentions are in contextInfo.mentionedJid

### Tertiary (LOW confidence)
- WAHA chat mute/unmute endpoint exact method (POST vs PUT) — needs runtime verification
- `_data` field exact structure for NOWEB engine mentions — needs runtime logging

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all existing patterns
- Architecture: HIGH — follows established utility action and API wrapper patterns
- Pitfalls: MEDIUM — _data field structure for mentions is undocumented
- Mute/unmute API: MEDIUM — endpoint exists but exact method/params need verification

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable — WAHA API changes infrequently)
