# Phase 57: Admin UI & Observability - Research

**Researched:** 2026-03-27
**Domain:** React admin panel extension + Node.js HTTP API route
**Confidence:** HIGH

## Summary

Phase 57 adds observability and configuration UI for the mimicry system built in Phases 53-56. All the backend primitives exist and are well-factored: `MimicryDb.countRecentSends()`, `MimicryDb.getFirstSendAt()`, `getMaturityPhase()`, `getCapStatus()`, `resolveGateConfig()`, `checkTimeOfDay()`, and `resolveCapLimit()` are all exported from `src/mimicry-gate.ts`. The API endpoint (`GET /api/admin/mimicry`) needs one new route in `monitor.ts` that calls these functions per active session. The React side needs two changes: a new dashboard card component and a new settings section in the existing `SettingsTab.tsx`.

The existing admin panel patterns are mature and consistent. DashboardTab uses `Card`/`Badge`/`Skeleton` from shadcn/ui, with parallel `Promise.all` fetches and AbortController for cleanup. SettingsTab uses `setNestedValue()` + `updateConfig()` for auto-saved config mutations that fire `POST /api/admin/config` with `{ waha: {...} }` wrapper. These patterns must be followed exactly.

**Primary recommendation:** One plan is sufficient. Backend route + React components are small, well-bounded, and share no sequential dependency. Build the API route and both UI pieces in a single plan.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- `GET /api/admin/mimicry` returns JSON with per-session gate open/closed, cap usage (current/max), maturity phase label, days until next phase upgrade
- Uses existing `requireAdminAuth()` Bearer token auth
- Data sourced from MimicryDb (cap usage, maturity) + resolveGateConfig + checkTimeOfDay (gate status)
- New "Send Gates" card on the dashboard/status tab
- Per-session layout: maturity phase label, days until next upgrade, hourly cap usage bar (N/max), gate open/closed badge
- Follows existing admin panel patterns (React, shadcn/ui, Tailwind)
- New section in the Config tab for mimicry settings
- Inputs: send window start/end hours (number inputs 0-23), timezone selector (text input, IANA string), hourly cap limit (number)
- Progressive limits table: New/Warming/Stable rows with editable cap values
- Save via existing POST /api/admin/config with `{"waha": {sendGate: {...}, hourlyCap: {...}}}` wrapper

### Claude's Discretion

- Exact card layout and styling
- How to display maturity phase progression
- Whether to use a dropdown or text input for timezone
- Table formatting for progressive limits

### Deferred Ideas (OUT OF SCOPE)

None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Dashboard card showing maturity phase, days until upgrade, current cap usage vs limit, gate open/closed | `getCapStatus()` provides count/limit/remaining/maturity. `getMaturityPhase()` + `getFirstSendAt()` gives days until next phase. `checkTimeOfDay()` gives gate open/closed. All called per-session. |
| UI-02 | Settings tab: send gate hours pickers, timezone selector, hourly cap limit inputs, progressive limits table | `sendGate` and `hourlyCap` Zod schemas in `config-schema.ts` define exact field names. `SettingsTab.tsx` `setNestedValue()` + auto-save handles the config mutation pattern. |
| UI-03 | GET /api/admin/mimicry endpoint returning gate status, cap usage, maturity per session | New route in `monitor.ts` calling `listEnabledWahaAccounts()` + mimicry-gate.ts primitives per session. Pattern mirrors GET /api/admin/sessions. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (existing) | UI framework | Already in project |
| shadcn/ui components | existing | Card, Badge, Skeleton, Input, Label, Switch | Already in project, used by all tabs |
| Tailwind CSS | existing | Utility styling | Already in project |
| better-sqlite3 | existing | SQLite reads via MimicryDb | Already used by mimicry-gate.ts |

