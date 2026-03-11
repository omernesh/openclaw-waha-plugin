# External Integrations

**Analysis Date:** 2026-03-11

## APIs & External Services

**WAHA (WhatsApp HTTP API) - Primary Integration:**
- Purpose: Self-hosted WhatsApp bridge providing REST API + webhooks for sending/receiving messages, managing groups, contacts, channels, labels, presence, and profile.
- Base URL: Configurable via `channels.waha.baseUrl` (default: `http://127.0.0.1:3004`)
- SDK/Client: Custom HTTP client using Node.js native `fetch` in `src/send.ts` via `callWahaApi()` helper
- Auth: `x-api-key` header; key resolved from env var `WAHA_API_KEY`, config file (`apiKeyFile`), or inline config (`apiKey`). Resolution logic in `src/accounts.ts` `resolveWahaApiKey()`.
- Session: Each WAHA session maps to a WhatsApp account. Session ID embedded in API paths (e.g., `/api/{session}/sendText`).
- ~60 wrapper functions in `src/send.ts` covering: messaging, groups, contacts, channels, labels, status/stories, presence, profile, LID resolution, calls.

**WAHA API Endpoints Used (from `src/send.ts`):**
- `/api/sendText`, `/api/sendImage`, `/api/sendVideo`, `/api/sendFile`, `/api/sendVoice` - Outbound messages
- `/api/sendPoll`, `/api/sendLocation`, `/api/sendContactVcard`, `/api/sendLinkPreview` - Rich messages
- `/api/{session}/chats`, `/api/{session}/chats/overview` - Chat listing
- `/api/{session}/chats/{chatId}/messages` - Message history
- `/api/{session}/groups`, `/api/{session}/groups/{groupId}` - Group management
- `/api/{session}/contacts`, `/api/{session}/contacts/{contactId}` - Contact management
- `/api/{session}/channels` - Newsletter/channel management
- `/api/{session}/labels` - Label CRUD
- `/api/{session}/status/text`, `/api/{session}/status/image` - Status/stories
- `/api/{session}/presence` - Online/offline presence
- `/api/{session}/profile` - Profile management
- `/api/{session}/lids` - LID (Linked ID) resolution
- `/api/reaction`, `/api/star` - Message reactions and stars
- `/api/{session}/chats/{chatId}/messages/{messageId}` (PUT/DELETE) - Edit/delete

**OpenAI-Compatible Vision API (Image Preprocessing):**
- Purpose: Analyze inbound images and generate text descriptions for the AI agent
- Endpoint: Configurable via `mediaPreprocessing.image.visionEndpoint` (default: `http://127.0.0.1:4000`)
- Route: `POST /v1/chat/completions` (OpenAI-compatible chat completions format)
- Model: Configurable via `mediaPreprocessing.image.visionModel` (default: `claude-sonnet-4-20250514`)
- Auth: `Authorization: Bearer` header using `mediaPreprocessing.image.visionApiKey` or env var `LITELLM_API_KEY`
- Implementation: `preprocessImage()` in `src/media.ts` (lines 126-181)
- Sends base64-encoded image with prompt "Describe this image concisely in 1-2 sentences"

**Google Gemini API (Video Preprocessing):**
- Purpose: Analyze inbound videos and generate text descriptions for the AI agent
- Endpoints:
  - `POST https://generativelanguage.googleapis.com/upload/v1beta/files` - Upload video file
  - `GET https://generativelanguage.googleapis.com/v1beta/{fileName}` - Poll processing status
  - `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` - Generate description
- Model: Configurable via `mediaPreprocessing.video.geminiModel` (default: `gemini-2.0-flash`)
- Auth: API key passed as `?key=` query parameter; from `mediaPreprocessing.video.geminiApiKey` or env var `GEMINI_API_KEY`
- Implementation: `preprocessVideo()` in `src/media.ts` (lines 195-254)
- Max video size: 20MB

