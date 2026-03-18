# Phase 19: App Layout - Research

**Researched:** 2026-03-18
**Domain:** shadcn/ui Sidebar layout, theme toggle, mobile responsiveness, React state-based routing
**Confidence:** HIGH

## Summary

Phase 19 builds the navigation shell that all downstream phases (20-22) depend on. The scaffold from Phase 18 is a blank React app — this phase replaces it with a full admin layout: left Sidebar with 7 tabs, dark/light theme toggle, mobile-responsive drawer, and a per-tab header with session selector.

The tech stack is locked: shadcn/ui Sidebar + Sheet (for mobile), lucide-react icons, Tailwind v4 CSS variables for theming, React useState for routing. No react-router is needed. The shadcn/ui Sidebar component handles both desktop (collapsible) and mobile (Sheet/drawer) behaviors natively via its `isMobile` state from `useSidebar()` hook — no manual breakpoint wiring required.

The theme system is a 3-line interaction: on toggle, flip the `.dark` class on `<html>`, write the choice to `localStorage`, and read it back on mount. Tailwind v4 requires `@custom-variant dark (&:where(.dark, .dark *))` in `index.css` (not a darkMode config property). The index.css already has `.dark {}` variable overrides from Phase 18, so only the `@custom-variant` directive is missing.

**Primary recommendation:** Install `sidebar`, `sheet`, `button`, `dropdown-menu`, and `separator` via `npx shadcn@latest add`, then wire `SidebarProvider` at the App root with `SidebarInset` for the content area. The sidebar component's built-in `isMobile` flag from `useSidebar()` eliminates the need for a custom 768px media query listener.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use shadcn/ui Sidebar component for left-side navigation
- 7 tabs in order: Dashboard, Settings, Directory, Sessions, Modules, Log, Queue
- Use lucide-react icons for each tab (LayoutDashboard, Settings, BookUser, MonitorSmartphone, Puzzle, FileText, ListOrdered)
- Active tab highlighted with accent color
- React state-based routing (useState for active tab) — no need for react-router since it's a single-page admin panel
- Dark/light toggle using shadcn/ui built-in `class` strategy (add/remove `dark` class on `<html>`)
- Persist choice to localStorage key `waha-admin-theme`
- Default to dark (matches current admin panel default)
- Theme toggle button in sidebar footer or header
- Below 768px: sidebar hidden, accessible via hamburger button that opens a Sheet (shadcn/ui Sheet component)
- Sheet closes on tab selection
- Content area takes full width on mobile
- Consistent header bar at top of each tab's content area: tab title (h1), session selector dropdown (if applicable), refresh button
- Session selector populated from `/api/admin/sessions` API
- Refresh button triggers tab-specific data reload

### Claude's Discretion
- Exact spacing, padding, color values beyond shadcn/ui defaults
- Animation/transition details
- Exact icon choices (suggestions above are guidance, not locked)

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LYOT-01 | Navigation shell with all 7 tabs reachable | shadcn/ui SidebarMenu + SidebarMenuItem pattern; active tab via `isActive` prop on SidebarMenuButton |
| LYOT-02 | Dark/light theme toggle, persisted to localStorage | Tailwind v4 `@custom-variant dark` + `document.documentElement.classList.toggle('dark')` + localStorage read/write |
| LYOT-03 | Mobile-responsive sidebar (collapses to Sheet/drawer under 768px) | shadcn/ui Sidebar `collapsible="offcanvas"` + built-in `isMobile` from `useSidebar()` — no custom breakpoint logic needed |
| LYOT-04 | Consistent per-tab header (title, session selector, refresh button) | Shared `<TabHeader>` component using `api.getSessions()` + shadcn/ui DropdownMenu for session selector + Button for refresh |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| shadcn/ui (sidebar) | latest CLI | Navigation shell with desktop+mobile behavior | Handles both collapsible and Sheet/drawer in one component |
| shadcn/ui (sheet) | latest CLI | Mobile sidebar drawer | Already bundled with sidebar install, used for mobile override |
| shadcn/ui (button) | latest CLI | Theme toggle, refresh button, hamburger | Consistent variant system (ghost, outline, default) |
| shadcn/ui (dropdown-menu) | latest CLI | Session selector in tab header | Keyboard-accessible, Radix primitive |
| shadcn/ui (separator) | latest CLI | Visual dividers in sidebar | Thin horizontal/vertical rules |
| lucide-react | ^0.577.0 (already installed) | Tab icons, theme toggle icon, hamburger | Tree-shakeable, already in package.json |
| react | ^19.2.4 (already installed) | UI framework | Already in project |
| tailwindcss | ^4.2.1 (already installed) | Responsive utilities, dark mode | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `useSidebar()` hook | (from sidebar component) | isMobile detection, open/close state | Replaces custom matchMedia/resize listener |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| shadcn/ui Sidebar | Custom CSS sidebar | Sidebar component handles mobile Sheet variant automatically; custom requires duplicate code |
| useState routing | react-router | react-router is overkill for a single-page admin panel with 7 in-memory tabs |
| lucide-react | heroicons, phosphor | lucide is already installed; no reason to add another icon library |

