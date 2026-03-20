---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - D:/docker/openclaw/src/lib/waha-api.ts
  - D:/docker/openclaw/src/components/whatsapp/whatsapp-nav.tsx
  - D:/docker/openclaw/src/pages/whatsapp/index.tsx
  - D:/docker/openclaw/src/pages/whatsapp/overview.tsx
  - D:/docker/openclaw/src/pages/whatsapp/chats.tsx
  - D:/docker/openclaw/src/pages/whatsapp/contacts.tsx
  - D:/docker/openclaw/src/pages/whatsapp/groups.tsx
  - D:/docker/openclaw/src/pages/whatsapp/session.tsx
  - D:/docker/openclaw/src/pages/whatsapp/config.tsx
  - D:/docker/openclaw/src/hooks/use-hash-route.ts
  - D:/docker/openclaw/src/App.tsx
  - D:/docker/openclaw/src/pages/whatsapp.tsx
  - D:/docker/openclaw/server/server.js
autonomous: false
requirements: [WHATSAPP-EMBED]

must_haves:
  truths:
    - "WhatsApp tab shows native React sub-pages instead of iframe"
    - "Sub-navigation tabs work (Overview, Chats, Contacts, Groups, Session, Config)"
    - "Each sub-page loads real data from WAHA plugin API"
    - "Existing MC tabs (Claudios, Dashboard, etc.) are unaffected"
  artifacts:
    - path: "src/lib/waha-api.ts"
      provides: "Typed WAHA API client"
    - path: "src/pages/whatsapp/index.tsx"
      provides: "WhatsApp router with lazy-loaded views"
    - path: "src/components/whatsapp/whatsapp-nav.tsx"
      provides: "Sub-navigation tabs"
  key_links:
    - from: "src/App.tsx"
      to: "src/pages/whatsapp/index.tsx"
      via: "route.startsWith('/whatsapp')"
    - from: "src/pages/whatsapp/*.tsx"
      to: "src/lib/waha-api.ts"
      via: "wahaApi.* calls"
    - from: "server/server.js"
      to: "http://127.0.0.1:3004"
      via: "/waha-api/* proxy"
---

<objective>
Replace the WhatsApp iframe in OpenClaw Mission Control with native React pages following the exact Claudios pattern.

Purpose: The iframe approach is limited (no deep linking, no theme integration, no cross-tab data sharing). Native pages give full control.
Output: 6 WhatsApp sub-pages (Overview, Chats, Contacts, Groups, Session, Config) with sub-nav, API client, and WAHA API proxy.

IMPORTANT: All work is in D:/docker/openclaw, NOT D:/docker/waha-oc-plugin.
</objective>

<execution_context>
@C:/Users/omern/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/omern/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
Working codebase: D:/docker/openclaw

