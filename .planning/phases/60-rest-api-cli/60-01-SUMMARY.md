---
phase: 60-rest-api-cli
plan: 01
subsystem: api
tags: [rest-api, bearer-auth, cors, timing-safe, mimicry, directory, sessions]

requires:
  - phase: 55-claude-code-integration
    provides: handleProxySend for /api/v1/send route
  - phase: 57-admin-ui-observability
    provides: getCapStatus mimicry read-only API pattern

provides:
  - Public REST API at /api/v1/* with 6 endpoints (send, messages, search, directory, sessions, mimicry)
  - Bearer token auth guard with timing-safe comparison (requirePublicApiAuth)
  - CORS support for external browser clients (setCorsHeaders, handleCorsPreflightIfNeeded)
  - publicApiKey config field for per-deployment API key configuration

affects: [61-cli, 62-mcp-server, any external integrations]

tech-stack:
  added: []
  patterns:
    - "Timing-safe Bearer token auth using node:crypto timingSafeEqual"
    - "CORS preflight handled before auth guard (OPTIONS bypass pattern)"
    - "TDD RED→GREEN: failing tests before implementation"

key-files:
  created:
    - src/api-v1.ts
    - src/api-v1-auth.ts
    - tests/api-v1.test.ts
    - tests/api-v1-auth.test.ts
  modified:
    - src/monitor.ts
    - src/config-schema.ts

key-decisions:
  - "CORS preflight (OPTIONS) handled before auth guard so preflight works without a token"
  - "Open access when no publicApiKey configured (backward compat for local deployments)"
  - "getCapStatus used for /api/v1/mimicry — read-only, never checkAndConsumeCap"
  - "readBodyString implemented inline in api-v1.ts to avoid circular dep with monitor.ts"
  - "setCorsHeaders called in writeJson helper — ensures CORS on every response including errors"

requirements-completed: [API-01, API-02, API-04]

duration: 12min
completed: 2026-03-28
---

# Phase 60 Plan 01: REST API v1 Layer Summary

**6-endpoint public REST API at /api/v1/ with timing-safe Bearer auth and CORS, wired into monitor.ts alongside existing admin routes**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-28T12:23:03Z
- **Completed:** 2026-03-28T12:35:12Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- 6 REST endpoints at /api/v1/: send (proxied through mimicry enforcement), messages, search, directory, sessions, mimicry status
- Auth guard with timing-safe Bearer token comparison (timingSafeEqual from node:crypto) and env var fallback
- CORS support: OPTIONS preflight returns 204, all responses include Access-Control-Allow-Origin header
- 30 new tests (16 auth + 14 route handlers), all passing; full suite: 713 tests, no regressions

## Task Commits

1. **Task 1: API auth guard, CORS helpers, and publicApiKey config** - `c313c57` (feat)
2. **Task 2: API v1 route handlers and monitor.ts wiring** - `af0b423` (feat)

**Plan metadata:** (pending)

## Files Created/Modified

- `src/api-v1-auth.ts` - requirePublicApiAuth (timing-safe), setCorsHeaders, handleCorsPreflightIfNeeded
- `src/api-v1.ts` - handleApiV1Request with all 6 route handlers
- `src/monitor.ts` - Import and route block for /api/v1/* (before admin auth guard)
- `src/config-schema.ts` - publicApiKey field added to WahaConfigSchema
- `tests/api-v1-auth.test.ts` - 16 tests for auth guard and CORS helpers
- `tests/api-v1.test.ts` - 14 tests for all 6 route handlers with mocked dependencies

## Decisions Made

- CORS preflight handled before auth guard — OPTIONS requests must not require a token
- Open access when no key configured — backward compatible for local/private deployments
- getCapStatus (read-only) used for mimicry endpoint — never checkAndConsumeCap
- Inline readBodyString in api-v1.ts to avoid circular import with monitor.ts
- setCorsHeaders called in writeJson helper so CORS headers appear on every response, including errors

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- npm install for Phase 60 deps failed due to vite peer dep conflict; all deps (commander, chalk, cli-table3) were already installed — no action needed
- Mimicry test mock needed getMimicryDb, getMaturityPhase, resolveCapLimit in addition to getCapStatus — fixed inline (Rule 1 auto-fix: test mock completeness)

## Next Phase Readiness

- /api/v1/* endpoints are live and accessible from external callers
- CLI tool (plan 60-02) can call POST /api/v1/send and GET /api/v1/sessions directly
- MCP server (phase 61) can use the same API surface
- publicApiKey config field ready for use in any deployment configuration

## Self-Check: PASSED

- FOUND: src/api-v1.ts
- FOUND: src/api-v1-auth.ts
- FOUND: tests/api-v1.test.ts
- FOUND: tests/api-v1-auth.test.ts
- FOUND: commit c313c57 (Task 1)
- FOUND: commit af0b423 (Task 2)
- 713 tests passing, no regressions

---
*Phase: 60-rest-api-cli*
*Completed: 2026-03-28*