**Installation (only new components needed — react/tailwind/lucide already installed):**
```bash
cd D:/docker/waha-oc-plugin
npx shadcn@latest add sidebar sheet button dropdown-menu separator
```

Run from the project root (not src/admin/) — shadcn CLI reads `components.json` from the root and installs into `src/admin/src/components/ui/`.

---

## Architecture Patterns

### Recommended Project Structure
```
src/admin/src/
├── components/
│   ├── ui/                  # shadcn/ui components (sidebar, sheet, button, dropdown-menu, separator)
│   ├── AppSidebar.tsx        # Left navigation: logo, SidebarMenu with 7 tabs, footer (theme toggle)
│   ├── TabHeader.tsx         # Shared header bar: tab title, session selector dropdown, refresh button
│   └── tabs/
│       ├── DashboardTab.tsx  # Placeholder — real content in Phase 20
│       ├── SettingsTab.tsx   # Placeholder — real content in Phase 20
│       ├── DirectoryTab.tsx  # Placeholder — real content in Phase 21
│       ├── SessionsTab.tsx   # Placeholder — real content in Phase 22
│       ├── ModulesTab.tsx    # Placeholder — real content in Phase 22
│       ├── LogTab.tsx        # Placeholder — real content in Phase 22
│       └── QueueTab.tsx      # Placeholder — real content in Phase 22
├── hooks/
│   └── useTheme.ts          # localStorage read/write + classList toggle
├── lib/
│   ├── api.ts               # Already exists from Phase 18
│   └── utils.ts             # Already exists (cn helper)
├── App.tsx                  # SidebarProvider + AppSidebar + SidebarInset + active tab state
├── index.css                # Add @custom-variant dark line
├── main.tsx                 # Already exists
└── types.ts                 # Already exists
```

### Pattern 1: SidebarProvider Root Layout
**What:** SidebarProvider wraps the entire app; AppSidebar renders nav; SidebarInset renders content
**When to use:** Required — SidebarProvider supplies the context that `useSidebar()` reads

```typescript
// Source: https://ui.shadcn.com/docs/components/sidebar
// App.tsx
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/AppSidebar'
import { TabHeader } from '@/components/TabHeader'
import { useState } from 'react'

type TabId = 'dashboard' | 'settings' | 'directory' | 'sessions' | 'modules' | 'log' | 'queue'

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')

  return (
    <SidebarProvider>
      <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <SidebarInset>
        <TabHeader activeTab={activeTab} />
        <main className="flex-1 overflow-auto p-4">
          {/* Render active tab component */}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

### Pattern 2: AppSidebar Component
**What:** Left sidebar with 7 nav items, footer with theme toggle
**When to use:** Rendered once at app root inside SidebarProvider

```typescript
// Source: https://ui.shadcn.com/docs/components/sidebar
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem
} from '@/components/ui/sidebar'
import { LayoutDashboard, Settings, BookUser, MonitorSmartphone,
         Puzzle, FileText, ListOrdered } from 'lucide-react'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'settings',  label: 'Settings',  icon: Settings },
  { id: 'directory', label: 'Directory', icon: BookUser },
  { id: 'sessions',  label: 'Sessions',  icon: MonitorSmartphone },
  { id: 'modules',   label: 'Modules',   icon: Puzzle },
  { id: 'log',       label: 'Log',       icon: FileText },
  { id: 'queue',     label: 'Queue',     icon: ListOrdered },
] as const

