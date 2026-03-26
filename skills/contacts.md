# Contacts — WhatsApp Actions

> Part of the WAHA OpenClaw skill. See [SKILL.md](../SKILL.md) for overview and other categories.
>
> For sending contact cards (vCards) to chats, see the vCard section below. For media/file sends, see [messaging.md](./messaging.md).

## Actions

| Action | Parameters | Notes |
|--------|-----------|-------|
| `getContacts` | (none) | List all contacts (requires NOWEB store enabled) |
| `getContact` | contactId | Get details for a specific contact |
| `checkContactExists` | phone | Check if a phone number has WhatsApp |
| `getContactAbout` | contactId | Get a contact's "About" status text |
| `getContactPicture` | contactId | Get a contact's profile picture URL |
| `blockContact` | contactId | Block a contact |
| `unblockContact` | contactId | Unblock a contact |
| `createOrUpdateContact` | phone, firstName?, lastName?, company? | Create or update a local contact entry |

## Examples

### Check if a number has WhatsApp

```
Action: checkContactExists
Parameters: { "phone": "972544329000" }
```

Returns `{ exists: true/false }`.

### Get contact details

```
Action: getContact
Parameters: { "contactId": "972544329000@c.us" }
```

### Get contact's About text

```
Action: getContactAbout
Parameters: { "contactId": "972544329000@c.us" }
```

### Create or update a contact

```
Action: createOrUpdateContact
Parameters: {
  "phone": "972544329000",
  "firstName": "John",
  "lastName": "Doe",
  "company": "Acme"
}
```

Creates a local contact entry. If the phone already exists, updates the fields.

### Block a contact

```
Action: blockContact
Parameters: { "contactId": "972544329000@c.us" }
```

---

## Sending Contact Cards (vCards)

Three approaches to share a contact card with another user:

### Method 1: `send` with `contacts[]` — Native WhatsApp card (recommended)

```
Action: send
Target: "zeev nesher"
Parameters: {
  "contacts": [{ "fullName": "John Doe", "phoneNumber": "972544329000" }]
}
```

- Generates a native WhatsApp contact card bubble
- Supports target auto-resolution (use a name, not just JID)
- Multiple contacts: add more objects to the array
- Optional field: `organization`

### Method 2: `sendContactVcard` — Explicit chatId variant

```
Action: sendContactVcard
Parameters: {
  "chatId": "120363421825201386@g.us",
  "contacts": [{ "fullName": "John Doe", "phoneNumber": "972544329000" }]
}
```

Same as Method 1 but requires an explicit `chatId` instead of using target resolution.

### Method 3: `sendFile` with `.vcf` — File-based (for import to contacts app)

```
Action: sendFile
Parameters: {
  "chatId": "972544329000@c.us",
  "file": "/tmp/john-doe.vcf",
  "caption": "John's contact card"
}
```

Sends the `.vcf` file as a document. The recipient can tap to import it directly into their contacts app. Use this when the recipient needs to save the contact on their device.

### When to use which method

| Method | Best For |
|--------|---------|
| `send` with `contacts[]` | Sharing a contact inline — recipient taps to save |
| `sendContactVcard` | Same as above with explicit chatId |
| `sendFile` with `.vcf` | Sharing a machine-readable vCard the recipient can bulk-import |

---

## Gotchas

- **`phoneNumber` format: country code + digits, NO `+` prefix** — correct: `"972544329000"`. Wrong: `"+972544329000"`. The `+` prefix causes the action to fail silently.
- **`getContacts` requires NOWEB store enabled** — returns 400 without `config.noweb.store.enabled=True` in WAHA config. If you get a 400 error, the store is not enabled.
- **`contactId` vs `phone`** — most actions take `contactId` (e.g., `972544329000@c.us`), but `checkContactExists` and `createOrUpdateContact` take `phone` (digits only, no JID suffix).
- **`createOrUpdateContact` is local only** — it creates an entry in the local directory, not in your WhatsApp contacts list. It affects name resolution and directory search.
- **`getContactPicture` may fail for blocked contacts** — WhatsApp privacy settings can prevent picture access.
