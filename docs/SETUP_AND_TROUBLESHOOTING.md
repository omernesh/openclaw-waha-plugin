# Setup and Troubleshooting Guide

**Plugin:** OpenClaw WAHA Channel (`waha-openclaw-channel`)
**Plugin ID:** `waha`
**Version:** 1.9.0
**Last updated:** 2026-03-10

This document is the single source of truth for getting the plugin working from scratch or recovering after code changes. Every section addresses a real failure mode encountered in production.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [OpenClaw Configuration (openclaw.json)](#2-openclaw-configuration-openclawjson)
3. [Required Environment Variables](#3-required-environment-variables)
4. [Deployment Locations](#4-deployment-locations)
5. [Verified Action Test Results](#5-verified-action-test-results-2026-03-10)
6. [FAQ](#6-faq)
7. [Troubleshooting Checklist](#7-troubleshooting-checklist-run-these-in-order)
8. [Common Mistakes That Break Things](#8-common-mistakes-that-break-things)
9. [After Making Code Changes (Deployment Checklist)](#9-after-making-code-changes-deployment-checklist)

---

## 1. Prerequisites

Before installing the plugin, verify ALL of the following are in place:

| Requirement | Minimum Version | How to Verify |
|-------------|----------------|---------------|
| Node.js | 18+ | `node --version` |
| WAHA Plus | 2026.3.x | `curl http://localhost:3004/ping` |
| WAHA Engine | NOWEB | Check WAHA dashboard or session config |
| NOWEB Store | Enabled | Session config: `noweb.store.enabled: true` |
| OpenClaw Gateway | Latest | `pgrep -af "openclaw-gateway"` |
| TypeScript | 5.9+ (dev only) | `npx tsc --version` |

### WAHA Session Requirements

The WAHA instance must have at least one active session with these settings enabled:

```json
{
  "noweb": {
    "store": {
      "enabled": true,
      "fullSync": true
    },
    "markOnline": true
  }
}
```

**Why NOWEB store matters:** Without `store.enabled: true`, the WAHA Contacts API returns 400 errors, and the plugin's directory feature cannot resolve contact/group names.

### Network Requirements

- The OpenClaw gateway must be able to reach WAHA at the configured `baseUrl` (default: `http://127.0.0.1:3004`)
- WAHA must be able to reach the plugin's webhook server at `webhookPort` (default: `8050`)
- If WAHA and the gateway run on different hosts, use the LAN IP (not `localhost`)

---

## 2. OpenClaw Configuration (openclaw.json)

This is the most critical section. A misconfigured `openclaw.json` is the root cause of the majority of setup failures.

### Complete Working Configuration

```json
{
  "plugins": {
    "allow": ["waha"],
    "entries": {
      "waha": {
        "localPath": "~/.openclaw/extensions/waha"
      }
    },
    "load": {
      "paths": ["~/.openclaw/extensions/waha"]
    },
    "installs": {
      "waha": {
        "spec": "waha-openclaw-channel",
        "localPath": "~/.openclaw/extensions/waha"
      }
    }
  },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["message"]
  },
  "channels": {
    "waha": {
      "baseUrl": "http://127.0.0.1:3004",
      "apiKey": { "$env": "WHATSAPP_API_KEY" },
      "session": "3cf11776_logan",
      "webhookPort": 8050,
      "webhookPath": "/webhook/waha"
    }
  }
}
```

### Critical Settings Explained

Every setting below has caused at least one production outage or multi-hour debugging session when misconfigured:

#### `plugins.allow: ["waha"]`

The value `"waha"` must match the **plugin ID** exported by the plugin code (in `openclaw.plugin.json` and `package.json` under `openclaw.channel.id`). It must NOT be the npm package name (`waha-openclaw-channel`). The gateway uses this ID to look up the plugin at startup.

**Wrong:** `"allow": ["waha-openclaw-channel"]`
**Right:** `"allow": ["waha"]`

#### `plugins.entries`, `plugins.load.paths`, `plugins.installs`

All three must reference the same plugin ID (`waha`) and the same local path. If any of these are missing or inconsistent, the gateway will not load the plugin or will load a stale version.

- `entries` tells the gateway WHERE the plugin lives
- `load.paths` tells the gateway to LOAD it at startup
- `installs` tells the gateway how to REINSTALL it (npm spec + local path)

#### `tools.profile: "coding"`

This determines which tools the LLM is allowed to invoke. The `"coding"` profile is the standard choice but it **filters out the `message` tool by default**. This is intentional for coding-focused agents but breaks WhatsApp messaging entirely.

#### `tools.alsoAllow: ["message"]`

**THIS IS THE NUMBER ONE CAUSE OF "ACTIONS NOT WORKING" AFTER FRESH SETUP.**

The `"coding"` tools profile excludes the `message` tool. Without `alsoAllow: ["message"]`, the LLM cannot see or invoke ANY message-related actions (send, poll, react, edit, unsend, etc.). The agent will appear to understand requests but will never actually attempt to send messages.

**Symptoms when missing:**
- Agent acknowledges "I'll send that message" but nothing happens
- No errors in gateway logs (the tool is simply invisible to the LLM)
- Actions work fine when tested via curl but not through the agent

#### `channels.waha.session`

Must be the **outbound** session (e.g., `3cf11776_logan`), NOT the inbound/personal session (e.g., `3cf11776_omer`).

The `send.ts` module contains a hard guardrail (`assertAllowedSession`) that blocks any session containing `"omer"`:

```typescript
if (normalized === "omer" || normalized.endsWith("_omer")) {
    throw new Error(`WAHA session '${normalized}' is explicitly blocked by guardrail`);
}
```

Setting this to the wrong session results in all outbound messages being silently blocked with an error in gateway logs.

#### `channels.waha.apiKey: { "$env": "WHATSAPP_API_KEY" }`

The `$env` syntax tells OpenClaw to read the value from the environment variable `WHATSAPP_API_KEY` at runtime. You can also hardcode the key directly as a string, but env var resolution is preferred for security.

**Critical:** WAHA has TWO API key environment variables. Only `WHATSAPP_API_KEY` works. Using `WAHA_API_KEY` returns 401 on every request. See [Section 3](#3-required-environment-variables) for details.

---

## 3. Required Environment Variables

The gateway process (or systemd unit) must have these environment variables set:

```bash
WHATSAPP_API_KEY=<your WAHA Plus API key>
```

### The WAHA API Key Confusion

WAHA's `.env` file defines TWO different API key variables:

| Variable | Purpose | Works for Plugin? |
|----------|---------|-------------------|
| `WHATSAPP_API_KEY` | Authenticates API calls to WAHA endpoints | YES |
| `WAHA_API_KEY` | Internal WAHA authentication (different scope) | NO (returns 401) |

**How to verify you have the right key:**

```bash
# Test with your key — should return 200
curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Api-Key: YOUR_KEY_HERE" \
  http://localhost:3004/api/sessions
```

If you get `401`, you are using the wrong key. Check the WAHA `.env` file (typically at `~/docker/waha/.env` on the server) and use the value of `WHATSAPP_API_KEY`.

### Setting the Environment Variable

**For systemd service:**
```bash
sudo systemctl edit openclaw-gateway
# Add under [Service]:
# Environment=WHATSAPP_API_KEY=your_key_here
sudo systemctl daemon-reload
sudo systemctl restart openclaw-gateway
```

**For manual/shell startup:**
```bash
export WHATSAPP_API_KEY="your_key_here"
```

---

## 4. Deployment Locations

The plugin must exist in **TWO** places on the server. This is not optional. If only one location is updated, changes will be lost on gateway restart or plugin reinstall.

| Location | Purpose | When It Is Read |
|----------|---------|-----------------|
| `~/.openclaw/extensions/waha/` | **Runtime** | Gateway startup (every restart) |
| `~/.openclaw/workspace/skills/waha-openclaw-channel/` | **Workspace / Dev** | Plugin reinstalls, npm updates |

### Why Two Locations?

The gateway loads plugins from `extensions/` at startup. But when it reinstalls a plugin (e.g., after an npm update), it copies from the `workspace/skills/` directory. If you only update `extensions/`, the next reinstall overwrites your changes with the stale workspace copy.

### Deploying Changes

After modifying source files, copy to BOTH locations and restart:

```bash
# 1. Copy from workspace to runtime (or vice versa)
cp ~/.openclaw/workspace/skills/waha-openclaw-channel/src/*.ts \
   ~/.openclaw/extensions/waha/src/

# 2. Verify both copies are identical
md5sum ~/.openclaw/extensions/waha/src/*.ts
md5sum ~/.openclaw/workspace/skills/waha-openclaw-channel/src/*.ts

# 3. Restart the gateway
sudo systemctl restart openclaw-gateway
# OR: kill -9 $(pgrep -f "openclaw-gatewa") 2>/dev/null
# (systemd auto-restarts after kill)

# 4. Verify it came back up (~5 seconds)
curl -s http://127.0.0.1:8050/healthz
```

### Remote Deployment (from Windows)

TypeScript files contain `!==` and `!response.ok` which trigger bash history expansion when transferred via SSH heredocs. Always use base64 encoding:

```bash
# On Windows (Git Bash or WSL)
B64=$(base64 -w 0 /path/to/file.ts)

# Transfer to BOTH locations on server
ssh omer@100.114.126.43 "echo '$B64' | base64 -d > ~/.openclaw/extensions/waha/src/file.ts"
ssh omer@100.114.126.43 "echo '$B64' | base64 -d > ~/.openclaw/workspace/skills/waha-openclaw-channel/src/file.ts"
```

---

## 5. Verified Action Test Results (2026-03-10)

These tests were performed against WAHA 2026.3.2 with the NOWEB engine.

| Action | Status | API Endpoint | Notes |
|--------|--------|-------------|-------|
| send (DM) | PASS | `POST /api/sendText` | Text delivered to recipient |
| poll | PASS | `POST /api/sendPoll` | Native WhatsApp poll created, ~19s latency |
| react | PASS | `PUT /api/reaction` | Full messageId required (`true_chatId_shortId`) |
| edit | PASS | `PUT /api/{s}/chats/{c}/messages/{m}` | Full messageId format required |
| unsend | PASS | `DELETE /api/{s}/chats/{c}/messages/{m}` | Full messageId format required |
| getGroups | PASS | `GET /api/{s}/groups` | Returns dict (not array), plugin converts with `toArr()` |
| sendLocation | PASS | `POST /api/sendLocation` | Requires lat, lng, title fields |
| sendEvent | FAIL | `POST /api/{s}/events` | NOWEB engine limitation, returns 501 |

### Action Name Mapping

The plugin's `listActions()` method returns only **standard OpenClaw gateway action names**. Custom WAHA names are rejected by the gateway's `MESSAGE_ACTION_TARGET_MODE` registry.

| Standard Name (use this) | WAHA API Endpoint | Has Target Mode? |
|---------------------------|-------------------|------------------|
| `send` | `/api/sendText` | Yes |
| `poll` | `/api/sendPoll` | Yes |
| `react` | `/api/reaction` | Yes |
| `edit` | `/api/{s}/chats/{c}/messages/{m}` (PUT) | Yes |
| `unsend` | `/api/{s}/chats/{c}/messages/{m}` (DELETE) | Yes |
| `pin` | `/api/pinMessage` | Yes |
| `unpin` | `/api/unpinMessage` | Yes |
| `read` | `/api/sendSeen` | Yes |
| `delete` | (same as unsend) | Yes |
| `reply` | `/api/sendText` (with quoted) | Yes |

**Never add custom WAHA names** (like `sendPoll`, `editMessage`, `sendVoice`) to `listActions()`. The gateway's `MESSAGE_ACTION_TARGET_MODE` map assigns mode `"none"` to unrecognized names, which means they cannot accept targets and will fail with "Action X does not accept a target".

---

## 6. FAQ

### Actions and Messaging

**Q: Actions are not reaching the LLM / agent does not attempt to send messages**
A: Add `"alsoAllow": ["message"]` to the `tools` section of `openclaw.json`. The `"coding"` tools profile filters out the `message` tool by default. This is the single most common setup issue.

**Q: "Action X does not accept a target" error in gateway logs**
A: The action name is not in OpenClaw's `MESSAGE_ACTION_TARGET_MODE` registry. Only standard names work: `send`, `poll`, `react`, `edit`, `unsend`, `pin`, `unpin`, `read`, `delete`, `reply`. Verify that `listActions()` returns `EXPOSED_ACTIONS` (standard names), not `ALL_ACTIONS` (which includes custom WAHA names that the gateway rejects).

**Q: Plugin loads but no actions appear**
A: Two things to check: (1) `plugins.allow` must contain `"waha"` (the plugin ID), not the npm package name `"waha-openclaw-channel"`. (2) `tools.alsoAllow` must include `"message"`.

**Q: "Unknown target" error when agent tries to send**
A: The plugin's `messaging.targetResolver` is not loaded. This module recognizes WAHA JID formats (`@c.us`, `@g.us`, `@lid`, `@s.whatsapp.net`, `@newsletter`). Verify the plugin is registered in all three config sections (`allow`, `entries`, `load.paths`) and restart the gateway.

### Authentication and API

**Q: 401 Unauthorized from WAHA API**
A: You are using the wrong API key variable. Use `WHATSAPP_API_KEY`, not `WAHA_API_KEY`. Check `~/docker/waha/.env` on the server for the correct value. Test with: `curl -s -o /dev/null -w "%{http_code}" -H "X-Api-Key: YOUR_KEY" http://localhost:3004/api/sessions`

### Message Formatting

**Q: Edit/unsend returns 500 "Message id be in format..."**
A: The messageId must be in full serialized format: `true_<chatId>_<shortId>`. Example: `true_972544329000@c.us_3EB0A1B2C3D4E5F6`. Short IDs (just the hex portion) are rejected by WAHA NOWEB.

### Session and Routing

**Q: Bot sends messages from the wrong session (human instead of bot)**
A: The `session` in `channels.waha` must be the outbound session (logan). The `send.ts` guardrail (`assertAllowedSession`) blocks any session containing `"omer"`. Change the session value and restart the gateway.

### WAHA Engine Limitations

**Q: sendEvent returns 501**
A: Calendar events are not supported on the NOWEB engine. This is a WAHA limitation, not a plugin bug. The WEBJS engine supports events, but NOWEB does not.

**Q: WAHA groups API returns object instead of array**
A: This is expected behavior for the NOWEB engine. The plugin's directory code uses a `toArr()` helper that calls `Object.values()` to convert dict responses to arrays. If you are calling the API directly, wrap the response: `Object.values(response)`.

**Q: Poll votes not showing up**
A: The WAHA NOWEB engine drops more than 95% of `poll.vote` webhook events. This is a known engine limitation. The `poll.vote` event IS configured in the webhook settings, but the engine simply does not fire it reliably. Workaround: the dashboard fetches WAHA API `pollUpdates` to supplement.

### Admin Panel and Config

**Q: Config changes in admin panel do not persist**
A: The admin panel saves to `~/.openclaw/openclaw.json`. In versions before v1.8.7, it incorrectly saved to `~/.openclaw/workspace/openclaw.json`. Update to v1.8.7 or later. Also note: the gateway may read from the **workspace** config path (set by `OPENCLAW_CONFIG_PATH`). After saving in the admin panel, the config may need to be synced to the workspace path.

**Q: Gateway keeps restarting / crash loop**
A: Check if another process holds the `webhookPort` (default 8050). Run `lsof -i :8050` and kill the conflicting process. Also check gateway logs: `journalctl --user -u openclaw-gateway -f` or `sudo journalctl -u openclaw-gateway -f`.

**Q: memory-core plugin errors**
A: The `memory-core` plugin must be explicitly registered in `openclaw.json` with its own entries in `allow`, `entries`, `load.paths`, and `installs`. Without this, the agent has no memory context and may produce errors or degraded responses.

---

## 7. Troubleshooting Checklist (Run These in Order)

When something is not working, run these commands in sequence. Stop at the first failure and fix it before continuing.

```bash
# 1. Is WAHA running and reachable?
curl http://localhost:3004/ping
# Expected: {"message":"pong"} or similar 200 response

# 2. Are WAHA sessions active and in WORKING state?
curl -H "X-Api-Key: $WHATSAPP_API_KEY" http://localhost:3004/api/sessions \
  | python3 -c "import json,sys; [print(f'{s[\"name\"]}: {s[\"status\"]}') for s in json.load(sys.stdin)]"
# Expected: 3cf11776_logan: WORKING

# 3. Is the OpenClaw gateway process running?
sudo systemctl is-active openclaw-gateway
# Expected: active
# If inactive: sudo systemctl start openclaw-gateway

# 4. Is the plugin loaded? Check gateway startup logs.
sudo journalctl -u openclaw-gateway --since "5 min ago" | grep -i waha
# Expected: lines mentioning "waha" plugin loaded, webhook server started

# 5. Is the webhook port listening?
ss -tlnp | grep 8050
# Expected: LISTEN on *:8050 or 0.0.0.0:8050

# 6. Can the webhook server respond?
curl -s http://127.0.0.1:8050/healthz
# Expected: 200 OK with JSON status

# 7. Can the outbound session actually send a message?
curl -X POST http://localhost:3004/api/sendText \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $WHATSAPP_API_KEY" \
  -d '{"session":"3cf11776_logan","chatId":"972544329000@c.us","text":"test from troubleshooting"}'
# Expected: 200 with message ID

# 8. Is tools.alsoAllow configured correctly?
cat ~/.openclaw/openclaw.json \
  | python3 -c "import json,sys; c=json.load(sys.stdin); print('alsoAllow:', c.get('tools',{}).get('alsoAllow','MISSING — ADD [\"message\"]!'))"
# Expected: alsoAllow: ['message']

# 9. Is the plugin in the allow list?
cat ~/.openclaw/openclaw.json \
  | python3 -c "import json,sys; c=json.load(sys.stdin); print('allow:', c.get('plugins',{}).get('allow','MISSING'))"
# Expected: allow: ['waha'] (may include other plugins too)

# 10. Check gateway logs for action-related errors
sudo journalctl -u openclaw-gateway --since "10 min ago" \
  | grep -i "does not accept\|unknown target\|action.*error\|blocked by guardrail"
# Expected: no matches (clean logs)

# 11. Verify BOTH deployment locations have the same files
md5sum ~/.openclaw/extensions/waha/src/*.ts
md5sum ~/.openclaw/workspace/skills/waha-openclaw-channel/src/*.ts
# Expected: matching checksums for every file

# 12. Check the admin panel is accessible
curl -s -o /dev/null -w "%{http_code}" http://localhost:8050/admin
# Expected: 200
```

---

## 8. Common Mistakes That Break Things

These are ranked by frequency of occurrence. Each one has caused at least one multi-hour debugging session.

| # | Mistake | Symptom | Fix |
|---|---------|---------|-----|
| 1 | Removing `tools.alsoAllow: ["message"]` | Agent acknowledges requests but never sends messages. No errors in logs. | Add `"alsoAllow": ["message"]` to `tools` in `openclaw.json` |
| 2 | Using `WAHA_API_KEY` instead of `WHATSAPP_API_KEY` | 401 errors on every WAHA API call | Switch to `WHATSAPP_API_KEY` in env vars and config |
| 3 | Deploying to only ONE location | Changes work until next restart/reinstall, then revert | Always update BOTH `~/.openclaw/extensions/waha/` AND `~/.openclaw/workspace/skills/waha-openclaw-channel/` |
| 4 | Setting session to `omer` instead of `logan` | All outbound sends blocked. Error: "session explicitly blocked by guardrail" | Change `channels.waha.session` to the logan session |
| 5 | Changing standard action names in `listActions()` | Gateway silently rejects all actions. Agent cannot perform any messaging operations. | Return only `EXPOSED_ACTIONS` from `listActions()`, never custom WAHA names |
| 6 | Using `ALL_ACTIONS` instead of `EXPOSED_ACTIONS` | Gateway rejects custom WAHA names (sendPoll, editMessage, etc.) with "does not accept a target" | Use `EXPOSED_ACTIONS` which contains only standard gateway names |
| 7 | Removing `messaging.targetResolver` | "Unknown target" for all JID-format targets | Keep `messaging.normalizeTarget` and `messaging.targetResolver.looksLikeId` in the plugin export |
| 8 | Not restarting gateway after config changes | Old configuration remains active | Run `sudo systemctl restart openclaw-gateway` after any config edit |
| 9 | SSH-transferring TypeScript with heredocs instead of base64 | `!==` and `!response.ok` get mangled by bash history expansion, causing parse errors | Use the base64 transfer pattern (Section 4) |
| 10 | Only listing `@c.us` JIDs in `groupAllowFrom` | All group messages silently dropped (NOWEB sends `@lid` JIDs) | Add both `@c.us` AND `@lid` JIDs for each allowed user |

---

## 9. After Making Code Changes (Deployment Checklist)

Follow this checklist EVERY TIME you modify plugin source code. Skipping steps leads to subtle failures.

### Pre-Deployment

- [ ] **TypeScript compiles without errors**: Run `npx tsc --noEmit` in the plugin directory
- [ ] **Version bumped in package.json**: Increment the version number to track what is deployed
- [ ] **listActions() returns EXPOSED_ACTIONS**: Verify it does NOT return ALL_ACTIONS or custom WAHA names

### Publish (if releasing to npm)

- [ ] **npm publish**: Package name is `waha-openclaw-channel`, NOT `waha`
  ```bash
  npm publish
  ```

### Deploy to Server

- [ ] **Update BOTH locations**: Copy files to both deployment paths
  ```bash
  # From dev machine (base64 transfer for each modified file)
  B64=$(base64 -w 0 src/modified-file.ts)
  ssh omer@100.114.126.43 "echo '$B64' | base64 -d > ~/.openclaw/extensions/waha/src/modified-file.ts"
  ssh omer@100.114.126.43 "echo '$B64' | base64 -d > ~/.openclaw/workspace/skills/waha-openclaw-channel/src/modified-file.ts"
  ```

- [ ] **Verify checksums match**:
  ```bash
  ssh omer@100.114.126.43 "md5sum ~/.openclaw/extensions/waha/src/*.ts && echo '---' && md5sum ~/.openclaw/workspace/skills/waha-openclaw-channel/src/*.ts"
  ```

### Restart and Verify

- [ ] **Restart the gateway**:
  ```bash
  ssh omer@100.114.126.43 "sudo systemctl restart openclaw-gateway"
  ```

- [ ] **Wait 5 seconds, then verify plugin loaded**:
  ```bash
  ssh omer@100.114.126.43 "sudo journalctl -u openclaw-gateway --since '30 sec ago' | grep -i waha"
  ```

- [ ] **Check webhook server is up**:
  ```bash
  ssh omer@100.114.126.43 "curl -s http://127.0.0.1:8050/healthz"
  ```

### Smoke Test (minimum 3 actions)

- [ ] **Send a DM**: Have the agent send a text message to a test number
- [ ] **Create a poll**: Have the agent create a poll in a test group
- [ ] **React to a message**: Have the agent react with an emoji to a recent message

### Admin Panel

- [ ] **Check admin panel loads**: Open `http://<server>:8050/admin` in browser
- [ ] **Verify all 4 tabs render**: DM Filter, Presence, Access Control, Session Info (or equivalent tabs depending on version)
- [ ] **Check directory tab** (if applicable): Verify contacts and groups load

### If Something Goes Wrong

1. Check gateway logs: `sudo journalctl -u openclaw-gateway --since "5 min ago" | tail -50`
2. Run the [Troubleshooting Checklist](#7-troubleshooting-checklist-run-these-in-order) from step 1
3. Compare deployed files against known-working versions in git
4. Verify `openclaw.json` has not been overwritten (check `tools.alsoAllow` first)

---

## Appendix: Quick Reference Card

```
Plugin ID:          waha (NOT waha-openclaw-channel)
npm package:        waha-openclaw-channel
Webhook port:       8050
Admin panel:        http://<host>:8050/admin
Health check:       http://<host>:8050/healthz
Stats API:          http://<host>:8050/api/admin/stats
WAHA API base:      http://127.0.0.1:3004
API key env var:    WHATSAPP_API_KEY (NOT WAHA_API_KEY)
Outbound session:   3cf11776_logan (NEVER omer)
Runtime path:       ~/.openclaw/extensions/waha/
Workspace path:     ~/.openclaw/workspace/skills/waha-openclaw-channel/
Config file:        ~/.openclaw/openclaw.json
Gateway service:    openclaw-gateway (systemd)
Gateway logs:       sudo journalctl -u openclaw-gateway -f
```
