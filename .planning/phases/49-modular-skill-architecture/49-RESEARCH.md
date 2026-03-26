# Phase 49: Modular Skill Architecture - Research

**Researched:** 2026-03-26
**Domain:** Documentation / Skill file architecture
**Confidence:** HIGH

## Summary

Phase 49 is a pure documentation restructure. The single `SKILL.md` file (574 lines, ~6KB) becomes a concise index plus 10 per-category instruction files. No code changes. No deployment. No test infrastructure required.

The current `SKILL.md` already contains all the correct action names, parameters, and gotchas — it just needs to be split into consumable per-category chunks. The primary risk is forgetting actions that appear only in UTILITY_ACTIONS but not in the current SKILL.md tables (newly added ACT-01 through ACT-07 actions from Phase 48).

**Primary recommendation:** Split SKILL.md into an index + 10 category files, co-locating each file with `SKILL.md` (i.e., in the repo root alongside it). The index becomes the agent's entry point; category files are the detailed references.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- SKILL.md split into 10 per-category files: groups.md, contacts.md, channels.md, chats.md, status.md, presence.md, profile.md, media.md, messaging.md, slash-commands.md
- Referenced from a concise index SKILL.md

### Claude's Discretion
All implementation choices are at Claude's discretion — documentation/infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions. vCard (.vcf) and iCal (.ics) file-based approaches must be documented in contacts.md and messaging.md respectively.

### Deferred Ideas (OUT OF SCOPE)
None — documentation phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SKL-01 | SKILL.md restructured as concise index referencing per-category instruction files | Current SKILL.md is 574 lines — index should be ~60-80 lines with category links and a quick-start section |
| SKL-02 | Per-category files created: groups.md, contacts.md, channels.md, chats.md, status.md, presence.md, profile.md, media.md, messaging.md, slash-commands.md | All action data inventoried below |
| SKL-03 | Each sub-file has action table with parameters, task-oriented examples, and gotchas section | Action inventory below maps each category's gotchas |
| SKL-07 | Document vCard (.vcf) and iCal (.ics) file-based approaches in contacts.md and messaging.md | vCard: send via sendFile with .vcf path; iCal: send via sendFile with .ics path |
</phase_requirements>

## Standard Stack

No library dependencies. This is a Markdown documentation phase.

### File Location Decision
**Recommended:** Place category files alongside `SKILL.md` in the repo root. This matches the existing pattern and avoids a new directory that the gateway or Claude Code skill loader might not resolve.

Alternative would be `skills/` subdirectory, but the root location is simpler and the `whatsapp-messenger` Claude Code skill (in `skills/whatsapp-messenger/SKILL.md`) is a separate artifact updated in Phase 51.

## Architecture Patterns

### Recommended File Structure
```
/ (repo root)
├── SKILL.md                    # Index — overview, quick-start, category links
├── skills/
│   ├── groups.md               # Group management (25 actions)
│   ├── contacts.md             # Contacts + vCard approach (8 actions)
│   ├── channels.md             # Newsletter channels (12 actions)
│   ├── chats.md                # Chat management (15 actions)
│   ├── status.md               # Status/stories (6 actions)
│   ├── presence.md             # Presence (4 actions)
│   ├── profile.md              # Profile (5 actions)
│   ├── media.md                # Media send + conversion (5 actions)
│   ├── messaging.md            # Messaging + rich messages + iCal (20+ actions)
│   └── slash-commands.md       # /join, /leave, /list, /shutup
```

Note: The `skills/` subdirectory under the repo root is the natural home since `skills/whatsapp-messenger/SKILL.md` already exists there. However, the agent-facing SKILL.md files are loaded differently than the Claude Code skill — confirm the planner picks one consistent location.

**Alternative (simpler):** Place all 10 files in the repo root alongside SKILL.md. Avoids any path ambiguity.

### Per-Category File Template
Each file should follow this structure:
```markdown
# [Category] — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See SKILL.md for overview and other categories.

## Actions

| Action | Parameters | Notes |
|--------|-----------|-------|
| ... | ... | ... |

## Examples

### [Common task]
```
Action: X
Parameters: { ... }
```

## Gotchas
- ...
```

