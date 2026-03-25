# WAHA OpenClaw Plugin — Skill Research Notes

> Comprehensive architectural reference for skill creation. Generated from full source analysis.

---

## 1. Architecture Flow

```
WhatsApp User
     │
     ▼
WAHA Server (HTTP API, port 3004)
     │ webhook POST
     ▼
monitor.ts — createWahaWebhookServer()
     │ parseWebhookPayload → payloadToInboundMessage
     │ session validation, dedup, event routing
     │ enqueue via InboundQueue (DM priority, bounded)
     ▼
inbound.ts — handleWahaInbound()
     │ pending selection check (shutup flow)
     │ cross-session dedup (bot claims first, human defers 200ms)
     │ media preprocessing (audio transcription, image download)
     │ trigger-word detection, command interception (/shutup, /unshutup)
     │ DM filter + group filter (keyword matching, god mode bypass)
     │ rules-based policy resolution
     │ directory upsert (contact tracking)
     │ module pipeline (registered modules get context)
     │ mention extraction
     │ presence (typing indicator start)
     ▼
OpenClaw Gateway (plugin-sdk)
     │ receives normalized inbound message
     │ LLM processes, decides action
     ▼
channel.ts — handleAction()
     │ action routing: standard → inline handlers, utility → ACTION_HANDLERS map
     │ autoResolveTarget (name → JID fuzzy match)
     │ cross-session routing for groups
     │ Can Initiate enforcement
     ▼
send.ts — sendWaha*() functions
     │ callWahaApi() from http-client.ts (timeout, rate limit, 429 backoff)
     ▼
WAHA Server → WhatsApp
```

### Reply Path (separate from action dispatch)

```
OpenClaw Gateway — conversation reply (text + optional media)
     ▼
channel.ts — outbound.sendText / outbound.sendMedia
     │ uses getCachedConfig() (config cached from last handleAction call)
     ▼
send.ts — sendWahaText / sendWahaMediaBatch
```

OR (for inbound message replies within handleWahaInbound):

```
inbound.ts — deliverWahaReply()
     │ stop typing, send media batch or text
     │ bot proxy prefix for cross-session sends
     ▼
send.ts — sendWahaText / sendWahaMediaBatch
```

**Key insight**: `handleAction` (channel.ts) handles agent TOOL CALLS. `deliverWahaReply` (inbound.ts) handles CONVERSATION RESPONSES. These are completely separate paths.

---

## 2. Plugin SDK Interface

### Entry Point (`index.ts`)

```typescript
const plugin = {
  id: "waha",
  name: "WAHA",
  description: "WAHA (WhatsApp HTTP API) channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWahaRuntime(api.runtime);
    api.registerChannel({ plugin: wahaPlugin });
  },
};
export default plugin;
```

### ChannelPlugin Interface (`channel.ts` — `wahaPlugin`)

The `wahaPlugin` object implements `ChannelPlugin<ResolvedWahaAccount>` with these sections:

| Section | Purpose |
|---------|---------|
| `id` | `"waha"` — must match across openclaw.json, plugin manifest |
| `meta` | Display metadata (label, blurb, order) |
| `pairing` | ID normalization, approval notifications |
| `capabilities` | `chatTypes: ["direct", "group"]`, `reactions: true`, `media: true`, `blockStreaming: true` |
| `messaging.normalizeTarget` | Strips `waha:/whatsapp:/chat:` prefixes |
| `messaging.targetResolver.looksLikeId` | Returns `true` for ALL non-empty strings (accepts names for auto-resolve) |
| `actions` | `wahaMessageActions` adapter (listActions, supportsAction, handleAction) |
| `reload` | `configPrefixes: ["channels.waha"]` |
| `configSchema` | `buildChannelConfigSchema(WahaConfigSchema)` |
| `config` | Account resolution, allow-list management, account CRUD |
| `security` | DM policy, group policy resolution |
| `onboarding` | Setup patch generation for new accounts |
| `outbound` | `deliveryMode: "direct"`, sendText/sendMedia/sendPoll implementations |
| `status` | Runtime state tracking, channel summary |
| `gateway.startAccount` | Starts webhook server, health checks, directory sync, pairing/auto-reply engines |
| `gateway.logoutAccount` | Cleans up API keys |

