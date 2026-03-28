# Pitfalls Research

**Domain:** Plugin-to-SaaS extraction — WhatsApp automation platform (Chatlytics v2.0)
**Researched:** 2026-03-28
**Confidence:** HIGH (based on direct codebase analysis + verified external sources)

---

## Critical Pitfalls

### Pitfall 1: Decoupling inbound.ts from OpenClaw SDK — the hardest cut

**What goes wrong:**
`inbound.ts` imports 8+ symbols directly from `openclaw/plugin-sdk/*`:
`resolveDefaultGroupPolicy`, `createNormalizedOutboundDeliverer`, `resolveAllowlistProviderRuntimeGroupPolicy`,
`resolveOutboundMediaUrls`, `readStoreAllowFromForDmPolicy`, `resolveDmGroupAccessWithCommandGate`, `logInboundDrop`.

These are not thin type aliases — they implement real business logic (group policy resolution, DM access rules, reply formatting, media URL resolution). If you cut the import without replacing the logic, inbound message processing silently drops to unsafe defaults or throws at runtime.

**Why it happens:**
The decoupling PR focuses on "remove the import" and forgets that each SDK symbol contains logic that must be re-implemented or the behavior changes. Developers assume the function names are descriptive enough to recreate — they often aren't.

**How to avoid:**
Before removing any SDK import from `inbound.ts`, audit what the function actually does in the SDK source at `/usr/lib/node_modules/openclaw/dist/`. Implement local equivalents that match behavior exactly. Test against the existing plugin's test suite (594 tests) before considering any SDK cut "done." Treat each SDK symbol as a potential behavior contract, not just a dependency.

**Warning signs:**
- Tests pass but live WhatsApp messages stop triggering agent responses
- Group messages marked as allowed suddenly start getting dropped
- DM filter logs show `resolveDefaultGroupPolicy` returning different values in standalone vs plugin mode

**Phase to address:** Phase 1 (Core Extraction) — must be resolved before standalone.ts can boot correctly

---

### Pitfall 2: monitor.ts still imports from OpenClaw SDK after "extraction"

**What goes wrong:**
`monitor.ts` imports `readRequestBodyWithLimit`, `isRequestBodyLimitError`, `requestBodyErrorToText`, `DEFAULT_ACCOUNT_ID`, `isWhatsAppGroupJid` from `openclaw/plugin-sdk/*` and also `createLoggerBackedRuntime` from `openclaw/plugin-sdk/runtime`.

If the standalone entry point loads monitor.ts before these are replaced, Node.js throws a module-not-found error at startup — not at the first API call. The container boots, logs a startup error, and silently dies. With Docker health checks looking at HTTP responses, the container may appear healthy (health check not yet reached) while being completely non-functional.

**Why it happens:**
Developers iterate on `standalone.ts` first and only discover monitor.ts SDK coupling when they try to boot the container end-to-end.

**How to avoid:**
Run `grep -r "openclaw/plugin-sdk" src/` before declaring "decoupled." The full list of affected files is: `channel.ts`, `inbound.ts`, `config-schema.ts`, `accounts.ts`, `monitor.ts`, `normalize.ts`. Create local implementations with identical function signatures. Keep original files untouched — the OpenClaw plugin must continue to work.

**Warning signs:**
- `Cannot find module 'openclaw/plugin-sdk/webhook-ingress'` in container logs
- Health endpoint responds but admin panel routes 500

**Phase to address:** Phase 1 (Core Extraction)

---

### Pitfall 3: MCP SSE transport is deprecated — building on a dead spec

**What goes wrong:**
The PRD specifies "SSE transport for remote (cloud deployment)." The MCP specification was updated on 2025-03-26 to deprecate standalone SSE transport. The TypeScript SDK version 1.10.0+ (April 2025) uses Streamable HTTP as the primary remote transport. Building the MCP server on the legacy SSE transport means it will not connect to current Claude Code builds, requires two endpoints (GET `/sse` + POST `/messages`), and breaks under load balancers (requires sticky sessions).

**Why it happens:**
The PRD was written before the spec change. The old SSE pattern is heavily documented in older tutorials and still appears to "work" in local testing with pinned SDK versions.

