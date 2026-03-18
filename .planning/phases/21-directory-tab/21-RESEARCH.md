# Phase 21: Directory Tab - Research

**Researched:** 2026-03-18
**Domain:** React DataTable, shadcn UI, @tanstack/react-table, admin panel API integration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Three sub-tabs within Directory: Contacts, Groups, Channels
- Use shadcn Tabs component for sub-tab navigation
- Each sub-tab has its own DataTable with pagination
- Install @tanstack/react-table for sortable, filterable, paginated tables
- Pagination via API (limit/offset params on `/api/admin/directory`)
- Search input at top of each sub-tab, queries FTS5 via `/api/admin/directory?search=&type=`, instant with debounced API call
- Contact settings as shadcn Sheet (side panel) on row click; fields: mode, Can Initiate, TTL, custom keywords; stays open after save; save sends PUT to `/api/admin/directory/:jid/settings`; success toast on save
- Bulk edit on Contacts and Channels sub-tabs; "Select" button enables checkboxes; bulk action toolbar
- Group participants expandable row, lazy-loaded via `/api/admin/directory/group/:groupJid/participants`
- Names resolved from local DB, bot session participants with "Bot" badge, no Allow/Block buttons for bot sessions
- Non-bot participants show Allow, Allow DM, Role dropdown
- Contacts list filters out JIDs matching any configured session via api.getSessions()
- Custom keywords in contact settings use TagInput component (from Phase 20)
- Group filter override keywords also use TagInput

### Claude's Discretion
- Exact column widths and table styling
- Whether to use row expansion or a separate panel for group participants
- Debounce timing for search (200-500ms range)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DIR-01 | Bot session exclusion from contacts list | Server already filters bot JIDs from `type=contact` responses (botJidCache, 5-min TTL); client needs no extra filtering |
| DIR-02 | Resolved participant names with bot badges | Server returns `isBotSession: boolean` and `globallyAllowed: boolean` on each participant; client just reads these fields |
| DIR-03 | Participant role management (bot_admin/manager/participant) | PUT `/api/admin/directory/group/:groupJid/participants/:participantJid/role`, values validated server-side |
| DIR-04 | Bulk edit mode for Contacts and Channels | POST `/api/admin/directory/bulk` with `{action, jids[], value?, groupJid?}`; valid actions: allow-dm, revoke-dm, allow-group, revoke-group, set-role, follow, unfollow |
| DIR-05 | Contact settings Sheet | PUT `/api/admin/directory/:jid/settings` accepts mode, mentionOnly, customKeywords, canInitiate, canInitiateOverride |
| DIR-06 | FTS5 search via API | GET `/api/admin/directory?search=&type=&limit=&offset=` — FTS5-backed, returns `{ contacts, total, dms, groups, newsletters }` |
| DIR-07 | Pagination | Same endpoint, limit max 200, offset, returns `total` for page count |
</phase_requirements>

## Summary

Phase 21 rebuilds the Directory tab placeholder into a full-featured three-sub-tab (Contacts, Groups, Channels) DataTable using `@tanstack/react-table` v8, shadcn `Tabs`, and server-side pagination/FTS5 search. All backend API routes are already complete and battle-tested. The only new package needed is `@tanstack/react-table` — all shadcn UI components (`Sheet`, `Checkbox`, `Badge`, `Select`, `Switch`, etc.) are already installed. A `Tabs` component and a `sonner`-based toast need to be added as new shadcn components (written manually, as per the Phase 19 pattern of no CLI access).

**Critical type mismatch to fix first:** The existing `DirectoryResponse` type in `types.ts` uses `{ items, total, offset, limit }` but the actual API returns `{ contacts, total, dms, groups, newsletters }`. The planner must fix this type before using the API client.

