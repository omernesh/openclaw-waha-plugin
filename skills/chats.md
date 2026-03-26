# Chats — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.

## Actions

### Chat Listing & Overview

| Action | Parameters | Notes |
|--------|-----------|-------|
| `getChats` | (none) | List all chats |
| `getChatsOverview` | page?, limit? | Paginated chat list with summary info |

### Message Retrieval

| Action | Parameters | Notes |
|--------|-----------|-------|
| `getChatMessages` | chatId, limit?, offset?, downloadMedia? | Get messages from a chat (chronological) |
| `getChatMessage` | chatId, messageId | Get a single message by ID |
| `getMessageById` | chatId, messageId | Alias for `getChatMessage` |
| `readMessages` | chatId, limit? (1-50, default 10) | Fetch recent messages in lean format for LLM context |

### Chat State

| Action | Parameters | Notes |
|--------|-----------|-------|
| `archiveChat` | chatId | Archive a chat |
| `unarchiveChat` | chatId | Unarchive a chat |
| `read` | chatId | Mark chat as read (sends read receipts) |
| `unreadChat` | chatId | Mark chat as unread |
| `readChatMessages` | chatId | Alias for `read` — marks chat as read |
| `muteChat` | chatId, duration? (seconds) | Mute chat notifications for N seconds |
| `unmuteChat` | chatId | Unmute chat notifications |
| `getChatPicture` | chatId | Get the chat's profile picture URL |

### Chat Deletion & Clearing

| Action | Parameters | Notes |
|--------|-----------|-------|
| `deleteChat` | chatId | Delete the entire chat (cannot be undone) |
| `clearChatMessages` | chatId | Clear all messages in a chat (keep the chat) |
| `clearMessages` | chatId | Alias for `clearChatMessages` |

---

## Labels

> **WhatsApp Business only.** Labels are a WhatsApp Business feature. On personal WhatsApp accounts, label actions will return empty results or no-ops. Do not expect labels to work on personal numbers.

| Action | Parameters | Notes |
|--------|-----------|-------|
| `getLabels` | (none) | List all labels |
| `createLabel` | name, color? | Create a new label |
| `updateLabel` | labelId, name?, color? | Update an existing label |
| `deleteLabel` | labelId | Delete a label |
| `getChatLabels` | chatId | Get all labels assigned to a chat |
| `setChatLabels` | chatId, labels[{id}] | Set (replace) labels on a chat |
| `getChatsByLabel` | labelId | List all chats with a specific label |

## Examples

### Get all chats

```
Action: getChats
Parameters: {}
```

### Read recent messages (for context)

```
Action: readMessages
Parameters: { "chatId": "120363421825201386@g.us", "limit": 20 }
```

Returns array of `{ id, from, text, timestamp, type }`. Does NOT send read receipts.

### Get chat history (full messages with media info)

```
Action: getChatMessages
Parameters: {
  "chatId": "120363421825201386@g.us",
  "limit": 50,
  "offset": 0,
  "downloadMedia": false
}
```

### Archive a chat

```
Action: archiveChat
Parameters: { "chatId": "120363421825201386@g.us" }
```

### Mute a chat for 1 hour

```
Action: muteChat
Parameters: { "chatId": "120363421825201386@g.us", "duration": 3600 }
```

`duration` is in seconds. Omit for indefinite mute.

### Mark chat as unread

```
Action: unreadChat
Parameters: { "chatId": "120363421825201386@g.us" }
```

### Clear all messages (keep chat)

```
Action: clearChatMessages
Parameters: { "chatId": "120363421825201386@g.us" }
```

### Create a label (WhatsApp Business only)

```
Action: createLabel
Parameters: { "name": "VIP", "color": "red" }
```

### Assign a label to a chat

```
Action: setChatLabels
Parameters: {
  "chatId": "972544329000@c.us",
  "labels": [{ "id": "label-id-here" }]
}
```

### Get all chats with a specific label

```
Action: getChatsByLabel
Parameters: { "labelId": "label-id-here" }
```

## Gotchas

- **Labels are WhatsApp Business only** — `getLabels`, `createLabel`, `setChatLabels`, and related actions require a WhatsApp Business account. On personal WhatsApp, these return empty arrays or silently do nothing.

- **`clearMessages` and `clearChatMessages` are aliases** — both clear the messages in a chat. Use either name.

- **`readChatMessages` and `read` are aliases** — both mark the chat as read (send read receipts). Not to be confused with `readMessages` (which fetches message content).

- **`readMessages` vs `read` vs `readChatMessages`**:
  - `readMessages` → fetches message content for LLM context
  - `read` / `readChatMessages` → marks chat as read (read receipts)

- **`muteChat` duration is in seconds** — `3600` = 1 hour, `86400` = 1 day. Omit `duration` for indefinite mute.

- **`getChatsOverview` supports pagination** — use `page` and `limit` for large chat lists. `getChats` returns all at once.

- **`deleteChat` is permanent** — removes the entire chat from your view. The other participant's messages are not deleted. Use `clearChatMessages` if you only want to clear the history.

- **`readMessages` does NOT send read receipts** — it only fetches content. Use `read` separately if you also want to send read receipts.
