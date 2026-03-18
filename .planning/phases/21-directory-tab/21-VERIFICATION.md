---
phase: 21-directory-tab
verified: 2026-03-18T17:53:43Z
status: gaps_found
score: 16/17 must-haves verified
re_verification: false
gaps:
  - truth: "Groups sub-tab shows a paginated DataTable of groups with member count"
    status: partial
    reason: "GroupsTab.formatDate() passes Unix seconds directly to new Date(ts) without * 1000 multiplication. ContactsTab and ChannelsTab correctly use * 1000. Groups lastMessageAt will render as dates near January 1970."
    artifacts:
      - path: "src/admin/src/components/tabs/directory/GroupsTab.tsx"
        issue: "formatDate(ts) calls new Date(ts) on a Unix timestamp in seconds, not milliseconds. Lines 24-31."
    missing:
      - "Change line 26 in GroupsTab.tsx: new Date(ts) -> new Date(ts * 1000)"
---

# Phase 21: Directory Tab Verification Report

**Phase Goal:** The Directory tab is rebuilt as a full-featured data table with instant FTS search, a persistent contact settings sheet, bulk edit for all entity types, and correctly resolved participant names.
**Verified:** 2026-03-18T17:53:43Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DirectoryResponse type uses `contacts` array (not `items`) | VERIFIED | types.ts line 166: `contacts: DirectoryContact[]` |
| 2 | ParticipantEnriched uses `participantJid`, `displayName`, `allowInGroup`, `isBotSession` | VERIFIED | types.ts lines 230-240: all four fields present |
| 3 | api.bulkAllowAll sends `{ allowed: boolean }` not `{ allow: boolean }` | VERIFIED | api.ts line 123: `body: { allowed: boolean }` with DO NOT CHANGE comment |
| 4 | @tanstack/react-table and sonner are installed | VERIFIED | package.json: @tanstack/react-table@^8.21.3, sonner@^2.0.7 |
| 5 | DirectoryTab renders 3 sub-tabs (Contacts, Groups, Channels) via shadcn Tabs | VERIFIED | DirectoryTab.tsx lines 92-100: TabsTrigger value="contacts"/"groups"/"channels" |
| 6 | DataTable component renders @tanstack/react-table with server-side pagination | VERIFIED | DataTable.tsx: useReactTable, manualPagination: true, rowCount: total |
| 7 | Contacts sub-tab shows a paginated DataTable of contacts from the API | VERIFIED | ContactsTab.tsx: DataTable with ColumnDef<DirectoryContact>, 5 columns |
| 8 | Clicking a contact row opens a ContactSettingsSheet side panel | VERIFIED | ContactsTab.tsx line 168: onRowClick sets selectedJid; Sheet open={!!jid} |
| 9 | ContactSettingsSheet stays open after saving settings (no auto-close) | VERIFIED | ContactSettingsSheet.tsx lines 89-108: handleSave calls onSaved() only, not onClose() |
| 10 | Bulk edit mode on Contacts enables checkboxes with Allow DM / Revoke DM toolbar actions | VERIFIED | ContactsTab.tsx + BulkEditToolbar.tsx: entityType="contact", action strings "allow-dm"/"revoke-dm" |
| 11 | Channels sub-tab shows a paginated DataTable of newsletters | VERIFIED | ChannelsTab.tsx: DataTable with ColumnDef<DirectoryContact> |
| 12 | Bulk edit mode on Channels enables Follow / Unfollow actions | VERIFIED | ChannelsTab.tsx + BulkEditToolbar.tsx: entityType="newsletter", "follow"/"unfollow" |
| 13 | FTS5 search returns results without page reload | VERIFIED | DirectoryTab.tsx lines 34-41: 300ms debounce, calls api.getDirectory with search param |
| 14 | Groups sub-tab shows a paginated DataTable of groups | PARTIAL | GroupsTab.tsx exists with DataTable, but lastMessageAt dates render wrong (Unix seconds vs milliseconds) |
| 15 | Clicking a group row expands to show participants (lazy-loaded) | VERIFIED | GroupsTab.tsx: expandedRowId + renderExpandedRow; ParticipantRow lazy-fetches on mount |
| 16 | Participant names are resolved from server response (not client-side) | VERIFIED | ParticipantRow.tsx line 137: `p.displayName ?? p.participantJid`; server sets displayName in monitor.ts line 5435 |
| 17 | Bot session participants show a 'Bot' badge and have no Allow/Block buttons | VERIFIED | ParticipantRow.tsx lines 146-198: isBotSession check gates controls; Badge "Bot" shown |

