# OpenClaw WAHA Plugin -- Developer Reference

**Plugin ID:** `waha`
**Platform:** WhatsApp (via WAHA HTTP API)
**Last updated:** 2026-03-10
**Version:** 1.9.2

## Changelog

### v1.9.2 (2026-03-10) -- Fix: Image Analysis via Native Pipeline
- **Bug fix**: Images sent via WhatsApp were not being analyzed by Sammie. Root cause: `downloadWahaMedia()` saved temp files to `/tmp/waha-media-*` which is outside OpenClaw's allowed media path roots (`/tmp/openclaw/`). The native `applyMediaUnderstanding()` pipeline silently rejected these paths.
- **Fix in media.ts**: Changed download path to `/tmp/openclaw/waha-media-*` with `mkdir` recursive to ensure the directory exists.
- **Fix in inbound.ts**: For image messages, downloads the image from WAHA and passes it as `MediaPath`/`MediaPaths`/`MediaTypes` on the context payload, letting OpenClaw's native media-understanding pipeline analyze it (same pipeline Telegram uses). Previously, the plugin called LiteLLM vision API directly which failed with 401 (no API key in systemd env).
- Audio transcription (local Whisper) unchanged and working correctly.

### v1.9.1 (2026-03-10) -- Fix: Voice Transcription Disabled by Config
- **Bug fix**: `mediaPreprocessing.enabled` was `false` in openclaw.json, silently disabling ALL media preprocessing (voice transcription, image analysis, video analysis, location resolution, vCard parsing, document analysis)
- Voice messages were passed through as raw media URLs, causing the agent to reply "can't transcribe audio"
- Added DO NOT CHANGE warnings to `media.ts` and `inbound.ts` around the preprocessing master switch and config passthrough
- Root cause: `enabled: false` is a master kill switch that overrides all individual sub-toggles (`audioTranscription`, `imageAnalysis`, etc.)
- **Config requirement**: `channels.waha.mediaPreprocessing.enabled` MUST be `true` for any media processing to occur

### v1.9.0 (2026-03-10) -- BREAKING: Action Names Fix
- **BREAKING**: `listActions()` now returns only gateway-standard names (send, poll, react, edit, unsend, pin, unpin, read, delete, reply) plus curated utility actions
- Custom WAHA action names (sendPoll, editMessage, etc.) were rejected by gateway's MESSAGE_ACTION_TARGET_MODE
- Added `messaging.targetResolver` to recognize WAHA JID formats (@c.us, @g.us, @lid, @s.whatsapp.net, @newsletter)
- Added `messaging.normalizeTarget` to strip waha:/whatsapp:/chat: prefixes
- Fixed poll chatId fallback chain: params.to -> params.chatId -> toolContext.currentChannelId
- Fixed send.ts session guardrail (was hardcoded to logan-only, now blocks only omer)
- Removed stale backup files from production
- Added DO NOT CHANGE warnings throughout critical code sections
- **Verified actions**: send DM, poll, react, edit, unsend, getGroups, sendLocation (sendEvent fails -- NOWEB limitation)

### v1.8.0--v1.8.7 (2026-03-08--09)
- v1.8.0: Added messaging.targetResolver for JID recognition
- v1.8.2: Fixed poll chatId fallback, directory name resolution
- v1.8.3--v1.8.5: Directory fixes (WAHA dict->array, LID dedup, newsletter names, rate limiter)
- v1.8.6: Fixed duplicate webhook processing (message vs message.any)
- v1.8.7: Fixed config save path, admin panel verified (all 4 tabs working)

### v1.4.0 (2026-03-08)
- **Typing indicator bug fix:** Inline flicker loop in `startHumanPresence` now guarantees `typing: false` on loop exit, eliminating lingering "typing..." state after message delivery. Added 100ms drain delay after `flickerPromise` to prevent race condition on final stop signal.
- **Admin GUI -- Media Preprocessing toggles:** New "Media Preprocessing" section in Settings tab with master toggle and independent sub-toggles for audio transcription, image analysis, video analysis, location resolution, vCard parsing, and document analysis.
- **Admin GUI -- Dynamic WAHA session picker:** Connection section now has a dropdown populated from `GET /api/admin/sessions` (proxies to WAHA `/api/sessions/`), replacing the read-only session text field.
- **Admin GUI -- Directory Refresh button:** Directory tab now has "Refresh from WAHA" button that calls `POST /api/admin/directory/refresh`, bulk-importing all contacts and groups from WAHA API into the local SQLite directory.
- **Poll Handling & Event Handling:** Displayed as "Automatic (built-in)" in the Features section -- no user configuration needed.
- **New API endpoints:** `GET /api/admin/sessions`, `POST /api/admin/directory/refresh`.
- **`bulkUpsertContacts()`:** New method on `DirectoryDb` for transactional batch upsert.

