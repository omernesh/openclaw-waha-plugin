---
phase: 21-directory-tab
plan: 01
subsystem: ui
tags: [react, tanstack-react-table, shadcn, tabs, sonner, typescript, directory]

# Dependency graph
requires:
  - phase: 19-app-layout
    provides: App.tsx props pattern (selectedSession, refreshKey)
  - phase: 20-dashboard-settings
    provides: api.ts client, types.ts base, TagInput component

provides:
  - DirectoryContact and ParticipantEnriched types matching actual monitor.ts API shapes
  - shadcn Table primitives (table.tsx)
  - shadcn Tabs component (tabs.tsx)
  - Sonner Toaster mounted in main.tsx
  - DataTable generic component with server-side pagination, row selection, expandable rows
  - DirectoryTab shell with 3 sub-tabs (Contacts, Groups, Channels), debounced search, centralized data fetching

affects: [21-02, 21-03, 22-sessions-modules]

# Tech tracking
tech-stack:
  added:
    - "@tanstack/react-table@8.21.3 — headless table with v8 API (useReactTable)"
    - "sonner@2.0.7 — toast notifications"
    - "@radix-ui/react-tabs@1.1.13 — Radix primitive for Tabs component"
  patterns:
    - "DataTable with manualPagination: true for all directory sub-tabs"
    - "DirectoryTab fetches data centrally, sub-tabs receive data as props"
    - "Debounced search 300ms with pageIndex reset on new query (matches TagInput pattern)"

key-files:
  created:
    - src/admin/src/components/ui/table.tsx
    - src/admin/src/components/ui/tabs.tsx
    - src/admin/src/components/shared/DataTable.tsx
  modified:
    - src/admin/src/types.ts
    - src/admin/src/lib/api.ts
    - src/admin/src/main.tsx
    - src/admin/src/components/tabs/DirectoryTab.tsx
    - src/admin/src/components/tabs/SettingsTab.tsx

key-decisions:
  - "DirectoryTab fetches data centrally and will pass contacts/total/loading down to sub-tab components (Plans 02/03) — avoids duplicate fetches"
  - "DataTable uses getRowId defaulting to .jid field — all directory entries have jid"
  - "sidebar.tsx HTMLMainElement pre-existing error deferred to Phase 23 (out of scope)"

patterns-established:
  - "Pattern: shadcn Table primitives written manually (no CLI) — same as Phase 19"
  - "Pattern: @tanstack/react-table v8 API — useReactTable (not useTable), getCoreRowModel() required"
  - "Pattern: manualPagination: true + rowCount: total for all server-paginated tables"

requirements-completed: [DIR-06, DIR-07]

# Metrics
duration: 5min
completed: 2026-03-18
---

# Phase 21 Plan 01: Directory Tab Foundation Summary

**shadcn Table/Tabs primitives + @tanstack/react-table DataTable + DirectoryTab shell with 3 sub-tabs, debounced FTS5 search, and corrected API types**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-18T17:35:55Z
- **Completed:** 2026-03-18T17:40:51Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Fixed critical type mismatches: `DirectoryResponse` now uses `contacts` (not `items`), `ParticipantEnriched` uses `participantJid`/`displayName`/`allowInGroup`/`isBotSession`
- Fixed `api.ts` bug: `bulkAllowAll` body field corrected from `{ allow }` to `{ allowed }` (matches monitor.ts line 5537)
- Installed `@tanstack/react-table@8.21.3`, `sonner@2.0.7`, `@radix-ui/react-tabs@1.1.13`
- Created shadcn Table and Tabs primitives (written manually, no CLI — Phase 19 precedent)
- Created generic `DataTable` component with server-side pagination, row selection, expandable rows
- Created `DirectoryTab` shell: 3 sub-tabs, search bar, centralized data fetching, debounced search

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix types, fix api.ts bug, install deps** - `19e34ac` (feat)
2. **Task 2: Create shadcn Table, Tabs, Sonner primitives** - `3d25eb3` (feat)
3. **Task 3: Create DataTable wrapper and DirectoryTab shell with 3 sub-tabs** - `88b936d` (feat)

**Plan metadata:** (docs commit after state updates)

## Files Created/Modified
- `src/admin/src/types.ts` - Replaced DirectoryEntry/Participant with DirectoryContact/ParticipantEnriched matching actual API shapes
- `src/admin/src/lib/api.ts` - Fixed bulkAllowAll body ({ allow } -> { allowed }), fixed bulkDirectory return type
- `src/admin/src/main.tsx` - Added Sonner Toaster (richColors, bottom-right)
- `src/admin/src/components/ui/table.tsx` - NEW: shadcn Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption
- `src/admin/src/components/ui/tabs.tsx` - NEW: shadcn Tabs, TabsList, TabsTrigger, TabsContent (wraps @radix-ui/react-tabs)
- `src/admin/src/components/shared/DataTable.tsx` - NEW: generic DataTable with @tanstack/react-table v8, server-side pagination, row selection, expandable rows
- `src/admin/src/components/tabs/DirectoryTab.tsx` - Replaced placeholder with 3 sub-tab shell, debounced search, centralized data fetch
- `src/admin/src/components/tabs/SettingsTab.tsx` - Auto-fixed: result.items -> result.contacts, item.name -> item.displayName

## Decisions Made
- DirectoryTab fetches data centrally and will pass contacts/total/loading down to sub-tab components in Plans 02 and 03 — avoids duplicate fetches per sub-tab
- DataTable `getRowId` defaults to `.jid` field since all directory entries have a JID
- Pre-existing `sidebar.tsx HTMLMainElement` TypeScript error is out of scope — deferred to Phase 23

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed SettingsTab.tsx using old DirectoryResponse.items**
- **Found during:** Task 1 (after changing DirectoryResponse type)
- **Issue:** SettingsTab.tsx line 99 accessed `result.items.map((item) => ({ ..., label: item.name || item.jid }))` — which no longer exists after type fix
- **Fix:** Changed to `result.contacts.map((item) => ({ ..., label: item.displayName || item.jid }))`
- **Files modified:** `src/admin/src/components/tabs/SettingsTab.tsx`
- **Verification:** TypeScript compile passed after fix
- **Committed in:** `19e34ac` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug caused by type correction)
**Impact on plan:** Necessary correctness fix. No scope creep.

## Issues Encountered
- Pre-existing `HTMLMainElement` TypeScript error in `sidebar.tsx` (line 295). Confirmed pre-existing via git stash verification. Logged to `deferred-items.md`.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- `DataTable` component is ready for use by ContactsTab (Plan 02) and GroupsTab/ChannelsTab (Plan 03)
- `Tabs`, `Table` primitives available for all downstream directory components
- `DirectoryTab` shell ready to receive sub-tab components in Plans 02 and 03
- Types are correct — no risk of silent undefined errors from `contacts` vs `items` mismatch

## Self-Check: PASSED

- FOUND: `src/admin/src/components/ui/table.tsx`
- FOUND: `src/admin/src/components/ui/tabs.tsx`
- FOUND: `src/admin/src/components/shared/DataTable.tsx`
- FOUND: commit `19e34ac` (Task 1)
- FOUND: commit `3d25eb3` (Task 2)
- FOUND: commit `88b936d` (Task 3)
- VERIFIED: `DirectoryContact` interface present in types.ts
- VERIFIED: `ParticipantEnriched` interface with `allowAll: boolean` in ParticipantsResponse
- VERIFIED: `bulkAllowAll` uses `{ allowed: boolean }` in api.ts

---
*Phase: 21-directory-tab*
*Completed: 2026-03-18*
