# OpenClaw WAHA Plugin

**The most comprehensive WhatsApp integration for OpenClaw.**

Full WhatsApp API access through [WAHA](https://waha.devlike.pro/) -- groups, channels, media, polls, reactions, stickers, voice messages, contact cards, labels, status/stories, presence, and more. 87%+ WAHA API coverage.

**Plugin ID:** `waha` | **Version:** 1.14.0 | **Last updated:** 2026-03-15

[![npm](https://img.shields.io/npm/v/waha-openclaw-channel)](https://www.npmjs.com/package/waha-openclaw-channel)

---

## Why WAHA over wa-cli?

- **Full WhatsApp API** -- groups, channels, newsletters, polls, reactions, stickers, voice bubbles, contact cards, labels, status/stories, presence management
- **Multi-session support** -- run bot + human sessions with role-based access control (`bot`/`human`, `full-access`/`listener`)
- **Built-in reliability** -- request timeouts, token-bucket rate limiting, automatic retry with exponential backoff, webhook deduplication
- **Human mimicry** -- realistic typing indicators, read receipts, random pauses that make the bot feel human
- **Inbound message queue** -- prevents message loss under load; separate DM and group queues
- **Session health monitoring** -- automatic health pings detect disconnects before they affect messages
- **Rules & policy system** -- file-based YAML rules for per-contact and per-group behavior control (v1.11)
- **Admin panel** -- web UI with real-time monitoring, directory browser, config editor, session health
- **Auto name resolution** -- send messages using human-readable names ("send hello to test group")
- **Media pipeline** -- voice transcription (Whisper), image analysis, video description, vCard parsing, location geocoding

---

## Quick Start

### 1. Install

```bash
npm install waha-openclaw-channel
```

### 2. Configure

Add to your `openclaw.json`:

```json
{
  "plugins": { "allow": ["waha"] },
  "tools": { "alsoAllow": ["message"] },
  "channels": {
    "waha": {
      "enabled": true,
      "baseUrl": "YOUR_WAHA_URL",
      "apiKey": "YOUR_API_KEY",
      "session": "your_session_name",
      "webhookPort": 8050,
      "webhookPath": "/webhook/waha"
    }
  }
}
```

> **CRITICAL:** `tools.alsoAllow: ["message"]` is mandatory. Without it, the `coding` tools profile filters out the `message` tool and the AI agent cannot invoke any WhatsApp actions.

### 3. Configure WAHA webhook

Point your WAHA session's webhook to `http://YOUR_HOST:8050/webhook/waha`.

### 4. Restart the gateway

```bash
systemctl --user restart openclaw-gateway
```

---

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the WAHA channel |
| `baseUrl` | string | -- | WAHA server URL |
| `apiKey` | string | -- | WAHA API key (use `WHATSAPP_API_KEY` env var) |
| `session` | string | -- | WAHA session name |
| `webhookPort` | number | `8050` | Port for incoming WAHA webhooks |
| `webhookPath` | string | `/webhook/waha` | Path for webhook endpoint |
| `webhookHmacKey` | string | -- | HMAC-SHA512 key for webhook signature verification |
| `dmPolicy` | string | `"pairing"` | DM access: `"pairing"` / `"open"` / `"closed"` / `"allowlist"` |
| `groupPolicy` | string | `"allowlist"` | Group access: `"allowlist"` / `"open"` / `"closed"` |
| `allowFrom` | string[] | -- | Allowed DM sender JIDs (include both `@c.us` and `@lid` formats) |
| `groupAllowFrom` | string[] | -- | Allowed group sender JIDs (include both `@c.us` and `@lid` formats) |
| `timeoutMs` | number | `30000` | WAHA API request timeout (ms) |
| `rateLimitCapacity` | number | `20` | Token bucket max burst size |
| `rateLimitRefillRate` | number | `15` | Token refill rate per second |
| `healthCheckIntervalMs` | number | `60000` | Session health check interval (ms) |
| `dmQueueSize` | number | `50` | Max queued inbound DMs before drop |
| `groupQueueSize` | number | `50` | Max queued inbound group messages before drop |
| `autoLinkPreview` | boolean | `true` | Auto link preview for URLs in text messages |
| `role` | string | `"bot"` | Session role: `"bot"` or `"human"` |
| `subRole` | string | `"full-access"` | Sub-role: `"full-access"` or `"listener"` (receive only) |
| `triggerWord` | string | -- | Bot only activates in groups when message starts with this word |
| `triggerResponseMode` | string | `"dm"` | Trigger response: `"dm"` (reply via DM) or `"group"` (reply in chat) |
| `godModeScope` | string | `"all"` | God mode filter bypass scope: `"all"`, `"dm"` (recommended), or `"off"` |

### Presence (Human Mimicry)

Configure under `channels.waha.presence`:

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Master switch for presence simulation |
| `sendSeen` | `true` | Send read receipts (blue ticks) |
| `wpm` | `42` | Simulated typing speed (words per minute) |
| `readDelayMs` | `[500, 4000]` | Read delay range (ms) |
| `typingDurationMs` | `[1500, 15000]` | Typing duration range (ms) |
| `pauseChance` | `0.3` | Probability of pausing typing |
| `jitter` | `[0.7, 1.3]` | Randomization multiplier range |

---

## Actions Quick Reference

### Standard Actions (support auto name-to-JID resolution)

| Action | Purpose |
|--------|---------|
| `send` | Send text, contact cards |
| `poll` | Create polls |
| `react` | Emoji reactions |
| `edit` | Edit sent messages |
| `unsend` | Delete/unsend messages |
| `pin` / `unpin` | Pin/unpin messages |
| `read` | Mark chat as read |
| `reply` | Reply to specific messages |

### Utility Actions

| Action | Purpose |
|--------|---------|
| `search` | Find groups, contacts, channels by name |
| `sendMulti` | Send text to multiple chats |
| `sendImage` / `sendVideo` / `sendFile` | Send media |
| `sendLocation` | Share GPS coordinates |
| `sendEvent` | Create group events |
| `sendLinkPreview` | URL preview cards |
| `muteChat` / `unmuteChat` | Chat notification control |
| `readMessages` | Read recent messages from any chat (1-50) |
| `joinGroup` | Join group via invite link |
| `followChannel` / `unfollowChannel` | Channel subscriptions |

### Management Actions

| Category | Actions |
|----------|---------|
| Groups | `createGroup`, `getGroups`, `getGroup`, `deleteGroup`, `leaveGroup`, `addParticipants`, `removeParticipants`, `promoteToAdmin`, `demoteFromAdmin` |
| Contacts | `getContacts`, `getContact`, `checkContactExists`, `blockContact`, `unblockContact` |
| Labels | `getLabels`, `createLabel`, `updateLabel`, `deleteLabel`, `setChatLabels`, `getChatsByLabel` |
| Status/Stories | `sendTextStatus`, `sendImageStatus`, `sendVoiceStatus`, `sendVideoStatus`, `deleteStatus` |
| Channels | `getChannels`, `createChannel`, `deleteChannel`, `searchChannelsByText` |
| Profile | `getProfile`, `setProfileName`, `setProfileStatus`, `setProfilePicture` |
| Presence | `setPresenceStatus`, `getPresence`, `subscribePresence` |

---

## Rules & Policy System (v1.11)

File-based YAML rules allow per-contact and per-group behavior control without code changes.

Rules are stored in a configurable directory (default: `rules/` relative to the plugin) and support:

- **Per-contact policies** -- custom behavior for specific contacts
- **Per-group policies** -- group-specific message handling rules
- **Manager authorization** -- restrict policy edits to authorized users
- **Outbound policy enforcement** -- apply rules before messages are sent
- **Inbound hook integration** -- filter and route inbound messages by policy

Configure via `rulesPath` in the channel config. See the rules directory for examples.

---

## Admin Panel

Access at `http://YOUR_HOST:8050/admin`. No build tools required -- the UI is embedded in the plugin.

**Tabs:**
- **Directory** -- browse contacts, groups, newsletters; per-contact DM settings; group participant management; per-group filter overrides (disable filtering, custom keywords, god mode scope)
- **Config** -- edit DM/group filter settings, keyword patterns, trigger operator, god mode scope, media preprocessing toggles, multi-session filtering guide
- **Filter Stats** -- message processing statistics, duplicate webhook tracking
- **Status** -- session health, connection info, gateway restart

**API endpoints** (all under `/api/admin/`):
- `GET /stats` -- filter statistics
- `GET /config` / `POST /config` -- read/update plugin config
- `GET /sessions` -- WAHA session status
- `GET /directory` -- paginated contact/group listing
- `POST /directory/refresh` -- refresh directory from WAHA API
- `POST /restart` -- restart the gateway

---

## Multi-Session Setup

Run a bot session alongside a human session with layered guardrails:

```json
{
  "channels": {
    "waha": {
      "accounts": {
        "bot": {
          "baseUrl": "YOUR_WAHA_URL",
          "apiKey": "YOUR_API_KEY",
          "session": "bot_session",
          "role": "bot",
          "subRole": "full-access"
        },
        "human": {
          "baseUrl": "YOUR_WAHA_URL",
          "apiKey": "YOUR_API_KEY",
          "session": "human_session",
          "webhookPort": 8051,
          "role": "human",
          "subRole": "listener",
          "triggerWord": "!",
          "triggerResponseMode": "reply-in-chat",
          "dmFilter": { "enabled": true, "mentionPatterns": [], "godModeScope": "dm" },
          "groupFilter": { "enabled": true, "mentionPatterns": [], "godModeScope": "dm" }
        }
      },
      "defaultAccount": "bot"
    }
  }
}
```

| Role | Sub-Role | Can Send? | Purpose |
|------|----------|-----------|---------|
| `bot` | `full-access` | Yes | Primary bot session |
| `human` | `listener` | No | Monitoring only |
| `human` | `full-access` | Yes | Human with send access |

### Multi-Session Guardrails

Messages pass through layered filtering before reaching the bot:

1. **Group allowlist** -- Is this group allowed? If not, dropped (zero tokens)
2. **Sender allowlist** -- Is this sender allowed? If not, dropped
3. **Cross-session dedup** -- Bot session claims first (200ms priority). If bot claimed, human drops the duplicate
4. **Trigger prefix** -- Does message start with trigger operator (e.g., `!`)? If required and missing, dropped
5. **Keyword filter** -- Does message match a keyword pattern? If not, dropped
6. **Processing** -- Only then does the bot see the message

### God Mode Scope

Controls where superuser filter bypass applies:

| Scope | DM Filter | Group Filter | Recommended For |
|-------|-----------|-------------|-----------------|
| `"all"` | Bypassed | Bypassed | Bot-only setups |
| `"dm"` | Bypassed | **Not bypassed** | Multi-session (prevents bot responding in groups uninvited) |
| `"off"` | Not bypassed | Not bypassed | Maximum safety |

### Bot Proxy Prefix

When the bot sends through a human session (cross-session routing), messages are prefixed with 🤖 so recipients know it's the bot, not the human.

**Cross-session routing** is automatic -- the bot uses its own session when it's a group member, falls back to the human session otherwise.

---

## Shutup Command (v1.14)

Mute the bot in any group directly from WhatsApp using `/shutup`. This is regex-based and does not consume LLM tokens.

- **In a group**: `/shutup` (indefinite), `/shutup 5m` / `/shutup 2h` / `/shutup 1d` (timed)
- **In a DM**: `/shutup` shows a numbered group list; reply with a number or `all`
- **Unmute**: `/unshutup` or `/unmute` (same syntax as above)
- Only superusers and allowed senders can use these commands
- Mute state is persisted in SQLite and survives restarts

---

## Troubleshooting

### 1. "Listener cannot send" error
The session is configured as `subRole: "listener"` (read-only). Use a `bot` session with `subRole: "full-access"` for sending.

### 2. "Could not resolve target" error
The target name doesn't match any contact or group. Use `search` action first to find the correct JID, then retry with the exact JID.

### 3. Session disconnected / unhealthy
Check the admin panel Status tab. Re-scan the QR code in the WAHA dashboard if needed. Health checks auto-detect recovery.

### 4. Rate limited (429) errors
The plugin retries up to 3 times with backoff (1s/2s/4s). If errors persist, reduce `rateLimitCapacity` or use `sendMulti` for bulk sends.

### 5. Messages dropped / queue overflow
Increase `dmQueueSize` or `groupQueueSize` in config (default 50 each).

### Important notes
- **API key**: Use `WHATSAPP_API_KEY`, not `WAHA_API_KEY` (wrong key returns 401)
- **LID JIDs**: WAHA NOWEB engine sends sender JIDs as `@lid`. Include BOTH `@c.us` AND `@lid` formats in `allowFrom`/`groupAllowFrom`
- **`tools.alsoAllow: ["message"]`**: Must be set or the AI agent cannot invoke actions

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

---

## License

ISC
