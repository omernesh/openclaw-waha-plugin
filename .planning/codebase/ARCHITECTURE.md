# Architecture

**Analysis Date:** 2026-03-11

## Pattern Overview

**Overall:** Plugin adapter pattern — implements the OpenClaw `ChannelPlugin` interface to bridge WhatsApp (via WAHA HTTP API) into the OpenClaw AI gateway.

**Key Characteristics:**
- Single-plugin architecture: all code lives in one npm package registered with the OpenClaw gateway
- Webhook-driven inbound: an HTTP server receives WAHA webhook events and routes them through OpenClaw's reply pipeline
- Action-dispatch outbound: the gateway calls `handleAction()` with action names, which are dispatched to WAHA REST API functions
- Multi-account support: config supports multiple WAHA sessions under `channels.waha.accounts`
- No database for messages — SQLite only for contact/group directory and DM settings

## Layers

**Plugin Entry (`index.ts`):**
- Purpose: Registers the plugin with the OpenClaw gateway
- Location: `index.ts`
- Contains: Plugin metadata, `register()` hook that sets runtime and registers the channel
- Depends on: `src/channel.ts`, `src/runtime.ts`
- Used by: OpenClaw gateway plugin loader

**Channel Adapter (`src/channel.ts`):**
- Purpose: Core plugin interface — defines capabilities, action routing, config resolution, security policies, outbound delivery
- Location: `src/channel.ts` (763 lines)
- Contains: `wahaPlugin` object (implements `ChannelPlugin`), `ACTION_HANDLERS` map, `handleAction()` dispatch, `autoResolveTarget()`, `listActions()`, outbound `sendText`/`sendMedia`/`sendPoll` adapters
- Depends on: `src/send.ts`, `src/accounts.ts`, `src/normalize.ts`, `src/config-schema.ts`, `src/runtime.ts`, `src/monitor.ts`
- Used by: OpenClaw gateway (via `ChannelPlugin` interface)

**Inbound Processing (`src/inbound.ts`):**
- Purpose: Processes incoming WhatsApp messages — access control, filtering, media preprocessing, OpenClaw reply dispatch
- Location: `src/inbound.ts` (595 lines)
- Contains: `handleWahaInbound()`, `deliverWahaReply()`, DM/group filter integration, directory tracking, presence simulation triggers
- Depends on: `src/send.ts`, `src/media.ts`, `src/dm-filter.ts`, `src/directory.ts`, `src/normalize.ts`, `src/presence.ts`, `src/runtime.ts`
- Used by: `src/monitor.ts` (webhook handler calls `handleWahaInbound`)

**Webhook Server & Admin Panel (`src/monitor.ts`):**
- Purpose: HTTP server that receives WAHA webhooks and serves the admin web UI
- Location: `src/monitor.ts` (2280 lines — largest file, includes embedded HTML/JS for admin panel)
- Contains: Webhook parsing/validation, `monitorWahaProvider()`, admin API routes (`/api/admin/*`), embedded single-page admin UI, `RateLimiter` class, duplicate event detection
- Depends on: `src/inbound.ts`, `src/accounts.ts`, `src/directory.ts`, `src/send.ts`, `src/signature.ts`, `src/types.ts`
- Used by: `src/channel.ts` (`gateway.startAccount` calls `monitorWahaProvider`)

**WAHA API Client (`src/send.ts`):**
- Purpose: All outbound HTTP calls to the WAHA REST API
- Location: `src/send.ts` (1588 lines)
- Contains: `callWahaApi()` (core HTTP client), 60+ exported functions for every WAHA endpoint (send, groups, contacts, channels, labels, status, presence, profile, LID), `assertAllowedSession()` guardrail, `resolveWahaTarget()` fuzzy name resolver
- Depends on: `src/accounts.ts`, `src/normalize.ts`, `src/types.ts`
- Used by: `src/channel.ts`, `src/inbound.ts`, `src/monitor.ts`, `src/presence.ts`

**Media Processing (`src/media.ts`):**
- Purpose: Download and preprocess inbound media (audio transcription via Whisper, image analysis, video analysis, vCard parsing, location, document metadata)
- Location: `src/media.ts` (503 lines)
- Contains: `preprocessInboundMessage()`, `downloadWahaMedia()`, audio/image/video/vCard/document handlers
- Depends on: `src/types.ts`, `src/accounts.ts`
- Used by: `src/inbound.ts`