---

## 1. Overview

This plugin bridges OpenClaw AI agents to WhatsApp through the WAHA (WhatsApp HTTP API) server. It enables the "Sammie" bot to receive WhatsApp messages via webhook, route them through OpenClaw's AI agent pipeline, and deliver replies back through WAHA -- including text responses and TTS-generated voice notes.

The plugin operates as a channel adapter within the OpenClaw plugin-sdk framework. It:

- Runs an HTTP webhook server to receive inbound WAHA events
- Applies access control (DM policy, group allowlists with both `@c.us` and `@lid` JID formats)
- Simulates human-like presence (read receipts, typing indicators with random pauses) before replying
- Delivers AI-generated text and voice replies through WAHA's REST API
- Enforces session guardrails (the "omer" session is explicitly blocked from sending outbound messages)
- Exposes only gateway-standard action names (v1.9.0+) for reliable LLM tool invocation

---

## Critical Configuration

This plugin requires specific OpenClaw configuration to function. See [SETUP_AND_TROUBLESHOOTING.md](docs/SETUP_AND_TROUBLESHOOTING.md) for the complete guide.

**Minimum required in openclaw.json:**
- `plugins.allow: ["waha"]` -- plugin ID must match `openclaw.plugin.json` id
- `tools.alsoAllow: ["message"]` -- **CRITICAL** -- without this, the coding tools profile filters out the `message` tool, so the LLM cannot invoke any actions
- `channels.waha.session` -- must be the outbound session (logan), not inbound (omer)
- `channels.waha.apiKey` -- use `WHATSAPP_API_KEY` env var (not `WAHA_API_KEY`)

**Action names (v1.9.0):**
- `listActions()` returns only gateway-standard names: `send`, `poll`, `react`, `edit`, `unsend`, `pin`, `unpin`, `read`, `delete`, `reply`, plus curated utility actions
- Custom WAHA names (sendPoll, editMessage, etc.) are rejected by the gateway's `MESSAGE_ACTION_TARGET_MODE` map and must NOT be used

---

## Verified Actions (v1.9.0)

Test results from manual verification on 2026-03-10:

| Action | Status | Notes |
|--------|--------|-------|
| send (DM) | PASS | Text message to individual chat |
| poll | PASS | Create poll in group or DM. chatId fallback: params.to -> params.chatId -> toolContext.currentChannelId |
| react | PASS | Emoji reaction on message. Requires full messageId (`true_chatId_shortId`) |
| edit | PASS | Edit previously sent message |
| unsend | PASS | Delete/unsend a message |
| getGroups | PASS | List groups via WAHA API |
| sendLocation | PASS | Send GPS coordinates |
| sendEvent | FAIL | WAHA NOWEB engine limitation -- endpoint not available in WAHA 2026.3.2 |
| pinMessage | FAIL | Endpoint not available in WAHA 2026.3.2 NOWEB |
| sendTextStatus | FAIL | Endpoint not available in WAHA 2026.3.2 NOWEB |

---

## 2. File Listing