### ChannelMessageActionAdapter (`wahaMessageActions`)

```typescript
{
  listActions: () => EXPOSED_ACTIONS,  // STANDARD_ACTIONS + UTILITY_ACTIONS (~40 items)
  supportsAction: ({ action }) => EXPOSED_ACTIONS.includes(action) || action in ACTION_HANDLERS,
  handleAction: async ({ action, params, cfg, accountId, toolContext }) => { ... },
}
```

**Return format** for handleAction:
```typescript
// Success:
{ content: [{ type: "text", text: JSON.stringify(result) }], details: {} }
// Error:
{ content: [{ type: "text", text: formatActionError(err, { action, target }) }], isError: true }
```

---

## 3. Action Routing

### Two-tier system

1. **Standard actions** (gateway-recognized, support target resolution):
   `send`, `poll`, `react`, `edit`, `unsend`, `pin`, `unpin`, `read`, `delete`, `reply`

   These have inline handlers in `handleAction()` with `autoResolveTarget()` calls.

2. **Utility actions** (mode "none", no target):
   `sendMulti`, `search`, `readMessages`, `getGroups`, `getContact`, `sendImage`, `sendVideo`, `sendFile`, `muteChat`, etc.

   These are dispatched through the `ACTION_HANDLERS` map (Record<string, handler function>).

### ACTION_HANDLERS Map

Defined at module level in channel.ts (~lines 119-320). Each entry maps an action name to a function:

```typescript
const ACTION_HANDLERS: Record<string, (params, cfg, accountId?) => Promise<unknown>> = {
  sendPoll: (p, cfg, aid) => sendWahaPoll({ ... }),
  sendImage: (p, cfg, aid) => sendWahaImage({ ... }),
  // ... 80+ entries
};
```

### Adding a New Action

1. **Add the send function** in `send.ts`:
   ```typescript
   export async function sendWahaNewThing(params: { cfg: CoreConfig; chatId: string; ... }) {
     const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
     return callWahaApi({ baseUrl, apiKey, path: "/api/newThing", body: { chatId, session, ... } });
   }
   ```

2. **Add handler** in `channel.ts` ACTION_HANDLERS:
   ```typescript
   newThing: (p, cfg, aid) => sendWahaNewThing({ cfg, chatId: String(p.chatId), ... }),
   ```

3. **Expose to LLM** — add to UTILITY_ACTIONS array (if it doesn't need target resolution) or handle inline in handleAction (if it's a standard targeted action).

4. **Document in SKILL.md** — add to the quick reference table and detailed section.

5. **Import** the new function at the top of channel.ts.

### Adding a New Standard Targeted Action

If the gateway's `MESSAGE_ACTION_TARGET_MODE` map already includes the action name:

1. Add an inline `if (action === "newAction")` block in `handleAction()` after the existing standard actions.
2. Use `resolveChatId(p, toolContext)` + `autoResolveTarget()` for target resolution.
3. Add to `STANDARD_ACTIONS` array.

**WARNING**: You CANNOT add new action names to the gateway's target mode map. Only use names the gateway already recognizes.

---

## 4. Config Structure

### Top-level in openclaw.json

```json
{
  "channels": {
    "waha": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:3004",
      "apiKey": "...",
      "session": "3cf11776_logan",
      "webhookPort": 8050,
      "dmPolicy": "allowlist",
      "groupPolicy": "allowlist",
      "allowFrom": ["972544329000@c.us"],
      "groupAllowFrom": ["972544329000@c.us", "271862907039996@lid"],
      "allowedGroups": ["120363421825201386@g.us"],
      "role": "bot",
      "subRole": "full-access",
      "dmFilter": { "enabled": false, "mentionPatterns": [], "godModeBypass": true },
      "groupFilter": { "enabled": true, "mentionPatterns": ["sammie", "bot"] },
      "triggerWord": null,
      "pairingMode": { "enabled": false },
      "autoReply": { "enabled": false },
      "timeoutMs": 30000,
      "rateLimitCapacity": 20,
      "rateLimitRefillRate": 15,
      "healthCheckIntervalMs": 60000,
      "canInitiateGlobal": true,
      "syncIntervalMinutes": 30,
      "accounts": {
        "omer": { "session": "3cf11776_omer", "role": "human", "subRole": "full-access", ... }
      }
    }
  }
}
```

