# OpenClaw WAHA Plugin

WhatsApp channel plugin for [OpenClaw](https://openclaw.dev) via [WAHA](https://waha.devlike.pro/) (WhatsApp HTTP API).

Receive WhatsApp messages, route them through OpenClaw AI agents, and reply with text and voice — with human-like typing simulation.

## Features

- **Webhook receiver** — HMAC-verified inbound message handling
- **Access control** — DM policies, group allowlists, per-contact settings
- **DM keyword filter** — gate messages by pattern before they reach the AI (saves tokens)
- **Human presence** — realistic read receipts, typing indicators with random pauses
- **Contact directory** — SQLite-backed contact tracking with per-DM overrides
- **Admin panel** — browser-based SPA for stats, settings, directory, and docs
- **Multi-account** — run multiple WAHA sessions from one plugin instance

## Installation

```bash
npm install waha-openclaw-channel
```

> Requires `better-sqlite3` (native addon) — ensure a C++ build toolchain is available (`node-gyp`).

## Quick Start

1. Add the WAHA channel to your `openclaw.json`:

```json
{
  "channels": {
    "waha": {
      "enabled": true,
      "baseUrl": "http://localhost:3004",
      "apiKey": "your-waha-api-key",
      "session": "your-session-name",
      "webhookPort": 8050,
      "webhookHmacKey": "your-hmac-key",
      "dmPolicy": "allowlist",
      "allowFrom": ["15551234567@c.us"]
    }
  }
}
```

2. Configure your WAHA session to send webhooks to `http://your-server:8050/webhook/waha`.

3. Restart the OpenClaw gateway. Verify with:

```bash
curl http://localhost:8050/healthz
```

4. Open the admin panel at `http://localhost:8050/admin`.

See [`config-example.json`](config-example.json) for a full configuration example.

## Documentation

| Doc | Description |
|-----|-------------|
| [Configuration](docs/configuration.md) | Full config reference with all options |
| [Admin Panel & API](docs/admin-panel.md) | Admin SPA tabs, REST endpoints |
| [DM Filter](docs/dm-filter.md) | Keyword filter setup, god mode, stats |
| [Presence System](docs/presence.md) | Human mimicry timing parameters |
| [Directory & Per-DM Settings](docs/directory.md) | Contact tracking, per-contact overrides |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Architecture

```
WAHA ──webhook──> Plugin (port 8050)
                    ├── monitor.ts    verify HMAC, parse event
                    ├── inbound.ts    access control, DM filter, presence
                    ├── AI Agent      generate reply
                    ├── presence.ts   pad typing to human speed
                    └── send.ts       deliver via WAHA REST API
                          │
WAHA <──REST API──────────┘

User sees: ✓✓ read → typing... → reply
```

## Source Files

| File | Description |
|------|-------------|
| `channel.ts` | Plugin registration, lifecycle, outbound delivery |
| `inbound.ts` | Message handler, access control, DM filter, AI dispatch |
| `monitor.ts` | Webhook server, admin panel SPA, health/stats APIs |
| `send.ts` | WAHA REST API wrappers (text, voice, reactions, presence) |
| `dm-filter.ts` | Keyword filter with regex caching and god mode |
| `presence.ts` | Human mimicry presence simulation (4-phase) |
| `directory.ts` | SQLite contact directory and per-DM settings |
| `accounts.ts` | Multi-account resolution |
| `types.ts` | TypeScript type definitions |
| `config-schema.ts` | Zod validation schema |
| `normalize.ts` | JID normalization utilities |
| `signature.ts` | HMAC webhook verification |

## License

MIT