**How to avoid:**
Use Streamable HTTP transport (single POST endpoint `/mcp`, can optionally upgrade to SSE stream per-request). The `@modelcontextprotocol/sdk` npm package supports both — use `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`. Keep the legacy SSE endpoint as a fallback for older clients, but make Streamable HTTP the primary path.

**Warning signs:**
- Claude Code (latest) fails to connect to the MCP server
- Error: `SSE endpoint deprecated` in MCP client logs
- Works locally with pinned SDK but fails in production

**Phase to address:** Phase 3 (MCP Server)

---

### Pitfall 4: SQLite WAL mode corruption on Docker volume mounts

**What goes wrong:**
The existing codebase uses SQLite WAL mode (enabled in `directory.ts` and `mimicry-gate.ts`) which creates `.wal` and `.shm` sidecar files. When the SQLite file lives on a Docker named volume mounted over a network filesystem (NFS, certain cloud storage backends), WAL mode corrupts the database. The container reports startup success, the admin panel loads, but write operations silently fail or return `SQLITE_IOERR`.

**Why it happens:**
WAL mode requires OS-level file locking primitives that don't work correctly over networked filesystems. Local volumes on the same Docker host are fine. The problem only surfaces in cloud deployments (ECS, Fly.io, Railway) where volumes are not local block storage.

**How to avoid:**
In the Dockerfile, document that the data volume MUST be backed by local block storage (not EFS, not GCS FUSE). Add a startup check that writes a test row and reads it back — fail fast if WAL is broken. Use a local named volume in Docker Compose. For cloud deployments, document using Fly.io volumes (local NVMe) or EBS, not shared filesystems.

**Warning signs:**
- `SQLITE_IOERR_SHORT_READ` in container logs
- `.shm` file missing after container restarts
- Admin panel directory tab loads empty despite data existing before restart

**Phase to address:** Phase 1 (Core Extraction — Dockerfile design)

---

### Pitfall 5: Multi-tenant SQLite file leakage via path traversal in workspaceId

**What goes wrong:**
If workspace IDs are user-supplied and used directly in file paths like `~/.chatlytics/workspaces/{workspaceId}/directory.db`, a malicious workspace ID of `../../admin` or `../other-tenant` allows reading or writing another tenant's database.

**Why it happens:**
Path construction looks like `path.join(baseDir, workspaceId, 'directory.db')` — which `path.join` sanitizes partially but does NOT prevent `../` traversal if `workspaceId` contains them.

**How to avoid:**
Always generate workspace IDs as UUIDs internally (never accept them from user input for path construction). Validate with `/^[a-z0-9-]{36}$/` before constructing any file path. Use `path.resolve()` and verify the resolved path starts with the expected base directory — reject if not. This is a single 3-line check that prevents a critical multi-tenant isolation breach.

**Warning signs:**
- Workspace IDs accepted from user-facing registration forms without validation
- `path.join(baseDir, req.body.workspaceId, ...)` pattern anywhere in onboarding code

**Phase to address:** Phase 6 (Multi-Tenant) — but the validation pattern must be established in Phase 1 so it is never accidentally skipped

---

### Pitfall 6: OpenClaw plugin regression from "thin wrapper" refactor

**What goes wrong:**
The PRD's Phase 7 goal is to refactor the OpenClaw plugin as a "thin wrapper that delegates to Chatlytics API." This is the highest-regression-risk operation in the entire roadmap. The current plugin has 50+ phases of battle-tested logic, 594 passing tests, and DO NOT CHANGE markers throughout. A thin wrapper that calls the HTTP API introduces: network latency on every action, error serialization differences (WAHA API errors vs HTTP errors), and loss of in-process optimizations like the 30s TTL cache for name resolution.

**Why it happens:**
The "thin wrapper" pattern seems clean architecturally. But the OpenClaw gateway's `handleAction()` is called synchronously, and the current plugin can resolve a target and call WAHA in <50ms in-process. Adding an HTTP round-trip to the wrapper makes every action take 100-300ms minimum, which the gateway may timeout on complex actions.

