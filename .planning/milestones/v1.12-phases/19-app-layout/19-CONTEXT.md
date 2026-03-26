# Phase 19: App Layout - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the complete admin panel navigation shell with shadcn/ui Sidebar component, all 7 tab routes, dark/light theme toggle via CSS variables and localStorage, mobile-responsive sidebar (collapses to sheet/drawer under 768px), and a consistent per-tab header with session selector and refresh button.

</domain>

<decisions>
## Implementation Decisions

### Navigation Structure
- Use shadcn/ui Sidebar component for left-side navigation
- 7 tabs in order: Dashboard, Settings, Directory, Sessions, Modules, Log, Queue
- Use lucide-react icons for each tab (LayoutDashboard, Settings, BookUser, MonitorSmartphone, Puzzle, FileText, ListOrdered)
- Active tab highlighted with accent color
- React state-based routing (useState for active tab) — no need for react-router since it's a single-page admin panel

### Theme System
- Dark/light toggle using shadcn/ui built-in `class` strategy (add/remove `dark` class on `<html>`)
- Persist choice to localStorage key `waha-admin-theme`
- Default to dark (matches current admin panel default)
- Theme toggle button in sidebar footer or header

### Mobile Responsiveness
- Below 768px: sidebar hidden, accessible via hamburger button that opens a Sheet (shadcn/ui Sheet component)
- Sheet closes on tab selection
- Content area takes full width on mobile

### Per-Tab Header
- Consistent header bar at top of each tab's content area
- Contains: tab title (h1), session selector dropdown (if applicable), refresh button
- Session selector populated from `/api/admin/sessions` API
- Refresh button triggers tab-specific data reload

### Claude's Discretion
- Exact spacing, padding, color values beyond shadcn/ui defaults
- Animation/transition details
- Exact icon choices (suggestions above are guidance, not locked)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/admin/src/lib/api.ts` — API client created in Phase 18
- `src/admin/src/index.css` — shadcn/ui dark/light theme CSS variables already configured
- `src/admin/src/App.tsx` — current placeholder, will be replaced with layout shell

### Established Patterns
- shadcn/ui components copied into `src/admin/src/components/ui/`
- Tailwind utility classes for responsive design
- CSS variables for theming (already set up in Phase 18)

### Integration Points
- App.tsx: replace placeholder with Sidebar + content area layout
- Need to install shadcn/ui components: sidebar, sheet, button, dropdown-menu, separator
- Each tab will be a React component (placeholder for now, real content in Phases 20-22)

</code_context>

<specifics>
## Specific Ideas

Follow the shadcn/ui Sidebar documentation pattern. See `.planning/research/ui-framework-research.md` section 5 for architecture reference.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
