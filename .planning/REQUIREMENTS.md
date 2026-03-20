# Requirements: WAHA OpenClaw Plugin

**Defined:** 2026-03-20
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.13 Requirements

### Reliability & Recovery

- [ ] **REC-01**: Unhealthy sessions auto-restart via WAHA API after 5 consecutive health check failures
- [ ] **REC-02**: Cooldown between restart attempts (5 minute minimum) to prevent restart storms
- [ ] **REC-03**: Recovery events surfaced in admin Dashboard health cards (attempt count, last recovery, outcome)
- [ ] **REC-04**: Alert god mode users via WhatsApp when session goes unhealthy (using healthy session)

### Config Safety

- [ ] **CFG-01**: Admin config POST validated against Zod schema before saving to disk
- [ ] **CFG-02**: Validation errors returned as structured field-level response to admin panel
- [ ] **CFG-03**: Config backup before save (rotate last 3 backups)
- [ ] **CFG-04**: Config export endpoint (GET /api/admin/config/export — full JSON download)
- [ ] **CFG-05**: Config import endpoint (POST /api/admin/config/import) with schema validation

### Pairing Cleanup

- [ ] **PAIR-01**: Remove or integrate plugin PairingEngine (currently dead code — gateway pairing runs instead)
- [ ] **PAIR-02**: Fix bot echo triggering pairing challenges for itself (fromMe messages creating pairing requests)
- [ ] **PAIR-03**: Ensure pairing.ts is always included in deploy artifacts

### API Coverage

- [ ] **API-01**: Channel search by view (POST /channels/search/by-view)
- [ ] **API-02**: Channel search metadata endpoints (GET views, countries, categories)
- [ ] **API-03**: Bulk presence GET (GET /presence — all subscribed presence info)
- [ ] **API-04**: Group join-info (GET /groups/{id}/join-info — preview before joining)
- [ ] **API-05**: Group refresh (POST /groups/refresh — force refresh from server)
- [ ] **API-06**: Group join/leave/participant-change webhook event handlers
- [ ] **API-07**: API Keys CRUD (create, list, update, delete via /api/keys endpoints)

### Presence

- [ ] **PRES-01**: Verify all 4 presence endpoints work end-to-end (set, get, get-all, subscribe)
- [ ] **PRES-02**: Surface presence data in admin panel (contact online/offline status in directory)

### Real-Time Admin

- [ ] **RT-01**: SSE endpoint (GET /api/admin/events) for live admin panel push
- [ ] **RT-02**: Dashboard auto-updates on health state changes and queue depth changes
- [ ] **RT-03**: Log tab auto-scrolls on new log entries via SSE
- [ ] **RT-04**: Connection indicator in admin sidebar (connected/reconnecting/disconnected)

### Analytics

- [ ] **ANL-01**: SQLite analytics table (message_events: timestamp, direction, chat_type, action, duration_ms, status)
- [ ] **ANL-02**: Analytics API endpoint (GET /api/admin/analytics?range=24h&groupBy=hour)
- [ ] **ANL-03**: Analytics tab in admin panel with charts (recharts — messages/hour, response times, top chats)

### Test Coverage

- [ ] **TST-01**: monitor.ts admin API route tests (mock HTTP req/res, test each endpoint)
- [ ] **TST-02**: inbound.ts pipeline tests (mock SDK imports, test filter/dedup/queue flow)
- [ ] **TST-03**: directory.ts CRUD tests (contacts, participants, overrides, LID mapping)
- [ ] **TST-04**: shutup.ts interactive flow tests (mute/unmute with pending selections)
- [ ] **TST-05**: React admin panel component tests (vitest + testing-library)

### Code Quality

- [ ] **CQ-01**: Fix remaining .catch(() => {}) in shutup.ts:239
- [ ] **CQ-02**: Resolve inbound.ts:704 TODO (admin name resolution from Bot Admin role contacts)
- [ ] **CQ-03**: Add guard for _cachedConfig singleton in channel.ts (fail-safe when called before handleAction)
- [ ] **CQ-04**: Add prefers-color-scheme auto-detect to admin panel theme toggle
- [ ] **CQ-05**: Log tab export/download button (CSV or plain text)

### Platform Abstraction

- [ ] **PLAT-01**: Extract WahaClient class (stateful client with config, retry, caching built in)
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
| REC-01 | TBD | Pending |
| REC-02 | TBD | Pending |
| REC-03 | TBD | Pending |
| REC-04 | TBD | Pending |
| CFG-01 | TBD | Pending |
| CFG-02 | TBD | Pending |
| CFG-03 | TBD | Pending |
| CFG-04 | TBD | Pending |
| CFG-05 | TBD | Pending |
| PAIR-01 | TBD | Pending |
| PAIR-02 | TBD | Pending |
| PAIR-03 | TBD | Pending |
| API-01 | TBD | Pending |
| API-02 | TBD | Pending |
| API-03 | TBD | Pending |
| API-04 | TBD | Pending |
| API-05 | TBD | Pending |
| API-06 | TBD | Pending |
| API-07 | TBD | Pending |
| PRES-01 | TBD | Pending |
| PRES-02 | TBD | Pending |
| RT-01 | TBD | Pending |
| RT-02 | TBD | Pending |
| RT-03 | TBD | Pending |
| RT-04 | TBD | Pending |
| ANL-01 | TBD | Pending |
| ANL-02 | TBD | Pending |
| ANL-03 | TBD | Pending |
| TST-01 | TBD | Pending |
| TST-02 | TBD | Pending |
| TST-03 | TBD | Pending |
| TST-04 | TBD | Pending |
| TST-05 | TBD | Pending |
| CQ-01 | TBD | Pending |
| CQ-02 | TBD | Pending |
| CQ-03 | TBD | Pending |
| CQ-04 | TBD | Pending |
| CQ-05 | TBD | Pending |
| PLAT-01 | TBD | Pending |
| PLAT-02 | TBD | Pending |
| PLAT-03 | TBD | Pending |

**Coverage:**
- v1.13 requirements: 38 total
- Mapped to phases: 0
- Unmapped: 38 ⚠️

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after gap analysis and WAHA API audit*
