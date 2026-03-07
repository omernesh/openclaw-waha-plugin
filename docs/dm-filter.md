# DM Keyword Filter

Gates inbound DMs by keyword **before** they reach the AI agent. Messages that don't match any pattern are silently dropped — no reply, no error. This saves AI tokens on irrelevant messages.

## Config

```json
"dmFilter": {
  "enabled": true,
  "mentionPatterns": ["yourbot", "help", "hello"],
  "godModeBypass": true,
  "godModeSuperUsers": [
    { "identifier": "15551234567", "platform": "whatsapp" }
  ],
  "tokenEstimate": 2500
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable/disable the filter |
| `mentionPatterns` | `string[]` | `[]` | Case-insensitive regex patterns. Message must match at least one. Empty = no restriction. |
| `godModeBypass` | `boolean` | `true` | Super-users bypass the filter |
| `godModeSuperUsers` | `array` | `[]` | Users who bypass (phone in E.164 or JID format) |
| `tokenEstimate` | `number` | `2500` | Estimated tokens saved per dropped message (for stats) |

## Behavior

- **Filter disabled or no patterns**: all messages pass through
- **God mode**: super-users bypass pattern matching entirely (handles Israeli phone normalization: 05X/972X/+972X)
- **Pattern match**: message allowed if ANY pattern matches (case-insensitive regex)
- **No match**: message silently dropped
- **Error**: fail-open — any filter error allows the message through

## Stats

Runtime counters per account:
- `dropped` / `allowed` / `tokensEstimatedSaved`
- Recent events log (last 50) with timestamp, pass/fail, reason, text preview

Viewable in the admin panel Dashboard tab or via `GET /api/admin/stats`.
