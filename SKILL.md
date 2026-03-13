---
name: whatsapp-actions
description: Use when the user asks to send a WhatsApp message, create a poll, share a location, manage groups, send a contact card, forward a message, react to a message, pin a message, edit or delete a message, create an event, manage labels, post a status/story, manage channels, join a group, follow a channel, change profile, block/unblock contacts, or perform any WhatsApp action through WAHA.
version: 4.0.0
---

> **IMPORTANT — Standard Action Names**: For targeted actions (those that send to a chat), use these standard names:
> `poll` (create poll), `send` (send text/DM), `edit` (edit message), `unsend` (delete message), `pin`/`unpin`, `read` (mark read), `react` (add reaction).
> Do NOT use custom names like sendPoll, editMessage, deleteMessage — they will be rejected by the gateway.

# Quick Reference — Common Tasks

| Task | Action | Key Parameters |
|------|--------|---------------|
| Send text | `send` | text (via target resolution) |
| Send text to multiple chats | `sendMulti` | targets[], text |
| Send contact card | `send` | contacts: [{fullName, phoneNumber}] |
| Create poll | `poll` | name, options[], multipleAnswers |
| Send image | `sendImage` | chatId, file (direct URL), caption? |
| Send video | `sendVideo` | chatId, file (direct URL), caption? |
| Send document | `sendFile` | chatId, file (direct URL), caption? |
| Send link preview card | `sendLinkPreview` | chatId, url, title, description? |
| React to message | `react` | messageId, emoji |
| Join group via link | `joinGroup` | inviteCode (code from URL) |
| Follow channel | `followChannel` | channelId (newsletter JID) |
| Share location | `sendLocation` | chatId, latitude, longitude, title |
| Create group event | `sendEvent` | chatId, name, startTime |
| Mute a chat | `muteChat` | chatId, duration? |
| Unmute a chat | `unmuteChat` | chatId |
| Read recent messages | `readMessages` | chatId, limit? (1-50, default 10) |
| Search/list groups, contacts, channels | `search` | query, scope ("group"\|"contact"\|"channel"\|"auto") |

---

# Auto-Resolution (Preferred)

**You can use human-readable names directly as targets in send/poll/edit/unsend/pin/unpin/read.** The plugin automatically resolves names to JIDs via fuzzy matching.

Example: To send "hello world" to a group called "test group":
```
Action: send
Target: "test group"
Parameters: { "text": "hello world" }
```
The plugin will find the group JID and send the message. If the name is ambiguous, you'll get an error listing possible matches — ask the user which one they meant.

More examples:
```
Action: poll
Target: "sammie test group"
Parameters: { "name": "Favorite color?", "options": ["Red", "Blue", "Green"] }
```

```
Action: send
Target: "zeev nesher"
Parameters: { "text": "Hey Zeev!" }
```

## Searching & Listing (search action)

Use `search` to find groups, contacts, or channels by name. **This is a utility action — do NOT pass a target. Only use parameters.**

```
Action: search
Parameters: { "query": "hebrew", "scope": "group" }
```

**Parameters:**
- **query**: The name (or partial name) to search for. Empty string = list all.
- **scope**: What to search — `"group"`, `"contact"`, `"channel"`, or `"auto"` (searches all three)

**Returns:** `{ matches: [{jid, name, type, confidence}], query, searchedTypes }`

**Examples:**
```
Action: search
Parameters: { "query": "test group", "scope": "group" }
```
```
Action: search
Parameters: { "query": "zeev nesher", "scope": "contact" }
```
```
Action: search
Parameters: { "query": "", "scope": "group" }
```
(Empty query returns all groups — useful for "list all groups" or "find Hebrew groups".)

**CRITICAL RULES:**
- `search` does NOT accept a target. Pass query and scope as **parameters only**.
- If the user says "list all Hebrew groups", call `search` with `query: ""` and `scope: "group"`, then filter the results by Hebrew names.
- If multiple matches are returned with similar confidence, **ask the user** which one they meant.
- Results are sorted by confidence (highest first), limited to top 20 matches.
- `resolveTarget` is an alias for `search` — same rules apply (no target, parameters only).

---

# Sending Contact Cards (vCards)

Use the **`send`** action with a `contacts` parameter to share WhatsApp contact cards that recipients can save to their phone contacts.

**Preferred method** (uses gateway target resolution):
```
Action: send
Parameters: { "contacts": [{ "fullName": "John Doe", "phoneNumber": "972544329000" }] }
```

**Multiple contacts at once:**
```
Action: send
Parameters: { "contacts": [
  { "fullName": "John Doe", "phoneNumber": "972544329000" },
  { "fullName": "Jane Smith", "phoneNumber": "972509876543", "organization": "Acme Corp" }
] }
```