No new dependencies required.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── monitor.ts                           # add GET /api/admin/mimicry route here
├── mimicry-gate.ts                      # exports all needed query functions (no changes)
├── admin/src/
│   ├── types.ts                         # add MimicryStatusResponse interface
│   ├── lib/api.ts                       # add api.getMimicryStatus() method
│   └── components/tabs/
│       ├── DashboardTab.tsx             # add SendGatesCard component + fetch
│       └── SettingsTab.tsx              # add mimicry settings section
```

### Pattern 1: New Admin API Route (monitor.ts)
**What:** GET route following exact pattern of existing stats/sessions routes
**When to use:** Any new read-only admin endpoint

```typescript
// Source: src/monitor.ts (lines 769-897 pattern)
// GET /api/admin/mimicry
if (req.url === "/api/admin/mimicry" && req.method === "GET") {
  try {
    const db = getMimicryDb();
    const accounts = listEnabledWahaAccounts(opts.config);
    const wahaConfig = (opts.config.channels?.waha ?? {}) as any;
    const now = Date.now();

    const sessions = accounts.map((acc) => {
      const session = acc.session;
      const firstSendAt = db.getFirstSendAt(session);
      const maturity = getMaturityPhase(firstSendAt, now);
      const limit = resolveCapLimit(session, maturity, wahaConfig, null);
      const capStatus = getCapStatus(session, limit, db, now);
      const gateConfig = resolveGateConfig(session, wahaConfig, null);
      const gateResult = checkTimeOfDay(gateConfig, now);

      // Days until next maturity phase upgrade
      const ageDays = firstSendAt ? (now - firstSendAt) / 86_400_000 : 0;
      const daysUntilUpgrade = maturity === "new" ? Math.max(0, 7 - ageDays)
        : maturity === "warming" ? Math.max(0, 30 - ageDays)
        : null; // stable has no next phase

      return {
        session,
        name: acc.name ?? session,
        maturity,
        daysUntilUpgrade: daysUntilUpgrade !== null ? Math.ceil(daysUntilUpgrade) : null,
        capCount: capStatus.count,
        capLimit: capStatus.limit,
        capRemaining: capStatus.remaining,
        gateOpen: gateResult.allowed,
        gateEnabled: gateConfig.enabled,
      };
    });

    writeJsonResponse(res, 200, { sessions });
  } catch (err) {
    log.error("GET /api/admin/mimicry failed", { error: String(err) });
    writeJsonResponse(res, 500, { error: "Internal server error" });
  }
  return;
}
```

### Pattern 2: Dashboard Card Component (DashboardTab.tsx)
**What:** New Card with per-session rows, fetches via `api.getMimicryStatus()`
**When to use:** Adding new dashboard section

The dashboard fetches stats+config in parallel via `Promise.all`. The new mimicry fetch can be added as a third entry in that `Promise.all`, or as a separate `useEffect` that fires alongside it. The simpler approach is a separate `useEffect` with the same `refreshKey` dependency so it auto-refreshes with the rest.

```typescript
// Recommended: separate useEffect for mimicry data — clean separation of concerns
const [mimicry, setMimicry] = useState<MimicryStatusResponse | null>(null)

useEffect(() => {
  const controller = new AbortController()
  api.getMimicryStatus()
    .then((m) => { if (!controller.signal.aborted) setMimicry(m) })
    .catch((err) => console.error('Mimicry status fetch failed:', err))
  return () => controller.abort()
}, [refreshKey])
```

Cap usage bar: use a simple `<div>` with inline width percentage, styled with Tailwind — no charting library needed.

```tsx
// Cap usage visual bar
<div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
  <div
    className="h-full rounded-full bg-primary transition-all"
    style={{ width: `${Math.min(100, (s.capCount / s.capLimit) * 100)}%` }}
  />
</div>
```

### Pattern 3: Settings Section (SettingsTab.tsx)
**What:** New collapsible Card section using existing `updateConfig()` + `setNestedValue()` auto-save pattern
**When to use:** Adding config fields that map to Zod schema keys

Progressive limits table uses existing shadcn `Input` with `type="number"`. Each row maps to `hourlyCap.limits.new`, `hourlyCap.limits.warming`, `hourlyCap.limits.stable`. The `updateConfig("hourlyCap.limits.new", value)` call pattern handles nested writes.

```typescript
// Source: SettingsTab.tsx updateConfig pattern (line 182)
// Timezone text input — IANA string, no dropdown needed (Claude's discretion)
<Input
  value={config?.sendGate?.timezone ?? 'UTC'}
  onChange={(e) => updateConfig('sendGate.timezone', e.target.value)}
  placeholder="e.g. Asia/Jerusalem"
/>

// Hours: number inputs 0-23
<Input
  type="number" min={0} max={23}
  value={config?.sendGate?.startHour ?? 7}
  onChange={(e) => updateConfig('sendGate.startHour', parseInt(e.target.value, 10))}
