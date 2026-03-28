# Channels (Newsletters) — Chatlytics WhatsApp

> Part of the Chatlytics WhatsApp skill. See [SKILL.md](../SKILL.md) for overview and other categories.

> **CRITICAL:** WhatsApp channel invite links use a CODE that is NOT the same as the newsletter JID. See the Gotchas section before using follow/unfollow.

**MCP tool:** `manage_group` (for channel management), `get_directory` (for listing)

## Actions

### Query & Discover

| Action | REST Endpoint | Parameters | Notes |
|--------|--------------|-----------|-------|
| List followed channels | `GET /api/v1/directory?type=newsletter` | (none) | List all channels the bot is following |
| Get channel details | `GET /api/v1/directory/{channelId}` | channelId | Get details for a specific channel (by newsletter JID) |
| Search channels | `GET /api/v1/search?query=...` | query | Search public channels by name/text |
| Search by view type | (manage endpoint) | viewType (e.g. `"RECOMMENDED"`) | Search channels by category view |
| Get search views | (manage endpoint) | (none) | List available view types for channel search |
| Get search countries | (manage endpoint) | (none) | List countries available as channel search filter |
| Get search categories | (manage endpoint) | (none) | List categories available as channel search filter |
| Preview channel messages | (manage endpoint) | channelId | Preview recent messages (without following) |

### Follow & Manage

| Action | Parameters | Notes |
|--------|-----------|-------|
| Follow channel | channelId | Subscribe; `channelId` must be newsletter JID, NOT invite code |
| Unfollow channel | channelId | Unsubscribe from a channel |
| Mute channel | channelId | Mute notifications from a channel |
| Unmute channel | channelId | Unmute a channel |

### Create & Delete

| Action | Parameters | Notes |
|--------|-----------|-------|
| Create channel | name, description?, picture? | Create a new newsletter channel |
| Delete channel | channelId | Delete a channel (admin/owner only) |

## Examples

### List all followed channels (REST)

```bash
curl "http://localhost:8050/api/v1/directory?type=newsletter" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

### Search for channels by name (REST)

```bash
curl "http://localhost:8050/api/v1/search?query=tech+news" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

### Follow a channel (by newsletter JID)

```json
{ "action": "followChannel", "channelId": "120363421825201386@newsletter" }
```

### Follow a channel from an invite link

Invite links look like `https://whatsapp.com/channel/AbcXyz123...`. The `AbcXyz123` part is the **invite code**, NOT the JID. You cannot use it directly with `followChannel`.

Search by name first to get the newsletter JID:

```bash
curl "http://localhost:8050/api/v1/search?query=channel+name" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

Then use the `id` field (ending in `@newsletter`) with follow.

### Unfollow a channel

```json
{ "action": "unfollowChannel", "channelId": "120363421825201386@newsletter" }
```

### Preview channel messages without following

```json
{ "action": "previewChannelMessages", "channelId": "120363421825201386@newsletter" }
```

### Create a new channel

```json
{
  "action": "createChannel",
  "name": "Team Announcements",
  "description": "Official updates from the team",
  "picture": "/tmp/logo.png"
}
```

## Gotchas

- **Channel invite code ≠ newsletter JID** — This is the most common mistake. `https://whatsapp.com/channel/AbcXyz123...` — the `AbcXyz123` part is an **invite code**. It is NOT a newsletter JID. Follow requires the JID (e.g., `120363421825201386@newsletter`). To get the JID, search by name and use the `id` field from the results.

- **WAHA silent no-ops** — `followChannel` called with an invite code returns 200 with no error but does nothing. Always verify the channel appears in the directory after following.

- **`channelId` vs newsletter JID** — both terms refer to the same thing: a JID ending in `@newsletter`. The `channelId` parameter expects this format.

- **`previewChannelMessages` does not require following** — useful to check a channel's content before deciding to follow it.

- **`muteChannel` affects notifications only** — the bot still receives channel messages internally; it just suppresses UI notifications.

- **`deleteChannel` is irreversible** — deletes the entire channel. Use `unfollowChannel` to simply stop following.
