# Media — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.

## Actions

| Action | Parameters | Notes |
|--------|-----------|-------|
| `sendImage` | `chatId`, `file` (direct URL or path), `caption?` | Send an image. Alt param names: `image` or `url` |
| `sendVideo` | `chatId`, `file` (direct URL or path), `caption?` | Send a video. Alt param names: `video` or `url` |
| `sendFile` | `chatId`, `file` (direct URL or path), `caption?` | Send any document/file. Alt param name: `url` |
| `convertVoice` | `url` (audio URL) | Convert an audio file to WhatsApp voice note format (returns converted URL) |
| `convertVideo` | `url` (video URL) | Convert a video file to WhatsApp-compatible format (returns converted URL) |

> **CRITICAL: `file` must be a direct media URL** — a URL that returns the actual bytes of the media file. NOT a JSON API endpoint, NOT a web page. If you fetched file info from an API, extract the download/media URL from the response before passing it here.

## Examples

### Send an image with caption
```
Action: sendImage
Parameters: { "chatId": "120363421825201386@g.us", "file": "https://example.com/photo.jpg", "caption": "Check this out!" }
```

### Send a document
```
Action: sendFile
Parameters: { "chatId": "972544329000@c.us", "file": "/tmp/openclaw/report.pdf", "caption": "Monthly report" }
```

### Send an animated GIF (displays as animated)
```
Action: sendVideo
Parameters: { "chatId": "120363421825201386@g.us", "file": "https://example.com/animation.gif", "gifPlayback": true }
```

### Convert and send a voice note
```
Action: convertVoice
Parameters: { "url": "https://example.com/audio.mp3" }
// Use the returned converted URL with the send action's voice parameter
```

### Using alternative parameter names
```
// sendImage also accepts "image" or "url" instead of "file"
Action: sendImage
Parameters: { "chatId": "972544329000@c.us", "image": "https://example.com/pic.png" }

// sendFile also accepts "url" instead of "file"
Action: sendFile
Parameters: { "chatId": "972544329000@c.us", "url": "https://example.com/doc.pdf" }
```

## Gotchas

- **Direct URL only**: `file` must resolve to raw media bytes. A URL returning JSON (e.g., a file metadata API) will fail silently or send garbage.
- **Local files**: Use absolute path (e.g., `/tmp/openclaw/image.png`). Relative paths will fail.
- `audio/ogg` is automatically rewritten to `audio/ogg; codecs=opus` for proper voice bubble rendering in WhatsApp.
- `gifPlayback: true` on `sendVideo` renders the video as a looping animated GIF in WhatsApp.
- `mediaMaxMb` default is 50MB per file. Larger files will be rejected.
- Do NOT route `sendImage`/`sendVideo`/`sendFile` through `sendWahaMediaBatch` — MIME detection will re-route and break things.

---

## Other Utilities

### LID Lookups

LID (Linked ID) is an alternate identifier WhatsApp uses for contacts on some platforms/engines.

| Action | Parameters | Notes |
|--------|-----------|-------|
| `findPhoneByLid` | `lid` (LID string, e.g. `"271862907039996@lid"`) | Resolve a LID to a phone number / `@c.us` JID |
| `findLidByPhone` | `phone` (e.g. `"972544329000"`) | Resolve a phone number to its LID |
| `getAllLids` | _(none)_ | List all known LID mappings |

**When to use:** NOWEB engine sends some group messages with `@lid` sender JIDs instead of `@c.us`. Use `findPhoneByLid` to get the canonical contact JID.

### Calls

| Action | Parameters | Notes |
|--------|-----------|-------|
| `rejectCall` | `callId` | Reject an incoming WhatsApp call |

**Usage:** When an inbound call event arrives, pass its `callId` to reject it automatically.

### Policy

| Action | Parameters | Notes |
|--------|-----------|-------|
| `editPolicy` | _(see notes)_ | Edit the active YAML-based rules policy at runtime |

**Note:** `editPolicy` modifies the rules engine policy. Use with care — changes affect which messages are processed and forwarded to the agent. This is an advanced/admin action.