**How to avoid:**
Do NOT refactor the OpenClaw plugin to thin-wrapper until the Chatlytics API has proven itself in production for at least 30 days. Keep the plugin as-is (running its own embedded logic) as the primary deployment. Mark Phase 7 "thin wrapper" explicitly as "optional, post-stability." The plugin's existing test suite (594 tests) is the regression guard: if any test fails after the wrapper refactor, stop.

**Warning signs:**
- Action response times increase from <100ms to >300ms after wrapper refactor
- `does not accept a target` errors reappear (target resolution moved to HTTP layer, gateway timing differs)
- Tests pass but live agent stops responding to group messages

**Phase to address:** Phase 7 (Distribution) — explicitly blocked until Phase 2-4 prove Chatlytics API stability

---

### Pitfall 7: Webhook forwarding retry storms on slow consumer endpoints

**What goes wrong:**
The webhook forwarder retries failed deliveries with exponential backoff. If a consumer's endpoint is slow (responds in 8s+) rather than down, the retry queue fills with "in-flight" requests that haven't timed out yet. Each new inbound WhatsApp message adds another delivery attempt. At 100 messages/hour to a slow consumer, the queue grows unboundedly and memory usage climbs until the process crashes.

**Why it happens:**
Retry logic was designed for "endpoint is down" (connection refused, 5xx). Slow endpoints that eventually return 200 exhaust the timeout budget, causing the next retry to start before the previous one completes.

**How to avoid:**
Per-tenant bounded delivery queue (max 500 items). Per-endpoint circuit breaker: after 5 consecutive timeouts, mark the endpoint as "degraded" and stop retrying until a health check succeeds. Delivery timeout of 10s (AbortController) — distinct from the retry schedule. Log delivery failures prominently in the admin panel so operators can see endpoint health.

**Warning signs:**
- Memory climbing steadily after a consumer endpoint slows down
- Delivery queue depth growing in metrics
- Process restart resolves the issue (confirms unbounded queue)

**Phase to address:** Phase 4 (Webhook Forwarding)

---

### Pitfall 8: QR code session pairing race — two tenants claim the same WAHA session

**What goes wrong:**
In a shared WAHA instance (one WAHA for all tenants), provisioning a new session for a tenant involves: (1) call WAHA to create session, (2) poll for QR code, (3) display QR in dashboard. If two tenants are onboarding simultaneously and the session name derivation has a collision, WAHA creates one session and the second request silently reuses it. Tenant B scans the QR and gets connected to Tenant A's session slot.

**Why it happens:**
WAHA session names are strings. If the name already exists, WAHA returns 200 and the existing session — it does not error. The tenant isolation model breaks silently.

**How to avoid:**
Session names MUST be globally unique and include a collision-resistant component: `ctl_{workspaceId}_{randomSuffix}`. Verify after creation that the returned session name matches exactly what was requested. Store the WAHA session name in the workspace record and re-verify on every QR poll. Add a uniqueness constraint on session names in the workspace database.

**Warning signs:**
- Two users in onboarding see the same QR code
- Session health shows correct but messages route to wrong workspace
- WAHA `/sessions` list shows fewer sessions than expected workspace count

**Phase to address:** Phase 5 (Dashboard + Onboarding) / Phase 6 (Multi-Tenant)

---

### Pitfall 9: WAHA webhook self-registration skipped in standalone mode

**What goes wrong:**
Currently, OpenClaw registers WAHA webhooks automatically when the plugin loads. In standalone mode, nothing does this. If `standalone.ts` doesn't call `POST /api/{session}/webhooks` on startup to register its own callback URL, no inbound messages are delivered — silently. The webhook server starts fine, health endpoint responds, but the platform never receives any WhatsApp events.

**Why it happens:**
The developer tests standalone.ts by sending outbound messages (which work immediately) and assumes inbound is also working. Inbound only breaks on the first real incoming message, which may not happen during a brief smoke test.

