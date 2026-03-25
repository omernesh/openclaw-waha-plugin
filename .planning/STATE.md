---
gsd_state_version: 1.0
milestone: v1.13
milestone_name: Close All Gaps
status: unknown
stopped_at: Completed 32-03-PLAN.md
last_updated: "2026-03-20T11:30:00.000Z"
progress:
  total_phases: 8
  completed_phases: 8
  total_plans: 19
  completed_plans: 19
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.
**Current focus:** Phase 38 — Resilience & Health (COMPLETE)

## Current Position

Phase: 38 (Resilience & Health) — COMPLETE
Plan: 1 of 1

## Accumulated Context

### Decisions

- All 38 v1.13 requirements mapped; no deferrals
- Phase 32 (Platform Abstraction) depends on Phase 28 (API Coverage) — all others are independent
- PAIR-* + CQ-* combined into Phase 27 (small items, natural pairing)
- PRES-01 and PRES-02 folded into Phase 28 (API coverage theme)
- E2E tests use both sessions: omer (3cf11776_omer) and logan (3cf11776_logan)
- Group join/leave events ARE supported by WAHA — included in API-06
- Dynamic imports in health.ts alertGodModeUsers to avoid circular deps (health -> send -> accounts)
- enableRecovery defaults false (backward compat); opt-in per startHealthCheck call site
- UNHEALTHY_THRESHOLD raised from 3 to 5 (unifies with AUTO_RECOVERY_THRESHOLD)
- [Phase 25]: Recovery info row rendered conditionally (only when recoveryAttemptCount > 0) to preserve clean UI
- [Phase 26-01]: validateWahaConfig() validates before every config write; backup failure is non-fatal; import writes full config verbatim
- [Phase 26-02]: request() throws parsed JSON on non-2xx; SettingsTab shows field-level errors on 400, Export/Import buttons wired
- [Phase 27]: useTheme falls back to prefers-color-scheme only when no localStorage value exists
- [Phase 27]: Log export uses plain text format (journalctl-compatible) with server-filtered lines
- [Phase 27]: PAIR-01: PairingEngine is active Phase 16 code — no removal. Dead code was the assumption, not the file.
- [Phase 27]: CQ-02: admin name uses dirDb.getContact() on first godModeSuperUsers entry; falls back to 'the administrator' gracefully
- [Phase 27]: CQ-03: both error paths in getCachedConfig() now include actionable context and root cause
- [Phase 28]: getAllWahaPresence was already added by plan 01 — no re-add needed
- [Phase 28]: [Phase 28-01]: searchChannelsByView defaults viewType to RECOMMENDED when absent
- [Phase 28]: [Phase 28-01]: getAllWahaPresence uses GET on /presence (same path as POST for setPresenceStatus)
- [Phase 28-02]: group.leave does not remove participant from DirectoryDb — no removal method exists; row kept as historical record
- [Phase 28-02]: API key endpoints are server-scoped (/api/keys), not session-scoped
- [Phase 28-02]: group.join upserts participant via bulkUpsertGroupParticipants with isAdmin=false default
- [Phase 29-01]: useEventSource uses .tsx extension (JSX in SSEProvider); SSE callback emitted after lastCheckAt so timestamp is included; SSEProvider placed inside SidebarProvider
- [Phase 29-02]: SSE log events emitted selectively (health transitions, queue depth > 10, config save, message enqueue) — not on every console.log
- [Phase 29-02]: Log buffer capped at LOG_LINE_LIMIT * 2 then trimmed to LOG_LINE_LIMIT from front
- [Phase 29-02]: newLineCount reads userScrolledUpRef.current (ref) inside SSE callback to avoid stale closure on autoScroll state
- [Phase 30]: analytics.db stored at ~/.openclaw/data/analytics.db (separate from directory.db)
- [Phase 30]: 90-day auto-prune runs in AnalyticsDb constructor on every startup
- [Phase 30]: inbound recording placed at statusSink line (post-filter, post-dedup) -- captures confirmed deliverable messages
- [Phase 30]: AnalyticsTab uses direct color values (#22c55e, #3b82f6, #f59e0b) for recharts fills — shadcn chart CSS vars not guaranteed
- [Phase 30]: recharts installed in src/admin; AnalyticsTab is lazy-loaded (374kB chunk)
- [Phase 31-01]: DirectoryDb tests use real :memory: SQLite — no mocking at the DB layer
- [Phase 31-01]: better-sqlite3 NODE_MODULE_VERSION mismatch fixed with npm rebuild (127 vs 141)
- [Phase 31-02]: server.emit('request', req, res) pattern used to test routes without starting HTTP server
- [Phase 31-02]: callRoute resolves when res.end() is called — avoids fixed timeouts for async routes
- [Phase 31-02]: InboundQueue mock uses class syntax (not vi.fn) because createWahaWebhookServer uses new
- [Phase 31-02]: url.pathname ReferenceError in /api/admin/presence route fixed (url was block-scoped to directory if-block)
- [Phase 31-03]: Separate vitest configs: root uses node env, src/admin uses jsdom env — prevents contamination
- [Phase 31-03]: resolve.dedupe for React required — recharts installs own React under src/admin/node_modules
- [Phase 31-03]: getAllByRole/getAllByText pattern throughout — Radix UI portals duplicate DOM nodes
- [Phase 31-03]: recharts fully mocked in jsdom — SVG measurement APIs not available in test env
- [Phase 32-01]: WahaClient cache keyed by accountId (no TTL); clearWahaClientCache() for hot-reload
- [Phase 32-01]: resolveAccountParams kept as deprecated shim (no callers remain) — safer than removing
- [Phase 32-01]: assertCanSend added explicitly to mutation-path functions (getClient does not call it)
- [Phase 32-01]: getWahaContacts uses client.get with session as query param, NOT path segment
- [Phase 32]: PlatformAdapter interface is minimal — only operations channel.ts dispatches; WahaPlatformAdapter delegates to send.ts verbatim
- [Phase 32]: _adapter initialized lazily on first handleAction call; fallback to direct send.ts calls preserved for backward compat
- [Phase 32-03]: Default tenant 'default' uses legacy DB path (no subdirectory) — no migration required for existing installs
- [Phase 32-03]: tenantId extracted from coreCfg.channels.waha.tenantId in handleAction — config-driven, not call-site-driven
- [Phase 32-03]: Cache key changed from safeId to 'safeTenant:safeId' to allow same accountId in different tenants

- [Phase 38]: Health checker uses callback pattern (setSessionHealthChecker) to avoid circular dependency between http-client.ts and health.ts
- [Phase 38]: Recovery timeout keeps outcome='failed' with descriptive error message — avoids type changes across RecoveryEvent/RecoveryState

### Pending Todos

None.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260320-hoy | Embed WAHA WhatsApp pages into OpenClaw Mission Control dashboard | 2026-03-20 | b300c98 | [260320-hoy-embed-waha-whatsapp-pages-into-openclaw-](./quick/260320-hoy-embed-waha-whatsapp-pages-into-openclaw-/) |
| 260320-k2e | Restore per-group filter override UI in React admin panel | 2026-03-20 | 9a0d101 | [260320-k2e-restore-all-old-gui-features-from-pre-vi](./quick/260320-k2e-restore-all-old-gui-features-from-pre-vi/) |
| 260320-rii | Restore all missing old GUI features to React admin panel | 2026-03-20 | be3c87e | [260320-rii-restore-all-missing-old-gui-features-to-](./quick/260320-rii-restore-all-missing-old-gui-features-to-/) |
| 260320-u7x | Directory tab complete overhaul — avatars, stacked layout, pagination, action buttons | 2026-03-20 | a74432c | [260320-u7x-directory-tab-complete-overhaul-avatars-](./quick/260320-u7x-directory-tab-complete-overhaul-avatars-/) |
| 260321-4i9 | Session-aware trigger reply routing — bot session used for groups where bot is a member | 2026-03-21 | 24aeafd | [260321-4i9-fix-operator-to-invoke-sammie-in-any-cha](./quick/260321-4i9-fix-operator-to-invoke-sammie-in-any-cha/) |
| 260324-mbd | Fix bulk allow-dm not persisting + add timed DM access with duration picker | 2026-03-24 | 1d6481f | [260324-mbd-fix-bulk-allow-dm-not-persisting-add-tim](./quick/260324-mbd-fix-bulk-allow-dm-not-persisting-add-tim/) |
| 260324-mxr | Add 1h+5h expiry to contact card + push v1.16.18 | 2026-03-24 | 0f888a1 | [260324-mxr-add-1h-5h-expiry-to-contact-card-push-it](./quick/260324-mxr-add-1h-5h-expiry-to-contact-card-push-it/) |
| 260324-sl3 | Fix unauthorized DM response: isDm guard covers @c.us + @lid, excludes groups/newsletters | 2026-03-24 | pending | [260324-sl3-fix-unauthorized-dm-response-when-enable](./quick/260324-sl3-fix-unauthorized-dm-response-when-enable/) |
| 260324-sl3 | Fix unauthorized DM response firing on newsletter chatIds | 2026-03-24 | dfa4035 | [260324-sl3-fix-unauthorized-dm-response-when-enable](./quick/260324-sl3-fix-unauthorized-dm-response-when-enable/) |

## Session Continuity

Last session: 2026-03-25T03:11:00Z
Stopped at: Completed 38-01-PLAN.md
Resume file: None
