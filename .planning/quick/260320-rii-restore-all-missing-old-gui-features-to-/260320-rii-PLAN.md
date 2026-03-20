---
phase: quick
plan: 260320-rii
type: execute
wave: 1
depends_on: []
files_modified:
  - src/admin/src/components/tabs/SettingsTab.tsx
  - src/admin/src/components/tabs/DashboardTab.tsx
  - src/admin/src/components/tabs/SessionsTab.tsx
  - src/admin/src/components/tabs/DirectoryTab.tsx
  - src/admin/src/components/tabs/directory/ChannelsTab.tsx
  - src/admin/src/components/tabs/directory/GroupsTab.tsx
  - src/admin/src/components/TabHeader.tsx
  - src/admin/src/App.tsx
autonomous: true
requirements: []

must_haves:
  truths:
    - "Every field, toggle, dropdown, tooltip, and badge from OLD-GUI-INVENTORY.md exists in the React admin panel"
    - "Settings tab has all 10 sections + Multi-Session Filtering Guide info section"
    - "Dashboard shows filter ON/OFF badge in header"
    - "Directory shows sync status, summary counts, and Refresh All"
    - "Channels have per-channel settings sheet identical to Contacts"
    - "Sessions tab shows full health details per session"
    - "Pairing section has Generate passcode button, expiry dropdown, and link generator"
  artifacts:
    - path: "src/admin/src/components/tabs/SettingsTab.tsx"
      provides: "All 10 settings sections + info guide + pairing enhancements"
    - path: "src/admin/src/components/tabs/DashboardTab.tsx"
      provides: "Enhanced session detail cards"
    - path: "src/admin/src/components/tabs/SessionsTab.tsx"
      provides: "Full health details per session"
    - path: "src/admin/src/components/tabs/DirectoryTab.tsx"
      provides: "Sync status, summary counts, Refresh All"
    - path: "src/admin/src/components/tabs/directory/ChannelsTab.tsx"
      provides: "Per-channel settings sheet via row click"
    - path: "src/admin/src/components/tabs/directory/GroupsTab.tsx"
      provides: "Member count column"
    - path: "src/admin/src/components/TabHeader.tsx"
      provides: "Filter ON/OFF badge"
  key_links:
    - from: "ChannelsTab.tsx"
      to: "ContactSettingsSheet.tsx"
      via: "row click opens sheet with channel JID"
      pattern: "ContactSettingsSheet"
---

<objective>
Restore ALL missing old GUI features to the new React admin panel, using docs/OLD-GUI-INVENTORY.md as the definitive field-level reference.

Purpose: The v1.12 React migration missed several features from the legacy HTML/JS admin panel. This plan adds every missing field, tooltip, toggle, dropdown, badge, and UI element back.
Output: Complete feature parity between old GUI and new React admin panel.
</objective>

<execution_context>
@C:/Users/omern/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/omern/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@docs/OLD-GUI-INVENTORY.md
@src/admin/src/components/tabs/SettingsTab.tsx
@src/admin/src/components/tabs/DashboardTab.tsx
@src/admin/src/components/tabs/SessionsTab.tsx
@src/admin/src/components/tabs/DirectoryTab.tsx
@src/admin/src/components/tabs/directory/ChannelsTab.tsx
@src/admin/src/components/tabs/directory/GroupsTab.tsx
@src/admin/src/components/tabs/directory/ContactSettingsSheet.tsx
@src/admin/src/components/TabHeader.tsx
@src/admin/src/App.tsx
@src/admin/src/components/AppSidebar.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Settings Tab + Header gaps (Pairing, Info Guide, Filter Badge)</name>
  <files>
    src/admin/src/components/tabs/SettingsTab.tsx
    src/admin/src/components/TabHeader.tsx
  </files>
  <action>
**SettingsTab.tsx — Pairing Mode section enhancements:**
1. Add a "Generate" button next to the Passcode input that generates a random 6-digit numeric code and sets it in config. Use: `String(Math.floor(100000 + Math.random() * 900000))`. Style: small outline button to the right of the input, in a flex row.
2. Change "Grant TTL" from raw number input to a `<Select>` dropdown with predefined durations matching old GUI: "Never" (0), "30 minutes" (30), "1 hour" (60), "4 hours" (240), "24 hours" (1440), "7 days" (10080). Tooltip: "How long pairing-granted access lasts. After this period, access is automatically revoked."
3. Add "Pairing Link Generator" field below challenge message: a text input for JID with a "Generate Link" button. When clicked, construct a `https://wa.me/{phone}?text={passcode}` link (strip @c.us from JID to get phone). Show the generated link in a read-only input with a "Copy" button. Wrap in a div that is only visible when pairing mode is enabled (`config.pairingMode?.enabled`).