**How to avoid:**
`standalone.ts` startup sequence must include: (1) start HTTP server, (2) register webhook URL with WAHA for each configured session, (3) verify registration by reading back `/api/{session}/webhooks`. Make this a hard startup step, not a background task. Log the registered webhook URL on startup. Add a `/api/v1/health` endpoint that includes `webhook_registered: true/false` in its response.

**Warning signs:**
- Outbound send works, but inbound messages never appear in logs
- WAHA webhook list is empty after container start

**Phase to address:** Phase 1 (Core Extraction)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hand-written OpenAPI YAML only, no validation in CI | Faster initial spec creation | Spec drifts from implementation within 2 weeks of first bug fix | Never — add `spectral lint` to CI in Phase 2 |
| Single SQLite file for all tenants in v2.0-alpha | No file management complexity | Impossible to migrate to per-tenant when multi-tenant launches | Never — always use per-workspace paths even for single-tenant v2.0 |
| Reuse existing admin API key for standalone mode | No auth work needed initially | Exposes internal key to public API surface | Acceptable for Phase 1 local dev only — add `ctl_` keys before any external exposure |
| Skip HMAC on outbound webhooks for v2.0-alpha | Simpler initial implementation | Consumers cannot verify payload authenticity | Never if the spec says webhooks ship in Phase 4 — include HMAC from day one |
| Keep `jiti` runtime for standalone TypeScript execution | Avoids build step, matches existing plugin workflow | Cold start adds 2-3s, jiti cache bugs persist, unsuitable for Docker production | Acceptable for local dev only — compile with `tsx` or `tsc` in Docker |
| Process-level singleton for config/DB in standalone.ts | Simple to implement | Breaks multi-tenant isolation — all tenants share one config instance | Never — use constructor injection with workspace-scoped instances from Phase 1 |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP SDK (`@modelcontextprotocol/sdk`) | Use `SSEServerTransport` (legacy) | Use `StreamableHTTPServerTransport` — SSE deprecated 2025-03-26 |
| MCP SDK + existing HTTP server | Create a new Express app for MCP alongside raw `http.createServer` | Mount MCP handler on the same `http.createServer` instance — route by `req.url` prefix |
| WAHA webhooks in standalone mode | Assume WAHA knows the new webhook URL | `standalone.ts` must call `POST /api/{session}/webhooks` on startup to register itself |
| WAHA session listing | Call `/api/sessions` and treat empty as "no sessions" | WAHA returns 400 if NOWEB store is not enabled — check for 400 before treating as empty |
| SQLite + Docker volume | Use WAL mode on any volume | Verify volume is local block storage; add startup write-test; document in README |
| Webhook retry + HMAC | Regenerate HMAC on each retry attempt | Use the ORIGINAL payload bytes + ORIGINAL timestamp in the signature — regenerating changes it |
| API key middleware on raw `http` | Parse `Authorization` header as-is | Node.js lowercases headers automatically; strip `Bearer ` prefix; trim whitespace before comparison |
| OpenAPI spec + `http.createServer` | Use tsoa/swagger-jsdoc (require Express decorators) | Write YAML by hand; validate with `@stoplight/spectral-cli` in CI |
| `better-sqlite3` + Docker Alpine | Install on host OS, copy to Alpine container | `better-sqlite3` is a native addon — must compile inside the Alpine container or use `linux/amd64` base |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded resolveTarget cache in multi-tenant | Memory climbs with tenant count — each tenant's contacts fill the same cache | Scope the LRU cache by workspaceId, not globally | At ~20 active tenants with large contact lists |
| SQLite write serialization across tenants (shared-process) | High-traffic tenants starve low-traffic ones | File-per-tenant SQLite + separate `better-sqlite3` connection per workspace | At ~5 concurrent high-traffic tenants |
| MCP tool count × description length in context | LLM responses slow down, token costs increase | Keep tool count ≤ 15 for primary MCP tools; group by category | Immediately — tool descriptions injected every request |
| Webhook delivery queue per tenant in memory | Large tenant onboarding dumps hundreds of queued messages — OOM | Persist webhook queue to SQLite for any queue >100 items | At webhook queue depth >500 per tenant |
| WAHA media URL expiration on retry | Media retries after >5 minutes return 404 for the attachment | Download media immediately on first delivery attempt; store locally; use local URL in retries | Every time a media message goes to a slow consumer endpoint |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API key stored unhashed in workspace DB | Database compromise exposes all API keys | Store `sha256(apiKey)` — display full key only on generation, never again |
| HMAC webhook secret same as API key | Rotating the API key invalidates all webhook signatures | Use separate secrets: `ctl_` prefix for API keys, `whsec_` prefix for webhook signing secrets |
| Admin routes accessible without workspace scoping | `GET /api/admin/directory` returns contacts from ALL tenants | Every admin route must extract `workspaceId` from the authenticated request before any DB query |
| WAHA API key embedded in Docker image | Image push to registry exposes credentials | Accept via env var `WAHA_API_KEY` only — never bake into Dockerfile |
| Timing attack on API key comparison | Attacker can brute-force key byte-by-byte via response time | Use `crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(stored))` — never `===` |
| Webhook callback URLs pointing to internal services | Tenant registers `http://localhost:6379` and gets Redis responses | Validate callback URLs: reject `localhost`, `127.x`, `10.x`, `172.16-31.x`, `192.168.x` ranges |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| QR code expires without feedback | User stares at expired QR, thinks onboarding is broken, abandons | Poll WAHA QR endpoint every 20s; show countdown timer; auto-refresh QR before expiry |
| API key shown only once but no copy button | User closes the modal, key is lost forever | Add clipboard copy button + "I've saved this" confirmation checkbox before dismissal |
| Mimicry gate blocks first message with no explanation | New user sends first message, nothing happens — no error, no delay indicator | When mimicry gate blocks, return `queued` status in the API response with `retry_after` timestamp |
| Session disconnects silently | Agent stops responding; user doesn't know until they check dashboard | Email or webhook notification on session disconnect — not just a dashboard indicator |
| OpenAPI spec at a different URL than dashboard | Developers cannot find it | Embed Swagger UI at `/docs` on the same server — one URL to share |

