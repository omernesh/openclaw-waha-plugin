# Phase 20: Dashboard and Settings Tabs - Research

**Researched:** 2026-03-18
**Domain:** React (shadcn/ui + Radix UI + Tailwind CSS v4) — admin panel tab implementation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dashboard Tab**
- Per-session stat cards using shadcn Card component — each session gets its own section within filter cards (DM Keyword Filter, Group Keyword Filter, Presence System, Access Control)
- Health section shows per-session connection health (healthy/unhealthy, consecutive failures, last check)
- Human-readable labels: "wpm" → "Words Per Minute", "readDelayMs" → "Read Delay", "typingDurationMs" → "Typing Duration", "pauseChance" → "Pause Chance"
- Filter cards (DM Keyword, Group Keyword) are collapsible using shadcn Collapsible or Accordion
- Access Control resolves all JID formats (@c.us, @lid, bare numbers) to names using `/api/admin/directory/resolve` endpoint
- Data fetched from `/api/admin/stats` and `/api/admin/config`

**Settings Tab**
- All settings rendered as React form components (shadcn Switch, Select, Input, Textarea)
- JID fields (Allow From, Group Allow From, Allowed Groups, God Mode Users) use shadcn Command/Combobox with name search via `/api/admin/directory` search endpoint
- Tag-style input for JID fields: type name → search dropdown → select → pill/bubble with x to remove
- Mention patterns use same tag-style input (enter pattern → pill → x to delete)
- Contact picker with search, clear button (x in search bar), dropdown auto-closes after selection
- Save button sends POST to `/api/admin/config` with `{"waha": {...}}` wrapper
- Save & Restart: shows blocking polling overlay, polls every 2s until gateway responds, same pattern as existing

