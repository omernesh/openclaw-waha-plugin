# Requirements: WAHA OpenClaw Plugin

**Defined:** 2026-03-20
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.13 Requirements

### Reliability & Recovery

- [x] **REC-01**: Unhealthy sessions auto-restart via WAHA API after 5 consecutive health check failures
- [x] **REC-02**: Cooldown between restart attempts (5 minute minimum) to prevent restart storms
- [x] **REC-03**: Recovery events surfaced in admin Dashboard health cards (attempt count, last recovery, outcome)
- [x] **REC-04**: Alert god mode users via WhatsApp when session goes unhealthy (using healthy session)

### Config Safety

- [x] **CFG-01**: Admin config POST validated against Zod schema before saving to disk
- [x] **CFG-02**: Validation errors returned as structured field-level response to admin panel
- [x] **CFG-03**: Config backup before save (rotate last 3 backups)
- [x] **CFG-04**: Config export endpoint (GET /api/admin/config/export — full JSON download)
- [x] **CFG-05**: Config import endpoint (POST /api/admin/config/import) with schema validation

### Pairing Cleanup

- [x] **PAIR-01**: Remove or integrate plugin PairingEngine (currently dead code — gateway pairing runs instead)
- [x] **PAIR-02**: Fix bot echo triggering pairing challenges for itself (fromMe messages creating pairing requests)
- [x] **PAIR-03**: Ensure pairing.ts is always included in deploy artifacts

### API Coverage

- [x] **API-01**: Channel search by view (POST /channels/search/by-view)
- [x] **API-02**: Channel search metadata endpoints (GET views, countries, categories)
- [x] **API-03**: Bulk presence GET (GET /presence — all subscribed presence info)
- [x] **API-04**: Group join-info (GET /groups/{id}/join-info — preview before joining)
- [x] **API-05**: Group refresh (POST /groups/refresh — force refresh from server)
- [x] **API-06**: Group join/leave/participant-change webhook event handlers
- [x] **API-07**: API Keys CRUD (create, list, update, delete via /api/keys endpoints)

### Presence

- [x] **PRES-01**: Verify all 4 presence endpoints work end-to-end (set, get, get-all, subscribe)
- [x] **PRES-02**: Surface presence data in admin panel (contact online/offline status in directory)

### Real-Time Admin

- [x] **RT-01**: SSE endpoint (GET /api/admin/events) for live admin panel push
- [x] **RT-02**: Dashboard auto-updates on health state changes and queue depth changes
- [x] **RT-03**: Log tab auto-scrolls on new log entries via SSE
- [x] **RT-04**: Connection indicator in admin sidebar (connected/reconnecting/disconnected)

### Analytics

- [x] **ANL-01**: SQLite analytics table (message_events: timestamp, direction, chat_type, action, duration_ms, status)
- [x] **ANL-02**: Analytics API endpoint (GET /api/admin/analytics?range=24h&groupBy=hour)
- [x] **ANL-03**: Analytics tab in admin panel with charts (recharts — messages/hour, response times, top chats)

### Test Coverage

- [x] **TST-01**: monitor.ts admin API route tests (mock HTTP req/res, test each endpoint)
- [x] **TST-02**: inbound.ts pipeline tests (mock SDK imports, test filter/dedup/queue flow)
- [x] **TST-03**: directory.ts CRUD tests (contacts, participants, overrides, LID mapping)
- [x] **TST-04**: shutup.ts interactive flow tests (mute/unmute with pending selections)
- [x] **TST-05**: React admin panel component tests (vitest + testing-library)

### Code Quality

- [x] **CQ-01**: Fix remaining .catch(() => {}) in shutup.ts:239
- [x] **CQ-02**: Resolve inbound.ts:704 TODO (admin name resolution from Bot Admin role contacts)
- [x] **CQ-03**: Add guard for _cachedConfig singleton in channel.ts (fail-safe when called before handleAction)
- [x] **CQ-04**: Add prefers-color-scheme auto-detect to admin panel theme toggle
- [x] **CQ-05**: Log tab export/download button (CSV or plain text)

### Platform Abstraction

- [x] **PLAT-01**: Extract WahaClient class (stateful client with config, retry, caching built in)
- [ ] **PLAT-02**: Define adapter interface for platform-agnostic plugin integration
- [ ] **PLAT-03**: Multi-tenant config isolation groundwork (per-tenant config, session, directory separation for future SaaS)

## Future Requirements

### v1.14+

- **Conversation analytics dashboards** — deeper insights beyond basic message counts
- **Webhook retry/dead-letter queue** — failed inbound recovery
- **Config diff/history** — audit trail with rollback
- **Mobile push notifications** — browser notification API for health alerts
- **Media multi-send** — sendMulti v2 with media support

## Out of Scope

| Feature | Reason |
|---------|--------|
| Scheduled messages | WAHA has no scheduled message API |
| WhatsApp Business templates | Not applicable for personal/bot use |
| Broadcast lists | WAHA API limitation |
| Call initiation | WAHA limitation |
| Disappearing messages | Low priority |
| Hot-reload | Gateway requires restart, not worth engineering around |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REC-01 | Phase 25 | Complete |
| REC-02 | Phase 25 | Complete |
| REC-03 | Phase 25 | Complete |
| REC-04 | Phase 25 | Complete |
| CFG-01 | Phase 26 | Complete |
| CFG-02 | Phase 26 | Complete |
| CFG-03 | Phase 26 | Complete |
| CFG-04 | Phase 26 | Complete |
| CFG-05 | Phase 26 | Complete |
| PAIR-01 | Phase 27 | Complete |
| PAIR-02 | Phase 27 | Complete |
| PAIR-03 | Phase 27 | Complete |
| CQ-01 | Phase 27 | Complete |
| CQ-02 | Phase 27 | Complete |
| CQ-03 | Phase 27 | Complete |
| CQ-04 | Phase 27 | Complete |
| CQ-05 | Phase 27 | Complete |
| API-01 | Phase 28 | Complete |
| API-02 | Phase 28 | Complete |
| API-03 | Phase 28 | Complete |
| API-04 | Phase 28 | Complete |
| API-05 | Phase 28 | Complete |
| API-06 | Phase 28 | Complete |
| API-07 | Phase 28 | Complete |
| PRES-01 | Phase 28 | Complete |
| PRES-02 | Phase 28 | Complete |
| RT-01 | Phase 29 | Complete |
| RT-02 | Phase 29 | Complete |
| RT-03 | Phase 29 | Complete |
| RT-04 | Phase 29 | Complete |
| ANL-01 | Phase 30 | Complete |
| ANL-02 | Phase 30 | Complete |
| ANL-03 | Phase 30 | Complete |
| TST-01 | Phase 31 | Complete |
| TST-02 | Phase 31 | Complete |
| TST-03 | Phase 31 | Complete |
| TST-04 | Phase 31 | Complete |
| TST-05 | Phase 31 | Complete |
| PLAT-01 | Phase 32 | Complete |
| PLAT-02 | Phase 32 | Pending |
| PLAT-03 | Phase 32 | Pending |

**Coverage:**
- v1.13 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 — traceability filled after roadmap creation*
