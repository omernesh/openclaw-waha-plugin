# Phase 10: Directory & Group Enhancements - Research

**Researched:** 2026-03-16
**Domain:** Admin panel HTML/JS UI — groups tab pagination, participant loading, participant roles, bulk edit
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DIR-01 | Groups Pagination — Replace long group list with paginated table. Upper and lower nav bars with page numbers and "Display [X] groups" selector. | Current groups tab uses infinite-scroll/load-more pattern; pagination requires replacing `loadDirectory()` + `buildContactCard()` rendering for the groups tab specifically; page-size selector and page nav controls identified |
| DIR-02 | Group Participants Fix — Fix groups showing "0 participants" / failing to load. Show contact names instead of raw LIDs. Reflect global allowlist state in participant buttons. | Lazy-fetch path in monitor.ts line 3127 identified; WAHA returns participant JIDs that may be @lid; `isContactAllowedDm()` and global `allowFrom` config array both available to compute allowlist state |
| DIR-03 | Group Participant Roles — Add role dropdown per participant: "Bot Admin", "Manager", "Participant". | Roles NOT currently in schema; requires new `participant_role` column (migration-safe ALTER TABLE); new API endpoint PUT /api/admin/directory/group/:groupJid/participants/:participantJid/role; dropdown in participant row UI |
| DIR-04 | Bulk Edit — Select multiple contacts/groups/participants and apply changes in bulk (allow DM, change role, etc.). | No existing bulk edit infrastructure; requires checkbox UI layer, bulk action toolbar, new bulk API endpoint; patterns from existing per-row action buttons serve as reference |
</phase_requirements>

---

## Summary

Phase 10 is a pure admin-panel upgrade — all work is in `src/monitor.ts` (3,481 lines of embedded HTML/JS/TypeScript) plus `src/directory.ts` (SQLite schema and query layer). No new npm packages are needed. The four requirements span: one pagination UX overhaul (DIR-01), one participant loading fix plus display enhancement (DIR-02), one new database column with a role dropdown (DIR-03), and one bulk selection/edit system (DIR-04).

DIR-01 and DIR-02 are the most interrelated: the groups tab currently uses the same infinite-scroll `loadDirectory()` path as contacts and newsletters. The groups-specific view needs to be a separate rendering mode (or a guarded code path inside `loadDirectory()`) that renders a table with pagination controls instead of the card list. DIR-02 involves the participant panel inside the group cards — when WAHA returns `@lid` JIDs, the display name lookup needs to resolve names from either the SQLite directory or a fallback.

DIR-03 requires a new `participant_role` column in the `group_participants` SQLite table. The migration must follow the established try/catch pattern already used for `trigger_operator` in `_createSchema()`. The role dropdown must be wired to a new PUT endpoint. The three roles ("Bot Admin", "Manager", "Participant") are admin-only labels stored in the plugin — they have no WhatsApp-level meaning and do not interact with WAHA admin/superadmin flags.

DIR-04 (bulk edit) is the most complex. It requires: a checkbox layer overlaid on existing cards/rows, a sticky bulk action toolbar that appears when items are selected, and a server-side bulk endpoint that accepts multiple JIDs and an action. The cleanest approach is to add a "select mode" toggle per tab that shows checkboxes without changing the card layout. Bulk actions for this phase should cover: allow DM (contacts), allow in group (participants), and set role (participants).

**Primary recommendation:** Execute in two plans — Plan 01: DIR-01 (groups pagination) + DIR-02 (participant fix). Plan 02: DIR-03 (participant roles) + DIR-04 (bulk edit). Both plans are contained to `src/monitor.ts` + `src/directory.ts`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS (no framework) | N/A | All component logic | No build step; admin panel is an embedded HTML string in TypeScript |
| better-sqlite3 | Project dep | SQLite reads/writes in directory.ts | Already the DB layer; `ALTER TABLE ... ADD COLUMN` migration-safe pattern established |
| Vitest | ^4.0.18 | Unit tests for pure functions | Already installed; project policy (nyquist_validation: true) |
| TypeScript | ^5.9.3 | Type safety | Project convention |

