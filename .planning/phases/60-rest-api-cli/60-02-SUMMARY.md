---
phase: 60-rest-api-cli
plan: 02
subsystem: api
tags: [openapi, swagger, spectral, rest-api, documentation]

requires:
  - phase: 60-01
    provides: /api/v1/ route handlers and auth guard already wired in monitor.ts

provides:
  - OpenAPI 3.1.0 spec at src/openapi.yaml documenting all 6 /api/v1/ endpoints
  - Spectral lint config at .spectral.yaml extending spectral:oas
  - GET /openapi.yaml route serving the spec from memory (CORS-open)
  - GET /docs + GET /docs/* Swagger UI served from swagger-ui-dist package
  - 6 test assertions in tests/openapi.test.ts (YAML parse, version, paths, operationIds, BearerAuth, Spectral exit 0)

affects: [60-03, cli-integration, sdk-generation]

tech-stack:
  added: [swagger-ui-dist@5.32.1, @stoplight/spectral-cli@6.15.0]
  patterns: [hand-authored OpenAPI 3.1 YAML served as static file, createRequire for ESM swagger-ui-dist path resolution]

key-files:
  created:
    - src/openapi.yaml
    - .spectral.yaml
    - tests/openapi.test.ts
  modified:
    - src/monitor.ts
    - package.json
    - package-lock.json

key-decisions:
  - "Hand-authored YAML over code-gen — no framework means no AST to extract from, manual spec is simpler and reviewable"
  - "swagger-ui-dist bundled (not CDN) — Docker/air-gapped deployments need self-contained UI"
  - "createRequire(import.meta.url) for swagger-ui-dist path resolution — same ESM pattern as ADMIN_DIST"
  - "openapi.yaml served without auth — external tools (code-gen, linters) need unauthenticated access to the spec"
  - "Warnings-only from Spectral (operation-tags, operation-description, info-contact) — acceptable for v1; exit code 0"

patterns-established:
  - "Pattern: readFileSync(new URL('./openapi.yaml', import.meta.url)) for static file caching at startup"
  - "Pattern: createRequire + resolve('pkg/package.json') + dirname for ESM-safe package path resolution"

requirements-completed: [API-03]

duration: 20min
completed: 2026-03-28
---

# Phase 60 Plan 02: OpenAPI Spec, Spectral Lint, and Swagger UI Summary

**OpenAPI 3.1.0 spec at /openapi.yaml with BearerAuth security, Swagger UI at /docs, and Spectral lint CI gate — zero errors on lint, 6/6 tests passing.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-28T12:35:00Z
- **Completed:** 2026-03-28T12:55:41Z
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments

- Created `src/openapi.yaml` — OpenAPI 3.1.0 spec with all 6 /api/v1/ endpoints (send, messages, search, directory, sessions, mimicry), BearerAuth scheme, request/response schemas, and operationIds
- Created `.spectral.yaml` — extends `spectral:oas`, turns off `operation-tag-defined` rule
- Updated `src/monitor.ts` — added `createRequire` import, `OPENAPI_YAML` memory cache, `SWAGGER_UI_DIST` path, GET /openapi.yaml route, GET /docs Swagger UI, and GET /docs/* static asset serving with path traversal protection
- Created `tests/openapi.test.ts` — 6 tests: YAML parse, openapi version, 6 paths present, all operationIds set, BearerAuth scheme, Spectral lint exit 0
- Installed `swagger-ui-dist@5.32.1` (runtime dep) and `@stoplight/spectral-cli@6.15.0` (devDep)

## Verification

- `npx spectral lint src/openapi.yaml` → exit 0 (0 errors, 13 warnings — all acceptable)
- `npm test tests/openapi.test.ts` → 6/6 passed
- `grep 'openapi: "3.1.0"' src/openapi.yaml` → matches
- `grep -c "/api/v1/" src/openapi.yaml` → 6
- `grep "BearerAuth" src/openapi.yaml` → matches
- `npm test tests/api-v1.test.ts tests/api-v1-auth.test.ts tests/openapi.test.ts` → 36/36 passed, no regressions

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: OpenAPI spec, Spectral config, tests | 54e90b4 | src/openapi.yaml, .spectral.yaml, tests/openapi.test.ts, package.json, package-lock.json |
| Task 2: Serve from monitor.ts | 56e2a56 | src/monitor.ts |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all 6 endpoints are documented in the spec matching the live implementations from plan 60-01.

## Self-Check: PASSED