| File | Lines | Description |
|------|-------|-------------|
| `channel.ts` | ~340 | Channel plugin registration and lifecycle. Exports the `ChannelPlugin` definition with metadata, capabilities (reactions, media, markdown), account resolution, and outbound delivery adapter. Wires up the webhook monitor, inbound handler, and send functions. |
| `inbound.ts` | ~380 | Inbound message handler. Receives parsed `WahaInboundMessage` from the monitor, applies DM/group access control via `resolveDmGroupAccessWithCommandGate`, runs the DM keyword filter, starts the human presence simulation, dispatches the message to the AI agent, and delivers the reply. |
| `dm-filter.ts` | ~145 | DM keyword filter. `DmFilter` class with regex caching, god mode bypass for super-users, and stats tracking (dropped/allowed/tokensEstimatedSaved). Fail-open: any error allows messages through. |
| `send.ts` | ~250 | WAHA REST API wrappers. Provides `sendWahaText()`, `sendWahaMediaBatch()`, `sendWahaReaction()`, `sendWahaPresence()`, `sendWahaSeen()`, and the internal `callWahaApi()` HTTP client. Includes `assertAllowedSession()` guardrail (blocks omer session), `buildFilePayload()` for base64 encoding of local TTS files, and `resolveMime()` for MIME type detection with file-extension fallback. |
| `presence.ts` | ~170 | Human mimicry presence system. Implements the 4-phase presence simulation: seen, read delay, typing with random pauses (flicker), and reply-length padding. Exports `startHumanPresence()` which returns a `PresenceController` with `finishTyping()` and `cancelTyping()` methods. |
| `types.ts` | ~130 | TypeScript type definitions. Defines `CoreConfig`, `WahaChannelConfig`, `WahaAccountConfig`, `PresenceConfig`, `DmFilterConfig`, `WahaWebhookEnvelope`, `WahaInboundMessage`, `WahaReactionEvent`, and `WahaWebhookConfig`. |
| `config-schema.ts` | ~86 | Zod validation schema for the `channels.waha` config section. Validates all account-level and channel-level settings including secret inputs, policies, presence parameters, DM filter config, and markdown options. |
| `accounts.ts` | ~140 | Multi-account resolution. Resolves which WAHA account (baseUrl, apiKey, session) to use for a given operation. Supports a default account plus named sub-accounts under `channels.waha.accounts`. Handles API key resolution from env vars, files, or direct strings. |
| `normalize.ts` | ~30 | JID normalization utilities. `normalizeWahaMessagingTarget()` strips `waha:`, `whatsapp:`, `chat:` prefixes. `normalizeWahaAllowEntry()` lowercases for allowlist comparison. `resolveWahaAllowlistMatch()` checks if a sender JID is in the allowlist (supports `*` wildcard). |
| `monitor.ts` | ~506 | Webhook HTTP server, health monitoring, and admin panel. Starts an HTTP server on the configured port (default 8050). Handles `/healthz`, `/admin` (HTML dashboard), `/api/admin/stats` (JSON stats), and the main webhook path. Validates HMAC signatures and dispatches inbound events. Only processes `message` events (not `message.any`) to prevent duplicate webhook processing. |
| `runtime.ts` | ~15 | Runtime singleton access. `setWahaRuntime()` / `getWahaRuntime()` store and retrieve the OpenClaw `PluginRuntime` instance for use across modules. |
| `signature.ts` | ~30 | HMAC webhook verification. `verifyWahaWebhookHmac()` validates the `X-Webhook-Hmac` header using SHA-512, accepting hex or base64 signature formats. Uses `crypto.timingSafeEqual()` for constant-time comparison. |
| `secret-input.ts` | ~15 | Secret field schema. Re-exports OpenClaw SDK secret input utilities and provides `buildSecretInputSchema()` which accepts either a plain string or a `{ source, provider, id }` object for env/file/exec-based secret resolution. |
| `media.ts` | ~470 | Media preprocessing pipeline. Downloads media from WAHA to `/tmp/openclaw/waha-media-*` (must be under `/tmp/openclaw/` for OpenClaw's allowed media path roots), transcribes audio via local faster-whisper, passes images through OpenClaw's native media-understanding pipeline, describes videos via Gemini, reverse-geocodes locations, parses vCards, extracts document metadata. **DO NOT disable `mediaPreprocessing.enabled`** -- it is the master kill switch for all processing. |

---

## 3. DM Keyword Filter

The DM keyword filter (`dm-filter.ts`) gates inbound DMs by keyword BEFORE they reach the AI agent. Only messages matching at least one pattern are processed; others are silently dropped. This prevents the AI from consuming tokens on irrelevant or unsolicited messages.

### Config (under `channels.waha`)

```json
"dmFilter": {
  "enabled": true,
  "mentionPatterns": ["sammie", "help", "hello", "bot", "ai"],
  "godModeBypass": true,
  "godModeSuperUsers": [
    { "identifier": "972544329000", "platform": "whatsapp", "passwordRequired": false }
  ],
  "tokenEstimate": 2500
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable/disable the filter |
| `mentionPatterns` | `string[]` | `[]` | Regex patterns (case-insensitive). Message must match at least one. Empty list means no restriction. |
| `godModeBypass` | `boolean` | `true` | Super-users bypass the filter entirely |
| `godModeSuperUsers` | `array` | `[]` | List of users who bypass the filter (phone in E.164 or JID format) |
| `tokenEstimate` | `number` | `2500` | Estimated tokens saved per dropped message (used for stats display) |

### Behavior

- **Filter disabled**: All messages pass through (stats count as allowed)
- **No patterns**: All messages pass through (no restriction configured)
- **God mode**: Super-users bypass pattern matching entirely. Israeli phone normalization handles 05X/972X/+972X and JID suffixes (`@c.us`, `@lid`, `@s.whatsapp.net`)
- **Pattern match**: Message is allowed if ANY pattern matches (case-insensitive regex)
- **No match**: Message is silently dropped -- no reply, no error, no pairing message
- **Fail-open**: Any error in the filter allows the message through (avoids outages from filter bugs)

### Regex caching

Patterns are compiled to `RegExp` objects once and cached. The cache key is the joined pattern array. If config updates (e.g. via `updateConfig()`), the cache is invalidated and rebuilt on next check.

### Stats tracking

The filter maintains runtime counters per account:
- `dropped`: messages silently dropped
- `allowed`: messages passed through
- `tokensEstimatedSaved`: `dropped * tokenEstimate` -- rough estimate of AI tokens saved

Recent events (last 50) are stored in memory with timestamp, pass/fail, reason, and text preview.

---

## 4. Admin Panel

A browser-based admin panel is served at `http://<host>:<webhookPort>/admin` (default port 8050).

### Access

```
http://100.114.126.43:8050/admin
```

### Features

- **DM Filter card**: Shows enabled status, keyword patterns, stats (dropped/allowed/tokens saved), and a live event log (last 20 events with timestamp, reason, and message preview)
- **Presence System card**: Displays current presence config (wpm, read delays, typing durations, jitter)
- **Access Control card**: Shows dmPolicy, groupPolicy, allowFrom, groupAllowFrom, and allowedGroups
- **Session Info card**: Shows session name, baseUrl, webhookPort, and server time
- **Settings tab**: Media preprocessing toggles, WAHA session picker, connection settings
- **Directory tab**: Browse contacts (11), groups (123), newsletters (85). Refresh from WAHA button. Group participants lazy-load on click.
- **Auto-refresh**: Reloads stats every 30 seconds. Manual refresh via button.

### Stats API

```bash
curl http://100.114.126.43:8050/api/admin/stats
```

Returns JSON:
```json
{
  "dmFilter": {
    "enabled": true,
    "patterns": ["sammie", "help"],
    "stats": { "dropped": 5, "allowed": 12, "tokensEstimatedSaved": 12500 },
    "recentEvents": [
      { "ts": 1772902231754, "pass": false, "reason": "no_keyword_match", "preview": "hello world" }
    ]
  },
  "presence": { "enabled": true, "wpm": 42, "..." : "..." },
  "access": { "dmPolicy": "pairing", "allowFrom": ["..."], "..." : "..." },
  "session": "3cf11776_logan",
  "webhookPort": 8050,
  "serverTime": "2026-03-07T18:50:00.000Z"
}
```

### Implementation notes

- Zero build tooling: the entire admin dashboard is an embedded HTML/CSS/JS template string in `monitor.ts`
- Admin routes are added BEFORE the POST-only webhook guard in the HTTP server handler
- No authentication on admin routes (only accessible from localhost by default since `webhookHost: 0.0.0.0` binds to all interfaces -- restrict via firewall if needed)
- Config save path fixed in v1.8.7 to write to `~/.openclaw/openclaw.json` (was incorrectly writing to workspace path)

---

## 5. Human Mimicry Presence System

### Problem

A bot that instantly shows "typing..." and replies in 200ms is obviously non-human. WhatsApp users notice deterministic timing patterns, which degrades the conversational experience.

### Solution

The presence system simulates a 4-phase human interaction pattern with randomized timing at every step:

```
Phase 1: SEEN         Phase 2: READ         Phase 3: TYPING         Phase 4: REPLY
                                             (with pauses)
  [msg arrives]  -->  [blue ticks]  -->  [typing... ...]  -->  [send message]
       |                   |                    |
       v                   v                    v
   sendSeen()        sleep(readDelay)    typing ON/OFF flicker
                                         (random pauses)
                                         + padding if AI was fast
```

### Flow Detail

1. **Seen** (`sendSeen`): If enabled, immediately marks the message as read (blue ticks).
2. **Read Delay** (`readDelayMs`): Pauses to simulate the time a human takes to read the incoming message. Duration scales with message length (`msPerReadChar * charCount`), clamped to `readDelayMs` bounds, then jittered.
3. **Typing with Flicker**: Sets typing indicator ON, then enters a loop where it randomly pauses typing (OFF for `pauseDurationMs`, then ON again) at `pauseIntervalMs` intervals with `pauseChance` probability. This continues while the AI generates its response.
4. **Reply-Length Padding** (`finishTyping`): After the AI responds, calculates how long a human would take to type the reply at `wpm` words-per-minute. If the AI was faster than that, pads with additional typing flicker. If the AI was slower, no padding is needed.

### Timing Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master switch for the entire presence system |
| `sendSeen` | `boolean` | `true` | Send read receipt (blue ticks) before typing |
| `wpm` | `number` | `42` | Simulated typing speed in words-per-minute |
| `readDelayMs` | `[min, max]` | `[500, 4000]` | Clamp range for read delay (ms) |
| `msPerReadChar` | `number` | `30` | Base read time per character of incoming message |
| `typingDurationMs` | `[min, max]` | `[1500, 15000]` | Clamp range for total typing duration (ms) |
| `pauseChance` | `number` | `0.3` | Probability (0-1) of pausing typing each interval |
| `pauseDurationMs` | `[min, max]` | `[500, 2000]` | Duration range for each typing pause (ms) |
| `pauseIntervalMs` | `[min, max]` | `[2000, 5000]` | Interval range between pause-chance checks (ms) |
| `jitter` | `[min, max]` | `[0.7, 1.3]` | Multiplier range applied to all computed durations |

### Jitter Mechanics

Every computed duration is multiplied by `rand(jitter[0], jitter[1])` before use. With the default `[0.7, 1.3]`, a base delay of 2000ms becomes anywhere from 1400ms to 2600ms. This prevents timing fingerprinting.

### AI Fast vs Slow

- **AI responds in 2s, human typing estimate is 8s**: Presence pads with 6s of additional typing flicker before sending.
- **AI responds in 12s, human typing estimate is 8s**: No padding needed. Reply sends immediately after AI finishes (typing indicator was already running during generation).

---

## 6. Configuration Reference

All configuration lives in `~/.openclaw/openclaw.json` under `channels.waha`. The admin panel config save (v1.8.7+) writes to this file directly.

### Full Config Structure

```jsonc
{
  "channels": {
    "waha": {
      // --- Connection ---
      "enabled": true,
      "baseUrl": "http://127.0.0.1:3004",          // WAHA server URL
      "apiKey": "XcTCX9cn84LE/...",                 // WHATSAPP_API_KEY (NOT WAHA_API_KEY)
      "session": "3cf11776_logan",                  // WAHA session name

      // --- Webhook Server ---
      "webhookHost": "0.0.0.0",                     // Bind address (default: 0.0.0.0)
      "webhookPort": 8050,                          // Webhook listener port (default: 8050)
      "webhookPath": "/webhook/waha",               // Webhook URL path
      "webhookHmacKey": "95b5f1b4ae57...",          // HMAC-SHA512 key for signature verification

      // --- Access Control ---
      "dmPolicy": "allowlist",                      // "pairing" | "open" | "closed" | "allowlist"
      "groupPolicy": "allowlist",                   // "allowlist" | "open" | "closed"
      "allowFrom": [                                // DM senders allowed (when dmPolicy=allowlist)
        "972544329000@c.us",
        "271862907039996@lid"
      ],
      "groupAllowFrom": [                           // Group message senders allowed
        "972544329000@c.us",                        // @c.us JID
        "271862907039996@lid"                       // @lid JID (NOWEB engine sends these!)
      ],

      // --- Presence (Human Mimicry) ---
      "presence": {
        "enabled": true,
        "sendSeen": true,
        "wpm": 42,
        "readDelayMs": [500, 4000],
        "msPerReadChar": 30,
        "typingDurationMs": [1500, 15000],
        "pauseChance": 0.3,
        "pauseDurationMs": [500, 2000],
        "pauseIntervalMs": [2000, 5000],
        "jitter": [0.7, 1.3]
      },

      // --- Optional Features ---
      "actions": {
        "reactions": true                           // Enable emoji reactions
      },
      "markdown": {
        "enabled": true,
        "tables": "auto"                            // "auto" | "markdown" | "text"
      },
      "replyPrefix": {
        "enabled": false
      },
      "blockStreaming": false,

      // --- Media Preprocessing (DO NOT set enabled: false!) ---
      "mediaPreprocessing": {
        "enabled": true,           // MASTER SWITCH — false disables ALL processing
        "audioTranscription": true, // Local Whisper transcription for voice messages
        "imageAnalysis": true,      // Vision API image description
        "videoAnalysis": true,      // Gemini video description
        "locationResolution": true, // Nominatim reverse geocoding
        "vcardParsing": true,       // Contact card parsing
        "documentAnalysis": true    // Document metadata extraction
      },

      // --- Multi-Account (optional) ---
      "accounts": {
        "secondary": {
          "baseUrl": "http://other-waha:3004",
          "apiKey": "...",
          "session": "other_session"
        }
      },
      "defaultAccount": "default"
    }
  }
}
```

### Access Control Notes

- `dmPolicy: "allowlist"` + `allowFrom` restricts DMs to listed JIDs only
- `groupPolicy: "allowlist"` + `groupAllowFrom` restricts group responses to messages from listed sender JIDs
- `groupAllowFrom` filters by **sender JID** (participant), NOT by group JID
- Use `"*"` to allow all senders (dangerous in production)
- **CRITICAL**: WAHA NOWEB engine sends sender JIDs as `@lid`, not `@c.us`. You MUST include BOTH formats for each allowed user.

### Finding a User's LID

```bash
docker exec -i postgres-waha psql -U admin -d waha_noweb_3cf11776_logan \
  -c "SELECT id, pn FROM lid_map WHERE pn LIKE '%PHONE_NUMBER%'"
```

---

## 7. Installation / Reinstallation

### File Locations

The plugin source exists in TWO locations that must always be kept in sync:

| Location | Purpose |
|----------|---------|
| `/home/omer/.openclaw/extensions/waha/src/` | **Runtime** -- what OpenClaw actually loads |
| `/home/omer/.openclaw/workspace/skills/waha-openclaw-channel/src/` | **Development** -- workspace copy |

The main config file is at `/home/omer/.openclaw/openclaw.json` under `channels.waha`.

### Deploying Changes

After editing source files, deploy to BOTH locations and restart:

```bash
# 1. Copy files (if editing in workspace)
cp /home/omer/.openclaw/workspace/skills/waha-openclaw-channel/src/*.ts \
   /home/omer/.openclaw/extensions/waha/src/

# 2. Verify both copies match
md5sum /home/omer/.openclaw/extensions/waha/src/*.ts
md5sum /home/omer/.openclaw/workspace/skills/waha-openclaw-channel/src/*.ts

# 3. Restart gateway (systemd auto-restarts on kill)
kill -9 $(pgrep -f "openclaw-gatewa") 2>/dev/null

# 4. Wait ~5 seconds, then verify it came back up
ss -tlnp | grep 18789
curl -s http://127.0.0.1:8050/healthz
```

### Remote Deployment (from Windows dev machine)

Use base64 transfer to avoid shell escaping issues with TypeScript `!==` operators:

```bash
# Encode locally
B64=$(base64 -w 0 /path/to/file.ts)

# Transfer to both locations
ssh omer@100.114.126.43 "echo '$B64' | base64 -d > /home/omer/.openclaw/extensions/waha/src/file.ts"
ssh omer@100.114.126.43 "echo '$B64' | base64 -d > /home/omer/.openclaw/workspace/skills/waha-openclaw-channel/src/file.ts"
```

---

## 8. Troubleshooting

### CRITICAL: Gateway Uses Workspace Config, Not ~/.openclaw/openclaw.json

The openclaw gateway service sets `OPENCLAW_CONFIG_PATH=/home/omer/.openclaw/workspace/openclaw.json` (visible in `/proc/<pid>/environ`). The gateway reads FROM and writes TO this file, NOT `~/.openclaw/openclaw.json`.

When WAHA is not starting (port 8050 not bound), verify the **workspace config** has the waha section:

```bash
python3 -c "import json; cfg=json.load(open('/home/omer/.openclaw/workspace/openclaw.json')); print(list(cfg.get('channels',{}).keys()))"
# Should show: ['telegram', 'waha']
```

To sync WAHA config from `~/.openclaw/openclaw.json` to workspace:
```bash
python3 << 'PYEOF'
import json, shutil
full = json.load(open('/home/omer/.openclaw/openclaw.json'))
ws = json.load(open('/home/omer/.openclaw/workspace/openclaw.json'))
ws.setdefault('channels', {})['waha'] = full['channels']['waha']
shutil.copy('/home/omer/.openclaw/workspace/openclaw.json', '/home/omer/.openclaw/workspace/openclaw.json.bak')
json.dump(ws, open('/home/omer/.openclaw/workspace/openclaw.json', 'w'), indent=2)
print('Done')
PYEOF
```

### WAHA API Key: Use WHATSAPP_API_KEY, Not WAHA_API_KEY

WAHA defines two keys in its `.env`. Only `WHATSAPP_API_KEY` authenticates API calls (returns 200). Using `WAHA_API_KEY` returns 401 on every request. The `channels.waha.apiKey` config value must use the correct key.

**Test which key works:**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Api-Key: YOUR_KEY_HERE" \
  http://127.0.0.1:3004/api/sessions
# 200 = correct key, 401 = wrong key
```

### groupAllowFrom Needs BOTH @c.us AND @lid JIDs

WAHA's NOWEB engine sends group message sender JIDs as `@lid` (linked device ID), not `@c.us`. If you only list `@c.us` JIDs in `groupAllowFrom`, all group messages will be silently dropped.

**Fix:** Add both formats for each allowed user:
```json
"groupAllowFrom": ["972544329000@c.us", "271862907039996@lid"]
```

### Voice Files: Use /api/sendVoice, Not Base64 File Conversion

The `send.ts` module includes `buildFilePayload()` which automatically handles local TTS file paths by reading them as base64. Audio files with recognized MIME types (`audio/*`) are routed to WAHA's `/api/sendVoice` endpoint with `convert: true` to produce proper WhatsApp voice bubbles (PTT format).

If voice notes appear as document attachments instead of voice bubbles, check that:
1. `resolveMime()` correctly detects the audio MIME type
2. The WAHA endpoint is `/api/sendVoice` (not `/api/sendFile`)
3. The payload includes `"convert": true`

### TTS Local Paths: buildFilePayload() Handles Base64 Automatically

OpenClaw TTS generates voice files at `/tmp/openclaw/tts-*/voice-*.mp3`. WAHA cannot access local filesystem paths. The `buildFilePayload()` function in `send.ts` detects paths starting with `/` or `file://`, reads the file with `readFileSync`, converts to base64, and builds the correct WAHA payload format with `{ data, mimetype, filename }`.

### Plugin ID Mismatch Warning (Benign)

```
plugin id mismatch (config uses "waha-openclaw-channel", export uses "waha")
```

This warning appears because the config `plugins.entries` key is `waha-openclaw-channel` but the plugin exports `id: "waha"`. It is cosmetic only -- the plugin loads and operates normally.

### Shell ! Escaping: Use Base64 Transfer for TypeScript Files Over SSH

SSH heredocs with `!` characters (in `!==`, `!response.ok`, etc.) trigger bash history expansion, which inserts backslashes into the file content and causes TypeScript parse errors. Always use the base64 transfer pattern (see Section 7) when deploying TypeScript files remotely.

### Gateway Not Responding After Restart

1. Check if the process is running: `pgrep -af "openclaw-gateway"`
2. Check if port 18789 is bound: `ss -tlnp | grep 18789`
3. Check webhook port: `ss -tlnp | grep 8050`
4. Check logs: `tail -100 /tmp/openclaw/openclaw-gateway.log`
5. If an old process holds the port, force kill: `kill -9 $(pgrep -f "openclaw-gatewa")`
6. Systemd auto-restarts the gateway -- wait ~5 seconds after kill

### Actions Not Working (v1.9.0)

If the LLM cannot invoke actions (send, poll, react, etc.):

1. **Check `tools.alsoAllow`**: Must include `"message"`. The `coding` tools profile filters it out by default.
2. **Check `listActions()` output**: Should return only gateway-standard names (send, poll, react, edit, unsend, pin, unpin, read, delete, reply). Custom WAHA names are rejected.
3. **Check `messaging.targetResolver`**: Must be configured to recognize WAHA JID formats. Without it, JID targets cause "Unknown target" errors.

---

## 9. Key Guardrails

### Session Blocking (`assertAllowedSession`) -- Updated v1.9.0

The `send.ts` module enforces a hard guardrail that prevents the bot from sending messages as Omer:

```typescript
// DO NOT CHANGE -- session guardrail
if (normalized === "omer" || normalized.endsWith("_omer")) {
    throw new Error(`WAHA session '${normalized}' is explicitly blocked by guardrail`);
}
```

The guardrail blocks sessions matching `"omer"` or `"*_omer"`. All other sessions (including `"logan"` and `"*_logan"`) are allowed. This was fixed in v1.9.0 -- previous versions had a logan-only allowlist which was overly restrictive.

### Action Name Filtering (v1.9.0) -- CRITICAL

`listActions()` returns ONLY gateway-standard action names. This is the most impactful change in v1.9.0:

- **Standard names**: `send`, `poll`, `react`, `edit`, `unsend`, `pin`, `unpin`, `read`, `delete`, `reply`
- **Utility actions**: Curated subset of WAHA-specific utilities (getGroups, sendLocation, etc.)
- **Rejected names**: Custom WAHA names like `sendPoll`, `editMessage`, `pinMessage` have `mode: "none"` in the gateway's `MESSAGE_ACTION_TARGET_MODE` map and cannot accept targets

DO NOT revert `listActions()` to return all WAHA action names. This was the root cause of action failures prior to v1.9.0.

### HMAC Webhook Verification

All incoming webhooks are verified against the configured `webhookHmacKey` using SHA-512 HMAC. Requests without a valid `X-Webhook-Hmac` header receive HTTP 401. This prevents unauthorized parties from injecting fake messages into the bot pipeline.

### Access Control Enforcement

Messages are dropped silently (with logging) if:
- The sender JID is not in `allowFrom` (for DMs when `dmPolicy: "allowlist"`)
- The sender JID is not in `groupAllowFrom` (for group messages when `groupPolicy: "allowlist"`)
- The session in the webhook payload does not match the configured session

### Duplicate Webhook Prevention (v1.8.6)

WAHA sends both `message` and `message.any` events for each message. The plugin now only processes `message` events, eliminating double-counting in filter stats and preventing duplicate AI invocations.

---

## Appendix: Architecture Diagram

```
WAHA (hpg6:3004)
    |
    |--- webhook (X-Webhook-Hmac signed) --->  OpenClaw Webhook Server (hpg6:8050)
    |                                               |
    |                                          monitor.ts (verify HMAC, parse envelope)
    |                                               |
    |                                          inbound.ts (access control, DM filter, presence start)
    |                                               |
    |                                          OpenClaw AI Agent (generate reply)
    |                                               |
    |                                          channel.ts (listActions: gateway-standard names only)
    |                                               |
    |                                          presence.ts (pad typing to human speed)
    |                                               |
    |   <--- WAHA REST API (sendText/sendVoice) --- send.ts (assertAllowedSession: blocks omer)
    |
    v
WhatsApp recipient sees: blue ticks -> typing... -> text reply -> voice note
```

---

## Appendix: Useful Commands

```bash
# Check gateway status
pgrep -af "openclaw gateway"

# Check webhook health
curl -s http://127.0.0.1:8050/healthz

# Check WAHA sessions
curl -s -H "X-Api-Key: $WHATSAPP_API_KEY" http://127.0.0.1:3004/api/sessions

# View recent gateway logs
tail -50 /tmp/openclaw/openclaw-gateway.log | grep waha

# Restart gateway (systemd auto-restarts)
kill -9 $(pgrep -f "openclaw-gatewa") 2>/dev/null

# Verify port binding after restart
ss -tlnp | grep 18789

# Check admin panel
curl -s http://127.0.0.1:8050/api/admin/stats | python3 -m json.tool
```