### No New Dependencies
Phase 10 reuses:
- Existing `.tip` CSS tooltip class
- Existing `createTagInput` factory (Phase 8) — available if needed for bulk tag inputs
- Existing `createContactPicker` factory (Phase 8) — may be used for bulk target entry
- Existing admin API patterns and `writeJsonResponse`/`writeWebhookError` helpers in monitor.ts
- Existing `getDirectoryDb()` / `DirectoryDb` class in directory.ts

**Installation:** None required.

---

## Architecture Patterns

### Recommended Project Structure
No new files required for production code. All changes are in:
```
src/monitor.ts      — All admin panel HTML/JS (3,481 lines, embedded template string)
src/directory.ts    — SQLite schema + query methods
tests/              — Unit tests for any pure functions extracted
```

Test files (Wave 0 gaps):
```
tests/ui-directory-pagination.test.ts  — pure pagination math helpers (if extracted)
tests/directory-db.test.ts             — participant role DB methods
tests/ui-bulk-edit.test.ts             — bulk action serialization helpers (if extracted)
```

### Pattern 1: Groups Tab — Separate Render Mode
**What:** The current `loadDirectory()` function renders all types (contacts, groups, newsletters) using `buildContactCard()`. For DIR-01, the groups tab needs a table view with page nav instead of card+load-more.

**How to implement:** Guard with `currentDirTab === 'groups'` inside `loadDirectory()`:
```javascript
async function loadDirectory() {
  if (currentDirTab === 'groups') {
    return loadGroupsTable();   // DIR-01: separate render path for paginated table
  }
  // existing contacts/newsletters logic unchanged
}
```

`loadGroupsTable()` renders a `<table>` with columns (name, JID, members, last active, settings button) and upper/lower pagination nav bars.

**Page size selector:** Use a `<select>` element with values [10, 25, 50, 100]. Store selection in `var dirGroupPageSize = 25`. On change, reset `dirGroupPage = 1` and reload.

**Page nav:** Two identical nav bars (above and below table) with structure: First / Prev / page numbers / Next / Last. Show at most 5 page numbers around the current page. Build as a pure `buildPageNav(currentPage, totalPages)` function for testability.

### Pattern 2: Participant Name Resolution (@lid Fix)
**What:** WAHA's NOWEB engine sends participant JIDs as `@lid` in many cases. `getWahaGroupParticipants()` returns an array of `{id, name, pushName, admin}` objects. The `name`/`pushName` field may be empty, causing raw JID display.

**Root cause (DIR-02):** When lazy-fetch runs (line 3127), `p.name` and `p.pushName` are both empty for `@lid` JIDs. The DB stores `display_name = null`. The UI then shows the raw `@lid` JID string.

**Fix approach:**
1. In the lazy-fetch path, after calling `bulkUpsertGroupParticipants`, attempt a secondary lookup:
   - For each participant with `displayName === null`, check if the `contacts` table has a matching `@c.us` JID with a name (via LID-to-c.us mapping already available in `getOrphanedLidEntries()` / `mergeContacts()`).
   - Alternatively, call `getWahaContact` for the JID to fetch the name from WAHA API (rate-limit-aware, best-effort).
2. In the UI (`loadGroupParticipants` JS function), the existing `p.displayName || p.participantJid` fallback already covers this — the fix is server-side, ensuring names are populated.

**Global allowlist state in buttons:** Currently participant buttons show "In Group" / "Allow Group" based on `p.allowInGroup`. DIR-02 requires reflecting the global `allowFrom` config array too.

Fix: In the participants API response, enrich each participant with `globallyAllowed: boolean`:
```typescript
// In GET /api/admin/directory/group/:groupJid/participants handler
const configGroupAllowFrom: string[] = account.config.groupAllowFrom ?? [];
const enrichedParticipants = participants.map(p => ({
  ...p,
  globallyAllowed: configGroupAllowFrom.includes(p.participantJid),
}));
```

UI button color logic: `allowInGroup || globallyAllowed` → green; neither → grey.

### Pattern 3: Participant Role Column (Migration-Safe)
**What:** Add `participant_role` column to `group_participants` table. Values: `"bot_admin"`, `"manager"`, `"participant"` (default).

**Migration pattern** (already established in `_createSchema()` for `trigger_operator`):
```typescript
// In _createSchema() — add after existing migration:
try {
  this.db.prepare(
    `ALTER TABLE group_participants ADD COLUMN participant_role TEXT NOT NULL DEFAULT 'participant'`
  ).run();
} catch (migrationErr: unknown) {
  const msg = migrationErr instanceof Error ? migrationErr.message : String(migrationErr);
  if (!msg.includes('duplicate column')) throw migrationErr;
}
```