**SettingsTab.tsx — Section 11: Multi-Session Filtering Guide:**
Add a collapsible info section AFTER Section 10 (Actions) and BEFORE the Save/Restart buttons. Use `Collapsible` + `Card` pattern. Title: "Multi-Session Filtering Guide". Content is static explanatory text covering:
- How messages flow through the guardrails (numbered pipeline)
- Scenarios: Bot + Human session in same group, Only human session in group, DMs
- Bot prefix explanation
- God Mode Scope explanation (all/dm/off)
- Per-Group Filter Overrides explanation
Import `Collapsible, CollapsibleContent, CollapsibleTrigger` from `@/components/ui/collapsible` and `ChevronDown` from lucide-react. Default collapsed.

**SettingsTab.tsx — Active WAHA Session dropdown:**
In Section 1 (General Settings / Connection), add an "Active WAHA Session" dropdown. Fetch available sessions from `api.getSessions()` on mount (same pattern as TabHeader). Store in local state. Render as a `<Select>` with options from the sessions list. Bind to `config.wahaSessionName`. Tooltip: "WAHA session name. Select from sessions available on your WAHA server."

**TabHeader.tsx — Filter ON/OFF badge:**
Add a filter status badge in the header between the title and the session dropdown. Fetch config once on mount via `api.getConfig()` to check if `dmFilter.enabled` or `groupFilter.enabled` is true. If either is enabled, show a green `<Badge>` with text "Filter ON". If both disabled, show a red `<Badge variant="destructive">` with text "Filter OFF". Use the existing Badge component.
  </action>
  <verify>
    <automated>cd D:/docker/waha-oc-plugin && npx tsc --noEmit -p src/admin/tsconfig.json 2>&1 | head -30</automated>
  </verify>
  <done>
    - Pairing section has Generate button, expiry dropdown with predefined durations, and pairing link generator
    - Multi-Session Filtering Guide collapsible info section present after Actions
    - Active WAHA Session dropdown in General Settings
    - Filter ON/OFF badge visible in header bar
  </done>
</task>

<task type="auto">
  <name>Task 2: Dashboard, Sessions, Directory, and Channel gaps</name>
  <files>
    src/admin/src/components/tabs/DashboardTab.tsx
    src/admin/src/components/tabs/SessionsTab.tsx
    src/admin/src/components/tabs/DirectoryTab.tsx
    src/admin/src/components/tabs/directory/ChannelsTab.tsx
    src/admin/src/components/tabs/directory/GroupsTab.tsx
    src/admin/src/App.tsx
  </files>
  <action>
**DashboardTab.tsx — Enhanced Sessions card:**
The old GUI Dashboard Session card showed per-session: role badge (e.g. "bot" in blue), sub-role badge (e.g. "full-access" in green), WAHA status, Base URL, Webhook Port, Server Time, Last Success, Last Check. The current React Dashboard Session Health card only shows health status + failures.

Add to each session row in the Session Health card:
- Role badge: `<Badge variant="secondary">{session.role}</Badge>` and sub-role badge: `<Badge variant="outline">{session.subRole}</Badge>` — these fields already exist on the session object from the API.
- WAHA Status text: `session.wahaStatus` (already in session data, currently shown only in SessionsTab)
- A small collapsible detail section (use a toggle or click-to-expand) showing: Base URL (`stats.baseUrl`), Webhook Port (`stats.webhookPort`), Server Time (`stats.serverTime`), Last Success (if available from session data).

**SessionsTab.tsx — Additional health fields:**
The old GUI showed per-session: Base URL, Webhook Port, Server Time, Health metric, Last Success, Last Check. Add these fields to each session card in the health details section. Base URL and Webhook Port come from the shared stats (fetch from `/api/admin/stats` or pass as props). For now, show them as additional text rows in the health details `<div>`:
- `WAHA Status: {session.wahaStatus || '—'}` (already present)
- Add: `Last Check: {session.lastCheck ? new Date(session.lastCheck).toLocaleTimeString() : '—'}`
- The session card already shows `consecutiveFailures` — keep that.

**DirectoryTab.tsx — Sync status + Summary counts + Refresh All:**
1. Add a sync status indicator above the search bar. Call `api.getSyncState?.()` or check if a `/api/admin/sync` endpoint exists — if it does, show sync status (checkmark + "Synced" or "Sync not started"). If no endpoint, show a static "Ready" indicator.
2. Add summary counts row below the sub-tabs showing: "Contacts {data.dms} | Groups {data.groups} | Newsletters {data.newsletters} | Showing {offset+1}-{offset+data.contacts.length} of {data.total}". Use the existing `data` state which already has `dms`, `groups`, `newsletters`, `total` fields.
3. Add a "Refresh All" button next to the search bar (or in a toolbar row). It should call `api.refreshDirectory()` (POST /api/admin/directory/refresh) then trigger a data reload via `refreshData()`.

**ChannelsTab.tsx — Per-channel settings via row click:**
The old GUI had the same expandable per-contact settings panel for channels (Mode, Mention Only, Custom Keywords, Can Initiate, Access Expires, Save). The React ChannelsTab currently has NO row click action.

