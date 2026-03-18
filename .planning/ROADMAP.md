# Roadmap: WAHA OpenClaw Plugin

## Milestones

- ✅ **v1.10 Admin Panel & Multi-Session** — Phases 1-11 (shipped 2026-03-16)
- ✅ **v1.11 Polish, Sync & Features** — Phases 12-17 (shipped 2026-03-18)
- 🚧 **v1.12 UI Overhaul & Feature Polish** — Phases 18-24 (Active)

## Phases

<details>
<summary>✅ v1.10 Admin Panel & Multi-Session (Phases 1-11) — SHIPPED 2026-03-16</summary>

- [x] Phase 1: Reliability Foundation (3/3 plans) — completed 2026-03-11
- [x] Phase 2: Resilience and Observability (2/2 plans) — completed 2026-03-11
- [x] Phase 3: Feature Gaps (3/3 plans) — completed 2026-03-11
- [x] Phase 4: Multi-Session (4/4 plans) — completed 2026-03-13
- [x] Phase 5: Documentation and Testing (2/2 plans) — completed 2026-03-13
- [x] Phase 6: WhatsApp Rules and Policy System (4/4 plans) — completed 2026-03-13
- [x] Phase 7: Admin Panel Critical Fixes (2/2 plans) — completed 2026-03-15
- [x] Phase 8: Shared UI Components (2/2 plans) — completed 2026-03-16
- [x] Phase 9: Settings UX Improvements (2/2 plans) — completed 2026-03-16
- [x] Phase 10: Directory & Group Enhancements (2/2 plans) — completed 2026-03-16
- [x] Phase 11: Dashboard, Sessions & Log (2/2 plans) — completed 2026-03-16

Full details: `.planning/milestones/v1.10-ROADMAP.md`

</details>

<details>
<summary>✅ v1.11 Polish, Sync & Features (Phases 12-17) — SHIPPED 2026-03-18</summary>

- [x] Phase 12: UI Bug Sprint (5/5 plans) — completed 2026-03-17
- [x] Phase 13: Background Directory Sync (2/2 plans) — completed 2026-03-17
- [x] Phase 14: Name Resolution (2/2 plans) — completed 2026-03-17
- [x] Phase 15: TTL Access (3/3 plans) — completed 2026-03-17
- [x] Phase 16: Pairing Mode and Auto-Reply (3/3 plans) — completed 2026-03-17
- [x] Phase 17: Modules Framework (3/3 plans) — completed 2026-03-17

Audit: `.planning/v1.11-MILESTONE-AUDIT.md`

</details>

### 🚧 v1.12 UI Overhaul & Feature Polish (Phases 18-24)

**Milestone Goal:** Replace ~5500 lines of embedded HTML/JS in monitor.ts with a React SPA built on shadcn/ui + Tailwind CSS + Vite, preserving all existing admin panel functionality while gaining mobile responsiveness, accessibility, and maintainability.

- [x] **Phase 18: React Scaffold** — Vite + React + shadcn/ui foundation and build pipeline (completed 2026-03-18)
- [x] **Phase 19: App Layout** — Sidebar navigation, theme toggle, mobile responsiveness, shared header (completed 2026-03-18)
- [ ] **Phase 20: Dashboard and Settings Tabs** — Dashboard cards and Settings form rebuilt in React
- [ ] **Phase 21: Directory Tab** — DataTable with search, participants, bulk edit, contact sheet
- [ ] **Phase 22: Sessions, Modules, Log, and Queue Tabs** — Remaining four tabs rebuilt in React
- [ ] **Phase 23: Polish** — Toasts, skeletons, error boundaries, refresh timestamps
- [ ] **Phase 24: Cleanup and Deploy** — Remove legacy HTML/JS from monitor.ts, update build pipeline

## Phase Details

### Phase 18: React Scaffold
**Goal**: A working Vite + React + shadcn/ui project is initialized, builds successfully, and the admin panel URL serves the React app instead of the embedded HTML string.
**Depends on**: Nothing (first phase of milestone)
**Requirements**: SCAF-01, SCAF-02, SCAF-03, SCAF-04, SCAF-05
**Success Criteria** (what must be TRUE):
  1. Navigating to the admin panel URL in a browser shows a React app (not the old HTML string), even if the content is a blank/placeholder page
  2. Running `npm run build` completes without errors, producing output in `dist/admin/`
  3. The API client utility can call any `/api/admin/*` endpoint and surface errors (not silently swallow them)
  4. Dark and light CSS variables are present in the Tailwind theme configuration
  5. The npm package includes the built `dist/admin/` output when published
**Plans**: 2 plans
Plans:
- [x] 18-01-PLAN.md — Vite + React + Tailwind scaffold, API client, package.json updates
- [x] 18-02-PLAN.md — Static file serving in monitor.ts + browser verification