**New DB methods needed in DirectoryDb:**
```typescript
setParticipantRole(groupJid: string, participantJid: string, role: ParticipantRole): boolean
getParticipantRole(groupJid: string, participantJid: string): ParticipantRole
```

**New type to add in directory.ts:**
```typescript
export type ParticipantRole = "bot_admin" | "manager" | "participant";
```

**New API endpoint:** `PUT /api/admin/directory/group/:groupJid/participants/:participantJid/role`
Body: `{ role: "bot_admin" | "manager" | "participant" }`

**UI:** In `loadGroupParticipants` JS, add a select dropdown to each participant row, wired to a `setParticipantRole(groupJid, participantJid, newRole)` function that calls the new endpoint. Roles display as: `bot_admin` -> "Bot Admin", `manager` -> "Manager", `participant` -> "Participant".

### Pattern 4: Bulk Edit — Select Mode
**What:** A "Select" toggle button per tab/section that shows checkboxes. When items are checked, a sticky bulk action toolbar appears at the bottom of the panel.

**State management:**
```javascript
var bulkSelectMode = false;
var bulkSelectedJids = new Set();
function toggleBulkSelectMode() {
  bulkSelectMode = !bulkSelectMode;
  bulkSelectedJids.clear();
  updateBulkToolbar();
  dirOffset = 0;
  loadDirectory();  // re-render with/without checkboxes
}
```

**Checkpoint integration in `buildContactCard()`:** When `bulkSelectMode` is true, prepend a checkbox element (using DOM createElement approach, not innerHTML, to pass security hooks) to each card.

**Bulk toolbar:** A fixed-position div at bottom of page, hidden unless items are selected. Shows count of selected items and action buttons: "Allow DM", "Revoke DM" (contacts tab), "Set Role", "Allow Group" (participants panel).

**Bulk API endpoint:** `POST /api/admin/directory/bulk`
Body: `{ jids: string[], action: "allow-dm" | "revoke-dm" | "set-role" | "allow-group" | "revoke-group", value?: string, groupJid?: string }`

This is a new endpoint in monitor.ts. It iterates jids and calls the appropriate DB method for each. Must be placed BEFORE the generic `directory/:jid` route matcher (see Pitfall 7).

**setParticipantRole DB method:**
```typescript
setParticipantRole(groupJid: string, participantJid: string, role: ParticipantRole): boolean {
  const result = this.db.prepare(
    "UPDATE group_participants SET participant_role = ?, updated_at = ? WHERE group_jid = ? AND participant_jid = ?"
  ).run(role, Date.now(), groupJid, participantJid);
  return result.changes > 0;
}
```

### Anti-Patterns to Avoid
- **Changing the existing contacts/newsletters render path for pagination:** Contacts and newsletters use infinite scroll and "Load More" — do NOT retrofit them with page nav. Only the groups tab gets the new table + pagination.
- **Re-fetching all participants on every role/allow toggle:** After a toggle in the participant panel, call `loadGroupParticipants(groupJid, true)` (already exists) — it re-fetches the panel. Do not rebuild just the one row.
- **Blocking DB migration on existing rows:** The `ALTER TABLE ... ADD COLUMN` with DEFAULT handles existing rows automatically — no UPDATE needed.
- **Role values as display labels:** Store `"bot_admin"` / `"manager"` / `"participant"` as machine values; display "Bot Admin" / "Manager" / "Participant" in the UI.
- **Bulk selecting across tabs:** Switching tabs via `switchDirTab` must clear `bulkSelectedJids` and exit select mode to prevent cross-type confusion.
- **Using innerHTML with user-controlled content:** For any new HTML that incorporates user/JID data, use the existing `esc()` helper or DOM text node creation. The admin panel security hook requires avoiding raw innerHTML with untrusted values.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tag input for bulk role value | Custom input | `createTagInput` from Phase 8 | Already built and tested |
| Contact search in bulk target | Custom search | `createContactPicker` from Phase 8 | Already built and tested |
| DB schema migration | Custom upgrade script | SQLite `ALTER TABLE ... ADD COLUMN` with try/catch | Already used for `trigger_operator`; pattern is idempotent |
| Pagination math | Custom ad-hoc formulas | Extracted pure `buildPageNav(page, totalPages)` function | Testable, used twice (top + bottom nav bars) |
| Per-row allow toggle | Duplicate button handler | Reuse existing `toggleParticipantAllow` / `toggleAllowDm` | Already work; no reason to duplicate |