### Config Gotchas

- **POST /api/admin/config expects `{"waha": {...}}` wrapper**, not bare fields.
- **Config save path**: `~/.openclaw/openclaw.json` (NOT workspace subfolder).
- **Sensitive fields preserved on save**: session, apiKey, webhookHmacKey are preserved during config merges in POST handler.
- **Multi-account**: Top-level fields are the default account. Named accounts in `accounts: {}` override.
- **`groupAllowFrom` needs BOTH `@c.us` AND `@lid` JIDs** — NOWEB engine sends `@lid` identifiers.
- **`tools.alsoAllow: ["message"]`** — CRITICAL. The coding tools profile filters out message tool. Without this, actions don't reach the LLM.

### Config Schema (Zod)

Defined in `config-schema.ts`. Key schemas:
- `WahaAccountSchemaBase` — all config fields with defaults
- `WahaAccountSchema` — adds `requireOpenAllowFrom` refinement
- `WahaConfigSchema` — extends base with `accounts` and `defaultAccount`
- `DmFilterSchema` — enabled, mentionPatterns, godModeBypass, godModeScope, godModeSuperUsers, tokenEstimate
- `DmFilterSuperUserSchema` — { identifier, platform?, passwordRequired? }
- `GodModeScopeSchema` — "all" | "dm" | "off"

---

## 5. Monitor (Webhook Server) Architecture

### Server Setup

`createWahaWebhookServer()` creates a Node.js HTTP server that handles:

1. **Webhook POST** at configured path (default `/webhook/waha`)
2. **Admin API** routes under `/api/admin/*`
3. **React admin panel** served from `dist/admin/` (static Vite build)
4. **Health endpoint** at `/healthz`

### Webhook Processing Pipeline

```
POST /webhook/waha
  → HMAC signature verification (if configured)
  → parseWebhookPayload (validate event, session, payload fields)
  → isRegisteredSession check
  → Event type routing:
     - "message" → payloadToInboundMessage → dedup → enqueue
     - "message.any" → only accept fromMe trigger-word messages
     - "message.reaction" → payloadToReaction → dedup
     - "poll.vote" → synthetic inbound message → enqueue
     - "event.response" → synthetic inbound message → enqueue
     - anything else → ignored (200)
```

### Admin API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/stats` | Filter stats, access data, session health |
| GET | `/api/admin/config` | Current WAHA config |
| POST | `/api/admin/config` | Update config (deep merge) |
| POST | `/api/admin/restart` | Gateway restart (process.exit) |
| GET | `/api/admin/health` | Session health status |
| GET | `/api/admin/queue` | Inbound queue stats |
| GET | `/api/admin/logs` | Gateway log viewer (journalctl/file) |
| GET | `/api/admin/directory` | Paginated contact/group listing |
| GET | `/api/admin/directory/resolve` | Batch JID→name resolution |
| GET | `/api/admin/directory/:jid` | Single contact details |
| GET | `/api/admin/directory/:jid/filter` | Per-group filter override |
| PUT | `/api/admin/directory/:jid/filter` | Update per-group filter override |
| PUT | `/api/admin/directory/:jid/settings` | Update DM settings |
| PUT | `/api/admin/directory/:jid/allow-dm` | Toggle DM allow/block |
| POST | `/api/admin/directory/refresh` | Refresh directory from WAHA API |
| GET | `/api/admin/directory/group/:gid/participants` | Group participants |
| PUT | `/api/admin/directory/group/:gid/participants/:pid/:type` | Toggle participant allow |
| PUT | `/api/admin/directory/group/:gid/allow-all` | Bulk allow/block participants |
| GET | `/api/admin/modules` | Module registry listing |

### Adding a New API Route

