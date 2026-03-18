# Phase 22: Sessions, Modules, Log, and Queue Tabs - Research

**Researched:** 2026-03-18
**Domain:** React tab components — Sessions, Modules, Log, Queue
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sessions Tab**
- Each session rendered as a shadcn Card
- Labeled role dropdown (bot/human) and subRole dropdown (full-access/listener) with labels above
- Explanatory text box at bottom explaining each option
- Optimistic role save: dropdown updates immediately, shows "Restart required" amber notice
- Save & Restart button uses RestartOverlay (shared component from Phase 20)
- Data from api.getSessions()

**Modules Tab**
- List all registered modules from api.getModules()
- Each module: Card with name, description, enable/disable Switch toggle
- Inline config form (module-specific settings rendered dynamically)
- Group/contact assignment pickers using TagInput (search mode) from Phase 20
- Toggle sends PUT to module enable/disable endpoint

**Log Tab**
- Log entries from api.getLogs() — virtual scrolling for large log sets
- Level filter chips (INFO, WARN, ERROR, DEBUG) — toggle to show/hide levels
- Search input with clear button (x)
- Auto-scroll to bottom on new entries, pause auto-scroll when user scrolls up
- Consider @tanstack/react-virtual or simple windowing for virtual scroll

**Queue Tab**
- Display DM queue depth and group queue depth from api.getQueueStatus()
- Show processing state (idle/processing/paused)
- Simple Card-based layout — not a complex component

### Claude's Discretion
- Virtual scrolling implementation details (library choice or custom)
- Exact module config form rendering (can use JSON schema or manual fields)
- Log entry formatting and coloring

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SESS-01 | Sessions tab: display all sessions with role/subRole editing | api.getSessions() confirmed; PUT /sessions/:id/role confirmed; Session type confirmed |
| SESS-02 | Sessions tab: Save & Restart flow with RestartOverlay | RestartOverlay component exists at shared/RestartOverlay.tsx; pattern verified |
| SESS-03 | Sessions tab: show health status (healthy/unhealthy/unknown) per session | Session.healthStatus and Session.healthy fields confirmed from API |
| MODS-01 | Modules tab: list, enable/disable, and assignment management | All module endpoints confirmed; Module type confirmed; TagInput searchFn available |
| LOGT-01 | Log tab: display logs with level filtering and search, virtual scrolling | /api/admin/logs response shape confirmed; returns {lines, source, total}; NOT string |
| QUEU-01 | Queue tab: display queue depth and stats | QueueStats shape confirmed from inbound-queue.ts; MISMATCH with types.ts — see Pitfalls |
</phase_requirements>

---

## Summary

Phase 22 replaces four placeholder tab components (SessionsTab, ModulesTab, LogTab, QueueTab) with fully implemented React components. All four tabs have pre-existing placeholder files with the correct props interface (`selectedSession`, `refreshKey`). The API client (`api.ts`) already has all methods wired: `getSessions`, `updateSessionRole`, `getModules`, `enableModule`, `disableModule`, `getModuleAssignments`, `addModuleAssignment`, `removeModuleAssignment`, `getLogs`, and `getQueue`. All shared components (RestartOverlay, TagInput, shadcn primitives) are available and tested.

The most important discovery is a **type mismatch** between `types.ts` (`QueueResponse`) and the actual server response shape (`QueueStats` from `inbound-queue.ts`). The server returns `{ dmDepth, groupDepth, dmOverflowDrops, groupOverflowDrops, totalProcessed, totalErrors }` — not `{ dm: { depth, processing }, group: { depth, processing } }`. The `types.ts` `QueueResponse` is incorrect and must be fixed in this phase.

A second important discovery: the log endpoint returns `{ lines: string[], source: string, total: number }` (a JSON object), but `api.ts` types it as `request<string>`. This is incorrect — the API client return type must be fixed.

**Primary recommendation:** Fix both type mismatches before implementing the components. All four tabs are independent and can be implemented in a single plan.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.2.4 | UI framework | Project standard |
| shadcn/ui (manual) | — | Card, Switch, Badge, Select, Button, Label, Input | Used in all prior phases |
| Tailwind CSS | 4.2.1 | Utility styling | Project standard |
| lucide-react | 0.577.0 | Icons (X, RefreshCw, etc.) | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-table | 8.21.3 | NOT needed | Already in project but not required for these tabs |
| @tanstack/react-virtual | NOT in project | Virtual scrolling for Log tab | Option — see below |