**Contact Directory (`src/directory.ts`):**
- Purpose: SQLite-backed persistent store for contacts, groups, newsletters, DM settings, group participant allow-lists
- Location: `src/directory.ts` (470 lines)
- Contains: `DirectoryDb` class with tables: `contacts`, `dm_settings`, `allow_list`, `group_participants`
- Depends on: `better-sqlite3` (CommonJS, loaded via `createRequire`)
- Used by: `src/inbound.ts`, `src/monitor.ts`

**Account Resolution (`src/accounts.ts`):**
- Purpose: Multi-account config resolution — determines which WAHA session/API key to use
- Location: `src/accounts.ts` (149 lines)
- Contains: `resolveWahaAccount()`, `listWahaAccountIds()`, `resolveDefaultWahaAccountId()`, API key resolution (env, file, config)
- Depends on: `src/secret-input.ts`, `src/types.ts`
- Used by: `src/channel.ts`, `src/send.ts`, `src/monitor.ts`

**Supporting Modules:**
- `src/normalize.ts` (26 lines): JID/target string normalization, allowlist matching
- `src/dm-filter.ts` (145 lines): Keyword-based message filter with regex cache, stats tracking
- `src/presence.ts` (174 lines): Human-like typing simulation (read delay, typing indicator, pauses)
- `src/config-schema.ts` (85 lines): Zod schemas for plugin configuration
- `src/signature.ts` (29 lines): HMAC-SHA512 webhook signature verification
- `src/secret-input.ts` (19 lines): Re-exports OpenClaw SDK secret input utilities
- `src/runtime.ts` (14 lines): Module-level singleton for OpenClaw `PluginRuntime`
- `src/types.ts` (137 lines): TypeScript type definitions

## Data Flow

**Inbound Message Flow (WhatsApp -> AI Agent):**

1. WAHA sends webhook POST to `src/monitor.ts` HTTP server at configured path (default `/webhook/waha`)
2. `monitor.ts` validates HMAC signature (if configured), parses `WahaWebhookEnvelope`, deduplicates events
3. For `message` events: extracts `WahaInboundMessage` via `payloadToInboundMessage()`, calls `handleWahaInbound()` in `src/inbound.ts`
4. `inbound.ts` runs access control chain: group whitelist -> group keyword filter -> DM policy/pairing -> DM keyword filter -> per-DM settings
5. If message passes filters: preprocesses media (`src/media.ts`), builds `ctxPayload` with formatted envelope
6. Dispatches to OpenClaw reply pipeline via `core.channel.reply.dispatchReplyWithBufferedBlockDispatcher()`
7. AI response delivered back via `deliverWahaReply()` -> `sendWahaText()`/`sendWahaMediaBatch()` in `src/send.ts`

**Outbound Action Flow (AI Agent -> WhatsApp):**

1. OpenClaw gateway calls `handleAction({ action, params, cfg, accountId, toolContext })` in `src/channel.ts`
2. Standard actions (send, poll, react, edit, unsend, pin, unpin, read, delete, reply) are handled inline with `autoResolveTarget()` for name-to-JID resolution
3. Utility/custom actions dispatched via `ACTION_HANDLERS` map to corresponding functions in `src/send.ts`
4. `send.ts` functions call `callWahaApi()` which makes HTTP requests to the WAHA REST API
5. `assertAllowedSession()` guardrail runs on every outbound call to prevent sending as wrong session

**Auto-Reply Flow (gateway outbound adapter):**

1. Gateway calls `outbound.sendText()` / `outbound.sendMedia()` / `outbound.sendPoll()` on `wahaPlugin`
2. These use `getCachedConfig()` (cached from last `handleAction` call) and call `src/send.ts` functions directly
3. Text is chunked via `core.channel.text.chunkMarkdownText()` before sending

**State Management:**
- No in-memory message state; messages are fire-and-forget
- Config cached in module-level `_cachedConfig` variable (set on each `handleAction` call)
- DM filter instances cached per account in module-level `Map<string, DmFilter>`
- Target resolution cache with 30-second TTL in `src/send.ts` (unbounded)
- SQLite directory DB accessed via `getDirectoryDb()` singleton per account
- OpenClaw runtime stored as module-level singleton in `src/runtime.ts`