1. Add the route handler inside `createWahaWebhookServer()` in monitor.ts, BEFORE the catch-all 404.
2. Use `writeJsonResponse()` / `writeWebhookError()` helpers.
3. Use `readBody(req, maxBodyBytes)` for POST/PUT bodies.
4. Access config via `opts.config`, account via `account`, directory via `getDirectoryDb(opts.accountId)`.
5. Pattern for parameterized routes:
   ```typescript
   {
     const m = req.method === "GET" && req.url?.match(/^\/api\/admin\/newroute\/([^/]+)$/);
     if (m) {
       const param = decodeURIComponent(m[1]);
       // ... handler logic ...
       return;
     }
   }
   ```

### React Admin Panel

- Built with Vite + React + shadcn/ui + Tailwind CSS
- Static files served from `dist/admin/` directory
- Two path resolution strategies (local dev vs hpg6 deploy)
- `/admin` serves `index.html`, `/admin/assets/*` serves hashed JS/CSS/fonts
- Cache-Control immutable for hashed assets
- Legacy embedded HTML was removed in Phase 24

---

## 6. Inbound Message Flow (inbound.ts)

### handleWahaInbound() Pipeline

```
1. Early pending selection check (shutup interactive flow)
2. Cross-session message dedup
   - Bot sessions claim immediately
   - Human sessions defer 200ms, skip if bot claimed
3. Pre-check: skip media preprocessing for non-allowed groups
4. Media preprocessing (audio → whisper transcription, image download)
5. Native media pipeline (images → MediaPath for gateway vision)
6. Trigger-word detection (strip prefix, route response)
7. Command interception (/shutup, /unshutup)
8. fromMe skip (unless trigger-word matched)
9. Determine DM vs group context
10. DM filter (keyword matching, god mode bypass)
11. Group filter (per-group overrides, keyword matching)
12. Rules-based policy resolution
13. Pairing mode check (passcode challenge)
14. Auto-reply for unauthorized DMs
15. Directory upsert (track contact, update message count)
16. Module pipeline (registered modules get context)
17. Mention extraction
18. Presence start (typing indicator)
19. Build inbound payload → deliver to OpenClaw gateway
20. On reply: deliverWahaReply() → send text/media back
```

### deliverWahaReply()

Handles outbound delivery for conversation responses:
1. Stop typing indicator
2. If media URLs present: `sendWahaMediaBatch()` with caption
3. If text only: `sendWahaText()`
4. Bot proxy prefix (`🤖`) for cross-session sends
5. Safety net: ensure typing stopped after delivery

### vCard Interception

Lives in `deliverWahaReply` (inbound.ts), NOT in sendWahaText. The `[CONTACT:Name:Phone]` pattern is intercepted before the media/text branch. **DO NOT MOVE** — sendWahaText is not reached for conversation replies that go through deliverWahaReply.

---

## 7. Send Layer (send.ts)

### Key Patterns

- **`callWahaApi()`** — imported from `http-client.ts`. All WAHA API calls go through this. Provides timeout (AbortController), rate limiting (token bucket), 429 backoff, and structured error logging.
- **`resolveAccountParams(cfg, accountId)`** — resolves session, baseUrl, apiKey for the target account. Calls `assertCanSend()` to prevent listener sessions from sending.
- **`buildFilePayload(url)`** — handles both local files (base64 encode) and HTTP URLs (pass as-is with MIME detection).
- **`resolveMime(url)`** — MIME detection with file-extension fallback, strips query params before extension check.
- **`BOT_PROXY_PREFIX`** — `"🤖"` prepended to text when bot borrows a human session.

### Function Organization (~1600 lines)

- Presence: `sendWahaPresence`, `sendWahaSeen`
- Text: `sendWahaText` (with auto link preview)
- Media: `sendWahaImage`, `sendWahaVideo`, `sendWahaFile`, `sendWahaMediaBatch`
- Rich: `sendWahaPoll`, `sendWahaLocation`, `sendWahaContactVcard`, `sendWahaList`, `sendWahaEvent`, `sendWahaLinkPreview`
- Message management: `editWahaMessage`, `deleteWahaMessage`, `pinWahaMessage`, `unpinWahaMessage`, `starWahaMessage`
- Chat: `getWahaChats`, `deleteWahaChat`, `archiveWahaChat`, `muteWahaChat`, etc.
- Groups: `createWahaGroup`, `getWahaGroups`, `addWahaGroupParticipants`, etc.
- Contacts: `getWahaContacts`, `blockWahaContact`, etc.
- Labels, Status, Channels, Presence, Profile, LID, Calls
- Name resolution: `resolveWahaTarget` (fuzzy search with LRU cache)