**Whisper Transcription (Audio Preprocessing):**
- Purpose: Transcribe inbound voice messages to text for the AI agent
- Method: Invokes a local Python script via `execFile`
- Script: Configurable via `mediaPreprocessing.audio.whisperScript` (default: `/home/omer/.openclaw/workspace/scripts/transcribe.py`)
- Python: `/home/omer/.openclaw/venv/bin/python3`
- Timeout: 120 seconds
- Implementation: `preprocessAudio()` in `src/media.ts` (lines 105-120)

**OpenClaw Gateway (Host Platform):**
- Purpose: AI agent framework that loads this plugin, routes messages, manages conversations
- Interface: Plugin SDK types (`ChannelPlugin`, `PluginRuntime`, `ChannelMessageActionAdapter`)
- Location: `/usr/lib/node_modules/openclaw/dist/` on hpg6 (read-only, not ours)
- Interaction: Plugin registers via `api.registerChannel()` in `index.ts`. Gateway calls `handleAction()` for outbound and delivers inbound via the webhook pipeline.

## Data Storage

**Databases:**
- SQLite via `better-sqlite3` (`src/directory.ts`)
  - Purpose: Contact/group/newsletter directory with DM settings, allow lists, group participant tracking
  - Location: `~/.openclaw/extensions/waha/data/directory.db` (created at runtime)
  - Tables: `contacts`, `dm_settings`, `allow_list`, `group_participants`
  - Configuration: WAL journal mode, foreign keys enabled
  - Client: `DirectoryDb` class wrapping raw `better-sqlite3` prepared statements

**File Storage:**
- Local filesystem only
  - Temp media: `/tmp/openclaw/waha-media-*` (downloaded inbound media for preprocessing, cleaned up after use)
  - Config: `~/.openclaw/openclaw.json` (read/write for admin panel config updates)
  - SQLite DB: Created in plugin data directory

**Caching:**
- In-memory only, no external cache service
  - Target resolution cache: `Map` with 30-second TTL in `src/channel.ts` (name-to-JID fuzzy matching results)
  - DM filter instances: `Map<string, DmFilter>` keyed by account ID in `src/inbound.ts`
  - Group filter instances: `Map<string, DmFilter>` keyed by account ID in `src/inbound.ts`
  - Regex cache: Compiled patterns cached inside `DmFilter` class (`src/dm-filter.ts`)

## Authentication & Identity

**WAHA API Auth:**
- `x-api-key` header on all WAHA REST API calls
- Key resolution priority (in `src/accounts.ts` `resolveWahaApiKey()`):
  1. `WAHA_API_KEY` environment variable (for default account)
  2. `apiKeyFile` - Read key from file path
  3. `apiKey` inline in config (string or secret input object with `source: "env" | "file" | "exec"`)
- Secret input schema supports structured secrets: `{ source: "env" | "file" | "exec", provider: string, id: string }`

**Webhook Signature Verification:**
- HMAC-SHA512 signature verification on inbound webhooks (`src/signature.ts`)
- Secret: `webhookHmacKey` in config (string or secret input)
- Headers checked: `x-webhook-hmac` (signature), `x-webhook-hmac-algorithm` (defaults to `sha512`)
- Accepts hex or base64 encoded signatures, with or without `sha512=` prefix
- Uses `crypto.timingSafeEqual` for constant-time comparison

**Session Guardrail:**
- Hard-coded safety check in `src/send.ts` `assertAllowedSession()`
- Blocks `omer` and `*_omer` sessions from sending (prevents bot impersonation)
- Only allows `logan` and `*_logan` sessions
- Called before every outbound WAHA API request

**DM/Group Access Control:**
- `dmPolicy`: `"pairing" | "open" | "closed" | "allowlist"` - Controls who can DM the bot
- `groupPolicy`: `"allowlist" | "open" | "closed"` - Controls which groups the bot responds in
- `allowFrom` / `groupAllowFrom` / `allowedGroups` - JID-based allow lists
- DM filter (`src/dm-filter.ts`): Keyword-based filtering with god mode bypass for super users

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, etc.)
- Errors logged to stdout/stderr via `console.warn` and `console.error`

**Logs:**
- `console.log` / `console.warn` / `console.error` with `[waha]` prefix throughout
- Captured by systemd journal: `journalctl --user -u openclaw-gateway`
- No structured logging framework

