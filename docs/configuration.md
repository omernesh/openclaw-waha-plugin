# Configuration Reference

All configuration lives in `openclaw.json` under `channels.waha`.

## Full Config Structure

```jsonc
{
  "channels": {
    "waha": {
      // --- Connection ---
      "enabled": true,
      "baseUrl": "http://127.0.0.1:3004",
      "apiKey": "your-api-key",            // Use WHATSAPP_API_KEY, not WAHA_API_KEY
      "session": "your_session_name",

      // --- Webhook Server ---
      "webhookHost": "0.0.0.0",
      "webhookPort": 8050,
      "webhookPath": "/webhook/waha",
      "webhookHmacKey": "your-hmac-key",

      // --- Access Control ---
      "dmPolicy": "allowlist",             // "pairing" | "open" | "closed" | "allowlist"
      "groupPolicy": "allowlist",          // "allowlist" | "open" | "closed"
      "allowFrom": [
        "15551234567@c.us",
        "123456789012345@lid"
      ],
      "groupAllowFrom": [
        "15551234567@c.us",
        "123456789012345@lid"              // NOWEB sends @lid — include BOTH formats
      ],
      "allowedGroups": [
        "120363000000000000@g.us"
      ],

      // --- DM Filter ---
      "dmFilter": {
        "enabled": true,
        "mentionPatterns": ["yourbot", "help"],
        "godModeBypass": true,
        "godModeSuperUsers": [
          { "identifier": "15551234567", "platform": "whatsapp" }
        ],
        "tokenEstimate": 2500
      },

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
      "actions": { "reactions": true },
      "markdown": { "enabled": true, "tables": "auto" },
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

## Access Control

### DM Policy

| Policy | Behavior |
|--------|----------|
| `pairing` | Unknown senders get a pairing code |
| `open` | Everyone can DM |
| `closed` | No DMs accepted |
| `allowlist` | Only JIDs in `allowFrom` |

### Group Policy

| Policy | Behavior |
|--------|----------|
| `allowlist` | Only senders in `groupAllowFrom` (filters by sender, not group) |
| `open` | All group messages |
| `closed` | No group messages |

### Important: `@lid` JIDs

WAHA's NOWEB engine sends sender JIDs as `@lid` (linked device ID), not `@c.us`. You **must** include both formats for each allowed user:

```json
"groupAllowFrom": ["15551234567@c.us", "123456789012345@lid"]
```

### Finding a User's LID

```bash
docker exec -i postgres-waha psql -U admin -d waha_noweb_your_session \
  -c "SELECT id, pn FROM lid_map WHERE pn LIKE '%PHONE_NUMBER%'"
```

## Session Guardrail

Only sessions named `bot` or `*_bot` can send outbound messages. The plugin blocks sending as the owner's personal session to prevent accidental misuse.
