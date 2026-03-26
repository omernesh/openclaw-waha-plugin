# Groups — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.

## Actions

### Query & Info

| Action | Parameters | Notes |
|--------|-----------|-------|
| `getGroups` | (none) | List all groups the bot belongs to |
| `getGroup` | groupId | Get details for a single group |
| `getGroupsCount` | (none) | Total count of groups |
| `getParticipants` | groupId | List all participants with their roles |
| `getGroupPicture` | groupId | Get the group's profile picture URL |
| `getInfoAdminOnly` | groupId | Check if group info editing is admin-only |
| `getMessagesAdminOnly` | groupId | Check if only admins can send messages |
| `refreshGroups` | (none) | Force-refresh groups list from WAHA server |

### Create & Delete

| Action | Parameters | Notes |
|--------|-----------|-------|
| `createGroup` | name, participants[] | Create new group with initial participants |
| `deleteGroup` | groupId | Delete the group (owner only) |
| `leaveGroup` | groupId | Leave the group |

### Join by Invite

| Action | Parameters | Notes |
|--------|-----------|-------|
| `joinGroup` | inviteCode | Join via invite code — NOT the full URL, NOT the channel code |
| `getGroupJoinInfo` | groupId (or invite code) | Preview group details before joining |
| `getInviteCode` | groupId | Get current invite code + full link |
| `revokeInviteCode` | groupId | Revoke current code and generate a new one |

### Edit Group Settings

| Action | Parameters | Notes |
|--------|-----------|-------|
| `setGroupSubject` | groupId, subject | Rename the group |
| `setGroupDescription` | groupId, description | Update group description |
| `setGroupPicture` | groupId, file | Set group picture (absolute path or direct URL) |
| `deleteGroupPicture` | groupId | Remove group picture |
| `setInfoAdminOnly` | groupId, adminOnly (boolean) | Restrict info editing to admins |
| `setMessagesAdminOnly` | groupId, adminOnly (boolean) | Restrict messaging to admins |

### Participant Management

| Action | Parameters | Notes |
|--------|-----------|-------|
| `addParticipants` | groupId, participants[] | Add participants; include both @c.us and @lid JIDs |
| `removeParticipants` | groupId, participants[] | Remove participants from group |
| `promoteToAdmin` | groupId, participants[] | Grant admin role |
| `demoteFromAdmin` | groupId, participants[] | Revoke admin role (alias: `demoteToMember`) |
| `demoteToMember` | groupId, participants[] | Alias for `demoteFromAdmin` — both work |

## Examples

### Create a group

```
Action: createGroup
Parameters: {
  "name": "Project Alpha",
  "participants": ["972544329000@c.us", "972556839823@c.us"]
}
```

### Get invite link

```
Action: getInviteCode
Parameters: { "groupId": "120363421825201386@g.us" }
```

Returns: `{ "inviteCode": "AbcXyz123...", "inviteLink": "https://chat.whatsapp.com/AbcXyz123..." }`

### Share invite link

```
Action: send
Target: "zeev nesher"
Parameters: { "text": "Join here: https://chat.whatsapp.com/AbcXyz123..." }
```

### Join a group by invite code

```
Action: joinGroup
Parameters: { "inviteCode": "AbcXyz123..." }
```

Extract the code from `https://chat.whatsapp.com/AbcXyz123...` — pass only the part after the last `/`.

### Preview a group before joining

```
Action: getGroupJoinInfo
Parameters: { "groupId": "AbcXyz123..." }
```

Returns group name, participant count, description before joining.

### Add participants

```
Action: addParticipants
Parameters: {
  "groupId": "120363421825201386@g.us",
  "participants": ["972544329000@c.us", "271862907039996@lid"]
}
```

Include BOTH `@c.us` AND `@lid` JIDs for NOWEB engine compatibility.

### Promote to admin

```
Action: promoteToAdmin
Parameters: {
  "groupId": "120363421825201386@g.us",
  "participants": ["972544329000@c.us"]
}
```

### Revoke invite code

```
Action: revokeInviteCode
Parameters: { "groupId": "120363421825201386@g.us" }
```

Returns new `{ inviteCode, inviteLink }` pair.

### Make messages admin-only

```
Action: setMessagesAdminOnly
Parameters: { "groupId": "120363421825201386@g.us", "adminOnly": true }
```

## Gotchas

- **`joinGroup` takes the code, NOT the full URL** — extract from `https://chat.whatsapp.com/AbcXyz123` → pass `"AbcXyz123"` only. Full URL will fail.
- **`demoteFromAdmin` and `demoteToMember` are aliases** — both call the same WAHA endpoint. Use either name.
- **`participants[]` must include BOTH `@c.us` AND `@lid` JIDs for NOWEB engine** — NOWEB sends group messages with `@lid` sender JIDs. If you add only `@c.us`, the participant may not receive messages. Add both when available.
- **`setGroupPicture` takes `file`** — must be an absolute local path (e.g., `/tmp/pic.jpg`) or a direct media URL. Not a JSON endpoint.
- **`getGroupJoinInfo` is for preview** — useful to show the user the group name and member count before actually joining via `joinGroup`.
- **`refreshGroups` forces server sync** — use when `getGroups` shows stale data. Expensive call; don't abuse.
- **`createGroup` immediately adds participants** — no separate "add participants" step needed. The bot is automatically the owner.
- **WAHA silent no-ops** — `addParticipants` and similar may return 200 with no error even if the operation silently failed. Verify with `getParticipants` if confirmation is needed.