### Claude's Discretion
- Exact card layout/spacing beyond shadcn defaults
- How to group settings sections (can follow existing tab's section grouping)
- Whether to use react-hook-form or uncontrolled inputs (both acceptable)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | Dashboard cards rebuilt as React Card components with per-session stats | StatsResponse shape confirmed; sessions array in stats payload; shadcn Card pattern documented |
| DASH-02 | Health section shows per-session health details | Sessions endpoint returns healthStatus, consecutiveFailures, lastCheck, wahaStatus per session |
| DASH-03 | Human-readable labels throughout — no raw config keys | LABEL_MAP confirmed; full mapping table in Code Examples section |
| DASH-04 | Filter cards are collapsible | Radix Collapsible primitive needed (not yet installed); Tailwind CSS v4 approach documented |
| DASH-05 | Access Control resolves all JID formats to names | `/api/admin/directory/resolve?jids=` returns `{resolved: Record<string,string>}`; api.resolveNames() wrapper confirmed |
| SETT-01 | All settings rebuilt as React form components | Full config payload documented; all fields mapped |
| SETT-02 | Tag inputs with shadcn Command/Combobox + name search for JID fields | api.getDirectory() with search= param; directory returns items array; pattern documented |
| SETT-03 | Mention patterns use tag-style input | Same TagInput component as JID fields but without search (freeform text entry) |
| SETT-04 | Contact picker with search, clear button, auto-close | Command/Combobox with onSelect close; clear button clears input value |
| SETT-05 | Save & Restart with polling overlay | api.restart() + poll api.getStats() every 2s; overlay pattern documented |
</phase_requirements>

## Summary

Phase 20 implements two data-rich React tabs on top of an already-working API layer. The API routes are stable — all `/api/admin/*` endpoints exist and their exact JSON shapes have been confirmed by reading the monitor.ts source. No backend changes are required.

The key challenge is UI composition: this phase needs several Radix UI primitives that are not yet installed (`@radix-ui/react-collapsible`, `@radix-ui/react-switch`, `@radix-ui/react-select`, `@radix-ui/react-label`, `@radix-ui/react-checkbox`, `@radix-ui/react-popover`). Since the project writes shadcn components manually (Phase 19 decision: CLI incompatible with monorepo layout), the implementer must write these component files by hand following the existing button.tsx and separator.tsx style.

The Settings tab has the most complexity: a reusable `TagInput` component that handles both freeform patterns (mention patterns) and directory-search JID pickers (Allow From, God Mode Users). The tag input must save raw JIDs to config while displaying resolved contact names as pill labels — this split (display name vs stored value) is a confirmed pattern from the existing embedded JS in monitor.ts.

**Primary recommendation:** Implement in two plans — Plan 01 installs Radix primitives and writes the shared `TagInput` + `ContactPicker` components plus the Dashboard tab; Plan 02 wires the Settings form using those shared components.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | ^19.2.4 | UI framework | Already in package.json |
| @radix-ui/react-collapsible | latest | Collapsible filter cards (DASH-04) | Radix primitive; needs install |
| @radix-ui/react-switch | latest | Boolean toggles in Settings (SETT-01) | Radix primitive; needs install |
| @radix-ui/react-select | latest | Dropdown selects in Settings (SETT-01) | Radix primitive; needs install |
| @radix-ui/react-label | latest | Form labels in Settings (SETT-01) | Radix primitive; needs install |
| @radix-ui/react-checkbox | latest | Checkbox fields (pairingMode, etc.) | Radix primitive; needs install |
| @radix-ui/react-popover | latest | Command popover for contact picker (SETT-02) | Radix primitive; needs install |
| lucide-react | ^0.577.0 | Icons (ChevronDown, X, Check, Search) | Already in package.json |
| tailwindcss | ^4.2.1 | Styling via CSS variables | Already in package.json |

### Already Installed (no new install needed)
| Library | Version | Purpose |
|---------|---------|---------|
| @radix-ui/react-slot | ^1.2.4 | asChild pattern (Button) |
| @radix-ui/react-separator | ^1.1.8 | Dividers |
| @radix-ui/react-dropdown-menu | ^2.1.16 | Dropdown menus |
| @radix-ui/react-tooltip | ^1.2.8 | Tooltips |
| class-variance-authority | ^0.7.1 | Component variants |
| clsx + tailwind-merge | latest | cn() utility |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Radix Collapsible | Details/summary HTML | Radix has animated open/close; details is simpler but no animation |
| Radix Select | Native `<select>` | Native select has no custom styling; Radix matches shadcn aesthetic |
| react-hook-form | Uncontrolled refs | react-hook-form adds a dependency; uncontrolled inputs are sufficient for this form size |

**Installation:**
```bash
npm install @radix-ui/react-collapsible @radix-ui/react-switch @radix-ui/react-select @radix-ui/react-label @radix-ui/react-checkbox @radix-ui/react-popover --legacy-peer-deps
```
Note: `--legacy-peer-deps` required due to vite@8/vitest peer conflict (established in Phase 18-01).

## Architecture Patterns

### Recommended Project Structure
```
src/admin/src/
├── components/
│   ├── tabs/
│   │   ├── DashboardTab.tsx     # Replace placeholder (DASH-01..05)
│   │   └── SettingsTab.tsx      # Replace placeholder (SETT-01..05)
│   ├── ui/
│   │   ├── card.tsx             # NEW — shadcn Card (DASH-01)
│   │   ├── collapsible.tsx      # NEW — shadcn Collapsible (DASH-04)
│   │   ├── input.tsx            # NEW — shadcn Input (SETT-01)
│   │   ├── label.tsx            # NEW — shadcn Label (SETT-01)
│   │   ├── select.tsx           # NEW — shadcn Select (SETT-01)
│   │   ├── switch.tsx           # NEW — shadcn Switch (SETT-01)
│   │   ├── checkbox.tsx         # NEW — shadcn Checkbox
│   │   ├── badge.tsx            # NEW — shadcn Badge (pills for TagInput)
│   │   ├── popover.tsx          # NEW — shadcn Popover (SETT-02)
│   │   ├── command.tsx          # NEW — shadcn Command (SETT-02,04)
│   │   └── (existing: button, separator, sheet, dropdown-menu, sidebar)
│   └── shared/
│       ├── TagInput.tsx         # NEW — reusable tag/pill input (SETT-02,03,04)
│       └── JidPill.tsx          # NEW — resolved-name pill with x button
├── lib/
│   └── api.ts                   # Existing — no changes needed
└── types.ts                     # Needs StatsResponse refinement
```

### Pattern 1: Stats Data Fetching
**What:** Fetch `/api/admin/stats` on mount and on `refreshKey` change, filter by `selectedSession` client-side.
**When to use:** DashboardTab initial data load.
```typescript
// Standard pattern from TabHeader.tsx
useEffect(() => {
  const controller = new AbortController()
  api.getStats()
    .then((data) => { if (!controller.signal.aborted) setStats(data) })
    .catch(() => {})
  return () => controller.abort()
}, [refreshKey])
```

### Pattern 2: shadcn Component (Manual Write)
**What:** Write Radix-backed components manually — no CLI. Follow the separator.tsx style exactly.
**When to use:** Every new UI component for this project.
```typescript
// Source: separator.tsx pattern — established Phase 19
import * as React from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { cn } from "@/lib/utils"

const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger
const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent
export { Collapsible, CollapsibleTrigger, CollapsibleContent }
```

### Pattern 3: TagInput with JID Resolution
**What:** Pill-based multi-value input. Entry is raw JID; display resolves to contact name via `api.resolveNames()`. `getValue()` always returns raw JIDs.
**When to use:** Allow From, Group Allow From, Allowed Groups, God Mode Users fields.

The existing JS in monitor.ts (lines 1250-1295) defines this contract:
- `setValue(jids: string[])` — populate pills from saved config
- `getValue(): string[]` — return raw JIDs for config save
- On setValue, debounce-resolve names via `/api/admin/directory/resolve?jids=...`
- Pills show resolved name with raw JID in tooltip

### Pattern 4: Contact Picker (search-first)
**What:** Controlled Command/Combobox that searches directory. User types name → dropdown shows matches → click to add as pill → dropdown closes.
**When to use:** God Mode Users field (SETT-04) — uses directory search, not freeform.

Search call: `api.getDirectory({ search: query, limit: '10' })` returns `{items: DirectoryEntry[], total: number}`.
After selection, close popover by toggling open state.

### Pattern 5: Save & Restart Overlay
**What:** POST config → POST restart → show blocking overlay div → poll `api.getStats()` every 2s for up to 60s → auto-reload on success.
**When to use:** "Save & Restart" button in Settings (SETT-05).

From monitor.ts lines 2832-2895 (confirmed working pattern):
1. `await api.updateConfig(payload)` — save first, check for errors
2. `await api.restart()` — fire and ignore 502/network error (expected)
3. Show full-screen overlay with elapsed timer
4. Poll `api.getStats()` every 2s; on first 200, `location.reload()`
5. After 60s without response, show error and allow manual retry

### Anti-Patterns to Avoid
- **Rebuilding Name Resolver on refresh:** Do not re-create resolved pill labels on every 30s poll. Use `useRef` or memo to track "already resolved" JIDs — re-fetching causes visible flicker. The existing JS guards this with `_accessKvBuilt`.
- **Saving resolved names (not JIDs) to config:** TagInput `getValue()` must return raw JID strings, not display names. Names are display-only.
- **Calling `/api/admin/directory/resolve` per-JID:** Always batch. The endpoint accepts comma-separated JIDs: `?jids=jid1,jid2,jid3`. Max 500.
- **Using `setInterval` for polling:** Use `setTimeout` in a recursive callback so the poll interval is measured from response, not start. Avoids stacking requests if the server is slow.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Collapsible card animation | CSS height transition | `@radix-ui/react-collapsible` | Handles keyboard, ARIA, animation lifecycle |
| Toggle switch | `<input type="checkbox">` styled | `@radix-ui/react-switch` | Proper ARIA role="switch", keyboard support |
| Dropdown select | Native `<select>` or custom | `@radix-ui/react-select` | Full keyboard, focus management, portal |
| Search combobox | Custom input + filtered list | `@radix-ui/react-popover` + Command | Accessible filtering with cmdk patterns |
| Pill/badge styling | Custom CSS | shadcn Badge | Consistent variant system matches design |

**Key insight:** Radix primitives handle all accessibility and keyboard behavior. The project writes thin shadcn wrappers over them (2-10 lines each) — don't add extra abstraction.

## Common Pitfalls

### Pitfall 1: StatsResponse types are placeholder approximations
**What goes wrong:** `src/admin/src/types.ts` has `StatsResponse` typed as `Record<string, unknown>` for most fields. Code using these types won't get TypeScript errors for missing fields.
**Why it happens:** Phase 18 scaffold comment says "types are initial approximations, refine when wiring actual tabs."
**How to avoid:** Refine `StatsResponse` in `types.ts` before writing DashboardTab — use the confirmed shape from monitor.ts.
**Warning signs:** `d.dmFilter.stats.allowed` causes TS error if `dmFilter` is typed as `Record<string, unknown>`.

### Pitfall 2: Sessions endpoint shape mismatch
**What goes wrong:** TabHeader.tsx accesses `s.id` but the sessions endpoint returns `sessionId` (not `id`). The existing placeholder `Session` type has `id: string` but the actual API returns `sessionId`.
**Why it happens:** Type was approximated; TabHeader.tsx references `s.id` in the session picker (line 58).
**How to avoid:** `Session` type needs both `id` and `sessionId` — the enriched sessions endpoint returns `sessionId`, not `id`. Check TabHeader and update `Session` type to match actual response.
**Warning signs:** Session picker shows "undefined" for session names.

### Pitfall 3: POST /api/admin/config deep merges — don't send undefined fields
**What goes wrong:** Sending `{ waha: { someField: undefined } }` after JSON.stringify drops the key, and the merge preserves the existing value. But sending explicit `null` would overwrite to null.
**Why it happens:** JSON.stringify omits `undefined` values. The server does `deepMerge(currentWaha, incomingWaha)` — only keys present in incoming overwrite.
**How to avoid:** Omit fields you don't want to change (use `|| undefined` pattern from existing saveSettings JS). Never explicitly send `null` for optional fields.

### Pitfall 4: Radix primitives need explicit install
**What goes wrong:** Build fails with "Cannot find module '@radix-ui/react-collapsible'" even though it looks like a standard shadcn dependency.
**Why it happens:** Only the primitives used in Phase 19 components are installed. The node_modules confirms: no collapsible, switch, select, label, checkbox, or popover primitives.
**How to avoid:** Install all needed Radix primitives in Wave 0 before writing any component files that import them.

### Pitfall 5: Config save must send complete sub-objects
**What goes wrong:** Sending `{ waha: { dmFilter: { enabled: true } } }` causes `deepMerge` to preserve old `mentionPatterns`. This is correct behavior — but if the user clears all patterns, an empty array `[]` must be sent explicitly, not `undefined`.
**Why it happens:** `deepMerge` only overwrites keys present in `incomingWaha`. Missing keys are preserved from current config.
**How to avoid:** Always send complete sub-objects (dmFilter, groupFilter, presence, etc.) as shown in the existing saveSettings payload structure.

### Pitfall 6: Wildcard (*) in access lists
**What goes wrong:** Access Control section renders `*` in the allowFrom list — must show a prominent warning that all contacts are allowed.
**Why it happens:** `*` is a valid value meaning "open to everyone." The existing JS renders a warning banner when `*` is present.
**How to avoid:** Check for `*` in allowFrom/groupAllowFrom arrays and render a warning Card variant.

## Code Examples

Verified patterns from monitor.ts source:

### Exact StatsResponse Shape (confirmed from monitor.ts lines 4473-4510)
```typescript
interface StatsResponse {
  dmFilter: {
    enabled: boolean
    patterns: string[]
    godModeBypass: boolean
    godModeScope: 'all' | 'dm' | 'off'
    godModeSuperUsers: string[]
    tokenEstimate: number
    stats: { allowed: number; dropped: number; tokensEstimatedSaved: number }
    recentEvents: Array<{ ts: number; pass: boolean; reason: string; preview: string }>
  }
  groupFilter: {
    enabled: boolean
    patterns: string[]
    godModeBypass: boolean
    godModeScope: 'all' | 'dm' | 'off'
    tokenEstimate: number
    stats: { allowed: number; dropped: number; tokensEstimatedSaved: number }
    recentEvents: Array<{ ts: number; pass: boolean; reason: string; preview: string }>
  }
  presence: {
    enabled?: boolean
    wpm?: number
    readDelayMs?: [number, number]
    typingDurationMs?: [number, number]
    pauseChance?: number
    jitter?: [number, number]
    sendSeen?: boolean
    msPerReadChar?: number
    pauseDurationMs?: [number, number]
    pauseIntervalMs?: [number, number]
  }
  access: {
    allowFrom: string[]
    groupAllowFrom: string[]
    allowedGroups: string[]
    dmPolicy: string
    groupPolicy: string
  }
  session: string
  baseUrl: string
  webhookPort: number
  serverTime: string
  sessions: Array<{
    sessionId: string
    name: string
    healthStatus: string
    consecutiveFailures: number
    lastCheck: string | null
  }>
}
```

### Exact SessionsResponse Shape (confirmed from monitor.ts lines 4942-4955)
```typescript
interface EnrichedSession {
  sessionId: string
  name: string
  role: string
  subRole: string
  healthy: boolean | null
  healthStatus: string
  consecutiveFailures: number
  lastCheck: string | null
  wahaStatus: string  // e.g. "WORKING", "STOPPED", "UNKNOWN"
}
type SessionsResponse = EnrichedSession[]
```
Note: `Session` in types.ts currently has `id: string` but API returns `sessionId`. Types.ts needs update.

### Exact Config Payload Structure for POST /api/admin/config (confirmed from monitor.ts lines 2737-2812)
```typescript
interface ConfigPayload {
  waha: {
    baseUrl?: string
    webhookPort?: number
    webhookPath?: string
    triggerWord?: string
    triggerResponseMode?: string
    dmPolicy?: string
    groupPolicy?: string
    allowFrom?: string[]
    groupAllowFrom?: string[]
    allowedGroups?: string[]
    dmFilter?: {
      enabled: boolean
      mentionPatterns: string[]
      godModeBypass: boolean
      godModeScope: string
      godModeSuperUsers: Array<{ identifier: string }>  // NOTE: wrapped in object
      tokenEstimate: number
    }
    groupFilter?: {
      enabled: boolean
      mentionPatterns: string[]
      godModeBypass: boolean
      godModeScope: string
      godModeSuperUsers: Array<{ identifier: string }>  // NOTE: wrapped in object
      tokenEstimate: number
    }
    presence?: {
      enabled: boolean
      sendSeen: boolean
      wpm: number
      readDelayMs: [number, number]
      msPerReadChar: number
      typingDurationMs: [number, number]
      pauseChance: number
      pauseDurationMs: [number, number]
      pauseIntervalMs: [number, number]
      jitter: [number, number]
    }
    markdown?: { enabled: boolean; tables: string }
    canInitiateGlobal?: boolean
    pairingMode?: {
      enabled: boolean
      passcode?: string
      grantTtlMinutes: number
      challengeMessage?: string
    }
    autoReply?: {
      enabled: boolean
      message?: string
      intervalMinutes: number
    }
    actions?: { reactions: boolean }
    blockStreaming?: boolean
    mediaPreprocessing?: {
      enabled: boolean
      audioTranscription: boolean
      imageAnalysis: boolean
      videoAnalysis: boolean
      locationResolution: boolean
      vcardParsing: boolean
      documentAnalysis: boolean
    }
  }
}
// CRITICAL: godModeSuperUsers must be Array<{ identifier: string }> NOT string[]
// The API handler expects objects with .identifier field, not bare strings.
```

### LABEL_MAP (confirmed from monitor.ts lines 1672-1696)
```typescript
const LABEL_MAP: Record<string, string> = {
  wpm: 'Words Per Minute',
  readDelayMs: 'Read Delay (ms)',
  typingDurationMs: 'Typing Duration (ms)',
  pauseChance: 'Pause Chance',
  presenceEnabled: 'Presence Enabled',
  groupFilter: 'Group Filter',
  dmFilter: 'DM Filter',
  allowFrom: 'Allow From',
  groupAllowFrom: 'Group Allow From',
  allowedGroups: 'Allowed Groups',
  godModeSuperUsers: 'God Mode Users',
  dmPolicy: 'DM Policy',
  groupPolicy: 'Group Policy',
  mentionPatterns: 'Mention Patterns',
  keywords: 'Keywords',
  triggerOperator: 'Trigger Operator',
  globalKeywords: 'Global Keywords',
  groupKeywords: 'Group Keywords',
  enabled: 'Enabled',
  jitter: 'Jitter',
  baseUrl: 'Base URL',
  webhookPort: 'Webhook Port',
  serverTime: 'Server Time',
}
export function labelFor(key: string): string {
  return LABEL_MAP[key] ?? key
}
```

### JID Resolution Call (confirmed from api.ts line 88-89)
```typescript
// Returns { resolved: Record<string, string> } where key=jid, value=display name
// Falls back to raw JID if not in directory
const result = await api.resolveNames(['972544329000@c.us', '271862907039996@lid'])
// result.resolved = { '972544329000@c.us': 'Omer Nesher', '271862907039996@lid': 'Omer Nesher' }
```

### Settings: godModeSuperUsers deserialize/serialize
```typescript
// Config GET returns: godModeSuperUsers: [{ identifier: "972544329000@c.us" }]
// UI shows as pills with resolved names
// On save: godModeSuperUsers: [{ identifier: "972544329000@c.us" }]
// NOT: ["972544329000@c.us"]  ← WRONG
const fromConfig = (dm.godModeSuperUsers ?? []).map((u: { identifier: string }) => u.identifier)
const toConfig = jids.map((jid) => ({ identifier: jid }))
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Embedded HTML string in monitor.ts | React component in src/admin/ | Phase 18 (2026-03-18) | No more double-escaped JS; components are testable |
| CLI-installed shadcn components | Manually written Radix wrappers | Phase 19 (2026-03-18) | Must write UI files manually; CLI incompatible with monorepo |
| Per-JID name resolution | Batch resolve via `?jids=` param | Phase 14 | All JIDs resolved in one fetch |
| Blind setTimeout restart reload | Polling overlay until 200 | Phase 12 | No 502 crash page on restart |

**Deprecated/outdated:**
- `dmPolicy: 'pairing'` — no longer supported; auto-migrate to `'allowlist'` on config load (from monitor.ts line 2639)
- `triggerOperator` UI — removed; backend hardcodes OR (from monitor.ts line 2671)

## Open Questions

1. **Session type `id` vs `sessionId` mismatch**
   - What we know: TabHeader.tsx uses `s.id` (line 58) but API returns `sessionId`. Session type has `id: string`.
   - What's unclear: Was `id` intended as an alias? Or is TabHeader.tsx currently broken?
   - Recommendation: Update `Session` type in types.ts to have `sessionId: string` (matching API) and fix TabHeader.tsx reference in the same PR. Low risk — TabHeader session picker is cosmetic.

2. **Presence display fields**
   - What we know: Dashboard currently shows `wpm`, `readDelayMs`, `typingDurationMs`, `pauseChance`, `jitter` (from monitor.ts LABEL_MAP). Stats endpoint returns all presence fields.
   - What's unclear: Should `sendSeen`, `msPerReadChar`, etc. also be shown? Context says "per the requirements" which only names those 5.
   - Recommendation: Show only the 5 labeled fields listed in CONTEXT.md. Others available if needed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts (or package.json scripts.test) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | Dashboard cards render stats | manual-only | N/A — no React test harness | n/a |
| DASH-02 | Health section shows per-session health | manual-only | N/A — visual UI | n/a |
| DASH-03 | Human-readable labels | unit | `npm test -- labelFor` | ❌ Wave 0 |
| DASH-04 | Filter cards collapsible | manual-only | N/A — visual interaction | n/a |
| DASH-05 | JID resolution in Access Control | manual-only | N/A — depends on live API | n/a |
| SETT-01 | Settings form renders and populates | manual-only | N/A — visual UI | n/a |
| SETT-02 | Tag input for JID fields | manual-only | N/A — visual interaction | n/a |
| SETT-03 | Mention patterns tag input | manual-only | N/A — visual interaction | n/a |
| SETT-04 | Contact picker search + close | manual-only | N/A — visual interaction | n/a |
| SETT-05 | Save & Restart overlay polling | unit | `npm test -- saveAndRestart` | ❌ Wave 0 |

Most requirements are visual/interactive and require manual browser testing. Two are unit-testable logic functions.

### Sampling Rate
- **Per task commit:** `npm test` (existing suite must stay green)
- **Per wave merge:** `npm test` + manual browser smoke test of Dashboard and Settings tabs
- **Phase gate:** Full suite green + manual verification of all 10 requirements before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/admin/src/lib/labels.ts` — exports `labelFor()` with unit test coverage (DASH-03)
- [ ] `tests/labels.test.ts` — tests labelFor() maps correctly
- Radix primitives must be installed before any component files can be written

## Sources

### Primary (HIGH confidence)
- `src/monitor.ts` lines 4401-4511 — exact StatsResponse JSON shape confirmed from server-side code
- `src/monitor.ts` lines 4514-4567 — exact ConfigResponse and POST config payload confirmed
- `src/monitor.ts` lines 4914-4963 — exact SessionsResponse shape confirmed
- `src/monitor.ts` lines 1672-1697 — full LABEL_MAP confirmed
- `src/monitor.ts` lines 2600-2825 — full settings load/save flow confirmed
- `src/admin/src/lib/api.ts` — all API methods confirmed live
- `src/admin/src/types.ts` — current type approximations identified for refinement
- `package.json` — installed Radix primitives confirmed (6 missing for this phase)
- `node_modules/@radix-ui/` listing — confirmed which primitives are missing

### Secondary (MEDIUM confidence)
- shadcn/ui docs (https://ui.shadcn.com/docs) — collapsible, switch, select, label, badge, command, popover component patterns follow Radix wrappers

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies cross-checked against package.json and node_modules
- Architecture: HIGH — patterns confirmed from working Phase 19 code (TabHeader, AppSidebar)
- API shapes: HIGH — read directly from monitor.ts server-side route handlers
- Config payload: HIGH — read directly from saveSettings() JS function in monitor.ts
- Pitfalls: HIGH — derived from existing DO NOT CHANGE comments and type mismatch observation

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable — no API changes planned until Phase 24 cleanup)
