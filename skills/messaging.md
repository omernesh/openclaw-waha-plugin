# Messaging — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.

## Actions

### Standard Actions (support target auto-resolution)

| Action | Parameters | Notes |
|--------|-----------|-------|
| `send` | text, contacts[]?, (target via auto-resolution) | Send text or contact cards; target auto-resolves from name |
| `reply` | chatId, messageId, text | Reply to a specific message |
| `poll` | name, options[], multipleAnswers?, (target) | Create a poll; requires name+options+multipleAnswers |
| `react` | messageId, emoji, remove? | Emoji reaction; full messageId required |
| `edit` | chatId, messageId, text | Edit a previously sent message |
| `unsend` | chatId, messageId | Delete/retract a sent message |
| `pin` | chatId, messageId | Pin a message in chat |
| `unpin` | chatId, messageId | Unpin a message |
| `read` | chatId | Mark entire chat as read (sends read receipts) |
| `delete` | chatId | Delete a chat |

### Rich Message Utility Actions

| Action | Parameters | Notes |
|--------|-----------|-------|
| `sendMulti` | recipients[], text | Send to multiple chats (max 10 recipients) |
| `sendPoll` | chatId, name, options[], multipleAnswers | Explicit chatId variant of `poll` |
| `sendPollVote` | chatId, pollMessageId, votes[] | Vote on an existing poll |
| `sendLocation` | chatId, latitude, longitude, title | Share a location pin |
| `sendContactVcard` | chatId, contacts[{fullName, phoneNumber}] | Send contact card(s) with explicit chatId |
| `sendList` | chatId, title, description, buttonText, sections[] | Send a list message |
| `sendLinkPreview` | chatId, url, title, description?, image? | Send URL with rich preview card |
| `sendButtonsReply` | chatId, messageId, buttonId | Reply to a buttons message |
| `sendEvent` | chatId, name, startTime, endTime?, description?, location? | Send native WhatsApp event |
| `forwardMessage` | chatId, messageId | Forward a message to another chat |
| `starMessage` | chatId, messageId, star (boolean) | Star or unstar a message |
| `readMessages` | chatId, limit? (1-50, default 10) | Fetch recent messages for LLM context (does NOT send read receipts) |

## `readMessages` vs `read` — Comparison

| Action | What It Does | When to Use |
|--------|-------------|-------------|
| `readMessages` | **Fetches message content** — returns array of recent messages with sender, text, timestamp, type. Does NOT affect read status. | Read recent conversation history to understand context |
| `read` | **Sends read receipts** — marks the chat as read in WhatsApp (clears unread badge). Returns nothing useful. | Tell WhatsApp you've seen the messages |

**Rule:** Use `readMessages` to read content. Use `read` to mark as read. They are completely different operations.

## iCal / Calendar Events

Two approaches for sharing calendar events:

### Approach 1: Native WhatsApp Event (recommended for WhatsApp-native experience)

```
Action: sendEvent
Parameters: {
  "chatId": "120363421825201386@g.us",
  "name": "Team Standup",
  "startTime": "2026-03-27T09:00:00Z",
  "endTime": "2026-03-27T09:30:00Z",
  "description": "Daily standup meeting",
  "location": "Zoom"
}
```

Recipients see a WhatsApp event card with RSVP buttons. Event RSVPs arrive as `[event_rsvp]` messages.

### Approach 2: iCal file via sendFile (for external calendar interop — Google Calendar, Outlook, etc.)

```
Action: sendFile
Parameters: {
  "chatId": "120363421825201386@g.us",
  "file": "/tmp/meeting.ics",
  "caption": "Team meeting invite — import to your calendar"
}
```

Use this when the recipient needs to add the event to an external calendar app. Generate a standard `.ics` file and send it as a document. The recipient downloads and opens it in their calendar app.

## Examples

### Send text message

```
Action: send
Target: "test group"
Parameters: { "text": "Hello everyone!" }
```

### Send to multiple chats

```
Action: sendMulti
Parameters: {
  "recipients": ["120363421825201386@g.us", "972544329000@c.us"],
  "text": "Meeting in 5 minutes"
}
```

### Create a poll

```
Action: poll
Target: "test group"
Parameters: {
  "name": "Lunch preference?",
  "options": ["Pizza", "Sushi", "Salad"],
  "multipleAnswers": false
}
```

### React to a message

```
Action: react
Parameters: { "messageId": "true_120363421825201386@g.us_3EB0A1234ABC", "emoji": "👍" }
```

### Read recent messages

```
Action: readMessages
Parameters: { "chatId": "120363421825201386@g.us", "limit": 20 }
```

Returns array of: `{ id, from, text, timestamp, type }`.

### Send a location

```
Action: sendLocation
Parameters: {
  "chatId": "972544329000@c.us",
  "latitude": 32.0853,
  "longitude": 34.7818,
  "title": "Tel Aviv"
}
```

### Forward a message

```
Action: forwardMessage
Parameters: { "chatId": "972544329000@c.us", "messageId": "true_120363421825201386@g.us_3EB0A1234ABC" }
```

### Star a message

```
Action: starMessage
Parameters: { "chatId": "120363421825201386@g.us", "messageId": "true_120363421825201386@g.us_3EB0A1234ABC", "star": true }
```

## Gotchas

- **poll requires `name`, `options[]`, `multipleAnswers`** — all three fields are required. `multipleAnswers` is boolean.
- **react needs full messageId format** — `true_chatId_shortMsgId` (e.g., `true_120363421825201386@g.us_3EB0A1234ABC`). Not just the short ID.
- **`read` vs `readMessages`** — see comparison table above. A common mistake is using `read` when you want to fetch messages.
- **sendButtons is deprecated** — use polls (`poll`) or lists (`sendList`) instead of buttons.
- **`readMessages` does NOT accept a target** — pass the JID as `chatId` parameter. Use `search` to find JIDs by name first.
- **NOWEB drops >95% of poll.vote events** — `sendPollVote` will succeed but vote webhooks are unreliable.
- **sendMulti is text-only** — media multi-send not supported; use individual `sendImage`/`sendVideo`/`sendFile` calls.
- **`sendMulti` max 10 recipients** — enforced to respect rate limits.
- **Auto link preview** — `send` automatically generates link previews by default. Opt out via `autoLinkPreview: false` config.
