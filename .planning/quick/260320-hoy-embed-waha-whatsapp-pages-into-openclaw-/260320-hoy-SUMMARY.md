# Quick Task 260320-hoy: Embed WAHA WhatsApp Pages into Mission Control

## Status: Complete

## What Was Done

Replaced the iframe-based WhatsApp tab in OpenClaw Mission Control (sammie.nesher.co) with 6 native React sub-pages, following the exact Claudios dashboard pattern.

### Files Created (in D:/docker/openclaw)
- `src/lib/waha-api.ts` — Typed API client for plugin admin + direct WAHA endpoints
- `src/components/whatsapp/whatsapp-nav.tsx` — Sub-navigation with hash-based routing
- `src/pages/whatsapp/index.tsx` — Router with lazy-loaded views
- `src/pages/whatsapp/overview.tsx` — Session status, health, message stats, queue
- `src/pages/whatsapp/chats.tsx` — Chat list with search + message viewer
- `src/pages/whatsapp/contacts.tsx` — Paginated directory (3000+ contacts)
- `src/pages/whatsapp/groups.tsx` — Group cards with expandable participants
- `src/pages/whatsapp/session.tsx` — Session management with restart/recovery
- `src/pages/whatsapp/config.tsx` — Plugin config viewer with raw JSON toggle

### Files Modified
- `server/server.js` — Added `/waha-api/*` proxy to WAHA on port 3004
- `src/hooks/use-hash-route.ts` — Added WhatsApp sub-routes
- `src/App.tsx` — Route `#/whatsapp/*` to new WhatsAppPage

### Files Deleted
- `src/pages/whatsapp.tsx` — Old iframe page

## Verification
- All 6 tabs render with real data from WAHA plugin API
- Contacts: 3030 entries with pagination and search
- Groups: 50 groups with expandable participant lists
- Existing MC tabs (Dashboard, Claudios) unaffected
- Deployed to hpg6 and verified via Chrome DevTools

## Commits
- `3efe9ec` — Initial implementation (openclaw repo)
- `b300c98` — API shape fixes + data rendering fixes (openclaw repo)
