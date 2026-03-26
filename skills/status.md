# Status / Stories — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.

## Actions

| Action | Parameters | Notes |
|--------|-----------|-------|
| `sendTextStatus` | `text`, `backgroundColor?` (hex), `font?` (0–5) | Post a text story |
| `sendImageStatus` | `image` (URL or path), `caption?` | Post an image story |
| `sendVoiceStatus` | `voice` (URL or path) | Post a voice story |
| `sendVideoStatus` | `video` (URL or path), `caption?` | Post a video story |
| `deleteStatus` | `id` (message ID of the status to delete) | Delete a posted story |
| `getNewMessageId` | `chatId` | Generate a fresh message ID (used for status replies or other operations needing a pre-generated ID) |

## Examples

### Post a text status with a background color
```
Action: sendTextStatus
Parameters: { "text": "Good morning!", "backgroundColor": "#128C7E", "font": 1 }
```

### Post an image story
```
Action: sendImageStatus
Parameters: { "image": "https://example.com/photo.jpg", "caption": "Beautiful day!" }
```

### Delete a status
```
Action: deleteStatus
Parameters: { "id": "true_status@broadcast_ABC123" }
```

### Generate a message ID for use in another operation
```
Action: getNewMessageId
Parameters: { "chatId": "120363421825201386@g.us" }
```
Returns: `{ "messageId": "AABB..." }` — use this ID in operations that require a pre-generated message ID.

## Gotchas

- `sendVoiceStatus` and `sendVideoStatus` take `voice`/`video` parameter (direct URL or absolute path to a local file). Same rules as media send — must be a direct media URL, not a JSON API endpoint.
- `backgroundColor` for `sendTextStatus` is a hex color string (e.g., `"#128C7E"`).
- `font` for `sendTextStatus` is an integer 0–5 corresponding to WhatsApp's built-in font styles.
- `deleteStatus` requires the full message ID of the status post (same format as regular message IDs: `true_status@broadcast_SHORTID`).
- `getNewMessageId` is primarily used internally or when a caller needs to reference a message before it is sent. Pass the chatId that the message will eventually belong to.
- Status posts go to your WhatsApp Story — visible to your contacts based on your privacy settings, not sent to a specific chat.
