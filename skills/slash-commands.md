# Slash Commands — Owner Commands

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.

> **Important:** Slash commands are NOT AI-invoked actions. They are processed **before** the message reaches the LLM. The agent cannot call these programmatically — they are sent as WhatsApp messages by authorized humans.

## Overview

Slash commands give owners direct control over the bot without going through the AI. They are processed at the inbound message handler layer and never reach the LLM.

**Authorization:** Commands are gated by `godModeSuperUsers` + `allowFrom` config. Unauthorized callers receive: `"You are not authorized to use this command."`

## Commands

### /join — Join a group or channel

| Variant | Syntax | Behavior |
|---------|--------|----------|
| Invite link | `/join https://chat.whatsapp.com/AbcXyz123` | Extracts the code, calls joinGroup API, replies "Joined group ✓" |
| Raw invite code | `/join AbcXyz123...` (22+ alphanumeric chars) | Same as above |
| By name | `/join test group` | Fuzzy-searches groups the bot already belongs to — replies "Already a member of `<name>`" if found |
| Ambiguous name | `/join dev` (multiple matches) | Lists numbered candidates; user replies with a number to confirm |

> **Note:** Name-based `/join` only finds groups the bot is already a member of. To join a new group, always use the invite link.

---

### /leave — Leave a group or channel

| Syntax | Behavior |
|--------|----------|
| `/leave test group` | Fuzzy-searches groups and channels; leaves immediately on single high-confidence match |
| `/leave dev` (ambiguous) | Lists numbered candidates; user replies with a number to confirm |

- Groups: calls `leaveGroup` API
- Channels/newsletters: calls `unfollowChannel` API
- On success: replies `Left "<name>" ✓`

---

### /list — List memberships

| Command | Output |
|---------|--------|
| `/list` | All groups + all channels |
| `/list groups` | Groups only |
| `/list channels` | Channels/newsletters only |

Results are sorted alphabetically and numbered. Example:

```
Groups (3):
1. Dev Team
2. Family Chat
3. Test Group

Channels (1):
1. Announcements
```

---

### /shutup — Mute the bot in a group

Interactive flow: the bot sends a numbered list of groups. User picks the group(s) and sets a mute duration. While muted, the bot ignores all messages in that group (including @mentions).

- Muted state is stored persistently (survives gateway restarts)
- Duration options are presented as a menu

---

### /unshutup — Unmute the bot in a group

Reverse of `/shutup`. Bot presents a list of currently-muted groups; user picks one to unmute.

---

### /activation — Toggle group activation mode

Sent inside a group to switch the bot between activation modes for that specific group:

| Mode | Behavior |
|------|----------|
| `mention` | Default. Bot only replies when explicitly @mentioned or replied to. |
| `always` | Bot evaluates every message in the group. |

Takes effect immediately for that group. No parameters — it's a toggle.

## Gotchas

- All slash commands are processed pre-LLM. The agent will never see these messages in its context.
- Confirmation flows (ambiguous `/join`, `/leave`, `/shutup`) are stateful — the bot stores the pending selection and waits for a numbered reply from the same sender.
- `/join` with a full `https://chat.whatsapp.com/` URL automatically extracts the invite code.
- `/join` by name only matches groups already visible to WAHA (the bot must already be a member or the group must be in the directory).
- When the bot sends messages from a human session on behalf of an action, they are prefixed with a robot emoji to distinguish bot-originated messages from human messages.
