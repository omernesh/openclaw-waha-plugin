---
name: whatsapp-messenger
description: Send WhatsApp messages to Omer, read WhatsApp conversations, create polls, send reactions, manage groups, contacts, channels, labels, presence, profile, and communicate via WAHA REST API. Use when the user asks to "message me on WhatsApp", "send a WhatsApp message", "notify me on WhatsApp", "read WhatsApp messages", "check WhatsApp", "create a WhatsApp poll", "send WhatsApp reaction", "list groups", "join a group", "leave a group", or when you need to communicate with Omer outside of the terminal.
version: 2.0.0
---

# WhatsApp Messenger Skill

Full WhatsApp control through the WAHA REST API on hpg6. Over 100 actions available — standard actions support name-to-JID auto-resolution; utility actions require explicit chatId/JID parameters.

## Connection Details

| Setting | Value |
|---------|-------|
| **SSH** | `ssh omer@100.114.126.43` (key auth) |
| **WAHA API** | `http://127.0.0.1:3004` (on hpg6) |
| **API Key Header** | `X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=` |
| **Session** | `3cf11776_omer` |

## Omer's Contact Details

| Target | Chat ID |
|--------|---------|
| **Omer DM** | `972544329000@c.us` |
| **Sammie Test Group** | `120363421825201386@g.us` |

## How to Use Actions

Actions are invoked through the OpenClaw gateway. Standard actions (send, poll, react, etc.) support human-readable name targets — the plugin auto-resolves them to JIDs. Utility actions require explicit JID parameters.

### Send a Text Message (primary example)

```bash
ssh omer@100.114.126.43 'python3 -c "
import json, urllib.request
data = json.dumps({
    \"chatId\": \"CHAT_ID\",
    \"text\": \"YOUR_MESSAGE\",
    \"session\": \"3cf11776_omer\"
}).encode()
req = urllib.request.Request(\"http://127.0.0.1:3004/api/sendText\", data=data, headers={\"Content-Type\": \"application/json\", \"X-Api-Key\": \"XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=\"})
print(urllib.request.urlopen(req).read().decode()[:200])
"'
```

Replace `CHAT_ID` with `972544329000@c.us` (Omer DM) or a group JID.

---

## Available Actions

### Messaging (Standard Actions — support name-to-JID target resolution)

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `send` | `chatId`/`to`, `text` | Send text message |
| `reply` | `chatId`, `messageId`, `text` | Reply to a specific message |
| `poll` | `chatId`, `name`, `options[]`, `multipleAnswers` | Create a poll |
| `react` | `chatId`, `messageId`, `reaction` (emoji) | React to a message |
| `edit` | `chatId`, `messageId`, `text` | Edit a sent message |
| `unsend` | `chatId`, `messageId` | Delete/unsend a message |
| `delete` | `chatId`, `messageId` | Delete a message |
| `pin` | `chatId`, `messageId` | Pin a message |
| `unpin` | `chatId`, `messageId` | Unpin a message |
| `read` | `chatId` | Mark chat as read |

---

### Rich Messages

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `sendPoll` | `chatId`, `name`, `options[]`, `multipleAnswers`, `replyToId?` | Create a poll (utility form, no auto-resolve) |
| `sendPollVote` | `chatId`, `pollMessageId`, `votes[]` | Vote on a poll |
| `sendLocation` | `chatId`, `latitude`, `longitude`, `title`, `replyToId?` | Send location pin |
| `sendContactVcard` | `chatId`, `contacts[]`, `replyToId?` | Send contact card(s) |
| `sendList` | `chatId`, `title`, `description`, `buttonText`, `sections[]`, `replyToId?` | Send interactive list |
| `sendLinkPreview` | `chatId`, `url`, `title`, `description?`, `image?`, `replyToId?` | Send URL with preview |
| `sendButtonsReply` | `chatId`, `messageId`, `buttonId` | Reply to a buttons message |
| `sendEvent` | `chatId`, `name`, `startTime`, `endTime?`, `description?`, `location?`, `extraGuestsAllowed?`, `replyToId?` | Send event invite |
| `forwardMessage` | `chatId`, `messageId` | Forward a message |
| `sendMulti` | `recipients[]` (up to 10), `text` | Send same text to multiple recipients sequentially |

---

### Media

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `sendImage` | `chatId`/`to`, `image`/`url`/`file`, `caption?`, `replyToId?` | Send image |
| `sendVideo` | `chatId`/`to`, `video`/`url`/`file`, `caption?`, `replyToId?` | Send video |
| `sendFile` | `chatId`/`to`, `file`/`url`, `caption?`, `replyToId?` | Send document/file |
| `starMessage` | `chatId`, `messageId`, `star` (bool) | Star or unstar a message |

