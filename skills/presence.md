# Presence — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.

## Actions

| Action | Parameters | Notes |
|--------|-----------|-------|
| `setPresenceStatus` | `status` (`"online"` \| `"offline"`) | Set the bot's presence. Alias: `setPresence` — both names work identically |
| `setPresence` | `status` (`"online"` \| `"offline"`) | Alias for `setPresenceStatus` — use either name |
| `getPresence` | `contactId` | Get the presence status of a specific contact |
| `subscribePresence` | `contactId` | Subscribe to a contact's presence updates (needed before `getPresence`) |
| `getAllPresence` | _(none)_ | Get presence status for all currently subscribed contacts at once |

## Examples

### Set the bot online
```
Action: setPresenceStatus
Parameters: { "status": "online" }
```

### Set the bot offline (stop showing as typing/online)
```
Action: setPresence
Parameters: { "status": "offline" }
```

### Subscribe to a contact's presence then check it
```
Action: subscribePresence
Parameters: { "contactId": "972544329000@c.us" }

Action: getPresence
Parameters: { "contactId": "972544329000@c.us" }
```

### Get all subscribed presences at once
```
Action: getAllPresence
Parameters: {}
```
Returns an array of `{ contactId, status, lastSeen? }` for all subscribed contacts.

## Gotchas

- `setPresenceStatus` and `setPresence` are **identical aliases** — both map to the same WAHA endpoint. Use either name.
- You must `subscribePresence` for a contact before `getPresence` returns useful data. Without a subscription, WAHA may return stale or empty presence.
- `getAllPresence` returns presence only for contacts you have subscribed to. Unsubscribed contacts are not included.
- Presence subscriptions are session-scoped and do not persist across gateway restarts — re-subscribe after restarts if needed.
- NOWEB engine support for presence is best-effort; some contacts may not report live presence updates.
