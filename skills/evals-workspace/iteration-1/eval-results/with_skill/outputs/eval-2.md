# Eval 2: Get invite link for group

**Task:** Get the invite link for the group 120363421825201386@g.us.

## Skill Context Loaded

Read SKILL.md index → groups.md category file.

## Action Selection and Parameter Construction

From groups.md, the "Join by Invite" section lists:
- `getInviteCode` — Get current invite code + full link
- `joinGroup` — Join via invite code (for joining, not retrieving the link)
- `getGroupJoinInfo` — Preview group details before joining

The correct action is `getInviteCode` since we want to retrieve the invite link, not join the group.

```
Action: getInviteCode
Parameters: {
  "groupId": "120363421825201386@g.us"
}
```

## Expected Response

The action returns: `{ "inviteCode": "AbcXyz123...", "inviteLink": "https://chat.whatsapp.com/AbcXyz123..." }`

## Summary

Action: `getInviteCode` with `groupId: "120363421825201386@g.us"`.

- NOT `joinGroup` — that joins a group using a code, it does not retrieve a code
- NOT `getGroup` — that returns group metadata, not invite codes
- NOT `createGroup` — creates a new group, not applicable
- NOT any messaging action — this is a query operation, no message is sent
