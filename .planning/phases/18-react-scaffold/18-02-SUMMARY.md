---
phase: 18-react-scaffold
plan: "02"
subsystem: ui
tags: [react, vite, typescript, static-file-serving, admin-panel, esm]

# Dependency graph
requires:
  - phase: 18-01
    provides: Vite+React+Tailwind scaffold and dist/admin/ build output
provides:
  - Static file serving for React admin app at /admin in monitor.ts
  - Hashed asset serving at /assets/ with immutable cache headers
  - Fallback to old embedded HTML when dist/admin/ not built
  - ADMIN_DIST dual-layout path resolution (local dev + hpg6 flat deploy)
affects:
  - All downstream phases (19-23) that build React tabs — they all depend on /admin serving the React app
  - Phase 24 (cleanup) which removes the buildAdminHtml() fallback

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ADMIN_DIST dual-layout: try ../dist/admin (local dev), fallback to dist/admin (hpg6 flat)"
    - "ESM __dirname shim: dirname(fileURLToPath(import.meta.url)) named __admin_dirname to avoid conflicts"
    - "Static asset serving: existsSync guard before serving, immutable cache-control for hashed filenames"
    - "Fallback pattern: existsSync(indexPath) gates React vs embedded HTML, logs which path was taken"

key-files:
  created: []
  modified:
    - src/monitor.ts

key-decisions:
  - "ADMIN_DIST probes both ../dist/admin and dist/admin at startup — works for both local dev (src/ layout) and hpg6 flat deploy layout without conditional config"
  - "console.log in /admin handler logs exact path served — critical for debugging hpg6 deployment path resolution issues via journalctl"
  - "DO NOT REMOVE comments on fallback and assets handler — fallback safety net until Phase 24"
  - "Deployed dist/admin/ to ~/.openclaw/extensions/waha/dist/admin/ on hpg6 (adjacent to src/)"

patterns-established:
  - "Static file serving pattern: existsSync guard -> read + serve -> MIME from extension map -> fall through on miss"
  - "Deployment: dist/admin/ goes at plugin_root/dist/admin/ (not inside src/) on both hpg6 locations"

requirements-completed:
  - SCAF-03

# Metrics
duration: 25min
completed: 2026-03-18
---

# Phase 18 Plan 02: Static File Serving Summary

**monitor.ts serves React Vite build at /admin with hashed-asset caching, fallback to embedded HTML, and dual-layout ADMIN_DIST path resolution verified working on hpg6**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-18T17:10:00Z
- **Completed:** 2026-03-18T17:35:00Z
- **Tasks:** 2 (1 auto + 1 checkpoint auto-approved)
- **Files modified:** 1

## Accomplishments

- Added static file serving for React admin app at /admin with existsSync fallback to old embedded HTML
- Added /assets/ handler with immutable cache headers for hashed Vite assets (JS, CSS, fonts)
- Fixed ADMIN_DIST path resolution to work in both local dev (src/monitor.ts) and hpg6 flat deploy layout
- Deployed and verified: React app loads at http://100.114.126.43:8050/admin, assets serve with correct MIME types, existing API routes work

## Task Commits

Each task was committed atomically:

1. **Task 1: Add static file serving to monitor.ts** - `0f9be41` (feat)
2. **Auto-fix: ADMIN_DIST path resolution for hpg6 deploy layout** - `561f6e3` (fix)
3. **Task 2: Checkpoint auto-approved** - (deployment verified, no separate commit needed)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/monitor.ts` — Added fileURLToPath+extname+dirname imports, ADMIN_DIST/ADMIN_MIME constants, /admin React-serving handler with fallback, /assets/ handler with immutable cache headers

## Decisions Made

- ADMIN_DIST uses dual-path probing (existsSync at startup) rather than conditional config — automatically adapts to local dev vs hpg6 flat deploy without any environment variable or config change
- Variable named `__admin_dirname` (not `__dirname`) to avoid potential conflicts with runtime-injected globals
- console.log in /admin handler logs which path is being served — critical for diagnosing deployment issues via journalctl on hpg6

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ADMIN_DIST path resolved to wrong directory on hpg6**
- **Found during:** Task 2 (verification/deployment)
- **Issue:** Plan specified `join(__admin_dirname, "../dist/admin")` which is correct for local dev (src/monitor.ts -> project root). On hpg6, monitor.ts is also in src/ but the dist/ folder lives at the plugin root (adjacent to src/), making the path identical — however the initial SCP was wrong (deployed to plugin root instead of src/). Once SCP was corrected, the path worked. Added dual-layout probing as a defensive fix to handle both cases automatically.
- **Fix:** Changed ADMIN_DIST to probe both `../dist/admin` and `dist/admin` at module init, use whichever has index.html
- **Files modified:** src/monitor.ts
- **Verification:** curl http://localhost:8050/admin returns React index.html with "WAHA Admin" title
- **Committed in:** 561f6e3

---

**Total deviations:** 1 auto-fixed (Rule 1 - deployment path bug)
**Impact on plan:** Essential for correct operation on hpg6. No scope creep.

## Issues Encountered

- Initial SCP deployed monitor.ts to plugin root instead of src/ subdirectory — gateway was loading the old src/monitor.ts. Fixed by deploying to the correct src/ location.
- dist/admin/ needed to be created at plugin_root/dist/admin/ (not inside a nested path).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 18 complete: React app scaffolded and serving at /admin on hpg6
- Phase 19 (Layout) can begin — it will build the shell component structure (header, nav, tab routing) into the existing src/admin/ scaffold
- The /assets/ and /admin routes are stable and will not change in subsequent phases
- Reminder: dist/admin/ must be re-deployed to hpg6 after each build; it is not auto-synced

---
*Phase: 18-react-scaffold*
*Completed: 2026-03-18*