## Key Abstractions

**ChannelPlugin Interface:**
- Purpose: OpenClaw SDK contract that this plugin implements
- Examples: `src/channel.ts` exports `wahaPlugin: ChannelPlugin<ResolvedWahaAccount>`
- Pattern: Implements `meta`, `capabilities`, `messaging`, `actions`, `config`, `security`, `onboarding`, `outbound`, `status`, `gateway` sections

**ACTION_HANDLERS Map:**
- Purpose: Maps action name strings to async handler functions
- Examples: `src/channel.ts` line 102-235
- Pattern: `Record<string, (params, cfg, accountId?) => Promise<unknown>>` — each handler extracts params, calls `src/send.ts` function, returns result

**callWahaApi:**
- Purpose: Single HTTP client for all WAHA REST API calls
- Examples: `src/send.ts` line 37-70
- Pattern: Accepts `{ baseUrl, apiKey, path, method, body, query }`, returns parsed JSON or text

**DirectoryDb:**
- Purpose: SQLite persistence for contact/group tracking and DM settings
- Examples: `src/directory.ts` — `DirectoryDb` class
- Pattern: Prepared statements, WAL mode, foreign keys, singleton per account via `getDirectoryDb()`

**DmFilter:**
- Purpose: Keyword-based message gate (used for both DM and group filtering)
- Examples: `src/dm-filter.ts` — `DmFilter` class
- Pattern: Regex cache with hash-based invalidation, stats tracking, fail-open on error

## Entry Points

**Plugin Registration (`index.ts`):**
- Location: `index.ts`
- Triggers: OpenClaw gateway loads the plugin at startup
- Responsibilities: Sets runtime singleton, registers channel plugin with gateway

**Webhook Server (`src/monitor.ts` -> `monitorWahaProvider`):**
- Location: `src/monitor.ts`
- Triggers: `gateway.startAccount()` in `src/channel.ts` calls `monitorWahaProvider()`
- Responsibilities: Starts HTTP server, listens for WAHA webhooks, serves admin panel, routes to `handleWahaInbound()`

**Action Handler (`src/channel.ts` -> `handleAction`):**
- Location: `src/channel.ts` line 318-457
- Triggers: OpenClaw gateway dispatches user/agent actions
- Responsibilities: Routes action names to WAHA API calls, resolves targets, returns results

## Error Handling

**Strategy:** Fail-open for filters, fail-loud for API calls. No retry logic (gateway handles retries upstream).

**Patterns:**
- `callWahaApi()` throws on non-OK HTTP responses with status and error text
- `assertAllowedSession()` throws hard errors to prevent sending as wrong WhatsApp session
- `autoResolveTarget()` throws descriptive errors for unresolvable or ambiguous targets
- DM/group filters are fail-open: `try/catch` around filter checks, message passes through on error
- Media preprocessing errors are non-fatal: caught and logged, message proceeds with raw content
- Presence simulation errors are swallowed: `.catch(() => {})` on all typing indicator calls
- Directory tracking is fire-and-forget: errors logged but don't block message processing
- No request timeouts on `fetch()` calls (known gap — all calls can hang indefinitely)

## Cross-Cutting Concerns

**Logging:** Uses OpenClaw `runtime.log?.()` and `runtime.error?.()` throughout. Console.warn used in `monitor.ts` for webhook parse errors. No structured logging framework.

**Validation:** Zod schemas in `src/config-schema.ts` validate plugin configuration. Action parameter validation is manual (type checks + throws in `handleAction`). Webhook payload validation is manual in `parseWebhookPayload()`.

**Authentication:** WAHA API key sent as `x-api-key` header on all outbound calls. Webhook HMAC-SHA512 signature verification (optional) in `src/signature.ts`. Session guardrail (`assertAllowedSession`) blocks sending as non-logan sessions.

**Access Control:** Multi-layer filtering in `src/inbound.ts`: group whitelist -> group keyword filter -> DM policy (pairing/open/closed/allowlist) -> DM keyword filter -> per-contact DM settings (from SQLite directory).

---

*Architecture analysis: 2026-03-11*
