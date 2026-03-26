# Profile — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.

## Actions

| Action | Parameters | Notes |
|--------|-----------|-------|
| `getProfile` | _(none)_ | Retrieve the current WhatsApp profile (name, status, picture URL) |
| `setProfileName` | `name` (string) | Update the display name |
| `setProfileStatus` | `status` (string) | Update the "about" / status text |
| `setProfilePicture` | `file` (URL or absolute path) | Set the profile picture |
| `deleteProfilePicture` | _(none)_ | Remove the current profile picture |

## Examples

### Get the current profile
```
Action: getProfile
Parameters: {}
```
Returns: `{ name, status, picture }` — `picture` is a temporary WAHA-served URL.

### Update the display name
```
Action: setProfileName
Parameters: { "name": "WhatsApp Bot" }
```

### Update the about/status text
```
Action: setProfileStatus
Parameters: { "status": "Available 24/7" }
```

### Set a profile picture from a URL
```
Action: setProfilePicture
Parameters: { "file": "https://example.com/avatar.jpg" }
```

### Set a profile picture from a local file
```
Action: setProfilePicture
Parameters: { "file": "/tmp/openclaw/avatar.png" }
```

### Remove the profile picture
```
Action: deleteProfilePicture
Parameters: {}
```

## Gotchas

- `file` for `setProfilePicture` must be a **direct media URL** (a URL that returns the image bytes) or an **absolute local path**. Do not pass a JSON API endpoint or a web page URL.
- Profile picture URLs returned by `getProfile` are temporary — they expire after a short period. Download immediately if you need to store or share the image.
- `setProfileStatus` sets the "About" text visible on the profile card — not to be confused with `setPresenceStatus` (online/offline indicator).
- Changes to name and status are reflected immediately on WhatsApp. Profile picture changes may take a moment to propagate.
