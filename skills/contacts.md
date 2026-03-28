# Contacts — Chatlytics WhatsApp

> Part of the Chatlytics WhatsApp skill. See [SKILL.md](../SKILL.md) for overview and other categories.
>
> For sending contact cards (vCards) to chats, see the vCard section below. For media/file sends, see [messaging.md](./messaging.md).

**MCP tool:** `get_directory` (for listing/search), `send_message` (for sending vCards)

## Actions

| Action | REST Endpoint | Parameters | Notes |
|--------|--------------|-----------|-------|
| List contacts | `GET /api/v1/directory?type=contact` | search? | List all contacts (requires NOWEB store enabled) |
| Get contact | `GET /api/v1/directory/{contactId}` | contactId | Get details for a specific contact |
| Check exists | (manage endpoint) | phone | Check if a phone number has WhatsApp |
| Get about text | (manage endpoint) | contactId | Get a contact's "About" status text |
| Get picture | (manage endpoint) | contactId | Get a contact's profile picture URL |
| Block contact | (manage endpoint) | contactId | Block a contact |
| Unblock contact | (manage endpoint) | contactId | Unblock a contact |
| Create/update contact | (manage endpoint) | phone, firstName?, lastName?, company? | Create or update a local contact entry |

## Examples

### List contacts (REST)

```bash
curl "http://localhost:8050/api/v1/directory?type=contact&search=john" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

### Check if a number has WhatsApp

```json
{ "action": "checkContactExists", "phone": "972544329000" }
```

Returns `{ exists: true/false }`.

### Get contact details

```bash
curl "http://localhost:8050/api/v1/directory/972544329000@c.us" \
  -H "Authorization: Bearer ctl_YOUR_API_KEY"
```

### Create or update a contact

```json
{
  "action": "createOrUpdateContact",
  "phone": "972544329000",
  "firstName": "John",
  "lastName": "Doe",
  "company": "Acme"
}
```

Creates a local contact entry. If the phone already exists, updates the fields.

### Block a contact

```json
{ "action": "blockContact", "contactId": "972544329000@c.us" }
```

---

## Sending Contact Cards (vCards)

Three approaches to share a contact card:

### Method 1: `send_message` with `contacts[]` — Native WhatsApp card (recommended)

```bash
curl -X POST http://localhost:8050/api/v1/send \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "972544329000@c.us",
    "contacts": [{ "fullName": "John Doe", "phoneNumber": "972544329000" }]
  }'
```

- Generates a native WhatsApp contact card bubble
- Multiple contacts: add more objects to the array
- Optional field: `organization`

### Method 2: Explicit chatId variant

```json
{
  "action": "sendContactVcard",
  "chatId": "120363421825201386@g.us",
  "contacts": [{ "fullName": "John Doe", "phoneNumber": "972544329000" }]
}
```

Same as Method 1 but with explicit chatId parameter.

### Method 3: `send-media` with `.vcf` — File-based (for import to contacts app)

```bash
curl -X POST http://localhost:8050/api/v1/send-media \
  -H "Authorization: Bearer ctl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "972544329000@c.us",
    "mediaUrl": "/tmp/john-doe.vcf",
    "type": "file",
    "caption": "John'\''s contact card"
  }'
```

Sends the `.vcf` file as a document. The recipient can tap to import it directly into their contacts app.

### When to use which method

| Method | Best For |
|--------|---------|
| `send` with `contacts[]` | Sharing a contact inline — recipient taps to save |
| `sendContactVcard` | Same as above with explicit chatId |
| `send-media` with `.vcf` | Sharing a machine-readable vCard the recipient can bulk-import |

---

## Gotchas

- **`phoneNumber` format: country code + digits, NO `+` prefix** — correct: `"972544329000"`. Wrong: `"+972544329000"`. The `+` prefix causes the action to fail silently.
- **`getContacts` requires NOWEB store enabled** — returns 400 without `config.noweb.store.enabled=True` in WAHA config. If you get a 400 error, the store is not enabled.
- **`contactId` vs `phone`** — most actions take `contactId` (e.g., `972544329000@c.us`), but `checkContactExists` and `createOrUpdateContact` take `phone` (digits only, no JID suffix).
- **`createOrUpdateContact` is local only** — it creates an entry in the local directory, not in your WhatsApp contacts list. It affects name resolution and directory search.
- **`getContactPicture` may fail for blocked contacts** — WhatsApp privacy settings can prevent picture access.