**Score:** 16/17 truths verified (1 partial)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/admin/src/types.ts` | Fixed DirectoryResponse, DirectoryContact, ParticipantEnriched types | VERIFIED | DirectoryContact, ContactDmSettings, DirectoryResponse, ParticipantEnriched, ParticipantsResponse all present with correct field names |
| `src/admin/src/components/ui/table.tsx` | shadcn Table primitives | VERIFIED | Exports Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption |
| `src/admin/src/components/ui/tabs.tsx` | shadcn Tabs wrapper | VERIFIED | Exports Tabs, TabsList, TabsTrigger, TabsContent via @radix-ui/react-tabs |
| `src/admin/src/components/shared/DataTable.tsx` | Generic DataTable with pagination | VERIFIED | 163 lines, useReactTable v8, manualPagination, expandedRowId support |
| `src/admin/src/components/tabs/DirectoryTab.tsx` | Directory shell with 3 sub-tabs | VERIFIED | All 3 sub-tabs wired: ContactsTab, GroupsTab, ChannelsTab |
| `src/admin/src/components/tabs/directory/ContactsTab.tsx` | Contacts DataTable with row click, bulk select | VERIFIED | Row click opens sheet; BulkEditToolbar; ColumnDef<DirectoryContact> |
| `src/admin/src/components/tabs/directory/ContactSettingsSheet.tsx` | Side panel for contact DM settings | VERIFIED | Sheet with all fields; customKeywords split/join; save does not close |
| `src/admin/src/components/tabs/directory/ChannelsTab.tsx` | Channels DataTable with bulk select | VERIFIED | BulkEditToolbar entityType="newsletter" |
| `src/admin/src/components/tabs/directory/BulkEditToolbar.tsx` | Shared bulk action toolbar | VERIFIED | entityType-driven action set; only renders when selectedCount > 0 |
| `src/admin/src/components/tabs/directory/GroupsTab.tsx` | Groups DataTable with expandable rows | STUB (partial) | DataTable with expandable rows works, but formatDate has timestamp unit bug (seconds not milliseconds) |
| `src/admin/src/components/tabs/directory/ParticipantRow.tsx` | Lazy-loaded participants with bot badges and role controls | VERIFIED | getGroupParticipants on mount; isBotSession gate; all 3 controls for non-bot |
| `src/admin/src/main.tsx` | Sonner Toaster mounted | VERIFIED | `<Toaster richColors position="bottom-right" />` present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| DataTable.tsx | @tanstack/react-table | useReactTable with manualPagination | VERIFIED | Line 54-74: useReactTable, manualPagination: true, getCoreRowModel, flexRender |
| DirectoryTab.tsx | tabs.tsx | TabsTrigger | VERIFIED | Imports Tabs, TabsList, TabsTrigger, TabsContent; renders 3 TabsTrigger elements |
| ContactsTab.tsx | ContactSettingsSheet.tsx | setSelectedJid on row click | VERIFIED | Line 168: onRowClick sets selectedJid; Sheet open={!!jid} at line 128 |
| ContactSettingsSheet.tsx | api.updateDirectorySettings | PUT /api/admin/directory/:jid/settings on save | VERIFIED | Lines 93-98: api.updateDirectorySettings called in handleSave |
| BulkEditToolbar.tsx | api.bulkDirectory | POST /api/admin/directory/bulk | VERIFIED | ContactsTab.tsx line 115: api.bulkDirectory called in handleBulkAction |
| DirectoryTab.tsx | ContactsTab.tsx | ContactsTab in contacts TabsContent | VERIFIED | Line 14: import; lines 105-112: renders ContactsTab in TabsContent |
| GroupsTab.tsx | ParticipantRow.tsx | expandedRowId triggers ParticipantRow render | VERIFIED | Line 117: renderExpandedRow renders ParticipantRow with groupJid |
| ParticipantRow.tsx | api.getGroupParticipants | lazy fetch on first render | VERIFIED | Lines 34-46: useEffect on groupJid calls getGroupParticipants |
| ParticipantRow.tsx | api.toggleParticipantAllowGroup | Allow in Group toggle | VERIFIED | Line 66: toggleParticipantAllowGroup called with p.participantJid |
| ParticipantRow.tsx | api.updateParticipantRole | Role dropdown change | VERIFIED | Line 91: updateParticipantRole called in handleRoleChange |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DIR-01 | 21-01, 21-02, 21-03 | Contacts, Groups, Channels sub-tabs rebuilt with shadcn DataTable + pagination | SATISFIED | All 3 sub-tabs wired in DirectoryTab.tsx with DataTable, server-side pagination |
| DIR-02 | 21-03 | Search queries local SQLite via API (FTS5) — instant results | SATISFIED | DirectoryTab.tsx debounced search passes `search` param to api.getDirectory |
| DIR-03 | 21-02 | Contact settings panel as shadcn Sheet — stays open after save | SATISFIED | ContactSettingsSheet.tsx: onSaved() only, onClose() not called on save |
| DIR-04 | 21-02 | Bulk edit mode for Contacts and Channels | SATISFIED | ContactsTab.tsx + ChannelsTab.tsx both have bulkMode toggle + BulkEditToolbar |
| DIR-05 | 21-03 | Group participants resolve names from local DB, bot sessions shown with badge and no action buttons | SATISFIED | ParticipantRow.tsx: displayName from server; isBotSession gates controls; "Bot" Badge |
| DIR-06 | 21-01 | Bot's own sessions filtered from contacts list | SATISFIED | Server-side: monitor.ts line 4151 excludes bot JIDs from contacts; client displays unfiltered server response |
| DIR-07 | 21-01, 21-02 | Custom keywords use tag-style input | SATISFIED | ContactSettingsSheet.tsx lines 198-203: TagInput with freeform=true; split/join logic correct |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/admin/src/components/tabs/directory/GroupsTab.tsx` | 26 | `new Date(ts)` on Unix seconds — missing `* 1000` | BLOCKER | All group lastMessageAt dates display as ~Jan 1970 (wrong year by 53 years) |