**Alternative** (utility action, requires explicit chatId):
```
Action: sendContactVcard
Parameters: { "chatId": "972XXXXXXXXX@c.us", "contacts": [{ "fullName": "John Doe", "phoneNumber": "972544329000" }] }
```

**Rules:**
- `phoneNumber`: Country code + number, **no + prefix**. Example: `972544329000`
- `fullName`: Required — the display name on the contact card
- `organization`: Optional — company/org name shown on the card
- Each contact becomes a proper WhatsApp vCard that recipients can tap to save

---

# Sending Media (Images, Videos, Documents)

## Sending Images
Use the `sendImage` action with a **direct image URL** (not a JSON API response):
```
Action: sendImage
Parameters: { "chatId": "<target>", "file": "https://example.com/actual-image.jpg", "caption": "optional caption" }
```

**IMPORTANT**: The `file` parameter must point to an actual image file (JPEG, PNG, GIF, WebP), NOT to an API endpoint that returns JSON. If you fetch an API that returns JSON with an image URL inside, extract the actual URL first.

## Sending Videos
Use the `sendVideo` action:
```
Action: sendVideo
Parameters: { "chatId": "<target>", "file": "https://example.com/video.mp4", "caption": "optional caption" }
```

## Sending Documents/Files
Use the `sendFile` action for PDFs, documents, and other non-media files:
```
Action: sendFile
Parameters: { "chatId": "<target>", "file": "https://example.com/document.pdf", "caption": "optional caption" }
```

## Media URL Rules
- **Direct URLs only**: Always use a URL that points directly to the media file
- **No API responses**: Never pass a JSON API response URL as media content
- **Supported image formats**: JPEG, PNG, GIF, WebP, BMP, SVG
- **Supported video formats**: MP4, WebM, MOV, AVI
- **For web images**: Use the direct image URL (right-click -> "Copy image address" equivalent)
- **Local files**: Use the full absolute path (e.g., `/tmp/openclaw/image.png`)
- **Alternative parameters**: `image`/`url` also accepted for sendImage; `video`/`url` for sendVideo; `url` for sendFile

---

# Joining Groups via Invite Link

Use the **`joinGroup`** action to join a WhatsApp group from an invite link.

```
Action: joinGroup
Parameters: { "inviteCode": "ABC123def456" }
```

**How to extract the invite code**: Take the part after `chat.whatsapp.com/` in the invite URL.
- Full URL: `https://chat.whatsapp.com/ABC123def456`
- Invite code: `ABC123def456`

---

# Following / Unfollowing Channels

Use **`followChannel`** to subscribe to a WhatsApp channel (newsletter), or **`unfollowChannel`** to unsubscribe.

```
Action: followChannel
Parameters: { "channelId": "120363...@newsletter" }

Action: unfollowChannel
Parameters: { "channelId": "120363...@newsletter" }
```

To discover channels first:
```
Action: searchChannelsByText
Parameters: { "query": "news" }

Action: getChannels
Parameters: {}
```

---

# WhatsApp Actions Reference

Full control of WhatsApp through the WAHA plugin's native action system. Use the `message` tool with actions to perform rich WhatsApp operations.

## Rich Messages

| Action | Parameters | Notes |
|--------|-----------|-------|
| `poll` | chatId, name, options[], multipleAnswers | Standard action with target resolution |
| `sendPollVote` | chatId, pollMessageId, votes[] | Vote on existing poll |
| `sendLocation` | chatId, latitude, longitude, title | Share GPS coordinates |
| `sendContactVcard` | chatId, contacts[{fullName, phoneNumber}] | Share contact cards |
| `sendList` | chatId, title, description, buttonText, sections[] | Interactive list |
| `forwardMessage` | chatId, messageId | Forward existing message |
| `sendLinkPreview` | chatId, url, title, description?, image? | URL preview card |
| `sendButtonsReply` | chatId, messageId, buttonId | Reply to button message |
| `sendEvent` | chatId, name, startTime, endTime?, description?, location? | Calendar event |
| `react` | messageId, emoji, remove? | Add/remove emoji reaction |

## Message Management

| Action | Parameters |
|--------|-----------|
| `edit` | chatId, messageId, text |
| `unsend` | chatId, messageId |
| `pin` | chatId, messageId |
| `unpin` | chatId, messageId |
| `starMessage` | chatId, messageId, star (boolean) |

## Chat Management