Add row click support identical to ContactsTab:
1. Add `selectedJid` state and `setSelectedJid` on row click (when not in bulk mode)
2. Import and render `ContactSettingsSheet` with the selected channel's data
3. Pass `onRowClick={bulkMode ? undefined : (row) => setSelectedJid(row.jid)}` to DataTable
4. Find selectedContact from data array, pass to ContactSettingsSheet

**GroupsTab.tsx — Member count column:**
The old GUI Groups table had a "Members" column showing member count. Add a `memberCount` column to the columns array:
```
{
  accessorKey: 'participantCount',
  header: 'Members',
  cell: ({ row }) => <span className="text-sm">{row.original.participantCount ?? '—'}</span>,
}
```
Place it after JID column and before Messages column. The `participantCount` field should already exist on `DirectoryContact` from the API — if not, it will show '—'.

**App.tsx — Footer:**
Add a footer below the main content area (after `</main>`) inside `SidebarInset`:
```jsx
<footer className="border-t px-4 py-2 text-xs text-muted-foreground text-center">
  Created with love by{' '}
  <a href="https://github.com/omernesh" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
    omer nesher
  </a>
  {' — '}
  <a href="https://github.com/omernesh/openclaw-waha-plugin" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
    GitHub
  </a>
</footer>
```
  </action>
  <verify>
    <automated>cd D:/docker/waha-oc-plugin && npx tsc --noEmit -p src/admin/tsconfig.json 2>&1 | head -30</automated>
  </verify>
  <done>
    - Dashboard Session Health card shows role/sub-role badges and WAHA status per session
    - SessionsTab shows last check timestamp per session
    - DirectoryTab shows summary counts row with contact/group/newsletter totals and pagination range
    - DirectoryTab has Refresh All button
    - ChannelsTab supports row click opening ContactSettingsSheet (same as ContactsTab)
    - GroupsTab has Members column
    - App footer with creator credit and GitHub link
  </done>
</task>

<task type="auto">
  <name>Task 3: Build, verify, and validate all features visually</name>
  <files>
    src/admin/src/components/tabs/SettingsTab.tsx
    src/admin/src/components/tabs/DashboardTab.tsx
  </files>
  <action>
Build the admin panel and verify no errors:
1. `cd src/admin && npm run build` — must complete without errors
2. If TypeScript errors occur from missing type fields (e.g. `participantCount` on `DirectoryContact`, `wahaSessionName` on `WahaConfig`, `role`/`subRole` on session stats), add the missing optional fields to `src/admin/src/types.ts`
3. If `api.refreshDirectory()` doesn't exist in `src/admin/src/lib/api.ts`, add it: `refreshDirectory: () => fetch('/api/admin/directory/refresh', { method: 'POST' }).then(r => r.json())`
4. Verify the build output in `dist/admin/` is complete (index.html + JS + CSS assets)
5. Cross-check the OLD-GUI-INVENTORY.md one final time against the completed React components — every feature listed must have a corresponding React UI element. If any gap is found, fix it inline.

Final verification checklist against OLD-GUI-INVENTORY.md:
- [ ] Tab 1 Dashboard: 5 cards (DM Filter, Group Filter, Presence, Access Control, Sessions w/ full detail)
- [ ] Tab 2 Settings: 10 sections + 1 info guide, all tooltips, Active WAHA Session dropdown, Pairing Generate/Expiry/Link
- [ ] Tab 3 Directory: 3 sub-tabs, search, Refresh All, sync status, summary counts, per-contact/channel settings, group members column
- [ ] Tab 4 Queue: DM/Group depth, overflow drops, processed stats
- [ ] Tab 5 Sessions: role/sub-role dropdowns, full health details, Save & Restart
- [ ] Tab 6 Modules: list, enable/disable, assignments
- [ ] Tab 7 Log: filter, level buttons, auto-scroll, export, source info
- [ ] Header: filter badge, session dropdown, refresh
- [ ] Footer: creator credit
- [ ] Theme toggle: sidebar
  </action>
  <verify>
    <automated>cd D:/docker/waha-oc-plugin/src/admin && npm run build 2>&1 | tail -10</automated>
  </verify>
  <done>
    - Admin panel builds without errors
    - All OLD-GUI-INVENTORY.md features verified present in React components
    - dist/admin/ contains valid build output
  </done>
</task>

</tasks>

<verification>
1. `cd src/admin && npx tsc --noEmit -p tsconfig.json` — no type errors
2. `cd src/admin && npm run build` — successful build
3. Cross-reference every row in OLD-GUI-INVENTORY.md against the React source — all features present
</verification>

<success_criteria>
- Every field, toggle, dropdown, tooltip, and badge from OLD-GUI-INVENTORY.md exists in the React admin panel
- Admin panel builds without errors
- No existing features broken (no regressions)
</success_criteria>

<output>
After completion, create `.planning/quick/260320-rii-restore-all-missing-old-gui-features-to-/260320-rii-SUMMARY.md`
</output>
