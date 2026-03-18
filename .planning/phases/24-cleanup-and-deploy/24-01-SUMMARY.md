---
phase: 24-cleanup-and-deploy
plan: 01
subsystem: ui
tags: [monitor, react, vite, admin-panel, cleanup]

# Dependency graph
requires:
  - phase: 18-react-scaffold
    provides: React SPA with ADMIN_DIST static file serving replacing embedded HTML
  - phase: 23-polish
    provides: Final React admin panel — all tabs complete, ready for legacy removal
provides:
  - monitor.ts without any embedded HTML/JS/CSS (~3888 lines removed)
  - /admin route with 503 fallback instead of buildAdminHtml() fallback
  - Confirmed working build pipeline (npm run build produces dist/admin/)
affects: [deploy, npm-publish, hpg6-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static file serving only: /admin route exclusively serves dist/admin/index.html with 503 if missing"

key-files:
  created: []
  modified:
    - src/monitor.ts

key-decisions:
  - "Legacy buildAdminHtml() and escapeHtml() removed — React SPA is now the only admin UI"
  - "No package.json changes needed — npm run build already chains the correct build step"
  - "/admin route returns 503 with helpful message if React build is missing (not a blank page)"

patterns-established:
  - "monitor.ts is now a pure API + webhook server — zero HTML generation"

requirements-completed:
  - CLNP-01
  - CLNP-02

# Metrics
duration: 4min
completed: 2026-03-18
---

# Phase 24 Plan 01: Cleanup and Deploy Summary

**Removed 3888 lines of legacy embedded HTML/JS/CSS from monitor.ts, leaving a pure API + webhook server at 1959 lines**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-18T18:41:54Z
- **Completed:** 2026-03-18T18:45:09Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Deleted `escapeHtml()` and `buildAdminHtml()` functions (lines 224-4111 in pre-edit file)
- monitor.ts reduced from 5847 lines to 1959 lines (-3888 lines)
- `/admin` route now returns 503 with helpful error when React build is missing (no fallback to embedded HTML)
- All 9 `/api/admin/*` route handlers verified present and intact
- React static file serving (ADMIN_DIST, ADMIN_MIME) fully preserved
- `npm run build` confirmed working — `dist/admin/index.html` produced and included in npm pack

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove legacy HTML/JS/CSS from monitor.ts** - `6da233d` (feat)
2. **Task 2: Verify build pipeline** - no commit needed (no files changed)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/monitor.ts` - Removed escapeHtml and buildAdminHtml functions; updated /admin route to return 503 without fallback

## Decisions Made
- No `package.json` changes needed — `"build": "npm run build:admin"` is already correct (gateway loads TS directly, only admin panel needs Vite build)
- Comment `// Legacy buildAdminHtml and escapeHtml removed in Phase 24...` retained at line 224 to document the removal

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- monitor.ts is clean — ready for deployment
- `npm run build` produces dist/admin/ for inclusion in npm package
- Both hpg6 deploy locations need to be updated with the new monitor.ts + dist/admin/ contents
- npm version bump and publish can proceed

---
*Phase: 24-cleanup-and-deploy*
*Completed: 2026-03-18*
