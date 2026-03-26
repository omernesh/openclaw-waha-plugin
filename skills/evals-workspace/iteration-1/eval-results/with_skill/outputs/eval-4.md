# Eval 4: Get contact's profile picture and about text

**Task:** Get Michael Greenberg's profile picture and about text. His number is 972556839823.

## Skill Context Loaded

Read SKILL.md index → contacts.md category file.

## Action Selection and Parameter Construction

From contacts.md, two distinct actions cover the requested information:
- `getContactPicture` — Get a contact's profile picture URL
- `getContactAbout` — Get a contact's "About" status text

These are separate actions and must both be called. There is no single action that returns both.

### Action 1: Get profile picture

```
Action: getContactPicture
Parameters: {
  "contactId": "972556839823@c.us"
}
```

### Action 2: Get about text

```
Action: getContactAbout
Parameters: {
  "contactId": "972556839823@c.us"
}
```

## Key Notes

- Both actions use `contactId` format: `972556839823@c.us` (with `@c.us` suffix)
- These are two separate API calls — there is no combined "getContactInfo" that returns both
- From contacts.md Gotchas: `getContactPicture` may fail for blocked contacts due to WhatsApp privacy settings

## Summary

Two actions required:
1. `getContactPicture` with `contactId: "972556839823@c.us"`
2. `getContactAbout` with `contactId: "972556839823@c.us"`

Both use the same contactId with @c.us suffix. They are separate, non-conflatable actions. The agent does NOT call a listing action (`getContacts`) first — the contactId is already known from the phone number.
