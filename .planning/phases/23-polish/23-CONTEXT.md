# Phase 23: Polish - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add cross-cutting polish to the React admin panel: Sonner toast notifications replacing any remaining alert/custom toast, Skeleton loading states on all data-fetching tabs, per-tab error boundaries for graceful failure isolation, refresh button spinner + "Last refreshed" timestamps, and tooltip portal rendering to prevent overflow clipping.

</domain>

<decisions>
## Implementation Decisions

### Toast Notifications (PLSH-01)
- Use Sonner (already installed in Phase 21) for all success/error toast notifications
- Replace any remaining `alert()` calls or custom toast implementations
- Toaster component already added to main.tsx in Phase 21
- Success toasts: green, auto-dismiss after 3s
- Error toasts: red, persist until dismissed

### Loading States (PLSH-02)
- Use shadcn Skeleton component on every data-fetching tab
- Show skeleton placeholders while initial API fetch is in flight
- Replace loading spinners or blank content with structured skeletons matching card/table layouts

### Error Boundaries (PLSH-03)
- Create a TabErrorBoundary React component (class component with componentDidCatch)
- Wrap each tab's content in its own error boundary
- Error state shows: error message, "Retry" button to reset the boundary
- One tab crashing doesn't take down the entire admin panel

### Refresh Button Enhancement (PLSH-04)
- Refresh button in TabHeader shows a spinning animation while data is loading
- After completion, show "Last refreshed: HH:MM:SS" timestamp below the button or as tooltip
- Track loading state per-tab and last refresh timestamp

### Tooltip Portals (CLNP-03)
- Ensure all tooltip content renders via React portals (outside parent overflow containers)
- Radix UI tooltips already portal by default — verify no custom tooltips bypass this
- Test with Settings and Directory tabs where overflow clipping was an issue

### Claude's Discretion
- Exact skeleton layout shapes per tab
- Error boundary visual styling
- Whether to use a shared loading state hook or per-tab implementation

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sonner` already installed, `<Toaster />` already in main.tsx
- shadcn Skeleton component may need to be created (check if exists)
- All 7 tab components exist and fetch data via api.ts
- TabHeader.tsx has the refresh button (RefreshCw icon)

### Established Patterns
- Each tab uses useEffect with refreshKey dependency
- API client returns typed responses with ApiError
- Radix UI portals for tooltips/popovers

### Integration Points
- TabErrorBoundary wraps each tab in App.tsx renderActiveTab()
- Skeleton components go inside each tab's loading conditional
- Toast calls replace any alert() in save/toggle handlers
- Refresh spinner state added to TabHeader props

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the standard patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
