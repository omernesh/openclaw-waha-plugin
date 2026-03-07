# Contact Directory & Per-DM Settings

## Contact Directory

The directory module (`directory.ts`) maintains a SQLite database of all contacts who have messaged the bot. Contacts are tracked automatically — no manual setup needed.

**Database location:** `~/.openclaw/data/waha-directory-{accountId}.db`

### Schema

```sql
CREATE TABLE contacts (
  jid TEXT PRIMARY KEY,
  display_name TEXT,
  first_seen_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 1,
  is_group INTEGER DEFAULT 0
);

CREATE TABLE dm_settings (
  jid TEXT PRIMARY KEY,
  mode TEXT DEFAULT 'active' CHECK(mode IN ('active','listen_only')),
  mention_only INTEGER DEFAULT 0,
  custom_keywords TEXT DEFAULT '',
  can_initiate INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (jid) REFERENCES contacts(jid)
);
```

## Per-DM Settings

Each contact can have individual overrides applied **after** the global DM filter:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mode` | `active` / `listen_only` | `active` | `listen_only`: messages tracked but bot doesn't respond |
| `mentionOnly` | `boolean` | `false` | Bot only responds if a mention pattern matches |
| `customKeywords` | `string` | `''` | Comma-separated extra trigger keywords for this contact |
| `canInitiate` | `boolean` | `true` | Whether the bot can proactively message this contact |

Manage per-DM settings via the admin panel Directory tab or the REST API:

```bash
# Get contact settings
curl http://localhost:8050/api/admin/directory/15551234567@c.us

# Update settings
curl -X PUT http://localhost:8050/api/admin/directory/15551234567@c.us/settings \
  -H "Content-Type: application/json" \
  -d '{"mode": "listen_only", "mentionOnly": true}'
```