export function AppSidebar({ activeTab, onTabChange }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* Logo / app name */}
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {NAV_ITEMS.map(item => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                isActive={activeTab === item.id}
                onClick={() => onTabChange(item.id)}
                tooltip={item.label}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        {/* Theme toggle button */}
      </SidebarFooter>
    </Sidebar>
  )
}
```

### Pattern 3: Theme Toggle Hook
**What:** Reads localStorage on mount, toggles `.dark` on `<html>`, persists to localStorage
**When to use:** Called from App.tsx or theme toggle button

```typescript
// hooks/useTheme.ts
import { useState, useEffect } from 'react'

const STORAGE_KEY = 'waha-admin-theme'

export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    // Default to dark per locked decision
    return (localStorage.getItem(STORAGE_KEY) as 'dark' | 'light') ?? 'dark'
  })

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  return { theme, toggle }
}
```

### Pattern 4: Mobile Behavior via useSidebar
**What:** shadcn/ui Sidebar automatically detects mobile and renders as a Sheet/drawer
**When to use:** Built-in — no extra code needed if `collapsible="offcanvas"` is set

```typescript
// Source: https://ui.shadcn.com/docs/components/sidebar
// The Sidebar component manages mobile internally.
// SidebarTrigger renders the hamburger button — place it in the header:
import { SidebarTrigger } from '@/components/ui/sidebar'

// In TabHeader.tsx:
export function TabHeader({ activeTab }) {
  return (
    <header className="flex items-center gap-2 border-b px-4 py-3">
      <SidebarTrigger className="md:hidden" />   {/* hamburger — mobile only */}
      <h1 className="text-lg font-semibold">{TAB_TITLES[activeTab]}</h1>
      {/* Session selector + refresh button */}
    </header>
  )
}
```

Note: The sidebar component's built-in `isMobile` from `useSidebar()` uses a breakpoint of 768px internally, matching the locked decision exactly.

### Pattern 5: Tailwind v4 Dark Mode Setup
**What:** Add `@custom-variant dark` to index.css so `dark:` utility classes work with class strategy
**When to use:** Required once — the `.dark {}` variable block in index.css already exists; only the variant registration is missing

```css
/* src/admin/src/index.css — add this line AFTER @import "tailwindcss" */
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

/* rest of file unchanged */
```

### Pattern 6: Session Selector in TabHeader
**What:** Dropdown populated from `api.getSessions()`, drives which session is "active" in tabs
**When to use:** Header of each tab

```typescript
// TabHeader.tsx — session selector with api.getSessions()
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Session } from '@/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger }
  from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { RefreshCw, ChevronDown } from 'lucide-react'

