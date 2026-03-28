# Chats — Chatlytics WhatsApp

> Part of the Chatlytics WhatsApp skill. See [SKILL.md](../SKILL.md) for overview and other categories.

**MCP tool:** `read_messages` (for fetching messages), `update_settings` (for chat state)

## Actions

### Chat Listing & Overview

| Action | REST Endpoint | Parameters | Notes |
|--------|--------------|-----------|-------|
| List all chats | `GET /api/v1/directory` | (none) | List all chats |
| Paginated chat list | `GET /api/v1/directory` | page?, limit? | Chat list with summary info |

### Message Retrieval

| Action | REST Endpoint | Parameters | Notes |
|--------|--------------|-----------|-------|
| Read recent messages | `GET /api/v1/messages` | chatId, limit? (1-50, default 10) | Lean format for LLM context |
| Get full chat history | `GET /api/v1/messages` | chatId, limit?, offset?, downloadMedia? | Full messages with media info |
| Get single message | `GET /api/v1/messages/{messageId}` | chatId, messageId | Get a single message by ID |

### Chat State

| Action | Parameters | Notes |
|--------|-----------|-------|
| Archive chat | chatId | Archive a chat |
| Unarchive chat | chatId | Unarchive a chat |
| Mark as read | chatId | Sends read receipts |
| Mark as unread | chatId | Mark chat as unread |
| Mute chat | chatId, duration? (seconds) | Mute chat notifications for N seconds |
| Unmute chat | chatId | Unmute chat notifications |
| Get chat picture | chatId | Get the chat's profile picture URL |

### Chat Deletion & Clearing

| Action | Parameters | Notes |
|--------|-----------|-------|
| Delete chat | chatId | Delete the entire chat (cannot be undone) |
| Clear messages | chatId | Clear all messages in a chat (keep the chat) |

---

## Labels

> **WhatsApp Business only.** Labels are a WhatsApp Business feature. On personal WhatsApp accounts, label actions will return empty results or no-ops. Do not expect labels to work on personal numbers.

| Action | Parameters | Notes |
|--------|-----------|-------|
| Get labels | (none) | List all labels |
| Create label | name, color? | Create a new label |
| Update label | labelId, name?, color? | Update an existing label |
| Delete label | labelId | Delete a label |
| Get chat labels | chatId | Get all labels assigned to a chat |
| Set chat labels | chatId, labels[{id}] | Set (replace) labels on a chat |
| Get chats by label | labelId | List all chats with a specific label |

## Examples

### Read recent messages (REST)

```bash
curl "http://localhost:8050/api/v1/messages?chatId=120363421825201386@g.us&limit=20" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

Returns array of `{ id, from, text, timestamp, type }`. Does NOT send read receipts.

### Get full chat history

```bash
curl "http://localhost:8050/api/v1/messages?chatId=120363421825201386@g.us&limit=50&offset=0" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

### Mute a chat for 1 hour

```json
{ "action": "muteChat", "chatId": "120363421825201386@g.us", "duration": 3600 }
```

`duration` is in seconds. Omit for indefinite mute.

### Create a label (WhatsApp Business only)

```json
{ "action": "createLabel", "name": "VIP", "color": "red" }
```

### Assign a label to a chat

```json
{
  "action": "setChatLabels",
  "chatId": "972544329000@c.us",
  "labels": [{ "id": "label-id-here" }]
}
```

### Get all chats with a specific label

```json
{ "action": "getChatsByLabel", "labelId": "label-id-here" }
```

## Gotchas

- **Labels are WhatsApp Business only** — `getLabels`, `createLabel`, `setChatLabels`, and related actions require a WhatsApp Business account. On personal WhatsApp, these return empty arrays or silently do nothing.

- **`muteChat` duration is in seconds** — `3600` = 1 hour, `86400` = 1 day. Omit `duration` for indefinite mute.

- **`deleteChat` is permanent** — removes the entire chat from your view. The other participant's messages are not deleted. Use clear messages if you only want to clear the history.

- **`GET /api/v1/messages` does NOT send read receipts** — it only fetches content. Use mark-as-read separately if you also want to send read receipts.

- **Read messages vs mark-as-read**:
  - `GET /api/v1/messages` → fetches message content for context
  - Mark as read → marks chat as read (read receipts)
