---
phase: 63-dashboard-auth
plan: "03"
subsystem: admin-ui
tags: [integration-wizard, mcp, rest-api, skill-md, auth-phase]
dependency_graph:
  requires: [63-02]
  provides: [AUTH-06]
  affects: [src/admin/src/components/tabs/IntegrationWizardTab.tsx, src/admin/src/components/AppSidebar.tsx, src/admin/src/App.tsx]
tech_stack:
  added: []
  patterns: [shadcn-tabs, copy-to-clipboard, lazy-import, authClient.apiKey.list]
key_files:
  created:
    - src/admin/src/components/tabs/IntegrationWizardTab.tsx
  modified:
    - src/admin/src/components/AppSidebar.tsx
    - src/admin/src/App.tsx
decisions:
  - "window.location.origin used for server URL pre-fill — works in both dev (via Vite proxy) and production"
  - "authClient.apiKey.list() fetches first key for masked display; masked display is ctl_...???? not the real key"
  - "Send Test Message uses session cookie auth (admin panel is already authenticated) instead of Authorization header"
  - "SKILL.md download opens /SKILL.md in new tab (window.open) rather than fetch+blob to avoid CORS issues"
metrics:
  duration: "~4m"
  completed: "2026-03-28"
  tasks: 1
  files: 3
---

# Phase 63 Plan 03: Integration Wizard Tab Summary

**One-liner:** Integration wizard with MCP config JSON, REST curl snippets, and SKILL.md download — all pre-filled with `window.location.origin` and masked API key, with copy-to-clipboard on every code block.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Integration wizard tab with MCP/REST/SKILL.md options | b237c38 | IntegrationWizardTab.tsx (created), AppSidebar.tsx, App.tsx |

## What Was Built

**`IntegrationWizardTab.tsx`** — three-tab shadcn UI:
- **MCP tab**: JSON config block for Claude Code / MCP clients with `mcpServers.chatlytics` entry, pre-filled server URL and masked key
- **REST tab**: Two curl examples (send message, search contacts) + "Send Test Message" button that calls `POST /api/v1/send` via session cookie auth
- **SKILL.md tab**: Description of SKILL.md contents + download button opening `/SKILL.md` in new tab

**`AppSidebar.tsx`** changes:
- `'integration'` added to `TabId` union type
- Nav item added after API Keys: `{ id: 'integration', label: 'Integration', icon: Plug }`

**`App.tsx`** changes:
- `IntegrationWizardTab` lazy-imported
- Rendering case `'integration'` added to `renderActiveTab()` switch

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All functionality is fully wired:
- API key fetch uses real `authClient.apiKey.list()`
- Server URL uses real `window.location.origin`
- Send test message calls real `/api/v1/send`
- SKILL.md download opens real `/SKILL.md`

## Self-Check: PASSED
