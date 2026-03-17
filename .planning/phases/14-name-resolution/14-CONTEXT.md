# Phase 14: Name Resolution - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Resolve raw @lid JIDs to human-readable contact names across every surface in the admin panel: dashboard Access Control card, God Mode Users tag bubbles, Allow From / Group Allow From / Allowed Groups tag bubbles, contact picker search, and group participant lists. All lookups query the locally synced SQLite directory (Phase 13). Merge @lid and @c.us entries for the same person into single displays.

</domain>

<decisions>
## Implementation Decisions

### Name Resolution Strategy
- Server-side batch resolution: new `GET /api/admin/directory/resolve` endpoint accepts array of JIDs, returns `{jid: name}` map from SQLite. Frontend calls once per render, not per-JID
- @lid→@c.us merging in UI: show resolved name with @c.us JID as tooltip. If both @lid and @c.us are in a list (e.g., allowFrom), merge into single entry showing name once
- Tag bubble display: name as bubble text, raw JID as `title` attribute tooltip on hover

### Contact Picker & Participants
- Contact picker search queries local SQLite via FTS5 through existing `/api/admin/directory?search=` endpoint — already instant from Phase 13
- Group participant names resolved from local SQLite — `getGroupParticipants()` joins with contacts table to get display_name

### Claude's Discretion
- Exact implementation of @lid/@c.us deduplication in allowFrom/groupAllowFrom lists
- Dashboard Access Control card name resolution rendering approach
- Whether to cache resolved names client-side within a session
- Fallback display when a JID has no resolved name (show raw JID vs "Unknown")

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DirectoryDb.getContact(jid)` — single contact lookup by JID
- `DirectoryDb.getContacts(search, type, limit, offset)` — FTS5-backed search from Phase 13
- Existing name resolver in dashboard Access Control card (resolves @c.us only — needs @lid extension)
- `createTagInput()` — tag component with `.setValue()` interface
- `createGodModeUsersField()` — God Mode user picker (Phase 8)

### Established Patterns
- All user-supplied text: `textContent` only (no innerHTML)
- Tag bubbles: text content set via DOM, not string interpolation
- Tooltips: `title` attribute or `.tip` class with `data-tip`

### Integration Points
- Dashboard `loadStats()` → Access Control card rendering
- Settings `loadConfig()` → tag input population for allowFrom, groupAllowFrom, allowedGroups, godModeUsers
- Directory `loadGroupParticipants()` → participant name display
- Contact picker search → `/api/admin/directory?search=` endpoint

</code_context>

<specifics>
## Specific Ideas

- BUG-01: Access Control @lid JIDs merged with @c.us equivalents showing contact names
- BUG-10/12: Tag bubbles show names not raw numbers
- BUG-11: Contact picker searches local SQLite directory
- BUG-16: Group participants show resolved names

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
