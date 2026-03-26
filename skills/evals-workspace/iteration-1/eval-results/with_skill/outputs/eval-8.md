# Eval 8: Mark messages as read (action disambiguation)

**Task:** Mark all messages in the group 120363421825201386@g.us as read.

## Skill Context Loaded

Read SKILL.md index → messaging.md category file.

## Disambiguation Analysis

From messaging.md, the comparison table explicitly addresses this confusion:

| Action | What It Does | When to Use |
|--------|-------------|-------------|
| `readMessages` | **Fetches message content** — returns array of recent messages with sender, text, timestamp, type. Does NOT affect read status. | Read recent conversation history to understand context |
| `read` | **Sends read receipts** — marks the chat as read in WhatsApp (clears unread badge). Returns nothing useful. | Tell WhatsApp you've seen the messages |

From messaging.md rule: "Use `readMessages` to read content. Use `read` to mark as read. They are completely different operations."

## Action Selection

"Mark all messages as read" = send read receipts, clear the unread badge = `read` action.

```
Action: read
Parameters: {
  "chatId": "120363421825201386@g.us"
}
```

## Key Distinctions

- `read` — Standard action that sends WhatsApp read receipts for a chat. This is what "mark as read" means. It clears the unread count and notifies senders their messages were seen.
- `readMessages` — A utility action that fetches message content from the API. Does NOT send read receipts. Does NOT affect the unread status.
- `getChatMessages` — Also fetches message content; same category as `readMessages`.

## Summary

Action: `read` with `chatId: "120363421825201386@g.us"`.

- NOT `readMessages` — that fetches message content, does not send read receipts
- NOT `getChatMessages` — that retrieves messages for LLM context, does not affect read status
- The `read` action is in the standard actions section (supports target auto-resolution) but can also accept a raw chatId

The agent correctly selects `read` for "marking messages as read" and does NOT confuse it with `readMessages` (fetching content).
