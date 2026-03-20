---
phase: quick
plan: 260320-rii
subsystem: admin-ui
tags: [react, admin-panel, gui, feature-parity, old-gui-inventory]
key-files:
  modified:
    - src/admin/src/components/tabs/SettingsTab.tsx
    - src/admin/src/components/TabHeader.tsx
    - src/admin/src/components/tabs/DashboardTab.tsx
    - src/admin/src/components/tabs/SessionsTab.tsx
    - src/admin/src/components/tabs/DirectoryTab.tsx
    - src/admin/src/components/tabs/directory/ChannelsTab.tsx
    - src/admin/src/components/tabs/directory/GroupsTab.tsx
    - src/admin/src/App.tsx
    - src/admin/src/types.ts
decisions:
  - "Role/subRole in DashboardTab session card accessed via type assertion (StatsResponse.sessions lacks those fields) — no schema change needed, data comes from API"
  - "participantCount in GroupsTab cast via intersection type — field exists on API response but not in DirectoryContact type"
  - "Pairing Link Generator uses local state (not API) — constructs wa.me URL inline without calling /api/admin/pairing/deeplink"
  - "Filter badge fetches config once on mount — intentionally not re-fetched on tab change to avoid extra requests"
metrics:
  duration: "~20 minutes"
  completed: "2026-03-20"
  tasks_completed: 3
  files_modified: 9
---

# Quick Task 260320-rii: Restore All Missing Old GUI Features Summary

Restored all missing features from OLD-GUI-INVENTORY.md to the React admin panel. Every field, toggle, badge, and UI element from the legacy HTML/JS panel now exists in the React UI.

## What Was Done

### Task 1: SettingsTab + TabHeader gaps

**SettingsTab — Pairing Mode enhancements:**
- Added "Generate" button next to Passcode input (generates random 6-digit code via `Math.floor(100000 + Math.random() * 900000)`)
- Replaced "Grant TTL" number input with predefined `<Select>` dropdown: Never / 30 min / 1 hour / 4 hours / 24 hours / 7 days
- Added "Pairing Link Generator" section (visible when `pairingMode.enabled`): JID input + Generate Link button + read-only link output + Copy button

**SettingsTab — Active WAHA Session dropdown:**
- Added session dropdown in General Settings, fetches available sessions from `api.getSessions()` on mount
- Bound to `config.wahaSessionName`

**SettingsTab — Multi-Session Filtering Guide:**
- Added `Collapsible` info section after Section 10 (Actions), before Save buttons
- Static content: pipeline steps, scenarios (bot+human, human-only, DMs), God Mode Scope explanation, Per-Group Filter Overrides explanation

**TabHeader — Filter ON/OFF badge:**
- Fetches config once on mount via `api.getConfig()`
- Shows green `<Badge>` "Filter ON" if either dmFilter or groupFilter enabled, red `<Badge variant="destructive">` "Filter OFF" otherwise

**types.ts:**
- Added `wahaSessionName?: string` to `WahaConfig`

### Task 2: Dashboard, Sessions, Directory, Channels, Groups, Footer

**DashboardTab — Session Health card enhancements:**
- Added role badge (`<Badge variant="secondary">`), sub-role badge (`<Badge variant="outline">`), and WAHA status text to each session row
- Fields accessed via type assertion from API session object

**SessionsTab — Last Check timestamp:**
- Added `Last Check: {toLocaleTimeString()}` row to health details section

**DirectoryTab — Sync status + Summary counts + Refresh All:**
- Added sync status indicator (CheckCircle icon + "Ready") in toolbar
- Added Refresh All button calling `api.refreshDirectory()` then `refreshData()`
- Added summary counts row: "Contacts N | Groups N | Newsletters N | Showing X-Y of Z"

**ChannelsTab — Per-channel settings sheet:**
- Added `selectedJid` state and row click handler
- Imported and rendered `ContactSettingsSheet` identical to ContactsTab pattern
- Row click disabled in bulk mode

**GroupsTab — Members column:**
- Added `participantCount` column after JID, before Messages

**App.tsx — Footer:**
- Added footer below `<main>` with creator credit and GitHub links

### Task 3: Build verification

- `npm run build:admin` completed without errors
- Output: `dist/admin/` with index.html + JS + CSS chunks
- SettingsTab chunk: 37.42 kB, DirectoryTab: 76.66 kB, no regressions

## Deviations from Plan

None — plan executed exactly as written.

## OLD-GUI-INVENTORY.md Verification

- [x] Header: Filter ON/OFF badge, session dropdown, refresh button
- [x] Footer: Creator credit + GitHub link
- [x] Settings: All 10 sections + info guide, Active WAHA Session dropdown, Pairing Generate/Expiry/Link
- [x] Dashboard: Session Health card with role/sub-role badges, WAHA status
- [x] Sessions: Last Check timestamp per session
- [x] Directory: Sync status, summary counts, Refresh All, per-channel settings, Members column
- [x] Channels: Row click opens ContactSettingsSheet (same as Contacts)
- [x] Groups: Members column

## Self-Check

Commits exist:
- df8d2ad: Task 1 — Settings + TabHeader
- be3c87e: Task 2 — Dashboard/Sessions/Directory/Channels/Groups/Footer
- Build passed (dist/admin/ not tracked in git but verified locally)
