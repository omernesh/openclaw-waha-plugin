# Eval 7: Delete a group (action disambiguation)

**Task:** Delete the group 120363421825201386@g.us.

## Skill Context Loaded

Read SKILL.md index → groups.md category file, messaging.md for the `delete` action comparison.

## Disambiguation Analysis

This task has three potentially confusable actions:

| Action | What It Does | Correct for This Task? |
|--------|-------------|----------------------|
| `deleteGroup` | Permanently deletes the WhatsApp group (owner only) | YES |
| `leaveGroup` | Removes the bot from the group — the group continues to exist | NO — group still exists |
| `delete` | Deletes the chat from the local view (chat history) — the group is NOT deleted from WhatsApp | NO — this is a chat management action |

## Action Selection

From groups.md, "Create & Delete" section:
- `deleteGroup` — Delete the group (owner only)
- `leaveGroup` — Leave the group

The correct action is `deleteGroup`.

```
Action: deleteGroup
Parameters: {
  "groupId": "120363421825201386@g.us"
}
```

## Key Distinctions

- `deleteGroup` — Permanently removes the group from WhatsApp. All participants lose access. Requires bot to be the group owner.
- `leaveGroup` — The bot exits the group but the group continues to exist. Other participants remain.
- `delete` (messaging.md) — Removes the chat from the bot's local chat list. Does NOT delete the WhatsApp group. Only affects the local view.

## Summary

Action: `deleteGroup` with `groupId: "120363421825201386@g.us"`.

- NOT `leaveGroup` — that only removes the bot, not the group
- NOT `delete` — that is a chat management action (removes from chat list, not the WhatsApp group)
- NOT `archiveChat` — that hides the chat, does not delete the group

The agent correctly disambiguates "delete the group" as permanently deleting the WhatsApp group entity, not just leaving it or removing it from the local view.
