---
phase: 29
plan: 01
subsystem: admin-panel
tags: [sse, real-time, websocket-alternative, react, monitor]
dependency_graph:
  requires: []
  provides: [sse-endpoint, sse-broadcast, health-sse, queue-sse, useEventSource, SSEProvider, connection-indicator]
  affects: [src/monitor.ts, src/health.ts, src/inbound-queue.ts, src/admin/src/]
tech_stack:
  added: [EventSource API, Server-Sent Events]
  patterns: [SSE keep-alive, singleton context provider, callback-based state change emission]
key_files:
  created:
    - src/admin/src/hooks/useEventSource.tsx
  modified:
    - src/monitor.ts
    - src/health.ts
    - src/inbound-queue.ts
    - src/admin/src/types.ts
    - src/admin/src/components/AppSidebar.tsx
    - src/admin/src/App.tsx
decisions:
  - useEventSource.tsx uses .tsx extension (not .ts) because SSEProvider returns JSX
  - SSE callback emitted after state.lastCheckAt assignment (after try/catch) so timestamp is included
  - QueueStats shape preserved exactly — SSEQueueEvent matches existing QueueStats fields
  - SSEProvider placed inside SidebarProvider (not outside) — AppSidebar must be inside SidebarProvider
metrics:
  duration: "15 minutes"
  completed: "2026-03-20"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 5
---

# Phase 29 Plan 01: SSE Infrastructure and Connection Indicator Summary

**One-liner:** SSE endpoint at `/api/admin/events` with health/queue event emission and a live green/amber/red connection dot in the admin sidebar.

## What Was Built

### Server (monitor.ts, health.ts, inbound-queue.ts)

- `sseClients: Set<ServerResponse>` — tracks active SSE connections at module level
- `broadcastSSE(event, data)` — iterates all clients, writes named SSE frames, removes broken clients
- `GET /api/admin/events` route — responds with `text/event-stream`, sends `connected` event on open, keep-alive comment every 30s, auto-cleanup on `req.close`
- `setHealthStateChangeCallback` in health.ts — fires after every health tick (lastCheckAt update) with full HealthState
- `setQueueChangeCallback` in inbound-queue.ts — fires on every enqueue and after each item processed
- Both callbacks wired in `createWahaWebhookServer` after queue/health setup

### Frontend (React admin panel)

- `src/admin/src/hooks/useEventSource.tsx` — `useEventSource()` hook manages EventSource lifecycle, typed `subscribe()` API, auto-reconnect via native EventSource behavior
- `SSEProvider` context — wraps app root, shares single EventSource across all tabs (no duplicate connections)
- `useSSE()` consumer hook — throws if called outside SSEProvider
- `SSEConnectionStatus`, `SSEHealthEvent`, `SSEQueueEvent`, `SSELogEvent`, `SSEEventMap` added to types.ts
- AppSidebar footer: green dot + "Connected", amber pulsing + "Reconnecting...", red + "Disconnected"

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] useEventSource.ts renamed to .tsx**
- **Found during:** Task 2 TypeScript compilation
- **Issue:** SSEProvider contains JSX (`<SSEContext.Provider>`), which requires `.tsx` extension in the project's tsconfig
- **Fix:** Renamed file to `useEventSource.tsx` — all imports still resolve without extension
- **Files modified:** `src/admin/src/hooks/useEventSource.tsx`

## Self-Check: PASSED

- src/admin/src/hooks/useEventSource.tsx: FOUND
- src/admin/src/types.ts: FOUND (SSEConnectionStatus, SSEHealthEvent present)
- src/monitor.ts: FOUND (api/admin/events, broadcastSSE, sseClients present)
- src/health.ts: FOUND (setHealthStateChangeCallback present)
- src/inbound-queue.ts: FOUND (setQueueChangeCallback present)
- Commits: 48060bc (Task 1), ef08f20 (Task 2) — both present in git log
- Vite build: success (no errors)