---

## "Looks Done But Isn't" Checklist

- [ ] **SDK Decoupling:** `grep -r "openclaw/plugin-sdk" src/` returns zero results in standalone build — verify before Phase 1 exit
- [ ] **OpenClaw plugin still works:** Run full test suite (`npm test`) after any standalone changes — 594 tests must still pass
- [ ] **WAHA webhook registration:** `standalone.ts` actively registers its webhook URL with WAHA on startup — not just assumes OpenClaw did it
- [ ] **Config migration:** Existing users' `openclaw.json` settings are migrated (or at minimum documented as manual migration) — not silently ignored
- [ ] **MCP transport:** `StreamableHTTPServerTransport` used, not deprecated `SSEServerTransport` — verify by checking `@modelcontextprotocol/sdk` version ≥ 1.10.0
- [ ] **Docker data persistence:** SQLite file is on a named volume — not inside the container layer (lost on every restart)
- [ ] **Multi-tenant isolation:** Every DB query in admin routes has a `WHERE workspace_id = ?` clause — no global queries
- [ ] **Webhook HMAC:** Signatures use `crypto.timingSafeEqual` — not `===`
- [ ] **API key format:** All generated keys use `ctl_` prefix with sufficient entropy (≥ 128 bits) — not sequential IDs
- [ ] **Retry payload integrity:** Webhook retries send the exact same bytes as the original attempt — not re-serialized JSON
- [ ] **MCP tool descriptions:** Total token cost of all tool descriptions is measured — not assumed to be fine
- [ ] **Container health check:** Dockerfile `HEALTHCHECK` probes `/api/v1/health` — not just `CMD node` exit code

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| OpenClaw plugin broken by standalone refactor | HIGH | Revert to pre-refactor commit; apply decoupling changes only to `src/standalone/` copies of affected files; never modify originals |
| SDK symbols removed without logic replacement | HIGH | Restore from `src/inbound.ts.bak.*` backups; add SDK function behavior to a local `src/openclaw-compat.ts` before retry |
| SQLite corruption from WAL on bad volume | MEDIUM | Restore from last `.backup` file; switch volume to local block storage; re-run directory sync |
| Tenant data leak via path traversal | HIGH | Rotate all API keys; audit access logs for cross-tenant file opens; add path validation and redeploy |
| MCP server built on deprecated SSE transport | LOW | Update `@modelcontextprotocol/sdk` to ≥ 1.10.0; swap `SSEServerTransport` for `StreamableHTTPServerTransport`; old SSE endpoint can coexist during transition |
| Webhook retry storm on slow endpoint | MEDIUM | Add per-endpoint circuit breaker; flush in-flight queue by restarting the worker; add bounded queue depth limit before redeploying |
| WAHA webhook not registered on startup | LOW | Add explicit startup registration step to `standalone.ts`; add health check flag `webhook_registered` |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| inbound.ts SDK decoupling without logic replacement | Phase 1: Core Extraction | All 594 existing tests pass; send a test WhatsApp message and verify agent response |
| monitor.ts SDK imports cause container boot failure | Phase 1: Core Extraction | `docker run` starts with zero `openclaw/plugin-sdk` module errors in logs |
| WAHA webhook not self-registered on startup | Phase 1: Core Extraction | Health endpoint reports `webhook_registered: true`; send a WhatsApp message and see it in logs |
| MCP SSE transport deprecated | Phase 3: MCP Server | Claude Code connects and calls `send_message` tool successfully |
| SQLite WAL corruption on Docker volume | Phase 1: Core Extraction (Dockerfile) | Container restarts 5x with data volume mounted; all data persists; no SQLITE_IOERR |
| Multi-tenant path traversal in workspaceId | Phase 6: Multi-Tenant | Register workspace ID `../../admin` — verify 400 rejection |
| OpenClaw thin-wrapper regression | Phase 7: Distribution (blocked) | 594 tests pass after wrapper refactor; live agent test passes |
| Webhook retry storm | Phase 4: Webhook Forwarding | Simulate slow consumer (10s response); verify queue depth stays bounded; circuit breaker activates |
| QR session collision in multi-tenant | Phase 5/6: Onboarding + Multi-Tenant | Simulate concurrent onboarding — verify unique session names; verify no cross-tenant session reuse |
| OpenAPI spec drift | Phase 2: Public REST API (CI gate) | `spectral lint openapi.yaml` passes in CI; spec validated against live endpoints |
| API key timing attack | Phase 1: Core Extraction | Code review confirms `crypto.timingSafeEqual` used everywhere key comparison occurs |