### Critical: sendImage/sendVideo/sendFile vs sendWahaMediaBatch

`sendImage`, `sendVideo`, `sendFile` actions MUST call WAHA API directly (via `sendWahaImage`, `sendWahaVideo`, `sendWahaFile`). Do NOT route through `sendWahaMediaBatch` — it does MIME detection which re-routes based on content type, potentially sending an image as a file.

---

## 8. Directory (SQLite via directory.ts)

### DirectoryDb Class

- Uses `better-sqlite3` (CommonJS, loaded via `createRequire`)
- WAL mode, foreign keys enabled
- One DB per account (separate SQLite files)

### Tables

```sql
contacts (jid PK, display_name, first_seen_at, last_message_at, message_count, is_group)
dm_settings (jid PK, mode, mention_only, custom_keywords, can_initiate, updated_at)
allow_list (jid PK, allow_dm, added_at)
group_participants (group_jid + participant_jid PK, display_name, is_admin, allow_in_group, allow_dm, participant_role, updated_at)
group_filter_overrides (group_jid PK, enabled, filter_enabled, mention_patterns, god_mode_scope, trigger_operator, updated_at)
muted_groups (group_jid PK, muted_by, muted_at, expires_at, account_id, dm_backup)
pending_selections (sender_id PK, type, groups, duration_str, timestamp)
lid_mapping (lid PK, cus_jid) — maps @lid JIDs to @c.us JIDs
contact_ttl (jid PK, expires_at, source) — TTL for pairing-granted access
```

### Key Methods

- `upsertContact(jid, name?, isGroup?)` — insert or update contact
- `getContacts({ search?, limit, offset, type? })` — paginated listing
- `getContact(jid)` — single contact with DM settings
- `getDmSettings(jid)` — per-contact DM settings
- `setDmSettings(jid, settings)` — update DM settings
- `getGroupFilterOverride(jid)` — per-group keyword filter override
- `setGroupFilterOverride(jid, data)` — update per-group override
- `resolveLidToCus(lid)` — resolve @lid to @c.us
- `upsertLidMapping(lid, cusJid)` — cache LID→CUS mapping
- `resolveJids(jids[])` — batch JID→name resolution
- `hasReceivedMessageFrom(jid)` — check if contact has sent us a message (for Can Initiate)
- `canInitiateWith(jid, globalDefault)` — check Can Initiate policy

### Important: @lid vs @c.us

WAHA NOWEB engine uses `@lid` (Linked ID) format for identifiers. These are completely different numbers from `@c.us` JIDs. The `lid_mapping` table maps between them. Always check both formats when looking up contacts/allow-lists.

---

## 9. Supporting Modules

| File | Purpose |
|------|---------|
| `accounts.ts` | Multi-account resolution, session listing, cross-session routing |
| `auto-reply.ts` | Canned rejection messages for unauthorized DMs |
| `dedup.ts` | Cross-session message deduplication (claim-based) |
| `dm-filter.ts` | DM/group keyword filter with stats tracking |
| `error-formatter.ts` | Wraps errors with LLM-friendly messages |
| `health.ts` | Periodic WAHA session health checks |
| `http-client.ts` | callWahaApi with timeout, rate limiting, 429 backoff |
| `identity-resolver.ts` | Rules base path resolution |
| `inbound-queue.ts` | Bounded queue with DM priority for inbound messages |
| `media.ts` | Media preprocessing (download, transcription, analysis) |
| `mentions.ts` | @mention extraction from messages |
| `module-registry.ts` | Plugin module registration system |
| `module-types.ts` | Module interface types |
| `normalize.ts` | JID/target normalization, @s.whatsapp.net → @c.us |
| `pairing.ts` | Passcode-gated onboarding for unknown contacts |
| `policy-cache.ts` | LRU cache for policy lookups |
| `policy-edit.ts` | Rules-based policy field edits |
| `policy-enforcer.ts` | Can-send policy enforcement |
| `presence.ts` | Typing indicator management |
| `rate-limiter.ts` | Token bucket rate limiter |
| `rules-*.ts` | WhatsApp rules and policy system |
| `runtime.ts` | OpenClaw runtime access (singleton) |
| `secret-input.ts` | Secret/API key input handling |
| `send.ts` | All WAHA API HTTP calls |
| `shutup.ts` | /shutup and /unshutup command handling |
| `signature.ts` | WAHA webhook HMAC verification |
| `sync.ts` | Background directory sync with WAHA |
| `trigger-word.ts` | Trigger word detection for human sessions |
| `types.ts` | TypeScript type definitions |

