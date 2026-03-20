---
name: whatsapp-actions
description: Use when the user asks to send a WhatsApp message, create a poll, share a location, manage groups, send a contact card, forward a message, react to a message, pin a message, edit or delete a message, create an event, manage labels, post a status/story, manage channels, join a group, follow a channel, change profile, block/unblock contacts, or perform any WhatsApp action through WAHA.
version: 4.0.0
---

> **IMPORTANT — Standard Action Names**: For targeted actions, use: `poll`, `send`, `edit`, `unsend`, `pin`/`unpin`, `read`, `react`. Do NOT use custom names like sendPoll, editMessage — they will be rejected.

# Quick Reference

| Task | Action | Key Parameters |
|------|--------|---------------|
| Send text | `send` | text (via target resolution) |
| Send to multiple chats | `sendMulti` | recipients[], text |
| Send contact card | `send` | contacts: [{fullName, phoneNumber}] |
| Create poll | `poll` | name, options[], multipleAnswers |
| Send image | `sendImage` | chatId, file (direct URL), caption? |
| Send video | `sendVideo` | chatId, file (direct URL), caption? |
| Send document | `sendFile` | chatId, file (direct URL), caption? |
| Send link preview | `sendLinkPreview` | chatId, url, title, description? |
| React to message | `react` | messageId, emoji |
| Join group | `joinGroup` | inviteCode (part after chat.whatsapp.com/) |
| Follow channel | `followChannel` | channelId (newsletter JID) |
| Unfollow channel | `unfollowChannel` | channelId |
| Share location | `sendLocation` | chatId, latitude, longitude, title |
| Create group event | `sendEvent` | chatId, name, startTime |
| Mute/unmute chat | `muteChat`/`unmuteChat` | chatId, duration? |
| Read recent messages | `readMessages` | chatId, limit? (1-50, default 10) |
| Search/list | `search` | query, scope ("group"\|"contact"\|"channel"\|"auto") |
| Discover channels | `searchChannelsByText` / `getChannels` | query / (none) |

---

# Auto-Resolution (Preferred)

Use human-readable names directly as targets in send/poll/edit/unsend/pin/unpin/read. The plugin fuzzy-matches names to JIDs automatically.

```
Action: send  |  Target: "test group"  |  Parameters: { "text": "hello world" }
Action: poll  |  Target: "test group"  |  Parameters: { "name": "Favorite color?", "options": ["Red", "Blue", "Green"] }
Action: send  |  Target: "zeev nesher" |  Parameters: { "text": "Hey Zeev!" }
```

If the name is ambiguous, you'll get an error listing possible matches — ask the user which one they meant.

## search Action

Use `search` to find groups, contacts, or channels by name. **No target — parameters only.**

```
Action: search
Parameters: { "query": "test group", "scope": "group" }
```

- `query`: Name or partial name. Empty string = list all.
- `scope`: `"group"`, `"contact"`, `"channel"`, or `"auto"` (all three)
- Returns: `{ matches: [{jid, name, type, confidence}], query, searchedTypes }`
- `resolveTarget` is an alias for `search` — same rules apply.

**CRITICAL:** `search` does NOT accept a target. If user says "list all Hebrew groups", search with `query: ""`, `scope: "group"`, then filter results. Multiple matches with similar confidence → ask the user.

---

# Sending Contact Cards (vCards)

Use `send` with `contacts` parameter (preferred, uses target resolution):
```
Action: send
Parameters: { "contacts": [{ "fullName": "John Doe", "phoneNumber": "972544329000" }] }
```
Multiple contacts: add more objects to the array. Optional field: `organization`.
Alternative: `sendContactVcard` action (requires explicit chatId).
**Rule:** `phoneNumber` uses country code + number, **no + prefix**.

---

# Sending Media

| Action | Use For | Parameters |
|--------|---------|-----------|
| `sendImage` | JPEG, PNG, GIF, WebP | chatId, file, caption? |
| `sendVideo` | MP4, WebM, MOV, AVI | chatId, file, caption? |
| `sendFile` | PDFs, documents, other | chatId, file, caption? |

