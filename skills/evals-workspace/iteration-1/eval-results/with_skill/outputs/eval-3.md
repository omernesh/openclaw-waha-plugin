# Eval 3: Block a contact

**Task:** Block the contact 972556839823.

## Skill Context Loaded

Read SKILL.md index → contacts.md category file.

## Action Selection and Parameter Construction

From contacts.md, the actions table lists:
- `blockContact` — Block a contact
- `unblockContact` — Unblock a contact

The correct action is `blockContact`. The phone number needs the `@c.us` suffix to form a proper JID.

```
Action: blockContact
Parameters: {
  "contactId": "972556839823@c.us"
}
```

## Key Notes

From contacts.md Gotchas:
- `contactId` uses the JID format: `972556839823@c.us` (phone number + `@c.us`)
- NOT `phone` format (that's for `checkContactExists` and `createOrUpdateContact` only)
- NO `+` prefix on the phone number

## Summary

Action: `blockContact` with `contactId: "972556839823@c.us"`.

- NOT `unblockContact` — that reverses a block
- NOT `delete` — that deletes a chat, not blocks a contact
- NOT `muteChat` — that mutes notifications, does not block
- contactId uses @c.us suffix as required by the skill