**Key insight:** Phase 10 reuses all the UI component infrastructure from Phases 8 and 9. No new component factories are needed — only new wiring of existing ones.

---

## Common Pitfalls

### Pitfall 1: Groups Tab Pagination Breaks "Load More" for Contacts
**What goes wrong:** Modifying `loadDirectory()` without guarding `currentDirTab === 'groups'` causes the contacts tab to also switch to table view or break the infinite scroll.
**Why it happens:** `loadDirectory()` is called by all three tabs. The groups-specific code path must be gated.
**How to avoid:** Add an early-return branch: `if (currentDirTab === 'groups') return loadGroupsTable();` as the first line of `loadDirectory()`. The existing contacts/newsletters path is untouched.

### Pitfall 2: Participant @lid JIDs Show as Raw Numbers
**What goes wrong:** WAHA NOWEB returns participants as `@lid` JIDs with empty `name`/`pushName`. DB stores `display_name = null`. UI shows `1234567890@lid`.
**Why it happens:** The lazy-fetch in monitor.ts line 3129 maps `p.name || p.pushName || undefined` — both may be undefined for @lid entries.
**How to avoid:**
1. After `bulkUpsertGroupParticipants`, attempt to look up `display_name` from the `contacts` table by `@c.us` equivalents using `getOrphanedLidEntries()` + `mergeContacts()` logic already in directory.ts.
2. If still missing, the UI should show the JID number without the domain part (strip `@lid`) as a last resort — cleaner than the full raw JID.

### Pitfall 3: Global allowFrom vs. per-participant allowInGroup Confusion
**What goes wrong:** The "In Group" button reflects `allowInGroup` from the `group_participants` table, but the global `allowFrom` config array (used by `syncAllowList`) controls what the inbound filter actually checks. These can diverge.
**Why it happens:** Two sources of truth: SQLite `group_participants.allow_in_group` and the JSON config `groupAllowFrom` array.
**How to avoid:** In the participants API response, compute `globallyAllowed` from the live config `groupAllowFrom` array. Show both states in the UI: `allowInGroup` (local DB state) AND `globallyAllowed` (config state). The button toggle must write to BOTH via `syncAllowList`.

### Pitfall 4: Bulk Edit Persisting Across Tab Switches
**What goes wrong:** User selects 3 contacts in Contacts tab, switches to Groups tab — checkboxes/count carry over.
**Why it happens:** `bulkSelectedJids` is a module-level Set. `switchDirTab` doesn't clear it.
**How to avoid:** In `switchDirTab()`, add `bulkSelectMode = false; bulkSelectedJids.clear(); updateBulkToolbar();` before the `loadDirectory()` call.

### Pitfall 5: Page Nav Rendering on Single-Page Results
**What goes wrong:** Page nav shows "Page 1 of 1" with prev/next buttons enabled, or disappears entirely when there's only one page.
**Why it happens:** Nav rendering logic not guarding for `totalPages === 1`.
**How to avoid:** Hide the nav bar entirely when `totalPages <= 1`. Guard: `if (totalPages <= 1) return '';` in `buildPageNav()`.

### Pitfall 6: `participant_role` Column Missing on First Load After Phase Deploy
**What goes wrong:** After deploying to hpg6, the existing SQLite DB does not have the `participant_role` column. First request to the participant endpoint throws "no such column" and returns 500.
**Why it happens:** `_createSchema()` runs at startup and adds the column via migration. If the migration code is correct, this resolves on first gateway start after deploy.
**How to avoid:** Verify the try/catch migration runs at startup (it does — `_createSchema()` is called in the `DirectoryDb` constructor). Test by deploying to hpg6, restarting gateway, and immediately opening a group's participants. Check logs for "duplicate column" (expected/benign) vs. any other error.