### Human Verification Required

#### 1. Groups Tab Date Display

**Test:** Open the Directory tab, click Groups sub-tab, observe the "Last Message" column values.
**Expected:** Dates should show recent dates (e.g., "Mar 18, 2026") matching actual group activity.
**Why human:** The timestamp bug (seconds vs milliseconds) can only be confirmed visually — the dates will show as "Jan 01, 1970" or early 1970 dates if the bug is present.

#### 2. Contact Settings Sheet Persistence

**Test:** Click a contact row, modify any setting (e.g., toggle Mention Only), click "Save Settings".
**Expected:** Sheet remains open showing the same contact; toast "Settings saved" appears.
**Why human:** Sheet open/close behavior requires visual confirmation.

#### 3. FTS5 Search Responsiveness

**Test:** Type a partial name (3+ chars) in the search bar on the Contacts sub-tab.
**Expected:** Results update within ~300ms without a full page reload.
**Why human:** Search debounce behavior requires real interaction to confirm.

#### 4. Group Participant Expansion

**Test:** Click any group row in the Groups sub-tab.
**Expected:** Row expands showing participant names, Allow in Group / Allow DM toggles, Role dropdown for non-bot participants; bot participants show "Bot" badge with no controls.
**Why human:** Lazy load and expansion animation require visual confirmation.

### Gaps Summary

**One blocker found:**

`GroupsTab.tsx` contains a timestamp unit bug in the `formatDate` helper function (line 26). The function receives Unix timestamps in seconds (consistent with the rest of the codebase) but passes them directly to `new Date(ts)` which expects milliseconds. ContactsTab and ChannelsTab both correctly use `* 1000`. This causes the "Last Message" column in the Groups tab to display dates from the Unix epoch (around January 1970) instead of actual recent dates.

**Fix required:** Change line 26 in `src/admin/src/components/tabs/directory/GroupsTab.tsx`:
```
return new Date(ts).toLocaleDateString(...)
```
to:
```
return new Date(ts * 1000).toLocaleDateString(...)
```

All other phase goals are fully achieved. The foundation (DataTable, Tabs, types), contacts/channels tables, bulk edit, contact settings sheet, and group participant system with bot detection are all correctly implemented and wired.

---

_Verified: 2026-03-18T17:53:43Z_
_Verifier: Claude (gsd-verifier)_