---

### Chat Management

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `readMessages` | `chatId`, `limit` (default 10, max 50) | Read recent messages in lean LLM-friendly format (returns `from`, `body`, `timestamp`, `fromMe`, `hasMedia`, `type`) |
| `getChats` | — | List all chats |
| `getChatsOverview` | `page?`, `limit?` | Paginated chat overview |
| `getChatMessages` | `chatId`, `limit?`, `offset?`, `downloadMedia?` | Get raw chat messages |
| `getChatMessage` | `chatId`, `messageId` | Get a single message |
| `deleteChat` | `chatId` | Delete a chat |
| `clearChatMessages` | `chatId` | Clear chat message history |
| `archiveChat` | `chatId` | Archive a chat |
| `unarchiveChat` | `chatId` | Unarchive a chat |
| `unreadChat` | `chatId` | Mark chat as unread |
| `readChatMessages` | `chatId` | Mark chat as read (utility form) |
| `getChatPicture` | `chatId` | Get chat picture |
| `muteChat` | `chatId`, `duration?` (seconds) | Mute a chat |
| `unmuteChat` | `chatId` | Unmute a chat |

---

### Groups

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `createGroup` | `name`, `participants[]` | Create a new group |
| `getGroups` | — | List all groups (returns dict keyed by JID — use Object.values) |
| `getGroup` | `groupId` | Get group details |
| `getGroupsCount` | — | Count of joined groups |
| `getGroupJoinInfo` | `groupId` | Preview group info before joining |
| `getParticipants` | `groupId` | List group participants |
| `deleteGroup` | `groupId` | Disband group (admin only) |
| `leaveGroup` | `groupId` | Leave a group |
| `setGroupSubject` | `groupId`, `subject` | Rename a group |
| `setGroupDescription` | `groupId`, `description` | Set group description |
| `setGroupPicture` | `groupId`, `file` (URL) | Set group picture |
| `deleteGroupPicture` | `groupId` | Delete group picture |
| `getGroupPicture` | `groupId` | Get group picture |
| `addParticipants` | `groupId`, `participants[]` | Add participants |
| `removeParticipants` | `groupId`, `participants[]` | Remove participants |
| `promoteToAdmin` | `groupId`, `participants[]` | Promote to admin |
| `demoteFromAdmin` | `groupId`, `participants[]` | Demote from admin |
| `setInfoAdminOnly` | `groupId`, `adminOnly` (bool) | Restrict group info editing to admins |
| `getInfoAdminOnly` | `groupId` | Check group info admin-only setting |
| `setMessagesAdminOnly` | `groupId`, `adminOnly` (bool) | Restrict messaging to admins |
| `getMessagesAdminOnly` | `groupId` | Check messages admin-only setting |
| `getInviteCode` | `groupId` | Get group invite link |
| `revokeInviteCode` | `groupId` | Revoke and regenerate invite link |
| `joinGroup` | `inviteCode` | Join group via invite code or chat.whatsapp.com link |
| `refreshGroups` | — | Refresh local group cache from WAHA |

---

### Contacts

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `getContacts` | — | List all contacts |
| `getContact` | `contactId` (JID) | Get contact details |
| `checkContactExists` | `phone` (number only, no @c.us) | Check if phone is on WhatsApp |
| `getContactAbout` | `contactId` | Get contact's About/bio |
| `getContactPicture` | `contactId` | Get contact's profile picture |
| `blockContact` | `contactId` | Block a contact |
| `unblockContact` | `contactId` | Unblock a contact |

---

### Channels (Newsletters)

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `getChannels` | — | List followed channels |
| `createChannel` | `name`, `description?`, `picture?` | Create a channel |
| `getChannel` | `channelId` | Get channel details |
| `deleteChannel` | `channelId` | Delete a channel |
| `followChannel` | `channelId` | Follow a channel |
| `unfollowChannel` | `channelId` | Unfollow a channel |
| `muteChannel` | `channelId` | Mute a channel |
| `unmuteChannel` | `channelId` | Unmute a channel |
| `searchChannelsByText` | `query` | Search channels by name/text |
| `previewChannelMessages` | `channelId` | Preview channel messages |
| `searchChannelsByView` | `viewType` (e.g. `"RECOMMENDED"`) | Browse channels by view type |
| `getChannelSearchViews` | — | Get available view types |
| `getChannelSearchCountries` | — | Get available countries for channel search |
| `getChannelSearchCategories` | — | Get available categories for channel search |

