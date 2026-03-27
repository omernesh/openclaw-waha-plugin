# Phase 57: Admin UI & Observability - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Add mimicry system visibility and configuration to the admin panel: a dashboard card showing gate status/cap usage/maturity phase per session, settings inputs for send window and caps, and a REST API endpoint for programmatic access.

</domain>

<decisions>
## Implementation Decisions

### API Endpoint
- `GET /api/admin/mimicry` returns JSON with per-session gate open/closed, cap usage (current/max), maturity phase label, days until next phase
- Uses existing `requireAdminAuth()` Bearer token auth
- Data sourced from MimicryDb (cap usage, maturity) + resolveGateConfig + checkTimeOfDay (gate status)

### Dashboard UI
- New "Send Gates" card on the dashboard/status tab
- Per-session layout: maturity phase label, days until next upgrade, hourly cap usage bar (N/max), gate open/closed badge
- Follows existing admin panel patterns (React, shadcn/ui, Tailwind)

### Settings UI
- New section in the Config tab for mimicry settings
- Inputs: send window start/end hours (number inputs 0-23), timezone selector (text input, IANA string), hourly cap limit (number)
- Progressive limits table: New/Warming/Stable rows with editable cap values
- Save via existing POST /api/admin/config with `{"waha": {sendGate: {...}, hourlyCap: {...}}}` wrapper

### Claude's Discretion
- Exact card layout and styling
- How to display maturity phase progression
- Whether to use a dropdown or text input for timezone
- Table formatting for progressive limits

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Admin panel React app in `src/admin/` — shadcn/ui + Tailwind + Vite
- Existing tabs: Directory, Config, Filter Stats, Status
- `requireAdminAuth()` in monitor.ts for all admin routes
- `MimicryDb` in `src/mimicry-gate.ts` — maturity phases, cap tracking
- `resolveGateConfig()` + `checkTimeOfDay()` for gate status computation
- POST `/api/admin/config` for saving config changes

### Integration Points
- `src/monitor.ts` — add GET /api/admin/mimicry route
- `src/admin/` — add dashboard card component + settings section
- `src/mimicry-gate.ts` — expose query methods for current cap usage and maturity info

</code_context>

<deferred>
## Deferred Ideas

None

</deferred>