### Pitfall 7: Bulk API Endpoint Route Collision
**What goes wrong:** `POST /api/admin/directory/bulk` is mis-matched by an existing route regex that looks for `directory/:jid`.
**Why it happens:** The existing route patterns in monitor.ts use `.match(/^\/api\/admin\/directory\/([^/]+)\/...)` which would match `/directory/bulk/...`.
**How to avoid:** Place the `/bulk` route handler BEFORE the generic `directory/:jid` handlers in the request routing chain (monitor.ts uses sequential `if` checks, not a router framework). Test with `req.url === "/api/admin/directory/bulk"` as the exact string condition.

---

## Code Examples

### DIR-01: Groups Pagination State Variables
```javascript
// Source: monitor.ts — new module-level state for groups tab pagination
var dirGroupPage = 1;
var dirGroupPageSize = 25;
```

### DIR-01: loadDirectory() early-return branch
```javascript
// Source: monitor.ts — first line of loadDirectory()
async function loadDirectory() {
  if (currentDirTab === 'groups') {
    return loadGroupsTable();   // DIR-01: groups tab uses paginated table view
  }
  // ... existing contacts/newsletters infinite-scroll logic unchanged
}
```

### DIR-01: buildPageNav pure function (testable)
```javascript
// Source: monitor.ts — pure function, safe to extract for unit testing
function buildPageNav(currentPage, totalPages) {
  if (totalPages <= 1) return '';
  var prev = Math.max(1, currentPage - 1);
  var next = Math.min(totalPages, currentPage + 1);
  var start = Math.max(1, currentPage - 2);
  var end = Math.min(totalPages, start + 4);
  // Returns HTML string — uses only static content (no user data), so no XSS risk
  // Build navigation buttons: First, Prev, page numbers, Next, Last
  return '<div class="page-nav">...' + /* page buttons */ '...</div>';
}
```

### DIR-02: Global Allowlist Enrichment in Participants API
```typescript
// Source: monitor.ts GET /api/admin/directory/group/:groupJid/participants handler
const configGroupAllowFrom: string[] =
  (account.config as Record<string, unknown>).groupAllowFrom as string[] ?? [];
const enrichedParticipants = participants.map(p => ({
  ...p,
  globallyAllowed: configGroupAllowFrom.includes(p.participantJid),
}));
res.end(JSON.stringify({ participants: enrichedParticipants, allowAll }));
```

### DIR-03: Participant Role Column Migration
```typescript
// Source: directory.ts _createSchema() — add after trigger_operator migration
// Pattern from existing trigger_operator migration at line ~170
try {
  this.db.prepare(
    `ALTER TABLE group_participants ADD COLUMN participant_role TEXT NOT NULL DEFAULT 'participant'`
  ).run();
} catch (migrationErr: unknown) {
  const msg = migrationErr instanceof Error ? migrationErr.message : String(migrationErr);
  if (!msg.includes('duplicate column')) throw migrationErr;
}
```

### DIR-03: New ParticipantRole type + setParticipantRole method
```typescript
// Source: directory.ts — new type export
export type ParticipantRole = "bot_admin" | "manager" | "participant";

// Source: directory.ts DirectoryDb class — new method
setParticipantRole(groupJid: string, participantJid: string, role: ParticipantRole): boolean {
  const result = this.db.prepare(
    "UPDATE group_participants SET participant_role = ?, updated_at = ? WHERE group_jid = ? AND participant_jid = ?"
  ).run(role, Date.now(), groupJid, participantJid);
  return result.changes > 0;
}

getParticipantRole(groupJid: string, participantJid: string): ParticipantRole {
  const row = this.db.prepare(
    "SELECT participant_role FROM group_participants WHERE group_jid = ? AND participant_jid = ?"
  ).get(groupJid, participantJid) as { participant_role: string } | undefined;
  return (row?.participant_role as ParticipantRole) ?? "participant";
}
```

