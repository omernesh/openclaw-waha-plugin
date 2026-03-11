# Technology Stack

**Analysis Date:** 2026-03-11

## Languages

**Primary:**
- TypeScript 5.9.3+ (devDependency) - All source code in `src/*.ts` and `index.ts`

**Secondary:**
- Python - External Whisper transcription script at `/home/omer/.openclaw/workspace/scripts/transcribe.py` (invoked via `execFile` in `src/media.ts`)

## Runtime

**Environment:**
- Node.js (ESM modules, `"type": "module"` in `package.json`)
- Runs inside the OpenClaw gateway process (`/usr/lib/node_modules/openclaw/dist/`)
- No standalone server binary; loaded as a plugin by the OpenClaw gateway at startup

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present (lockfileVersion 3)

## Frameworks

**Core:**
- OpenClaw Plugin SDK (`openclaw/plugin-sdk`) - Plugin lifecycle, channel registration, config schemas, message routing. Not listed in `package.json` dependencies (provided by the host gateway at runtime).

**Testing:**
- None detected. No test framework, no test files, no test configuration.

**Build/Dev:**
- TypeScript `^5.9.3` (devDependency) - Type checking only; the OpenClaw gateway runs `.ts` files directly (no compile step needed for deployment).

## Key Dependencies

**Critical (from `package.json`):**
- `better-sqlite3` `^11.10.0` - Native SQLite3 bindings for the contact/group directory database (`src/directory.ts`). Uses WAL mode with foreign keys.
- `zod` `^4.3.6` - Schema validation for plugin configuration (`src/config-schema.ts`, `src/secret-input.ts`).

**Host-Provided (from `openclaw/plugin-sdk`, not in package.json):**
- `ChannelPlugin`, `ChannelMessageActionAdapter` - Plugin interface types
- `OpenClawConfig`, `PluginRuntime` - Runtime and config types
- `buildChannelConfigSchema`, `createDefaultChannelRuntimeState` - Config utilities
- `DmPolicySchema`, `GroupPolicySchema`, `MarkdownConfigSchema`, `ToolPolicySchema` - Zod schemas
- `detectMime`, `sendMediaWithLeadingCaption` - Media utilities
- `readRequestBodyWithLimit`, `isRequestBodyLimitError` - HTTP utilities

## Configuration

**Environment Variables (checked at runtime):**
- `WAHA_API_KEY` - WAHA REST API key (primary auth method for default account)
- `LITELLM_API_KEY` - Vision API auth for image preprocessing (`src/media.ts`)
- `GEMINI_API_KEY` - Google Gemini API key for video preprocessing (`src/media.ts`)

**Config File:**
- `~/.openclaw/openclaw.json` on hpg6 - Main config file; plugin config lives under `channels.waha`
- `config-example.json` - Example configuration template in repo root

**Key Config Shape (from `src/types.ts` `WahaChannelConfig`):**
- `baseUrl` - WAHA HTTP API endpoint (e.g., `http://127.0.0.1:3004`)
- `apiKey` - WAHA auth key (string or secret input object with `source: "env" | "file" | "exec"`)
- `session` - WAHA session identifier (e.g., `3cf11776_logan`)
- `webhookHost/Port/Path` - Webhook listener config (defaults: `0.0.0.0:8050/webhook/waha`)
- `webhookHmacKey` - HMAC secret for webhook signature verification
- `dmPolicy` - `"pairing" | "open" | "closed" | "allowlist"` (default: `"pairing"`)
- `groupPolicy` - `"allowlist" | "open" | "closed"` (default: `"allowlist"`)
- `allowFrom` / `groupAllowFrom` / `allowedGroups` - JID-based allow lists
- `presence` - Human-like typing simulation config
- `dmFilter` - Keyword-based message filtering
- `mediaPreprocessing` - Audio/image/video/location/vcard preprocessing toggles
- `accounts` - Multi-account support (record of named account configs)
- `markdown` / `replyPrefix` / `blockStreaming` - Message formatting options

**Build:**
- No build step required. TypeScript files are loaded directly by the OpenClaw gateway runtime.

## Platform Requirements

**Development:**
- Node.js with ESM support
- npm for dependency management
- Windows (local dev) or Linux (hpg6 server) - cross-platform TypeScript

**Production:**
- Linux server (hpg6, Ubuntu-based)
- OpenClaw gateway installed globally (`/usr/lib/node_modules/openclaw/`)
- WAHA (WhatsApp HTTP API) Docker container running on same host
- systemd user service (`openclaw-gateway`) for process management
- Python 3 + Whisper for audio transcription (optional)
- better-sqlite3 native module (requires build toolchain on first install)

## Node.js Built-in Modules Used

- `node:http` - Webhook server and admin panel (`src/monitor.ts`)
- `node:fs` / `node:fs/promises` - Config file I/O, media temp files, SQLite DB path
- `node:os` - `homedir()` for config paths, `tmpdir()` for media temp storage
- `node:path` - Path manipulation
- `node:crypto` - HMAC webhook signature verification (`src/signature.ts`), random bytes for temp filenames
- `node:child_process` - `execFile` for Whisper transcription script (`src/media.ts`)
- `node:module` - `createRequire` for loading CommonJS `better-sqlite3` from ESM context (`src/directory.ts`)
- Global `fetch` - All WAHA API calls and external API calls (Node.js native fetch, no axios/node-fetch)

## Source Code Metrics

| File | Lines | Purpose |
|------|-------|---------|
| `src/monitor.ts` | 2,280 | Webhook server + admin panel (embedded HTML/JS) |
| `src/send.ts` | 1,588 | WAHA API HTTP client (~60 API wrapper functions) |
| `src/channel.ts` | 763 | Plugin adapter, action routing |
| `src/inbound.ts` | 595 | Webhook message processing |
| `src/media.ts` | 503 | Media download + AI preprocessing |
| `src/directory.ts` | 470 | SQLite contact/group directory |
| `src/presence.ts` | 174 | Human-like typing simulation |
| `src/accounts.ts` | 149 | Multi-account resolution |
| `src/dm-filter.ts` | 145 | Keyword-based message filtering |
| `src/types.ts` | 137 | TypeScript type definitions |
| `src/config-schema.ts` | 85 | Zod config validation schemas |
| `src/signature.ts` | 29 | HMAC webhook verification |
| `src/normalize.ts` | 26 | JID normalization utilities |
| `src/secret-input.ts` | 19 | Secret input schema builder |
| `src/runtime.ts` | 14 | Runtime singleton |
| `index.ts` | 17 | Plugin entry point |
| **Total** | **~7,000** | |

---

*Stack analysis: 2026-03-11*
