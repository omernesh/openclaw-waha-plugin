---
name: chatlytics-whatsapp
description: Use when the agent needs to send/receive WhatsApp messages, manage groups, contacts, channels, or perform any WhatsApp action via Chatlytics.
metadata:
  version: 4.0.0
---

# Chatlytics WhatsApp — Skill Index

## Authentication

API key: `Authorization: Bearer ctl_YOUR_API_KEY`
Server URL: `CHATLYTICS_URL` env var or `http://localhost:8050`

---

## MCP Config (Claude Desktop / Cursor / Continue)

```json
{
  "mcpServers": {
    "chatlytics": {
      "type": "http",
      "url": "http://localhost:8050/mcp",
      "headers": { "Authorization": "Bearer ctl_YOUR_API_KEY" }
    }
  }
}
```

Replace `ctl_YOUR_API_KEY` with your actual Chatlytics API key and `localhost:8050` with your server URL if self-hosting.

---

## MCP Tools Quick Reference

| Tool | Description |
|------|-------------|
| `send_message` | Send text to any chat (auto-resolves names to JIDs) |
| `send_media` | Send image, video, file, or voice message |
| `read_messages` | Read recent messages from a chat |
| `search` | Find contacts, groups, or channels by name |
| `get_directory` | List contacts, groups, and newsletters |
| `manage_group` | Create, delete, add/remove participants, rename group |
| `get_status` | Health, mimicry status, and session info |
| `update_settings` | Modify config (DM filter, group filter, mimicry) |
| `send_poll` | Create a poll in a chat |
| `send_reaction` | React to a message with an emoji |

---

## REST API Quick Start

```
POST /api/v1/send          { "chatId": "...", "text": "Hello!" }
POST /api/v1/send-media    { "chatId": "...", "mediaUrl": "https://...", "type": "image", "caption": "..." }
GET  /api/v1/messages      ?chatId=...&limit=20
GET  /api/v1/search        ?query=marketing
GET  /api/v1/directory     ?type=contact&search=john
GET  /api/v1/sessions      (list active WhatsApp sessions)
GET  /api/v1/status        (mimicry gate status + health)
POST /api/v1/send-poll     { "chatId": "...", "title": "Lunch?", "options": ["Pizza", "Sushi"] }
POST /api/v1/react         { "chatId": "...", "messageId": "true_...", "emoji": "👍" }
```

---

## Category Files

| Category | File | Key Capabilities |
|----------|------|-----------------|
| Messaging & Rich Messages | [skills/messaging.md](skills/messaging.md) | send, poll, react, reply, event, location, readMessages |
| Groups | [skills/groups.md](skills/groups.md) | createGroup, addParticipants, joinGroup, getInviteCode |
| Contacts | [skills/contacts.md](skills/contacts.md) | getContacts, blockContact, sendContactVcard, createOrUpdateContact |
| Channels (Newsletters) | [skills/channels.md](skills/channels.md) | followChannel, searchChannelsByText, createChannel |
| Chat Management | [skills/chats.md](skills/chats.md) | archiveChat, getChatMessages, muteChat, labels |
| Status / Stories | [skills/status.md](skills/status.md) | sendTextStatus, sendImageStatus, deleteStatus |
| Presence | [skills/presence.md](skills/presence.md) | setPresenceStatus, getPresence, subscribePresence |
| Profile | [skills/profile.md](skills/profile.md) | getProfile, setProfileName, setProfilePicture |
| Media + Utilities | [skills/media.md](skills/media.md) | sendImage, sendVideo, sendFile, convertVoice, LID lookups |
| Slash Commands | [skills/slash-commands.md](skills/slash-commands.md) | /join, /leave, /list, /shutup (human-only commands) |

---

## Quick Start Examples

### Send a text message

```bash
curl -X POST http://localhost:8050/api/v1/send \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chatId": "120363421825201386@g.us", "text": "Hello everyone!"}'
```

### Read recent messages

```bash
curl "http://localhost:8050/api/v1/messages?chatId=120363421825201386@g.us&limit=20" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

### Search for a contact or group

```bash
curl "http://localhost:8050/api/v1/search?query=dev+team" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

### Send an image

```bash
curl -X POST http://localhost:8050/api/v1/send-media \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chatId": "972544329000@c.us", "mediaUrl": "https://example.com/photo.jpg", "type": "image", "caption": "Check this out!"}'
```

---

## Parameter Formats

- **chatId**: `"972XXXXXXXXX@c.us"` (DM), `"120363...@g.us"` (group), `"...@newsletter"` (channel)
- **Phone numbers**: Country code + number, no `+`. Example: `"972544329000"`
- **messageId**: Full serialized: `true_chatId_shortMsgId` or `false_chatId_shortMsgId`
- **groupId**: Same format as group chatId. **channelId**: Newsletter JID (`...@newsletter`).

---

## Error Handling

| Error | Cause | Recovery |
|-------|-------|----------|
| `401 Unauthorized` | Missing or invalid API key | Set `Authorization: Bearer ctl_YOUR_API_KEY` header |
| `"Could not resolve '...' to a WhatsApp JID"` | Name not found | Use `/api/v1/search` first, retry with exact JID |
| `"Ambiguous target '...'"` | Multiple name matches | Use exact JID from search results |
| `"WAHA API rate limited (429)"` | Too many requests | Auto-retried 3x with backoff (1s/2s/4s). If still failing, wait 5-10s |
| `"timed out after Xms"` | WAHA unresponsive | Default timeout 30s. Mutation ops may have succeeded despite timeout |
| `"Session health: unhealthy"` | WhatsApp disconnected | All outbound calls fast-fail until session reconnects |

---

## Rate Limiting

Token-bucket: 20 tokens capacity, 15 tokens/sec refill. Each API call = 1 token. Overflow is queued. HTTP 429 triggers auto-retry with exponential backoff.

---

## Multi-Session

| Role | Sends? | Receives? | Purpose |
|------|--------|-----------|---------|
| `bot` (full-access) | Yes | All chats | AI agent's active session |
| `human` (listener) | No | Monitored chats | Monitor-only human session |
| `human` (full-access) | Yes | Yes | Human session with send access |

---

## Access Control

**DM Policy** (`dmPolicy`): `pairing` (default — challenges unknown senders) | `allowlist` | `open` | `disabled`

**Group Policy** (`groupPolicy`): `open` | `allowlist` | `disabled`

**God Mode:** `godModeSuperUsers` JIDs bypass all filters.

**Can Initiate:** `canInitiateGlobal` controls whether the bot can start new conversations.
