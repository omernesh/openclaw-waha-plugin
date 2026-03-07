# OpenClaw WAHA Plugin — Developer Reference

**Plugin ID:** `waha`
**Platform:** WhatsApp (via WAHA HTTP API)
**Last updated:** 2026-03-07

---

## 1. Overview

This plugin bridges OpenClaw AI agents to WhatsApp through the WAHA (WhatsApp HTTP API) server. It enables your "OpenClaw assistant" bot to receive WhatsApp messages via webhook, route them through OpenClaw's AI agent pipeline, and deliver replies back through WAHA — including text responses and TTS-generated voice notes.

The plugin operates as a channel adapter within the OpenClaw plugin-sdk framework. It:

- Runs an HTTP webhook server to receive inbound WAHA events
- Applies access control (DM policy, group allowlists with both `@c.us` and `@lid` JID formats)
- Simulates human-like presence (read receipts, typing indicators with random pauses) before replying
- Delivers AI-generated text and voice replies through WAHA's REST API
- Enforces session guardrails (only the bot session can send outbound messages)

---

## 2. File Listing

| File | Lines | Description |
|------|-------|-------------|
| `channel.ts` | ~340 | Channel plugin registration and lifecycle. Exports the `ChannelPlugin` definition with metadata, capabilities (reactions, media, markdown), account resolution, and outbound delivery adapter. Wires up the webhook monitor, inbound handler, and send functions. |
| `inbound.ts` | ~380 | Inbound message handler. Receives parsed `WahaInboundMessage` from the monitor, applies DM/group access control via `resolveDmGroupAccessWithCommandGate`, runs the DM keyword filter, starts the human presence simulation, dispatches the message to the AI agent, and delivers the reply. |
| `dm-filter.ts` | ~145 | DM keyword filter. `DmFilter` class with regex caching, god mode bypass for super-users, and stats tracking (dropped/allowed/tokensEstimatedSaved). Fail-open: any error allows messages through. |
| `send.ts` | ~250 | WAHA REST API wrappers. Provides `sendWahaText()`, `sendWahaMediaBatch()`, `sendWahaReaction()`, `sendWahaPresence()`, `sendWahaSeen()`, and the internal `callWahaApi()` HTTP client. Includes `assertAllowedSession()` guardrail, `buildFilePayload()` for base64 encoding of local TTS files, and `resolveMime()` for MIME type detection with file-extension fallback. |
| `presence.ts` | ~170 | Human mimicry presence system. Implements the 4-phase presence simulation: seen, read delay, typing with random pauses (flicker), and reply-length padding. Exports `startHumanPresence()` which returns a `PresenceController` with `finishTyping()` and `cancelTyping()` methods. |
| `types.ts` | ~130 | TypeScript type definitions. Defines `CoreConfig`, `WahaChannelConfig`, `WahaAccountConfig`, `PresenceConfig`, `DmFilterConfig`, `WahaWebhookEnvelope`, `WahaInboundMessage`, `WahaReactionEvent`, and `WahaWebhookConfig`. |
| `config-schema.ts` | ~86 | Zod validation schema for the `channels.waha` config section. Validates all account-level and channel-level settings including secret inputs, policies, presence parameters, DM filter config, and markdown options. |
| `accounts.ts` | ~140 | Multi-account resolution. Resolves which WAHA account (baseUrl, apiKey, session) to use for a given operation. Supports a default account plus named sub-accounts under `channels.waha.accounts`. Handles API key resolution from env vars, files, or direct strings. |
| `normalize.ts` | ~30 | JID normalization utilities. `normalizeWahaMessagingTarget()` strips `waha:`, `whatsapp:`, `chat:` prefixes. `normalizeWahaAllowEntry()` lowercases for allowlist comparison. `resolveWahaAllowlistMatch()` checks if a sender JID is in the allowlist (supports `*` wildcard). |
| `monitor.ts` | ~506 | Webhook HTTP server, health monitoring, and admin panel. Starts an HTTP server on the configured port (default 8050). Handles `/healthz`, `/admin` (HTML dashboard), `/api/admin/stats` (JSON stats), and the main webhook path. Validates HMAC signatures and dispatches inbound events. |
| `runtime.ts` | ~15 | Runtime singleton access. `setWahaRuntime()` / `getWahaRuntime()` store and retrieve the OpenClaw `PluginRuntime` instance for use across modules. |
| `signature.ts` | ~30 | HMAC webhook verification. `verifyWahaWebhookHmac()` validates the `X-Webhook-Hmac` header using SHA-512, accepting hex or base64 signature formats. Uses `crypto.timingSafeEqual()` for constant-time comparison. |
| `secret-input.ts` | ~15 | Secret field schema. Re-exports OpenClaw SDK secret input utilities and provides `buildSecretInputSchema()` which accepts either a plain string or a `{ source, provider, id }` object for env/file/exec-based secret resolution. |

