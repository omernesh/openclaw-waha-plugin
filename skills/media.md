# Media — Chatlytics WhatsApp

> Part of the Chatlytics WhatsApp skill. See [SKILL.md](../SKILL.md) for overview and other categories.

**MCP tool:** `send_media`

## Actions

| Action | REST Endpoint | Parameters | Notes |
|--------|--------------|-----------|-------|
| Send image | `POST /api/v1/send-media` | chatId, mediaUrl (direct URL or path), caption? | `type: "image"`. Alt param names: `image` or `url` |
| Send video | `POST /api/v1/send-media` | chatId, mediaUrl (direct URL or path), caption? | `type: "video"`. Alt param names: `video` or `url` |
| Send file | `POST /api/v1/send-media` | chatId, mediaUrl (direct URL or path), caption? | `type: "file"`. Alt param name: `url` |
| Convert audio | (utility endpoint) | url (audio URL) | Convert an audio file to WhatsApp voice note format (returns converted URL) |
| Convert video | (utility endpoint) | url (video URL) | Convert a video file to WhatsApp-compatible format (returns converted URL) |

> **CRITICAL: `mediaUrl` must be a direct media URL** — a URL that returns the actual bytes of the media file. NOT a JSON API endpoint, NOT a web page. If you fetched file info from an API, extract the download/media URL from the response before passing it here.

## Examples

### Send an image with caption (REST)

```bash
curl -X POST http://localhost:8050/api/v1/send-media \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "120363421825201386@g.us",
    "mediaUrl": "https://example.com/photo.jpg",
    "type": "image",
    "caption": "Check this out!"
  }'
```

### Send a document (REST)

```bash
curl -X POST http://localhost:8050/api/v1/send-media \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "972544329000@c.us",
    "mediaUrl": "/tmp/report.pdf",
    "type": "file",
    "caption": "Monthly report"
  }'
```

### Send an animated GIF (displays as animated)

```bash
curl -X POST http://localhost:8050/api/v1/send-media \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "120363421825201386@g.us",
    "mediaUrl": "https://example.com/animation.gif",
    "type": "video",
    "gifPlayback": true
  }'
```

## Gotchas

- **Direct URL only**: `mediaUrl` must resolve to raw media bytes. A URL returning JSON (e.g., a file metadata API) will fail silently or send garbage.
- **Local files**: Use absolute path (e.g., `/tmp/image.png`). Relative paths will fail.
- `audio/ogg` is automatically rewritten to `audio/ogg; codecs=opus` for proper voice bubble rendering in WhatsApp.
- `gifPlayback: true` on video sends renders the video as a looping animated GIF in WhatsApp.
- `mediaMaxMb` default is 50MB per file. Larger files will be rejected.

---

## Other Utilities

### LID Lookups

LID (Linked ID) is an alternate identifier WhatsApp uses for contacts on some platforms/engines.

| Action | Parameters | Notes |
|--------|-----------|-------|
| Find phone by LID | `lid` (LID string, e.g. `"271862907039996@lid"`) | Resolve a LID to a phone number / `@c.us` JID |
| Find LID by phone | `phone` (e.g. `"972544329000"`) | Resolve a phone number to its LID |
| Get all LIDs | _(none)_ | List all known LID mappings |

**When to use:** NOWEB engine sends some group messages with `@lid` sender JIDs instead of `@c.us`. Use `findPhoneByLid` to get the canonical contact JID.

### Calls

| Action | Parameters | Notes |
|--------|-----------|-------|
| Reject call | `callId` | Reject an incoming WhatsApp call |

**Usage:** When an inbound call event arrives, pass its `callId` to reject it automatically.
