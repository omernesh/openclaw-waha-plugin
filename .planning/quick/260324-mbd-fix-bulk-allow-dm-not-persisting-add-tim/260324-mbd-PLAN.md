---
phase: quick
plan: 260324-mbd
type: execute
wave: 1
depends_on: []
files_modified:
  - src/monitor.ts
  - src/admin/src/components/tabs/directory/shared-columns.tsx
  - src/admin/src/components/tabs/directory/BulkEditToolbar.tsx
  - src/admin/src/components/tabs/directory/ContactsTab.tsx
  - src/admin/src/lib/api.ts
autonomous: true
requirements: [BUG-allowdm-persist, FEAT-timed-dm]
must_haves:
  truths:
    - "Bulk allow-dm persists across page refresh (DB is source of truth, not config file)"
    - "Individual allow-dm toggle persists across page refresh"
    - "Admin can grant timed DM access (1h, 24h, 7d, 30d, permanent) from both individual and bulk flows"
    - "Timed access shows remaining time or 'Expired' badge in the DM Access column"
  artifacts:
    - path: "src/monitor.ts"
      provides: "DB-based allowedDm enrichment + expiresAt support on allow-dm endpoints"
    - path: "src/admin/src/components/tabs/directory/shared-columns.tsx"
      provides: "DM Access column with expiry badge and duration dropdown"
  key_links:
    - from: "src/monitor.ts (GET /api/admin/directory)"
      to: "db.isContactAllowedDm()"
      via: "enrichment uses DB not config"
      pattern: "db\\.isContactAllowedDm"
    - from: "src/admin/src/components/tabs/directory/shared-columns.tsx"
      to: "/api/admin/directory/:jid/allow-dm"
      via: "api.toggleAllowDm with expiresAt"
---

<objective>
Fix bulk and individual allow-dm not persisting (reads config instead of DB) and add timed DM access with duration picker.

Purpose: Allow-dm changes appear to revert on refresh because the directory listing reads from config file (which may fail to sync) instead of the DB (which is always written correctly). Additionally, the existing `expires_at` DB column and TTL API are unused from the main DM toggle flow.

Output: Persistent allow-dm status + timed access UI with duration picker.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/monitor.ts (lines 1152-1236 for GET directory enrichment, 1524-1627 for bulk endpoint, 1655-1678 for individual allow-dm endpoint)
@src/directory.ts (isContactAllowedDm, setContactAllowDm, getContactTtl, setContactAllowDmWithSource)
@src/admin/src/components/tabs/directory/shared-columns.tsx (makeDmAccessColumn)
@src/admin/src/components/tabs/directory/BulkEditToolbar.tsx
@src/admin/src/components/tabs/directory/ContactsTab.tsx (handleBulkAction)
@src/admin/src/lib/api.ts (toggleAllowDm, bulkDirectory, setDirectoryTtl)
@src/admin/src/types.ts (DirectoryContact interface)

<interfaces>
From src/directory.ts:
```typescript
isContactAllowedDm(jid: string): boolean  // checks DB allow_list with TTL expiry
setContactAllowDm(jid: string, allowed: boolean, expiresAt?: number | null): void
setContactAllowDmWithSource(jid: string, allow: boolean, expiresAt?: number | null, source?: string): void
getContactTtl(jid: string): { expiresAt: number | null; expired: boolean; source: string | null } | null
```

From src/admin/src/types.ts:
```typescript
interface DirectoryContact {
  jid: string; displayName: string | null; allowedDm: boolean;
  expiresAt: number | null; expired: boolean; source: string | null;
  // ...other fields
}
```

