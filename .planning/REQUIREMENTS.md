# Requirements: WAHA OpenClaw Plugin — v1.14 Enterprise Hardening

**Defined:** 2026-03-25
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.14 Requirements

### Security

- [ ] **SEC-01**: Admin API requires Bearer token authentication on all `/api/admin/*` routes; token read from config or environment variable
- [ ] **SEC-02**: Config import endpoint validates the entire config structure, not just the `waha` sub-section; rejects unknown top-level keys
- [ ] **SEC-03**: JID values extracted from URL path segments are validated against `/@(c\.us|g\.us|lid|newsletter)$/` regex before processing
- [ ] **SEC-04**: Webhook HMAC verification defaults to a randomly-generated secret (logged on startup) when `webhookHmacKey` is not configured; opt-out requires explicit `webhookHmacKey: "disabled"`

### Error Handling

- [ ] **EH-01**: All bare `fetch()` calls in monitor.ts (fetchBotJids, /api/admin/sessions, follow/unfollow bulk) are routed through `callWahaApi()` or use `AbortSignal.timeout(30_000)`
- [ ] **EH-02**: Media download in `downloadWahaMedia()` uses `AbortSignal.timeout(30_000)` on the fetch call
- [ ] **EH-03**: Gemini video polling loop uses `AbortSignal.timeout(5_000)` on each status fetch call
- [ ] **EH-04**: `RateLimiter` in rate-limiter.ts accepts a `maxQueue` constructor parameter and throws when the queue exceeds it

### Resilience

- [ ] **RES-01**: `callWahaApi` integrates with `sessionHealthStates` to fast-fail outbound calls when session status is `unhealthy`, instead of attempting full retry cycle
- [ ] **RES-02**: Auto-recovery in health.ts polls session status after restart and only marks `outcome = "success"` when the session reaches CONNECTED state (with a 30s timeout)

### Observability

- [ ] **OBS-01**: A `logger` module provides structured JSON logging with consistent fields (level, timestamp, component, sessionId, chatId) replacing all freeform `console.*` calls
- [ ] **OBS-02**: A `/metrics` endpoint exposes process-level metrics in Prometheus format: heap usage, event loop lag, HTTP request rates, SQLite query latency, queue depth, processing latency P95, error rate
- [ ] **OBS-03**: `sseClients` Set has a maximum cap (50); new SSE connections beyond the cap are rejected with HTTP 503

### Memory & Resources

- [x] **MEM-01**: Config file writes use async `fs/promises` instead of blocking `readFileSync`/`writeFileSync`, with a promise-based write lock to serialize concurrent writes
- [ ] **MEM-02**: On startup, a sweep deletes orphaned media temp files older than 10 minutes from `/tmp/openclaw/waha-media-*`
- [ ] **MEM-03**: Both `DirectoryDb` and `AnalyticsDb` set `PRAGMA busy_timeout = 5000` on database initialization

### Concurrency

- [x] **CON-01**: Config file read-modify-write operations are serialized through a promise-based mutex, preventing concurrent write corruption
- [ ] **CON-02**: The `finally` block in `InboundQueue.drain()` wraps both the `onQueueChange?.()` call and the recursive `drain()` call in try/catch to prevent unhandled rejections

### Data Integrity

- [ ] **DI-01**: Both `DirectoryDb` and `AnalyticsDb` run periodic `PRAGMA wal_checkpoint(PASSIVE)` (e.g., every sync cycle or every 30 minutes)
- [x] **DI-02**: Config file writes use atomic write-to-temp-then-rename pattern (`writeFile` to `.tmp` then `rename` over target)

### Graceful Shutdown

- [ ] **GS-01**: `server.close()` tracks in-flight request count and waits for all to complete (with a 10s hard timeout) before resolving
- [ ] **GS-02**: SSE keep-alive `setInterval` is `.unref()`'d, and the abort handler clears all remaining SSE intervals and closes all SSE client connections

### Configuration

- [ ] **CFG-01**: `healthCheckIntervalMs` has a minimum bound of 10000ms and `syncIntervalMinutes` has a minimum bound of 1 minute, enforced in config-schema.ts via Zod `.min()` transforms
- [ ] **CFG-02**: `configureReliability()` is called once with global config, not per-account; or per-account token buckets are used to prevent last-account-wins behavior

### API Robustness

- [ ] **API-01**: Admin API routes have IP-based or token-based request rate limiting (reusing `RateLimiter` from rate-limiter.ts) to prevent event loop denial-of-service
- [ ] **API-02**: `req.url` mutation in static file serving is replaced with a local variable; the original `req.url` is never modified
- [ ] **API-03**: Nominatim geocode call uses `AbortSignal.timeout(5_000)` and a 1-request-per-second rate limit to respect free tier limits

## Future Requirements

None — this milestone covers all identified gaps.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full APM integration (Datadog, New Relic) | Prometheus `/metrics` is sufficient; APM agents are env-specific |
| mTLS between plugin and WAHA | WAHA runs on localhost; TLS adds complexity for no gain |
| RBAC for admin panel (role-based access) | Single admin token is sufficient for current deployment |
| Database encryption at rest | SQLite data is non-sensitive contact metadata; OS-level encryption suffices |
| Log rotation/shipping | OS-level concern (logrotate/journald); plugin outputs structured logs |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CON-01 | Phase 33 | Complete |
| MEM-01 | Phase 33 | Complete |
| DI-02 | Phase 33 | Complete |
| SEC-01 | Phase 34 | Pending |
| SEC-02 | Phase 34 | Pending |
| SEC-03 | Phase 34 | Pending |
| SEC-04 | Phase 34 | Pending |
| OBS-01 | Phase 35 | Pending |
| EH-01 | Phase 36 | Pending |
| EH-02 | Phase 36 | Pending |
| EH-03 | Phase 36 | Pending |
| EH-04 | Phase 36 | Pending |
| API-03 | Phase 36 | Pending |
| MEM-03 | Phase 37 | Pending |
| DI-01 | Phase 37 | Pending |
| MEM-02 | Phase 37 | Pending |
| RES-01 | Phase 38 | Pending |
| RES-02 | Phase 38 | Pending |
| CON-02 | Phase 38 | Pending |
| GS-01 | Phase 39 | Pending |
| GS-02 | Phase 39 | Pending |
| OBS-03 | Phase 39 | Pending |
| API-01 | Phase 40 | Pending |
| API-02 | Phase 40 | Pending |
| CFG-01 | Phase 40 | Pending |
| CFG-02 | Phase 40 | Pending |
| OBS-02 | Phase 41 | Pending |

**Coverage:**
- v1.14 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 — traceability updated after roadmap creation*