**Primary recommendation:** Install `@tanstack/react-table`, add `Tabs` and `Sonner` shadcn components manually, fix `DirectoryResponse` type, then build three sub-tab DataTables using the verified API patterns below.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-table | 8.21.3 (latest) | Headless table: sorting, pagination, row selection | Industry standard for React DataTables; pairs perfectly with shadcn DataTable pattern |
| @radix-ui/react-tabs | 1.1.13 (already in dep tree) | Sub-tab navigation | Radix primitive underlying shadcn Tabs |
| sonner | 2.0.7 (latest) | Toast notifications for save feedback | Lightweight, composable, used in shadcn ecosystem |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.577.0 (installed) | Icons: ChevronDown, Check, X, Search, User | All icon needs |
| shadcn Checkbox | already installed (@radix-ui/react-checkbox) | Row selection checkboxes | Bulk edit mode |
| shadcn Select | already installed (@radix-ui/react-select) | Role dropdown in participants | Role picker |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @tanstack/react-table | AG Grid, react-data-grid | Far heavier; shadcn DataTable pattern is built on @tanstack |
| sonner | shadcn Toast (useToast) | sonner is simpler, fewer files; shadcn toast requires Toaster + useToast hook boilerplate |
| Expandable row for participants | Separate drawer/sheet | Row expansion keeps context; locked decision allows discretion here |

**Installation (in `D:\docker\waha-oc-plugin` root — not inside `src/admin`):**
```bash
cd D:/docker/waha-oc-plugin
npm install @tanstack/react-table@^8.21.3 @radix-ui/react-tabs@^1.1.13 sonner@^2.0.7
```

**Version verification:** Confirmed against npm registry 2026-03-18:
- `@tanstack/react-table`: 8.21.3
- `@radix-ui/react-tabs`: 1.1.13
- `sonner`: 2.0.7

## Architecture Patterns

### Recommended Project Structure
```
src/admin/src/
├── components/
│   ├── ui/
│   │   ├── table.tsx          # NEW: shadcn table primitives (Table, TableBody, etc.)
│   │   ├── tabs.tsx           # NEW: shadcn Tabs (Tabs, TabsList, TabsTrigger, TabsContent)
│   ├── shared/
│   │   ├── TagInput.tsx       # EXISTING — reuse as-is
│   │   ├── DataTable.tsx      # NEW: generic @tanstack DataTable wrapper
│   ├── tabs/
│   │   ├── DirectoryTab.tsx   # REPLACE placeholder with full implementation
│   │   ├── directory/
│   │   │   ├── ContactsTab.tsx       # Contacts sub-tab
│   │   │   ├── GroupsTab.tsx         # Groups sub-tab
│   │   │   ├── ChannelsTab.tsx       # Channels sub-tab
│   │   │   ├── ContactSettingsSheet.tsx  # Contact settings side panel
│   │   │   ├── ParticipantRow.tsx    # Expandable participant list
│   │   │   └── BulkEditToolbar.tsx   # Bulk action toolbar
├── types.ts                   # UPDATE: fix DirectoryResponse type mismatch
```

### Pattern 1: @tanstack/react-table with shadcn DataTable
**What:** Define columns with `ColumnDef[]`, create table with `useReactTable()`, render with shadcn `<Table>` primitives.
**When to use:** All three sub-tabs — same pattern, different column definitions.
**Example:**
```typescript
// Source: @tanstack/react-table v8 documentation
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
} from '@tanstack/react-table'

const columns: ColumnDef<DirectoryContact>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
      />
    ),
    enableSorting: false,
  },
  { accessorKey: 'displayName', header: 'Name' },
  { accessorKey: 'jid', header: 'JID' },
  // ...
]

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  manualPagination: true,  // server-side pagination
  rowCount: total,
  onRowSelectionChange: setRowSelection,
  state: { rowSelection, pagination },
})
```

### Pattern 2: Server-Side Pagination
**What:** `manualPagination: true` on the table, track `{ pageIndex, pageSize }` in React state, convert to `offset = pageIndex * pageSize` for API calls.
**When to use:** All three sub-tabs — API supports `limit` (max 200) and `offset`.
```typescript
const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 })
const offset = pagination.pageIndex * pagination.pageSize
// On pagination change, re-fetch:
useEffect(() => {
  api.getDirectory({ type: 'contact', limit: String(pagination.pageSize), offset: String(offset) })
    .then(r => { setData(r.contacts); setTotal(r.total) })
}, [pagination, searchQuery, refreshKey])
```

