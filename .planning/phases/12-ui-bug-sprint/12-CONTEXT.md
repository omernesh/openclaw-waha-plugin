# Phase 12: UI Bug Sprint - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix all standalone admin panel bugs and CRs from v1.10 human verification. 26 requirements covering dashboard flickering, stat labels, session role UX, search/clear buttons, tooltips, settings drawer, tag inputs, refresh feedback, collapsible cards, per-session stats, human-readable labels, Can Initiate global setting, and directory UX (bot exclusion, bot badge, role auto-grant). All changes are in the embedded admin panel (monitor.ts) with no backend/schema changes.

</domain>

<decisions>
## Implementation Decisions

### Refresh Button Behavior
- Inline text change: button text → "Refreshing..." with CSS pulse animation — no new components
- "Last refreshed" displayed as relative time below button: "2m ago", auto-updating every 30s
- Shared `wrapRefreshButton(btn, loadFn)` helper applied uniformly to all tabs (Dashboard, Sessions, Log, Queue, Directory)

### Dashboard Per-Session Stats
- Session name as sub-header within each card, then stat row per session — matches CR-04 example layout from bugs.md
- Per-session health rows replacing single aggregate — each session shows healthy/failures/last check independently
- Reuse existing `<details class="settings-section">` pattern for collapsible filter cards — already proven, no new CSS needed
- Static lookup object `{wpm: "Words Per Minute", readDelayMs: "Read Delay (ms)", ...}` for human-readable labels — explicit, no magic

### Sessions & Settings UX
- Optimistic UI for role save: update dropdown locally on change, save in background, only re-render on error — eliminates `loadSessions()` full re-render that causes flicker
- 502 handling: polling overlay "Gateway restarting..." with retry every 2s, auto-dismiss on success — matches Settings tab restart pattern
- Reuse existing `createTagInput()` from Phase 8 for Custom Keywords, Mention Patterns, Group Override Keywords — just swap plain text inputs for tag containers
- DM Policy "pairing" removal: remove from dropdown HTML, add `loadConfig()` migration — if value is "pairing" → set to "allowlist" + show one-time toast explaining the change

### Claude's Discretion
- Exact CSS values for tooltip z-index fix (BUG-08)
- Channels tab Allow DM toggle visual design (BUG-18)
- Per-group trigger operator "grayed out" styling when inheriting global (BUG-17)
- Contact settings drawer "stay open after save" implementation approach (BUG-09)
- Directory bot session exclusion filter placement (CR-12)
- Bot participant badge styling (CR-14)
- Role auto-grant toast messaging (CR-16)
- Can Initiate UI placement in Settings tab (CR-10)
- Can Initiate per-contact override dropdown design (CR-10)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createTagInput(containerId, opts)` — tag-style input component (Phase 8), returns `.setValue(array)` interface
- `showToast(msg, isError)` — toast notifications (green success, red error), 3.5s auto-hide
- `stat(label, value, color)` — dashboard stat div builder
- `<details class="settings-section">` — collapsible sections with rotating arrow
- `.tip::after` — tooltip CSS using `data-tip` attribute
- `roleBadgeColor(role)` / `subRoleBadgeColor(subRole)` — role color helpers
- `esc(str)` — HTML escape utility

### Established Patterns
- Dashboard cards: `.card` → `.stat-row` → `.stat` with `.label` + `.value`
- All dynamic user content: `textContent` only (no innerHTML with user data — security hook)
- Tag inputs: lazy-init on first `loadConfig()` call, not at script bottom
- Session role saves: PUT to `/api/admin/sessions/{id}/role` with JSON body
- Settings restart: polling overlay already exists in Settings tab

### Integration Points
- `loadStats()` — main dashboard render function, needs per-session refactor
- `loadSessions()` — sessions tab renderer, needs optimistic UI
- `loadConfig()` — settings tab renderer, tag input init happens here
- `loadDirectory()` / `loadGroupsTable()` — directory render paths
- `refreshDirectory()` — refresh handler for directory tab

</code_context>

<specifics>
## Specific Ideas

- CR-04 example layout from bugs.md: session name as sub-header, per-session stats inline within cards
- BUG-03 labeling: "Passed" vs "Filtered" instead of "Allowed" vs "Dropped"
- CR-05: explanatory text box at bottom of Sessions card explaining role/subRole options
- BUG-13: auto-migrate "pairing" → "allowlist" with one-time toast notification

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