### Index (new SKILL.md) Template
```markdown
---
name: whatsapp-actions
description: [existing description]
version: 6.0.0
---

> IMPORTANT — Standard Action Names: [existing note]

# Overview

[2-3 sentences on how the plugin works — auto-resolution, standard vs utility]

## Category Files

| Category | File | Actions |
|----------|------|---------|
| Messaging & Rich Messages | skills/messaging.md | send, poll, react, ... |
| Groups | skills/groups.md | createGroup, addParticipants, ... |
| ...

## Quick Start

[5-6 most common tasks with one-liner examples]

## Parameter Formats
[existing section — keep here, not duplicated in each file]

## Error Handling and Recovery
[existing table — keep here]

## Rate Limiting
[existing section]

## Multi-Session
[existing section]
```

## Action Inventory by Category

### messaging.md (Standard Actions + Rich Messages + Chat Read)
Standard actions (support target auto-resolution):
- `send`, `reply`, `poll`, `react`, `edit`, `unsend`, `pin`, `unpin`, `read`, `delete`

Rich message utility actions:
- `sendMulti`, `sendPollVote`, `sendLocation`, `sendContactVcard`, `sendList`, `sendLinkPreview`, `sendButtonsReply`, `sendEvent`, `forwardMessage`, `sendPoll`
- `readMessages` (read recent messages for LLM context)
- `starMessage` (not in current SKILL.md tables — add it)

iCal gotcha: WAHA `sendEvent` action sends a WhatsApp event invite natively. For external calendar interop, send a `.ics` file via `sendFile`. Document both approaches.

### groups.md (Group Management)
- `createGroup`, `getGroups`, `getGroup`, `getGroupsCount`, `deleteGroup`, `leaveGroup`, `joinGroup`
- `setGroupSubject`, `setGroupDescription`
- `setGroupPicture`, `deleteGroupPicture`, `getGroupPicture`
- `addParticipants`, `removeParticipants`, `getParticipants`
- `promoteToAdmin`, `demoteFromAdmin`, `demoteToMember`
- `setInfoAdminOnly`, `getInfoAdminOnly`, `setMessagesAdminOnly`, `getMessagesAdminOnly`
- `getInviteCode`, `revokeInviteCode`, `getGroupJoinInfo`, `refreshGroups`

Gotchas to document:
- `joinGroup` takes `inviteCode` = code portion after `chat.whatsapp.com/` (NOT full URL)
- `demoteFromAdmin` and `demoteToMember` are aliases — both work
- `participants[]` must include both `@c.us` AND `@lid` JIDs for NOWEB engine
- `getGroupJoinInfo` is useful to preview before joining
- Group picture takes `file` = absolute path or direct media URL

### contacts.md (Contacts + vCard)
- `getContacts`, `getContact`, `checkContactExists`
- `getContactAbout`, `getContactPicture`
- `blockContact`, `unblockContact`
- `createOrUpdateContact` (new in Phase 48 — ACT-03)

vCard approach to document:
- Native: `send` with `contacts: [{fullName, phoneNumber}]` parameter — generates WhatsApp contact card bubble
- File-based: `sendFile` with a `.vcf` file path — sends as document; recipient can import to their contacts
- `sendContactVcard` utility action: explicit chatId variant of the native approach
- `phoneNumber` format: country code + digits, no `+` prefix (e.g., `"972544329000"`)

### channels.md (Newsletter Channels)
- `getChannels`, `getChannel`, `createChannel`, `deleteChannel`
- `followChannel`, `unfollowChannel`, `muteChannel`, `unmuteChannel`
- `searchChannelsByText`, `previewChannelMessages`
- `searchChannelsByView`, `getChannelSearchViews`, `getChannelSearchCountries`, `getChannelSearchCategories`

Critical gotcha: Channel invite code ≠ newsletter JID. `whatsapp.com/channel/CODE` — the CODE is NOT the newsletter JID. Must resolve: `GET /channels/{code}` → returns `{ id: "120363...@newsletter" }`. Then use the JID for follow/unfollow.

