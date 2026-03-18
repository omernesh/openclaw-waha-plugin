# Requirements: WAHA OpenClaw Plugin

**Defined:** 2026-03-18
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.12 Requirements

Requirements for the UI Overhaul milestone. Each maps to roadmap phases.

### Scaffold

- [x] **SCAF-01**: Vite + React + TypeScript project initialized in `src/admin/` with build output to `dist/admin/`
- [x] **SCAF-02**: shadcn/ui initialized with Tailwind CSS, dark/light theme via CSS variables
- [x] **SCAF-03**: monitor.ts serves static files from `dist/admin/` instead of embedded HTML strings
- [x] **SCAF-04**: API client utility wraps all `/api/admin/*` calls with error handling
- [x] **SCAF-05**: npm package updated to include Vite build output, `build` script chains `tsc` + `vite build`

### Layout

- [x] **LYOT-01**: Sidebar navigation with all 7 tabs (Dashboard, Settings, Directory, Sessions, Modules, Log, Queue)
- [x] **LYOT-02**: Dark/light theme toggle persisted to localStorage
- [x] **LYOT-03**: Mobile-responsive layout (sidebar collapses to sheet/drawer on small screens)
- [x] **LYOT-04**: Consistent header with session selector and refresh button per tab

### Dashboard Tab

- [x] **DASH-01**: Dashboard cards rebuilt as React Card components with per-session stats
- [x] **DASH-02**: Health section shows per-session health details
- [x] **DASH-03**: Human-readable labels throughout — no raw config keys
- [x] **DASH-04**: Filter cards are collapsible
- [x] **DASH-05**: Access Control resolves all JID formats (@c.us, @lid, bare numbers) to names

### Settings Tab

- [x] **SETT-01**: All settings rebuilt as React form components (switches, selects, inputs)
- [x] **SETT-02**: Tag inputs use shadcn Command/Combobox with name search for JID fields
- [x] **SETT-03**: Mention patterns use tag-style input
- [x] **SETT-04**: Contact picker with search, clear button, and auto-close behavior
- [x] **SETT-05**: Save & Restart with polling overlay

### Directory Tab

- [x] **DIR-01**: Contacts, Groups, Channels sub-tabs rebuilt with shadcn DataTable + pagination
- [x] **DIR-02**: Search queries local SQLite via API (FTS5) — instant results
- [x] **DIR-03**: Contact settings panel as shadcn Sheet/Dialog — stays open after save
- [x] **DIR-04**: Bulk edit mode for Contacts and Channels — same pattern as Groups
- [x] **DIR-05**: Group participants resolve names from local DB, bot sessions shown with badge and no action buttons
- [x] **DIR-06**: Bot's own sessions filtered from contacts list
- [x] **DIR-07**: Custom keywords and group override keywords use tag-style input

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
| SCAF-01 | Phase 18 | Complete |
| SCAF-02 | Phase 18 | Complete |
| SCAF-03 | Phase 18 | Complete |
| SCAF-04 | Phase 18 | Complete |
| SCAF-05 | Phase 18 | Complete |
| LYOT-01 | Phase 19 | Complete |
| LYOT-02 | Phase 19 | Complete |
| LYOT-03 | Phase 19 | Complete |
| LYOT-04 | Phase 19 | Complete |
| DASH-01 | Phase 20 | Complete |
| DASH-02 | Phase 20 | Complete |
| DASH-03 | Phase 20 | Complete |
| DASH-04 | Phase 20 | Complete |
| DASH-05 | Phase 20 | Complete |
| SETT-01 | Phase 20 | Complete |
| SETT-02 | Phase 20 | Complete |
| SETT-03 | Phase 20 | Complete |
| SETT-04 | Phase 20 | Complete |
| SETT-05 | Phase 20 | Complete |
| DIR-01 | Phase 21 | Complete |
| DIR-02 | Phase 21 | Complete |
| DIR-03 | Phase 21 | Complete |
| DIR-04 | Phase 21 | Complete |
| DIR-05 | Phase 21 | Complete |
| DIR-06 | Phase 21 | Complete |
| DIR-07 | Phase 21 | Complete |
| SESS-01 | Phase 22 | Pending |
| SESS-02 | Phase 22 | Pending |
| SESS-03 | Phase 22 | Pending |
| MODS-01 | Phase 22 | Pending |
| LOGT-01 | Phase 22 | Pending |
| QUEU-01 | Phase 22 | Pending |
| PLSH-01 | Phase 23 | Pending |
| PLSH-02 | Phase 23 | Pending |
| PLSH-03 | Phase 23 | Pending |
| PLSH-04 | Phase 23 | Pending |
| CLNP-03 | Phase 23 | Pending |
| CLNP-01 | Phase 24 | Pending |
| CLNP-02 | Phase 24 | Pending |

**Coverage:**
- v1.12 requirements: 38 total
- Mapped to phases: 38/38
- Unmapped: 0

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 — traceability complete after roadmap creation*
