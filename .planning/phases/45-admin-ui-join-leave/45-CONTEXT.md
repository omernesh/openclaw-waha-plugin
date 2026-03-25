# Phase 45: Admin UI Join/Leave - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Add "Leave" action button to each group/channel row in the directory tab, and a "Join by Link" input field at the top of the directory tab. Both actions provide success/error feedback via toasts.

</domain>

<decisions>
## Implementation Decisions

### UI Placement
- "Leave" button goes on each group and channel row in the directory tab (not on contact rows)
- "Join by Link" input goes at the top of the directory tab, above the search/filter bar
- Both use existing admin panel API routes under /api/admin/

### API Routes
- POST /api/admin/directory/join — accepts { inviteLink: string }, calls joinWahaGroup on the server
- POST /api/admin/directory/leave/:jid — calls leaveWahaGroup or unfollowWahaChannel based on JID type

### Feedback
- Success: toast notification ("Joined group X" / "Left group X")
- Error: toast notification with error message
- Leave button shows confirmation dialog before executing (destructive action)
- Join input validates invite link format before submitting

### Claude's Discretion
- Exact button styling (follow existing directory tab action button patterns)
- Join input component design (inline form vs modal)
- Loading states during API calls
- Whether to auto-refresh directory after join/leave

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- src/admin/src/components/tabs/directory/ — existing directory tab components
- src/admin/src/lib/api.ts — API client functions
- Toast system already exists in the admin panel (shadcn/ui)
- Existing action buttons in directory rows (DM settings, allow/block toggles)

### Established Patterns
- shadcn/ui components, Tailwind CSS styling
- API calls via fetch wrapper in api.ts
- Toast notifications for success/error feedback

### Integration Points
- src/monitor.ts — add new /api/admin/directory/join and /api/admin/directory/leave/:jid routes
- src/admin/src/components/tabs/directory/ — modify directory tab components
- src/admin/src/lib/api.ts — add joinByLink() and leaveGroup() API functions

</code_context>

<specifics>
## Specific Ideas

- Leave button: red/destructive variant, small, with DoorOpen or LogOut icon
- Join by Link: text input with "Join" button, accepts https://chat.whatsapp.com/... URLs
- Confirmation dialog for Leave using existing AlertDialog component from shadcn/ui

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