### Pattern 3: Debounced Search
**What:** Controlled input, debounce updates to query state, page resets to 0 on new search.
**When to use:** Search bar at top of each sub-tab.
```typescript
const [searchInput, setSearchInput] = useState('')
const [searchQuery, setSearchQuery] = useState('')
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

function handleSearchChange(val: string) {
  setSearchInput(val)
  if (debounceRef.current) clearTimeout(debounceRef.current)
  debounceRef.current = setTimeout(() => {
    setSearchQuery(val)
    setPagination(p => ({ ...p, pageIndex: 0 }))  // Reset to first page on new search
  }, 300)
}
```
**Debounce timing:** 300ms (within the 200-500ms range from discretion area; matches TagInput's existing 300ms).

### Pattern 4: Expandable Participant Rows
**What:** Track `expandedGroupJid: string | null` in state. Clicking a group row sets it. A `<tr>` below the row renders `<ParticipantRow>` which lazy-fetches participants on first render.
**When to use:** Groups sub-tab.
```typescript
// In GroupsTab — expanded row rendered directly in table body
{table.getRowModel().rows.map(row => (
  <>
    <TableRow key={row.id} onClick={() => setExpanded(row.original.jid === expanded ? null : row.original.jid)}>
      {row.getVisibleCells().map(cell => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
    </TableRow>
    {expanded === row.original.jid && (
      <TableRow>
        <TableCell colSpan={columns.length}>
          <ParticipantRow groupJid={row.original.jid} />
        </TableCell>
      </TableRow>
    )}
  </>
))}
```

### Pattern 5: Established Tab Props Pattern
All tab components receive `{ selectedSession: string, refreshKey: number }` — per App.tsx lifted state. `refreshKey` dependency in `useEffect` triggers re-fetch.

### Anti-Patterns to Avoid
- **Client-side pagination:** Never load all records and paginate in memory. The API is server-side paginated; always use `manualPagination: true`.
- **Separate fetches per row for name resolution:** Use batch `api.resolveNames()` for all unresolved JIDs at once (max 500 per call).
- **Polling for participant changes:** Participants are lazy-loaded once per expanded row; only re-fetch on explicit user action.
- **Using `getCoreRowModel` with client-sort on server-paginated data:** Sorting is not required per CONTEXT decisions; if added later, must be server-side too.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Table with row selection, pagination | Custom table components | @tanstack/react-table + shadcn table.tsx | 50+ edge cases in selection state, pagination sync, accessible keyboard nav |
| Toast/save feedback | Custom notification div | sonner `toast()` | Z-index, animation, auto-dismiss, stacking — all solved |
| Sub-tab navigation | Custom tab switcher | shadcn Tabs (Radix primitive) | Keyboard nav, ARIA roles, focus management |
| FTS5 search debounce | Complex debounce logic | 5-line setTimeout pattern (as in TagInput.tsx) | Already established in codebase |
| Bot session detection | Client-side JID matching | Server already sends `isBotSession: boolean` on participant objects | Server resolves LID→@c.us for bot matching; client cannot do this reliably |

**Key insight:** The server already does the hard work — bot exclusion from contacts list (DIR-01), bot session badges on participants (DIR-02 via `isBotSession` field), and name resolution via `resolveLidToCus()`. The client just needs to render what the server returns.

## Common Pitfalls

### Pitfall 1: DirectoryResponse Type Mismatch
**What goes wrong:** `types.ts` defines `DirectoryResponse` as `{ items: DirectoryEntry[], total, offset, limit }` but the actual API at line 4855 returns `{ contacts, total, dms, groups, newsletters }`. Using the wrong type causes silent undefined errors.
**Why it happens:** Type was drafted as a placeholder in Phase 18; never matched against actual monitor.ts output.
**How to avoid:** Fix `DirectoryResponse` first thing in Wave 0:
```typescript
// Correct shape from monitor.ts line 4855
export interface DirectoryResponse {
  contacts: DirectoryContact[]
  total: number
  dms: number
  groups: number
  newsletters: number
}
export interface DirectoryContact {
  jid: string
  displayName: string | null
  firstSeenAt: number
  lastMessageAt: number
  messageCount: number
  isGroup: boolean
  dmSettings?: ContactDmSettings
  allowedDm: boolean
  expiresAt: number | null
  expired: boolean
  source: string | null
}
```
**Warning signs:** TypeScript errors on `response.items` or missing `contacts` property.

### Pitfall 2: Participant Response Shape Mismatch
**What goes wrong:** `types.ts` `Participant` type uses `{ jid, name?, role?, allowGroup?, allowDm? }` but the actual API at line 5432 returns `{ ...GroupParticipant, globallyAllowed: boolean, isBotSession: boolean }` where `GroupParticipant` has `participantJid` (not `jid`), `displayName` (not `name`), `allowInGroup` (not `allowGroup`).
**Why it happens:** Another placeholder type that wasn't reconciled with monitor.ts.
**How to avoid:** Fix the `Participant` type and `ParticipantsResponse`:
```typescript
export interface ParticipantEnriched {
  groupJid: string
  participantJid: string          // NOT jid
  displayName: string | null      // NOT name
  isAdmin: boolean
  allowInGroup: boolean           // NOT allowGroup
  allowDm: boolean
  participantRole: 'bot_admin' | 'manager' | 'participant'
  globallyAllowed: boolean        // enrichment from server
  isBotSession: boolean           // enrichment from server — use to show bot badge
}
export interface ParticipantsResponse {
  participants: ParticipantEnriched[]
  allowAll: boolean               // group-level allow-all status
}
```

### Pitfall 3: Allow-All Response Shape
**What goes wrong:** The `/api/admin/directory/group/:groupJid/allow-all` endpoint is `POST` but the current `api.bulkAllowAll()` sends `{ allow: boolean }`. The handler at line 5537 reads `{ allowed: boolean }` (note: `allowed` not `allow`).
**Why it happens:** Naming inconsistency between api.ts method and monitor.ts handler.
**How to avoid:** Fix `bulkAllowAll` in api.ts to send `{ allowed: boolean }` or add a note to the plan to verify. Confirmed from monitor.ts line 5537: `const { allowed } = JSON.parse(bodyStr)`.

### Pitfall 4: Page Reset on Search
**What goes wrong:** User is on page 3, types a new search term — results fetch page 3 of the new search (likely empty) instead of page 1.
**Why it happens:** Forgetting to reset `pageIndex` to 0 when search query changes.
**How to avoid:** Always reset pagination when search changes: `setPagination(p => ({ ...p, pageIndex: 0 }))` in the debounce callback.

### Pitfall 5: Bulk Endpoint Before /:jid Routes
**What goes wrong:** A bulk request to `/api/admin/directory/bulk` matches the `/:jid` handler if routing order is wrong. This is already handled server-side at line 5150 ("CRITICAL: exact URL match placed BEFORE generic routes"). Client-side: ensure `api.bulkDirectory()` calls `/directory/bulk` exactly (no trailing slash).
**Why it happens:** The server comment documents this for future developers.
**How to avoid:** No client-side risk — `api.bulkDirectory` already uses exact path. Just document awareness.

### Pitfall 6: ContactDmSettings customKeywords is a Comma-Separated String
**What goes wrong:** `customKeywords` is stored and returned as a comma-separated string (`"word1,word2"`), but TagInput works with `string[]`. Must split/join on save and load.
**Why it happens:** DB schema stores `custom_keywords TEXT DEFAULT ''`; the API passes through raw DB value.
**How to avoid:** In `ContactSettingsSheet`:
- Load: `const keywords = (entry.dmSettings?.customKeywords ?? '').split(',').filter(Boolean)`
- Save: `customKeywords: keywords.join(',')`

### Pitfall 7: @tanstack/react-table v8 API (not v7)
**What goes wrong:** Using v7 API (`useTable`, `usePagination` hooks) instead of v8 API (`useReactTable` single function).
**Why it happens:** Lots of v7 code in Stack Overflow and older tutorials.
**How to avoid:** Always use `useReactTable({ getCoreRowModel: getCoreRowModel(), ... })` — the v8 pattern. The `@tanstack/react-table@8.21.3` package exports `useReactTable`, not `useTable`.

## Code Examples

Verified patterns from official sources:

### GET /api/admin/directory — Actual Response Shape
```typescript
// Source: monitor.ts lines 4843-4855 (verified 2026-03-18)
// Response: { contacts: EnrichedContact[], total: number, dms: number, groups: number, newsletters: number }
// Each contact is ContactRecord + { allowedDm, expiresAt, expired, source }
// For type=contact: bot JIDs already excluded server-side (botJidCache)
// For type=group: is_group=1 contacts
// For type=newsletter: jid LIKE '%@newsletter'
```

### GET /api/admin/directory/group/:groupJid/participants — Actual Response Shape
```typescript
// Source: monitor.ts lines 5432-5440 (verified 2026-03-18)
// Response: { participants: EnrichedParticipant[], allowAll: boolean }
// EnrichedParticipant = GroupParticipant + { globallyAllowed: boolean, isBotSession: boolean }
// GroupParticipant fields: groupJid, participantJid, displayName, isAdmin, allowInGroup, allowDm, participantRole
// Bot detection: server fetches /api/sessions/{session}/me, checks role === "bot"
```

### PUT /api/admin/directory/:jid/settings — Request Body
```typescript
// Source: monitor.ts lines 4870-4900 (verified 2026-03-18)
{
  mode?: 'active' | 'listen_only',
  mentionOnly?: boolean,
  customKeywords?: string,       // comma-separated, e.g. "word1,word2"
  canInitiate?: boolean,
  canInitiateOverride?: 'default' | 'allow' | 'block'  // INIT-02: 3-state override
}
// Returns: { ok: true }
// Note: creates contact if not exists (db.upsertContact)
```

### POST /api/admin/directory/bulk — Request Body
```typescript
// Source: monitor.ts lines 5154-5176 (verified 2026-03-18)
{
  jids: string[],          // max 500
  action: 'allow-dm' | 'revoke-dm' | 'allow-group' | 'revoke-group' | 'set-role' | 'follow' | 'unfollow',
  value?: string,          // required for set-role: 'bot_admin' | 'manager' | 'participant'
  groupJid?: string,       // required for allow-group, revoke-group, set-role
}
// Returns: { ok: true, updated: number }
```

### POST /api/admin/directory/:jid/allow-dm — Request Body
```typescript
// Source: monitor.ts lines 5287-5294 (verified 2026-03-18)
{ allowed: boolean }
// Returns: { ok: true }
// Also syncs to openclaw.json allowFrom config
```

### POST /api/admin/directory/group/:groupJid/allow-all — VERIFIED NAME
```typescript
// Source: monitor.ts line 5537 (verified 2026-03-18)
// IMPORTANT: handler reads { allowed: boolean } (not { allow: boolean })
// api.ts bulkAllowAll() currently sends { allow: boolean } — THIS IS A BUG IN api.ts
// Fix in Wave 0: change api.ts bulkAllowAll to send { allowed: boolean }
{ allowed: boolean }
// Returns: { ok: true }
```

### @tanstack/react-table v8 Row Selection
```typescript
// Source: @tanstack/react-table v8 docs
const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  onRowSelectionChange: setRowSelection,
  state: { rowSelection },
  manualPagination: true,
  rowCount: total,
})

// Get selected JIDs:
const selectedJids = table.getSelectedRowModel().rows.map(row => row.original.jid)
```

### shadcn Tabs Component (manual — no CLI)
```typescript
// Pattern: manual write, no @shadcn/ui CLI (Phase 19 precedent)
// Base: @radix-ui/react-tabs (already in package.json dependencies)
// File: src/admin/src/components/ui/tabs.tsx
import * as TabsPrimitive from '@radix-ui/react-tabs'
// ...standard shadcn tabs implementation
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Embedded HTML/JS string directory tab | React component with @tanstack/react-table | Phase 21 (this phase) | Type-safe, maintainable, keyboard-accessible |
| Monitor.ts v7-style useTable | @tanstack/react-table v8 useReactTable | v8 released 2022 | Single function API, no hook composition |
| Client-side name resolution per-row | Batch resolve via /directory/resolve (max 500) | Phase 14 (NAME-01) | Single round trip for all visible names |
| FTS5 not available for search | FTS5 with prefix matching via contacts_fts virtual table | Phase 13 (SYNC-02) | O(log n) search, instant results |

**Deprecated/outdated:**
- `DirectoryResponse.items`: Never was correct; use `.contacts` from actual API response
- `Participant.jid` and `Participant.name`: API uses `participantJid` and `displayName` from `GroupParticipant`
- `api.bulkAllowAll({ allow: boolean })`: Body field should be `allowed`, not `allow` — bug in current api.ts

## Open Questions

1. **Toast library choice**
   - What we know: No toast component exists yet; `sonner` is the simplest path; shadcn also supports `useToast` with more files
   - What's unclear: Whether the planner wants to add `sonner` as a dependency or implement a minimal custom toast
   - Recommendation: Use `sonner` — 2.0.7, tiny, no peer conflicts, adds one `<Toaster />` to App.tsx and one `import { toast } from 'sonner'` per usage

2. **Tabs component for sub-tabs**
   - What we know: `@radix-ui/react-tabs` is already installed (it's in the dependency tree via radix packages); just needs the shadcn wrapper written
   - What's unclear: Whether it needs to be added to `package.json` explicitly or is already present transitively
   - Recommendation: Run `npm view @radix-ui/react-tabs version` to confirm, then add to package.json and write `tabs.tsx` manually

3. **Contact entry shape from `GET /api/admin/directory/:jid`**
   - What we know: Returns raw `ContactRecord` from `db.getContact(jid)` — shape is `{ jid, displayName, type: 'group'|'contact', ... }` with possible WAHA fallback enrichment
   - What's unclear: Whether `dmSettings` is always included in the single-entry response or only on list
   - Recommendation: When opening ContactSettingsSheet, fetch the single entry; if `dmSettings` is null, use defaults: `{ mode: 'active', mentionOnly: false, customKeywords: '', canInitiate: true, canInitiateOverride: 'default' }`

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | none in src/admin/ — vitest runs from root package.json |
| Quick run command | `npx vitest run --reporter=verbose 2>/dev/null` (from root) |
| Full suite command | `npx vitest run` (from root) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIR-01 | Bot JIDs excluded from contacts list | manual-only | N/A — requires live WAHA API | N/A |
| DIR-02 | Bot badge shown on bot participants | manual-only | N/A — requires `isBotSession: true` response | N/A |
| DIR-03 | Role dropdown updates participant role | manual-only | N/A — requires live DB | N/A |
| DIR-04 | Bulk select + bulk allow-dm sends correct payload | manual-only | N/A — requires API round-trip | N/A |
| DIR-05 | Contact settings Sheet saves correctly | manual-only | N/A — requires API round-trip | N/A |
| DIR-06 | FTS5 search returns results | manual-only | N/A — requires populated SQLite DB | N/A |
| DIR-07 | Pagination increments offset by pageSize | manual-only | N/A — requires live API | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose` (TypeScript compilation check via vitest)
- **Per wave merge:** Full suite + Playwright smoke test of Directory tab
- **Phase gate:** All sub-tabs render without TypeScript errors; at least one DataTable shows data from live API on hpg6

### Wave 0 Gaps
- [ ] `src/admin/src/components/ui/table.tsx` — shadcn table primitives (Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter, TableCaption)
- [ ] `src/admin/src/components/ui/tabs.tsx` — shadcn Tabs wrapper around @radix-ui/react-tabs
- [ ] Fix `DirectoryResponse` type in `types.ts` — change `items` to `contacts`, add `dms/groups/newsletters` counts, add `DirectoryContact` interface
- [ ] Fix `Participant`/`ParticipantsResponse` types — match actual API field names (`participantJid`, `displayName`, `allowInGroup`, `globallyAllowed`, `isBotSession`)
- [ ] Fix `api.bulkAllowAll` body: `{ allow: boolean }` → `{ allowed: boolean }`
- [ ] Install packages: `npm install @tanstack/react-table@^8.21.3 sonner@^2.0.7` (from root)
- [ ] Add `<Toaster />` to `src/admin/src/main.tsx` or `App.tsx` for sonner

## Sources

### Primary (HIGH confidence)
- `src/monitor.ts` lines 4663-5554 — all /api/admin/directory/* route handlers, exact JSON shapes verified
- `src/directory.ts` — DirectoryDb class, SQLite schema, ContactRecord/GroupParticipant types, ContactDmSettings fields
- `src/admin/src/lib/api.ts` — current API client methods (bugs noted above)
- `src/admin/src/types.ts` — current types (mismatches documented above)
- `src/admin/src/components/shared/TagInput.tsx` — reusable component, confirmed interface
- `src/admin/src/App.tsx` — tab props pattern (selectedSession, refreshKey)

### Secondary (MEDIUM confidence)
- npm registry: `@tanstack/react-table@8.21.3` confirmed current
- npm registry: `sonner@2.0.7` confirmed current
- npm registry: `@radix-ui/react-tabs@1.1.13` confirmed current
- package.json root dependencies: confirmed @radix-ui packages installed pattern

### Tertiary (LOW confidence)
- @tanstack/react-table v8 API patterns from training data (verify against official docs if API signature seems wrong)

## Metadata

**Confidence breakdown:**
- API shapes: HIGH — read directly from monitor.ts route handlers
- Type mismatches: HIGH — confirmed by comparing types.ts against monitor.ts
- Standard stack: HIGH — versions confirmed via npm registry
- @tanstack/react-table usage patterns: MEDIUM — from training data, recommend verifying against v8 docs
- Pitfalls: HIGH — discovered from direct code inspection

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (API shapes are stable; monitor.ts routes are production-tested)