### DIR-04: Bulk API Endpoint Sketch
```typescript
// Source: monitor.ts — place BEFORE the generic /api/admin/directory/:jid route handlers
if (req.url === "/api/admin/directory/bulk" && req.method === "POST") {
  try {
    const bodyStr = await readBody(req, maxBodyBytes);
    const { jids, action, value, groupJid } = JSON.parse(bodyStr) as {
      jids: string[];
      action: "allow-dm" | "revoke-dm" | "allow-group" | "revoke-group" | "set-role";
      value?: string;
      groupJid?: string;
    };
    if (!Array.isArray(jids) || jids.length === 0) {
      writeJsonResponse(res, 400, { error: "jids must be a non-empty array" });
      return;
    }
    const db = getDirectoryDb(opts.accountId);
    let updated = 0;
    for (const jid of jids) {
      if (action === "allow-dm") { db.setContactAllowDm(jid, true); updated++; }
      else if (action === "revoke-dm") { db.setContactAllowDm(jid, false); updated++; }
      else if (action === "allow-group" && groupJid) {
        if (db.setParticipantAllowInGroup(groupJid, jid, true)) updated++;
      }
      else if (action === "revoke-group" && groupJid) {
        if (db.setParticipantAllowInGroup(groupJid, jid, false)) updated++;
      }
      else if (action === "set-role" && groupJid && value) {
        if (db.setParticipantRole(groupJid, jid, value as ParticipantRole)) updated++;
      }
    }
    res.end(JSON.stringify({ ok: true, updated }));
  } catch (err) {
    console.error(`[waha] POST /api/admin/directory/bulk failed: ${String(err)}`);
    writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
  }
  return;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Infinite scroll / Load More for all tabs | Contacts/newsletters: Load More; Groups: paginated table | Phase 10 (this phase) | Groups tab gets first-class pagination UX |
| Participant panel shows raw @lid JIDs when name missing | Name resolved from directory DB; falls back to stripped JID | Phase 10 (this phase) | DIR-02 fixes display |
| No participant roles — only is_admin flag from WAHA | `participant_role` column with bot_admin/manager/participant | Phase 10 (this phase) | DIR-03 adds plugin-level role concept |
| No bulk selection | Checkbox select mode + sticky bulk toolbar | Phase 10 (this phase) | DIR-04 enables batch operations |

**Not deprecated:**
- `buildContactCard()` for contacts/newsletters tab: unchanged
- `loadDirectory()` for contacts/newsletters: unchanged (groups early-returns to new `loadGroupsTable()`)
- `getGroupParticipants()` / `bulkUpsertGroupParticipants()` in directory.ts: extended, not replaced

---

## Open Questions

1. **Does the WAHA participants endpoint return @c.us or @lid JIDs for NOWEB engine?**
   - What we know: WAHA's NOWEB sends `@lid` in many places; `getWahaGroupParticipants` returns raw WAHA data.
   - What's unclear: Whether `participants` endpoint specifically returns `@lid` or `@c.us` as the primary `id` field.
   - Recommendation: Check against live WAHA API during Plan 01. If @lid, apply the name-lookup fix in the lazy-fetch path before storing. If already @c.us, DIR-02 fix is only about ensuring `displayName` is populated.

2. **Should the groups table replace group-as-card rendering entirely, or only for the groups tab?**
   - What we know: DIR-01 says "Replace long group list with paginated table."
   - What's unclear: Whether group cards should still appear in a hypothetical "All" view.
   - Recommendation: Scoped replacement — only the groups tab (when `currentDirTab === 'groups'`) uses the table. Contacts and newsletters tabs are unchanged.

3. **Are participant roles (DIR-03) purely display/config labels, or do they need to integrate with the Phase 6 Rules/Policy system?**
   - What we know: Phase 6 Rules system uses `participants_allowlist` and `contact_rule_mode` in YAML. The three roles (Bot Admin, Manager, Participant) are described as admin panel labels.
   - Recommendation: For Phase 10, roles are stored in SQLite only — they are UI/admin labels. Phase 6 YAML integration (if ever needed) is deferred. This avoids coupling two complex subsystems.

4. **What bulk actions should DIR-04 support in scope?**
   - What we know: DIR-04 says "apply changes in bulk (allow DM, change role, etc.)."
   - Recommendation: Scope to four actions: (a) Allow DM — bulk add contacts to `allowFrom`, (b) Revoke DM — bulk remove from `allowFrom`, (c) Allow Group / Revoke Group — bulk set `allow_in_group` in participant panel, (d) Set Role — bulk assign `participant_role` to multiple participants in a group. Media-type specific: allow DM available in Contacts tab, Set Role available in participant panel bulk mode.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run tests/ui-directory-pagination.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIR-01 | `buildPageNav()` pure function — correct page numbers, disabled states, single-page guard | unit | `npx vitest run tests/ui-directory-pagination.test.ts -x` | Wave 0 |
| DIR-01 | Groups table URL construction + page math | unit | `npx vitest run tests/ui-directory-pagination.test.ts -x` | Wave 0 |
| DIR-02 | Global allowlist enrichment logic (if extracted as pure helper) | unit | `npx vitest run tests/ui-directory-pagination.test.ts -x` | Wave 0 |
| DIR-02 | Participant @lid name fallback (visual) | manual-only | N/A | N/A |
| DIR-03 | `setParticipantRole()` / `getParticipantRole()` DB methods | unit | `npx vitest run tests/directory-db.test.ts -x` | Wave 0 |
| DIR-03 | Migration idempotency — `ALTER TABLE ... ADD COLUMN` on existing DB | unit | `npx vitest run tests/directory-db.test.ts -x` | Wave 0 |
| DIR-04 | Bulk JID set management helpers (if extracted as pure functions) | unit | `npx vitest run tests/ui-bulk-edit.test.ts -x` | Wave 0 (only if extracted) |
| DIR-04 | Bulk API endpoint — manual test via admin panel | manual-only | N/A | N/A |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green + live browser test of admin panel (groups tab pagination, participant panel, bulk select) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/ui-directory-pagination.test.ts` — covers `buildPageNav()` pure function and any name-resolution helpers from DIR-01/DIR-02
- [ ] `tests/directory-db.test.ts` — covers `setParticipantRole()`, `getParticipantRole()`, and migration idempotency for DIR-03
- [ ] `tests/ui-bulk-edit.test.ts` — covers bulk selection state helpers IF pure functions are extracted from the inline JS for DIR-04

