# Phase 21: Directory Tab - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Rebuild the Directory tab with three sub-tabs (Contacts, Groups, Channels) using shadcn DataTable with @tanstack/react-table, FTS5 search via API, persistent contact settings Sheet, bulk edit mode for Contacts and Channels (matching Groups pattern), resolved participant names with bot session badges, and bot session exclusion from contacts list.

</domain>

<decisions>
## Implementation Decisions

### Sub-Tab Structure
- Three sub-tabs within Directory: Contacts, Groups, Channels
- Use shadcn Tabs component for sub-tab navigation
- Each sub-tab has its own DataTable with pagination

### DataTable with @tanstack/react-table
- Install @tanstack/react-table for sortable, filterable, paginated tables
- Columns: name, JID/phone, type-specific fields (role for contacts, member count for groups, etc.)
- Pagination via API (limit/offset params on `/api/admin/directory`)

### Search
- Search input at top of each sub-tab
- Queries local SQLite via FTS5 through `/api/admin/directory?search=&type=` endpoint
- Instant results, no page reload — controlled input with debounced API call

### Contact Settings Panel
- Opens as shadcn Sheet (side panel) when clicking a contact row
- Contains: mode (Active/Listen Only/Muted), Can Initiate toggle, TTL access, custom keywords (tag input)
- Sheet stays open after saving — Save button sends PUT to `/api/admin/directory/:jid/settings`
- Success toast on save, no close

### Bulk Edit Mode
- Available on Contacts and Channels sub-tabs (Groups already has it in backend)
- Toggle "Select" button enables checkboxes on each row
- Bulk action toolbar appears: Allow DM, Revoke DM, Set Mode, etc.
- Actions send batch API calls

### Group Participants
- Expandable row in Groups DataTable shows participants
- Lazy-loaded via `/api/admin/directory/group/:groupJid/participants`
- Names resolved from local DB via batch resolve
- Bot session participants (matched via api.getSessions()) shown with "Bot" badge, no Allow/Block buttons
- Non-bot participants show Allow, Allow DM, Role dropdown

### Bot Session Exclusion
- Contacts list filters out JIDs matching any configured session
- Use session list from api.getSessions() to identify bot JIDs

### Custom Keywords & Group Override
- Custom keywords in contact settings use TagInput component (from Phase 20)
- Group filter override keywords also use TagInput

### Claude's Discretion
- Exact column widths and table styling
- Whether to use row expansion or a separate panel for group participants
- Debounce timing for search (200-500ms range)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/admin/src/components/shared/TagInput.tsx` — created in Phase 20, supports readOnly/freeform/search modes
- `src/admin/src/lib/api.ts` — has `getDirectory()`, `getDirectoryEntry()`, `updateDirectorySettings()`, `refreshDirectory()`, `getGroupParticipants()`, `resolveNames()` methods
- `src/admin/src/types.ts` — has DirectoryEntry, GroupParticipant types (may need refinement)
- `src/admin/src/components/ui/` — full shadcn component library from Phase 20

### Established Patterns
- Tab components receive `selectedSession` and `refreshKey` props
- useEffect with refreshKey dependency for data fetching
- API client returns typed responses
- TagInput for pill-style inputs with search

### Integration Points
- DirectoryTab.tsx replaces placeholder
- Needs @tanstack/react-table installed
- Needs shadcn Tabs component (may need to install)
- Sheet component already available from Phase 19

</code_context>

<specifics>
## Specific Ideas

Reference the existing directory tab behavior in monitor.ts for exact API interaction patterns. The bulk edit pattern should match what was built for Groups in v1.11 (Phase 10).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
