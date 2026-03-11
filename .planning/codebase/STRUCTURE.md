# Codebase Structure

**Analysis Date:** 2026-03-11

## Directory Layout

```
waha-oc-plugin/
├── src/                    # All TypeScript source files
│   ├── channel.ts          # Plugin adapter, action routing (763 lines)
│   ├── send.ts             # WAHA API HTTP client (1588 lines)
│   ├── inbound.ts          # Webhook message processing (595 lines)
│   ├── monitor.ts          # Webhook server + admin panel (2280 lines)
│   ├── directory.ts        # SQLite contact/group directory (470 lines)
│   ├── media.ts            # Media download/preprocessing (503 lines)
│   ├── presence.ts         # Typing simulation (174 lines)
│   ├── accounts.ts         # Multi-account resolution (149 lines)
│   ├── dm-filter.ts        # Keyword message filter (145 lines)
│   ├── types.ts            # TypeScript type definitions (137 lines)
│   ├── config-schema.ts    # Zod config schemas (85 lines)
│   ├── signature.ts        # Webhook HMAC verification (29 lines)
│   ├── normalize.ts        # JID/target normalization (26 lines)
│   ├── secret-input.ts     # Secret input utilities (19 lines)
│   └── runtime.ts          # Runtime singleton (14 lines)
├── docs/                   # User-facing documentation
│   ├── PRD.md              # Product requirements
│   ├── ROADMAP.md          # Development roadmap
│   ├── LESSONS_LEARNED.md  # Bug history and lessons
│   ├── admin-panel.md      # Admin panel docs
│   ├── configuration.md    # Config reference
│   ├── directory.md        # Directory feature docs
│   ├── dm-filter.md        # DM filter docs
│   ├── presence.md         # Presence simulation docs
│   ├── troubleshooting.md  # Troubleshooting guide
│   ├── SETUP_AND_TROUBLESHOOTING.md
│   └── whatsapp-actions.md # Action reference
├── skills/                 # OpenClaw skill definitions
│   └── whatsapp-messenger/ # Companion skill for Claude Code
│       └── SKILL.md
├── .planning/              # GSD project planning
│   ├── PROJECT.md
│   ├── REQUIREMENTS.md
│   ├── ROADMAP.md
│   ├── STATE.md
│   ├── config.json
│   ├── research/           # Research documents
│   ├── phases/             # Phase planning
│   └── codebase/           # Codebase analysis (this directory)
├── index.ts                # Plugin entry point (17 lines)
├── package.json            # npm manifest
├── package-lock.json       # Lockfile
├── SKILL.md                # Agent-facing documentation (LLM reads this)
├── CLAUDE.md               # Claude Code project instructions
├── README.md               # npm README
├── WAHA_PLUGIN_README.md   # Additional README
├── config-example.json     # Example configuration
└── .gitignore
```

## Directory Purposes

**`src/`:**
- Purpose: All plugin source code (TypeScript, ESM)
- Contains: 15 `.ts` files totaling ~6,977 lines
- Key files: `channel.ts` (plugin interface), `send.ts` (API client), `inbound.ts` (message processing), `monitor.ts` (webhook server + admin UI)

**`docs/`:**
- Purpose: User-facing documentation for the plugin
- Contains: Markdown files covering configuration, features, troubleshooting
- Key files: `docs/PRD.md`, `docs/ROADMAP.md`, `docs/LESSONS_LEARNED.md`

**`skills/`:**
- Purpose: OpenClaw skill definitions (companion tools)
- Contains: `whatsapp-messenger/SKILL.md` — a Claude Code skill for sending WhatsApp messages via WAHA API

**`.planning/`:**
- Purpose: GSD project planning artifacts
- Contains: Project state, requirements, roadmap, research, phase plans, codebase analysis

## Key File Locations

**Entry Points:**
- `index.ts`: Plugin registration — imports `wahaPlugin` from `src/channel.ts`, registers with OpenClaw gateway
- `src/channel.ts`: Main plugin definition — `wahaPlugin` object, `handleAction()`, all action routing
- `src/monitor.ts`: Webhook HTTP server entry via `monitorWahaProvider()`

**Configuration:**
- `src/config-schema.ts`: Zod schemas for all plugin config fields
- `src/types.ts`: TypeScript types for config, webhook envelopes, inbound messages
- `config-example.json`: Example configuration for users

**Core Logic:**
- `src/send.ts`: All WAHA REST API calls (60+ functions)
- `src/inbound.ts`: Inbound message processing pipeline (access control, filtering, media, reply dispatch)
- `src/monitor.ts`: Webhook server, admin panel API routes, embedded admin UI HTML/JS
- `src/directory.ts`: SQLite database for contact/group tracking

