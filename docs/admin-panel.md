# Admin Panel & API

A browser-based admin SPA served at `http://<host>:<webhookPort>/admin` (default: port 8050).

No authentication — restrict access via firewall if needed.

## Tabs

### Dashboard

Real-time overview:
- DM filter stats (allowed / dropped / tokens saved)
- Active mention patterns
- Recent filter events log
- Presence system config
- Access control policies
- Session info and uptime
- Auto-refresh every 30 seconds

### Settings

Edit all plugin config fields in the browser:
- 6 collapsible sections: Connection, Access Control, DM Filter, Presence, Markdown, Features
- Tooltip (?) on every field
- "Save Settings" writes directly to `openclaw.json`
- Toast notifications for success/error

### Directory

Contact database browser:
- Searchable contact list with avatar, name, last message time, message count
- Per-DM settings panel per contact (mode, mention-only, custom keywords)
- Pagination with "Load More"

### Docs

Built-in help with collapsible sections covering all features.

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/healthz` | Health check (returns `"ok"`) |
| `GET` | `/admin` | Admin SPA HTML |
| `GET` | `/api/admin/stats` | Dashboard stats JSON |
| `GET` | `/api/admin/config` | Full editable config |
| `POST` | `/api/admin/config` | Write config (deep merge into `openclaw.json`) |
| `GET` | `/api/admin/directory` | List contacts (`?search=&limit=&offset=`) |
| `GET` | `/api/admin/directory/:jid` | Single contact detail |
| `PUT` | `/api/admin/directory/:jid/settings` | Update per-DM settings |
| `POST` | `/webhook/waha` | WAHA webhook receiver (HMAC-verified) |

### Stats Example

```bash
curl http://localhost:8050/api/admin/stats
```

```json
{
  "dmFilter": {
    "enabled": true,
    "patterns": ["yourbot", "help"],
    "stats": { "dropped": 5, "allowed": 12, "tokensEstimatedSaved": 12500 },
    "recentEvents": [...]
  },
  "presence": { "enabled": true, "wpm": 42 },
  "access": { "dmPolicy": "pairing", "allowFrom": [...] },
  "session": "your_session_name",
  "webhookPort": 8050
}
```