### Virtual Scrolling Decision

`@tanstack/react-virtual` is **not currently installed** in the project. For Log tab virtual scrolling, two approaches are viable:

1. **Simple windowing (recommended, Claude's discretion):** Slice `lines.slice(-200)` to show only the last N lines; add a "Load more" button. Requires no new dependency. The server already caps at 500 lines. This is simpler and consistent with the phase's "simple Card-based layout" philosophy.

2. **`@tanstack/react-virtual`:** Would need `npm install @tanstack/react-virtual --legacy-peer-deps`. Provides true virtual scrolling for arbitrarily large lists. More complex to implement. Only justified if log lines regularly exceed 500.

**Recommendation:** Use simple windowing (approach 1) for Phase 22. The server caps at 500 lines and the Log tab supports a `lines` query param (1–500). Virtual scrolling with `@tanstack/react-virtual` is a Polish-phase concern (Phase 23), not Phase 22.

**Installation (if virtual chosen):**
```bash
cd src/admin && npm install @tanstack/react-virtual --legacy-peer-deps
```

---

## Architecture Patterns

### Recommended Project Structure

No new files or folders. All four tab files exist as placeholders:
```
src/admin/src/components/tabs/
├── SessionsTab.tsx     # Replace placeholder — Phase 22
├── ModulesTab.tsx      # Replace placeholder — Phase 22
├── LogTab.tsx          # Replace placeholder — Phase 22
└── QueueTab.tsx        # Replace placeholder — Phase 22
```

Type fixes also required:
```
src/admin/src/types.ts    # Fix QueueResponse shape + add LogResponse type
src/admin/src/lib/api.ts  # Fix getLogs return type
```

### Pattern 1: Standard Tab Fetch Pattern (from DashboardTab.tsx)

All tab components follow this pattern — fetch on mount and on `refreshKey` change, abort on cleanup:

```typescript
// Source: src/admin/src/components/tabs/DashboardTab.tsx (confirmed)
export default function SessionsTab({ selectedSession: _selectedSession, refreshKey }: SessionsTabProps) {
  const [data, setData] = useState<Session[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    api.getSessions()
      .then((sessions) => {
        if (controller.signal.aborted) return
        setData(sessions)
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])
  // ...
}
```

### Pattern 2: RestartOverlay Integration (from SettingsTab.tsx)

The RestartOverlay requires a `restarting` boolean state. Trigger it by calling `api.restart()` then setting `restarting = true`:

```typescript
// Source: src/admin/src/components/shared/RestartOverlay.tsx (confirmed)
const [restarting, setRestarting] = useState(false)

function handleSaveAndRestart() {
  api.updateSessionRole(sessionId, { role, subRole })
    .then(() => api.restart())
    .then(() => setRestarting(true))
    .catch(() => { /* show error */ })
}

<RestartOverlay
  active={restarting}
  onComplete={() => { setRestarting(false); /* re-fetch */ }}
  onTimeout={() => setRestarting(false)}
/>
```

### Pattern 3: Optimistic UI for Role Dropdowns (Sessions)

The CONTEXT.md requires optimistic role save: update local state immediately, show amber "Restart required" notice, then save. Track saved vs. pending state:

```typescript
// Optimistic pattern — local state updates immediately
const [localRoles, setLocalRoles] = useState<Record<string, { role: string; subRole: string }>>({})
const [pendingRestart, setPendingRestart] = useState(false)

function handleRoleChange(sessionId: string, role: string) {
  setLocalRoles(prev => ({ ...prev, [sessionId]: { ...prev[sessionId], role } }))
  setPendingRestart(true)
}
```

### Pattern 4: Module Assignments with TagInput

TagInput in search mode requires a `searchFn` that returns `{ value: string; label: string }[]`. Wire it to `api.getDirectory({ search: query, type: 'dm' })`:

```typescript
// Source: src/admin/src/components/shared/TagInput.tsx (confirmed)
const searchFn = async (query: string) => {
  const res = await api.getDirectory({ search: query, limit: '10' })
  return res.contacts.map(c => ({
    value: c.jid,
    label: c.displayName ?? c.jid,
  }))
}

<TagInput
  values={assignments.map(a => a.jid)}
  onChange={handleAssignmentChange}
  resolvedNames={resolvedNames}
  searchFn={searchFn}
  placeholder="Add chat..."
/>
```

### Anti-Patterns to Avoid

- **Wrong QueueResponse type:** `types.ts` defines `QueueResponse` as `{ dm: { depth, processing }, group: { depth, processing } }` but the server actually returns `QueueStats`: `{ dmDepth, groupDepth, dmOverflowDrops, groupOverflowDrops, totalProcessed, totalErrors }`. DO NOT use the current type as-is.
- **getLogs typed as `string`:** `api.getLogs` is typed as `request<string>` but the server returns a JSON object `{ lines: string[], source: string, total: number }`. Must fix.
- **Polling logs:** The Log tab should NOT auto-poll. It is refresh-on-demand (via `refreshKey` or a manual refresh button).
- **Calling `api.restart()` without role save:** Sessions tab must save role first (PUT /sessions/:id/role) before triggering restart.
- **Single restart for multiple session changes:** If the user edits multiple sessions, collect all changes then save all before restarting once.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toggle UI | Custom toggle div | Switch from @radix-ui/react-switch (already installed) | Accessible, consistent styling |
| Dropdown/select | Custom select | Select from @radix-ui/react-select (already installed) | Matches SettingsTab pattern |
| Tag/assignment list | Custom pill list | TagInput component (shared/TagInput.tsx) | Already built and tested in Phase 20 |
| Restart polling | Custom polling loop | RestartOverlay component | Already built, handles timeout + retry |
| Log line coloring | Custom regex | Pattern-based classname (see Code Examples) | Simple and sufficient |

---

## Common Pitfalls

### Pitfall 1: QueueResponse Type Mismatch

**What goes wrong:** The current `QueueResponse` type in `types.ts` does not match what the server sends.
**Why it happens:** `types.ts` was written speculatively and never verified against `inbound-queue.ts`.
**How to avoid:** Fix `QueueResponse` in `types.ts` to match `QueueStats` from `inbound-queue.ts` before building `QueueTab.tsx`.
**Warning signs:** TypeScript will not catch this at build time because the response is untyped at the fetch boundary — the mismatch will silently render `undefined` fields in the UI.

**Actual server response (from `inbound-queue.ts` `getStats()`):**
```typescript
interface QueueStats {
  dmDepth: number;
  groupDepth: number;
  dmOverflowDrops: number;
  groupOverflowDrops: number;
  totalProcessed: number;
  totalErrors: number;
}
```

**Current (WRONG) type in `types.ts`:**
```typescript
export interface QueueResponse {
  dm: { depth: number; processing: boolean };    // WRONG
  group: { depth: number; processing: boolean }; // WRONG
}
```

### Pitfall 2: getLogs Return Type is Wrong

**What goes wrong:** `api.getLogs()` is typed as `request<string>` but the server returns `{ lines: string[], source: string, total: number }`.
**Why it happens:** Phase 18 scaffolding typed it conservatively.
**How to avoid:** Add a `LogResponse` type to `types.ts` and update `api.getLogs()` return type.

**Actual server response (from monitor.ts lines 4337):**
```typescript
interface LogResponse {
  lines: string[];    // array of raw log line strings
  source: string;     // "journalctl" | "file" | "none" | "error"
  total: number;      // count of lines after filtering (before 500-cap trim)
}
```

### Pitfall 3: Log Level Filtering is Server-Side

**What goes wrong:** Implementing client-side log level filtering when the server already filters by `?level=` param.
**Why it happens:** The Log tab UI shows level filter chips, which look like client-side controls.
**How to avoid:** Send level filter to server via query param: `api.getLogs({ level: 'error' })`. Valid values: `all`, `error`, `warn`, `info`. The server uses pattern matching (not structured log levels) so `DEBUG` is not a distinct server-side level — all non-error/non-warn lines are "info" according to server logic.

**Level param behavior (from monitor.ts lines 4313-4329):**
- `all` (default): no filtering
- `error`: matches `error|fail|crash|exception|isError[=:]true`
- `warn`: matches `warn|drop |skip|reject|denied|mismatch`
- `info`: lines NOT matching error or warn patterns

**UI chips:** Show INFO, WARN, ERROR, ALL. Map "DEBUG" to "all" or omit it — the server has no DEBUG level.

### Pitfall 4: Sessions Tab — Role Save Requires Restart

**What goes wrong:** Saving a role change without restarting the gateway has no effect on live behavior.
**Why it happens:** The role is written to `openclaw.json` but the running process reads config at startup.
**How to avoid:** The CONTEXT.md already mandates the Save & Restart flow. Make it clear in UI that changes require a restart (amber "Restart required" notice).

### Pitfall 5: Module Config Forms — No Config Endpoint Exists

**What goes wrong:** Attempting to build a config form that PUTs module config when no such endpoint exists.
**Why it happens:** The CONTEXT.md mentions "inline config form (module-specific settings rendered dynamically)" but there is NO `/api/admin/modules/:id/config` endpoint in monitor.ts.
**How to avoid:** The `Module` type only has `{ id, name, description, enabled, assignmentCount }` — no config fields. The config form described in CONTEXT.md likely refers to **assignment management** (which chats the module applies to). Implement assignment management via TagInput; omit a config form unless the module object contains config fields.
**Warning signs:** If you grep monitor.ts for `/modules/` you will find only: enable, disable, assignments (GET/POST/DELETE). No config route exists.

### Pitfall 6: Auto-Scroll Interaction with Refresh

**What goes wrong:** After a refresh, the log scrolls to bottom but the user had intentionally scrolled up to read earlier entries.
**How to avoid:** Track user scroll intent: set a `userScrolled` ref to `true` when the user scrolls up. Only auto-scroll to bottom on initial load and on explicit "scroll to bottom" button click, not on every `refreshKey` tick.

---

## Code Examples

### Sessions Tab — Role Dropdown Pair

```typescript
// Source: Established pattern from SettingsTab.tsx; types confirmed from types.ts
const ROLE_OPTIONS = [
  { value: 'bot', label: 'Bot — AI agent controls this session' },
  { value: 'human', label: 'Human — human-controlled session' },
]
const SUBROLE_OPTIONS = [
  { value: 'full-access', label: 'Full Access — can send and receive' },
  { value: 'listener', label: 'Listener — receive only, no sending' },
]

// Render per session card:
<Select value={localRole} onValueChange={(v) => handleRoleChange(session.sessionId, v)}>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent>
    {ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
  </SelectContent>
</Select>
```

### Log Tab — Level Chip Filter

```typescript
// Map UI chip names to server-accepted level values
const LEVEL_MAP: Record<string, string> = {
  ALL:   'all',
  INFO:  'info',
  WARN:  'warn',
  ERROR: 'error',
}
const [activeLevel, setActiveLevel] = useState('all')

// On chip click:
setActiveLevel(LEVEL_MAP[chip])

// On fetch:
api.getLogs({ lines: 300, level: activeLevel, search: searchQuery })
```

### Log Tab — Line Color Coding

```typescript
// Simple pattern-based coloring — no dependency needed
function logLineClass(line: string): string {
  if (/error|fail|crash|exception/i.test(line)) return 'text-destructive'
  if (/warn|drop |skip|reject|denied/i.test(line)) return 'text-yellow-500 dark:text-yellow-400'
  return 'text-muted-foreground'
}

// In render:
{lines.map((line, i) => (
  <div key={i} className={cn('font-mono text-xs whitespace-pre-wrap break-all', logLineClass(line))}>
    {line}
  </div>
))}
```

### Queue Tab — Corrected Types

```typescript
// CORRECT QueueResponse type (fix types.ts before implementing QueueTab)
export interface QueueResponse {
  dmDepth: number;
  groupDepth: number;
  dmOverflowDrops: number;
  groupOverflowDrops: number;
  totalProcessed: number;
  totalErrors: number;
}

// Derive "processing" state from depths:
const isProcessing = data.dmDepth > 0 || data.groupDepth > 0
```

### LogResponse Type to Add

```typescript
// Add to types.ts
export interface LogResponse {
  lines: string[];
  source: 'journalctl' | 'file' | 'none' | 'error';
  total: number;
}

// Update api.ts:
getLogs: (params?: { lines?: number; level?: string; search?: string }) => {
  // ...
  return request<LogResponse>(`/logs${qs}`)
},
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Embedded HTML/JS strings in monitor.ts | React components in src/admin/ | Phase 18 | Phase 22 replaces the last HTML-based tabs |
| Inline polling in HTML JS | useEffect with AbortController | Phase 20 | All React tabs use abort-on-cleanup pattern |
| Manual DOM manipulation for tabs | Tab components with props | Phase 19 | refreshKey drives re-fetch in all tabs |

---

## Open Questions

1. **Module config form**
   - What we know: The `Module` type has `{ id, name, description, enabled, assignmentCount }` — no config fields
   - What's unclear: CONTEXT.md says "inline config form (module-specific settings rendered dynamically)" but no config endpoint exists in monitor.ts
   - Recommendation: Interpret as assignment management via TagInput only. If modules ever expose a `config` field, that's a future phase concern. Planner should clarify or scope to assignment management only.

2. **"Paused" queue state**
   - What we know: `QueueStats` has no `paused` field; CONTEXT.md says "show processing state (idle/processing/paused)"
   - What's unclear: There is no "paused" concept in `InboundQueue` — only active draining or empty
   - Recommendation: Show "Idle" when both depths are 0, "Processing" when depth > 0. Omit "Paused" — it's not a real server state.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | None detected in src/admin/ — vitest runs from project root |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESS-01 | Sessions render with correct role/subRole dropdowns | unit | `npx vitest run --reporter=verbose` | ❌ Wave 0 |
| SESS-02 | Save & Restart triggers RestartOverlay | unit | `npx vitest run --reporter=verbose` | ❌ Wave 0 |
| SESS-03 | Health status badge renders correctly per session | unit | `npx vitest run --reporter=verbose` | ❌ Wave 0 |
| MODS-01 | Module toggle sends enable/disable request | unit | `npx vitest run --reporter=verbose` | ❌ Wave 0 |
| LOGT-01 | Log tab renders lines with level filtering | unit | `npx vitest run --reporter=verbose` | ❌ Wave 0 |
| QUEU-01 | Queue tab renders depth stats from corrected type | unit | `npx vitest run --reporter=verbose` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/admin/src/components/tabs/__tests__/SessionsTab.test.tsx` — covers SESS-01, SESS-02, SESS-03
- [ ] `src/admin/src/components/tabs/__tests__/ModulesTab.test.tsx` — covers MODS-01
- [ ] `src/admin/src/components/tabs/__tests__/LogTab.test.tsx` — covers LOGT-01
- [ ] `src/admin/src/components/tabs/__tests__/QueueTab.test.tsx` — covers QUEU-01

---

## Sources

### Primary (HIGH confidence)
- `src/inbound-queue.ts` — `QueueStats` interface, `getStats()` return shape (lines 22-29, 102-111)
- `src/monitor.ts` lines 4262-4342 — `/api/admin/logs` handler: request params, response shape `{ lines, source, total }`
- `src/monitor.ts` lines 4917-4963 — `/api/admin/sessions` handler: enriched session array shape
- `src/monitor.ts` lines 4967-5028 — `PUT /api/admin/sessions/:id/role`: accepted fields `role`, `subRole`, valid values
- `src/monitor.ts` lines 5034-5147 — all module endpoints: list, enable, disable, assignments CRUD
- `src/admin/src/types.ts` — confirmed `Session` interface, `Module` interface, (broken) `QueueResponse`
- `src/admin/src/lib/api.ts` — all method signatures; confirmed `getLogs` typed as `string` (should be `LogResponse`)
- `src/admin/src/components/shared/RestartOverlay.tsx` — full component confirmed available
- `src/admin/src/components/shared/TagInput.tsx` — `searchFn` prop pattern confirmed
- `src/admin/src/components/tabs/DashboardTab.tsx` — established fetch pattern (useEffect + AbortController + refreshKey)
- `package.json` — confirmed `@tanstack/react-virtual` NOT installed; `@tanstack/react-table` is installed

### Secondary (MEDIUM confidence)
- CONTEXT.md decision log — user decisions confirmed, module config form ambiguity noted

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed from package.json and existing components
- Architecture: HIGH — all patterns verified from existing tab implementations
- API shapes: HIGH — verified directly from monitor.ts and inbound-queue.ts source
- Type mismatches: HIGH — confirmed by comparing types.ts against actual server code
- Pitfalls: HIGH — confirmed from source code, not speculation

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable codebase, no external API changes)
