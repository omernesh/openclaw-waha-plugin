# Phase 24: Cleanup and Deploy - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove all embedded HTML/JS/CSS from monitor.ts (the old admin panel), update the build and deploy pipeline to include Vite build output, and verify the complete React admin panel works end-to-end on hpg6.

</domain>

<decisions>
## Implementation Decisions

### Remove Legacy HTML/JS (CLNP-01)
- Remove `getAdminPageHtml()` function and all inline CSS/JS strings from monitor.ts
- Remove `buildAdminHtml()` or similar HTML-generating functions
- Keep the React fallback guard (existsSync check) but remove the old HTML fallback content
- This should reclaim ~4000+ lines from monitor.ts
- CRITICAL: Keep ALL API route handlers untouched — only remove HTML/JS serving code

### Deploy Pipeline (CLNP-02)
- `npm run build` must chain `tsc` (if applicable) + `npm run build:admin` (Vite build)
- Deploy workflow: build locally → scp dist/admin/ + src/ to BOTH hpg6 locations → restart gateway
- Document the deploy steps clearly
- Verify `npm pack` includes dist/admin/ in the tarball

### Claude's Discretion
- Whether to keep the fallback guard as a safety net or remove it entirely
- Exact deploy script format (shell script vs documented steps)

</decisions>

<code_context>
## Existing Code Insights

### Key File
- `src/monitor.ts` — contains both API routes (KEEP) and embedded HTML/JS admin panel (REMOVE)
- The React static file serving was added in Phase 18 (existsSync guard + fallback)

### What to Remove
- `getAdminPageHtml()` or `buildAdminHtml()` function(s)
- All CSS template strings for the old admin panel
- All JS template strings for the old admin panel
- Tab rendering functions (buildDashboardTab, buildSettingsTab, etc.)
- Helper functions only used by the old HTML panel

### What to Keep
- HTTP server setup
- All `/api/admin/*` route handlers
- Webhook processing
- Static file serving (from Phase 18)
- CORS headers, auth

</code_context>

<specifics>
## Specific Ideas

Be very careful with monitor.ts — it's a large file with many DO NOT CHANGE markers. Read the entire file before making any changes. The goal is surgical removal of HTML generation code while preserving all API logic.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
