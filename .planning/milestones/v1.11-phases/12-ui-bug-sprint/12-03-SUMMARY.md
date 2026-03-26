---
phase: 12-ui-bug-sprint
plan: 03
subsystem: ui
tags: [monitor.ts, dashboard, refresh-button, search, tooltip, css]

# Dependency graph
requires:
  - phase: 12-02
    provides: directory settings UI, contact drawer, optimistic dropdown pattern
provides:
  - wrapRefreshButton shared helper with spinner + relative timestamp applied to all 5 tabs
  - Log tab search clear button (clearLogSearch)
  - Directory search clear button visibility fixed (show/hide on input)
  - Tooltip z-index raised to 1000; .contact-card overflow changed to visible
affects: [future monitor.ts edits, any tab that has a Refresh button]

# Tech tracking
tech-stack:
  added: []
  patterns: [wrapRefreshButton(btn, loadFn) pattern for consistent refresh UX across all tabs]

key-files:
  created: []
  modified:
    - src/monitor.ts

key-decisions:
  - "wrapRefreshButton uses removeAttribute('onclick') + addEventListener to avoid double-call; extraSetup param handles dashboard's _accessKvBuilt reset before loadFn fires"
  - "dir-search-clear button starts hidden (display:none); debouncedDirSearch shows/hides it; clearDirSearch hides it"
  - "contact-card overflow changed from hidden to visible — cards don't rely on clipping for layout, so this is safe"
  - "Tooltip z-index raised from 200 to 1000 to render above card containers"

patterns-established:
  - "wrapRefreshButton(btn, loadFn): wrap any Refresh button with spinner + relative timestamp, zero coupling to the load function"
  - "Search clear button visibility: hidden by default, shown in oninput handler, hidden in clear handler"

requirements-completed: [UX-02, UX-03, UI-05, UI-06, UI-09]

# Metrics
duration: 15min
completed: 2026-03-17
---

# Phase 12 Plan 03: UI Bug Sprint — Refresh UX, Search Clear, Tooltip Fix Summary

**Shared wrapRefreshButton helper with pulse animation and relative timestamps wired to all 5 tabs; log and directory search clear buttons fixed; tooltip overflow clipping resolved**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-17T01:16:00Z
- **Completed:** 2026-03-17T01:31:11Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added `wrapRefreshButton(btn, loadFn)` CSS + JS helper: replaces button text with "Refreshing..." + pulse animation while load runs, shows "Just now / Xm ago / Xh ago" timestamp below the button, auto-updates every 30s
- Wired all 5 Refresh buttons (dashboard, sessions, log, queue, directory) via `wireRefreshBtn` IIFE — dashboard extra setup resets `_accessKvBuilt` before `loadStats()`
- Added clear button (`log-search-clear`) to Log tab search input with `clearLogSearch()` function; `debouncedLogSearch()` shows/hides button based on input value
- Fixed directory search clear button — was always visible; now `display:none` by default, shown when input has content, hidden on clear
- Raised `.tip::after` z-index from 200 to 1000; changed `.contact-card` from `overflow:hidden` to `overflow:visible` so tooltip pseudo-elements render above card edges

## Task Commits

1. **Task 1: Shared wrapRefreshButton helper and apply to all tabs** - `2dfe699` (feat)
2. **Task 2: Fix search clear buttons and tooltip overflow** - `b56aa26` (fix)

## Files Created/Modified

- `src/monitor.ts` — CSS additions (refresh states, tooltip z-index, contact-card overflow), wrapRefreshButton helper + wireRefreshBtn IIFE, clearLogSearch(), debouncedLogSearch/debouncedDirSearch show/hide logic, log search HTML with clear button

## Decisions Made

- `wrapRefreshButton` uses `removeAttribute("onclick")` to strip the inline handler, then adds the load function as a click listener via `Promise.resolve(loadFn())`. An `extraSetup` parameter (captured in a separate capturing listener) handles dashboard's `_accessKvBuilt = false` reset before the load fires.
- Directory `dir-search-clear` button was always visible before this plan — changed to `display:none` default so it only appears when the input has content.
- `.contact-card` overflow changed from `hidden` to `visible`. The card doesn't use clipping for any layout purpose; the hidden was just a default. Changing it allows `.tip::after` pseudo-elements to escape the card boundary.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — all 313 existing tests pass after both tasks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 5 tab Refresh buttons now have consistent UX feedback
- Both search clear buttons are functional and properly show/hide
- Tooltips render correctly above card containers
- Ready for Phase 12 Plan 04 (next UI bug sprint plan)

---
*Phase: 12-ui-bug-sprint*
*Completed: 2026-03-17*