### chats.md (Chat Management)
- `getChats`, `getChatsOverview`
- `getChatMessages`, `getChatMessage`, `getMessageById`
- `deleteChat`, `clearChatMessages`, `clearMessages` (alias)
- `archiveChat`, `unarchiveChat`
- `unreadChat`, `readChatMessages` (alias for `read`)
- `getChatPicture`
- `muteChat`, `unmuteChat`
- `getLabels`, `createLabel`, `updateLabel`, `deleteLabel`, `getChatLabels`, `setChatLabels`, `getChatsByLabel` (Labels — WhatsApp Business note)

Gotcha: Labels are WhatsApp Business only. Document that `getLabels` etc. may return empty on personal WhatsApp.

### status.md (Stories/Status)
- `sendTextStatus`, `sendImageStatus`, `sendVoiceStatus`, `sendVideoStatus`, `deleteStatus`
- `getNewMessageId` (new in Phase 48 — ACT-04)

### presence.md (Presence)
- `setPresenceStatus` / `setPresence` (aliases), `getPresence`, `subscribePresence`, `getAllPresence`

Gotcha: `setPresenceStatus` and `setPresence` both exist as aliases — document both names work.

### profile.md (Profile)
- `getProfile`, `setProfileName`, `setProfileStatus`, `setProfilePicture`, `deleteProfilePicture`

### media.md (Media Send + Conversion)
- `sendImage`, `sendVideo`, `sendFile`
- `convertVoice`, `convertVideo` (new in Phase 48 — ACT-07)

Critical gotcha: `file` must be a **direct media URL**, not a JSON API endpoint. For local files: absolute path (e.g., `/tmp/openclaw/image.png`). Alternative param names: `image`/`url` for sendImage, `video`/`url` for sendVideo, `url` for sendFile.

### slash-commands.md (Owner Commands)
- `/join` — join by invite link or name search
- `/leave` — leave group or channel by name
- `/list` — list memberships
- `/shutup` / `/unshutup` — mute/unmute bot in groups
- `/activation` — toggle group activation mode

Authorization: godModeSuperUsers + allowFrom. Pre-LLM processing (not AI-invoked).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| vCard contact sharing | Custom .vcf template | `send` with `contacts[]` param (native WhatsApp card) |
| Calendar events on WhatsApp | Custom calendar integration | `sendEvent` action (native) OR `sendFile` with .ics for external interop |
| Channel discovery | Manual JID construction | `searchChannelsByText` — resolves code→JID automatically |

## Common Pitfalls

### Pitfall 1: Actions Added in Phase 48 Missing from SKILL.md
**What goes wrong:** Phase 48 added `createOrUpdateContact`, `getNewMessageId`, `convertVoice`, `convertVideo` to UTILITY_ACTIONS but the current SKILL.md doesn't document them.
**How to avoid:** Use UTILITY_ACTIONS list from channel.ts as the authoritative source of truth, not just current SKILL.md text.
**Warning signs:** Actions in channel.ts UTILITY_ACTIONS that don't appear in any SKILL table.

### Pitfall 2: Alias Confusion
**What goes wrong:** Several actions have aliases (`demoteFromAdmin`/`demoteToMember`, `setPresence`/`setPresenceStatus`, `clearMessages`/`clearChatMessages`, `readChatMessages`/`read`) — agent picks wrong one.
**How to avoid:** Document both names explicitly with a note that they are aliases.

### Pitfall 3: Labels Section Placement
**What goes wrong:** Labels actions were put under a "Labels" section in SKILL.md but are WhatsApp Business only. An agent reading chats.md might try them on personal WhatsApp.
**How to avoid:** Put labels in chats.md with a prominent note: "WhatsApp Business only — returns empty on personal WhatsApp."

### Pitfall 4: `readMessages` vs `read`
**What goes wrong:** `readMessages` returns message content (LLM context); `read` marks chat as read (read receipts). Easy to confuse.
**How to avoid:** Call this out explicitly in messaging.md with a comparison table.

### Pitfall 5: vCard Phone Number Format
**What goes wrong:** Agent passes `"+972544329000"` with a `+` prefix — fails.
**How to avoid:** Document in contacts.md: `phoneNumber` = country code + digits, NO `+` prefix.

## Code Examples

