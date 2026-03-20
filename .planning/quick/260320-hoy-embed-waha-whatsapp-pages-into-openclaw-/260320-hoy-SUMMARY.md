---
phase: quick
plan: 01
subsystem: mission-control-ui
tags: [whatsapp, react, routing, api-client, proxy]
dependency_graph:
  requires: []
  provides: [whatsapp-native-pages]
  affects: [openclaw-mission-control]
tech_stack:
  added: [waha-api.ts]
  patterns: [lazy-suspense, useApi, useAutoRefresh, hash-routing, server-proxy]
key_files:
  created:
    - D:/docker/openclaw/src/lib/waha-api.ts
    - D:/docker/openclaw/src/components/whatsapp/whatsapp-nav.tsx
    - D:/docker/openclaw/src/pages/whatsapp/index.tsx
    - D:/docker/openclaw/src/pages/whatsapp/overview.tsx
    - D:/docker/openclaw/src/pages/whatsapp/chats.tsx
    - D:/docker/openclaw/src/pages/whatsapp/contacts.tsx
    - D:/docker/openclaw/src/pages/whatsapp/groups.tsx
    - D:/docker/openclaw/src/pages/whatsapp/session.tsx
    - D:/docker/openclaw/src/pages/whatsapp/config.tsx
  modified:
    - D:/docker/openclaw/server/server.js
    - D:/docker/openclaw/src/App.tsx
    - D:/docker/openclaw/src/hooks/use-hash-route.ts
  deleted:
    - D:/docker/openclaw/src/pages/whatsapp.tsx
decisions:
  - "Followed Claudios pattern exactly: lazy imports, Suspense, hash routing, useApi/useAutoRefresh"
  - "WhatsApp sub-nav uses green-500 active color (vs blue-500 for Claudios) to distinguish the section"
  - "WAHA proxy placed before auth gate (same as /api/admin/* proxy) — no MC session required"
  - "Default session hardcoded to 3cf11776_logan in chats.tsx with override from sessions API"
  - "Chats page reverses message order for chronological display (oldest at top)"
  - "Contacts page uses inline useDebounce hook (no external dep)"
  - "Config page displays known sections (groupFilter, dmFilter, keywords, sessions) then remaining keys"
metrics:
  duration: "~20 minutes"
  completed_date: "2026-03-20"
  tasks_completed: 2
  files_created: 9
  files_modified: 3
  files_deleted: 1
---

# Quick Task 260320-hoy: Embed WAHA WhatsApp Pages into OpenClaw

**One-liner:** Replaced WhatsApp iframe in Mission Control with 6 native React sub-pages (Overview, Chats, Contacts, Groups, Session, Config) following the Claudios tab pattern, with typed WAHA API client and direct WAHA proxy.

## What Was Built

### Task 1: Infrastructure
- **server/server.js**: Added `/waha-api/*` proxy block before auth gate — strips prefix, forwards to `http://127.0.0.1:3004` with WAHA API key header `X-Api-Key`
- **src/lib/waha-api.ts**: Typed API client with two base paths: `/api/admin/*` (plugin admin, port 8050) and `/waha-api/*` (direct WAHA, port 3004). Exports `wahaApi` object with all typed methods and TypeScript interfaces
- **src/components/whatsapp/whatsapp-nav.tsx**: Sub-nav following claudios-nav.tsx pattern exactly — 6 tabs, hash-based active state, green-500 active border
- **src/pages/whatsapp/index.tsx**: Router with lazy imports for 6 views, Suspense fallback, same if/else pattern as claudios/index.tsx
- **src/hooks/use-hash-route.ts**: Added `WhatsAppSubRoute` type union for all 6 sub-routes
- **src/App.tsx**: Added `if (route.startsWith('/whatsapp')) return <WhatsAppPage />` before switch (same pattern as Claudios)
- Deleted old `src/pages/whatsapp.tsx` iframe page

### Task 2: Sub-Pages
- **overview.tsx**: 4-card layout (Session Status, Plugin Health, Message Stats, Inbound Queue) with auto-refresh every 5s, multi-session list if >1 session
- **chats.tsx**: Split-pane layout — left chat list with search + unread badge, right message bubbles (sent=blue right, received=gray left) with author name for groups
- **contacts.tsx**: Paginated table (50/page) with debounced search, expandable rows showing `directoryEntry()` detail, DM status badges
- **groups.tsx**: 2-col card grid with search, lazy-loaded participant list on click via `groupParticipants()`, admin badges
- **session.tsx**: Session status card per session, restart gateway button, recovery history timeline, auto-refresh every 10s
- **config.tsx**: Sectioned display of plugin config (groupFilter, dmFilter, keywords, sessions, remaining keys), collapsible raw JSON viewer

## Build Status

TypeScript: clean (0 errors)
Build: succeeded (8.55s)
Commit: `3efe9ec` — feat(whatsapp-embed): replace iframe with native React WhatsApp pages

## Deviations from Plan

None - plan executed exactly as written. Auto-fixed 3 TypeScript build errors:
- `ChatItem` imported but unused (removed)
- `sessions[0]` array access without null guard (added optional chaining)
- `Card` imported but unused in contacts.tsx (removed)

## Self-Check: PASSED

Files exist:
- D:/docker/openclaw/src/lib/waha-api.ts — FOUND
- D:/docker/openclaw/src/components/whatsapp/whatsapp-nav.tsx — FOUND
- D:/docker/openclaw/src/pages/whatsapp/index.tsx — FOUND
- D:/docker/openclaw/src/pages/whatsapp/overview.tsx — FOUND
- D:/docker/openclaw/src/pages/whatsapp/chats.tsx — FOUND
- D:/docker/openclaw/src/pages/whatsapp/contacts.tsx — FOUND
- D:/docker/openclaw/src/pages/whatsapp/groups.tsx — FOUND
- D:/docker/openclaw/src/pages/whatsapp/session.tsx — FOUND
- D:/docker/openclaw/src/pages/whatsapp/config.tsx — FOUND
- Old src/pages/whatsapp.tsx — DELETED (confirmed)

Commit 3efe9ec exists in git log.
Build passes.