Key pattern files to follow:
@D:/docker/openclaw/src/pages/claudios/index.tsx (router pattern — lazy imports, sub-nav, Suspense)
@D:/docker/openclaw/src/components/claudios/claudios-nav.tsx (sub-nav pattern — hash-based, active state, dark theme)
@D:/docker/openclaw/src/lib/claudios-api.ts (API client pattern — typed request function, ApiError class)
@D:/docker/openclaw/src/pages/claudios/dashboard.tsx (page pattern — useApi, useAutoRefresh, Card components)
@D:/docker/openclaw/src/hooks/use-hash-route.ts (routing — Route type union, hash change listener)
@D:/docker/openclaw/src/App.tsx (top-level routing — startsWith check for sub-routes)
@D:/docker/openclaw/server/server.js (proxy pattern — lines 672-696 for /api/admin/* proxy to 8050)

Available plugin API endpoints (proxied via /api/admin/*):
- GET /api/admin/sessions — session list + status
- GET /api/admin/health — health check data
- GET /api/admin/stats — message filter statistics
- GET /api/admin/directory?type=contact&search=&limit=&offset= — contacts
- GET /api/admin/directory?type=group — groups
- GET /api/admin/directory?type=newsletter — newsletters
- GET /api/admin/directory/:jid — single contact/group detail
- GET /api/admin/directory/group/:groupJid/participants — group participants
- GET /api/admin/config — plugin config
- POST /api/admin/config — update config (expects {"waha": {...}} wrapper)
- GET /api/admin/analytics?range=7d — analytics data
- GET /api/admin/presence — presence info
- GET /api/admin/queue — inbound queue stats
- GET /api/admin/recovery — recovery history
- POST /api/admin/restart — restart gateway

Direct WAHA API endpoints (need NEW proxy /waha-api/* -> port 3004):
- GET /api/sessions — WAHA session list
- GET /api/sessions/{session}/me — session info + QR
- GET /api/{session}/chats — chat list
- GET /api/{session}/chats/{chatId}/messages?limit=50 — messages
- GET /api/contacts?session={session} — contact details
- GET /api/version — WAHA version
</context>

<tasks>

<task type="auto">
  <name>Task 1: API Client + Server Proxy + Router Infrastructure</name>
  <files>
    D:/docker/openclaw/server/server.js
    D:/docker/openclaw/src/lib/waha-api.ts
    D:/docker/openclaw/src/components/whatsapp/whatsapp-nav.tsx
    D:/docker/openclaw/src/pages/whatsapp/index.tsx
    D:/docker/openclaw/src/hooks/use-hash-route.ts
    D:/docker/openclaw/src/App.tsx
    D:/docker/openclaw/src/pages/whatsapp.tsx
  </files>
  <action>
    IMPORTANT: All file paths are in D:/docker/openclaw. Back up files before modifying.

    1. **server.js — Add WAHA API proxy** (insert BEFORE the auth gate, right after the /api/admin/* proxy block around line 696):
       - Add proxy: if pathname starts with `/waha-api/`, strip prefix, forward to `http://127.0.0.1:3004` with API key header `X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=`
       - Follow exact same proxy pattern as the /api/admin/* block (http.request, pipe req/res, error handling with 502)
       - This allows the SPA to call `/waha-api/api/sessions` which proxies to `http://127.0.0.1:3004/api/sessions`

    2. **src/lib/waha-api.ts — WAHA API client** (follow claudios-api.ts pattern):
       - Import/reuse ApiError from `./api` (same class)
       - Create typed `request<T>` function hitting two base paths:
         - Plugin admin API: `/api/admin/*` (already proxied to port 8050)
         - Direct WAHA API: `/waha-api/*` (new proxy to port 3004)
       - Export `wahaApi` object with typed methods:
         ```
         // Plugin admin endpoints (port 8050 via existing proxy)
         sessions(): GET /api/admin/sessions
         health(): GET /api/admin/health
         stats(): GET /api/admin/stats
         config(): GET /api/admin/config
         updateConfig(cfg): POST /api/admin/config with {"waha": cfg}
         directory(type, search?, limit?, offset?): GET /api/admin/directory?type=&search=&limit=&offset=
         directoryEntry(jid): GET /api/admin/directory/:jid
         groupParticipants(groupJid): GET /api/admin/directory/group/:groupJid/participants
         analytics(range?): GET /api/admin/analytics?range=
         queue(): GET /api/admin/queue
         recovery(): GET /api/admin/recovery
         restart(): POST /api/admin/restart
         presence(): GET /api/admin/presence

         // Direct WAHA API endpoints (port 3004 via new proxy)
         wahaSessions(): GET /waha-api/api/sessions
         wahaSessionMe(session): GET /waha-api/api/sessions/:session/me
         wahaChats(session): GET /waha-api/api/{session}/chats
         wahaChatMessages(session, chatId, limit?): GET /waha-api/api/{session}/chats/:chatId/messages?limit=
         wahaVersion(): GET /waha-api/api/version
         ```
       - Define TypeScript interfaces for responses: WahaSession, HealthData, StatsData, DirectoryEntry, ChatItem, ChatMessage, etc.
       - Use credentials: 'include' on all fetches (same as claudios-api)

    3. **src/components/whatsapp/whatsapp-nav.tsx** (copy claudios-nav.tsx pattern exactly):
       - Create directory `src/components/whatsapp/` if needed
       - NAV_ITEMS array with paths and labels:
         - /whatsapp → Overview (icon: chart/activity)
         - /whatsapp/chats → Chats (icon: message)
         - /whatsapp/contacts → Contacts (icon: people)
         - /whatsapp/groups → Groups (icon: users)
         - /whatsapp/session → Session (icon: wifi/connection)
         - /whatsapp/config → Config (icon: gear)
       - Same active-state logic, same styling classes, same hash-based navigation

    4. **src/pages/whatsapp/index.tsx** (copy claudios index.tsx pattern exactly):
       - Create directory `src/pages/whatsapp/` if needed
       - Lazy imports for all 6 views (overview, chats, contacts, groups, session, config)
       - Import WhatsAppNav
       - Route matching on hash (same if/else pattern as claudios)
       - Default to OverviewView for /whatsapp and /whatsapp/overview
       - Wrap content in Suspense with loading fallback

    5. **src/hooks/use-hash-route.ts** — Add WhatsApp sub-routes:
       - Add `WhatsAppSubRoute` type: '/whatsapp' | '/whatsapp/chats' | '/whatsapp/contacts' | '/whatsapp/groups' | '/whatsapp/session' | '/whatsapp/config'
       - Update `Route` type union to include WhatsAppSubRoute (replace bare '/whatsapp')

    6. **src/App.tsx** — Update routing:
       - Change WhatsAppPage import to: `import WhatsAppPage from '@/pages/whatsapp/index'`
       - In renderPage(): add `if (route.startsWith('/whatsapp')) return <WhatsAppPage />;` BEFORE the switch statement (same pattern as claudios)
       - Remove '/whatsapp' from the switch case (it's handled by the startsWith check now)

    7. **Delete src/pages/whatsapp.tsx** (the old iframe page). Remove the file entirely.

    DO NOT modify any other existing pages or components. Preserve all existing functionality.
  </action>
  <verify>
    cd D:/docker/openclaw && npx tsc --noEmit 2>&1 | head -30
  </verify>
  <done>
    - waha-api.ts exports typed wahaApi object
    - whatsapp-nav.tsx renders 6 sub-tabs
    - whatsapp/index.tsx lazy-loads 6 views with Suspense
    - use-hash-route.ts has WhatsApp sub-routes in Route type
    - App.tsx routes /whatsapp/* to new WhatsAppPage
    - Old iframe whatsapp.tsx deleted
    - server.js has /waha-api/* proxy to port 3004
    - TypeScript compiles without errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Build All 6 WhatsApp Sub-Pages</name>
  <files>
    D:/docker/openclaw/src/pages/whatsapp/overview.tsx
    D:/docker/openclaw/src/pages/whatsapp/chats.tsx
    D:/docker/openclaw/src/pages/whatsapp/contacts.tsx
    D:/docker/openclaw/src/pages/whatsapp/groups.tsx
    D:/docker/openclaw/src/pages/whatsapp/session.tsx
    D:/docker/openclaw/src/pages/whatsapp/config.tsx
  </files>
  <action>
    IMPORTANT: All file paths are in D:/docker/openclaw. Follow the claudios dashboard.tsx pattern for each page (useApi hook, useAutoRefresh, Card components, loading/error states).

    1. **overview.tsx** — Dashboard overview page:
       - Fetch: wahaApi.sessions(), wahaApi.health(), wahaApi.stats(), wahaApi.queue()
       - Auto-refresh every 5 seconds
       - Cards layout (2-col grid on desktop):
         - Session Status card: session name, status (WORKING/STOPPED/etc.), phone number, green/red dot
         - Health card: healthy/unhealthy indicator, uptime, memory usage
         - Message Stats card: total processed, filtered, duplicates, delivery rate
         - Queue card: queue depth, processing rate
       - Use same Card/CardHeader/CardTitle/CardContent components from @/components/ui/card
       - Dark theme: bg-gray-900 text, muted-foreground for labels, green-500/red-500 for status dots

    2. **chats.tsx** — Chat list + message viewer:
       - Left panel: chat list from wahaApi.wahaChats(session) — scrollable, search input at top
       - Right panel: messages for selected chat from wahaApi.wahaChatMessages(session, chatId, 50)
       - Chat list items: contact name/JID, last message preview, timestamp
       - Messages: bubble layout (sent = right/blue, received = left/gray), timestamp, sender name for groups
       - Session ID: get from wahaApi.sessions() first item's accountId or hardcode '3cf11776_logan' as default
       - Search: filter chat list by name/JID (client-side)
       - Handle empty states gracefully

    3. **contacts.tsx** — Contact directory:
       - Fetch: wahaApi.directory('contact', search, 50, offset) with pagination
       - Search input at top (debounced 300ms using useDebounce hook)
       - Table layout: Name, Phone/JID, DM Status (allowed/blocked), Last Seen
       - Pagination: Previous/Next buttons with offset tracking
       - Click row to expand: show full details from wahaApi.directoryEntry(jid)
       - Style: standard MC table (border-border, hover:bg-muted/50, text-sm)

    4. **groups.tsx** — Group directory:
       - Fetch: wahaApi.directory('group')
       - Grid of cards (1 col mobile, 2 cols desktop)
       - Each card: group name, participant count, subject/description preview
       - Expandable: click to lazy-load participants via wahaApi.groupParticipants(groupJid)
       - Participants shown as list with name, JID, admin badge
       - Search input to filter groups by name (client-side)

    5. **session.tsx** — Session management:
       - Fetch: wahaApi.sessions() for session list, wahaApi.wahaSessionMe(session) for details
       - Session status card: name, status, engine, phone number
       - Connection info: QR code display if status is SCAN_QR (render as img if base64 provided)
       - Actions: Restart Gateway button (calls wahaApi.restart())
       - Recovery history: fetch wahaApi.recovery() and show recent events in a timeline
       - Auto-refresh every 10 seconds

    6. **config.tsx** — Plugin configuration viewer:
       - Fetch: wahaApi.config()
       - Display config sections in cards: Group Filter, DM Filter, Keywords, Sessions
       - Read-only display initially (matching existing admin panel functionality)
       - Each config section in its own Card with key-value pairs
       - Show raw JSON in a collapsible pre block for advanced users

    ALL PAGES must:
    - Use `useApi` hook from @/hooks/use-api for data fetching
    - Use `useAutoRefresh` for polling where appropriate
    - Show loading spinner on initial load
    - Show error state with red border card on failure
    - Use existing UI components (Card, etc.) from @/components/ui/
    - Match dark theme (no hardcoded light colors)
    - Be default-exported (required for lazy() imports)
  </action>
  <verify>
    cd D:/docker/openclaw && npx tsc --noEmit 2>&1 | head -30
  </verify>
  <done>
    - All 6 pages render without errors
    - Each page fetches real data from wahaApi
    - Dark theme consistent with rest of MC
    - Loading and error states handled
    - TypeScript compiles clean
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Complete WhatsApp native pages replacing the iframe in Mission Control. 6 sub-pages (Overview, Chats, Contacts, Groups, Session, Config) with sub-navigation, API client, and WAHA API proxy.</what-built>
  <how-to-verify>
    1. Build and deploy to hpg6:
       - cd D:/docker/openclaw && npm run build
       - SCP dist/ and server/ to hpg6
       - SSH to hpg6, kill port 8899, restart server
    2. Visit https://sammie.nesher.co/#/whatsapp
    3. Verify sub-nav tabs appear (Overview, Chats, Contacts, Groups, Session, Config)
    4. Click each tab — verify data loads (no iframe, native React components)
    5. Check existing tabs still work (Dashboard, Claudios, etc.)
    6. Check Overview shows session status and stats
    7. Check Contacts/Groups show directory data with search
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- TypeScript compiles: `cd D:/docker/openclaw && npx tsc --noEmit`
- Build succeeds: `cd D:/docker/openclaw && npm run build`
- No existing functionality broken (Claudios tab, Dashboard, etc.)
- WhatsApp tab shows native sub-pages instead of iframe
</verification>

<success_criteria>
- iframe at src/pages/whatsapp.tsx is deleted
- 6 native WhatsApp sub-pages render with real data
- Sub-navigation works with hash routing
- WAHA API proxy in server.js forwards to port 3004
- Dark theme matches rest of MC
- All other MC tabs unaffected
</success_criteria>

<output>
After completion, create `.planning/quick/260320-hoy-embed-waha-whatsapp-pages-into-openclaw-/260320-hoy-SUMMARY.md`
</output>