---

## Sources

- Direct codebase analysis: `src/monitor.ts` lines 1-41, `src/inbound.ts` lines 1-50 — SDK import audit (HIGH confidence)
- [MCP Transports specification 2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) — SSE deprecation (HIGH confidence)
- [Why MCP Deprecated SSE and Went with Streamable HTTP](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/) — Transport migration rationale (HIGH confidence)
- [SQLite WAL mode permissions in Docker volumes](https://sqlite.org/forum/info/87824f1ed837cdbb) — WAL corruption on networked filesystems (HIGH confidence)
- [How to Run SQLite in Docker 2026](https://oneuptime.com/blog/post/2026-02-08-how-to-run-sqlite-in-docker-when-and-how/view) — Container best practices (MEDIUM confidence)
- [Database-per-Tenant SQLite patterns](https://medium.com/@dmitry.s.mamonov/database-per-tenant-consider-sqlite-9239113c936c) — Multi-tenant isolation trade-offs (MEDIUM confidence)
- [Building Reliable Webhook Delivery 2026](https://dev.to/young_gao/building-reliable-webhook-delivery-retries-signatures-and-failure-handling-40ff) — Retry + HMAC pitfalls (MEDIUM confidence)
- [Webhook Security Best Practices](https://hooque.io/guides/webhook-security/) — HMAC replay prevention (MEDIUM confidence)
- CLAUDE.md + project memory — WAHA quirks, deploy pitfalls, DO NOT CHANGE markers (HIGH confidence, directly verified)

---
*Pitfalls research for: Chatlytics v2.0 — Plugin extraction to standalone multi-tenant SaaS*
*Researched: 2026-03-28*