/>
```

**WahaConfig type extension required:** `src/admin/src/types.ts` `WahaConfig` interface is missing `sendGate` and `hourlyCap` fields. Must add them before the Settings section can type-check:

```typescript
// Add to WahaConfig in types.ts
sendGate?: {
  enabled: boolean
  timezone: string
  startHour: number
  endHour: number
  onBlock: 'reject' | 'queue'
}
hourlyCap?: {
  enabled: boolean
  limits: { new: number; warming: number; stable: number }
}
```

### Anti-Patterns to Avoid
- **Separate save button for mimicry settings:** All settings in SettingsTab auto-save via 1.5s debounce. Don't add a dedicated Save button — it breaks the UX pattern.
- **Fetching mimicry data from DashboardTab stats handler:** Don't extend `GET /api/admin/stats` — add a dedicated route. Keeps the stats handler from growing further.
- **Calling `checkAndConsumeCap` from the API route:** The mimicry status endpoint must be read-only. Use `getCapStatus()` (read-only) not `checkAndConsumeCap()` (writes a send record).
- **Importing `MimicryDb` directly in monitor.ts without `getMimicryDb()`:** Always use the singleton getter to avoid creating duplicate DB connections.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cap count for display | Custom SQL query | `getCapStatus()` from mimicry-gate.ts | Already tested, handles rolling window correctly |
| Maturity phase label | Custom age calculation | `getMaturityPhase(firstSendAt, now)` | Already tested, handles null firstSendAt |
| Gate open/closed status | Custom hour comparison | `checkTimeOfDay(gateConfig, now)` | Cross-midnight logic carefully tested; DO NOT reimplement |
| Config merge (global/session) | Custom merge logic | `resolveGateConfig()` + `resolveCapLimit()` | 3-level merge already implemented and tested |
| Days until upgrade | Already above | Simple subtraction after `getMaturityPhase` | Trivial calculation, not worth abstracting |

## Common Pitfalls

### Pitfall 1: `getCapStatus` vs `checkAndConsumeCap`
**What goes wrong:** Calling `checkAndConsumeCap` from the `/api/admin/mimicry` status handler records a fake send, consuming cap quota every time the admin panel refreshes.
**Why it happens:** Both functions return cap counts. Easy to grab the wrong one.
**How to avoid:** `getCapStatus()` is the read-only version. The comment at line 299 of mimicry-gate.ts says "DO NOT CHANGE -- this must remain read-only."
**Warning signs:** Cap counter incrementing without messages being sent.

### Pitfall 2: Type mismatch in WahaConfig interface
**What goes wrong:** `SettingsTab.tsx` uses `config?.sendGate?.startHour` but TypeScript fails because `WahaConfig` in `types.ts` doesn't have `sendGate` or `hourlyCap` fields.
**Why it happens:** `types.ts` was last updated before Phase 53 fields were added to the Zod schema.
**How to avoid:** Add `sendGate` and `hourlyCap` to `WahaConfig` in `src/admin/src/types.ts` as the first task in the plan.
**Warning signs:** TypeScript error: "Property 'sendGate' does not exist on type 'WahaConfig'".

### Pitfall 3: Route placement in monitor.ts
**What goes wrong:** New route placed after the catch-all static file handler, so requests to `/api/admin/mimicry` serve a 404 HTML file instead of JSON.
**Why it happens:** monitor.ts has a static file fallback at the end of the handler chain.
**How to avoid:** Place the new route in the `/api/admin/` block, alongside the existing `/api/admin/stats` and `/api/admin/sessions` routes (around lines 769 and 1454). The auth guard at line 517 covers all `/api/admin/` routes automatically.
**Warning signs:** Admin panel fetch returns HTML instead of JSON; browser console shows "Unexpected token '<' in JSON".

### Pitfall 4: `daysUntilUpgrade` for stable phase
**What goes wrong:** Returning a numeric value for stable-phase sessions implies there's a next phase to upgrade to. "Stable" is the final phase — no upgrade exists.
**Why it happens:** Reusing the same calculation without a branch for stable.
**How to avoid:** Return `null` for stable-phase sessions. Frontend displays "Stable" badge without a days countdown.
**Warning signs:** Dashboard showing "0 days until next upgrade" for stable-phase sessions.

### Pitfall 5: `parseInt` on hour inputs without validation
**What goes wrong:** User types a non-numeric string or empty string; `parseInt` returns `NaN`; Zod rejects the config; auto-save fails silently.
**Why it happens:** `<Input type="number">` still passes the raw string value in `onChange`.
**How to avoid:** Guard with `isNaN` before calling `updateConfig`. Pattern: `const n = parseInt(e.target.value, 10); if (!isNaN(n)) updateConfig('sendGate.startHour', n)`.
**Warning signs:** Auto-save error toast; Zod validation error on `startHour`.

## Code Examples

### Adding `api.getMimicryStatus()` to api.ts
```typescript
// Source: src/admin/src/lib/api.ts pattern (lines 63-81)
getMimicryStatus: () => request<MimicryStatusResponse>('/mimicry'),
```

### MimicryStatusResponse type (new, add to types.ts)
```typescript
export interface MimicrySessionStatus {
  session: string
  name: string
  maturity: 'new' | 'warming' | 'stable'
  daysUntilUpgrade: number | null  // null for stable phase
  capCount: number
  capLimit: number
  capRemaining: number
  gateOpen: boolean
  gateEnabled: boolean
}

