# Phase 26: Config Safety - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add config validation, backup rotation, and export/import to the admin panel config system. Prevents config corruption from bad saves and enables config portability.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase with clear requirements:
- CFG-01: Validate POST /api/admin/config against Zod schema (WahaConfigSchema from config-schema.ts) before writing to disk
- CFG-02: Return structured field-level validation errors as JSON response (not generic 500)
- CFG-03: Before each save, back up current config. Keep last 3 backups (rotate oldest). Store as openclaw.json.bak.1, .bak.2, .bak.3
- CFG-04: GET /api/admin/config/export — returns full openclaw.json as downloadable JSON
- CFG-05: POST /api/admin/config/import — accepts full JSON, validates against schema, replaces config
- Config save path: ~/.openclaw/openclaw.json (CRITICAL — must not change)
- POST /api/admin/config expects {"waha": {...}} wrapper (CRITICAL — must preserve)
- Sensitive fields (session, apiKey, webhookHmacKey) must be preserved during config merges

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `config-schema.ts` — Zod schemas (WahaConfigSchema, WahaAccountSchemaBase, DmFilterSchema)
- `monitor.ts` — existing POST /api/admin/config handler with sensitive field preservation
- `http-client.ts` — writeJsonResponse, readBody helpers

### Established Patterns
- Config read: readConfigFile() from runtime
- Config write: fs.writeFileSync to ~/.openclaw/openclaw.json
- Admin routes use {const m = req.method === "..." && req.url?.match(...)} pattern
- Error responses use writeWebhookError(res, statusCode, message)

### Integration Points
- monitor.ts — add validation to existing POST handler, add new export/import routes
- React admin panel — surface validation errors in SettingsTab
- config-schema.ts — may need to export validation function

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard infrastructure implementation.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