### Phase 19: App Layout
**Goal**: The admin panel has a complete navigation shell with all 7 tabs reachable, a working dark/light theme toggle, a mobile-responsive sidebar, and a consistent per-tab header.
**Depends on**: Phase 18
**Requirements**: LYOT-01, LYOT-02, LYOT-03, LYOT-04
**Success Criteria** (what must be TRUE):
  1. All 7 tab names (Dashboard, Settings, Directory, Sessions, Modules, Log, Queue) are visible in the sidebar and clicking each navigates to that tab's content area
  2. Clicking the theme toggle switches between dark and light mode; reopening the browser tab restores the last-chosen theme
  3. On a mobile viewport (under 768px), the sidebar is hidden and accessible via a hamburger/sheet drawer
  4. Each tab has a consistent header area with a session selector and a refresh button
**Plans**: 2 plans
Plans:
- [ ] 19-01-PLAN.md — Install shadcn/ui components, theme hook, tab placeholders
- [ ] 19-02-PLAN.md — AppSidebar, TabHeader, App.tsx layout shell with routing

### Phase 20: Dashboard and Settings Tabs
**Goal**: The Dashboard and Settings tabs are fully rebuilt as React components, displaying all information from the old panel with improved UX — labeled cards, collapsible sections, and accessible form controls.
**Depends on**: Phase 19
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, SETT-01, SETT-02, SETT-03, SETT-04, SETT-05
**Success Criteria** (what must be TRUE):
  1. Dashboard shows per-session stat cards with human-readable labels (no raw config keys); health section shows per-session connection state
  2. Filter cards on Dashboard can be collapsed and expanded; Access Control section resolves @c.us, @lid, and bare numbers to human names
  3. All Settings controls (switches, selects, text inputs) render as proper React form components and submit changes to the backend
  4. JID fields in Settings use a tag-style input with name search (Combobox/Command); mention patterns use tag-style input
  5. Save & Restart shows a blocking overlay while the gateway restarts and polling confirms it is back up
**Plans**: 2 plans
Plans:
- [ ] 20-01-PLAN.md — Radix primitives, shadcn components, types fix, labels, TagInput, RestartOverlay, DashboardTab
- [ ] 20-02-PLAN.md — SettingsTab with config form, tag inputs, contact picker, Save & Restart
### Phase 21: Directory Tab
**Goal**: The Directory tab is rebuilt as a full-featured data table with instant FTS search, a persistent contact settings sheet, bulk edit for all entity types, and correctly resolved participant names.
**Depends on**: Phase 19
**Requirements**: DIR-01, DIR-02, DIR-03, DIR-04, DIR-05, DIR-06, DIR-07
**Success Criteria** (what must be TRUE):
  1. Contacts, Groups, and Channels each have a sub-tab with a paginated DataTable showing all entries from the local SQLite database
  2. Typing in the search box returns results instantly (FTS5 via API) without a full page reload
  3. Opening a contact's settings panel (sheet/dialog) stays open after saving settings — the user does not need to re-open it
  4. Bulk edit mode is available on Contacts and Channels tabs (matching the existing Groups pattern) with a multi-select toolbar
  5. Group participant rows resolve names from the local DB; bot session rows show a badge and have no allow/block action buttons
  6. The bot's own session JIDs do not appear in the contacts list
**Plans**: 2 plans
Plans:
- [ ] 18-01-PLAN.md — Vite + React + Tailwind scaffold, API client, package.json updates
- [ ] 18-02-PLAN.md — Static file serving in monitor.ts + browser verification

### Phase 22: Sessions, Modules, Log, and Queue Tabs
**Goal**: The four remaining tabs — Sessions, Modules, Log, and Queue — are fully rebuilt as React components with all existing functionality intact.
**Depends on**: Phase 19
**Requirements**: SESS-01, SESS-02, SESS-03, MODS-01, LOGT-01, QUEU-01
**Success Criteria** (what must be TRUE):
  1. Sessions tab shows each session as a card with labeled role and subRole dropdowns accompanied by explanatory text; saving a role change shows an optimistic update followed by a "Restart required" notice
  2. Save & Restart on the Sessions tab shows a blocking overlay identical in behavior to the one in Settings
  3. Modules tab lists all registered modules with enable/disable toggles, inline config forms, and group/contact assignment pickers
  4. Log tab displays log entries with virtual scrolling (no browser freeze on large logs), level filter chips, and a search box with a clear button
  5. Queue tab displays current queue status (DM queue depth, group queue depth, processing state) as React components
**Plans**: 2 plans
Plans:
- [ ] 18-01-PLAN.md — Vite + React + Tailwind scaffold, API client, package.json updates
- [ ] 18-02-PLAN.md — Static file serving in monitor.ts + browser verification

