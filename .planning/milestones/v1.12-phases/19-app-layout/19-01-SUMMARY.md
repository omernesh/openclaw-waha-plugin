---
phase: 19-app-layout
plan: "01"
subsystem: admin-ui
tags: [shadcn, ui-components, theme, tailwind, react]
dependency_graph:
  requires: [18-react-scaffold]
  provides: [shadcn-ui-components, useTheme-hook, tab-placeholders, tailwind-dark-mode]
  affects: [19-02-app-layout-wiring, 20-dashboard-settings, 21-directory, 22-sessions-modules-log-queue]
tech_stack:
  added:
    - "@radix-ui/react-dialog (sheet)"
    - "@radix-ui/react-dropdown-menu"
    - "@radix-ui/react-separator"
    - "@radix-ui/react-slot (button)"
    - "@radix-ui/react-tooltip"
  patterns:
    - "shadcn/ui component authoring (manual write, Radix primitive wrappers)"
    - "Tailwind v4 @custom-variant dark directive"
    - "Anti-flash localStorage theme script in index.html"
key_files:
  created:
    - components.json
    - tsconfig.json
    - src/admin/src/components/ui/button.tsx
    - src/admin/src/components/ui/separator.tsx
    - src/admin/src/components/ui/sheet.tsx
    - src/admin/src/components/ui/dropdown-menu.tsx
    - src/admin/src/components/ui/sidebar.tsx
    - src/admin/src/hooks/useTheme.ts
    - src/admin/src/components/tabs/DashboardTab.tsx
    - src/admin/src/components/tabs/SettingsTab.tsx
    - src/admin/src/components/tabs/DirectoryTab.tsx
    - src/admin/src/components/tabs/SessionsTab.tsx
    - src/admin/src/components/tabs/ModulesTab.tsx
    - src/admin/src/components/tabs/LogTab.tsx
    - src/admin/src/components/tabs/QueueTab.tsx
  modified:
    - src/admin/src/index.css (added @custom-variant dark)
    - src/admin/index.html (added anti-flash script)
    - package.json (added @radix-ui peer dependencies)
    - package-lock.json
decisions:
  - "Manually wrote shadcn components instead of using npx shadcn CLI (CLI fails without package.json in admin subdir; no --legacy-peer-deps support)"
  - "Created root tsconfig.json shim to satisfy shadcn CLI requirements for future use"
  - "Used --legacy-peer-deps for @radix-ui installs (vite@8 vs @tailwindcss/vite peer conflict, same as Phase 18)"
metrics:
  duration: "~10 minutes"
  completed: "2026-03-18"
  tasks_completed: 2
  files_created: 15
  files_modified: 4
---

# Phase 19 Plan 01: shadcn/ui Components, Theme System, Tab Placeholders Summary

**One-liner:** shadcn/ui sidebar/sheet/button/dropdown-menu/separator installed manually + useTheme dark-default hook + 7 tab placeholder components with prop contracts for downstream phases.

## What Was Built

### Task 1: shadcn/ui Components + Tailwind Dark Mode

Installed 5 shadcn/ui components and configured Tailwind v4 dark mode:

- **components.json** — shadcn config pointing to `src/admin/src/components/ui/` and `src/admin/src/lib/utils.ts`
- **button.tsx** — full CVA-based button with variants (default/destructive/outline/secondary/ghost/link) and sizes
- **separator.tsx** — Radix separator primitive wrapper
- **sheet.tsx** — modal side panel (used by Sidebar on mobile) with slide animations and all sub-components
- **dropdown-menu.tsx** — full Radix dropdown with check/radio items, labels, separators
- **sidebar.tsx** — complete shadcn Sidebar with Provider, mobile Sheet fallback, collapsible icon mode, all sub-components
- **index.css** — added `@custom-variant dark (&:where(.dark, .dark *))` after `@import "tailwindcss"`
- **index.html** — anti-flash script reads `waha-admin-theme` from localStorage and applies `.dark` class before React loads

### Task 2: useTheme Hook + 7 Tab Placeholders

- **useTheme.ts** — reads localStorage key `waha-admin-theme` synchronously in useState initializer (avoids first-render flash), defaults to `'dark'`, useEffect applies `.dark`/`.light` to `document.documentElement`, persists to localStorage on change
- **7 tab placeholder components** — all accept `selectedSession: string` and `refreshKey: number` props establishing the prop contract for downstream phases

| Tab | File | Phase |
|-----|------|-------|
| Dashboard | DashboardTab.tsx | 20 |
| Settings | SettingsTab.tsx | 20 |
| Directory | DirectoryTab.tsx | 21 |
| Sessions | SessionsTab.tsx | 22 |
| Modules | ModulesTab.tsx | 22 |
| Log | LogTab.tsx | 22 |
| Queue | QueueTab.tsx | 22 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] shadcn CLI cannot run in subdir without package.json**
- **Found during:** Task 1
- **Issue:** `npx shadcn@latest add` fails because `src/admin/` has no package.json; running from project root fails with "Failed to load tsconfig.json"
- **Fix:** Created root `tsconfig.json` shim (project references structure), then manually wrote all 5 component files from first principles instead of using the CLI
- **Files modified:** tsconfig.json (new), all 5 component files written manually
- **Commit:** 5df0647

**2. [Rule 3 - Blocking] @radix-ui npm install peer conflict**
- **Found during:** Task 1 (discovered when shadcn CLI attempted `npm install` internally)
- **Issue:** Same vite@8 vs @tailwindcss/vite peer conflict as Phase 18 — shadcn CLI has no --legacy-peer-deps flag
- **Fix:** Ran `npm install --legacy-peer-deps @radix-ui/react-dialog @radix-ui/react-slot @radix-ui/react-dropdown-menu @radix-ui/react-separator @radix-ui/react-tooltip` separately
- **Files modified:** package.json, package-lock.json
- **Commit:** 5df0647

## Build Verification

```
✓ built in 279ms
dist/admin/index.html                   0.64 kB │ gzip:  0.41 kB
dist/admin/assets/index-CYjKTzIV.css   32.62 kB │ gzip:  6.33 kB
dist/admin/assets/index-HL6Q88QN.js   190.72 kB │ gzip: 60.10 kB
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 5df0647 | feat(19-01): install shadcn/ui components and fix Tailwind v4 dark mode |
| 2 | ad96fef | feat(19-01): create useTheme hook and 7 tab placeholder components |

## Self-Check: PASSED
