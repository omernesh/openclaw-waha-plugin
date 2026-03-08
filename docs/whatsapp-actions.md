# WhatsApp Actions Reference

You have full control of WhatsApp through WAHA API actions. Use these to send rich messages, manage groups, handle contacts, and more.

## Rich Messages

| Action | When to use | Key params |
|--------|-------------|------------|
| sendPoll | User asks to create a poll or you want group input | chatId, name, options[], multipleAnswers |
| sendPollVote | You want to vote on a poll someone sent | chatId, pollMessageId, votes[] |
| sendLocation | User asks "where is X?" or you want to share a place | chatId, latitude, longitude, title |
| sendContactVcard | User asks to share someone's contact | chatId, contacts[{fullName, phoneNumber}] |
| sendList | Present options as an interactive WhatsApp list | chatId, title, description, buttonText, sections[] |
| forwardMessage | User asks to forward a message somewhere | chatId, messageId |
| sendLinkPreview | Share a URL with custom preview | chatId, url, title |
| sendEvent | User asks to schedule/create an event | chatId, name, startTime (unix sec), endTime, location |

### Location: Geocoding with Nominatim
When sending a location, first geocode the place name:
```
GET https://nominatim.openstreetmap.org/search?q={place}&format=json&limit=1
```
Use the returned lat/lon in sendLocation. Set title to the place name.

### Polls: Reading Inbound
Inbound polls appear as: `[poll] "Question" Options: 1) A  2) B  Multiple answers: no`
To vote, use the pollMessageId from the message.

## Message Management

| Action | When to use |
|--------|-------------|
| editMessage | Fix a typo in a message you sent |
| deleteMessage | Unsend/retract a message |
| pinMessage | Pin important message in chat |
| unpinMessage | Unpin a previously pinned message |
| starMessage | Star/bookmark a message |
| react | Add emoji reaction to a message |

## Group Admin

| Action | When to use |
|--------|-------------|
| createGroup | User asks to create a WhatsApp group |
| setGroupSubject | Change group name |
| setGroupDescription | Change group description |
| addParticipants | Add people to a group |
| removeParticipants | Remove people from a group |
| promoteToAdmin | Make someone a group admin |
| demoteFromAdmin | Remove admin privileges |
| setInfoAdminOnly | Lock group info editing to admins |
| setMessagesAdminOnly | Make group announcement-only |
| getInviteCode | Get group invite link to share |
| revokeInviteCode | Invalidate current invite link |
| getParticipants | List all group members |

## Contacts

| Action | When to use |
|--------|-------------|
| checkContactExists | Verify if a phone number is on WhatsApp |
| getContact | Get contact info |
| blockContact | Block a contact |
| unblockContact | Unblock a contact |

## Labels

| Action | When to use |
|--------|-------------|
| getLabels | List all WhatsApp labels |
| createLabel | Create a new label |
| setChatLabels | Assign labels to a chat |
| getChatsByLabel | Find all chats with a specific label |

## Status/Stories

| Action | When to use |
|--------|-------------|
| sendTextStatus | Post a text WhatsApp status |
| sendImageStatus | Post an image status |
| sendVideoStatus | Post a video status |
| deleteStatus | Remove a posted status |

## Channels/Newsletters

| Action | When to use |
|--------|-------------|
| createChannel | Create a WhatsApp newsletter |
| followChannel / unfollowChannel | Follow/unfollow a channel |
| searchChannelsByText | Search for channels |

## Profile

| Action | When to use |
|--------|-------------|
| setProfileName | Change WhatsApp display name |
| setProfileStatus | Change "About" text |
| setProfilePicture | Change profile picture |

## Parameter Formats
- **chatId**: `"972XXXXXXXXX@c.us"` (DM) or `"120363...@g.us"` (group) or `"...@newsletter"` (channel)
- **Phone numbers**: Country code + number, no +. Example: `"972544329000"`
- **Timestamps**: Unix seconds (not milliseconds)
- **Files**: HTTP URL or base64 string
- **messageId**: The ID from the message you're referencing (e.g., `"true_972...@c.us_AAAA..."`)

## Important Notes
- NOWEB engine drops >95% of poll.vote events — you may not see most votes
- sendButtons is deprecated — use sendList for interactive options
- Event RSVPs arrive as `[event_rsvp]` messages
- Always use the chatId from the current conversation context
