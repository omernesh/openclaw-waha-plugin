# Phase 22: Sessions, Modules, Log, and Queue Tabs - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Rebuild the four remaining admin panel tabs as React components: Sessions (role/subRole management with Save & Restart), Modules (enable/disable toggles, config forms, assignment pickers), Log (virtual scrolling, level filtering, search), and Queue (DM/group queue status display).

</domain>

<decisions>
## Implementation Decisions

### Sessions Tab
- Each session rendered as a shadcn Card
- Labeled role dropdown (bot/human) and subRole dropdown (full-access/listener) with labels above
- Explanatory text box at bottom explaining each option
- Optimistic role save: dropdown updates immediately, shows "Restart required" amber notice
- Save & Restart button uses RestartOverlay (shared component from Phase 20)
- Data from api.getSessions()

### Modules Tab
- List all registered modules from api.getModules()
- Each module: Card with name, description, enable/disable Switch toggle
- Inline config form (module-specific settings rendered dynamically)
- Group/contact assignment pickers using TagInput (search mode) from Phase 20
- Toggle sends PUT to module enable/disable endpoint

### Log Tab
- Log entries from api.getLogs() — virtual scrolling for large log sets
- Level filter chips (INFO, WARN, ERROR, DEBUG) — toggle to show/hide levels
- Search input with clear button (x)
- Auto-scroll to bottom on new entries, pause auto-scroll when user scrolls up
- Consider @tanstack/react-virtual or simple windowing for virtual scroll

### Queue Tab
- Display DM queue depth and group queue depth from api.getQueueStatus()
- Show processing state (idle/processing/paused)
- Simple Card-based layout — not a complex component

### Claude's Discretion
- Virtual scrolling implementation details (library choice or custom)
- Exact module config form rendering (can use JSON schema or manual fields)
- Log entry formatting and coloring

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/admin/src/components/shared/RestartOverlay.tsx` — polling overlay from Phase 20
- `src/admin/src/components/shared/TagInput.tsx` — pill input with search mode
- `src/admin/src/lib/api.ts` — has getSessions(), getModules(), getLogs(), getQueueStatus() methods
- All shadcn UI components from Phases 18-21

### Established Patterns
- Tab components receive `selectedSession` and `refreshKey` props
- useEffect with refreshKey for data fetching
- Cards for section grouping, switches for toggles

### Integration Points
- SessionsTab.tsx, ModulesTab.tsx, LogTab.tsx, QueueTab.tsx replace placeholders
- RestartOverlay shared with Sessions (same pattern as Settings)

</code_context>

<specifics>
## Specific Ideas

Reference monitor.ts for exact API response shapes for modules, logs, and queue endpoints.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