From src/admin/src/lib/api.ts:
```typescript
toggleAllowDm: (jid: string, body: { allowed: boolean }) => Promise<void>
bulkDirectory: (body: { action: string; jids: string[]; value?: unknown }) => Promise<{ ok: boolean; updated: number }>
setDirectoryTtl: (jid: string, body: { expiresAt: number | null }) => Promise<void>
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix allow-dm enrichment to use DB as source of truth + accept expiresAt on endpoints</name>
  <files>src/monitor.ts</files>
  <action>
1. **Fix GET /api/admin/directory enrichment** (line ~1218-1228):
   Change `allowedDm: configAllowFrom.includes(c.jid)` to `allowedDm: db.isContactAllowedDm(c.jid)`.
   This is the root cause — DB is always written correctly but the listing reads stale config. Keep `configAllowFrom` variable for backward compat but stop using it for enrichment. Remove the `const configAllowFrom` line if nothing else references it in the same block (check first).

2. **Fix POST /api/admin/directory/:jid/allow-dm** (line ~1655-1678):
   Accept optional `expiresAt` from request body: `const { allowed, expiresAt } = JSON.parse(bodyStr) as { allowed: boolean; expiresAt?: number | null }`.
   Pass it through: `db.setContactAllowDm(jid, allowed, expiresAt ?? null)`.
   Keep the `syncAllowList` call as-is (config sync is best-effort, DB is truth now).

3. **Fix POST /api/admin/directory/bulk** (line ~1574-1576):
   Accept optional `expiresAt` from the request body alongside `action`/`jids`: destructure `expiresAt` from the parsed body.
   Pass to `db.setContactAllowDm(jid, true, expiresAt ?? null)` in the allow-dm branch.
   The revoke-dm branch stays as-is (expiresAt irrelevant when revoking).

4. **Also fix POST /api/admin/directory/group/:groupJid/participants/:participantJid/allow-dm** (~line 1850-1874):
   Accept optional `expiresAt` from body the same way and pass through to `db.setParticipantAllowDm()` — check if that method accepts expiresAt. If not, also call `db.setContactAllowDm(participantJid, allowed, expiresAt)` since setParticipantAllowDm already calls setContactAllowDm internally.

Add DO NOT CHANGE comments on the enrichment fix explaining DB is source of truth, not config.
  </action>
  <verify>
    <automated>cd D:/docker/waha-oc-plugin && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>Directory listing enrichment uses db.isContactAllowedDm() instead of config. All allow-dm endpoints accept optional expiresAt parameter. TypeScript compiles clean.</done>
</task>

<task type="auto">
  <name>Task 2: Add timed DM access UI — duration picker on DM toggle + expiry badge + bulk duration</name>
  <files>src/admin/src/components/tabs/directory/shared-columns.tsx, src/admin/src/components/tabs/directory/BulkEditToolbar.tsx, src/admin/src/components/tabs/directory/ContactsTab.tsx, src/admin/src/lib/api.ts</files>
  <action>
**A. Update API client** (`src/admin/src/lib/api.ts`):
- Change `toggleAllowDm` signature to accept `{ allowed: boolean; expiresAt?: number | null }`.
- Change `bulkDirectory` body type to include optional `expiresAt?: number | null`.

**B. Rework DM Access column** (`shared-columns.tsx` — `makeDmAccessColumn`):
Replace the single "Allow DM" button with a compound control:
- When `allowedDm === false`: Show a dropdown button (using shadcn `DropdownMenu`) with options:
  - "Allow (1 hour)" — expiresAt = now + 3600
  - "Allow (24 hours)" — expiresAt = now + 86400
  - "Allow (7 days)" — expiresAt = now + 604800
  - "Allow (30 days)" — expiresAt = now + 2592000
  - "Allow (permanent)" — expiresAt = null
  Each option calls `api.toggleAllowDm(jid, { allowed: true, expiresAt })`.
- When `allowedDm === true`: Show status with expiry info:
  - If `expiresAt` is set and not expired: green badge "Allowed" + small text showing remaining time (e.g., "23h left", "6d left"). Use a simple helper function `formatTimeRemaining(expiresAt)` that returns human-friendly string.
  - If `expiresAt` is set and expired: amber badge "Expired".
  - If `expiresAt` is null: green badge "Permanent".
  - Always show a small "Revoke" button next to the badge. On click: `api.toggleAllowDm(jid, { allowed: false })`.
- All timestamps are Unix seconds (NOT milliseconds). expiresAt from server is in seconds. `Math.floor(Date.now() / 1000)` for current time.
- Keep the `togglingJid` double-click protection pattern.

**C. Add duration option to BulkEditToolbar** (`BulkEditToolbar.tsx`):
Replace the single "Allow DM" button with a `DropdownMenu` offering the same duration options.
Change `onAction` prop signature to: `(action: string, expiresAt?: number | null) => void`.
Each duration option calls `onAction('allow-dm', expiresAt)`.
"Revoke DM" button stays as-is.

**D. Update ContactsTab bulk handler** (`ContactsTab.tsx`):
Update `handleBulkAction` to accept `expiresAt` parameter.
Pass `expiresAt` to `api.bulkDirectory({ action, jids: selectedJids, expiresAt })`.
Update toast message to include duration info.

Import `DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger` from `@/components/ui/dropdown-menu` (already available in shadcn setup). If `dropdown-menu` component doesn't exist yet, use a simple `select` or `Popover` instead.
  </action>
  <verify>
    <automated>cd D:/docker/waha-oc-plugin/src/admin && npx tsc --noEmit 2>&1 | head -20 && npx vite build 2>&1 | tail -10</automated>
  </verify>
  <done>DM Access column shows duration dropdown for granting access, expiry badges with remaining time for active access, and revoke button. Bulk toolbar offers same duration options. Admin build succeeds.</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` — both root and admin compile clean
2. `cd src/admin && npx vite build` — admin panel builds successfully
3. Manual: Open admin panel, grant timed DM access to a contact, refresh page, verify it persists
4. Manual: Bulk select contacts, grant 24h access, refresh, verify all persist with correct expiry
5. Manual: Verify expired access shows "Expired" badge, not "Allowed"
</verification>

<success_criteria>
- Allow-dm changes persist across page refresh (DB-backed, not config-backed)
- Individual DM toggle offers 5 duration options (1h, 24h, 7d, 30d, permanent)
- Bulk DM allow offers same 5 duration options
- Active timed access shows remaining time (e.g., "23h left")
- Expired access shows "Expired" badge
- All existing functionality preserved (revoke, participant allow, group allow)
</success_criteria>

<output>
After completion, create `.planning/quick/260324-mbd-fix-bulk-allow-dm-not-persisting-add-tim/260324-mbd-SUMMARY.md`
</output>