export function TabHeader({ activeTab, onRefresh }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<string>('all')

  useEffect(() => {
    api.getSessions().then(setSessions).catch(() => {})
  }, [])

  return (
    <header className="flex items-center gap-2 px-4 py-3 border-b">
      <SidebarTrigger />
      <h1 className="flex-1 text-lg font-semibold">{TAB_TITLES[activeTab]}</h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {selectedSession === 'all' ? 'All sessions' : selectedSession}
            <ChevronDown className="ml-1 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => setSelectedSession('all')}>All sessions</DropdownMenuItem>
          {sessions.map(s => (
            <DropdownMenuItem key={s.id} onClick={() => setSelectedSession(s.id)}>
              {s.name ?? s.id}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh">
        <RefreshCw className="h-4 w-4" />
      </Button>
    </header>
  )
}
```

### Anti-Patterns to Avoid

- **Nesting SidebarProvider inside SidebarProvider:** Only one provider at the app root. Causes `useSidebar()` to throw "useSidebar must be used within a SidebarProvider".
- **Manual mobile detection with window.matchMedia:** The `useSidebar()` hook exposes `isMobile` — use it. Custom listeners create race conditions on resize.
- **Adding `dark` class to `<body>` instead of `<html>`:** Tailwind v4 `@custom-variant dark (&:where(.dark, .dark *))` traverses ancestors. Must be on `<html>` for CSS variables defined on `:root` / `.dark` to work.
- **Reading localStorage synchronously in useEffect without initializer:** Causes a flash of wrong theme on mount. Use the `useState` initializer function (runs before first render, synchronous) as shown in Pattern 3.
- **Forgetting `@custom-variant dark` in index.css:** The `.dark {}` block already exists, but without the `@custom-variant` directive, Tailwind v4 `dark:` utility classes will NOT apply.
- **Using `collapsible="none"` on Sidebar:** Disables all collapse behavior. Mobile Sheet won't work. Use `collapsible="offcanvas"` (hides sidebar) or `collapsible="icon"` (collapses to icons).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mobile sidebar drawer | Custom Sheet with CSS transitions | shadcn/ui Sidebar with `collapsible="offcanvas"` | Already handles focus trap, backdrop, close-on-escape, animation |
| Breakpoint detection | `window.matchMedia('(max-width: 768px)')` listener | `isMobile` from `useSidebar()` | Same 768px breakpoint, no listener management |
| Theme persistence | Custom theme context + localStorage + class toggle | `useTheme` hook (3-line pattern above) | Straightforward — but don't rebuild what's 5 lines |
| Session dropdown | `<select>` element | shadcn/ui DropdownMenu + Button | Consistent with panel style, keyboard accessible |
| Active nav highlight | Custom CSS class toggling | `isActive` prop on `SidebarMenuButton` | Built into the component, applies accent color from CSS vars |

**Key insight:** The shadcn/ui Sidebar component handles the "mobile becomes a Sheet drawer" behavior internally — there is no separate mobile implementation to build.

---

## Common Pitfalls

### Pitfall 1: Theme Flash on Load
**What goes wrong:** Page renders in light mode for a frame before `useEffect` applies `.dark` class.
**Why it happens:** `useEffect` runs after paint. If theme initialization is in `useEffect`, the first paint is always theme-unaware.
**How to avoid:** Use the `useState` initializer (synchronous, before first render) to set the initial theme, and call `document.documentElement.classList.add('dark')` directly in a script tag in `index.html`, OR use the initializer pattern shown in Pattern 3 which runs sync.
**Warning signs:** Visible white flash on page load in dark-default mode.

Better approach — add to `index.html` `<head>` before React loads:
```html
<script>
  var t = localStorage.getItem('waha-admin-theme') ?? 'dark';
  document.documentElement.classList.toggle('dark', t === 'dark');
</script>
```

### Pitfall 2: shadcn/ui Components Not in components.json
**What goes wrong:** `npx shadcn@latest add sidebar` adds sidebar to `components.json` but later components (sheet, button) may conflict if `components.json` path resolution is wrong.
**Why it happens:** `components.json` was initialized pointing to `src/admin/src/` — must ensure CWD for shadcn CLI is project root so it reads the right config.
**How to avoid:** Always run `npx shadcn@latest add` from `D:/docker/waha-oc-plugin/` (project root), not from `src/admin/`.
**Warning signs:** Components installed to wrong directory, or CLI asks to re-initialize.

### Pitfall 3: Tailwind v4 vs v3 Dark Mode Config
**What goes wrong:** Developer adds `darkMode: 'class'` to a Tailwind config file — this is Tailwind v3 syntax and does nothing in v4.
**Why it happens:** Tailwind v4 moved dark mode configuration from JS config to CSS using `@custom-variant`.
**How to avoid:** Add `@custom-variant dark (&:where(.dark, .dark *))` to `index.css` only. No `tailwind.config.js` change needed (there may not even be one in a Tailwind v4 project).
**Warning signs:** `dark:` classes in TSX have no effect despite `.dark` being on `<html>`.

### Pitfall 4: SidebarMenuButton onClick vs navigation
**What goes wrong:** Using `<SidebarMenuButton asChild><a href="#tab">` for tab navigation causes page reload or broken state in the SPA.
**Why it happens:** `asChild` renders an anchor; clicking navigates instead of calling the React state setter.
**How to avoid:** Use `onClick` on `SidebarMenuButton` (not `asChild`) to call the `setActiveTab` state setter. No `href` needed.
**Warning signs:** URL changes on tab click, or page reloads.

### Pitfall 5: Session Selector State Scope
**What goes wrong:** Session selector state lives in `TabHeader`, but tabs need to know the selected session to filter their data.
**Why it happens:** State was declared locally in the header component.
**How to avoid:** Lift `selectedSession` state to `App.tsx` and pass it as a prop to both `TabHeader` and the active tab component. This is used in Phases 20-22 — establish the prop drilling now.
**Warning signs:** Tab components can't access `selectedSession`.

---

## Code Examples

Verified patterns from official sources:

### SidebarProvider + SidebarInset Layout
```typescript
// Source: https://ui.shadcn.com/docs/components/sidebar
<SidebarProvider>
  <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
  <SidebarInset>
    <TabHeader activeTab={activeTab} selectedSession={selectedSession}
               onSessionChange={setSelectedSession} onRefresh={handleRefresh} />
    <main className="flex-1 overflow-auto p-4">
      {renderActiveTab()}
    </main>
  </SidebarInset>
</SidebarProvider>
```

### Sidebar with Collapsible Icons
```typescript
// Source: https://ui.shadcn.com/docs/components/sidebar
<Sidebar collapsible="icon">
  <SidebarContent>
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton isActive={activeTab === 'dashboard'} tooltip="Dashboard"
                           onClick={() => onTabChange('dashboard')}>
          <LayoutDashboard />
          <span>Dashboard</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarContent>
</Sidebar>
```

### useSidebar Hook for Mobile Close
```typescript
// Source: https://ui.shadcn.com/docs/components/sidebar
// Close sidebar when tab selected on mobile:
import { useSidebar } from '@/components/ui/sidebar'

function NavItem({ id, label, icon: Icon, activeTab, onTabChange }) {
  const { isMobile, setOpenMobile } = useSidebar()

  const handleClick = () => {
    onTabChange(id)
    if (isMobile) setOpenMobile(false)  // Close Sheet on mobile tab select
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={activeTab === id} onClick={handleClick} tooltip={label}>
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
```

### Theme Toggle Anti-Flash Script (index.html)
```html
<!-- src/admin/index.html — add to <head> before React script -->
<script>
  (function() {
    var theme = localStorage.getItem('waha-admin-theme') ?? 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
  })();
</script>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `darkMode: 'class'` in tailwind.config.js | `@custom-variant dark` in CSS | Tailwind v4 (2024-2025) | No JS config needed, but must add the CSS directive |
| Custom media query listener for mobile | `isMobile` from `useSidebar()` hook | shadcn/ui sidebar component | Removes custom breakpoint code |
| Separate mobile/desktop sidebar implementations | Single `<Sidebar collapsible="offcanvas">` | shadcn/ui sidebar (2024) | One component handles both; Sheet behavior built in |

**Deprecated/outdated:**
- `tailwind.config.js` `darkMode: 'class'` option: Tailwind v4 ignores this. Use `@custom-variant dark` in CSS.
- Custom `useMediaQuery` hook for 768px: Redundant when using shadcn/ui Sidebar — `useSidebar().isMobile` already does this at the same breakpoint.

---

## Open Questions

1. **components.json location**
   - What we know: Phase 18 ran `npx shadcn@latest init` — a `components.json` should exist at project root
   - What's unclear: Exact path of `components.json` and whether it points to `src/admin/src/components/ui/` correctly
   - Recommendation: Planner task should verify `components.json` exists and has correct `componentDir` path before running `add` commands

2. **Refresh button scope**
   - What we know: CONTEXT.md says refresh button triggers "tab-specific data reload"
   - What's unclear: Phases 20-22 implement real tab content — do tabs register their own refresh handler, or does App.tsx manage a `refreshKey` counter?
   - Recommendation: Use a `refreshKey: number` state in App.tsx, increment on refresh click, pass to each tab as a prop. Tabs use it as a `useEffect` dependency. This is a simple pattern that needs no shared state library.

3. **Session selector scope**
   - What we know: Sessions come from `api.getSessions()` in TabHeader
   - What's unclear: Not all tabs need a session selector (e.g., Directory may not filter by session)
   - Recommendation: Pass `selectedSession` from App.tsx to all tabs; tabs that don't need it simply ignore it. Keep selector visible everywhere for consistency — hide with `className="hidden"` on tabs that don't use it if needed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vite.admin.config.ts (vitest config likely absent — Wave 0 gap) |
| Quick run command | `npm test` (runs `vitest run --reporter=verbose`) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LYOT-01 | 7 tabs render and are clickable | unit (render) | `npm test -- --grep "navigation"` | ❌ Wave 0 |
| LYOT-02 | Theme toggles `.dark` class on html, persists to localStorage | unit | `npm test -- --grep "theme"` | ❌ Wave 0 |
| LYOT-03 | Mobile: sidebar hidden, SidebarTrigger present | unit (mock isMobile) | `npm test -- --grep "mobile"` | ❌ Wave 0 |
| LYOT-04 | TabHeader renders title, session dropdown, refresh button | unit (render) | `npm test -- --grep "TabHeader"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` (vitest run)
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/admin/src/components/__tests__/AppSidebar.test.tsx` — covers LYOT-01
- [ ] `src/admin/src/components/__tests__/TabHeader.test.tsx` — covers LYOT-04
- [ ] `src/admin/src/hooks/__tests__/useTheme.test.ts` — covers LYOT-02
- [ ] `src/admin/src/components/__tests__/App.layout.test.tsx` — covers LYOT-03 (mock `useSidebar` to return `isMobile: true`)
- [ ] vitest config in `vite.admin.config.ts` or a separate `vitest.config.ts` — required to resolve `@/` aliases in tests
- [ ] `@testing-library/react` and `@testing-library/user-event` install: `npm install -D @testing-library/react @testing-library/user-event jsdom`

---

## Sources

### Primary (HIGH confidence)
- https://ui.shadcn.com/docs/components/sidebar — Sidebar component API, SidebarProvider, useSidebar hook, collapsible modes, SidebarInset
- https://ui.shadcn.com/docs/components/sheet — Sheet component, side prop
- https://tailwindcss.com/docs/dark-mode — Tailwind v4 `@custom-variant dark` syntax
- `D:/docker/waha-oc-plugin/src/admin/src/index.css` — confirmed `.dark {}` CSS variable block already present
- `D:/docker/waha-oc-plugin/src/admin/src/lib/api.ts` — confirmed `api.getSessions()` exists

### Secondary (MEDIUM confidence)
- `.planning/research/ui-framework-research.md` — confirmed shadcn/ui Sidebar in component mapping table
- `D:/docker/waha-oc-plugin/package.json` — confirmed lucide-react@^0.577.0 and tailwindcss@^4.2.1 already installed

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already in package.json or are shadcn/ui components with documented install commands
- Architecture: HIGH — shadcn/ui Sidebar documentation provides the exact component structure
- Pitfalls: HIGH — Tailwind v4 dark mode change and theme flash are known, documented issues

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (shadcn/ui and Tailwind v4 are stable; 30 day window)
