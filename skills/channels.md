# Channels (Newsletters) — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.

> **CRITICAL:** WhatsApp channel invite links use a CODE that is NOT the same as the newsletter JID. See the Gotchas section before using follow/unfollow.

## Actions

### Query & Discover

| Action | Parameters | Notes |
|--------|-----------|-------|
| `getChannels` | (none) | List all channels the bot is following |
| `getChannel` | channelId | Get details for a specific channel (by newsletter JID) |
| `searchChannelsByText` | query | Search public channels by name/text |
| `searchChannelsByView` | viewType (e.g. `"RECOMMENDED"`) | Search channels by category view |
| `getChannelSearchViews` | (none) | List available view types for channel search |
| `getChannelSearchCountries` | (none) | List countries available as channel search filter |
| `getChannelSearchCategories` | (none) | List categories available as channel search filter |
| `previewChannelMessages` | channelId | Preview recent messages from a channel (without following) |

### Follow & Manage

| Action | Parameters | Notes |
|--------|-----------|-------|
| `followChannel` | channelId | Follow a channel (subscribe); `channelId` must be newsletter JID, NOT invite code |
| `unfollowChannel` | channelId | Unfollow a channel |
| `muteChannel` | channelId | Mute notifications from a channel |
| `unmuteChannel` | channelId | Unmute a channel |

### Create & Delete

| Action | Parameters | Notes |
|--------|-----------|-------|
| `createChannel` | name, description?, picture? | Create a new newsletter channel |
| `deleteChannel` | channelId | Delete a channel (admin/owner only) |

## Examples

### List all followed channels

```
Action: getChannels
Parameters: {}
```

### Search for channels by name

```
Action: searchChannelsByText
Parameters: { "query": "tech news" }
```

### Follow a channel (by newsletter JID)

```
Action: followChannel
Parameters: { "channelId": "120363421825201386@newsletter" }
```

### Follow a channel from an invite link

Invite links look like `https://whatsapp.com/channel/AbcXyz123...`. The `AbcXyz123` part is the **invite code**, NOT the JID. You cannot use it directly with `followChannel`.

Use `searchChannelsByText` to find the channel and get its newsletter JID first:

```
Action: searchChannelsByText
Parameters: { "query": "channel name" }
```

Then use the `id` field (ending in `@newsletter`) with `followChannel`.

### Unfollow a channel

```
Action: unfollowChannel
Parameters: { "channelId": "120363421825201386@newsletter" }
```

### Preview channel messages without following

```
Action: previewChannelMessages
Parameters: { "channelId": "120363421825201386@newsletter" }
```

### Browse by category

```
Action: getChannelSearchViews
Parameters: {}
// Returns list of viewType strings like "RECOMMENDED", "POPULAR", etc.

Action: searchChannelsByView
Parameters: { "viewType": "RECOMMENDED" }
```

### Create a new channel

```
Action: createChannel
Parameters: {
  "name": "Team Announcements",
  "description": "Official updates from the team",
  "picture": "/tmp/logo.png"
}
```

## Gotchas

- **Channel invite code ≠ newsletter JID** — This is the most common mistake. `https://whatsapp.com/channel/AbcXyz123...` — the `AbcXyz123` part is an **invite code**. It is NOT a newsletter JID. `followChannel` requires the JID (e.g., `120363421825201386@newsletter`). To get the JID, search by name with `searchChannelsByText` and use the `id` field from the results.

- **WAHA silent no-ops** — `followChannel` called with an invite code returns 200 with no error but does nothing. Always verify the channel appears in `getChannels` after following.

- **`channelId` vs newsletter JID** — both terms refer to the same thing: a JID ending in `@newsletter`. The `channelId` parameter expects this format.

- **`previewChannelMessages` does not require following** — useful to check a channel's content before deciding to follow it.

- **`muteChannel` affects notifications only** — the bot still receives channel messages internally; it just suppresses UI notifications.

- **`deleteChannel` is irreversible** — deletes the entire channel. Use `unfollowChannel` to simply stop following.
