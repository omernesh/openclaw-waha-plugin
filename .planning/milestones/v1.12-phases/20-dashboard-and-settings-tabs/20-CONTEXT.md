# Phase 20: Dashboard and Settings Tabs - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Rebuild the Dashboard and Settings tabs as React components. Dashboard shows per-session stat cards with human-readable labels, collapsible filter cards, per-session health details, and JID-resolved access control. Settings shows all config forms with tag-style inputs for JID fields, mention patterns, contact picker with search, and Save & Restart with polling overlay.

</domain>

<decisions>
## Implementation Decisions

### Dashboard Tab
- Per-session stat cards using shadcn Card component — each session gets its own section within filter cards (DM Keyword Filter, Group Keyword Filter, Presence System, Access Control)
- Health section shows per-session connection health (healthy/unhealthy, consecutive failures, last check)
- Human-readable labels: "wpm" → "Words Per Minute", "readDelayMs" → "Read Delay", "typingDurationMs" → "Typing Duration", "pauseChance" → "Pause Chance"
- Filter cards (DM Keyword, Group Keyword) are collapsible using shadcn Collapsible or Accordion
- Access Control resolves all JID formats (@c.us, @lid, bare numbers) to names using `/api/admin/directory/resolve` endpoint
- Data fetched from `/api/admin/stats` and `/api/admin/config`

### Settings Tab
- All settings rendered as React form components (shadcn Switch, Select, Input, Textarea)
- JID fields (Allow From, Group Allow From, Allowed Groups, God Mode Users) use shadcn Command/Combobox with name search via `/api/admin/directory` search endpoint
- Tag-style input for JID fields: type name → search dropdown → select → pill/bubble with x to remove
- Mention patterns use same tag-style input (enter pattern → pill → x to delete)
- Contact picker with search, clear button (x in search bar), dropdown auto-closes after selection
- Save button sends POST to `/api/admin/config` with `{"waha": {...}}` wrapper
- Save & Restart: shows blocking polling overlay, polls every 2s until gateway responds, same pattern as existing

### Claude's Discretion
- Exact card layout/spacing beyond shadcn defaults
- How to group settings sections (can follow existing tab's section grouping)
- Whether to use react-hook-form or uncontrolled inputs (both acceptable)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/admin/src/lib/api.ts` — API client with `getStats()`, `getConfig()`, `updateConfig()`, `getSessions()`, `resolveJids()` methods
- `src/admin/src/components/ui/` — shadcn Button, Separator, Sheet, DropdownMenu, Sidebar
- `src/admin/src/components/tabs/DashboardTab.tsx` — placeholder, accepts `selectedSession` + `refreshKey` props
- `src/admin/src/components/tabs/SettingsTab.tsx` — placeholder, same props

### Established Patterns
- Tab components receive `selectedSession` and `refreshKey` props from App.tsx
- Use `useEffect` with `refreshKey` as dependency to re-fetch data
- Dark/light theme via CSS classes and Tailwind utilities
- API client returns typed responses

### Integration Points
- Dashboard: `api.getStats()` → stat cards, `api.getConfig()` → filter settings display
- Settings: `api.getConfig()` → form state, `api.updateConfig()` → save, `api.restartGateway()` → restart
- JID resolution: `api.resolveJids()` or `/api/admin/directory?search=` for contact search
- Need to install more shadcn components: card, collapsible/accordion, input, select, switch, label, command, badge, popover

</code_context>

<specifics>
## Specific Ideas

Reference the existing admin panel behavior in `src/monitor.ts` (the embedded HTML/JS) for the exact data structures and API response shapes. The new React components should show the same information but with improved UX per the requirements.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
