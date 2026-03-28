# Groups — Chatlytics WhatsApp

> Part of the Chatlytics WhatsApp skill. See [SKILL.md](../SKILL.md) for overview and other categories.

**MCP tool:** `manage_group`

## Actions

### Query & Info

| Action | REST / MCP | Parameters | Notes |
|--------|------------|-----------|-------|
| List groups | `GET /api/v1/directory?type=group` | (none) | List all groups the bot belongs to |
| Get group | `GET /api/v1/directory/{groupId}` | groupId | Get details for a single group |
| Get participants | `GET /api/v1/directory/{groupId}/participants` | groupId | List all participants with their roles |
| Get group picture | (manage_group) | groupId | Get the group's profile picture URL |
| Check info admin-only | (manage_group) | groupId | Check if group info editing is admin-only |
| Check messages admin-only | (manage_group) | groupId | Check if only admins can send messages |
| Refresh groups | `POST /api/v1/directory/refresh` | (none) | Force-refresh groups list from WAHA server |

### Create & Delete

| Action | REST / MCP | Parameters | Notes |
|--------|------------|-----------|-------|
| Create group | `manage_group` | name, participants[] | Create new group with initial participants |
| Delete group | `manage_group` | groupId | Delete the group (owner only) |
| Leave group | `manage_group` | groupId | Leave the group |

### Join by Invite

| Action | REST / MCP | Parameters | Notes |
|--------|------------|-----------|-------|
| Join group | `manage_group` | inviteCode | Join via invite code — NOT the full URL |
| Preview group | `manage_group` | groupId or invite code | Preview group details before joining |
| Get invite code | `manage_group` | groupId | Get current invite code + full link |
| Revoke invite code | `manage_group` | groupId | Revoke current code and generate a new one |

### Edit Group Settings

| Action | Parameters | Notes |
|--------|-----------|-------|
| Rename group | groupId, subject | Rename the group |
| Set description | groupId, description | Update group description |
| Set group picture | groupId, file | Set group picture (absolute path or direct URL) |
| Delete group picture | groupId | Remove group picture |
| Set info admin-only | groupId, adminOnly (boolean) | Restrict info editing to admins |
| Set messages admin-only | groupId, adminOnly (boolean) | Restrict messaging to admins |

### Participant Management

| Action | Parameters | Notes |
|--------|-----------|-------|
| Add participants | groupId, participants[] | Add participants; include both @c.us and @lid JIDs |
| Remove participants | groupId, participants[] | Remove participants from group |
| Promote to admin | groupId, participants[] | Grant admin role |
| Demote from admin | groupId, participants[] | Revoke admin role |

## Examples

### Create a group

```bash
curl -X POST http://localhost:8050/api/v1/send \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "createGroup",
    "name": "Project Alpha",
    "participants": ["972544329000@c.us", "972556839823@c.us"]
  }'
```

Or via MCP tool `manage_group`:
```json
{ "action": "createGroup", "name": "Project Alpha", "participants": ["972544329000@c.us"] }
```

### Get invite link

```json
{ "action": "getInviteCode", "groupId": "120363421825201386@g.us" }
```

Returns: `{ "inviteCode": "AbcXyz123...", "inviteLink": "https://chat.whatsapp.com/AbcXyz123..." }`

### Join a group by invite code

```json
{ "action": "joinGroup", "inviteCode": "AbcXyz123..." }
```

Extract the code from `https://chat.whatsapp.com/AbcXyz123...` — pass only the part after the last `/`.

### Preview a group before joining

```json
{ "action": "getGroupJoinInfo", "groupId": "AbcXyz123..." }
```

Returns group name, participant count, description before joining.

### Add participants

```json
{
  "action": "addParticipants",
  "groupId": "120363421825201386@g.us",
  "participants": ["972544329000@c.us", "271862907039996@lid"]
}
```

Include BOTH `@c.us` AND `@lid` JIDs for NOWEB engine compatibility.

### Promote to admin

```json
{
  "action": "promoteToAdmin",
  "groupId": "120363421825201386@g.us",
  "participants": ["972544329000@c.us"]
}
```

### Make messages admin-only

```json
{ "action": "setMessagesAdminOnly", "groupId": "120363421825201386@g.us", "adminOnly": true }
```

## Gotchas

- **`joinGroup` takes the code, NOT the full URL** — extract from `https://chat.whatsapp.com/AbcXyz123` → pass `"AbcXyz123"` only. Full URL will fail.
- **`participants[]` must include BOTH `@c.us` AND `@lid` JIDs for NOWEB engine** — NOWEB sends group messages with `@lid` sender JIDs. If you add only `@c.us`, the participant may not receive messages. Add both when available.
- **`setGroupPicture` takes `file`** — must be an absolute local path (e.g., `/tmp/pic.jpg`) or a direct media URL. Not a JSON endpoint.
- **`getGroupJoinInfo` is for preview** — useful to show the user the group name and member count before actually joining via `joinGroup`.
- **`refreshGroups` forces server sync** — use when the directory shows stale data. Expensive call; don't abuse.
- **`createGroup` immediately adds participants** — no separate "add participants" step needed. The bot is automatically the owner.
- **WAHA silent no-ops** — `addParticipants` and similar may return 200 with no error even if the operation silently failed. Verify with `getParticipants` if confirmation is needed.