**IMPORTANT:** `file` must be a direct media URL (not a JSON API endpoint). Extract the actual URL if fetching from an API. Local files: use absolute path (e.g., `/tmp/openclaw/image.png`). Alternative param names: `image`/`url` for sendImage, `video`/`url` for sendVideo, `url` for sendFile.

---

# WhatsApp Actions Reference

## Rich Messages

| Action | Parameters | Notes |
|--------|-----------|-------|
| `poll` | chatId, name, options[], multipleAnswers | Standard action w/ target resolution |
| `sendPollVote` | chatId, pollMessageId, votes[] | Vote on existing poll |
| `sendLocation` | chatId, latitude, longitude, title | |
| `sendContactVcard` | chatId, contacts[{fullName, phoneNumber}] | |
| `sendList` | chatId, title, description, buttonText, sections[] | |
| `forwardMessage` | chatId, messageId | |
| `sendLinkPreview` | chatId, url, title, description?, image? | |
| `sendButtonsReply` | chatId, messageId, buttonId | |
| `sendEvent` | chatId, name, startTime, endTime?, description?, location? | |
| `react` | messageId, emoji, remove? | |

## Message Management

| Action | Parameters |
|--------|-----------|
| `edit` | chatId, messageId, text |
| `unsend` | chatId, messageId |
| `pin` / `unpin` | chatId, messageId |
| `starMessage` | chatId, messageId, star (boolean) |

## Chat Management

| Action | Parameters |
|--------|-----------|
| `getChats` / `getChatsOverview` | (none) / page?, limit? |
| `getChatMessages` | chatId, limit?, offset?, downloadMedia? |
| `getChatMessage` | chatId, messageId |
| `deleteChat` / `clearChatMessages` | chatId |
| `archiveChat` / `unarchiveChat` | chatId |
| `read` / `unreadChat` | chatId |
| `getChatPicture` | chatId |
| `muteChat` | chatId, duration? (seconds) |
| `unmuteChat` | chatId |
| `readMessages` | chatId, limit? (1-50, default 10) |
| `sendMulti` | recipients[], text |

## Group Management

| Action | Parameters |
|--------|-----------|
| `createGroup` | name, participants[] |
| `getGroups` / `getGroupsCount` | (none) |
| `getGroup` | groupId |
| `deleteGroup` / `leaveGroup` | groupId |
| `joinGroup` | inviteCode |
| `setGroupSubject` | groupId, subject |
| `setGroupDescription` | groupId, description |
| `setGroupPicture` / `deleteGroupPicture` / `getGroupPicture` | groupId, file? |
| `addParticipants` / `removeParticipants` | groupId, participants[] |
| `promoteToAdmin` / `demoteFromAdmin` | groupId, participants[] |
| `getParticipants` | groupId |
| `setInfoAdminOnly` / `getInfoAdminOnly` | groupId, adminOnly? |
| `setMessagesAdminOnly` / `getMessagesAdminOnly` | groupId, adminOnly? |
| `getInviteCode` / `revokeInviteCode` | groupId |

## Contacts

| Action | Parameters |
|--------|-----------|
| `getContacts` | (none) |
| `getContact` / `getContactAbout` / `getContactPicture` | contactId |
| `checkContactExists` | phone |
| `blockContact` / `unblockContact` | contactId |

## Labels

| Action | Parameters |
|--------|-----------|
| `getLabels` | (none) |
| `createLabel` | name, color? |
| `updateLabel` | labelId, name?, color? |
| `deleteLabel` | labelId |
| `getChatLabels` / `setChatLabels` | chatId, labels[{id}]? |
| `getChatsByLabel` | labelId |

## Status/Stories

| Action | Parameters |
|--------|-----------|
| `sendTextStatus` | text, backgroundColor?, font? |
| `sendImageStatus` / `sendVideoStatus` | image/video, caption? |
| `sendVoiceStatus` | voice |
| `deleteStatus` | id |

## Channels (Newsletters)

