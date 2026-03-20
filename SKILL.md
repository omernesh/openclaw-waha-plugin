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
| `getGroupJoinInfo` | groupId — preview group details before joining via invite link |
| `refreshGroups` | (none) — force-refresh groups list from WAHA server |
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
| `searchChannelsByView` | viewType (e.g. "RECOMMENDED") — search channels by view criteria |
| `getChannelSearchViews` | (none) — list available view types for channel search |
| `getChannelSearchCountries` | (none) — list countries for channel search filter |
| `getChannelSearchCategories` | (none) — list categories for channel search filter |
| `previewChannelMessages` | channelId |

## Presence & Profile

| Action | Parameters |
|--------|-----------|
| `setPresenceStatus` | status ("online"/"offline") |
| `getPresence` / `subscribePresence` | contactId |
| `getAllPresence` | (none) — get presence status for all subscribed contacts at once |
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

---

# Access Control & Policies

## DM Policy

Controls who can message the bot in direct messages.

| Mode | Behavior |
|------|----------|
| `pairing` | Default. Unknown senders receive a pairing code challenge. |
| `allowlist` | Only contacts in `allowFrom` can message. Others are silently blocked. |
| `open` | Anyone can message. Requires `allowFrom: ["*"]`. |
| `disabled` | All DMs blocked. |

## Group Policy

Two independent layers control group inbound messages:

1. **Group membership allowlist** (`allowedGroups`) — which groups the bot listens to
2. **Group sender policy** (`groupPolicy` + `groupAllowFrom`) — who within allowed groups can trigger the bot

| `groupPolicy` | Behavior |
|----------------|----------|
| `open` | Sender allowlist bypassed — anyone in allowed groups can trigger the bot |
| `allowlist` | Sender must be in `groupAllowFrom` |
| `disabled` | All group inbound blocked |

## God Mode

Superusers bypass all DM and group filters. Configured via `godModeSuperUsers` in config (list of JIDs). Messages from superusers are always processed regardless of policy settings.

## Can Initiate

Controls whether the bot can start new conversations (send first message to contacts it hasn't talked to before).

- `canInitiateGlobal`: default setting for all contacts
- Per-contact overrides available in the directory

---

# Group Activation & Mentions

## Activation Modes

| Mode | Behavior |
|------|----------|
| `mention` | Default. Bot only replies when explicitly mentioned or replied to. |
| `always` | Bot evaluates every message in the group. |

## Mention Detection

The bot considers itself "mentioned" when any of these are true:
- Explicit WhatsApp @mention of the bot's number
- Message matches a configured mention regex pattern (e.g., "sammie", "bot")
- Message is a reply to a previous bot message

## `/activation` Command

Owner-only command sent in a group to switch between `mention` and `always` modes. Takes effect immediately for that group.

## Group Context

Group messages include additional context fields injected into the conversation:
- `ChatType=group` — identifies this as a group conversation
- `GroupSubject` — the group name
- `GroupMembers` — list of participants
- `WasMentioned` — whether the bot was mentioned in this message

## Pending History

On the bot's first turn in a group conversation, up to 50 recent messages are injected as context so the bot understands the ongoing discussion.

---

# Message Delivery Behavior

## Text Chunking

Messages exceeding `textChunkLimit` (default 4000 characters) are automatically split into multiple WhatsApp messages.

| `chunkMode` | Behavior |
|-------------|----------|
| `length` | Split at the character limit |
| `newline` | Split at newline boundaries near the limit |

## Debouncing

Rapid consecutive incoming messages are batched into a single turn to avoid fragmented responses.

- Default debounce window: 5000ms for WhatsApp
- Media/attachments flush immediately (no debounce)
- Control commands (like `/activation`) bypass debouncing

## Read Receipts

Sent automatically by default. Skipped for self-chat (messages to yourself).

## Ack Reactions

Configurable emoji reaction (e.g., eyes emoji) sent when a message is received, confirming the bot saw it.

- Can be configured separately for DM and group contexts
- Group ack modes: `"always"` | `"mentions"` | `"never"`

## Media Handling

- **Voice notes**: `audio/ogg` is automatically rewritten to `audio/ogg; codecs=opus` for proper voice bubble display in WhatsApp
- **GIF playback**: Videos sent with `gifPlayback: true` display as animated GIFs
- **Media size limit**: `mediaMaxMb` default 50MB, per-account overrides available

---

# Broadcast Groups

Multiple agents can process the same incoming message simultaneously.

- Configured in the top-level `broadcast` config section
- Each agent has its own isolated session, conversation history, workspace, tools, and memory
- Broadcast evaluation happens after channel allowlists and group activation checks
- Currently a WhatsApp-only feature

---

# Pairing Flow

When `dmPolicy` is set to `pairing`, unknown contacts receive a pairing challenge instead of being silently blocked.

- Pairing codes: 8 characters, uppercase alphanumeric
- Codes expire after 1 hour
- Maximum 3 pending pairing requests per channel at a time
- After successful pairing, the contact is automatically added to `allowFrom`
- Account-scoped: non-default accounts maintain separate pairing state

---

# Session Keys & Routing

## Session Key Format

| Context | Session Key Pattern |
|---------|-------------------|
| DM | `agent:<agentId>:main` (all DMs collapsed into one session) |
| Group | `agent:<agentId>:whatsapp:group:<groupJid>` (isolated per group) |

Each group maintains its own conversation history and context, separate from DMs and other groups.

## Agent Routing Priority

When a message arrives, the system determines which agent handles it using this priority:

1. Exact peer match (specific contact assigned to specific agent)
2. Parent peer match
3. Account match
4. Channel match
5. Default agent

---

# /shutup and /unshutup Commands

Owner-only commands to mute/unmute the bot in groups.

| Command | Behavior |
|---------|----------|
| `/shutup` | Interactive flow: pick groups from a list, set mute duration |
| `/unshutup` | Unmute the bot in selected groups |

- Muted groups are stored persistently (survives restarts)
- While muted, the bot ignores all messages in that group (including mentions)
- When the bot sends messages on behalf of a human session, messages are prefixed with a robot emoji to distinguish them from human messages
