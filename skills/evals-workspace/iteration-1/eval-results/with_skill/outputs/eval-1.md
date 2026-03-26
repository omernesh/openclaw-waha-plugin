# Eval 1: Add participant and promote to admin

**Task:** Add Michael Greenberg (972556839823) to the group 120363421825201386@g.us and then promote him to admin.

## Skill Context Loaded

Read SKILL.md index → groups.md category file.

## Action Selection and Parameter Construction

This task requires two sequential actions:

### Step 1: Add the participant

From groups.md, the `addParticipants` action adds participants to a group. The participant JID needs `@c.us` suffix for the phone number.

```
Action: addParticipants
Parameters: {
  "groupId": "120363421825201386@g.us",
  "participants": ["972556839823@c.us"]
}
```

Note: groups.md Gotchas section states to include BOTH `@c.us` AND `@lid` JIDs for NOWEB engine compatibility. Since the LID for 972556839823 is not provided, only `@c.us` is used here.

### Step 2: Promote to admin

After adding the participant, use `promoteToAdmin` to grant admin role:

```
Action: promoteToAdmin
Parameters: {
  "groupId": "120363421825201386@g.us",
  "participants": ["972556839823@c.us"]
}
```

## Summary

Two sequential actions required:
1. `addParticipants` with `groupId: "120363421825201386@g.us"` and `participants: ["972556839823@c.us"]`
2. `promoteToAdmin` with the same groupId and participant JID

Neither `createGroup` nor `send` nor `invite` actions are appropriate here. The `addParticipants` action (not `joinGroup`) is used because we are adding from the bot's side, not joining. The `promoteToAdmin` action explicitly grants admin role after the participant is added.