| Action | Parameters |
|--------|-----------|
| `getChannels` / `getChannel` | (none) / channelId |
| `createChannel` | name, description?, picture? |
| `deleteChannel` / `followChannel` / `unfollowChannel` | channelId |
| `muteChannel` / `unmuteChannel` | channelId |
| `searchChannelsByText` | query |
| `previewChannelMessages` | channelId |

## Presence & Profile

| Action | Parameters |
|--------|-----------|
| `setPresenceStatus` | status ("online"/"offline") |
| `getPresence` / `subscribePresence` | contactId |
| `getProfile` / `deleteProfilePicture` | (none) |
| `setProfileName` | name |
| `setProfileStatus` | status |
| `setProfilePicture` | file |

## LID & Calls

| Action | Parameters |
|--------|-----------|
| `findPhoneByLid` | lid |
| `findLidByPhone` | phone |
| `getAllLids` | (none) |
| `rejectCall` | callId |

## Parameter Formats
- **chatId**: `"972XXXXXXXXX@c.us"` (DM), `"120363...@g.us"` (group), `"...@newsletter"` (channel)
- **Phone numbers**: Country code + number, no +. Example: `"972544329000"`
- **messageId**: Full serialized: `true_chatId_shortMsgId` or `false_chatId_shortMsgId`
- **groupId**: Same as group chatId. **channelId**: Newsletter JID.

## Known Engine Behaviors
- NOWEB engine drops >95% of poll.vote webhook events
- sendButtons is deprecated — use polls or lists instead
- Event RSVPs arrive as `[event_rsvp]` messages

---

# Error Handling and Recovery

| Error Pattern | Cause | Recovery |
|---------------|-------|----------|
| `"Session '...' has sub-role 'listener' and cannot send"` | Sent from listener session | Use the bot session — listeners are receive-only |
| `"Could not resolve '...' to a WhatsApp JID"` | Name not found | Run `search` first, retry with exact JID |
| `"Ambiguous target '...'. Possible matches: ..."` | Multiple matches | Ask user which one, or use exact JID |
| `"WAHA API rate limited (429)"` | Too many requests | Plugin auto-retries 3x with backoff (1s/2s/4s). If still failing, wait 5-10s |
| `"timed out after 30000ms"` | WAHA unresponsive | Check admin panel Status tab. Mutation ops may have succeeded despite timeout |
| `"Session health: unhealthy"` | WhatsApp disconnected | Reconnect in WAHA dashboard. No messages processed until healthy |

**General:** Failed sends → verify JID with `search`. Multiple failures → check Status tab. Many timeouts → space out actions.

---

# Rate Limiting

Token-bucket rate limiter: 20 tokens capacity, 15 tokens/sec refill. Each API call = 1 token. Overflow is queued. HTTP 429 triggers auto-retry with exponential backoff (1s/2s/4s, 3 attempts).

Config: `rateLimitCapacity` (default 20), `rateLimitRefillRate` (default 15) in `channels.waha`.

**For the agent:** Rate limiting is automatic. No delays needed between actions. For bulk sends, use `sendMulti` instead of looping.

---

# Multi-Session

## Session Roles

| Role | Sub-Role | Sends? | Receives? | Purpose |
|------|----------|--------|-----------|---------|
| `bot` | `full-access` | Yes | All chats | AI agent's active session |
| `human` | `listener` | No | Monitored chats | Monitor-only human session |
| `human` | `full-access` | Yes | Yes | Human session with send access |

**Key rule:** Only `full-access` sessions can send. `listener` sessions fail with an error on send attempts.

## Trigger Word Activation

When `triggerWord` is configured (e.g., `"!bot"`), the bot only activates in groups when a message starts with that word. `triggerResponseMode`: `"dm"` (default, replies via DM) or `"group"` (replies in-group).

## readMessages

**IMPORTANT:** `readMessages` does NOT accept a target — pass chat as `chatId` parameter. Use `search` to find JIDs by name.

```
Action: readMessages
Parameters: { "chatId": "120363421825201386@g.us", "limit": 20 }
```

Returns array of recent messages with sender, text, timestamp, type.

## Cross-Session Routing

Automatic — the bot uses its own session for groups it belongs to, falls back to human session as proxy otherwise. No manual session selection needed.