### vCard via send action (contacts.md)
```
Action: send
Target: "zeev nesher"
Parameters: { "contacts": [{ "fullName": "John Doe", "phoneNumber": "972544329000" }] }
```

### vCard file-based approach (contacts.md)
```
Action: sendFile
Parameters: { "chatId": "972544329000@c.us", "file": "/tmp/john-doe.vcf", "caption": "John's contact" }
```

### iCal file-based approach (messaging.md)
```
Action: sendFile
Parameters: { "chatId": "120363421825201386@g.us", "file": "/tmp/meeting.ics", "caption": "Team meeting invite" }
```

### Native sendEvent (messaging.md)
```
Action: sendEvent
Parameters: {
  "chatId": "120363421825201386@g.us",
  "name": "Team Standup",
  "startTime": "2026-03-27T09:00:00Z",
  "endTime": "2026-03-27T09:30:00Z",
  "description": "Daily standup",
  "location": "Zoom"
}
```

### createOrUpdateContact (contacts.md — new ACT-03)
```
Action: createOrUpdateContact
Parameters: { "phone": "972544329000", "firstName": "John", "lastName": "Doe", "company": "Acme" }
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None — documentation-only phase |
| Config file | N/A |
| Quick run command | N/A |
| Full suite command | N/A |

No automated tests applicable to documentation. Verification is:
1. File count check: 10 category files + updated SKILL.md exist
2. Action coverage check: every action in `UTILITY_ACTIONS` + `STANDARD_ACTIONS` appears in at least one category file
3. Required sections check: each category file has "Actions", "Examples", and "Gotchas" sections
4. vCard + iCal documented in contacts.md and messaging.md (SKL-07)

### Wave 0 Gaps
None — no test infrastructure needed for documentation.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — documentation-only phase)

## Open Questions

1. **Where to place category files?**
   - What we know: `skills/whatsapp-messenger/` already exists in repo root `skills/` directory
   - What's unclear: Should the 10 files go in `skills/` (alongside whatsapp-messenger skill) or in a new `skills/waha/` subdirectory?
   - Recommendation: Place them in the repo root as `skills/groups.md`, `skills/contacts.md`, etc. The index SKILL.md references relative paths. Avoids creating a new layer.

2. **Labels category file?**
   - What we know: Labels are WhatsApp Business only. Requirements list 10 files and labels is NOT one of them.
   - Recommendation: Include labels actions inside `chats.md` with a WhatsApp Business caveat, not a separate file. The 10 required files are fixed.

## Sources

### Primary (HIGH confidence)
- `D:\docker\waha-oc-plugin\SKILL.md` — current 574-line skill file, canonical action documentation
- `D:\docker\waha-oc-plugin\src\channel.ts` lines 410-480 — authoritative UTILITY_ACTIONS list
- `D:\docker\waha-oc-plugin\.planning\REQUIREMENTS.md` — SKL-01, SKL-02, SKL-03, SKL-07 definitions
- `D:\docker\waha-oc-plugin\CLAUDE.md` — project conventions and critical rules

### Secondary (MEDIUM confidence)
- `D:\docker\waha-oc-plugin\skills\whatsapp-messenger\SKILL.md` — Claude Code skill, reference for Phase 51

## Project Constraints (from CLAUDE.md)

- **NEVER write "Sammie" in git-tracked files** — all category files are git-tracked; use "the agent" or "the bot"
- **Add DO NOT CHANGE comments on working code** — not applicable to documentation, but any references to SKILL.md loading path should be noted
- **Make backups before changes** — not applicable to new files; SKILL.md should be backed up before overwrite (e.g., `SKILL.md.bak.v1.18.0`)
- **ALWAYS keep SKILL.md in both deploy locations** — after publishing, SCP the updated SKILL.md and all new category files to both hpg6 locations

## Metadata

**Confidence breakdown:**
- Action inventory: HIGH — read directly from channel.ts UTILITY_ACTIONS
- File structure: HIGH — based on requirements spec (10 files named explicitly)
- vCard/iCal approach: HIGH — confirmed from existing SKILL.md and WAHA API behavior
- Category assignment: HIGH — follows existing SKILL.md section structure

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (documentation, stable)
