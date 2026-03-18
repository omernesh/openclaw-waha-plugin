# Requirements: WAHA OpenClaw Plugin

**Defined:** 2026-03-18
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.12 Requirements

Requirements for the UI Overhaul milestone. Each maps to roadmap phases.

### Scaffold

- [ ] **SCAF-01**: Vite + React + TypeScript project initialized in `src/admin/` with build output to `dist/admin/`
- [ ] **SCAF-02**: shadcn/ui initialized with Tailwind CSS, dark/light theme via CSS variables
- [ ] **SCAF-03**: monitor.ts serves static files from `dist/admin/` instead of embedded HTML strings
- [ ] **SCAF-04**: API client utility wraps all `/api/admin/*` calls with error handling
- [ ] **SCAF-05**: npm package updated to include Vite build output, `build` script chains `tsc` + `vite build`

### Layout

- [ ] **LYOT-01**: Sidebar navigation with all 7 tabs (Dashboard, Settings, Directory, Sessions, Modules, Log, Queue)
- [ ] **LYOT-02**: Dark/light theme toggle persisted to localStorage
- [ ] **LYOT-03**: Mobile-responsive layout (sidebar collapses to sheet/drawer on small screens)
- [ ] **LYOT-04**: Consistent header with session selector and refresh button per tab

### Dashboard Tab

- [ ] **DASH-01**: Dashboard cards rebuilt as React Card components with per-session stats
- [ ] **DASH-02**: Health section shows per-session health details
- [ ] **DASH-03**: Human-readable labels throughout — no raw config keys
- [ ] **DASH-04**: Filter cards are collapsible
- [ ] **DASH-05**: Access Control resolves all JID formats (@c.us, @lid, bare numbers) to names

### Settings Tab

- [ ] **SETT-01**: All settings rebuilt as React form components (switches, selects, inputs)
- [ ] **SETT-02**: Tag inputs use shadcn Command/Combobox with name search for JID fields
- [ ] **SETT-03**: Mention patterns use tag-style input
- [ ] **SETT-04**: Contact picker with search, clear button, and auto-close behavior
- [ ] **SETT-05**: Save & Restart with polling overlay

### Directory Tab

- [ ] **DIR-01**: Contacts, Groups, Channels sub-tabs rebuilt with shadcn DataTable + pagination
- [ ] **DIR-02**: Search queries local SQLite via API (FTS5) — instant results
- [ ] **DIR-03**: Contact settings panel as shadcn Sheet/Dialog — stays open after save
- [ ] **DIR-04**: Bulk edit mode for Contacts and Channels — same pattern as Groups
- [ ] **DIR-05**: Group participants resolve names from local DB, bot sessions shown with badge and no action buttons
- [ ] **DIR-06**: Bot's own sessions filtered from contacts list
- [ ] **DIR-07**: Custom keywords and group override keywords use tag-style input

### Sessions Tab

- [ ] **SESS-01**: Session cards rebuilt with labeled role/subRole dropdowns
- [ ] **SESS-02**: Explanatory text for role options (bot/human, full-access/listener)
- [ ] **SESS-03**: Optimistic role save with "Restart required" notice, Save & Restart with overlay

### Modules Tab

- [ ] **MODS-01**: Modules list with enable/disable toggles, config forms, group/contact assignment pickers

### Log Tab

- [ ] **LOGT-01**: Log viewer rebuilt with virtual scrolling, level filtering, search with clear button

### Queue Tab

- [ ] **QUEU-01**: Queue status display rebuilt as React components

### Polish

- [ ] **PLSH-01**: Toast notifications via Sonner (replace custom toast system)
- [ ] **PLSH-02**: Loading states with Skeleton components on all data-fetching tabs
- [ ] **PLSH-03**: Error boundaries per tab (graceful failure isolation)
- [ ] **PLSH-04**: Refresh buttons show spinner + "Last refreshed" timestamp

### Cleanup

- [ ] **CLNP-01**: Remove all embedded HTML/JS/CSS from monitor.ts (~4000+ lines)
- [ ] **CLNP-02**: Deploy pipeline updated — build:admin + scp to both hpg6 locations
- [ ] **CLNP-03**: Tooltips render above overflow boundaries via proper React portals

## Future Requirements

### v1.13+ Candidates

- **MOD-01**: Channel moderator module (content moderation, auto-warnings)
- **MOD-02**: Event planner module (scheduling, RSVPs, reminders)
- **PERF-01**: Code-splitting per tab (lazy-load heavy tabs like Directory)
- **A11Y-01**: Full WCAG 2.1 AA audit and remediation

## Out of Scope

| Feature | Reason |
|---------|--------|
| Next.js / SSR framework | Vite SPA is sufficient — no SEO needs for admin panel |
| React Aria migration | shadcn/ui on Radix provides sufficient accessibility |
| Backend API changes | API routes stay unchanged — frontend-only rewrite |
| New backend features | v1.12 is UI-only — no new WhatsApp capabilities |
| Cross-platform module abstraction | Modules are WhatsApp-specific per decision |
| Real-time WebSocket updates | Polling is sufficient for admin panel refresh rates |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCAF-01 | TBD | Pending |
| SCAF-02 | TBD | Pending |
| SCAF-03 | TBD | Pending |
| SCAF-04 | TBD | Pending |
| SCAF-05 | TBD | Pending |
| LYOT-01 | TBD | Pending |
| LYOT-02 | TBD | Pending |
| LYOT-03 | TBD | Pending |
| LYOT-04 | TBD | Pending |
| DASH-01 | TBD | Pending |
| DASH-02 | TBD | Pending |
| DASH-03 | TBD | Pending |
| DASH-04 | TBD | Pending |
| DASH-05 | TBD | Pending |
| SETT-01 | TBD | Pending |
| SETT-02 | TBD | Pending |
| SETT-03 | TBD | Pending |
| SETT-04 | TBD | Pending |
| SETT-05 | TBD | Pending |
| DIR-01 | TBD | Pending |
| DIR-02 | TBD | Pending |
| DIR-03 | TBD | Pending |
| DIR-04 | TBD | Pending |
| DIR-05 | TBD | Pending |
| DIR-06 | TBD | Pending |
| DIR-07 | TBD | Pending |
| SESS-01 | TBD | Pending |
| SESS-02 | TBD | Pending |
| SESS-03 | TBD | Pending |
| MODS-01 | TBD | Pending |
| LOGT-01 | TBD | Pending |
| QUEU-01 | TBD | Pending |
| PLSH-01 | TBD | Pending |
| PLSH-02 | TBD | Pending |
| PLSH-03 | TBD | Pending |
| PLSH-04 | TBD | Pending |
| CLNP-01 | TBD | Pending |
| CLNP-02 | TBD | Pending |
| CLNP-03 | TBD | Pending |

**Coverage:**
- v1.12 requirements: 38 total
- Mapped to phases: 0 (awaiting roadmap)
- Unmapped: 38

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after initial definition*
