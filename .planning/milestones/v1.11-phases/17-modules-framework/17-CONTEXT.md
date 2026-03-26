# Phase 17: Modules Framework - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Create an extensible module framework for WhatsApp-specific capabilities. Developers implement the WahaModule interface, register modules, and have hooks called for assigned chats. Admin panel gets a Modules tab for enable/disable and chat assignment. Also adds bulk select to Contacts and Channels tabs (matching Groups tab pattern). No first-party modules ship — framework only.

</domain>

<decisions>
## Implementation Decisions

### Module Framework Architecture
- `WahaModule` interface: `{ id, name, description, configSchema?, onInbound?(ctx), onOutbound?(ctx) }` — hooks are optional, init via constructor
- New `src/module-registry.ts` — `registerModule(mod)`, `getModulesForChat(jid)`, `listModules()` — SQLite `module_assignments` table for chat assignments, `module_config` table for per-module settings
- Pipeline position: after fromMe+dedup+pairing/auto-reply, before LLM dispatch — modules run on messages that pass all filters
- Framework only in v1.11 — no first-party modules ship. A no-op example module can exist in tests for validation
- Modules are WhatsApp-specific — no cross-platform abstraction (MOD-06)

### Bulk Directory Actions
- Contacts tab bulk: match Groups tab exactly — checkbox per contact row, "Select" toggle button, bulk toolbar with Allow DM, Revoke DM actions
- Channels tab bulk: same pattern — checkboxes, "Select" toggle, bulk toolbar with Allow DM, Revoke DM, Follow, Unfollow actions

### Claude's Discretion
- Module config schema validation approach (Zod vs JSON Schema vs simple key-value)
- Modules tab layout and card design
- Module assignment UI — contact/group picker or simple JID input
- Bulk toolbar styling and position
- Whether module hooks receive the full message context or a filtered subset

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Groups tab bulk select: `bulkCurrentGroupJid`, checkbox creation, toolbar (Phase 10/12)
- `createContactPicker()` — contact picker with FTS5 search
- `DirectoryDb` — SQLite patterns, migration-safe ALTER TABLE
- `<details class="settings-section">` — collapsible sections
- Admin panel tab system — tab buttons and content div switching

### Established Patterns
- Tab content rendered by load* functions (loadStats, loadSessions, loadConfig, etc.)
- textContent only for user data
- Template literal double-escaping in monitor.ts
- PUT/POST API endpoints with JSON body

### Integration Points
- `inbound.ts` — module hook insertion point (after pairing/auto-reply block)
- Admin panel tab bar — add "Modules" tab between Sessions and Log
- Directory listing — add bulk select to contacts and channels

</code_context>

<specifics>
## Specific Ideas

- FEATURE-04: Module system with admin panel tab
- DIR-03: Contacts bulk edit
- DIR-05: Channels bulk edit
- Modules tab between Sessions and Log in admin panel

</specifics>

<deferred>
## Deferred Ideas

- First-party modules (channel moderator, event planner) — deferred to v1.12
- Module onOutbound hooks — optional in interface, implement when first module needs it

</deferred>