---

## 3. DM Keyword Filter

The DM keyword filter (`dm-filter.ts`) gates inbound DMs by keyword BEFORE they reach the AI agent. Only messages matching at least one pattern are processed; others are silently dropped. This prevents the AI from consuming tokens on irrelevant or unsolicited messages.

### Config (under `channels.waha`)

```json
"dmFilter": {
  "enabled": true,
  "mentionPatterns": ["yourbot", "help", "hello", "bot", "ai"],
  "godModeBypass": true,
  "godModeSuperUsers": [
    { "identifier": "15551234567", "platform": "whatsapp", "passwordRequired": false }
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
- **No match**: Message is silently dropped — no reply, no error, no pairing message
- **Fail-open**: Any error in the filter allows the message through (avoids outages from filter bugs)

### Regex caching

Patterns are compiled to `RegExp` objects once and cached. The cache key is the joined pattern array. If config updates (e.g. via `updateConfig()`), the cache is invalidated and rebuilt on next check.

### Stats tracking

The filter maintains runtime counters per account:
- `dropped`: messages silently dropped
- `allowed`: messages passed through
- `tokensEstimatedSaved`: `dropped * tokenEstimate` — rough estimate of AI tokens saved

Recent events (last 50) are stored in memory with timestamp, pass/fail, reason, and text preview.

---

## 4. Admin Panel

A browser-based admin panel is served at `http://<host>:<webhookPort>/admin` (default port 8050).

### Access

```
http://your-server-ip:8050/admin
```

### Features

- **DM Filter card**: Shows enabled status, keyword patterns, stats (dropped/allowed/tokens saved), and a live event log (last 20 events with timestamp, reason, and message preview)
- **Presence System card**: Displays current presence config (wpm, read delays, typing durations, jitter)
- **Access Control card**: Shows dmPolicy, groupPolicy, allowFrom, groupAllowFrom, and allowedGroups
- **Session Info card**: Shows session name, baseUrl, webhookPort, and server time
- **Auto-refresh**: Reloads stats every 30 seconds. Manual refresh via button.

### Stats API

```bash
curl http://your-server-ip:8050/api/admin/stats
```

Returns JSON:
```json
{
  "dmFilter": {
    "enabled": true,
    "patterns": ["yourbot", "help"],
    "stats": { "dropped": 5, "allowed": 12, "tokensEstimatedSaved": 12500 },
    "recentEvents": [
      { "ts": 1772902231754, "pass": false, "reason": "no_keyword_match", "preview": "hello world" }
    ]
  },
  "presence": { "enabled": true, "wpm": 42, ... },
  "access": { "dmPolicy": "pairing", "allowFrom": [...], ... },
  "session": "your_session_name",
  "webhookPort": 8050,
  "serverTime": "2026-03-07T18:50:00.000Z"
}
```

### Implementation notes