**Admin Panel (Web UI):**
- Built-in web dashboard served by webhook HTTP server (`src/monitor.ts`)
- Available at webhook host:port (default: `http://0.0.0.0:8050`)
- Tabs: Directory (contacts/groups), Config, Filter Stats, Status
- All frontend code embedded as HTML/JS strings in `src/monitor.ts`

## CI/CD & Deployment

**Hosting:**
- Self-hosted Linux server (hpg6) via Tailscale VPN
- systemd user service: `openclaw-gateway`

**CI Pipeline:**
- None (no GitHub Actions, no automated tests)

**Deployment Process (Manual):**
1. Edit source on Windows dev machine
2. `npm publish --access public` to npm registry
3. SCP files to TWO locations on hpg6:
   - `~/.openclaw/extensions/waha/` (runtime)
   - `~/.openclaw/workspace/skills/waha-openclaw-channel/` (workspace copy)
4. `systemctl --user restart openclaw-gateway`
5. Manual testing via WhatsApp

**npm Registry:**
- Package: `waha-openclaw-channel`
- User: `omernesh`
- Access: public

## Environment Configuration

**Required env vars for full functionality:**
- `WAHA_API_KEY` - WAHA REST API authentication (can alternatively use config file `apiKey`)

**Optional env vars:**
- `LITELLM_API_KEY` - Vision API for image preprocessing
- `GEMINI_API_KEY` - Google Gemini for video preprocessing

**Config file (required):**
- `~/.openclaw/openclaw.json` - Must contain `channels.waha` section with at minimum `baseUrl` and `session`

## Webhooks & Callbacks

**Incoming (WAHA to Plugin):**
- HTTP server started by `monitorWahaProvider()` in `src/monitor.ts`
- Default endpoint: `POST http://0.0.0.0:8050/webhook/waha`
- Events processed: `message` (inbound messages), `message.reaction` (emoji reactions)
- Events ignored: `message.any` (to avoid duplicates), all others
- Body limit: 1MB default (`DEFAULT_WEBHOOK_MAX_BODY_BYTES`)
- Body timeout: 30 seconds (`DEFAULT_WEBHOOK_BODY_TIMEOUT_MS`)
- Optional HMAC-SHA512 signature verification
- Rate limiter: Custom `RateLimiter` class with configurable max concurrency and delay

**Health Check:**
- `GET /healthz` - Returns 200 OK when webhook server is running

**Admin API (served on same port):**
- `GET /api/admin/stats` - Filter statistics
- `GET/POST /api/admin/config` - Plugin configuration read/write
- `POST /api/admin/restart` - Gateway restart trigger
- `GET /api/admin/sessions` - WAHA session health
- `GET /api/admin/directory` - Contact/group listing (paginated, filterable)
- `GET /api/admin/directory/:jid` - Single contact details
- `PUT /api/admin/directory/:jid/settings` - Update DM settings
- `PUT /api/admin/directory/:jid/allow-dm` - Toggle DM allow/block
- `POST /api/admin/directory/refresh` - Refresh directory from WAHA API
- `GET /api/admin/directory/group/:groupJid/participants` - Group participant listing
- `PUT /api/admin/directory/group/:groupJid/participants/:participantJid/:type` - Toggle participant settings
- `PUT /api/admin/directory/group/:groupJid/allow-all` - Bulk allow/block all participants

**Outgoing:**
- None. Plugin does not send webhooks to external services.

## Integration Architecture Diagram

```
                    WhatsApp
                       |
                    WAHA Docker
                   (REST + Webhooks)
                    /          \
          Webhooks /            \ REST API
                  v              v
        src/monitor.ts      src/send.ts
        (HTTP server)      (API client)
              |                  |
              v                  v
        src/inbound.ts     src/channel.ts
        (msg processing)   (action routing)
              |                  |
              +--------+---------+
                       |
                 OpenClaw Gateway
                 (Plugin Host)
                       |
                   AI Agent
                  (gpt-5.3-codex)
                       |
              +--------+---------+
              |        |         |
         Vision API  Gemini   Whisper
         (LiteLLM)   (Google)  (local)
```

---

*Integration audit: 2026-03-11*
