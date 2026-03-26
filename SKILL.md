---
name: whatsapp-actions
description: Use when the user asks to send a WhatsApp message, create a poll, share a location, manage groups, send a contact card, forward a message, react to a message, pin a message, edit or delete a message, create an event, manage labels, post a status/story, manage channels, join a group, follow a channel, change profile, block/unblock contacts, or perform any WhatsApp action through WAHA.
metadata:
  version: 6.0.0
---

> **IMPORTANT — Standard Action Names**: For targeted actions, use: `poll`, `send`, `edit`, `unsend`, `pin`/`unpin`, `read`, `react`. Do NOT use custom names like sendPoll, editMessage — they will be rejected.

# WhatsApp Actions — Skill Index

The plugin auto-resolves human-readable names (group names, contact names) to WhatsApp JIDs automatically. Standard actions (`send`, `poll`, `react`, `edit`, `unsend`, `pin`, `unpin`, `read`, `delete`, `reply`) support target resolution. Utility actions require an explicit `chatId` or `groupId` parameter. Each category file below has the full action table, examples, and gotchas.

## Category Files

| Category | File | Key Actions |
|----------|------|-------------|
| Messaging & Rich Messages | [skills/messaging.md](skills/messaging.md) | send, poll, react, reply, sendEvent, sendLocation, readMessages |
| Groups | [skills/groups.md](skills/groups.md) | createGroup, addParticipants, joinGroup, getInviteCode |
| Contacts | [skills/contacts.md](skills/contacts.md) | getContacts, blockContact, sendContactVcard, createOrUpdateContact |
| Channels (Newsletters) | [skills/channels.md](skills/channels.md) | followChannel, searchChannelsByText, createChannel |
| Chat Management | [skills/chats.md](skills/chats.md) | archiveChat, getChatMessages, muteChat, labels |
| Status / Stories | [skills/status.md](skills/status.md) | sendTextStatus, sendImageStatus, deleteStatus |
| Presence | [skills/presence.md](skills/presence.md) | setPresenceStatus, setPresence, getPresence, subscribePresence |
| Profile | [skills/profile.md](skills/profile.md) | getProfile, setProfileName, setProfilePicture |
| Media + Utilities | [skills/media.md](skills/media.md) | sendImage, sendVideo, sendFile, convertVoice, LID lookups |
| Slash Commands | [skills/slash-commands.md](skills/slash-commands.md) | /join, /leave, /list, /shutup |

---

## Quick Start

```
// Send a text message (auto-resolves name to JID)
Action: send  |  Target: "test group"  |  Parameters: { "text": "hello world" }

// Send to multiple recipients
Action: sendMulti
Parameters: { "recipients": ["972544329000@c.us", "120363421825201386@g.us"], "text": "hello" }

// Send an image
Action: sendImage
Parameters: { "chatId": "120363421825201386@g.us", "file": "https://example.com/photo.jpg", "caption": "Look!" }

// Create a poll
Action: poll  |  Target: "test group"
Parameters: { "name": "Favorite color?", "options": ["Red", "Blue", "Green"] }

// Read recent messages for context
Action: readMessages
Parameters: { "chatId": "120363421825201386@g.us", "limit": 20 }

// Search for a group by name
Action: search
Parameters: { "query": "dev team", "scope": "group" }
```

---

## Auto-Resolution (Preferred)

Use human-readable names as targets in send/poll/edit/unsend/pin/unpin/read. The plugin fuzzy-matches names to JIDs automatically.

```
Action: send  |  Target: "test group"   |  Parameters: { "text": "hello" }
Action: send  |  Target: "zeev nesher"  |  Parameters: { "text": "Hey Zeev!" }
```

If the name is ambiguous you'll get an error listing possible matches — ask the user which one they meant.

**`search` action** — find groups/contacts/channels by name. No target — parameters only:
```
Action: search
Parameters: { "query": "test group", "scope": "group" }
```
`scope`: `"group"` | `"contact"` | `"channel"` | `"auto"` (all). Empty `query` = list all.

---

## Parameter Formats

- **chatId**: `"972XXXXXXXXX@c.us"` (DM), `"120363...@g.us"` (group), `"...@newsletter"` (channel)
- **Phone numbers**: Country code + number, no `+`. Example: `"972544329000"`
- **messageId**: Full serialized: `true_chatId_shortMsgId` or `false_chatId_shortMsgId`
- **groupId**: Same format as group chatId. **channelId**: Newsletter JID (`...@newsletter`).

---

## Error Handling and Recovery

| Error Pattern | Cause | Recovery |
|---------------|-------|----------|
| `"Session '...' has sub-role 'listener' and cannot send"` | Sent from listener session | Use the bot session — listeners are receive-only |
| `"Could not resolve '...' to a WhatsApp JID"` | Name not found | Run `search` first, retry with exact JID |
| `"Ambiguous target '...'. Possible matches: ..."` | Multiple matches | Ask user which one, or use exact JID |
| `"WAHA API rate limited (429)"` | Too many requests | Plugin auto-retries 3x with backoff (1s/2s/4s). If still failing, wait 5-10s |
| `"timed out after Xms"` | WAHA unresponsive | Timeout configurable via `timeoutMs` (default 30s). Mutation ops may have succeeded despite timeout |
| `"aborted — session ... is unhealthy (circuit breaker)"` | Session disconnected | Reconnect session in WAHA dashboard first |
| `"Session health: unhealthy"` | WhatsApp disconnected | All outbound calls fast-fail until session reconnects. Check admin panel Status tab |

**General:** Failed sends → verify JID with `search`. Multiple failures → check Status tab.

---

## Rate Limiting

Token-bucket: 20 tokens capacity, 15 tokens/sec refill. Each API call = 1 token. Overflow is queued. HTTP 429 triggers auto-retry with exponential backoff (1s/2s/4s, 3 attempts).

Config: `rateLimitCapacity` (default 20), `rateLimitRefillRate` (default 15) in `channels.waha`.

Rate limiting is automatic — no delays needed. For bulk sends, use `sendMulti`. Each account has its own independent token bucket.

---

## Multi-Session

| Role | Sub-Role | Sends? | Receives? | Purpose |
|------|----------|--------|-----------|---------|
| `bot` | `full-access` | Yes | All chats | AI agent's active session |
| `human` | `listener` | No | Monitored chats | Monitor-only human session |
| `human` | `full-access` | Yes | Yes | Human session with send access |

Only `full-access` sessions can send. `listener` sessions fail with an error on send attempts.

**Trigger word:** When `triggerWord` is set (e.g., `"!bot"`), the bot only activates in groups when messages start with that word. `triggerResponseMode`: `"dm"` (default) or `"group"`.

**Cross-session routing** is automatic — the bot uses its own session for groups it belongs to.

---

## Access Control

**DM Policy** (`dmPolicy`):

| Mode | Behavior |
|------|----------|
| `pairing` | Default. Unknown senders receive a pairing code challenge. |
| `allowlist` | Only contacts in `allowFrom` can message. Others silently blocked. |
| `open` | Anyone can message. Requires `allowFrom: ["*"]`. |
| `disabled` | All DMs blocked. |

**Group Policy** (`groupPolicy`): `open` (anyone in allowed groups) | `allowlist` (sender must be in `groupAllowFrom`) | `disabled`.

**God Mode:** `godModeSuperUsers` JIDs bypass all filters. Always processed regardless of policy.

**Can Initiate:** `canInitiateGlobal` controls whether the bot can start new conversations. Per-contact overrides available in the directory.
