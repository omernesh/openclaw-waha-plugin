# Phase 18: React Scaffold - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Initialize the Vite + React + TypeScript + shadcn/ui + Tailwind CSS project scaffold in `src/admin/`, configure the build pipeline to output to `dist/admin/`, update monitor.ts to serve static files instead of embedded HTML strings, create the API client utility, and update package.json for the new build workflow.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `monitor.ts` — existing HTTP server with API routes at `/api/admin/*`
- `.planning/research/ui-framework-research.md` — full architecture spec, Vite config, component mapping
- `package.json` — existing npm package configuration

### Established Patterns
- Node HTTP server serves admin panel (currently embedded HTML strings)
- API routes handle all admin operations
- Dark/light theme via CSS variables (current approach)

### Integration Points
- monitor.ts: replace `getAdminPageHtml()` with static file serving from `dist/admin/`
- package.json: add `build:admin` script, update `build` to chain `tsc` + `vite build`
- npm publish: `dist/admin/` must be included in package files

</code_context>

<specifics>
## Specific Ideas

Stack is locked per research: shadcn/ui + Tailwind CSS + Vite (React SPA). See `.planning/research/ui-framework-research.md` for full architecture, Vite config, and component mapping.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
