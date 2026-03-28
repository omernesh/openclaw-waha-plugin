# Presence — Chatlytics WhatsApp

> Part of the Chatlytics WhatsApp skill. See [SKILL.md](../SKILL.md) for overview and other categories.

**MCP tool:** `get_status` (for reading presence), `update_settings` (for setting presence)

## Actions

| Action | REST / MCP | Parameters | Notes |
|--------|------------|-----------|-------|
| Set presence | `update_settings` | `status` (`"online"` \| `"offline"`) | Set the bot's presence |
| Get contact presence | `get_status` | `contactId` | Get the presence status of a specific contact |
| Subscribe to presence | (manage endpoint) | `contactId` | Subscribe to a contact's presence updates (needed before get) |
| Get all presences | `get_status` | _(none)_ | Get presence status for all currently subscribed contacts |

## Examples

### Set the bot online

```bash
curl -X POST http://localhost:8050/api/v1/send \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "setPresenceStatus", "status": "online"}'
```

### Subscribe to a contact's presence then check it

```json
{ "action": "subscribePresence", "contactId": "972544329000@c.us" }
```

Then:

```bash
curl "http://localhost:8050/api/v1/status?contactId=972544329000@c.us" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

### Get all subscribed presences at once

```bash
curl "http://localhost:8050/api/v1/status?type=presence" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

Returns an array of `{ contactId, status, lastSeen? }` for all subscribed contacts.

## Gotchas

- `setPresenceStatus` and `setPresence` are **identical aliases** — both map to the same WAHA endpoint. Use either name.
- You must `subscribePresence` for a contact before `getPresence` returns useful data. Without a subscription, WAHA may return stale or empty presence.
- `getAllPresence` returns presence only for contacts you have subscribed to. Unsubscribed contacts are not included.
- Presence subscriptions are session-scoped and do not persist across server restarts — re-subscribe after restarts if needed.
- NOWEB engine support for presence is best-effort; some contacts may not report live presence updates.