---

## 10. Common Pitfalls and Hard-Won Lessons

### Gateway Target Resolution (CRITICAL)

- `MESSAGE_ACTION_TARGET_MODE` is **hardcoded** in the gateway. Plugins CANNOT extend it.
- Only actions in this map can accept targets. Custom names get mode "none" and REJECT targets.
- The plugin code NEVER runs when gateway rejects — error happens before dispatch.
- **Solution**: Use gateway-recognized action names for targeted operations.

### listActions() Must Return Curated List

- v1.8.x bug: returning ALL_ACTIONS (80+ items) broke gateway target resolution.
- Must return only `STANDARD_ACTIONS + UTILITY_ACTIONS` (~40 items).
- Each action costs ~50 tokens in LLM context. Too many degrades response quality.

### looksLikeId Must Accept All Strings

- Returns `true` for ALL non-empty strings. This is intentional.
- Allows human-readable names ("test group") to pass through gateway to handleAction.
- `autoResolveTarget` in handleAction does the actual name→JID resolution.
- **DO NOT revert** to JID-only matching — breaks name-based targeting.

### Config Caching Required

- `readConfigFile()` crashes in outbound adapter context.
- `getCachedConfig()` caches config from handleAction for outbound methods.
- Without this, sendText/sendMedia/sendPoll all fail.

### Two Deploy Locations

- `~/.openclaw/extensions/waha/` — runtime (loaded by gateway)
- `~/.openclaw/workspace/skills/waha-openclaw-channel/` — dev (reinstall source)
- Missing either causes stale code or reinstall overwrites.

### WAHA API Quirks

- `/groups` and `/contacts/lids` return **dict** (keyed by JID), not array — use `Object.values()` / `toArr()`.
- `sendPoll` needs `poll:{}` wrapper object.
- Reaction needs full messageId: `true_chatId_shortId`.
- NOWEB engine drops >95% of poll.vote webhook events.
- Media URLs from WAHA are temporary — download immediately.
- `groupAllowFrom` needs BOTH `@c.us` AND `@lid` JIDs.
- Only process `"message"` webhooks, NOT `"message.any"` (causes duplicates). Exception: `message.any` for fromMe trigger-word messages.
- Contacts API returns 400 without `config.noweb.store.enabled=True`.
- WAHA session PUT API REPLACES entire config — must include ALL fields.

### OpenClaw Platform Rules

- `tools.alsoAllow: ["message"]` — CRITICAL for actions to reach LLM.
- Plugin id must match across: openclaw.plugin.json, plugins.allow[], plugins.entries, plugins.installs.
- Allowed media roots: `/tmp/openclaw/`, `~/.openclaw/media/`, agent media dir.
- Config save path: `~/.openclaw/openclaw.json` (NOT workspace subfolder).
- WAHA API key header: `WHATSAPP_API_KEY` not `WAHA_API_KEY` (401 vs 200).

---

## 11. DO NOT CHANGE Areas (Regression Risks)

These areas have explicit markers and verified-working comments. Changes require reading the full comment block first.

