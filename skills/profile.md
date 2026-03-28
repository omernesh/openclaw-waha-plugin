# Profile — Chatlytics WhatsApp

> Part of the Chatlytics WhatsApp skill. See [SKILL.md](../SKILL.md) for overview and other categories.

**MCP tool:** `get_status` (for reading profile), `update_settings` (for setting profile)

## Actions

| Action | REST / MCP | Parameters | Notes |
|--------|------------|-----------|-------|
| Get profile | `GET /api/v1/status` | _(none)_ | Retrieve the current WhatsApp profile (name, status, picture URL) |
| Set display name | `update_settings` | `name` (string) | Update the display name |
| Set about text | `update_settings` | `status` (string) | Update the "about" / status text |
| Set profile picture | `update_settings` | `file` (URL or absolute path) | Set the profile picture |
| Delete profile picture | `update_settings` | _(none)_ | Remove the current profile picture |

## Examples

### Get the current profile

```bash
curl "http://localhost:8050/api/v1/status" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

Returns: `{ name, status, picture }` — `picture` is a temporary WAHA-served URL.

### Update the display name

```json
{ "action": "setProfileName", "name": "WhatsApp Bot" }
```

### Update the about/status text

```json
{ "action": "setProfileStatus", "status": "Available 24/7" }
```

### Set a profile picture from a URL

```json
{ "action": "setProfilePicture", "file": "https://example.com/avatar.jpg" }
```

### Set a profile picture from a local file

```json
{ "action": "setProfilePicture", "file": "/tmp/avatar.png" }
```

### Remove the profile picture

```json
{ "action": "deleteProfilePicture" }
```

## Gotchas

- `file` for `setProfilePicture` must be a **direct media URL** (a URL that returns the image bytes) or an **absolute local path**. Do not pass a JSON API endpoint or a web page URL.
- Profile picture URLs returned by `getProfile` are temporary — they expire after a short period. Download immediately if you need to store or share the image.
- `setProfileStatus` sets the "About" text visible on the profile card — not to be confused with presence status (online/offline indicator).
- Changes to name and status are reflected immediately on WhatsApp. Profile picture changes may take a moment to propagate.
