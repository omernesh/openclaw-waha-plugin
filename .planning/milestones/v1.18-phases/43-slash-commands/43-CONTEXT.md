# Phase 43: Slash Commands - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement /join, /leave, and /list slash commands in inbound.ts that bypass the LLM entirely. Commands are intercepted before any filters, dedup, trigger words, or mute checks — following the exact pattern established by /shutup (lines 489-511 in inbound.ts).

</domain>

<decisions>
## Implementation Decisions

### Command Syntax & Parsing
- Single regex for /join: `/^\/(join)\s+(.+)$/i` — captures everything after /join as the argument
- Detect invite link vs group name: check if arg matches `chat.whatsapp.com/` or is a raw invite code (22+ chars alphanumeric) — else treat as name
- Single regex for /list: `/^\/(list)\s*(groups?|channels?)?$/i` — optional subcommand
- /leave supports both groups AND channels — detect `@newsletter` JID to route to unfollowWahaChannel vs leaveWahaGroup

### Ambiguous Match Flow
- On ambiguous /join or /leave match: send numbered candidate list as WhatsApp message, user replies with number to confirm (reuse PendingSelectionRecord pattern from shutup)
- Show top 5 matches (same as autoResolveTarget)
- 60-second timeout for selection, then "Selection expired" message
- Zero matches: reply "No groups/channels matching '{name}' found" — no LLM fallback

### Output Format & UX
- /list output: numbered list with emoji prefix: `📱 Groups (3):\n1. Family Chat\n2. Work\n📢 Channels (2):\n1. News`
- Join/leave confirmation: `Joined "Group Name" ✓` or `Left "Channel Name" ✓` — one line
- Error format: `⚠️ Could not join: {reason}` — same pattern as shutup errors
- Authorization: godModeSuperUsers only (checked via checkShutupAuthorization pattern)

### Claude's Discretion
- Internal module organization (separate file like shutup.ts vs inline in inbound.ts)
- Exact regex patterns may be adjusted for edge cases
- Whether to add /list count to the confirmation (e.g., "12 groups, 3 channels")

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SHUTUP_RE` regex pattern and `handleShutupCommand` as template for command interception (src/shutup.ts)
- `resolveWahaTarget()` in send.ts (line 1584) for fuzzy name matching with confidence scores
- `autoResolveTarget()` in channel.ts (line 451) — wraps resolveWahaTarget with confidence threshold
- `sendWahaText()` in send.ts (line 207) with `bypassPolicy: true` for direct replies
- `PendingSelectionRecord` type for interactive numbered-list flows
- `getWahaGroups()`, `leaveWahaGroup()`, `joinWahaGroup()`, `followWahaChannel()`, `unfollowWahaChannel()`, `getWahaChannels()` all in send.ts

### Established Patterns
- Command interception at inbound.ts lines 489-511 (BEFORE mute/filter/dedup/trigger)
- Authorization via godModeSuperUsers check
- Replies sent via sendWahaText with bypassPolicy: true
- Early return after command handling to skip LLM processing
- Structured logging via getLogger() from src/logger.ts

### Integration Points
- inbound.ts line 489-511: exact location for new command regex checks
- New file (e.g., src/commands.ts) for command handlers — mirrors src/shutup.ts pattern
- send.ts functions called directly from command handlers
- channel.ts resolveWahaTarget for fuzzy matching

</code_context>

<specifics>
## Specific Ideas

- Follow shutup.ts pattern: separate file for command logic, regex exported, handler function exported
- /join invite link: extract code from URL (part after chat.whatsapp.com/), call joinWahaGroup directly
- /join by name: call resolveWahaTarget, if single high-confidence match → join directly, if ambiguous → numbered list
- /leave: same fuzzy flow but for leaving — resolve name to JID, then call leaveWahaGroup or unfollowWahaChannel based on JID type
- /list: call getWahaGroups + getWahaChannels (or directory DB), format as numbered emoji list

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