| Location | What | Why |
|----------|------|-----|
| `channel.ts:484` | `listActions: () => EXPOSED_ACTIONS` | Changing to ALL_ACTIONS breaks gateway target resolution |
| `channel.ts:725-731` | `looksLikeId: () => true` | Reverting to JID-only breaks name-based targeting |
| `channel.ts:382-412` | `autoResolveTarget` | Fuzzy name→JID resolution for standard actions |
| `channel.ts:131-136` | sendImage/sendVideo/sendFile handlers | Must call WAHA API directly, NOT through sendWahaMediaBatch |
| `inbound.ts:107-160` | `deliverWahaReply` | vCard interception lives here, not in sendWahaText |
| `inbound.ts:172-198` | Early pending selection check | Must run BEFORE cross-session dedup |
| `inbound.ts:200-237` | Cross-session message dedup | Bot claims first, human defers 200ms |
| `inbound.ts:261-268` | Media preprocessing config passthrough | enabled:false breaks voice transcription |
| `monitor.ts:32-42` | ADMIN_DIST path resolution | Handles two deployment layouts |
| `monitor.ts:319-335` | InboundQueue setup | Bounded queue with DM priority |
| `monitor.ts:1777-1819` | message vs message.any routing | Dedup + trigger-word exception |
| `send.ts:34-47` | `assertCanSend` | Prevents listener sessions from sending |
| `send.ts:50-57` | callWahaApi import | Must stay imported from http-client.ts |
| `directory.ts:46-56` | GroupFilterOverride type | Per-group overrides critical for selective filtering |
| `directory.ts:60-69` | MutedGroup type | Schema critical for /shutup and /unshutup |
| `config-schema.ts` | All `DO NOT REMOVE` fields | Each was added for a specific phase, removal breaks features |

---

## 12. How-To Recipes

### Add a New Admin Tab (React)

1. Create component in `admin/src/components/YourTab.tsx`
2. Add tab to the tab list in `admin/src/App.tsx`
3. Add API route in `monitor.ts` if new data is needed
4. Build: `npm run build:admin`

### Add a New Config Field

1. Add Zod schema field in `config-schema.ts` (with `.optional().default(...)`)
2. Add `DO NOT REMOVE` comment with phase/date
3. Use in the relevant source file via `account.config.newField`
4. Add to admin panel config tab if user-editable
5. Add to `POST /api/admin/config` handler if needed

### Add a New Inbound Event Handler

1. Add event type check in `monitor.ts` webhook handler (before the catch-all)
2. Create synthetic `WahaInboundMessage` from the payload
3. Enqueue via `inboundQueue.enqueue()`
4. Always return 200 (never 500 — WAHA retries cause flood)

### Add a New Module

1. Define module interface in `module-types.ts`
2. Register in `module-registry.ts`
3. Module receives `ModuleContext` with message, account, config
4. Processing happens in the module pipeline step of `handleWahaInbound()`

---

## 13. File Size Reference

| File | Approx Lines | Notes |
|------|-------------|-------|
| `send.ts` | ~1600 | Largest file, all WAHA API calls |
| `channel.ts` | ~1000 | Plugin adapter, action routing |
| `inbound.ts` | ~1100 | Webhook handler, message preprocessing |
| `monitor.ts` | ~1980 | Webhook server, admin API routes |
| `directory.ts` | ~800 | SQLite directory management |
| `config-schema.ts` | ~155 | Zod config schemas |
| `SKILL.md` | ~300 | LLM-facing documentation |

---

## 14. Key Type Definitions

```typescript
// From types.ts
type CoreConfig = { channels?: { waha?: WahaConfigFields & { accounts?: Record<string, WahaAccountFields> } } };
type WahaInboundMessage = {
  messageId: string; timestamp: number; from: string; fromMe: boolean;
  chatId: string; body: string; hasMedia: boolean; mediaUrl?: string;
  mediaMime?: string; participant?: string; replyToId?: string | null;
  source?: string; location?: { latitude?; longitude?; name?; address?; url? };
};
type WahaWebhookEnvelope = { event: string; session: string; payload: Record<string, unknown> };
type WahaReactionEvent = { messageId: string; from: string; fromMe: boolean; participant?: string; reaction: { text: string; messageId: string } };

// From accounts.ts
type ResolvedWahaAccount = {
  accountId: string; name?: string; enabled: boolean; session: string;
  baseUrl: string; apiKey: string; apiKeySource: string;
  role: string; subRole: string; config: WahaAccountConfig;
};
```