export interface MimicryStatusResponse {
  sessions: MimicrySessionStatus[]
}
```

### Progressive limits table in SettingsTab
```tsx
// Three rows: New, Warming, Stable
{[
  { label: 'New (0–7 days)', key: 'new', default: 15 },
  { label: 'Warming (8–30 days)', key: 'warming', default: 30 },
  { label: 'Stable (30+ days)', key: 'stable', default: 50 },
].map(({ label, key, default: dflt }) => (
  <div key={key} className="flex items-center justify-between text-sm">
    <span className="text-muted-foreground">{label}</span>
    <Input
      type="number" min={1} className="w-20 h-7 text-right"
      value={config?.hourlyCap?.limits?.[key as 'new' | 'warming' | 'stable'] ?? dflt}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10)
        if (!isNaN(n) && n > 0) updateConfig(`hourlyCap.limits.${key}`, n)
      }}
    />
  </div>
))}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run tests/mimicry-gate.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-03 | GET /api/admin/mimicry returns correct shape | unit | `npx vitest run tests/mimicry-status-api.test.ts -x` | Wave 0 |
| UI-01 | Dashboard card renders maturity + cap data | unit (React) | `npx vitest run tests/ui-mimicry-card.test.tsx -x` | Wave 0 |
| UI-02 | Settings fields update sendGate/hourlyCap config | unit (React) | Existing `tests/ui-god-mode-field.test.ts` pattern | Wave 0 |

**Note:** UI-01 and UI-02 are React component tests. Given the project has `@testing-library/jest-dom`, a lightweight snapshot or render test suffices. However, the existing `ui-tag-input.test.ts` and `ui-god-mode-field.test.ts` tests verify React component behavior — the same pattern applies here.

**Pragmatic alternative:** The backend API test (UI-03) is the most valuable automated test. The React component tests (UI-01, UI-02) are lower ROI for simple display/form components. If wave 0 gaps are to be minimized, prioritize the API test only and mark UI-01/UI-02 as manual.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/mimicry-status-api.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/mimicry-status-api.test.ts` — covers UI-03 (GET /api/admin/mimicry route logic, per-session shape)
- [ ] React component test for SendGatesCard — covers UI-01 (optional if manual testing acceptable)

## Environment Availability

Step 2.6: SKIPPED — no new external dependencies. All tools, services, and runtime infrastructure were established in Phases 53-55.

## Sources

### Primary (HIGH confidence)
- `src/mimicry-gate.ts` — `MimicryDb`, `getCapStatus`, `getMaturityPhase`, `resolveGateConfig`, `checkTimeOfDay`, `resolveCapLimit` — all exported and ready to call
- `src/config-schema.ts` — `sendGate` and `hourlyCap` Zod schemas, exact field names and defaults
- `src/monitor.ts` — `requireAdminAuth`, `listEnabledWahaAccounts`, `writeJsonResponse`, route handler pattern
- `src/admin/src/components/tabs/DashboardTab.tsx` — Card/Badge/Skeleton/SSE pattern
- `src/admin/src/components/tabs/SettingsTab.tsx` — `updateConfig`, `setNestedValue`, auto-save pattern
- `src/admin/src/lib/api.ts` — `request<T>` wrapper, endpoint registration pattern
- `src/admin/src/types.ts` — `WahaConfig`, `StatsResponse` — needs `sendGate`/`hourlyCap` addition

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project
- Architecture: HIGH — patterns copied from working code in same codebase
- Pitfalls: HIGH — derived from direct code inspection of the integration points

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable codebase, no fast-moving dependencies)
