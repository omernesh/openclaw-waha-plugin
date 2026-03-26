# Eval 6: Send location to group

**Task:** Send a location to the group 120363421825201386@g.us at coordinates 32.0853, 34.7818 titled 'Office'.

## Skill Context Loaded

Read SKILL.md index → messaging.md category file.

## Action Selection and Parameter Construction

From messaging.md, the "Rich Message Utility Actions" table lists:
- `sendLocation` — Share a location pin with parameters: `chatId, latitude, longitude, title`

This is the correct action. There is no ambiguity — `sendLocation` specifically handles coordinate-based location sharing.

```
Action: sendLocation
Parameters: {
  "chatId": "120363421825201386@g.us",
  "latitude": 32.0853,
  "longitude": 34.7818,
  "title": "Office"
}
```

## Examples from Skill

The messaging.md "Send a location" example shows:
```
Action: sendLocation
Parameters: {
  "chatId": "972544329000@c.us",
  "latitude": 32.0853,
  "longitude": 34.7818,
  "title": "Tel Aviv"
}
```

Same pattern applied to the group JID instead of DM.

## Summary

Action: `sendLocation` with:
- `chatId: "120363421825201386@g.us"` (group JID with @g.us)
- `latitude: 32.0853`
- `longitude: 34.7818`
- `title: "Office"`

- NOT `send` — that is for text messages, not coordinate-based locations
- NOT `sendImage` — that is for image files
- NOT `sendFile` — that is for document/file attachments
- The coordinates are passed as numeric values, not strings
