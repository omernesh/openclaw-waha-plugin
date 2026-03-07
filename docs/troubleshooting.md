# Troubleshooting

## WAHA API Key: Use `WHATSAPP_API_KEY`, Not `WAHA_API_KEY`

WAHA defines two keys in its `.env`. Only `WHATSAPP_API_KEY` authenticates API calls (returns 200). Using `WAHA_API_KEY` returns 401.

```bash
# Test which key works
curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Api-Key: YOUR_KEY" http://localhost:3004/api/sessions
# 200 = correct, 401 = wrong
```

## `groupAllowFrom` Needs Both `@c.us` AND `@lid`

WAHA's NOWEB engine sends group sender JIDs as `@lid`. If you only list `@c.us`, all group messages are dropped.

```json
"groupAllowFrom": ["15551234567@c.us", "123456789012345@lid"]
```

## Port 8050 Not Bound / WAHA Not Starting

The gateway reads config from the **workspace** config path (set by `OPENCLAW_CONFIG_PATH`). Verify the waha channel is present:

```bash
python3 -c "
import json
cfg = json.load(open('~/.openclaw/workspace/openclaw.json'))
print(list(cfg.get('channels',{}).keys()))
"
# Should include 'waha'
```

## Plugin ID Mismatch Warning

```
plugin id mismatch (config uses "waha-openclaw-channel", export uses "waha")
```

This is cosmetic — the plugin loads and works normally.

## Voice Files Arrive as Documents

If voice notes appear as document attachments instead of voice bubbles, check:
1. `resolveMime()` detects the audio MIME type correctly
2. The WAHA endpoint is `/api/sendVoice` (not `/api/sendFile`)
3. The payload includes `"convert": true`

## Gateway Not Responding After Restart

```bash
pgrep -af "openclaw-gateway"     # Check process
ss -tlnp | grep 8050             # Check webhook port
tail -50 /tmp/openclaw/openclaw-gateway.log | grep waha
kill -9 $(pgrep -f "openclaw-gatewa")  # Force restart (systemd auto-restarts)
```