- Zero build tooling: the entire admin dashboard is an embedded HTML/CSS/JS template string in `monitor.ts`
- Admin routes are added BEFORE the POST-only webhook guard in the HTTP server handler
- No authentication on admin routes (only accessible from localhost by default since `webhookHost: 0.0.0.0` binds to all interfaces — restrict via firewall if needed)

---

## 5. Human Mimicry Presence System

### Problem

A bot that instantly shows "typing..." and replies in 200ms is obviously non-human. WhatsApp users notice deterministic timing patterns, which degrades the conversational experience.

### Solution

The presence system simulates a 4-phase human interaction pattern with randomized timing at every step:

```
Phase 1: SEEN         Phase 2: READ         Phase 3: TYPING         Phase 4: REPLY
                                             (with pauses)
  [msg arrives]  -->  [blue ticks]  -->  [typing... ···]  -->  [send message]
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

All configuration lives in `~/.openclaw/openclaw.json` AND `~/.openclaw/workspace/openclaw.json` under `channels.waha`. The gateway uses the **workspace config** (set by `OPENCLAW_CONFIG_PATH`), so changes must be applied there.

### Full Config Structure

```jsonc
{
  "channels": {
    "waha": {
      // --- Connection ---
      "enabled": true,
      "baseUrl": "http://127.0.0.1:3004",          // WAHA server URL
      "apiKey": "your-api-key-here",                 // WHATSAPP_API_KEY (NOT WAHA_API_KEY)
      "session": "your_session_name",                  // WAHA session name

      // --- Webhook Server ---
      "webhookHost": "0.0.0.0",                     // Bind address (default: 0.0.0.0)
      "webhookPort": 8050,                          // Webhook listener port (default: 8050)
      "webhookPath": "/webhook/waha",               // Webhook URL path
      "webhookHmacKey": "your-hmac-key-here",          // HMAC-SHA512 key for signature verification

      // --- Access Control ---
      "dmPolicy": "allowlist",                      // "pairing" | "open" | "closed" | "allowlist"
      "groupPolicy": "allowlist",                   // "allowlist" | "open" | "closed"
      "allowFrom": [                                // DM senders allowed (when dmPolicy=allowlist)
        "15551234567@c.us",
        "123456789012345@lid"
      ],
      "groupAllowFrom": [                           // Group message senders allowed
        "15551234567@c.us",                        // @c.us JID
        "123456789012345@lid"                       // @lid JID (NOWEB engine sends these!)
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
docker exec -i postgres-waha psql -U admin -d waha_noweb_your_session_name \
  -c "SELECT id, pn FROM lid_map WHERE pn LIKE '%PHONE_NUMBER%'"
```

---

## 7. Installation / Reinstallation

### File Locations

The plugin source exists in TWO locations that must always be kept in sync:

| Location | Purpose |
|----------|---------|
| `~/.openclaw/extensions/waha/src/` | **Runtime** — what OpenClaw actually loads |
| `~/.openclaw/workspace/skills/waha-openclaw-channel/src/` | **Development** — workspace copy |

The main config file is at `~/.openclaw/openclaw.json` under `channels.waha`.

### Deploying Changes

After editing source files, deploy to BOTH locations and restart:

```bash
# 1. Copy files (if editing in workspace)
cp ~/.openclaw/workspace/skills/waha-openclaw-channel/src/*.ts \
   ~/.openclaw/extensions/waha/src/

# 2. Verify both copies match
md5sum ~/.openclaw/extensions/waha/src/*.ts
md5sum ~/.openclaw/workspace/skills/waha-openclaw-channel/src/*.ts

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
ssh user@your-server-ip "echo '$B64' | base64 -d > ~/.openclaw/extensions/waha/src/file.ts"
ssh user@your-server-ip "echo '$B64' | base64 -d > ~/.openclaw/workspace/skills/waha-openclaw-channel/src/file.ts"
```

---

## 8. Troubleshooting

### CRITICAL: Gateway Uses Workspace Config, Not ~/.openclaw/openclaw.json

The openclaw gateway service sets `OPENCLAW_CONFIG_PATH=~/.openclaw/workspace/openclaw.json` (visible in `/proc/<pid>/environ`). The gateway reads FROM and writes TO this file, NOT `~/.openclaw/openclaw.json`.

When WAHA is not starting (port 8050 not bound), verify the **workspace config** has the waha section:

```bash
python3 -c "import json; cfg=json.load(open('~/.openclaw/workspace/openclaw.json')); print(list(cfg.get('channels',{}).keys()))"
# Should show: ['telegram', 'waha']
```

To sync WAHA config from `~/.openclaw/openclaw.json` to workspace:
```bash
python3 << 'PYEOF'
import json, shutil
full = json.load(open('~/.openclaw/openclaw.json'))
ws = json.load(open('~/.openclaw/workspace/openclaw.json'))
ws.setdefault('channels', {})['waha'] = full['channels']['waha']
shutil.copy('~/.openclaw/workspace/openclaw.json', '~/.openclaw/workspace/openclaw.json.bak')
json.dump(ws, open('~/.openclaw/workspace/openclaw.json', 'w'), indent=2)
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
"groupAllowFrom": ["15551234567@c.us", "123456789012345@lid"]
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

This warning appears because the config `plugins.entries` key is `waha-openclaw-channel` but the plugin exports `id: "waha"`. It is cosmetic only — the plugin loads and operates normally.

### Shell ! Escaping: Use Base64 Transfer for TypeScript Files Over SSH

SSH heredocs with `!` characters (in `!==`, `!response.ok`, etc.) trigger bash history expansion, which inserts backslashes into the file content and causes TypeScript parse errors. Always use the base64 transfer pattern (see Section 5) when deploying TypeScript files remotely.

### Gateway Not Responding After Restart

1. Check if the process is running: `pgrep -af "openclaw-gateway"`
2. Check if port 18789 is bound: `ss -tlnp | grep 18789`
3. Check webhook port: `ss -tlnp | grep 8050`
4. Check logs: `tail -100 /tmp/openclaw/openclaw-gateway.log`
5. If an old process holds the port, force kill: `kill -9 $(pgrep -f "openclaw-gatewa")`
6. Systemd auto-restarts the gateway — wait ~5 seconds after kill

---

## 9. Key Guardrails

### Session Blocking (`assertAllowedSession`)

The `send.ts` module enforces a hard guardrail that prevents the bot from sending messages as the owner:

```typescript
if (normalized === "owner" || normalized.endsWith("_owner")) {
    throw new Error(`WAHA session '${normalized}' is explicitly blocked by guardrail`);
}
```

Only sessions matching  or  are allowed to send outbound messages. This prevents accidental or malicious use of the owner's personal WhatsApp session by the AI bot.

### HMAC Webhook Verification

All incoming webhooks are verified against the configured `webhookHmacKey` using SHA-512 HMAC. Requests without a valid `X-Webhook-Hmac` header receive HTTP 401. This prevents unauthorized parties from injecting fake messages into the bot pipeline.

### Access Control Enforcement

Messages are dropped silently (with logging) if:
- The sender JID is not in `allowFrom` (for DMs when `dmPolicy: "allowlist"`)
- The sender JID is not in `groupAllowFrom` (for group messages when `groupPolicy: "allowlist"`)
- The session in the webhook payload does not match the configured session

---

## Appendix: Architecture Diagram

```
WAHA (your-server:3004)
    |
    |--- webhook (X-Webhook-Hmac signed) --->  OpenClaw Webhook Server (your-server:8050)
    |                                               |
    |                                          monitor.ts (verify HMAC, parse envelope)
    |                                               |
    |                                          inbound.ts (access control, presence start)
    |                                               |
    |                                          OpenClaw AI Agent (generate reply)
    |                                               |
    |                                          presence.ts (pad typing to human speed)
    |                                               |
    |   <--- WAHA REST API (sendText/sendVoice) --- send.ts (assertAllowedSession)
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
```
