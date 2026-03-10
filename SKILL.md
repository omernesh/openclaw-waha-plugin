---
name: whatsapp-actions
description: Use when the user asks to send a WhatsApp message, create a poll, share a location, manage groups, send a contact card, forward a message, react to a message, pin a message, edit or delete a message, create an event, manage labels, post a status/story, manage channels, join a group, follow a channel, change profile, block/unblock contacts, or perform any WhatsApp action through WAHA.
version: 3.1.0
---

> **IMPORTANT — Standard Action Names**: For targeted actions (those that send to a chat), use these standard names:
> `poll` (create poll), `send` (send text/DM), `edit` (edit message), `unsend` (delete message), `pin`/`unpin`, `read` (mark read), `react` (add reaction).
> Do NOT use custom names like sendPoll, editMessage, deleteMessage — they will be rejected by the gateway.

# Quick Reference — Common Tasks

| Task | Action | Key Parameters |
|------|--------|---------------|
| Send text | `send` | text (via target resolution) |
| Send contact card | `send` | contacts: [{fullName, phoneNumber}] |
| Create poll | `poll` | name, options[], multipleAnswers |
| Send image | `sendImage` | chatId, file (direct URL), caption? |
| Send video | `sendVideo` | chatId, file (direct URL), caption? |
| Send document | `sendFile` | chatId, file (direct URL), caption? |
| React to message | `react` | messageId, emoji |
| Join group via link | `joinGroup` | inviteCode (code from URL) |
| Follow channel | `followChannel` | channelId (newsletter JID) |
| Share location | `sendLocation` | chatId, latitude, longitude, title |
| Create group event | `sendEvent` | chatId, name, startTime |

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