| Action | Parameters |
|--------|-----------|
| `getChats` | (none) |
| `getChatsOverview` | page?, limit? |
| `getChatMessages` | chatId, limit?, offset?, downloadMedia? |
| `getChatMessage` | chatId, messageId |
| `deleteChat` | chatId |
| `clearChatMessages` | chatId |
| `archiveChat` | chatId |
| `unarchiveChat` | chatId |
| `unreadChat` | chatId |
| `read` | chatId |
| `getChatPicture` | chatId |
| `muteChat` | chatId, duration? (seconds) |
| `unmuteChat` | chatId |
| `readMessages` | chatId, limit? (1-50, default 10) |
| `sendMulti` | targets[], text |

## Group Management

| Action | Parameters |
|--------|-----------|
| `createGroup` | name, participants[] |
| `getGroups` | (none) |
| `getGroup` | groupId |
| `deleteGroup` | groupId |
| `leaveGroup` | groupId |
| `joinGroup` | inviteCode |
| `setGroupSubject` | groupId, subject |
| `setGroupDescription` | groupId, description |
| `setGroupPicture` | groupId, file |
| `deleteGroupPicture` | groupId |
| `getGroupPicture` | groupId |
| `addParticipants` | groupId, participants[] |
| `removeParticipants` | groupId, participants[] |
| `promoteToAdmin` | groupId, participants[] |
| `demoteFromAdmin` | groupId, participants[] |
| `getParticipants` | groupId |
| `setInfoAdminOnly` | groupId, adminOnly |
| `getInfoAdminOnly` | groupId |
| `setMessagesAdminOnly` | groupId, adminOnly |
| `getMessagesAdminOnly` | groupId |
| `getInviteCode` | groupId |
| `revokeInviteCode` | groupId |
| `getGroupsCount` | (none) |

## Contacts

| Action | Parameters |
|--------|-----------|
| `getContacts` | (none) |
| `getContact` | contactId |
| `checkContactExists` | phone |
| `getContactAbout` | contactId |
| `getContactPicture` | contactId |
| `blockContact` | contactId |
| `unblockContact` | contactId |

## Labels

| Action | Parameters |
|--------|-----------|
| `getLabels` | (none) |
| `createLabel` | name, color? |
| `updateLabel` | labelId, name?, color? |
| `deleteLabel` | labelId |
| `getChatLabels` | chatId |
| `setChatLabels` | chatId, labels[{id}] |
| `getChatsByLabel` | labelId |

## Status/Stories

| Action | Parameters |
|--------|-----------|
| `sendTextStatus` | text, backgroundColor?, font? |
| `sendImageStatus` | image, caption? |
| `sendVoiceStatus` | voice |
| `sendVideoStatus` | video, caption? |
| `deleteStatus` | id |

## Channels (WhatsApp Channels / Newsletters)

| Action | Parameters |
|--------|-----------|
| `getChannels` | (none) |
| `createChannel` | name, description?, picture? |
| `getChannel` | channelId |
| `deleteChannel` | channelId |
| `followChannel` | channelId |
| `unfollowChannel` | channelId |
| `muteChannel` | channelId |
| `unmuteChannel` | channelId |
| `searchChannelsByText` | query |
| `previewChannelMessages` | channelId |

## Presence

| Action | Parameters |
|--------|-----------|
| `setPresenceStatus` | status ("online" or "offline") |
| `getPresence` | contactId |
| `subscribePresence` | contactId |

## Profile

| Action | Parameters |
|--------|-----------|
| `getProfile` | (none) |
| `setProfileName` | name |
| `setProfileStatus` | status |
| `setProfilePicture` | file |
| `deleteProfilePicture` | (none) |

## LID (Linked Device IDs)

| Action | Parameters |
|--------|-----------|
| `findPhoneByLid` | lid |
| `findLidByPhone` | phone |
| `getAllLids` | (none) |

## Calls

| Action | Parameters |
|--------|-----------|
| `rejectCall` | callId |

## Parameter Formats
- **chatId**: `"972XXXXXXXXX@c.us"` (DM) or `"120363...@g.us"` (group) or `"...@newsletter"` (channel)
- **Phone numbers**: Country code + number, no +. Example: `"972544329000"`
- **messageId**: Full serialized format: `true_chatId_shortMsgId` or `false_chatId_shortMsgId`
- **groupId**: Same as chatId for groups: `"120363...@g.us"`
- **channelId**: Newsletter JID: `"120363...@newsletter"`

## Known Engine Behaviors
- NOWEB engine drops >95% of poll.vote webhook events (votes may not trigger webhooks reliably)
- sendButtons is deprecated — use polls or lists for interactive options
- pinMessage and sendTextStatus may behave differently across WAHA builds
- Event RSVPs arrive as `[event_rsvp]` messages

