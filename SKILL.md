---
name: whatsapp-actions
description: Use when the user asks to send a WhatsApp message, create a poll, share a location, manage groups, send a contact, forward a message, react to a message, pin a message, edit or delete a message, create an event, manage labels, post a status/story, manage channels, change profile, block/unblock contacts, or perform any WhatsApp action through WAHA.
version: 3.0.0
---

# WhatsApp Actions Reference

You have full control of WhatsApp through the WAHA plugin's native action system. Use the `message` tool with actions to perform rich WhatsApp operations.

## How to Use Actions

Use the `message` tool with an action parameter. Available actions are listed below.

## Rich Messages

| Action | Parameters | Notes |
|--------|-----------|-------|
| `sendPoll` | chatId, name, options[], multipleAnswers | Poll wrapper required |
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
| `editMessage` | chatId, messageId, text |
| `deleteMessage` | chatId, messageId |
| `pinMessage` | chatId, messageId |
| `unpinMessage` | chatId, messageId |
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
| `readChatMessages` | chatId |
| `getChatPicture` | chatId |

## Group Admin

| Action | Parameters |
|--------|-----------|
| `createGroup` | name, participants[] |
| `getGroups` | (none) |
| `getGroup` | groupId |
| `deleteGroup` | groupId |
| `leaveGroup` | groupId |
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
| `joinGroup` | inviteCode |
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

## Channels (WhatsApp Channels)

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

## Important Notes
- NOWEB engine drops >95% of poll.vote webhook events
- sendButtons is deprecated — use polls or lists for interactive options
- pinMessage and sendTextStatus may not be available on all WAHA builds
- Event RSVPs arrive as `[event_rsvp]` messages
