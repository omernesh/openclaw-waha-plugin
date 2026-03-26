# Eval 5: Follow channel from invite link

**Task:** Follow the WhatsApp channel at https://whatsapp.com/channel/0029VaXXXXXXXX.

## Skill Context Loaded

Read SKILL.md index → channels.md category file.

## Critical Constraint Identified

From channels.md Gotchas (first item, marked CRITICAL):

> **Channel invite code ≠ newsletter JID** — `https://whatsapp.com/channel/AbcXyz123...` — the `AbcXyz123` part is an **invite code**. It is NOT a newsletter JID. `followChannel` requires the JID (e.g., `120363421825201386@newsletter`). To get the JID, search by name with `searchChannelsByText` and use the `id` field from the results.

Also from the examples section:
> Use `searchChannelsByText` to find the channel and get its newsletter JID first.

## Action Selection and Parameter Construction

**WRONG approach (DO NOT DO THIS):**
```
Action: followChannel
Parameters: { "channelId": "https://whatsapp.com/channel/0029VaXXXXXXXX" }
// WRONG: URL passed as channelId — silent no-op, returns 200 but does nothing
```

**WRONG approach (DO NOT DO THIS):**
```
Action: followChannel
Parameters: { "channelId": "0029VaXXXXXXXX" }
// WRONG: invite code passed as channelId — silent no-op, returns 200 but does nothing
```

**Correct two-step process:**

### Step 1: Search for the channel to get its newsletter JID

```
Action: searchChannelsByText
Parameters: { "query": "channel name" }
```

Extract the `id` field (ending in `@newsletter`) from the search results.

### Step 2: Follow using the newsletter JID

```
Action: followChannel
Parameters: { "channelId": "120363421825201386@newsletter" }
// channelId must be the @newsletter JID, NOT the invite code
```

## Key Warning

From channels.md: "WAHA silent no-ops — `followChannel` called with an invite code returns 200 with no error but does nothing." This means passing the URL or invite code would appear to succeed but have no effect. The two-step resolve-then-follow approach is mandatory.

## Summary

The agent MUST NOT pass the URL or invite code directly to `followChannel`. The correct process is:
1. `searchChannelsByText` to find the channel JID
2. `followChannel` with the resolved `@newsletter` JID

If the channel name is unknown from the invite link, the agent should inform the user that the invite code must be resolved to a newsletter JID first, and ask for the channel name to search by.