---

# Error Handling and Recovery

When actions fail, use the table below to diagnose the issue and recover.

| Error Pattern | What Happened | What To Do |
|---------------|---------------|------------|
| `"Session '...' has sub-role 'listener' and cannot send"` | Bot tried to send from a listener session (monitoring-only) | Use the bot session — listener sessions only receive messages, they cannot send |
| `"Could not resolve '...' to a WhatsApp JID"` | Target name not found in contacts or groups directory | Run `search` action first to find the correct JID, then retry with the exact JID |
| `"Ambiguous target '...'. Possible matches: ..."` | Multiple contacts/groups match the given name | Disambiguate: ask the user which one, or use the exact JID from `search` results |
| `"WAHA API rate limited (429)"` | Too many requests sent in a short window | Wait ~1 second before retrying. The plugin retries up to 3 times automatically with exponential backoff (1s / 2s / 4s) — if you see this, the auto-retry already occurred |
| `"timed out after 30000ms"` | WAHA server did not respond within 30 seconds | Check WAHA health via the admin panel Status tab. Note: for mutation operations (send, edit, delete) the action may have already succeeded even if the response timed out |
| `"Session health: unhealthy"` | WAHA session has lost its WhatsApp connection | Reconnect the session in the WAHA dashboard or admin panel. No messages will be processed until the session is healthy again |

**General guidance:**
- If a send action fails unexpectedly, check whether the target is a valid JID using `search` first.
- If multiple consecutive actions fail, check the admin panel Status tab for session health.
- If you see many timeouts, WAHA may be overloaded — wait a few seconds between actions.

---

# Rate Limiting

The plugin uses a token-bucket rate limiter to protect WAHA from being overwhelmed.

**How it works:**
- Default capacity: 20 tokens, refill rate: 15 tokens/second
- Each WAHA API call consumes one token
- When tokens run out, calls are queued and released as tokens refill
- If WAHA returns HTTP 429 (Too Many Requests), the plugin applies exponential backoff: 1s wait, then 2s, then 4s — up to 3 automatic retries

**Configurable** (in `channels.waha` config):
- `rateLimitCapacity`: Maximum burst size (default 20)
- `rateLimitRefillRate`: Tokens refilled per second (default 15)

**For you (the agent):**
- Most rate limiting is handled automatically — you do not need to add delays between actions
- If you see persistent 429 errors after the auto-retries, wait 5-10 seconds before retrying
- Rapid bulk operations (like sending to 20 groups in a loop) may hit rate limits; use `sendMulti` for multi-recipient sends instead

---

# Multi-Session

The plugin supports multiple WhatsApp sessions with different roles, enabling a monitored human session alongside a bot session.

## Session Roles

| Role | Sub-Role | Can Send? | Receives Messages? | Purpose |
|------|----------|-----------|-------------------|---------|
| `bot` | `full-access` | Yes | Yes (all chats) | Primary bot session — Sammie's active session |
| `human` | `listener` | No | Yes (monitored chats) | Human operator's session — monitored but cannot send |
| `human` | `full-access` | Yes | Yes | Human session with full access |

**Key rule:** Only `full-access` sub-role sessions can send messages. Attempting to send from a `listener` session will fail with an error.

## Trigger Word Activation

When `triggerWord` is configured (e.g., `"!sammie"`), the bot only activates in group chats when a message starts with that trigger word.

**Example:** If `triggerWord: "!sammie"`, only messages like `"!sammie what's the weather?"` will activate the bot. Other group messages are monitored but ignored.

```
User in group: "!sammie what time is the meeting?"
Bot activates → processes and replies via DM (triggerResponseMode: "dm") or in-group
```

**`triggerResponseMode` options:**
- `"dm"` (default): Bot sends its reply as a DM to the triggering user
- `"group"`: Bot replies in the group chat directly

## readMessages Action

Use `readMessages` to retrieve recent messages from a monitored chat.

```
Action: readMessages
Parameters: { "chatId": "120363421825201386@g.us", "limit": 20 }
```

**Parameters:**
- `chatId`: The JID of the chat to read from
- `limit`: Number of recent messages to fetch (1-50, default 10)

**Returns:** Array of recent messages with sender, text, timestamp, and message type.

**Use cases:**
- Check what's been said in a group since last check
- Get context before replying to a thread
- Monitor a human session's conversation history

## Cross-Session Routing

When the bot needs to send a message to a group it belongs to via its own session, it uses that session directly. If the bot is not a member of the target group, it falls back to using the human session as a proxy.

This is automatic — you do not need to specify which session to use for sends.