*(If DIR-04 bulk helpers are all inline JS in monitor.ts with no extractable pure logic, that gap reduces to manual-only testing.)*

---

## Sources

### Primary (HIGH confidence)
- `src/monitor.ts` lines 1931–2200 — `loadDirectory()`, `buildContactCard()`, `loadGroupParticipants()`, group filter override section — full context for DIR-01/DIR-02
- `src/monitor.ts` lines 3115–3178 — GET participants endpoint, participant allow-group/allow-dm endpoints — backend context for DIR-02
- `src/monitor.ts` lines 2750–2779 — GET /api/admin/directory list endpoint with allowedDm enrichment — DIR-02 pattern
- `src/monitor.ts` lines 814–836 — Directory tab HTML, dir-tabs, search bar, contact-list container — DIR-01 insertion point
- `src/directory.ts` lines 103–177 — `_createSchema()` with trigger_operator migration as reference pattern for DIR-03
- `src/directory.ts` lines 433–497 — `getGroupParticipants()`, `bulkUpsertGroupParticipants()`, `setParticipantAllowInGroup()` — DIR-02/DIR-03 extension points
- `src/directory.ts` lines 26–33 — `GroupParticipant` type — DIR-03 type extension
- `.planning/phases/08-shared-ui-components/08-RESEARCH.md` — createTagInput, createContactPicker factory patterns
- `.planning/phases/09-settings-ux-improvements/09-RESEARCH.md` — established patterns for dynamic panel HTML + lazy init
- `.planning/STATE.md` decisions section — `trigger_operator` migration decision (idempotent try/catch pattern)

### Secondary (MEDIUM confidence)
- `docs/ROADMAP.md` Phase 10 entry — canonical requirement definitions and UAT criteria
- CLAUDE.md project notes — WAHA NOWEB engine returns @lid JIDs in group context (documented pitfall)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all existing patterns reused
- Architecture (DIR-01): HIGH — groups tab can be forked cleanly from existing `loadDirectory()` with an early-return branch
- Architecture (DIR-02): HIGH — root cause (@lid name missing) identified, fix approach clear; live verification needed to confirm @lid vs @c.us from WAHA API
- Architecture (DIR-03): HIGH — migration pattern exact match exists in codebase; new column/methods straightforward
- Architecture (DIR-04): MEDIUM — bulk edit is the most novel; toolbar + checkbox pattern is standard but the exact UX interactions (multi-tab, participant panel bulk mode) need careful implementation to avoid cross-tab state bugs
- Pitfalls: HIGH — most pitfalls derived directly from codebase analysis and existing phase decisions

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable admin panel codebase; no external API changes expected)