**Supporting Logic:**
- `src/accounts.ts`: Multi-account config resolution, API key resolution
- `src/media.ts`: Media download and preprocessing (audio, image, video, vCard, location, document)
- `src/dm-filter.ts`: Keyword-based message filtering class
- `src/presence.ts`: Human-like typing simulation controller
- `src/normalize.ts`: JID string normalization and allowlist matching
- `src/signature.ts`: HMAC-SHA512 webhook signature verification
- `src/secret-input.ts`: Secret input schema builder (re-exports from SDK)
- `src/runtime.ts`: Module-level runtime singleton

**Agent Documentation:**
- `SKILL.md`: What the AI agent (LLM) reads to understand available actions

## Naming Conventions

**Files:**
- `kebab-case.ts`: All source files use kebab-case (e.g., `config-schema.ts`, `dm-filter.ts`, `secret-input.ts`)
- Single-word files are lowercase: `channel.ts`, `send.ts`, `inbound.ts`, `types.ts`

**Exports:**
- Functions: `camelCase` prefixed with `waha` or action verb (e.g., `sendWahaText`, `resolveWahaAccount`, `handleWahaInbound`)
- Types: `PascalCase` (e.g., `CoreConfig`, `WahaInboundMessage`, `ResolvedWahaAccount`, `DirectoryDb`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `STANDARD_ACTIONS`, `DEFAULT_WEBHOOK_PORT`, `CHANNEL_ID`)

**Directories:**
- Flat `src/` directory: no subdirectories, all source files at one level
- `docs/` for user documentation, `skills/` for companion skill definitions

## Where to Add New Code

**New WAHA API endpoint wrapper:**
- Add the function to `src/send.ts` following the existing pattern (use `callWahaApi()`, accept `{ cfg, ..., accountId }` params)
- Add the action handler entry to `ACTION_HANDLERS` map in `src/channel.ts`
- If it should be LLM-visible, add to `UTILITY_ACTIONS` array in `src/channel.ts`
- If it needs target resolution, it MUST use a standard action name (send, poll, etc.) — custom names get mode "none"

**New inbound message type processing:**
- Add preprocessing logic to `src/media.ts` if it involves media content analysis
- Add the `needsPreprocessing` check in `src/inbound.ts` (around line 144)
- Add summary formatting in `src/inbound.ts` (around line 252, where `rawBody` is assembled)

**New filter or access control logic:**
- DM/group filters: extend `src/dm-filter.ts` or add new filter class following same pattern
- Access control: modify the chain in `src/inbound.ts` `handleWahaInbound()` (lines 290-426)

**New admin panel API route:**
- Add route handler in `src/monitor.ts` inside the request handler function
- Follow existing pattern: `if (pathname === "/api/admin/newroute") { ... writeJsonResponse(...); return; }`
- Admin UI changes: modify the embedded HTML/JS string in `buildAdminHtml()` in `src/monitor.ts`

**New configuration fields:**
- Add TypeScript type to `src/types.ts` (`WahaAccountConfig` or `WahaChannelConfig`)
- Add Zod schema to `src/config-schema.ts`
- Access via `account.config.newField` after resolution in `src/accounts.ts`

**New utility module:**
- Create `src/new-module.ts` in the flat `src/` directory
- Use kebab-case naming
- Export functions with `camelCase` names prefixed appropriately
- Import in consuming files with `.js` extension (ESM): `import { foo } from "./new-module.js"`

## Special Directories

**`node_modules/`:**
- Purpose: npm dependencies (better-sqlite3, zod, typescript)
- Generated: Yes (via `npm install`)
- Committed: No (in `.gitignore`)

**`dist/`:**
- Purpose: Not present — this project runs TypeScript directly (no build step)
- Generated: N/A
- Committed: N/A

**`.planning/`:**
- Purpose: GSD project planning documents
- Generated: By GSD commands
- Committed: Yes (tracked in git)

## Import Conventions

**Import order (observed pattern):**
1. Node.js built-ins (`node:http`, `node:fs`, `node:os`, `node:path`, `node:crypto`)
2. OpenClaw SDK imports (`openclaw/plugin-sdk`)
3. Local module imports (`./accounts.js`, `./send.js`, etc.)

**Path aliases:** None — all imports use relative paths with `.js` extension (ESM requirement).

**ESM requirement:** All local imports MUST use `.js` extension even though source files are `.ts`. The project uses `"type": "module"` in `package.json`.

---

*Structure analysis: 2026-03-11*
