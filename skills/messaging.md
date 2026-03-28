# Messaging — Chatlytics WhatsApp

> Part of the Chatlytics WhatsApp skill. See [SKILL.md](../SKILL.md) for overview and other categories.

**MCP tool:** `send_message`, `send_poll`, `send_reaction`

## Actions

### Send & Reply

| Action | REST Endpoint / MCP Tool | Parameters | Notes |
|--------|--------------------------|-----------|-------|
| Send text | `POST /api/v1/send` | chatId, text | Auto-resolves names to JIDs |
| Reply to message | `POST /api/v1/send` | chatId, text, replyTo (messageId) | Reply to a specific message |
| Send to multiple | `POST /api/v1/send` | recipients[], text | Max 10 recipients (text-only) |
| Create poll | `POST /api/v1/send-poll` | chatId, title, options[], multipleAnswers? | `name`+`options`+`multipleAnswers` all required |
| React to message | `POST /api/v1/react` | chatId, messageId, emoji | Full messageId required |
| Edit message | `POST /api/v1/send` (edit) | chatId, messageId, text | Edit a previously sent message |
| Delete/unsend | (manage endpoint) | chatId, messageId | Delete/retract a sent message |
| Pin message | (manage endpoint) | chatId, messageId | Pin a message in chat |
| Unpin message | (manage endpoint) | chatId, messageId | Unpin a message |
| Mark as read | `POST /api/v1/send` (read) | chatId | Sends read receipts |
| Delete chat | (manage endpoint) | chatId | Delete a chat |

### Rich Message Types

| Action | Parameters | Notes |
|--------|-----------|-------|
| Send multi-recipient | `recipients[]`, `text` | Send to multiple chats (max 10 recipients, text-only) |
| Send location | `chatId`, `latitude`, `longitude`, `title` | Share a location pin |
| Send contact card | `chatId`, `contacts[{fullName, phoneNumber}]` | Send vCard contact(s) |
| Send list message | `chatId`, `title`, `description`, `buttonText`, `sections[]` | Interactive list |
| Send link preview | `chatId`, `url`, `title`, `description?`, `image?` | URL with rich card |
| Send WhatsApp event | `chatId`, `name`, `startTime`, `endTime?`, `description?`, `location?` | Native event card |
| Forward message | `chatId`, `messageId` | Forward a message to another chat |
| Star/unstar message | `chatId`, `messageId`, `star` (boolean) | Star or unstar |
| Read messages | `GET /api/v1/messages` | chatId, limit? (1-50, default 10) | Fetch recent messages (no read receipts) |

## `readMessages` vs `read` — Comparison

| Operation | What It Does | When to Use |
|-----------|-------------|-------------|
| `GET /api/v1/messages` | **Fetches message content** — returns array of recent messages with sender, text, timestamp, type. Does NOT affect read status. | Read recent conversation history to understand context |
| Mark as read | **Sends read receipts** — marks the chat as read in WhatsApp (clears unread badge). Returns nothing useful. | Tell WhatsApp you've seen the messages |

**Rule:** Use `GET /api/v1/messages` to read content. Mark-as-read to send read receipts. They are completely different operations.

## iCal / Calendar Events

Two approaches for sharing calendar events:

### Approach 1: Native WhatsApp Event (recommended for WhatsApp-native experience)

```bash
curl -X POST http://localhost:8050/api/v1/send \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "120363421825201386@g.us",
    "event": {
      "name": "Team Standup",
      "startTime": "2026-03-27T09:00:00Z",
      "endTime": "2026-03-27T09:30:00Z",
      "description": "Daily standup meeting",
      "location": "Zoom"
    }
  }'
```

Recipients see a WhatsApp event card with RSVP buttons. Event RSVPs arrive as `[event_rsvp]` messages.

### Approach 2: iCal file (for external calendar interop — Google Calendar, Outlook, etc.)

```bash
curl -X POST http://localhost:8050/api/v1/send-media \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "120363421825201386@g.us",
    "mediaUrl": "/tmp/meeting.ics",
    "type": "file",
    "caption": "Team meeting invite — import to your calendar"
  }'
```

Use this when the recipient needs to add the event to an external calendar app.

## Examples

### Send text message (REST)

```bash
curl -X POST http://localhost:8050/api/v1/send \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chatId": "120363421825201386@g.us", "text": "Hello everyone!"}'
```

### Create a poll (REST)

```bash
curl -X POST http://localhost:8050/api/v1/send-poll \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "120363421825201386@g.us",
    "title": "Lunch preference?",
    "options": ["Pizza", "Sushi", "Salad"],
    "multipleAnswers": false
  }'
```

### React to a message (REST)

```bash
curl -X POST http://localhost:8050/api/v1/react \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chatId": "120363421825201386@g.us", "messageId": "true_120363421825201386@g.us_3EB0A1234ABC", "emoji": "👍"}'
```

### Read recent messages (REST)

```bash
curl "http://localhost:8050/api/v1/messages?chatId=120363421825201386@g.us&limit=20" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

Returns array of: `{ id, from, text, timestamp, type }`.

### Send a location (REST)

```bash
curl -X POST http://localhost:8050/api/v1/send \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "972544329000@c.us",
    "location": { "latitude": 32.0853, "longitude": 34.7818, "title": "Tel Aviv" }
  }'
```

## Gotchas

- **poll requires `title`, `options[]`, `multipleAnswers`** — all three fields are required. `multipleAnswers` is boolean.
- **react needs full messageId format** — `true_chatId_shortMsgId` (e.g., `true_120363421825201386@g.us_3EB0A1234ABC`). Not just the short ID.
- **Read messages vs mark-as-read** — see comparison table above. A common mistake is marking-as-read when you want to fetch messages.
- **NOWEB drops >95% of poll.vote events** — poll votes are unreliable with the NOWEB engine.
- **sendMulti is text-only** — media multi-send not supported; use individual send-media calls.
- **sendMulti max 10 recipients** — enforced to respect rate limits.
- **Auto link preview** — `send` automatically generates link previews by default.
