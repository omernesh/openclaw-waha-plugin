# Status / Stories — Chatlytics WhatsApp

> Part of the Chatlytics WhatsApp skill. See [SKILL.md](../SKILL.md) for overview and other categories.

**MCP tool:** `send_message` (status variants)

## Actions

| Action | Parameters | Notes |
|--------|-----------|-------|
| Post text status | `text`, `backgroundColor?` (hex), `font?` (0–5) | Post a text story |
| Post image status | `image` (URL or path), `caption?` | Post an image story |
| Post voice status | `voice` (URL or path) | Post a voice story |
| Post video status | `video` (URL or path), `caption?` | Post a video story |
| Delete status | `id` (message ID of the status to delete) | Delete a posted story |
| Get new message ID | `chatId` | Generate a fresh message ID (used for status replies or pre-generated IDs) |

## Examples

### Post a text status with a background color

```bash
curl -X POST http://localhost:8050/api/v1/send \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "sendTextStatus", "text": "Good morning!", "backgroundColor": "#128C7E", "font": 1}'
```

### Post an image story

```bash
curl -X POST http://localhost:8050/api/v1/send-media \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "sendImageStatus", "image": "https://example.com/photo.jpg", "caption": "Beautiful day!"}'
```

### Delete a status

```json
{ "action": "deleteStatus", "id": "true_status@broadcast_ABC123" }
```

## Gotchas

- `sendVoiceStatus` and `sendVideoStatus` take `voice`/`video` parameter (direct URL or absolute path to a local file). Must be a direct media URL, not a JSON API endpoint.
- `backgroundColor` for `sendTextStatus` is a hex color string (e.g., `"#128C7E"`).
- `font` for `sendTextStatus` is an integer 0–5 corresponding to WhatsApp's built-in font styles.
- `deleteStatus` requires the full message ID of the status post (same format as regular message IDs: `true_status@broadcast_SHORTID`).
- Status posts go to your WhatsApp Story — visible to your contacts based on your privacy settings, not sent to a specific chat.