---

### Labels

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `getLabels` | — | List all labels |
| `createLabel` | `name`, `color?` (int) | Create a label |
| `updateLabel` | `labelId`, `name?`, `color?` | Update a label |
| `deleteLabel` | `labelId` | Delete a label |
| `getChatLabels` | `chatId` | Get labels assigned to a chat |
| `setChatLabels` | `chatId`, `labels[]` ({id}) | Assign labels to a chat |
| `getChatsByLabel` | `labelId` | List chats with a given label |

---

### Status / Stories

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `sendTextStatus` | `text`, `backgroundColor?`, `font?` (int) | Post text status/story |
| `sendImageStatus` | `image` (URL), `caption?` | Post image status/story |
| `sendVoiceStatus` | `voice` (URL) | Post voice status/story |
| `sendVideoStatus` | `video` (URL), `caption?` | Post video status/story |
| `deleteStatus` | `id` | Delete a status/story |

---

### Presence

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `setPresenceStatus` | `status` (`"online"` \| `"offline"`) | Set online/offline presence |
| `getPresence` | `contactId` | Get a contact's presence |
| `subscribePresence` | `contactId` | Subscribe to a contact's presence updates |
| `getAllPresence` | — | Get presence for all subscribed contacts |

---

### Profile

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `getProfile` | — | Get own profile |
| `setProfileName` | `name` | Set profile name |
| `setProfileStatus` | `status` (text) | Set profile status |
| `setProfilePicture` | `file` (URL) | Set profile picture |
| `deleteProfilePicture` | — | Delete profile picture |

---

### LID Resolution

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `findPhoneByLid` | `lid` | Resolve LID to phone number |
| `findLidByPhone` | `phone` | Resolve phone to LID |
| `getAllLids` | — | Get all known LID mappings |

---

### Calls

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `rejectCall` | `callId` | Reject an incoming call |

---

### API Keys

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `createApiKey` | `name` | Create a new WAHA API key |
| `getApiKeys` | — | List all API keys |
| `updateApiKey` | `keyId`, `name?` | Update an API key |
| `deleteApiKey` | `keyId` | Delete an API key |

---

### Search / Discovery

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `search` | `query`, `scope` (`"group"` \| `"contact"` \| `"channel"` \| `"auto"`) | Fuzzy name-to-JID lookup — use this to find JIDs, list groups, contacts, or channels. **No target** — put query in parameters only. |
| `resolveTarget` | `query`, `type` (`"group"` \| `"contact"` \| `"channel"` \| `"auto"`) | Same as `search` in utility form |

---

### Policy (Admin Only)

| Action | Key Parameters | Description |
|--------|---------------|-------------|
| `editPolicy` | `scope` (`"contact"` \| `"group"`), `targetId`, `field`, `value`, `actorId` | Edit contact/group allow policy. actorId must be caller's stable JID. Manager-authorized only. |

---

## Slash Commands

Slash commands are intercepted **before** the LLM — no action call is needed. The sender must be in the admin authorization list (godModeSuperUsers or allowFrom).

| Command | Syntax | Description |
|---------|--------|-------------|
| `/join` | `/join <invite-link>` | Join a group via `chat.whatsapp.com/...` invite URL — bypass LLM entirely |
| `/join` | `/join <group-name>` | Fuzzy-match a group/channel by name and join. Ambiguous matches return a numbered candidate list for confirmation. |
| `/leave` | `/leave <group-or-channel-name>` | Fuzzy-match and leave a group or channel. Confirms before acting. |
| `/list` | `/list` | List all groups and channels the agent belongs to |
| `/list groups` | `/list groups` | List groups only |
| `/list channels` | `/list channels` | List channels/newsletters only |

**Notes:**
- Invite links (`chat.whatsapp.com/...`) are handled server-side — send the full URL
- Ambiguous `/join` or `/leave` matches return numbered options; reply with the number to confirm
- Unauthorized users receive "You are not authorized to use this command"

---

## Guidelines

- **Default to Omer's DM** (`972544329000@c.us`) unless a specific group is requested
- **Keep messages concise** — WhatsApp has a 4096 character limit per message
- **Wait 30-60 seconds** after sending to the bot's group before reading replies (AI processing time)
- **Never impersonate Omer** — only send as the bot session
- **Use `search` for discovery** — never pass a group/contact name as a target directly; use `search` with `scope` parameter to find JIDs first
- **Use for notifications** — task completion alerts, error reports, status updates
- **`readMessages` for LLM context** — returns lean format (6 fields); use `getChatMessages` only when you need raw WAHA fields