### Phase 23: Polish
**Goal**: The React admin panel has consistent loading states, graceful error handling, actionable toast notifications, and visible refresh timestamps across all tabs.
**Depends on**: Phase 20, Phase 21, Phase 22
**Requirements**: PLSH-01, PLSH-02, PLSH-03, PLSH-04, CLNP-03
**Success Criteria** (what must be TRUE):
  1. All user-facing success and error events (save config, restart, allow/block toggle) surface as Sonner toast notifications instead of browser alerts or the custom old toast system
  2. Every data-fetching tab shows Skeleton placeholder components while the initial fetch is in flight
  3. If one tab's API call fails completely, that tab shows an error state without crashing the rest of the panel
  4. Refresh buttons show a spinner while fetching and display a "Last refreshed HH:MM:SS" timestamp after completion
  5. Tooltips in the Directory and Settings tabs render correctly above table overflow boundaries (via React portals, no clipping)
**Plans**: 2 plans
Plans:
- [ ] 18-01-PLAN.md — Vite + React + Tailwind scaffold, API client, package.json updates
- [ ] 18-02-PLAN.md — Static file serving in monitor.ts + browser verification

### Phase 24: Cleanup and Deploy
**Goal**: The old embedded HTML/JS/CSS is removed from monitor.ts, the build and deploy pipeline is updated to include the Vite build, and the panel is verified end-to-end on hpg6.
**Depends on**: Phase 23
**Requirements**: CLNP-01, CLNP-02
**Success Criteria** (what must be TRUE):
  1. The `getAdminPageHtml()` function and all inline CSS/JS strings are removed from monitor.ts — the file serves only API routes and static file serving logic
  2. Running `npm run build` chains `tsc` and `vite build` in one command and the output is ready to publish
  3. The deploy script (or documented workflow) copies `dist/admin/` to both hpg6 locations alongside the TypeScript build output
  4. The admin panel on hpg6 loads the React build and all 7 tabs function correctly after deployment
**Plans**: 2 plans
Plans:
- [ ] 18-01-PLAN.md — Vite + React + Tailwind scaffold, API client, package.json updates
- [ ] 18-02-PLAN.md — Static file serving in monitor.ts + browser verification

## Progress

**Execution Order:** 18 → 19 → 20 → 21 → 22 → 23 → 24

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Reliability Foundation | v1.10 | 3/3 | Complete | 2026-03-11 |
| 2. Resilience and Observability | v1.10 | 2/2 | Complete | 2026-03-11 |
| 3. Feature Gaps | v1.10 | 3/3 | Complete | 2026-03-11 |
| 4. Multi-Session | v1.10 | 4/4 | Complete | 2026-03-13 |
| 5. Documentation and Testing | v1.10 | 2/2 | Complete | 2026-03-13 |
| 6. WhatsApp Rules and Policy System | v1.10 | 4/4 | Complete | 2026-03-13 |
| 7. Admin Panel Critical Fixes | v1.10 | 2/2 | Complete | 2026-03-15 |
| 8. Shared UI Components | v1.10 | 2/2 | Complete | 2026-03-16 |
| 9. Settings UX Improvements | v1.10 | 2/2 | Complete | 2026-03-16 |
| 10. Directory & Group Enhancements | v1.10 | 2/2 | Complete | 2026-03-16 |
| 11. Dashboard, Sessions & Log | v1.10 | 2/2 | Complete | 2026-03-16 |
| 12. UI Bug Sprint | v1.11 | 5/5 | Complete | 2026-03-17 |
| 13. Background Directory Sync | v1.11 | 2/2 | Complete | 2026-03-17 |
| 14. Name Resolution | v1.11 | 2/2 | Complete | 2026-03-17 |
| 15. TTL Access | v1.11 | 3/3 | Complete | 2026-03-17 |
| 16. Pairing Mode and Auto-Reply | v1.11 | 3/3 | Complete | 2026-03-17 |
| 17. Modules Framework | v1.11 | 3/3 | Complete | 2026-03-17 |
| 18. React Scaffold | v1.12 | 2/2 | Complete | 2026-03-18 |
| 19. App Layout | 2/2 | Complete    | 2026-03-18 | - |
| 20. Dashboard and Settings Tabs | 1/2 | In Progress|  | - |
| 21. Directory Tab | v1.12 | 0/TBD | Not started | - |
| 22. Sessions, Modules, Log, and Queue Tabs | v1.12 | 0/TBD | Not started | - |
| 23. Polish | v1.12 | 0/TBD | Not started | - |
| 24. Cleanup and Deploy | v1.12 | 0/TBD | Not started | - |
